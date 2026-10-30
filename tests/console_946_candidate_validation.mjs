// Executes the exact synthetic #946 candidate in an offline Worker runtime.
// A separate test-only copy receives fixed exports; production candidates do not.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verify946} from '../scripts/console_946_patch.mjs';
import {testCandidate946} from '../scripts/console_946_runtime_test.mjs';

const consoleRequire=createRequire(new URL('../web/strategy-switch-console/package.json',import.meta.url));
const frontendRequire=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
const ts=frontendRequire('typescript');
const trace=consoleRequire('@jridgewell/trace-mapping');
const root=join(process.env.RUNNER_TEMP,'qrs946-bundle-evidence');
const old=await readFile(join(root,'old/worker.js'));
const next=await readFile(join(root,'new/worker.js'));
const oldMap=JSON.parse(await readFile(join(root,'old/worker.js.map'),'utf8'));
const newMap=JSON.parse(await readFile(join(root,'new/worker.js.map'),'utf8'));
const candidate=verify946(ts,trace,old,next,old,oldMap,newMap);
assert.ok(candidate.equals(next),'all three replacements must exactly reproduce reviewed new bundle');
const text=old.toString('utf8');
const parsedOld=ts.createSourceFile('worker.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const htmlDeclarations=parsedOld.statements.flatMap(statement => ts.isVariableStatement(statement)
  ? [...statement.declarationList.declarations].filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text==='V2_PAGE_HTML') : []);
assert.equal(htmlDeclarations.length,1,'the synthetic bundle has one static HTML declaration');
const html=htmlDeclarations[0].initializer;
assert.ok(html && ts.isStringLiteral(html),'HTML is a plain string literal');
const htmlStart=html.getStart(parsedOld), htmlEnd=html.end;
const activeWithDifferentHtml=Buffer.from(text.slice(0,htmlStart)+'"synthetic-active-page"'+text.slice(htmlEnd));
const candidateWithDifferentHtml=verify946(ts,trace,old,next,activeWithDifferentHtml,oldMap,newMap).toString('utf8');
assert.ok(candidateWithDifferentHtml.includes('"synthetic-active-page"'),'active HTML stays byte-identical');
const activeWithDynamicHtml=Buffer.from(text.slice(0,htmlStart)+'(()=>"unsafe")()'+text.slice(htmlEnd));
assert.throws(()=>verify946(ts,trace,old,next,activeWithDynamicHtml,oldMap,newMap),/asset_shape_invalid/);
assert.throws(()=>verify946(ts,trace,old,next,Buffer.from(text.replace('function hasGap(', 'function hasGapAltered(')),oldMap,newMap),
  /active_dependency_or_wiring_mismatch/,'a changed helper cannot pass');
assert.throws(()=>verify946(ts,trace,old,next,Buffer.from(text.replace('function applyNativeDailyReturns(', 'function applyNativeDailyReturnsAltered(')),oldMap,newMap),
  /required_statement_missing/,'a missing target cannot pass');
assert.throws(()=>verify946(ts,trace,old,next,Buffer.from(text + '\nfunction applyNativeDailyReturns() {}\n'),oldMap,newMap),
  /duplicate_target/,'duplicate target declarations cannot pass');
const wrapper=parsedOld.statements.find(statement=>ts.isFunctionDeclaration(statement) && statement.name?.text==='accountFactsHistoryResponse2');
assert.ok(wrapper,'old history Worker wrapper exists');
const wrapperStart=wrapper.getStart(parsedOld), wrapperCode=text.slice(wrapperStart,wrapper.end);
assert.ok(!wrapperCode.includes('*/'),'the synthetic negative fixture can hold the old wrapper in one comment');
const alteredWrapper=wrapperCode.replace('loadAccountFactsBindings,','loadAccountFactsBindings: null,');
assert.notEqual(alteredWrapper,wrapperCode,'the synthetic negative fixture changes the actual wrapper');
const changedWithComment=Buffer.from(text.slice(0,wrapperStart)+alteredWrapper+text.slice(wrapper.end)+'\n/*'+wrapperCode+'*/\n');
assert.throws(()=>verify946(ts,trace,old,next,changedWithComment,oldMap,newMap),/active_target_mismatch/,
  'a matching old function in a comment cannot substitute for the live AST node');
assert.ok(!wrapperCode.includes('`') && !wrapperCode.includes('${'),'the old wrapper is safe for a synthetic template literal');
const changedWithString=Buffer.from(text.slice(0,wrapperStart)+alteredWrapper+text.slice(wrapper.end)+'\nconst decoy = `'+wrapperCode+'`;\n');
assert.throws(()=>verify946(ts,trace,old,next,changedWithString,oldMap,newMap),/active_dependency_or_wiring_mismatch/,
  'a matching old function in a string cannot substitute for the live AST node');

await testCandidate946(candidate);
console.log(JSON.stringify({ok:true,synthetic_candidate_exact:true,instrumentation:'fixed_test_copy_only',offline_runtime:true}));
