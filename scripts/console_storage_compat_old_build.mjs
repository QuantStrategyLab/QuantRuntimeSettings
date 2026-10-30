// Reconstruct the exact previously qualified production candidate offline.
// The prerequisite fixed 54e and 946 evidence builders run in the same job.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verify946OnFixed54e } from './console_946_54e_patch.mjs';
import { buildFreezeCandidate, assertFrozenPolicySource } from './console_958_freeze_candidate.mjs';
import { DEFAULT_STRATEGY_PROFILES } from '../web/strategy-switch-console/strategy_profiles_asset.js';

const root = process.env.RUNNER_TEMP;
if (!root) throw Error('RUNNER_TEMP is required');
const reqWorker = createRequire(new URL('../web/strategy-switch-console/package.json', import.meta.url));
const reqFrontend = createRequire(new URL('../web/strategy-switch-console/frontend/package.json', import.meta.url));
const ts = reqFrontend('typescript'), trace = reqWorker('@jridgewell/trace-mapping');
const baseline = await readFile(join(root, 'qrs54e-baseline/worker.js'));
const fixed946 = await verify946OnFixed54e(ts, trace, baseline);
assertFrozenPolicySource(DEFAULT_STRATEGY_PROFILES);
const { candidate, report } = buildFreezeCandidate(ts, baseline, fixed946);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
if (digest(fixed946) !== 'bed839bd226613cca4fa9508b8a75b4a3b54c9ab5f8326f28dfedb59bcf8d213'
    || report.active_code_sha256 !== digest(fixed946)
    || report.two_insertions_sha256 !== '207d258c7c09c36b3d20eeba61b947e282c92b0cf36f6881f67c8beedfde2510'
    || report.candidate_code_sha256 !== '7b64da8edd2627175019e5c529f9eec048732ffb7acec502cdf4122fc0dbb06a'
    || digest(candidate) !== report.candidate_code_sha256) throw Error('fixed_old_candidate_identity_mismatch');
const dir = join(root, 'qrs-storage-compat');
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'old-worker.js'), candidate, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ fixed_old_candidate_sha256: digest(candidate), production_reads: false }));
