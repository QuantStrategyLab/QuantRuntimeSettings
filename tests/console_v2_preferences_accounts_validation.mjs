import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../web/strategy-switch-console/frontend/node_modules/typescript/lib/typescript.js';
import { groupAccounts, findAccount, accountKey, performanceScope } from '../web/strategy-switch-console/frontend/src/lib/accountDirectory.ts';
import { loadPreferences, savePreferences, resolveTheme } from '../web/strategy-switch-console/frontend/src/lib/prefs.ts';
import { strategyName, laneName, accountName } from '../web/strategy-switch-console/frontend/src/lib/displayNames.ts';

const storage = new Map();
globalThis.window = { localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v)} };
for (const [languages, expected] of [[['zh-CN'],'zh'],[['en-SG'],'en'],[['fr','zh-TW'],'zh'],[['fr'],'en']]) {
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{languages}});
  assert.equal(loadPreferences().language,expected);
  assert.equal(loadPreferences().theme,'system');
}
const saved = {...loadPreferences(), language:'zh', theme:'light'};
savePreferences(saved);
assert.deepEqual(loadPreferences(),saved);
assert.equal(resolveTheme('system',true),'dark');assert.equal(resolveTheme('system',false),'light');
assert.equal(resolveTheme('light',true),'light');assert.equal(resolveTheme('dark',false),'dark');
window.localStorage.getItem = () => {throw Error('storage blocked');};
assert.equal(loadPreferences().theme,'system');

const rows = [{platform:'ibkr', account_alias:'alpha'},{platform:'ibkr',account_alias:'beta'}, {platform:'schwab',account_alias:'live'}, {platform:'firstrade',account_alias:'live'}];
const config = {accountOptions: {ibkr:[{key:'alpha',account_selector:'U12345000'},{key:'beta',account_selector:'U12345000'}]}};
const groups = groupAccounts(rows,config);
assert.equal(groups.length,3);assert.equal(groups[0].accounts.length,1);assert.equal(groups[0].accounts[0].rows.length,2);
assert.equal(findAccount(rows,'live'),undefined,'ambiguous old alias must never select another broker');
assert.equal(findAccount(rows,'firstrade:live'),rows[3]);assert.equal(findAccount(rows,'alpha'),rows[0]);
assert.notEqual(accountKey(rows[2]),accountKey(rows[3]));
assert.deepEqual(performanceScope('firstrade:live'),{scope:'live',platform:'firstrade'});
assert.deepEqual(performanceScope('all'),{scope:'all',platform:undefined});
assert.equal(accountName('crypto_combo','binance','en'),'live');
assert.equal(accountName('paper','longbridge','zh'),'模拟');
assert.equal(laneName('paper','zh'),'模拟');
for(const id of ['russell_top50_leader_rotation','soxl_soxx_trend_income','tqqq_growth_income','global_etf_rotation','ibit_smart_dca','crypto_live_pool_rotation']) {
  assert.match(strategyName(id,'zh'),/[\u3400-\u9fff]/);assert.doesNotMatch(strategyName(id,'en'),/[\u3400-\u9fff]/);
  assert.notEqual(strategyName(id,'en'),id);
}

const root = new URL('../web/strategy-switch-console/frontend/src/',import.meta.url);
const fragments = ['i18n/zh-CN.ts','i18n/en.ts',...fs.readdirSync(new URL('i18n/pages/',root)).map(n=>'i18n/pages/'+n)];
const dictionaries = {zh:{},en:{}};
for(const file of fragments){
 const source = ts.createSourceFile(file,fs.readFileSync(new URL(file,root),'utf8'),ts.ScriptTarget.Latest,true);
 function visit(node) {
  if(ts.isVariableDeclaration(node) && ['zhCN','zh','en'].includes(node.name.getText(source)) && node.initializer && ts.isObjectLiteralExpression(ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer)) {
   const lang = node.name.getText(source)==='en'?'en':'zh';
   for(const p of (ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer).properties) if(ts.isPropertyAssignment(p)&&ts.isStringLiteral(p.initializer)) {
    const key = p.name.text,value=p.initializer.text;
    if(dictionaries[lang][key]) assert.equal(value,dictionaries[lang][key],`conflicting key ${key}`);
    dictionaries[lang][key]=value;
   }
  }
  ts.forEachChild(node,visit);
 }visit(source);
}
assert.deepEqual(Object.keys(dictionaries.zh).sort(),Object.keys(dictionaries.en).sort());
for(const [lang,table] of Object.entries(dictionaries)) for(const [key,value] of Object.entries(table)) {
 assert.doesNotMatch(value,/审计|核对|证据|门禁|\baudit\b|\bevidence\b|\bgates?\b|expected_revision|server handler/i,`${lang}: ${key}`);
 if(lang==='en')assert.doesNotMatch(value,/[\u3400-\u9fff]/,key);
 const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
 assert.deepEqual(placeholders(value),placeholders(dictionaries[lang==='en'?'zh':'en'][key]),key);
}
// Catch untranslated literal keys in all active v2 components, including nested pages.
const active = ['app','pages','components','charts'];
for(const dir of active) for(const file of fs.readdirSync(new URL(dir+'/',root),{recursive:true}).filter(f=>f.endsWith('.tsx'))) {
 const source = ts.createSourceFile(file,fs.readFileSync(new URL(dir+'/'+file,root),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function visit(node) {
  if(ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&ts.isStringLiteral(node.arguments[0])) assert.ok(dictionaries.en[node.arguments[0].text],`${dir}/${file}: ${node.arguments[0].text}`);
  ts.forEachChild(node,visit);
 }visit(source);
}
// Text needs 4.5:1; chart series need 3:1 against their card surface.
const css=fs.readFileSync(new URL('app/app.css',root),'utf8');
const light=css.slice(0,css.indexOf(':root[data-theme="dark"]')),dark=css.slice(css.indexOf(':root[data-theme="dark"]'),css.indexOf('/* Up/down'));
const color=(section,name)=>section.match(new RegExp(`--${name}: (#[a-fA-F0-9]{6})`))?.[1];
const luminance=hex=>{const v=hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
for(const section of [light,dark]) {
 for(const token of ['ink','muted','status-ok','status-warn','status-error']) for(const background of ['surface','surface-2'])assert.ok(ratio(color(section,token),color(section,background))>=4.5,`${token}/${background}`);
 for(const token of ['accent','benchmark-1','benchmark-2','benchmark-3','benchmark-4'])assert.ok(ratio(color(section,token),color(section,'surface'))>=3,token);
}
console.log(`console_v2_preferences_accounts_validation: PASS (${Object.keys(dictionaries.en).length} translated keys)`);
