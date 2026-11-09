// Fixed P02 baseline capture. No provider values or identifiers are logged.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resources,config} from './console_946_backend_release.mjs';
import {compareAssetDeclarations} from './console_m09_asset_compare.mjs';

const require=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
const digest=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
export const HISTORICAL='0c423d325873d85f9a6b6506c6a9ae35f44753a157e90e3ef1c049b094e0aec2';
export const HISTORICAL_SOURCE='9b695a4ade90bcc9931f53109e0ad33f63407927';
export const REFERENCE='912ad8b3efb9080b96112750146bdf050b6eefed6fae822b57dfa57e99feb57a';
export const R2_ACTIVE_MODULE='599b86317957dbc77ed8a307274bdf15109683fa6c735a3263aed23e7aa49244';
const names=['V2_BUILD_ID','V2_PAGE_HTML','V2_ASSETS'];
function identity(value){
  const ds=value?.deployments,d=ds?.[0],v=d?.versions?.[0];
  if(!Array.isArray(ds)||!ds.length||ds.length>10||!uuid(d?.id)||d.strategy!=='percentage'||
     !Array.isArray(d.versions)||d.versions.length!==1||!uuid(v?.version_id)||v.percentage!==100)throw Error('identity');
  return {deployment:d.id,version:v.version_id};
}
function moduleBytes(value,id){
  const m=value?.modules?.[0];
  if(value?.id!==id||!Array.isArray(value.modules)||value.modules.length!==1||m?.name!=='worker.js'||
     m.content_type!=='application/javascript+module'||typeof m.content_base64!=='string'||!m.content_base64.length||
     m.content_base64.length>Math.ceil(10*1024*1024/3)*4||m.content_base64.length%4||/[^A-Za-z0-9+/=]/.test(m.content_base64))throw Error('module');
  const b=Buffer.from(m.content_base64,'base64');
  if(!b.length||b.length>10*1024*1024||b.toString('base64')!==m.content_base64)throw Error('module');
  return b;
}
// Only literal strings and ordinary, non-computed object properties are accepted.
function assetDeclarations(bytes,ts){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const source=ts.createSourceFile('worker.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(source.parseDiagnostics.length)throw Error('unsupported');
  function literal(node){
    if(ts.isStringLiteral(node))return node.text;
    if(!ts.isObjectLiteralExpression(node))throw Error('unsupported');
    const value=Object.create(null);
    for(const p of node.properties){
      if(!ts.isPropertyAssignment(p)||!(ts.isStringLiteral(p.name)||ts.isIdentifier(p.name)))throw Error('unsupported');
      const key=p.name.text;
      if(key==='__proto__'||Object.hasOwn(value,key))throw Error('unsupported');
      value[key]=literal(p.initializer);
    }
    return value;
  }
  const found={},values={},spans={};
  for(const s of source.statements){
    if(!ts.isVariableStatement(s))continue;
    for(const d of s.declarationList.declarations){
      if(!ts.isIdentifier(d.name)||!names.includes(d.name.text))continue;
      const n=d.name.text;
      if(s.modifiers?.length||(s.declarationList.flags & (ts.NodeFlags.Let|ts.NodeFlags.Const))||Object.hasOwn(found,n)||s.declarationList.declarations.length!==1||!d.initializer)throw Error('unsupported');
      let value=d.initializer;
      if(n==='V2_ASSETS'){
        if(!ts.isCallExpression(value)||!ts.isPropertyAccessExpression(value.expression)||
          !ts.isIdentifier(value.expression.expression)||value.expression.expression.text!=='Object'||value.expression.name.text!=='freeze'||
          value.arguments.length!==1||!ts.isObjectLiteralExpression(value.arguments[0]))throw Error('unsupported');
        value=value.arguments[0];
      } else if(!ts.isStringLiteral(value))throw Error('unsupported');
      const decoded=literal(value), encoded=JSON.stringify(decoded);
      values[n]=encoded; spans[n]={start:s.getStart(source),end:s.end};
      found[n]=n==='V2_ASSETS'?`var ${n} = Object.freeze(${encoded});`:`var ${n} = ${encoded};`;
    }
  }
  if(names.some(n=>!Object.hasOwn(found,n)))throw Error('unsupported');
  return {declarations:found,values,spans,text};
}
// Reparse the reconstructed module; only the three declaration spans may change.
export function rebuildWithAssets(candidate,active,ts){
  const original=assetDeclarations(candidate,ts), observed=assetDeclarations(active,ts);
  const ordered=names.map(name=>({name,...original.spans[name]})).sort((a,b)=>a.start-b.start);
  let cursor=0, rebuilt='';
  for(const span of ordered){
    if(span.start<cursor)throw Error('unsupported');
    rebuilt+=original.text.slice(cursor,span.start)+observed.declarations[span.name];cursor=span.end;
  }
  rebuilt+=original.text.slice(cursor);
  const bytes=Buffer.from(rebuilt,'utf8'), checked=assetDeclarations(bytes,ts);
  if(names.some(name=>checked.values[name]!==observed.values[name]))throw Error('rebuild');
  const after=names.map(name=>({name,...checked.spans[name]})).sort((a,b)=>a.start-b.start);
  if(ordered.some((span,i)=>span.name!==after[i].name))throw Error('rebuild');
  const outside=(text,spans)=>{let p=0;const result=[];for(const span of spans){result.push(text.slice(p,span.start));p=span.end;}result.push(text.slice(p));return result;};
  const oldParts=outside(original.text,ordered),newParts=outside(checked.text,after);
  if(oldParts.some((part,i)=>!Buffer.from(part).equals(Buffer.from(newParts[i]))))throw Error('rebuild');
  return {declarations:observed.declarations,sha256:digest(bytes),bytes};
}
// Storage reservation must complete before any Worker reads. A failed or unknown write is never retried.
export async function capture({api,store,candidate,controlSha,controlTree,alternate,expectedActive,now=()=>new Date(),ts=require('typescript'),reference=REFERENCE,alternateReference=HISTORICAL}){
  let stage='candidate',writeAttempted=false;
  try{
    if(!/^[a-f0-9]{40}$/.test(controlSha??'')||!Buffer.isBuffer(candidate)||digest(candidate)!==reference)throw Error('candidate');
    if(controlTree!==undefined&&!/^[a-f0-9]{40}$/.test(controlTree))throw Error('candidate');
    if(!compareAssetDeclarations(candidate,candidate,ts).ok)throw Error('candidate');
    stage='storage_preflight'; await store.reserve();
    stage='active_before'; const before=identity(await api.deployments());
    stage='module'; const active=moduleBytes(await api.betaVersion(before.version),before.version);
    const activeHash=digest(active);
    if(expectedActive!==undefined&&activeHash!==expectedActive)throw Error('module_drift');
    stage='configuration'; const r=resources(await api.scriptVersion(before.version),before.version);
    if(typeof r.script_runtime.migration_tag!=='string'||!r.script_runtime.migration_tag)throw Error('configuration');
    stage='active_after'; const after=identity(await api.deployments());
    if(before.version!==after.version||before.deployment!==after.deployment)throw Error('drift');
    stage='assets'; const compared=compareAssetDeclarations(active,candidate,ts);
    if(!compared.equal||(expectedActive!==undefined&&!compared.ok))throw Error('unsupported');
    let rebuilt, historical;
    if(!compared.ok){
      historical={source:HISTORICAL_SOURCE,status:'unavailable',reason:'build_or_read_unavailable'};
      let assets=active;
      if(Buffer.isBuffer(alternate)){
        if(digest(alternate)!==alternateReference)historical.reason='digest_mismatch';
        else {
          const comparison=compareAssetDeclarations(active,alternate,ts);
          if(comparison.ok){historical={source:HISTORICAL_SOURCE,status:'match'};assets=alternate;}
          else if(comparison.equal)historical={source:HISTORICAL_SOURCE,status:'different'};
          else historical={source:HISTORICAL_SOURCE,status:'unavailable',reason:'unsupported_declarations'};
        }
      }
      rebuilt=rebuildWithAssets(candidate,assets,ts);
    }
    const capturedAt=now().toISOString();
    const record={schema:'qrs-worker-p02-baseline-v1',control_sha:controlSha,
      ...(controlTree===undefined?{}:{control_tree:controlTree}),
      captured_at:capturedAt,...before,active_module_sha256:activeHash,
      configuration_sha256:digest(config(r)),migration_tag_sha256:digest(r.script_runtime.migration_tag),
      reference_module_sha256:reference,asset_comparison:compared.equal,...(rebuilt?{historical_comparison:historical,asset_declarations:rebuilt.declarations,rebuilt_module_sha256:rebuilt.sha256,release_state:'hold_review_required'}:{release_state:'hold'})};
    stage='save'; writeAttempted=true; const bytes=Buffer.from(JSON.stringify(record));
    const generation=await store.create(bytes);
    stage='readback'; const saved=await store.read(generation);
    if(!Buffer.isBuffer(saved)||!saved.equals(bytes))throw Error('readback');
    return {ok:true,asset_declarations_equal:compared.ok,saved:true,readback_verified:true,hold:true};
  }catch{return {ok:false,stage,write_attempted:writeAttempted,retry:false,hold:true};}
}
