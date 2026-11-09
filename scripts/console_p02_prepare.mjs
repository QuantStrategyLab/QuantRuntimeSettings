// Offline preparation only. The result does not authorize an upload.
import {createHash} from 'node:crypto';
import {rebuildWithAssets, HISTORICAL_SOURCE, HISTORICAL, R2_ACTIVE_MODULE} from './console_p02_baseline_capture.mjs';
import {POLICY} from './console_m09_release.mjs';

const digest=x=>createHash('sha256').update(x).digest('hex');
const hex=(x,n)=>typeof x==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
const names=['V2_BUILD_ID','V2_PAGE_HTML','V2_ASSETS'];
export const P02_PREPARE_PINS=Object.freeze({reference:R2_ACTIVE_MODULE,
  active:R2_ACTIVE_MODULE,
  assetsSource:'dd63b3c8b73b588ce411316d904efd26f2c4f382',
  assetsTree:'c08d5542b032abaa008e882dd97ed2c38b3ad236',
  referenceFrontendBlob:'a7237657bb6e48c57e947875f629d28bafb5ea27',
  historical:HISTORICAL_SOURCE,historicalBundle:HISTORICAL});

// The caller must obtain the protected record through its authorized channel.
// Dependency injection exists for offline fixtures, not as a production policy override.
export function prepareRecord(record,reference,evidence,ts,pins=P02_PREPARE_PINS){
  if(record?.schema!=='qrs-worker-p02-baseline-v1'||!hex(pins.control,40)||record.control_sha!==pins.control||
    (pins.controlTree!==undefined&&(!hex(pins.controlTree,40)||record.control_tree!==pins.controlTree))||
    (pins.active!==undefined&&record.active_module_sha256!==pins.active)||
    record.reference_module_sha256!==pins.reference||!Buffer.isBuffer(reference)||digest(reference)!==pins.reference||
    !uuid(record.version)||!uuid(record.deployment)||
    !['active_module_sha256','configuration_sha256','migration_tag_sha256'].every(k=>hex(record[k],64))||
    evidence?.source!==POLICY.source||evidence?.tree!==POLICY.tree||evidence?.frontendBlob!==pins.referenceFrontendBlob||
    (pins.assetsTree!==undefined&&evidence.assetsTree!==pins.assetsTree))
    throw Error('baseline_invalid');
  const comparison=record.asset_comparison;
  if(!comparison||Object.keys(comparison).length!==names.length||!names.every(n=>typeof comparison[n]==='boolean'))
    throw Error('baseline_invalid');
  let candidate=reference;
  if(names.every(n=>comparison[n])) {
    if(record.release_state!=='hold'||record.asset_declarations!==undefined)throw Error('baseline_invalid');
  } else {
    const declarations=record.asset_declarations;
    if(record.release_state!=='hold_review_required'||record.historical_comparison?.status!=='match'||
      record.historical_comparison.source!==pins.historical||evidence.historicalSource!==pins.historical||
      evidence.historicalBundle!==pins.historicalBundle||!declarations||Object.keys(declarations).length!==names.length||
      !names.every(n=>typeof declarations[n]==='string')||!hex(record.rebuilt_module_sha256,64))throw Error('baseline_invalid');
    const rebuilt=rebuildWithAssets(reference,Buffer.from(names.map(n=>declarations[n]).join('\n')),ts);
    if(rebuilt.sha256!==record.rebuilt_module_sha256)throw Error('candidate_mismatch');
    candidate=rebuilt.bytes;
  }
  return {hold:true,candidate,policy:{source:evidence.source,tree:evidence.tree,frontendBlob:evidence.frontendBlob,
    before:record.active_module_sha256,candidate:digest(candidate),version:record.version,deployment:record.deployment,rollback:record.version,
    configuration_sha256:record.configuration_sha256,migration_tag_sha256:record.migration_tag_sha256}};
}
