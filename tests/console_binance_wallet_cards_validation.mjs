import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Public synthetic fixtures only; no Worker, storage, credentials or network.
const frontend = fileURLToPath(new URL('../web/strategy-switch-console/frontend/', import.meta.url));
const require = createRequire(join(frontend, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');
const source = buildSync({
  stdin: { contents: `export { BinanceWalletFacts } from './components/BinanceWalletFacts';
export { AccountGroups } from './components/AccountGroups';
export { resolveBinanceWallet, cardAccountKey } from './lib/binanceWalletFacts';
export { LanguageContext } from './i18n'; export { PrefsContext } from './app/context';`,
  resolveDir: join(frontend, 'src'), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'], loader: { '.css': 'empty' },
  write: false, logLevel: 'silent',
}).outputFiles[0].text;
const module = { exports: {} };
new Function('require', 'module', 'exports', source)(require, module, module.exports);
const { BinanceWalletFacts, AccountGroups, resolveBinanceWallet, cardAccountKey, LanguageContext, PrefsContext } = module.exports;
const key = 'synthetic-wallet';
const report = {
  platform: 'binance', account_key: key, scope: 'spot+flexible_earn', snapshot_atomic: false,
  observed_finished_at: '2026-10-26T01:02:03Z', uncovered_scopes: ['funding', 'margin', 'futures', 'locked_earn'],
  assets: [{ asset: 'BTC', quantity: '0.25', spot_free: '0.25', spot_locked: '0', flexible_earn: '0' }],
  wallet_valuation: { status: 'available', amount: '1234.123456789012345678901234567890', currency: 'USDT',
    source: 'GET /sapi/v1/asset/wallet/balance', scope: 'provider_returned_wallet_rows',
    observed_at: '2026-10-26T01:02:02Z', wallet_count: 2 },
};
const ready = (changed = {}) => ({ phase: 'ready', status: 'available', report: { ...structuredClone(report), ...changed } });
function render(Component, props, language = 'zh', hideAmounts = false) {
  return renderToStaticMarkup(React.createElement(LanguageContext.Provider, { value: language },
    React.createElement(PrefsContext.Provider, { value: {
      prefs: { language, theme: 'light', hideAmounts, upDown: 'green-up', defaultRange: 'YTD' },
      resolvedTheme: 'light', setPrefs() {},
    } }, React.createElement(Component, props))));
}
const card = (view = ready(), language = 'zh', hidden = false, other = {}) =>
  render(BinanceWalletFacts, { platform: 'binance', accountKey: key, view, ...other }, language, hidden);
let html = card();
assert.match(html, /钱包估值/);
assert.match(html, /1,234\.123456789012345678901234567890/, 'native decimal precision survives rendering');
assert.match(html, /data-wallet-scope="provider_returned_wallet_rows"/);
assert.match(html, /不代表完整账户净值或现金/);
assert.doesNotMatch(html, /未接入/);
assert.match(card(ready(), 'en'), /Wallet valuation/);
assert.match(card(ready(), 'en'), /not complete account NAV or cash/);
html = card(ready(), 'zh', true);
assert.match(html, /•••/);
assert.doesNotMatch(html, /1234|1234567890/, 'hidden amount never leaks into title or attributes');
html = card(ready({ wallet_valuation: { ...report.wallet_valuation, amount: '0' } }));
assert.match(html, /data-state="available"/);
assert.match(html, />0\.00</, 'reported zero is a value, not missing data');
assert.doesNotMatch(html, /暂不可用/);
for (const [view, state] of [
  [{ phase: 'loading', status: null, report: null }, 'loading'],
  [{ phase: 'error', status: null, report: null }, 'read_failed'],
  [{ phase: 'ready', status: 'missing', report: null }, 'no_data'],
  [{ phase: 'ready', status: 'expired', report: null }, 'pending'],
  [{ phase: 'ready', status: 'unavailable', report: null }, 'unavailable'],
]) {
  html = card(view);
  assert.match(html, new RegExp(`data-state="${state}"`));
  assert.doesNotMatch(html, /1234|1234567890|2026-10-26|持仓 · 1/);
}
for (const invalid of [
  { amount: -1 }, { amount: 1 }, { amount: '-1' }, { amount: '1e2' }, { amount: '01.0' },
  { currency: 'USD' }, { source: 'another source' }, { scope: 'all_accounts' },
  { wallet_count: 0 }, { wallet_count: 1.5 }, { wallet_count: '2' },
  { observed_at: 'invalid' }, { observed_at: '2026-10-26T01:02:04Z' },
]) {
  const view = ready({ wallet_valuation: { ...report.wallet_valuation, ...invalid } });
  html = card(view);
  assert.equal(resolveBinanceWallet(view, 'binance', key).valuation.kind, 'none');
  assert.match(html, /data-reason="invalid_valuation"/);
  assert.match(html, /持仓 · 1 种资产/, 'invalid valuation cannot erase valid scoped quantities');
  assert.doesNotMatch(html, /1,234\.123456/);
}
for (const wallet of [undefined, { status: 'unavailable', amount: null, currency: null,
  source: report.wallet_valuation.source, scope: report.wallet_valuation.scope,
  observed_at: null, wallet_count: null, reason_code: 'wallet_read_failed' }]) {
  html = card(ready({ wallet_valuation: wallet }));
  assert.match(html, /持仓 · 1 种资产/);
  assert.match(html, /持仓数量仅覆盖现货与活期理财/);
  assert.match(html, /data-state="valuation_unavailable"/);
  assert.match(html, /asof/, 'the quantity observation time stays available without wallet valuation');
  assert.doesNotMatch(html, /未接入|>0\.00</);
}
html = card(ready({ assets: [], wallet_valuation: undefined }));
assert.match(html, /持仓 · 0 种资产/, 'known empty inventory is explicitly zero assets');
assert.doesNotMatch(html, /读取失败|>0\.00</, 'known empty inventory is not a zero valuation');
for (const change of [{ account_key: 'another-wallet' }, { platform: 'other' }, { scope: 'futures' }, { observed_finished_at: 'invalid' }]) {
  html = card(ready(change));
  assert.doesNotMatch(html, /1,234|持仓 · 1|2026-10-26/, 'wrong identity or scope must not disclose another report');
}
assert.equal(card(ready(), 'zh', false, { platform: 'ibkr' }), '');
assert.equal(card(ready(), 'zh', false, { accountKey: null }).includes('1,234'), false);
assert.equal(cardAccountKey([{ platform: 'binance', account_alias: key }, { platform: 'binance', account_alias: key }], 'binance'), key);
assert.equal(cardAccountKey([{ platform: 'binance', account_alias: key }, { platform: 'binance', account_alias: 'other' }], 'binance'), null);

const account = { platform: 'binance', account_alias: key, current_strategy: null, last_change_at: null,
  pending_draft_count: 0, pending_decision_count: 0 };
const config = { accountOptions: { binance: [{ key, account_selector: 'synthetic-selector' }] },
  currentStrategies: { binance: { [key]: { execution_evidence: { broker_environment: 'live' } } } } };
html = render(AccountGroups, { accounts: [account], config,
  facts: { rows: [], phase: 'error', binance: ready() }, onSelect() {} });
assert.match(html, /1,234\.123456/, 'generic account-facts failure does not hide a readable native wallet');
assert.equal((html.match(/data-state="available"/g) || []).length, 1, 'one wallet card, no duplicate platform total');
assert.doesNotMatch(html, /实盘合计|实盘小计|未接入/);
console.log('console_binance_wallet_cards_validation: PASS (scoped native wallet, exact identity and decimals, distinct failure states)');
