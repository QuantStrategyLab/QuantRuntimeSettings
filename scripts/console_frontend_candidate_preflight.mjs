// Offline evidence for one draft snapshot. This is not release authorization.
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const SNAPSHOT = Object.freeze({
  commit: '0b5d9527313d719547ef844797b47158c83dea53',
  tree: '46b2e2a2cea43d4f03deb70badc0b9a367c58301',
  assetBlob: 'cc3782b3b13233662e0af274567a667db4413a5e',
  buildId: 'd7935e42f5c309421d081abfc8d8183e61758938236ae7d3a028057fdc40bee4',
  bundleSha256: '59b2316fb8153a4266d60baed19ac781c4de503d4850a9898853da2a1949badb',
});
// The complete serving 85504dd6 bundle is the recovery target and retains
// native-task protocol guards.
export const RECOVERY_SNAPSHOT = Object.freeze({
  commit: '85504dd6ee201fd358f6ea3489742ea5c47afcf8',
  tree: 'ce46afc9354beb08ce808593595ca1e08a96a52e',
  assetBlob: 'acb728faf6247535bdc173b0f18c82adeea3485e',
  buildId: '58894b1c9aa1e7627d9985edbbc09e8f6a06f1b8521811032266fc11565c74d5',
  // Current serving module is the fixed recovery target.
  bundleSha256: '44386d5bb3eddf40be110c2503bfbeae5a3cc1b227eaef03a31846e8ea4098af',
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
