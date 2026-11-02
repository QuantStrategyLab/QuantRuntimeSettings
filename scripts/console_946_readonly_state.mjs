// Pure byte classification for the read-only #946 preflight. The caller must
// first construct `candidate` with the fixed 54e verifier in the same job.
import {createHash} from 'node:crypto';
import {REVIEWED_MAIN} from './console_946_reviewed_main_baseline.mjs';
export function classify946Readonly(active, reference, candidate) {
  if (![active, reference, candidate].every(Buffer.isBuffer)
    || !reference.length || !candidate.length || reference.equals(candidate)) {
    throw Error('readonly_baseline_invalid');
  }
  if (active.equals(reference)) return {patch_ready:true,already_applied:false};
  if (active.equals(candidate)) return {patch_ready:false,already_applied:true};
  if (createHash('sha256').update(active).digest('hex')===REVIEWED_MAIN.moduleSha256)
    return {patch_ready:false,already_applied:null,reviewed_main:true,baseline_commit:REVIEWED_MAIN.commit};
  throw Error('active_54e_bytes_mismatch');
}
