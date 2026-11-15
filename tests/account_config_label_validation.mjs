import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from '../web/strategy-switch-console/frontend/node_modules/typescript/lib/typescript.js';
import { build } from '../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js';

// Execute the actual hook with a synthetic React context and locale. All IDs are synthetic.
const source = fs.readFileSync(new URL('../web/strategy-switch-console/frontend/src/lib/useDisplayNames.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const directorySource = fs.readFileSync(new URL('../web/strategy-switch-console/frontend/src/lib/accountDirectory.ts', import.meta.url), 'utf8');
const directoryCode = ts.transpileModule(directorySource.replace(/^import .*;\n/gm, '').replace(/export /g, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const { accountKey, accountOption, brokerIdentity, findAccount, groupAccounts, ibkrAccountName, performanceScope } = new Function(
  directoryCode + ';return {accountKey, accountOption, brokerIdentity, findAccount, groupAccounts, ibkrAccountName, performanceScope};')();
const unavailable = { zh: '账户号不可用', en: 'Account ID unavailable' };
const generic = { zh: '账户', en: 'Account' };
// A strategy-derived key, label and target name, as in the published example options.
const tqqq = { key: 'tqqq', label: 'tqqq', target_name: 'tqqq', account_selector: 'U00000001' };
const soxl = { key: 'soxl', label: 'SOXL', target_name: 'soxl', account_selector: 'U00000002' };
const config = { accountOptions: {
  ibkr: [tqqq, soxl, { key: 'paper', label: 'Paper', target_name: 'paper', account_selector: 'DU0000003' }],
  schwab: [{ key: 'tqqq', label: 'paper', account_selector: 'U00000001' }],
} };
const before = JSON.stringify(config);
const hookFor = locale => new Function('useContext', 'AccountDirectoryContext', 'useLanguage', 'useT', 'accountOption', 'ibkrAccountName', code + ';return useDisplayNames;')(
  () => config, {}, () => locale, () => key => key === 'common.account' ? generic[locale] : key === 'common.account_id_unavailable' ? unavailable[locale] : key,
  accountOption, ibkrAccountName);
const ibkr = (option, alias = option.key) => [{ accountOptions: { ibkr: [option] } }, alias];
for (const locale of ['zh', 'en']) {
  const hook = hookFor(locale);
  const names = hook();
  // The validated native selector wins over a strategy label, key and target name.
  assert.equal(names.account('tqqq', 'ibkr'), 'U00000001');
  assert.equal(names.account('soxl', 'ibkr'), 'U00000002');
  assert.equal(names.account('paper', 'ibkr'), 'DU0000003', 'DU paper accounts are native IDs');
  assert.equal(names.account('tqqq', 'IBKR'), unavailable[locale], 'option lookup stays exact; an unmatched platform key has no broker ID');
  // Platform isolation: the same key on another platform keeps its own label rules.
  assert.equal(names.account('tqqq', 'schwab'), 'paper');
  assert.equal(names.account('missing', 'schwab'), 'missing');
  // Missing or invalid selectors are honest: never a strategy name, key, label or target name.
  for (const selector of [undefined, '', '   ', 'EXAMPLE_IBKR_SOXL', 'DEMO_IBKR_PRIMARY', 'u00000001', 'du0000003', 'U', 'DU', 'U0000 0001',
    'U00000001,U00000002', 'U00000001 U00000002', 'X00000001', 'UU00000001', 'U0000000a', 'soxl', 42]) {
    const [cfg, alias] = ibkr({ ...tqqq, account_selector: selector });
    assert.equal(hook(cfg).account(alias, 'ibkr'), unavailable[locale], `invalid selector ${JSON.stringify(selector)}`);
  }
  assert.equal(hook({ accountOptions: { ibkr: [{ key: 'tqqq', label: 'tqqq', target_name: 'tqqq' }] } }).account('tqqq', 'ibkr'), unavailable[locale]);
  assert.equal(names.account('unknown-key', 'ibkr'), unavailable[locale], 'an unmatched option has no broker ID');
  assert.equal(hook(null).account('tqqq', 'ibkr'), unavailable[locale]);
  assert.equal(hook(null).account('U00000001', 'ibkr'), unavailable[locale], 'a U-shaped key is not a validated selector');
  assert.equal(names.account(' U00000001 ', 'ibkr'), unavailable[locale], 'only the matched option names the account');
  assert.equal(hook(ibkr({ ...tqqq, account_selector: ' U00000001 ' })[0]).account('tqqq', 'ibkr'), 'U00000001', 'surrounding whitespace is trimmed');
  assert.equal(hook(null).account(null, 'ibkr'), generic[locale]);
  // Non-IBKR label sanitization is unchanged.
  const schwab = label => hook({ accountOptions: { schwab: [{ key: 'live', target_name: 'hk', account_selector: 'U0000099', label }] } }).account('live', 'schwab');
  for (const label of ['live', 'paper', 'sg', 'hk', 'u166xxx', '实盘']) assert.equal(schwab(label), label);
  for (const label of ['U0000099', '00000099', '0000-0099', 'https://fake.invalid', 'bad\nlabel', 'bad\tlabel', 'bad\u0000label', 'x'.repeat(71)]) {
    assert.equal(schwab(label), 'live');
  }
  assert.equal(hook({ accountOptions: { schwab: [{ key: 'paper', target_name: 'sg' }] } }).account('paper', 'schwab'), 'paper', 'key precedes target_name when label is absent');
  assert.equal(hook({ accountOptions: { schwab: [{ label: 'U0000099', key: 'U0000099', target_name: 'sg' }] } }).account('U0000099', 'schwab'), 'sg');
  assert.equal(hook({ accountOptions: { schwab: [{ key: 'U0000099', target_name: 'U0000099', account_selector: 'U0000099' }] } }).account('U0000099', 'schwab'), '***99');
  assert.equal(hook(null).account('U0000099', 'schwab'), '***99');
  assert.equal(hook(null).account('live'), 'live', 'calls without a platform keep the label rules');
  // The strategy stays a separate field, still looked up by the internal key.
  const strategies = hook({ ...config, currentStrategies: { ibkr: { tqqq: { strategy_profile: 'tqqq_growth_income' } } } });
  assert.equal(strategies.currentStrategy({ platform: 'ibkr', account_alias: 'tqqq' }), 'tqqq_growth_income');
}

// Selection, lookup and grouping identity are unchanged by the display name.
assert.equal(ibkrAccountName(tqqq), 'U00000001');
assert.equal(ibkrAccountName(undefined), null);
assert.equal(ibkrAccountName({ ...tqqq, account_selector: 'EXAMPLE_IBKR_TQQQ' }), null);
const accounts = [{ platform: 'ibkr', account_alias: 'tqqq' }, { platform: 'ibkr', account_alias: 'soxl' }, { platform: 'schwab', account_alias: 'tqqq' }];
assert.deepEqual(accounts.map(accountKey), ['ibkr:tqqq', 'ibkr:soxl', 'schwab:tqqq'], 'selection values keep the internal key');
assert.equal(findAccount(accounts, 'ibkr:tqqq'), accounts[0]);
assert.equal(findAccount(accounts, 'ibkr:U00000001'), undefined, 'a broker ID is not a selection value');
assert.equal(findAccount(accounts, 'soxl'), accounts[1], 'legacy bare aliases still resolve');
assert.equal(accountOption(config, 'ibkr', 'tqqq'), tqqq);
assert.equal(accountOption(config, 'ibkr', 'U00000001'), undefined, 'lookups stay keyed by option.key');
assert.deepEqual(performanceScope('ibkr:tqqq'), { scope: 'tqqq', platform: 'ibkr' }, 'request scopes keep the internal key');
assert.equal(brokerIdentity(config, accounts[0]), 'U00000001');
assert.deepEqual(groupAccounts(accounts, config).map(group => [group.platform, group.accounts.map(entry => [entry.identity, entry.rows.map(accountKey)])]), [
  ['ibkr', [['U00000001', ['ibkr:tqqq']], ['U00000002', ['ibkr:soxl']]]],
  ['schwab', [['U00000001', ['schwab:tqqq']]]],
], 'grouping identity is unchanged');
assert.equal(JSON.stringify(config), before, 'display does not mutate selection config');

// ControlsTab: the visible confirmation and typed challenge use the resolved
// broker ID; requests and the response identity check keep the internal key.
const root = new URL('../web/strategy-switch-console/frontend/', import.meta.url).pathname;
const dir = await mkdtemp(join(tmpdir(), 'account-config-label-'));
try {
  const outfile = join(dir, 'controls.cjs');
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { ControlsTab } from './src/pages/accounts/ControlsTab';
    export function render(language, account, config, response = account) {
      const actions = Object.fromEntries(['enable','stop','resume','approve_application'].map(k => [k, {enabled:true}]));
      Object.assign(globalThis.__controls, { rows: [], confirms: [], posts: [], loads: [] });
      globalThis.__controls.state = {phase:'ready', data:{...response, actions, runtime_control:null}};
      const confirm = async request => { globalThis.__controls.confirms.push(request); return true; };
      renderToStaticMarkup(h(I18nProvider,{language},h(ControlsTab,{account, config, confirm})));
      return globalThis.__controls;
    }` }, bundle:true, platform:'node', format:'cjs', outfile, jsx:'automatic',
    loader:{'.css':'empty'}, define:{'import.meta.env':'{}'}, plugins:[{name:'mock-io',setup(b) {
      b.onLoad({filter:/\/lib\/hooks\.ts$/}, () => ({contents:'export const useApi = (load) => { load(); return {...globalThis.__controls.state, reload() {}}; };', loader:'js'}));
      b.onLoad({filter:/\/api\/endpoints\.ts$/}, () => ({contents:`
        export const loadRunControls = (...args) => { globalThis.__controls.loads.push(args); return new Promise(() => {}); };
        export const loadAccountSettings = async () => ({});`, loader:'js'}));
      b.onLoad({filter:/\/api\/client\.ts$/}, () => ({contents:'export const postJson = async (path, body) => { globalThis.__controls.posts.push([path, body]); return {}; };', loader:'js'}));
      b.onLoad({filter:/\/components\/DangerZone\.tsx$/}, () => ({contents:`
        export const DangerZone = ({ children }) => children;
        export const DangerRow = (props) => { globalThis.__controls.rows.push(props); return null; };`, loader:'js'}));
    }}] });
  globalThis.__controls = {};
  const { render } = createRequire(import.meta.url)(outfile);
  const consoleConfig = { accountOptions: config.accountOptions };
  const stopRow = rows => rows[1];
  const click = async row => { await row.action.props.onClick(); await new Promise(resolve => setImmediate(resolve)); };
  for (const language of ['zh', 'en']) {
    // IBKR with a valid selector: the challenge is the broker ID, the request carries the key.
    let run = render(language, { platform: 'ibkr', account_alias: 'tqqq' }, consoleConfig);
    assert.deepEqual(run.loads, [['tqqq', 'ibkr']], 'run controls are requested by the internal key');
    assert.equal(stopRow(run.rows).action.props.disabled, false);
    await click(stopRow(run.rows));
    assert.equal(run.confirms.length, 1);
    const [request] = run.confirms;
    assert.equal(request.target, 'U00000001');
    assert.equal(request.typeToConfirm.expected, 'U00000001');
    assert.ok(request.typeToConfirm.label.includes('U00000001') && !request.typeToConfirm.label.includes('tqqq'));
    assert.deepEqual(run.posts.map(([path, body]) => [path, body.platform, body.target_name, body.operation, body.confirm]),
      [['/api/runtime-stop', 'ibkr', 'tqqq', 'disable', 'CONTROL_ONLY']], 'stop requests keep the internal target');
    assert.ok(!JSON.stringify(run.posts).includes('U00000001'), 'the broker ID never enters the request');
    // The response identity check keeps the internal key: a response for another key renders nothing.
    run = render(language, { platform: 'ibkr', account_alias: 'tqqq' }, consoleConfig, { platform: 'ibkr', account_alias: 'U00000001' });
    assert.deepEqual([run.rows.length, run.loads], [0, [['tqqq', 'ibkr']]], 'a response keyed by the broker ID is not this account');
    // IBKR without a resolvable ID: the stop confirmation is blocked and nothing is sent.
    for (const selector of [undefined, 'EXAMPLE_IBKR_TQQQ', 'u00000001']) {
      run = render(language, { platform: 'ibkr', account_alias: 'tqqq' }, { accountOptions: { ibkr: [{ ...tqqq, account_selector: selector }] } });
      const stop = stopRow(run.rows);
      assert.equal(stop.action.props.disabled, true, `blocked for ${selector}`);
      assert.equal(stop.unavailableReason, language === 'zh'
        ? '停止需要已核验的 IBKR 账户号；当前配置的账户选择器缺失或无效。'
        : 'Stopping needs a verified IBKR account ID. The configured account selector is missing or invalid.');
      await click(stop);
      assert.deepEqual([run.confirms.length, run.posts.length], [0, 0]);
      assert.equal(run.rows[0].action.props.disabled, false, 'other actions keep their availability');
    }
    // Non-IBKR challenge behaviour is unchanged: the internal alias, with the alias copy.
    for (const platform of ['schwab', 'longbridge']) {
      run = render(language, { platform, account_alias: 'tqqq' }, consoleConfig);
      await click(stopRow(run.rows));
      assert.equal(run.confirms[0].typeToConfirm.expected, 'tqqq', platform);
      assert.equal(run.confirms[0].typeToConfirm.label, language === 'zh' ? '输入账户别名 tqqq 以确认停止' : 'Type the account alias tqqq to confirm the stop');
      assert.equal(run.posts[0][1].target_name, 'tqqq');
    }
  }
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('Account config label priority, native IBKR names, confirmation and identity isolation passed');
