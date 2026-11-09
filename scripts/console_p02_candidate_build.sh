#!/usr/bin/env bash
set -euo pipefail
umask 077
readonly source=cabe5a1534e0c992713b084030af313eada758ca
readonly tree=42b404d5755b658deff73100b495ecf26fa3a6b1
readonly blob=5287f259185ed44f3784aa6374cb00412b3c6238
readonly assets_source=dd63b3c8b73b588ce411316d904efd26f2c4f382
readonly assets_tree=c08d5542b032abaa008e882dd97ed2c38b3ad236
readonly assets_blob=a7237657bb6e48c57e947875f629d28bafb5ea27
readonly asset=web/strategy-switch-console/v2_asset_map.js
readonly expected=8e38776bdfb0a665ae87b7bd93146881d8813010461ea3dc9b77e23275e720ea
output="${1:?output directory required}"
[[ "$(git rev-parse "${source}^{tree}")" == "$tree" ]]
[[ "$(git rev-parse "$source:$asset")" == "$blob" ]]
[[ "$(git rev-parse "${assets_source}^{tree}")" == "$assets_tree" ]]
[[ "$(git rev-parse "$assets_source:$asset")" == "$assets_blob" ]]
[[ ! -e "$output" ]]
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$output"
output="$(cd "$output" && pwd)"
git archive "$source" | tar -x -C "$tmp"
git show "$assets_source:$asset" > "$tmp/$asset"
cp "$tmp/web/strategy-switch-console/wrangler.toml.example" "$tmp/web/strategy-switch-console/wrangler.toml"
(
 cd "$tmp/web/strategy-switch-console"
 unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
 export WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false npm_config_update_notifier=false
 npx --offline wrangler@4.106.0 deploy --dry-run --config wrangler.toml --outdir "$output"
)
[[ -s "$output/worker.js" ]]
[[ "$(shasum -a 256 "$output/worker.js" | cut -d' ' -f1)" == "$expected" ]]
