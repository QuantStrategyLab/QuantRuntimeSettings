import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compare54eStatements,summarize54e} from '../scripts/console_54e_baseline_report.mjs';
const id='e41825b42571c49ab41a2536c32675d18b6b32763c7de83484ce1e204cc63bce';
// Fake AST isolates the fixed comparison contract; real TypeScript is exercised
// by the controlled workflow after npm ci.
const ts={ScriptTarget:{Latest:99},ScriptKind:{JS:1},
  createSourceFile:(_name,text)=>({parseDiagnostics:[],statements:[...text.matchAll(/[^\n]+/g)].filter(m=>!m[0].startsWith('//')).map(m=>{
    const line=m[0],start=m.index,fn=/^function ([A-Za-z_$][\w$]*)/.exec(line),variable=/^var ([A-Za-z_$][\w$]*) = "([^"]*)"/.exec(line);
    const node={getStart:()=>start,end:start+line.length};
    if(fn){node.kind='function';node.name={kind:'identifier',text:fn[1]};}
    if(variable){node.kind='variable';node.declarationList={declarations:[{name:{kind:'identifier',text:variable[1]},initializer:{kind:'string',text:variable[2]}}]};}
    return node;
  })}),isFunctionDeclaration:x=>x.kind==='function',isVariableStatement:x=>x.kind==='variable',
  isIdentifier:x=>x.kind==='identifier',isStringLiteral:x=>x.kind==='string'};
const source=['var V2_BUILD_ID = "'+id+'";','function applyNativeDailyReturns() {}',
  'function accountFactsHistoryResponse() {}','function accountFactsHistoryResponse2() {}'].join('\n');
const old=Buffer.from(source),historical=Buffer.from(source);
test('full equality and known old functions are reported without code or identifiers',()=>{
  const x=compare54eStatements(ts,old,historical,Buffer.from(source));
  assert.equal(x.full_historical_bundle_equal,true);assert.equal(x.asset_id_matches_54e,true);
  assert.ok(Object.values(x.old_target_functions_match).every(Boolean));
  assert.doesNotMatch(JSON.stringify(x),new RegExp(id));
});
test('a different trailing sourceMappingURL prevents full-byte equality',()=>{
  const active=Buffer.from(source+'\n//# sourceMappingURL=PRIVATE_SENTINEL\n');
  const x=compare54eStatements(ts,old,historical,active);
  assert.equal(x.full_historical_bundle_equal,false);
  assert.ok(Object.values(x.old_target_functions_match).every(Boolean));
  assert.doesNotMatch(JSON.stringify(x),/PRIVATE_SENTINEL/);
});
test('changed or duplicate function cannot match the old complete AST node',()=>{
  const changed=source.replace('function accountFactsHistoryResponse() {}','function accountFactsHistoryResponse() { return 1; }');
  assert.equal(compare54eStatements(ts,old,historical,Buffer.from(changed)).old_target_functions_match.accountFactsHistoryResponse,false);
  const duplicate=source+'\nfunction accountFactsHistoryResponse() {}';
  assert.equal(compare54eStatements(ts,old,historical,Buffer.from(duplicate)).old_target_functions_match.accountFactsHistoryResponse,false);
});
test('unknown active build ID and unapproved old bundle fail closed',()=>{
  const active=Buffer.from(source.replace(id,'PRIVATE_SENTINEL'));
  const x=compare54eStatements(ts,old,historical,active);
  assert.equal(x.asset_id_matches_54e,false);assert.equal(x.asset_id_matches_3ed,false);
  assert.doesNotMatch(JSON.stringify(x),/PRIVATE_SENTINEL/);
  assert.throws(()=>summarize54e(ts,old,historical,active),/unapproved_old_bundle/);
});
