import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as api from '../web/strategy-switch-console/frontend/src/api.ts';
import { humanDecisionQueue, listDailyDecisions, decisionActionState } from '../web/strategy-switch-console/frontend/src/presentation.ts';
const ready = { value: { data_status: 'ready' }, error: null };
const base = { language: 'en', profiles: [], promotions: ready, owners: ready, recovery: ready, accountsFor: () => [] };
const metadata = { id: 'ibkr_flex', metadata_source: 'operator_provided', metadata_revision: 0, expires_at: null, phase: 'unknown', delivery: 'not_reserved', requires_action: true };
const unknown = listDailyDecisions({ ...base, maintenance: { value: metadata, error: null } });
assert.equal(humanDecisionQueue(unknown.items).length, 1, 'missing expiry creates one shared maintenance TODO');
const item = unknown.items[0];
assert.equal(item.kind, 'maintenance');
assert.deepEqual(item.accountChoices, []);
assert.equal(item.identity, undefined);
assert.deepEqual(decisionActionState({ ...item, canAdopt: true, canReject: true }, { admin: true, busy: false, selectedAccountId: '' }), { adoptEnabled: false, rejectEnabled: false });
for (const phase of ['30', '14', '7', 'expired']) {
  assert.equal(listDailyDecisions({ ...base, maintenance: { value: { ...metadata, phase, expires_at: '2035-04-01T00:00:00.000Z' }, error: null } }).items.length, 1);
}
assert.equal(listDailyDecisions({ ...base, maintenance: { value: { ...metadata, phase: 'not_due', requires_action: false, expires_at: '2035-04-01T00:00:00.000Z' }, error: null } }).items.length, 0);
const failed = listDailyDecisions({ ...base, maintenance: { value: null, error: 'http_503' } });
assert.equal(failed.items.length, 1);
assert.equal(failed.items[0].maintenance, null);
assert.equal(failed.items[0].question, '到期时间读取失败');
// Live inbox: maintenance items only navigate to the System/health page, never adopt or reject.
const page = readFileSync(new URL('../web/strategy-switch-console/frontend/src/pages/decisions/DecisionsPage.tsx', import.meta.url), 'utf8');
assert.match(page, /item\.category === "credential_maintenance"/);
assert.match(page, /navigate\(\{ page: "health" \}\)/);
assert.match(page, /decisions\.open_health/);
assert.equal(typeof api.validCredentialMaintenance, 'function', 'both reads and ACKs validate the maintenance schema');
assert.equal(api.validCredentialMaintenance(metadata), true);
for (const phase of ['30', '14', '7', 'expired']) {
  assert.equal(api.validCredentialMaintenance({ ...metadata, phase, expires_at: '2035-04-01T00:00:00.000Z' }), true, `phase ${phase} is accepted`);
}
assert.equal(api.validCredentialMaintenance({ ...metadata, phase: '1', expires_at: '2035-04-01T00:00:00.000Z' }), false, 'retired phase 1 is rejected');
for (const invalid of [{}, { ...metadata, metadata_revision: true }, { ...metadata, id: 'other' }, { ...metadata, phase: 'not_due' }, { ...metadata, expires_at: '2035-02-30T00:00:00.000Z' }, { ...metadata, delivery: 'other' }]) assert.equal(api.validCredentialMaintenance(invalid), false);
const prior = { ...metadata, metadata_revision: 4 };
const expiry = '2035-04-01T08:00:00+08:00';
const goodAck = { ...prior, metadata_revision: 5, expires_at: '2035-04-01T00:00:00.000Z', phase: 'not_due', requires_action: false };
assert.equal(api.validCredentialRegistrationAck(goodAck, expiry, prior), true);
for (const badAck of [{}, { ...goodAck, expires_at: '2035-04-02T00:00:00.000Z' }, { ...goodAck, metadata_revision: 4 }, { ...goodAck, metadata_revision: 6 }]) assert.equal(api.validCredentialRegistrationAck(badAck, expiry, prior), false);
assert.equal(api.validCredentialRegistrationAck({ ...goodAck, metadata_revision: 5 }, expiry, goodAck), true, 'same canonical expiry preserves revision');
console.log('credential maintenance presentation validation passed');
