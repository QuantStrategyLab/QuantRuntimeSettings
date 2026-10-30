#!/usr/bin/env bash
# Build a fixed draft candidate offline. Never calls the Cloudflare API.
set -euo pipefail
umask 077
readonly source_dir="${1:?candidate checkout required}"
readonly verifier="$(cd "$(dirname "$0")" && pwd)/console_frontend_candidate_preflight.mjs"
readonly result="${RUNNER_TEMP:?}/console-frontend-candidate"
readonly repeat="${RUNNER_TEMP}/console-frontend-candidate-repeat"
cd "$source_dir"
[[ "$(git rev-parse HEAD)" == 9e508c71ba46a9670cda32288f0b62f1781d5c54 ]]
[[ "$(git rev-parse 'HEAD^{tree}')" == ea2f7d8c6166136e19096968f44acaabfaa5c533 ]]
[[ -z "$(git status --porcelain)" ]]
readonly asset=web/strategy-switch-console/v2_asset_map.js
[[ "$(git hash-object "$asset")" == b7ba0b6b81a02452ba130f8e40712ef412d0595c ]]
[[ ! -e "$result" && ! -e "$repeat" ]]
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
export WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false npm_config_update_notifier=false
npm ci --prefix web/strategy-switch-console
npm ci --prefix web/strategy-switch-console/frontend
node tests/console_v2_assets_validation.mjs
npm run build --prefix web/strategy-switch-console/frontend
npm run sync:v2-assets --prefix web/strategy-switch-console/frontend
[[ "$(git hash-object "$asset")" == b7ba0b6b81a02452ba130f8e40712ef412d0595c ]]
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
node "$verifier" "$(git rev-parse HEAD)" "$(git rev-parse 'HEAD^{tree}')" "$(git hash-object "$asset")" "$asset" "$result/worker.js" "$repeat/worker.js"
