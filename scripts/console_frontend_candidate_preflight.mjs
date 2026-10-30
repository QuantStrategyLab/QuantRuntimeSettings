// Offline evidence for one draft snapshot. This is not release authorization.
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const SNAPSHOT = Object.freeze({
  commit: '41f520594869ff47a4f781b0d929fc6b178eca23',
  tree: '23f3774b3e244761d587224aad87e7ee82d76386',
  assetBlob: '64244efac3c08e58f68fb6f1b71cca6e8c048af3',
  buildId: 'cf98320626f10c39cc2e3895be060ec7f00d2b52ed11911e1b1410bc0277d698',
  bundleSha256: 'f8a9b2598fcac89b5c7dc4d9bd8b6417a75126744c5e53c30f7d35bf8555fd15',
});
// The complete #965 bundle was verified as the active module and retains
// native-task protocol guards; it is the recovery target for this candidate.
export const RECOVERY_SNAPSHOT = Object.freeze({
  commit: '9e508c71ba46a9670cda32288f0b62f1781d5c54',
  tree: 'ea2f7d8c6166136e19096968f44acaabfaa5c533',
  assetBlob: 'b7ba0b6b81a02452ba130f8e40712ef412d0595c',
  buildId: '07f15f86fb22185aa8eaff7d4e918504071d69e056598c85bd6acc002ac605ef',
  // Active module verified by read-only preflight run 41113341052.
  bundleSha256: 'afe13eefe12d0e4f4db0f1bcfc515a2d3445963fd8f42ef8e5286c4062b6027d',
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
