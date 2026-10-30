import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {summarize54e} from '../scripts/console_54e_baseline_report.mjs';
const require=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
const ts=require('typescript');
const [old,historical]=await Promise.all([
  readFile(join(process.env.RUNNER_TEMP,'qrs946-bundle-evidence/old/worker.js')),
  readFile(join(process.env.RUNNER_TEMP,'qrs54e-baseline/worker.js')),
]);
const same=summarize54e(ts,old,historical,historical);
assert.equal(same.full_historical_bundle_equal,true);
assert.equal(same.asset_id_matches_54e,true);
assert.equal(same.asset_id_matches_3ed,false);
const tail=Buffer.concat([historical,Buffer.from('\n//# sourceMappingURL=synthetic-test-only.map\n')]);
const withDifferentTail=summarize54e(ts,old,historical,tail);
assert.equal(withDifferentTail.full_historical_bundle_equal,false,'trailing sourcemap text participates in exact bytes');
assert.deepEqual(withDifferentTail.old_target_functions_match,same.old_target_functions_match);
console.log(JSON.stringify({ok:true,public_54e_build:true,real_typescript:true,source_map_tail_compared:true,
  old_target_functions_match:same.old_target_functions_match}));
