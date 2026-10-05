import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as presentation from '../web/strategy-switch-console/frontend/src/presentation.ts';
import { translate } from '../web/strategy-switch-console/frontend/src/locales.ts';

assert.equal(presentation.brokerAccountType('live'), '配置 live 环境', 'configuration does not establish a native broker account type');
assert.equal(presentation.brokerAccountType('paper'), '配置 paper 环境');
for (const value of [undefined, '', 'HK', 'SG', 'USD', 'Margin', 'dry_run']) {
  assert.equal(presentation.brokerAccountType(value), '配置环境待确认');
}
const now = Date.parse('2026-10-05T10:00:00Z');
const fresh = {
  platform: 'schwab', account_key: 'synthetic', binding_status: 'bound', identity_status: 'partial_identity',
  identity_mismatch: false, data_status: 'fresh', broker_account_type: { value: 'MARGIN', source_tag: 'securitiesAccount.type' },
  balances: [{ currency: 'USD', net_assets: '123' }], cash: [{ currency: 'USD', cash_balance: '-2' }],
};
const display = (platform = 'schwab', key = 'synthetic', facts = fresh, report = null) => presentation.accountNativeReadout(platform, key, facts, report, now);
assert.deepEqual(display(), { nativeType: 'MARGIN', identityLabel: '身份部分核验' });
assert.deepEqual(display('schwab', 'synthetic', { ...fresh, broker_account_type: { value: 'CASH', source_tag: 'securitiesAccount.type' } }), { nativeType: 'CASH', identityLabel: '身份部分核验' });
for (const facts of [null, { ...fresh, binding_status: 'missing' }, { ...fresh, binding_status: 'duplicate' }, { ...fresh, data_status: 'stale' }, { ...fresh, data_status: 'unavailable' }, { ...fresh, identity_mismatch: true }, { ...fresh, identity_status: 'missing_identity' }, { ...fresh, account_key: 'other' }, { ...fresh, platform: 'ibkr' }]) {
  assert.equal(display('schwab', 'synthetic', facts).nativeType, null, 'unverified, stale, conflicting or wrong-account types remain unknown');
}
assert.equal(display('schwab', 'synthetic', { ...fresh, identity_mismatch: true }).identityLabel, '账户身份不匹配');
assert.equal(display('schwab', 'synthetic', { ...fresh, data_status: 'stale' }).identityLabel, '身份资料已过期');
for (const platform of ['longbridge', 'ibkr', 'firstrade']) {
  for (const currency of ['USD', 'HKD', 'SGD', 'BASE']) {
    const facts = { ...fresh, platform, account_scope: 'HK', broker_environment: 'live', balances: [{ currency, net_assets: '100' }], cash: [{ currency, cash_balance: '-2' }], financing: [{ currency, buy_power: '900' }] };
    assert.equal(display(platform, 'synthetic', facts).nativeType, null, 'currency, scope, negative cash and buying power never establish Cash/Margin');
  }
}
const report = {
  platform: 'binance', account_key: 'synthetic', observed_finished_at: '2026-10-05T09:59:00Z',
  provider_product_type: { value: 'SPOT', source: 'GET /api/v3/account.accountType', observed_at: '2026-10-05T09:58:00Z' },
};
assert.deepEqual(display('binance', 'synthetic', null, report), { nativeType: 'SPOT', identityLabel: '身份部分核验' });
for (const patch of [{ platform: 'firstrade' }, { account_key: 'other' }, { observed_finished_at: 'bad' }, { observed_finished_at: '2026-10-03T09:59:00Z' }, { observed_finished_at: '2026-10-05T10:02:00Z' }, { provider_product_type: { ...report.provider_product_type, observed_at: '2026-10-05T09:59:30Z' } }, { provider_product_type: { ...report.provider_product_type, observed_at: '2026-10-03T09:58:00Z' } }, { provider_product_type: { ...report.provider_product_type, source: 'settings' } }, { provider_product_type: { ...report.provider_product_type, value: 'unknown' } }]) {
  assert.equal(display('binance', 'synthetic', null, { ...report, ...patch }).nativeType, null);
}
assert.equal(display('binance', 'alias', null, report).nativeType, null, 'a native product type is not copied to another alias');
for (const key of ['配置环境', '配置 live 环境', '配置 paper 环境', '配置环境待确认', '原生类别', '身份可信度', '身份部分核验', '身份待确认', '身份资料已过期']) {
  assert.notEqual(translate(key, 'en'), key, `English translation exists: ${key}`);
}
const page = readFileSync(new URL('../web/strategy-switch-console/frontend/src/AccountsPage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/strategy-switch-console/frontend/src/styles.css', import.meta.url), 'utf8');
for (const label of ['配置环境', '原生类别', '身份可信度']) {
  assert.ok(page.includes(`className="account-field-label account-fact-label">{t("${label}")}`));
}
assert.match(css, /\.accounts-page \.account-list \.account-fact-label \{ display: block;/, 'fact labels remain visible on desktop as well as mobile');
console.log('account_native_display_validation: PASS');
