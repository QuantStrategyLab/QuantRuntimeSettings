// Prepare protected review files offline. This command never contacts a provider.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,open,readFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {POLICY} from './console_m09_release.mjs';
import {rebuildWithAssets} from './console_p02_baseline_capture.mjs';
import {P02_PREPARE_PINS,prepareRecord} from './console_p02_prepare.mjs';

const asset='web/strategy-switch-console/v2_asset_map.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const require=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();

async function privateRecord(path){
  const file=await open(path,'r');
  try {
    const stat=await file.stat();
    if(!stat.isFile()||(stat.mode&0o077)!==0||stat.uid!==process.getuid()||stat.size>12*1024*1024)throw Error('record');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}

// Injected dependencies permit synthetic tests; the CLI uses the current batch pins.
export async function prepareLocal({recordPath,referencePath,historicalPath,outputPath,controlSha},deps={}){
  if(![recordPath,referencePath,outputPath].every(p=>typeof p==='string'&&isAbsolute(p)))throw Error('path');
  const repo=deps.root??root,output=resolve(outputPath),rel=relative(repo,output);
  if(!rel||(!rel.startsWith('../')&&!isAbsolute(rel)))throw Error('output_location');
  const g=deps.git??git;
  if(!deps.pins&&!/^[a-f0-9]{40}$/.test(controlSha??''))throw Error('control');
  const pins=deps.pins??{...P02_PREPARE_PINS,control:controlSha,controlTree:g('rev-parse',`${controlSha}^{tree}`)};
  const assetsSource=pins.assetsSource??POLICY.source;
  const evidence={source:g('rev-parse',`${POLICY.source}^{commit}`),tree:g('rev-parse',`${POLICY.source}^{tree}`),
    frontendBlob:g('rev-parse',`${assetsSource}:${asset}`),
    ...(pins.assetsSource?{assetsTree:g('rev-parse',`${assetsSource}^{tree}`)}:{})};
  const [record,reference]=await Promise.all([privateRecord(recordPath),readFile(referencePath)]);
  if(reference.length>10*1024*1024)throw Error('bundle');
  let historical;
  if(!Object.values(record.asset_comparison??{}).every(value=>value===true)||Object.keys(record.asset_comparison??{}).length!==3){
    if(!deps.pins||typeof historicalPath!=='string'||!isAbsolute(historicalPath))throw Error('historical');
    historical=await readFile(historicalPath);
    if(historical.length>10*1024*1024||hash(historical)!==pins.historicalBundle)throw Error('bundle');
    evidence.historicalSource=g('rev-parse',`${pins.historical}^{commit}`);
    evidence.historicalBundle=hash(historical);
  }
  const ts=deps.ts??require('typescript');
  const prepared=prepareRecord(record,reference,evidence,ts,pins);
  if(historical&&record.historical_comparison?.status==='match'&&rebuildWithAssets(reference,historical,ts).sha256!==hash(prepared.candidate))
    throw Error('historical_mismatch');
  await mkdir(output,{mode:0o700});
  for(const [name,content] of [['candidate.js',prepared.candidate],['review.json',JSON.stringify({hold:true,policy:prepared.policy})]]){
    const handle=await open(resolve(output,name),'wx',0o600);
    try {await handle.writeFile(content);await handle.sync();} finally {await handle.close();}
  }
  return {ok:true,hold:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    if(process.argv.length!==6)throw Error('arguments');
    const [recordPath,referencePath,controlSha,outputPath]=process.argv.slice(2);
    console.log(JSON.stringify(await prepareLocal({recordPath,referencePath,controlSha,outputPath})));
  } catch {console.error('{"ok":false,"hold":true}');process.exitCode=1;}
}
