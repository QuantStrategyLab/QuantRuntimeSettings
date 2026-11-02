#!/usr/bin/env bash
# Fixed repository rebuild only; no Cloudflare credentials or API access.
set -euo pipefail
umask 077
readonly scripts="$(cd "$(dirname "$0")" && pwd)"
cd "$scripts/.."
readonly source_sha=9b695a4ade90bcc9931f53109e0ad33f63407927
[[ "$(git rev-parse "${source_sha}^{tree}")" == 4838ce604b01f6ba94a2880809d87562fab40b43 ]]
[[ "$(node --version)" == v22.23.4 && "$(npm --version)" == 10.9.9 ]]
[[ "$(sha256sum "$scripts/console_946_reviewed_main.wrangler.json" | cut -d' ' -f1)" == ca64496a2ed4ff8d022841e073915fc2a1e2f83fc06243431a8104fcb7db1c16 ]]
readonly source_dir="$(mktemp -d "${RUNNER_TEMP:?}/qrs-reviewed-main-source.XXXXXXXX")"
readonly result="$RUNNER_TEMP/qrs-reviewed-main"
readonly repeat="$RUNNER_TEMP/qrs-reviewed-main-repeat"
mkdir "$result" "$repeat"
git archive "$source_sha" | tar -x -C "$source_dir"
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
export WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false npm_config_update_notifier=false
readonly worker="$source_dir/web/strategy-switch-console"
cp "$scripts/console_946_reviewed_main.wrangler.json" "$worker/wrangler.json"
(
  cd "$source_dir"
  npm ci --prefix web/strategy-switch-console
  npm ci --prefix web/strategy-switch-console/frontend
  npm run build --prefix web/strategy-switch-console/frontend
  npm run sync:v2-assets --prefix web/strategy-switch-console/frontend
  node tests/console_v2_assets_validation.mjs
  cd "$worker"
  npx --yes wrangler@4.106.0 deploy --dry-run --config wrangler.json --outdir "$result"
  npx --yes wrangler@4.106.0 deploy --dry-run --config wrangler.json --outdir "$repeat"
) > "$source_dir/build.log" 2>&1 || { printf '%s\n' 'reviewed_main_build_failed' >&2; exit 1; }
cmp "$result/worker.js" "$repeat/worker.js"
sha256sum "$result/worker.js"
node --input-type=module - "$scripts/console_946_reviewed_main_baseline.mjs" "$result/worker.js" <<'JS'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const {REVIEWED_MAIN}=await import(pathToFileURL(process.argv[2]));
const bytes=await readFile(process.argv[3]);
if(createHash('sha256').update(bytes).digest('hex')!==REVIEWED_MAIN.moduleSha256)
  throw Error('reviewed_main_build_hash_mismatch');
console.log(JSON.stringify({repository_build_verified:true,production_reads:false,live_hash_verification:'PENDING'}));
JS
