#!/usr/bin/env bash
# Build only public #946 source with synthetic assets. No production credentials,
# reads, deploys, or caller-selected sources are accepted.
set -euo pipefail

readonly old=5b526d911ad7eb6344e4be69d740884742681c24
readonly new=9a1744b62d6d547f2d6856dad139c267076e439a
[[ "$(git rev-parse "${new}^" )" == "$old" ]]
git cat-file -e "${old}^{commit}"
git cat-file -e "${new}^{commit}"
readonly temp="$(mktemp -d "${RUNNER_TEMP:?}/qrs946-build.XXXXXXXX")"
readonly evidence="${RUNNER_TEMP}/qrs946-bundle-evidence"
trap 'rm -rf "$temp"' EXIT
mkdir "$evidence"

for side in old new; do
  if [[ "$side" == old ]]; then commit="$old"; else commit="$new"; fi
  mkdir -p "$temp/$side" "$evidence/$side"
  git archive "$commit" | tar -x -C "$temp/$side"
  worker="$temp/$side/web/strategy-switch-console"
  cat > "$worker/v2_asset_map.js" <<'ASSET'
// Synthetic build-only fixture; contains no production assets.
export const V2_BUILD_ID = "0000000000000000000000000000000000000000000000000000000000000000";
export const V2_PAGE_HTML = "<!doctype html><title>synthetic</title>";
export const V2_ASSETS = Object.freeze({});
ASSET
  cat > "$worker/wrangler.evidence.toml" <<'CONFIG'
name = "qrs946-synthetic-evidence"
main = "worker.js"
compatibility_date = "2026-06-08"
workers_dev = false
CONFIG
  (
    cd "$worker"
    unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
    export WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false
    npx --yes wrangler@4.106.0 deploy --dry-run --config wrangler.evidence.toml --outdir "$evidence/$side" > "$temp/wrangler-$side.log" 2>&1
  ) || { printf '%s\n' "synthetic_${side}_build_failed" >&2; exit 1; }
  [[ -s "$evidence/$side/worker.js" && -s "$evidence/$side/worker.js.map" ]]
done

set +e
git diff --no-index --no-ext-diff --text -- "$evidence/old/worker.js" "$evidence/new/worker.js" > "$evidence/bundle.patch"
diff_status=$?
set -e
[[ "$diff_status" == 1 ]]

QRS946_EVIDENCE_DIR="$evidence" node --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root = process.env.QRS946_EVIDENCE_DIR;
const targets = ['application/account_facts/read.js', 'application/console_api/native_daily_returns.js', 'worker.js'];
const result = {};
for (const side of ['old', 'new']) {
  const bundle = await readFile(`${root}/${side}/worker.js`);
  const map = JSON.parse(await readFile(`${root}/${side}/worker.js.map`, 'utf8'));
  if (!Array.isArray(map.sources) || typeof map.mappings !== 'string') throw Error('invalid_source_map');
  result[side] = {
    bundle_bytes: bundle.length,
    bundle_sha256: createHash('sha256').update(bundle).digest('hex'),
    source_map_version: map.version,
    source_count: map.sources.length,
    mappings_present: map.mappings.length > 0,
    target_sources_present: Object.fromEntries(targets.map(target => [target,
      map.sources.some(source => typeof source === 'string' && source.replaceAll('\\', '/').endsWith(target))])),
  };
}
console.log(JSON.stringify({kind:'qrs946_synthetic_bundle_evidence', synthetic_assets:true, production_reads:false, builds:result}));
JS
