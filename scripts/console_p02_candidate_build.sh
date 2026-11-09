#!/usr/bin/env bash
set -euo pipefail
umask 077
readonly source=cabe5a1534e0c992713b084030af313eada758ca
readonly tree=42b404d5755b658deff73100b495ecf26fa3a6b1
readonly blob=5287f259185ed44f3784aa6374cb00412b3c6238
readonly asset=web/strategy-switch-console/v2_asset_map.js
readonly expected=912ad8b3efb9080b96112750146bdf050b6eefed6fae822b57dfa57e99feb57a
output="${1:?output directory required}"
[[ "$(git rev-parse "${source}^{tree}")" == "$tree" ]]
[[ "$(git rev-parse "$source:$asset")" == "$blob" ]]
[[ "$(git rev-parse "084ba4281cfff3304cf226ce511a2fc0a6b67b08:$asset")" == "$blob" ]]
[[ ! -e "$output" ]]
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$output"
output="$(cd "$output" && pwd)"
git archive "$source" | tar -x -C "$tmp"
cp "$tmp/web/strategy-switch-console/wrangler.toml.example" "$tmp/web/strategy-switch-console/wrangler.toml"
(
 cd "$tmp/web/strategy-switch-console"
 unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
 export WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false npm_config_update_notifier=false
 npx --offline wrangler@4.106.0 deploy --dry-run --config wrangler.toml --outdir "$output"
)
[[ -s "$output/worker.js" ]]
[[ "$(shasum -a 256 "$output/worker.js" | cut -d' ' -f1)" == "$expected" ]]
