#!/usr/bin/env bash
# Rebuild one fixed public historical release source. No provider credentials,
# production input, custom refs, commands or URLs are accepted.
set -euo pipefail
umask 077
readonly source_sha=54e146fcef01fecc6c7ec2d4cfd858b9946679eb
readonly tree_sha=2d56d262d5d3d9675eb4c5318cf5af6ad192658d
readonly asset_blob=5ece59e56b5c9a6499a3ef4e36933120e4747b6e
[[ "$(git rev-parse "${source_sha}^{tree}")" == "$tree_sha" ]]
[[ "$(git rev-parse "${source_sha}:web/strategy-switch-console/v2_asset_map.js")" == "$asset_blob" ]]
readonly temp="$(mktemp -d "${RUNNER_TEMP:?}/qrs54e-source.XXXXXXXX")"
readonly result="${RUNNER_TEMP}/qrs54e-baseline"
trap 'rm -rf "$temp"' EXIT
mkdir "$result"
git archive "$source_sha" | tar -x -C "$temp"
python3 - "$temp/web/strategy-switch-console/v2_asset_map.js" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
values = re.findall(r'^export const V2_BUILD_ID = "([a-f0-9]{64})";$', text, re.M)
if values != ['e41825b42571c49ab41a2536c32675d18b6b32763c7de83484ce1e204cc63bce']:
    raise SystemExit('fixed_asset_build_id_mismatch')
PY
(
  cd "$temp"
  python3 python/scripts/build_platform_config.py --check > "$temp/projections.log" 2>&1
) || { printf '%s\n' 'fixed_projection_check_failed' >&2; exit 1; }
worker="$temp/web/strategy-switch-console"
cp "$worker/wrangler.toml.example" "$worker/wrangler.toml"
(
  cd "$worker"
  unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
  export WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false
  npx --yes wrangler@4.106.0 deploy --dry-run --config wrangler.toml --outdir "$result" > "$temp/wrangler.log" 2>&1
) || { printf '%s\n' 'fixed_historical_build_failed' >&2; exit 1; }
[[ -s "$result/worker.js" && -s "$result/worker.js.map" ]]
printf '%s\n' '{"fixed_54e_build_complete":true,"production_reads":false}'
