// Fixed, read-only comparison. Never log an active module, identifier or value.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {createReadOnlyRequest,probe} from './console_active_module_probe.mjs';

const oldHash='f7ee5a3f6d660d048ec2a3d7eab9298a022aff971a64c139a4604e9ca647a02a';
const referenceIds=Object.freeze({
  candidate_54e:'e41825b42571c49ab41a2536c32675d18b6b32763c7de83484ce1e204cc63bce',
  candidate_3ed:'8ffd121d7a46bf0c2963aefa890ce9ea975f866e485e9c95e51721c1dbc5f155',
});
const names=Object.freeze(['applyNativeDailyReturns','accountFactsHistoryResponse','accountFactsHistoryResponse2']);
function inspect(ts,bytes){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>10*1024*1024)throw Error('invalid_module');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!Buffer.from(text,'utf8').equals(bytes))throw Error('invalid_module');
  const file=ts.createSourceFile('worker.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(file.parseDiagnostics.length)throw Error('invalid_module');
  const targets=new Map(),ids=[];
  for(const stmt of file.statements){
    if(ts.isFunctionDeclaration(stmt)&&stmt.name&&names.includes(stmt.name.text)){
      const list=targets.get(stmt.name.text)||[];
      list.push(text.slice(stmt.getStart(file),stmt.end));targets.set(stmt.name.text,list);
    }
    if(ts.isVariableStatement(stmt))for(const declaration of stmt.declarationList.declarations){
      if(ts.isIdentifier(declaration.name)&&declaration.name.text==='V2_BUILD_ID'){
        ids.push(declaration.initializer&&ts.isStringLiteral(declaration.initializer)?declaration.initializer.text:null);
      }
    }
  }
  return {targets,id:ids.length===1?ids[0]:null};
}
// The caller must establish the fixed old and historical build provenance;
// matching build IDs or functions alone is not a release authorization.
export function compare54eStatements(ts,oldBytes,historicalBytes,activeBytes){
  const old=inspect(ts,oldBytes),historic=inspect(ts,historicalBytes),active=inspect(ts,activeBytes);
  if(historic.id!==referenceIds.candidate_54e)throw Error('historical_build_id_mismatch');
  const targetMatches=Object.fromEntries(names.map(name=>{
    const a=old.targets.get(name)||[],b=active.targets.get(name)||[];
    return [name,a.length===1&&b.length===1&&a[0]===b[0]];
  }));
  return {
    asset_id_matches_54e:active.id===referenceIds.candidate_54e,
    asset_id_matches_3ed:active.id===referenceIds.candidate_3ed,
    full_historical_bundle_equal:historicalBytes.equals(activeBytes),
    old_target_functions_match:targetMatches,
  };
}
export function summarize54e(ts,oldBytes,historicalBytes,activeBytes){
  if(createHash('sha256').update(oldBytes).digest('hex')!==oldHash)throw Error('unapproved_old_bundle');
  return compare54eStatements(ts,oldBytes,historicalBytes,activeBytes);
}
async function main(){
  let stage='prepare', read=false;
  try{
    const frontend=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
    const ts=frontend('typescript');
    const [old,historical]=await Promise.all([
      readFile(join(process.env.RUNNER_TEMP,'qrs946-bundle-evidence/old/worker.js')),
      readFile(join(process.env.RUNNER_TEMP,'qrs54e-baseline/worker.js')),
    ]);
    let summary;
    stage='get';
    await probe(createReadOnlyRequest(),active=>{read=true;stage='compare';summary=summarize54e(ts,old,historical,active);stage='readback';});
    console.log(JSON.stringify({ok:true,read_only:true,get_verified:true,active_observations_match:true,...summary}));
  }catch{
    console.error(JSON.stringify({ok:false,read_only:true,get_verified:read,stage,reason:'fixed_baseline_diagnostic_failed'}));
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
