# Offline RuntimeControl preview

The renderer is default OFF. It reads explicit local public JSON files only
when `--preview-enabled` is passed, prints a preview to stdout and writes no
files. It has no cloud, broker, workflow, deployment or console integration.

```bash
# OFF: no input is opened, no output is emitted.
python3 python/scripts/render_runtime_control_preview.py

# ON: synthetic reference files only; produces a no-order preview.
python3 python/scripts/render_runtime_control_preview.py \
  --preview-enabled \
  --control-file examples/runtime_controls/example-paper.example.json \
  --risk-policy-file examples/risk_policies/soxl_soxx_trend_income/soxl-runtime-risk-20260917.example.json
```

The API `render_preview(control, policy, preview_enabled=False)` likewise returns
`None` without inspecting inputs by default. This opt-in flag affects this
preview alone. It does not enable Option D or any runtime target.

Enabled, live, broker-paper and options-enabled controls are rejected. The
target platform prefix must match `platform_id`. A referenced policy must be
supplied explicitly with the same policy ID and strategy profile. The renderer
reuses the existing reference validators. Duplicate JSON fields, non-finite
numbers, malformed controls and account-like identifiers are rejected.

The preview combines reserve ratio and USD floor with the policy using `max`;
it rejects a cash-only conflict or an effective reserve plus nominal cap above
one. This is a configuration preview, with no equity valuation, strategy-default
lookup, allocation, order calculation or portfolio/backtest claim. Other policy
limits stay in the referenced policy; they are not execution enforcement.

Output contains `runtime_control_json`, its SHA-256, the canonical policy
SHA-256 (or null when unreferenced), `preview_only=true`, `no_order=true`,
`execution_authorized=false` and `live_ready=false`. Hashes cover sorted compact
UTF-8 JSON without a trailing newline. The rendered control omits description
and supplies explicit options=false and reserve floor=0 defaults. No enable/mode
value is silently changed. Hashes identify content and do not grant approval.

Use public, secret-free inputs with synthetic target IDs. The account-like
identifier check is not a general secret scrubber; do not feed private accounts,
domains, deployment mappings or credentials to this public preview workflow.
CLI failures produce no stdout and report an error category without input text.

Future workflow rendering and per-platform adoption remain separate PRs. They
need identity/revision binding, legacy parity checks, policy verification and
platform tests with trading-diff notes. This tool does not authorize their use.

Validation: `python3 -m unittest discover -s python/tests -p 'test_render_runtime_control_preview.py' -v`.

[中文](runtime-control-offline-preview.zh-CN.md)
