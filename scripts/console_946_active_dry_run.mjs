// Fixed read-only #946 verifier. Never write the active module or the final
// candidate. The isolated runtime receives only a 0600 test-instrumented copy.
import {createRequire} from 'node:module';
import {createReadOnlyRequest,probe} from './console_active_module_probe.mjs';
import {verify946OnFixed54e} from './console_946_54e_patch.mjs';

const allowedReasons=new Set([
  'configuration_invalid','active_schema_invalid','active_not_single','active_module_schema',
  'unsupported_module_name','unsupported_module_type','encoding_invalid','module_too_large',
  'observation_changed','http_error','transport_invalid','response_too_large','response_length_mismatch',
  'json_invalid','envelope_invalid','invalid_bundle','unapproved_synthetic_bundles','bundle_parse_failed',
  'duplicate_target','duplicate_asset','required_statement_missing','asset_shape_invalid','invalid_source_map',
  'source_map_target_mismatch','active_dependency_or_wiring_mismatch','active_target_mismatch',
  'active_target_offset_mismatch','empty_patch_region','nonunique_patch_region','overlapping_regions',
  'missing_reviewed_change','synthetic_diff_not_exact','reverse_mismatch','candidate_layout_mismatch',
  'candidate_target_mismatch','candidate_target_offset_mismatch',
  'active_54e_bytes_mismatch','active_54e_statements_mismatch','historical_build_id_mismatch','helper_shape_invalid','helper_declaration_mismatch','fixed_builds_missing',
]);
const allowedTypes=new Set(['FunctionDeclaration','VariableStatement','ExpressionStatement','ImportDeclaration','ExportDeclaration','other','missing']);
let stage='prepare',getVerified=false;
try {
  const req=createRequire(new URL('../web/strategy-switch-console/package.json',import.meta.url));
  const frontendReq=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
  const ts=frontendReq('typescript'), trace=req('@jridgewell/trace-mapping');
  const request=createReadOnlyRequest();
  stage='get';
  await probe(request,async active=>{
    getVerified=true;
    stage='patch';
    const candidate=await verify946OnFixed54e(ts,trace,active);
    // The request closure already holds the token. Remove it from the process
    // environment before starting workerd so child processes do not inherit it.
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    stage='runtime';
    const {testCandidate946}=await import('./console_946_runtime_test.mjs');
    await testCandidate946(candidate);
    stage='readback';
  });
  console.log(JSON.stringify({ok:true,read_only:true,get_verified:true,active_observations_match:true,patch_ready:true,
    candidate_runtime_passed:true,instrumentation:'fixed_test_copy_only',upload_attempted:false}));
} catch(error) {
  const reason=stage==='runtime' ? 'runtime_regression_failed'
    : allowedReasons.has(error?.message) ? error.message : 'request_or_verification_failed';
  const count=Number.isSafeInteger(error?.mismatch_count) && error.mismatch_count>=0 && error.mismatch_count<=1000000 ? error.mismatch_count : null;
  const types=Array.isArray(error?.statement_types)
    ? [...new Set(error.statement_types.filter(x=>allowedTypes.has(x)))].slice(0,8) : [];
  console.error(JSON.stringify({ok:false,read_only:true,get_verified:getVerified,patch_ready:false,stage,reason,
    mismatch_count:count,statement_types:types,upload_attempted:false}));
  process.exitCode=1;
}
