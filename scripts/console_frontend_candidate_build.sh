#!/usr/bin/env bash
# Build a fixed frontend or compatible main candidate offline.
# Neither mode calls the Cloudflare API or changes a checked-out source file.
set -euo pipefail
umask 077
readonly source_dir="${1:?candidate checkout required}"
readonly verifier="$(cd "$(dirname "$0")" && pwd)/console_frontend_candidate_preflight.mjs"
readonly mode="${2:-frontend}"
case "$mode" in
 frontend)
  expected_commit=8a161555c697c0440dacf5a9d526fae2f826bb5b
  expected_tree=22270ec273d9b9781c9470bb6f627c44c6759f2c
  expected_asset=64244efac3c08e58f68fb6f1b71cca6e8c048af3
  output_name=console-frontend-candidate
  verifier_flag=""
  ;;
 recovery-main)
  expected_commit=41f520594869ff47a4f781b0d929fc6b178eca23
  expected_tree=23f3774b3e244761d587224aad87e7ee82d76386
  expected_asset=64244efac3c08e58f68fb6f1b71cca6e8c048af3
  output_name=console-recovery-candidate
  verifier_flag="--recovery"
  ;;
 *) exit 2 ;;
esac
readonly expected_commit expected_tree expected_asset output_name
readonly result="${RUNNER_TEMP:?}/${output_name}"
readonly repeat="${RUNNER_TEMP}/${output_name}-repeat"
readonly evidence="${RUNNER_TEMP}/${output_name}-evidence.json"
cd "$source_dir"
[[ "$(git rev-parse HEAD)" == "$expected_commit" ]]
[[ "$(git rev-parse 'HEAD^{tree}')" == "$expected_tree" ]]
[[ -z "$(git status --porcelain)" ]]
readonly asset=web/strategy-switch-console/v2_asset_map.js
[[ "$(git hash-object "$asset")" == "$expected_asset" ]]
[[ ! -e "$result" && ! -e "$repeat" && ! -e "$evidence" ]]
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
export WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false npm_config_update_notifier=false
npm ci --prefix web/strategy-switch-console
npm ci --prefix web/strategy-switch-console/frontend
node tests/console_v2_assets_validation.mjs
npm run build --prefix web/strategy-switch-console/frontend
npm run sync:v2-assets --prefix web/strategy-switch-console/frontend
[[ "$(git hash-object "$asset")" == "$expected_asset" ]]
node tests/console_v2_assets_validation.mjs
git diff --exit-code
python3 python/scripts/build_platform_config.py --check
cp web/strategy-switch-console/wrangler.toml.example web/strategy-switch-console/wrangler.toml
(
 cd web/strategy-switch-console
 npx --yes wrangler@4.106.0 deploy --dry-run --config wrangler.toml --outdir "$result"
 npx --yes wrangler@4.106.0 deploy --dry-run --config wrangler.toml --outdir "$repeat"
)
[[ -s "$result/worker.js" && -s "$repeat/worker.js" ]]
if [[ -n "$verifier_flag" ]]; then
  node "$verifier" "$verifier_flag" "$(git rev-parse HEAD)" "$(git rev-parse 'HEAD^{tree}')" "$(git hash-object "$asset")" "$asset" "$result/worker.js" "$repeat/worker.js" | tee "$evidence"
else
  node "$verifier" "$(git rev-parse HEAD)" "$(git rev-parse 'HEAD^{tree}')" "$(git hash-object "$asset")" "$asset" "$result/worker.js" "$repeat/worker.js" | tee "$evidence"
fi
node --input-type=module - "$verifier" "$evidence" "$mode" <<'JS'
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const [verifier, evidence, mode] = process.argv.slice(2);
const snapshots = await import(pathToFileURL(verifier));
const expected = mode === 'frontend' ? snapshots.SNAPSHOT.bundleSha256 : snapshots.RECOVERY_SNAPSHOT.bundleSha256;
if (JSON.parse(await readFile(evidence, 'utf8')).bundle_sha256 !== expected) throw Error('bundle_identity_mismatch');
JS
