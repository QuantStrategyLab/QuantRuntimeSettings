// Fully synthetic harness tests sequencing/byte checks; it does not replace
// the real TypeScript, fixed-bundle and Miniflare CI regression.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const id='e41825b42571c49ab41a2536c32675d18b6b32763c7de83484ce1e204cc63bce';
const ts={ScriptTarget:{Latest:99},ScriptKind:{JS:1},
  createSourceFile:(_name,text)=>({parseDiagnostics:[],statements:[...text.matchAll(/[^\n]+/g)].filter(m=>!m[0].startsWith('//')&&!m[0].startsWith('/*')).map(m=>{
    const line=m[0],start=m.index,fn=/^function ([A-Za-z_$][\w$]*)/.exec(line),variable=/^var ([A-Za-z_$][\w$]*) = (.*);$/.exec(line);
    const node={getStart:()=>start,end:start+line.length};
    if(fn){node.kind='function';node.name={kind:'identifier',text:fn[1]};}
    if(variable){const literal=/^"([^"]*)"$/.exec(variable[2]);node.kind='variable';node.declarationList={declarations:[{name:{kind:'identifier',text:variable[1]},initializer:literal?{kind:'string',text:literal[1]}:{kind:'other'}}]};}
    return node;
  })}),isFunctionDeclaration:x=>x.kind==='function',isVariableStatement:x=>x.kind==='variable',
  isIdentifier:x=>x.kind==='identifier',isStringLiteral:x=>x.kind==='string'};
const old=['var __defProp = Object.defineProperty;','var __name = custom;', 'var V2_BUILD_ID = "old";',
  'function applyNativeDailyReturns() { old1(); }','function accountFactsHistoryResponse() { old2(); }',
  'function accountFactsHistoryResponse2() { old3(); }','function route() {}'].join('\n');
const next=old.replace('old1','new1').replace('old2','new2').replace('old3','new3');
const historical=old.replace('"old"',`"${id}"`);
test('fixed-file pipeline preserves all non-target bytes and fails closed on changed statements',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'qrs54e-pipeline-test-')), original=process.env.RUNNER_TEMP;
  try{
    const scripts=join(temp,'scripts'),oldDir=join(temp,'qrs946-bundle-evidence/old'),newDir=join(temp,'qrs946-bundle-evidence/new'),refDir=join(temp,'qrs54e-baseline');
    await Promise.all([scripts,oldDir,newDir,refDir].map(x=>mkdir(x,{recursive:true})));
    await writeFile(join(scripts,'console_946_54e_patch.mjs'),await readFile(new URL('../scripts/console_946_54e_patch.mjs',import.meta.url)));
    // The approved bundle/source-map verifier is independently covered in the
    // existing suite. This stub tests only this wrapper's guards and splicing.
    await writeFile(join(scripts,'console_946_patch.mjs'),`export function verify946(_ts,_trace,old,next,active){if(!old.equals(active))throw Error('stub_rejected');return next;}\nexport function replaceExact(text,edits){const p=edits.map(x=>{const i=text.indexOf(x.oldText);if(i<0||text.indexOf(x.oldText,i+1)>=0)throw Error('nonunique');return {...x,i};}).sort((a,b)=>b.i-a.i);for(const x of p)text=text.slice(0,x.i)+x.newText+text.slice(x.i+x.oldText.length);return text;}\n`);
    await Promise.all([writeFile(join(oldDir,'worker.js'),old),writeFile(join(newDir,'worker.js'),next),
      writeFile(join(oldDir,'worker.js.map'),'{}'),writeFile(join(newDir,'worker.js.map'),'{}'),writeFile(join(refDir,'worker.js'),historical)]);
    process.env.RUNNER_TEMP=temp;
    const {verify946OnFixed54e}=await import(pathToFileURL(join(scripts,'console_946_54e_patch.mjs')).href);
    const active=Buffer.from(historical);
    const candidate=await verify946OnFixed54e(ts,{},active);
    assert.equal(candidate.toString(),historical.replace('old1','new1').replace('old2','new2').replace('old3','new3'));
    await assert.rejects(verify946OnFixed54e(ts,{},Buffer.from(historical+'\n//# sourceMappingURL=extra.map')),/active_54e_bytes_mismatch/);
    await assert.rejects(verify946OnFixed54e(ts,{},Buffer.from(historical.replace('function route() {}','function route() { changed(); }'))),/active_54e_bytes_mismatch/);
    await assert.rejects(verify946OnFixed54e(ts,{},Buffer.from(historical.replace(id,'different'))),/active_54e_bytes_mismatch/);
    await writeFile(join(refDir,'worker.js'),historical.replace('var __name = custom;','var __name = other;'));
    await assert.rejects(verify946OnFixed54e(ts,{},Buffer.from(historical.replace('var __name = custom;','var __name = other;'))),/helper_declaration_mismatch/);
    await writeFile(join(refDir,'worker.js'),historical.replace('old1','changed'));
    await assert.rejects(verify946OnFixed54e(ts,{},Buffer.from(historical.replace('old1','changed'))),/active_target_mismatch/);
  }finally{
    if(original===undefined)delete process.env.RUNNER_TEMP;else process.env.RUNNER_TEMP=original;
    await rm(temp,{recursive:true,force:true});
  }
});
