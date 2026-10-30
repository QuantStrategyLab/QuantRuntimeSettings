// Offline evidence for one draft snapshot. This is not release authorization.
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const SNAPSHOT = Object.freeze({
  commit: '9e508c71ba46a9670cda32288f0b62f1781d5c54',
  tree: 'ea2f7d8c6166136e19096968f44acaabfaa5c533',
  assetBlob: 'b7ba0b6b81a02452ba130f8e40712ef412d0595c',
  buildId: '07f15f86fb22185aa8eaff7d4e918504071d69e056598c85bd6acc002ac605ef',
});
// This full main build is an undeployed recovery candidate, not the previously
// serving production module. Its backend retains native-task protocol guards.
export const RECOVERY_SNAPSHOT = Object.freeze({
  commit: 'acf56083568b795f3a86ef40588fcc726333a88b',
  tree: 'c6e6ef4fec8df52480592591c84e5e7def8ff03e',
  assetBlob: 'ac2278a21a5a1580d11587e4025a30c6a9363984',
  buildId: '967e99835ed0874c008ae65ebadd7bb2c1b59e806ccdf962149c0061f5bb6f1f',
  // Independently observed in Node 22 run 41054733871, job 124059290421.
  bundleSha256: '61ba684d100a090bd54a50f56c45b420a969fba67b7289b1396321e5410c8162',
});
export const verifyEvidence = evidence => verifySnapshot(SNAPSHOT, evidence);
export function verifyRecoveryEvidence(evidence) {
  const result = verifySnapshot(RECOVERY_SNAPSHOT, evidence);
  if (result.bundle_sha256 !== RECOVERY_SNAPSHOT.bundleSha256) throw Error('recovery_bundle_identity_mismatch');
  return result;
}
function verifySnapshot(snapshot, {commit, tree, assetBlob, asset, firstBundle, secondBundle, firstEntries, secondEntries}) {
  if (commit !== snapshot.commit || tree !== snapshot.tree || assetBlob !== snapshot.assetBlob) throw Error('snapshot_identity_mismatch');
  const ids = [...asset.matchAll(/^export const V2_BUILD_ID = "([a-f0-9]{64})";$/gm)].map(m => m[1]);
  if (ids.length !== 1 || ids[0] !== snapshot.buildId) throw Error('asset_build_id_mismatch');
  if (!Buffer.isBuffer(firstBundle) || !firstBundle.length || !Buffer.isBuffer(secondBundle) || !firstBundle.equals(secondBundle)) throw Error('bundle_reproducibility_mismatch');
  const bundleText = new TextDecoder('utf-8', {fatal:true}).decode(firstBundle);
  const bundledIds = [...bundleText.matchAll(/^\s*var\s+V2_BUILD_ID\s*=\s*([^;\r\n]*);/gm)].map(m => m[1]);
  if (bundledIds.length !== 1 || bundledIds[0] !== `"${snapshot.buildId}"`) throw Error('bundle_build_id_mismatch');
  for (const entries of [firstEntries, secondEntries]) {
    if (!Array.isArray(entries) || entries.some(e => !e.isFile || !['worker.js','worker.js.map','README.md'].includes(e.name))
      || new Set(entries.map(e => e.name)).size !== entries.length
      || !entries.some(e => e.name === 'worker.js') || !entries.some(e => e.name === 'worker.js.map')) throw Error('bundle_output_unexpected');
  }
  return {snapshot_verified: true, snapshot_commit: snapshot.commit, asset_build_id_verified: true, bundle_sha256: createHash('sha256').update(firstBundle).digest('hex'),
    bundle_reproduced: true, production_read: false, release_approved: false};
}
async function main() {
  const args = process.argv.slice(2);
  const verifier = args[0] === '--recovery' ? (args.shift(), verifyRecoveryEvidence) : verifyEvidence;
  if (args.length !== 6) throw Error('invalid_arguments');
  const [commit, tree, assetBlob, assetPath, firstPath, secondPath] = args;
  const [asset, firstBundle, secondBundle] = await Promise.all([readFile(assetPath, 'utf8'), readFile(firstPath), readFile(secondPath)]);
  const entries = async path => (await readdir(new URL('.', pathToFileURL(path)), {withFileTypes:true})).map(e => ({name:e.name, isFile:e.isFile()}));
  const [firstEntries, secondEntries] = await Promise.all([entries(firstPath), entries(secondPath)]);
  console.log(JSON.stringify(verifier({commit, tree, assetBlob, asset, firstBundle, secondBundle, firstEntries, secondEntries})));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { console.error(JSON.stringify({ok:false, reason: ['invalid_arguments','snapshot_identity_mismatch','asset_build_id_mismatch','bundle_reproducibility_mismatch','bundle_build_id_mismatch','bundle_output_unexpected','recovery_bundle_identity_mismatch'].includes(error.message) ? error.message : 'evidence_read_failed', production_read:false, release_approved:false})); process.exitCode=1; }
}
