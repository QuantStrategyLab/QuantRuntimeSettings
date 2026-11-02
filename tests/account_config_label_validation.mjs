import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../web/strategy-switch-console/frontend/node_modules/typescript/lib/typescript.js';

// Execute the actual hook with a synthetic React context and locale.
const source = fs.readFileSync(new URL('../web/strategy-switch-console/frontend/src/lib/useDisplayNames.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const directorySource = fs.readFileSync(new URL('../web/strategy-switch-console/frontend/src/lib/accountDirectory.ts', import.meta.url), 'utf8');
const directoryCode = ts.transpileModule(directorySource.replace(/^import .*;\n/gm, '').replace(/export /g, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const { accountOption, brokerIdentity, groupAccounts } = new Function(directoryCode + ';return {accountOption, brokerIdentity, groupAccounts};')();
const config = { accountOptions: { ibkr: [{key:'live',label:'Custom',target_name:'hk',account_selector:'U0000099'}], schwab:[{key:'live', label:'paper'}] } };
const before = JSON.stringify(config);
for (const locale of ['zh', 'en']) {
  const hook = new Function('useContext','AccountDirectoryContext','useLanguage','useT','accountOption', code + ';return useDisplayNames;')(
    () => config, {}, () => locale, () => key => key === 'common.account' ? (locale === 'zh' ? '账户' : 'Account') : key, accountOption);
  const names = hook();
  assert.equal(names.account('live','ibkr'), 'Custom');
  assert.equal(names.account('live','schwab'), 'paper', 'platform isolation');
  for (const label of ['live','paper','sg','hk','u166xxx','实盘']) {
    assert.equal(hook({accountOptions:{ibkr:[{...config.accountOptions.ibkr[0], label}]}}).account('live','ibkr'), label);
  }
  for (const label of ['U0000099','00000099','0000-0099','https://fake.invalid','bad\nlabel','bad\tlabel','bad\u0000label','x'.repeat(71)]) {
    assert.equal(hook({accountOptions:{ibkr:[{...config.accountOptions.ibkr[0],label}]}}).account('live','ibkr'), 'live');
  }
  assert.equal(hook({accountOptions:{ibkr:[{key:'U0000099',target_name:'sg',account_selector:'U0000099'}]}}).account('U0000099','ibkr'), 'sg');
  assert.equal(hook(null).account('U0000099','ibkr'), '***99');
  assert.equal(hook(null).account(null,'ibkr'), locale === 'zh' ? '账户' : 'Account');
  assert.equal(hook(null).account('live','ibkr'), 'live');
}
const accounts = [{platform:'ibkr',account_alias:'live'}];
assert.equal(brokerIdentity(config,accounts[0]), 'U0000099');
assert.equal(groupAccounts(accounts,config)[0].accounts[0].identity, 'U0000099');
assert.equal(JSON.stringify(config),before, 'display does not mutate selection config');
console.log('Account config label priority, masking and identity isolation passed');
