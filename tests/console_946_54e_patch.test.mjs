import assert from 'node:assert/strict';
import {test} from 'node:test';
import {same54eStatements} from '../scripts/console_946_54e_patch.mjs';
const id='e41825b42571c49ab41a2536c32675d18b6b32763c7de83484ce1e204cc63bce';
// Isolate the comparison logic without pretending this replaces real TS tests.
const ts={ScriptTarget:{Latest:99},ScriptKind:{JS:1},
  createSourceFile:(_name,text)=>({parseDiagnostics:[],statements:[...text.matchAll(/[^\n]+/g)].filter(m=>!m[0].startsWith('//')).map(m=>{
    const line=m[0],start=m.index,fn=/^function ([A-Za-z_$][\w$]*)/.exec(line),variable=/^var ([A-Za-z_$][\w$]*) = (.*);$/.exec(line);
    const node={getStart:()=>start,end:start+line.length};
    if(fn){node.kind='function';node.name={kind:'identifier',text:fn[1]};}
    if(variable){const literal=/^"([^"]*)"$/.exec(variable[2]);node.kind='variable';node.declarationList={declarations:[{name:{kind:'identifier',text:variable[1]},initializer:literal?{kind:'string',text:literal[1]}:{kind:'other'}}]};}
    return node;
  })}),isFunctionDeclaration:x=>x.kind==='function',isVariableStatement:x=>x.kind==='variable',
  isIdentifier:x=>x.kind==='identifier',isStringLiteral:x=>x.kind==='string'};
const source=['var __defProp = Object.defineProperty;','var __name = custom;',`var V2_BUILD_ID = "${id}";`,
 'var V2_PAGE_HTML = "original";','function applyNativeDailyReturns() {}','function accountFactsHistoryResponse() {}',
 'function accountFactsHistoryResponse2() {}','function route() {}'].join('\n');
const reference=Buffer.from(source);
test('same source matches but trailer-only differences are rejected',()=>{
  assert.equal(same54eStatements(ts,reference,reference),true);
  assert.equal(same54eStatements(ts,reference,Buffer.from(source+'\n//# sourceMappingURL=different.map')),false);
});
test('assets, helpers, routes, and target changes are never skipped',()=>{
  for(const [before,after] of [['"original"','"changed"'],['Object.defineProperty','Object.other'],
    ['function route() {}','function route() { x(); }'],['function applyNativeDailyReturns() {}','function applyNativeDailyReturns() { x(); }']]){
    assert.equal(same54eStatements(ts,reference,Buffer.from(source.replace(before,after))),false);
  }
});
test('missing or duplicate target and wrong public build ID stop',()=>{
  assert.throws(()=>same54eStatements(ts,reference,Buffer.from(source.replace('function applyNativeDailyReturns() {}',''))),/required_statement_missing/);
  assert.throws(()=>same54eStatements(ts,reference,Buffer.from(source+'\nfunction applyNativeDailyReturns() {}')),/duplicate_target/);
  assert.throws(()=>same54eStatements(ts,Buffer.from(source.replace(id,'bad')),reference),/historical_build_id_mismatch/);
});
