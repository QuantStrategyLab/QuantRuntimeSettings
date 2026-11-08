#!/usr/bin/env bash
# Build the fixed backend tree with the unchanged, previously verified recovery assets.
set -euo pipefail
umask 077
readonly tree=42b404d5755b658deff73100b495ecf26fa3a6b1
readonly baseline=e6bd32af8471eaa8e5968134b6eb60a2c6da66db
readonly recovery=85504dd6ee201fd358f6ea3489742ea5c47afcf8
readonly recovery_asset=acb728faf6247535bdc173b0f18c82adeea3485e
readonly asset=web/strategy-switch-console/v2_asset_map.js
output="${1:?output directory required}"
source="${2:-$tree}"
[[ "$(git rev-parse "${source}^{tree}")" == "$tree" ]]
[[ ! -e "$output" ]]
[[ "$(git rev-parse "$tree:$asset")" == "$(git rev-parse "$baseline:$asset")" ]]
[[ "$(git rev-parse "$recovery:$asset")" == "$recovery_asset" ]]
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$output"
output="$(cd "$output" && pwd)"
git archive "$source" | tar -x -C "$tmp"
git cat-file blob "$recovery_asset" > "$tmp/$asset"
cp "$tmp/web/strategy-switch-console/wrangler.toml.example" "$tmp/web/strategy-switch-console/wrangler.toml"
(
 cd "$tmp/web/strategy-switch-console"
 unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
 export WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false npm_config_update_notifier=false
 npx --offline wrangler@4.106.0 deploy --dry-run --config wrangler.toml --outdir "$output"
)
[[ -s "$output/worker.js" && -s "$output/worker.js.map" ]]
shasum -a 256 "$output/worker.js"
