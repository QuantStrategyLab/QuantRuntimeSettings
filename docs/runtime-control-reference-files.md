# Runtime-control reference files

Status: reference only. No runtime, workflow or console reads these files yet.

| Path | Format | Purpose |
|---|---|---|
| `examples/runtime_controls/*.json` | `qsl.runtime_control.v1` (QuantPlatformKit `schemas/runtime-control.v1.schema.json`) | One broker-neutral on/off switch, mode (`live`/`paper`/`dry_run`), cash policy and risk-policy reference per target |
| `examples/risk_policies/<profile>/*.json` | `qsl.risk_policy.v1` | Reviewed copy of the runtime risk limits that platforms currently carry inside `RUNTIME_TARGET_JSON` |

Rules enforced by `python/scripts/runtime_control_files.py` (run in CI through `python/tests/test_runtime_control_files.py`):

- No secrets and no broker account identifiers; account binding stays in deploy-time configuration.
- Every per-symbol cap is at most the total nominal cap.
- Total nominal cap plus reserved cash ratio is at most 1.
- The total effective (leverage-weighted) cap is reachable under the nominal caps.
- `risk_limits_ref` must name an existing policy.

Next steps (separate, reviewed PRs): render deploy-time `RUNTIME_CONTROL_JSON` from these files, then let each platform read it through `quant_platform_kit.common.runtime_control`.
