import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequestGate } from '../web/strategy-switch-console/frontend/src/requestGate.js';
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
for (const phase of ['30', '7', '1', 'expired']) {
  assert.equal(listDailyDecisions({ ...base, maintenance: { value: { ...metadata, phase, expires_at: '2035-04-01T00:00:00.000Z' }, error: null } }).items.length, 1);
}
assert.equal(listDailyDecisions({ ...base, maintenance: { value: { ...metadata, phase: 'not_due', requires_action: false, expires_at: '2035-04-01T00:00:00.000Z' }, error: null } }).items.length, 0);
const failed = listDailyDecisions({ ...base, maintenance: { value: null, error: 'http_503' } });
assert.equal(failed.items.length, 1);
assert.equal(failed.items[0].maintenance, null);
assert.equal(failed.items[0].question, '到期时间读取失败');
// Guard both UI and action dispatch, independently of presentation's flags.
const page = readFileSync(new URL('../web/strategy-switch-console/frontend/src/DecisionsPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../web/strategy-switch-console/frontend/src/App.tsx', import.meta.url), 'utf8');
assert.match(page, /selected\.kind === "maintenance"/);
assert.match(page, /CredentialMaintenanceDetail/);
assert.match(app, /if \(item\.kind === "maintenance"\) return;/);
assert.match(page, /管理到期记录/);
assert.match(page, /item.kind !== "maintenance" && <small className="decision-reference">/);
const preview = readFileSync(new URL('../web/strategy-switch-console/frontend/src/OverviewDecisionPreview.tsx', import.meta.url), 'utf8');
assert.match(preview, /item.kind !== "maintenance" && <small>/);
assert.equal(typeof api.validCredentialMaintenance, 'function', 'both reads and ACKs validate the maintenance schema');
assert.equal(api.validCredentialMaintenance(metadata), true);
for (const invalid of [{}, { ...metadata, metadata_revision: true }, { ...metadata, id: 'other' }, { ...metadata, phase: 'not_due' }, { ...metadata, expires_at: '2035-02-30T00:00:00.000Z' }, { ...metadata, delivery: 'other' }]) assert.equal(api.validCredentialMaintenance(invalid), false);
const prior = { ...metadata, metadata_revision: 4 };
const expiry = '2035-04-01T08:00:00+08:00';
const goodAck = { ...prior, metadata_revision: 5, expires_at: '2035-04-01T00:00:00.000Z', phase: 'not_due', requires_action: false };
assert.equal(api.validCredentialRegistrationAck(goodAck, expiry, prior), true);
for (const badAck of [{}, { ...goodAck, expires_at: '2035-04-02T00:00:00.000Z' }, { ...goodAck, metadata_revision: 4 }, { ...goodAck, metadata_revision: 6 }]) assert.equal(api.validCredentialRegistrationAck(badAck, expiry, prior), false);
assert.equal(api.validCredentialRegistrationAck({ ...goodAck, metadata_revision: 5 }, expiry, goodAck), true, 'same canonical expiry preserves revision');
const detail = readFileSync(new URL('../web/strategy-switch-console/frontend/src/CredentialMaintenanceDetail.tsx', import.meta.url), 'utf8');
assert.match(detail, /useState\(value\?\.metadata_revision/);
assert.match(detail, /onSave\(expiry, editingRevision\)/);
// Execute the actual small App handler with offline collaborators.
const registerBody = app.slice(app.indexOf('    async function registerCredentialExpiry('), app.indexOf('    async function decideDaily('));
const executable = registerBody.replace('expires_at: string, metadata_revision: number', 'expires_at, metadata_revision').replace('postJson<CredentialMaintenance>', 'postJson');
function handler(current, response) {
  let posts = 0, writes = 0, releases = 0;
  const fn = new Function('model', 'beginOnce', 'postJson', 'setModel', 'finishOnce', 'validCredentialRegistrationAck', 'modelRef', 'gate', 'setRefreshing', `${executable}; return registerCredentialExpiry;`)(
    { session: { admin: true, allowed: true, login: 'fixture-admin' }, maintenance: { value: current, error: null } }, () => true,
    async () => { posts++; return response; }, () => { writes++; }, () => { releases++; }, api.validCredentialRegistrationAck, { current: { session: { admin: true, allowed: true, login: 'fixture-admin' }, maintenance: { value: current, error: null } } }, { current: { invalidate() {} } }, () => {});
  return { fn, counts: () => ({ posts, writes, releases }) };
}
const conflicted = handler(goodAck, goodAck);
await assert.rejects(conflicted.fn(expiry, prior.metadata_revision), /unavailable/);
assert.deepEqual(conflicted.counts(), { posts: 0, writes: 0, releases: 0 }, 'old editing revision cannot silently adopt refreshed metadata');
const unrelated = handler(prior, { ...goodAck, expires_at: '2035-04-02T00:00:00.000Z' });
await assert.rejects(unrelated.fn(expiry, prior.metadata_revision), /unconfirmed/);
assert.deepEqual(unrelated.counts(), { posts: 1, writes: 0, releases: 1 }, 'bad ACK cannot clear TODO or show saved');
const confirmed = handler(prior, goodAck);
assert.deepEqual(await confirmed.fn(expiry, prior.metadata_revision), goodAck);
assert.deepEqual(confirmed.counts(), { posts: 1, writes: 1, releases: 1 });
const reloadBody = detail.slice(detail.indexOf('  async function reload()'), detail.indexOf('  async function save('));
function reloadHandler(response) {
  const state = { expiry: '2035-01-01T00:00:00Z', revision: 4, status: 'unconfirmed' };
  const fn = new Function('admin', 'busy', 'onReload', 'setExpiry', 'setEditingRevision', 'setStatus', `${reloadBody}; return reload;`)(
    true, false, async () => { if (response instanceof Error) throw response; return response; },
    value => { state.expiry = value; }, value => { state.revision = value; }, value => { state.status = value; });
  return { fn, state };
}
const failedReadback = reloadHandler(new Error('synthetic-read-failure'));
await failedReadback.fn();
assert.equal(failedReadback.state.expiry, '2035-01-01T00:00:00Z');
assert.equal(failedReadback.state.revision, 4, 'failed readback cannot bind the old draft to a new revision');
const explicitReadback = reloadHandler(goodAck);
await explicitReadback.fn();
assert.deepEqual(explicitReadback.state, { expiry: goodAck.expires_at, revision: 5, status: null }, 'explicit verified readback replaces both input and edit revision');

// Delayed responses must preserve a newer private revision and cleared session.
async function delayedActualHandler(kind, latest, result) {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  let current = { session: { admin: true, allowed: true, login: 'fixture-admin' }, maintenance: { value: prior, error: null } };
  const captured = current;
  let invalidated = 0;
  const body = kind === 'save' ? executable : app.slice(app.indexOf('    async function rereadCredentialExpiry('), app.indexOf('    async function registerCredentialExpiry('));
  const ref = { get current() { return current; } };
  const fn = new Function('model', 'modelRef', 'beginOnce', 'postJson', 'loadCredentialMaintenance', 'setModel', 'finishOnce', 'validCredentialRegistrationAck', 'gate', 'setRefreshing', `${body}; return ${kind === 'save' ? 'registerCredentialExpiry' : 'rereadCredentialExpiry'};`)(
    captured, ref, () => true, async () => pending, async () => pending,
    updater => { current = updater(current); }, () => {}, api.validCredentialRegistrationAck,
    { current: { invalidate: () => { invalidated++; } } }, () => {});
  const submission = kind === 'save' ? fn(expiry, prior.metadata_revision) : fn();
  current = latest;
  resolve(result);
  const settled = await Promise.allSettled([submission]);
  return { current, settled, invalidated };
}
const latestModel = { session: { admin: true, allowed: true, login: 'fixture-admin' }, maintenance: { value: { ...goodAck, metadata_revision: 6, requires_action: true, phase: '7' }, error: null } };
for (const kind of ['save', 'read']) {
  const late = await delayedActualHandler(kind, latestModel, goodAck);
  assert.equal(late.current.maintenance.value.metadata_revision, 6, 'late maintenance response cannot replace a newer revision');
  assert.equal(late.current.maintenance.value.requires_action, true);
  assert.equal(late.settled[0].status, 'rejected', 'stale response cannot acknowledge saved or reset editing snapshot');
  const cleared = await delayedActualHandler(kind, null, goodAck);
  assert.equal(cleared.current, null);
  assert.equal(cleared.settled[0].status, 'rejected');
}

for (const kind of ['save', 'read']) {
  const sameSession = { session: { admin: true, allowed: true, login: 'fixture-admin' }, maintenance: { value: prior, error: null } };
  const accepted = await delayedActualHandler(kind, sameSession, goodAck);
  assert.equal(accepted.current.maintenance.value.metadata_revision, 5);
  assert.equal(accepted.invalidated, 1, 'successful maintenance update invalidates a pending old full-refresh token');
  const changedSession = await delayedActualHandler(kind, { ...sameSession, session: { admin: true, allowed: true, login: 'other-fixture-admin' } }, goodAck);
  assert.equal(changedSession.settled[0].status, 'rejected');
  assert.equal(changedSession.current.maintenance.value.metadata_revision, 4);
}
// Execute the existing full-refresh prefix with the same actual request gate.
const actualGate = createRequestGate();
let resolveOld;
const oldRead = new Promise(done => { resolveOld = done; });
let visible = { session: { admin: true, allowed: true, login: 'fixture-admin' }, maintenance: { value: prior, error: null } };
const refreshStart = app.indexOf('    const refresh = useCallback(async () => {') + '    const refresh = useCallback(async () => {'.length;
const refreshPrefix = app.slice(refreshStart, app.indexOf('            if ("denied" in next)', refreshStart));
const refresh = new Function('gate', 'setRefreshing', 'setErrorMessage', 'loadReadModel', 'setModel', `return async () => { ${refreshPrefix} setModel(next); } finally {} };`)(
  { current: actualGate }, () => {}, () => {}, async () => oldRead, value => { visible = value; });
const delayedRefresh = refresh();
const realSave = new Function('model', 'modelRef', 'beginOnce', 'postJson', 'setModel', 'finishOnce', 'validCredentialRegistrationAck', 'gate', 'setRefreshing', `${executable}; return registerCredentialExpiry;`)(
  visible, { get current() { return visible; } }, () => true, async () => goodAck,
  updater => { visible = updater(visible); }, () => {}, api.validCredentialRegistrationAck, { current: actualGate }, () => {});
await realSave(expiry, prior.metadata_revision);
resolveOld({ session: visible.session, maintenance: { value: prior, error: null } });
await delayedRefresh;
assert.equal(visible.maintenance.value.metadata_revision, 5, 'old full refresh cannot overwrite a successful new save');
console.log('credential maintenance presentation validation passed');
