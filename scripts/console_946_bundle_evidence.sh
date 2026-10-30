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
git diff --no-index --no-ext-diff --no-color --text -- "$evidence/old/worker.js" "$evidence/new/worker.js" > "$evidence/bundle.patch"
diff_status=$?
set -e
[[ "$diff_status" == 1 ]]

QRS946_EVIDENCE_DIR="$evidence" node --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(`${process.cwd()}/web/strategy-switch-console/package.json`);
const {TraceMap, decodedMappings} = require('@jridgewell/trace-mapping');
const root = process.env.QRS946_EVIDENCE_DIR;
const targets = ['application/account_facts/read.js', 'application/console_api/native_daily_returns.js', 'worker.js'];
const result = {};
for (const side of ['old', 'new']) {
  const bundle = await readFile(`${root}/${side}/worker.js`);
  const mapBytes = await readFile(`${root}/${side}/worker.js.map`);
  if (bundle.length > 10 * 1024 * 1024 || mapBytes.length > 32 * 1024 * 1024) throw Error('synthetic_output_too_large');
  const map = JSON.parse(mapBytes.toString('utf8'));
  if (map.version !== 3 || !Array.isArray(map.sources) || map.sources.length > 10000 || typeof map.mappings !== 'string') throw Error('invalid_source_map');
  const lines = bundle.toString('utf8').split('\n');
  const mappings = decodedMappings(new TraceMap(map));
  if (mappings.length > 1000000 || lines.length > 1000000) throw Error('synthetic_output_too_many_lines');
  const module_spans = Object.fromEntries(targets.map(target => {
    const indexes = new Set(map.sources.map((source, i) => typeof source === 'string' && source.replaceAll('\\', '/').endsWith(target) ? i : -1).filter(i => i >= 0));
    let first = null, last = null, segments = 0;
    for (let line = 0; line < mappings.length; line++) {
      for (const segment of mappings[line]) if (segment.length >= 4 && indexes.has(segment[1])) {
        if (first === null) first = line + 1;
        last = line + 1;
        segments++;
      }
    }
    return [target, {source_matches:indexes.size, first_mapped_line:first, last_mapped_line:last, mapped_segments:segments}];
  }));
  const names = ['accountFactsHistoryResponse', 'applyNativeDailyReturns', 'loadAccountFactsBindings', 'hasGap', 'navAmountSum', 'nativeBenchmarks', 'performanceBlocks', 'dateMs', 'sliceRange', 'rangeStart'];
  const declarations = Object.fromEntries(names.map(name => [name, []]));
  const declarationsPattern = /^\s*(?:async\s+)?function\s+(accountFactsHistoryResponse(?:Impl)?|applyNativeDailyReturns|loadAccountFactsBindings|hasGap|navAmountSum|nativeBenchmarks|performanceBlocks|dateMs|sliceRange|rangeStart)(\d*)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const match = declarationsPattern.exec(lines[i]);
    if (match) {
      const key = match[1].replace(/Impl$/, '');
      if (declarations[key].length >= 32) throw Error('too_many_target_declarations');
      declarations[key].push({name:match[1] + match[2], line:i + 1});
    }
  }
  result[side] = {
    bundle_bytes: bundle.length,
    bundle_sha256: createHash('sha256').update(bundle).digest('hex'),
    source_map_version: map.version,
    source_count: map.sources.length,
    mappings_present: map.mappings.length > 0,
    module_spans,
    target_function_declarations: declarations,
    target_sources_present: Object.fromEntries(targets.map(target => [target,
      map.sources.some(source => typeof source === 'string' && source.replaceAll('\\', '/').endsWith(target))])),
  };
}
const summary = JSON.stringify({kind:'qrs946_synthetic_bundle_evidence', synthetic_assets:true, production_reads:false, builds:result});
if (Buffer.byteLength(summary) > 16384) throw Error('summary_too_large');
console.log(summary);
JS

# Production read-only verification consumes only these fixed synthetic files;
# do not print source text or upload any artifact in that execution.
if [[ "${QRS946_QUIET:-false}" == true ]]; then
  printf '%s\n' '{"kind":"qrs946_synthetic_diff","status":"suppressed"}'
  exit 0
fi

# The fixed-commit diff is public source plus the synthetic fixture. Stop GitHub
# workflow-command processing while printing it, and refuse oversized output.
patch_size=$(wc -c < "$evidence/bundle.patch")
if (( patch_size > 65536 )); then
  printf '{"kind":"qrs946_synthetic_diff","status":"too_large","bytes":%s}\n' "$patch_size" >&2
  exit 1
fi
printf '{"kind":"qrs946_synthetic_diff","status":"begin","bytes":%s}\n' "$patch_size"
command_token=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
printf '::stop-commands::%s\n' "$command_token"
cat "$evidence/bundle.patch"
printf '\n::%s::\n' "$command_token"
printf '%s\n' '{"kind":"qrs946_synthetic_diff","status":"end"}'
