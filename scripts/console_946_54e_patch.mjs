// Fixed #946-on-54e verification only: no network, upload, execution or output.
// The caller MUST first run the existing fixed-source 54e and #946 builders in
// the same guarded job. No caller-provided ref, URL or source path is accepted.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {replaceExact,verify946} from './console_946_patch.mjs';

const targetNames=Object.freeze(['applyNativeDailyReturns','accountFactsHistoryResponse','accountFactsHistoryResponse2']);
const helpers=Object.freeze(['__name','__defProp']);
const expectedBuildId='e41825b42571c49ab41a2536c32675d18b6b32763c7de83484ce1e204cc63bce';
const fail=name=>{throw Error(name)};
function parse(ts,bytes){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>10*1024*1024)fail('invalid_bundle');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail('invalid_bundle')}
  if(!Buffer.from(text,'utf8').equals(bytes))fail('invalid_bundle');
  const sf=ts.createSourceFile('worker.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(sf.parseDiagnostics.length)fail('bundle_parse_failed');
  const statements=[],targets=new Map(),helperDeclarations=new Map(),ids=[];
  for(const node of sf.statements){
    const code=text.slice(node.getStart(sf),node.end);statements.push(code);
    if(ts.isFunctionDeclaration(node)&&node.name&&targetNames.includes(node.name.text)){
      const name=node.name.text;if(targets.has(name))fail('duplicate_target');
      targets.set(name,{node,code});
    }
    if(ts.isVariableStatement(node))for(const d of node.declarationList.declarations){
      if(!ts.isIdentifier(d.name))continue;
      if(helpers.includes(d.name.text)){
        if(node.declarationList.declarations.length!==1||helperDeclarations.has(d.name.text))fail('helper_shape_invalid');
        helperDeclarations.set(d.name.text,code);
      }
      if(d.name.text==='V2_BUILD_ID')ids.push(d.initializer&&ts.isStringLiteral(d.initializer)?d.initializer.text:null);
    }
  }
  if(targetNames.some(x=>!targets.has(x))||helpers.some(x=>!helperDeclarations.has(x)))fail('required_statement_missing');
  return {sf,text,statements,targets,helperDeclarations,ids};
}
function uniqueAt(text,code,position){
  const index=text.indexOf(code);
  return index===position&&index>=0&&text.indexOf(code,index+1)===-1;
}
// This pure comparison is diagnostic only; its result cannot authorize release.
export function same54eStatements(ts,referenceBytes,activeBytes){
  const reference=parse(ts,referenceBytes),active=parse(ts,activeBytes);
  if(reference.ids.length!==1||reference.ids[0]!==expectedBuildId)fail('historical_build_id_mismatch');
  return referenceBytes.equals(activeBytes)&&reference.statements.length===active.statements.length&&reference.statements.every((v,i)=>v===active.statements[i]);
}
// Synthetic old/new and the historical bundle are loaded exclusively from
// fixed locations produced by the existing guarded builders in this same job.
export async function verify946OnFixed54e(ts,trace,activeBytes){
  const root=process.env.RUNNER_TEMP;
  if(!root)fail('fixed_builds_missing');
  const [old,next,reference,oldMapText,newMapText]=await Promise.all([
    readFile(join(root,'qrs946-bundle-evidence/old/worker.js')),
    readFile(join(root,'qrs946-bundle-evidence/new/worker.js')),
    readFile(join(root,'qrs54e-baseline/worker.js')),
    readFile(join(root,'qrs946-bundle-evidence/old/worker.js.map'),'utf8'),
    readFile(join(root,'qrs946-bundle-evidence/new/worker.js.map'),'utf8'),
  ]);
  if(!Buffer.isBuffer(activeBytes)||!reference.equals(activeBytes))fail('active_54e_bytes_mismatch');
  if(oldMapText.length>32*1024*1024||newMapText.length>32*1024*1024)fail('invalid_source_map');
  const approved=verify946(ts,trace,old,next,old,JSON.parse(oldMapText),JSON.parse(newMapText));
  if(!approved.equals(next))fail('synthetic_diff_not_exact');
  const fixed=parse(ts,reference),base=parse(ts,old),updated=parse(ts,next),active=parse(ts,activeBytes);
  if(fixed.ids.length!==1||fixed.ids[0]!==expectedBuildId)fail('historical_build_id_mismatch');
  if(fixed.statements.length!==active.statements.length||fixed.statements.some((v,i)=>v!==active.statements[i]))fail('active_54e_statements_mismatch');
  for(const helper of helpers){
    const expected=base.helperDeclarations.get(helper);
    if(fixed.helperDeclarations.get(helper)!==expected||active.helperDeclarations.get(helper)!==expected)fail('helper_declaration_mismatch');
  }
  const replacements=targetNames.map(name=>{
    const from=base.targets.get(name),historical=fixed.targets.get(name),live=active.targets.get(name),to=updated.targets.get(name);
    if(from.code!==historical.code||live.code!==historical.code)fail('active_target_mismatch');
    if(!uniqueAt(fixed.text,historical.code,historical.node.getStart(fixed.sf))||!uniqueAt(active.text,live.code,live.node.getStart(active.sf)))fail('active_target_offset_mismatch');
    return {oldText:from.code,newText:to.code};
  });
  const candidate=replaceExact(active.text,replacements);
  const reversed=replaceExact(candidate,replacements.map(x=>({oldText:x.newText,newText:x.oldText})));
  if(reversed!==active.text)fail('reverse_mismatch');
  const parsed=parse(ts,Buffer.from(candidate,'utf8'));
  for(const name of targetNames){
    const actual=parsed.targets.get(name),expected=updated.targets.get(name).code;
    if(actual.code!==expected||!uniqueAt(candidate,expected,actual.node.getStart(parsed.sf)))fail('candidate_target_mismatch');
  }
  // Reversibility above proves byte preservation; this check also rejects
  // unexpected syntactic changes outside the three approved functions.
  const normalized=(p)=>p.sf.statements.map(node=>{
    if(ts.isFunctionDeclaration(node)&&node.name&&targetNames.includes(node.name.text))return `target:${node.name.text}`;
    return `code:${p.text.slice(node.getStart(p.sf),node.end)}`;
  });
  const originalStatements=normalized(active),candidateStatements=normalized(parsed);
  if(originalStatements.length!==candidateStatements.length||originalStatements.some((v,i)=>v!==candidateStatements[i]))fail('candidate_layout_mismatch');
  return Buffer.from(candidate,'utf8');
}
