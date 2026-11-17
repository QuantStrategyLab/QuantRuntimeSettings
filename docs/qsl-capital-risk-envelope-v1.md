# QSL Capital Risk Envelope V1 (Design)

English | [简体中文](qsl-capital-risk-envelope-v1.zh-CN.md)

> Status: `LIBRARY_READY_PLATFORM_WIRING_IN_PROGRESS`
> Scope: account- and portfolio-level sizing and drawdown policy; does not authorize `live`, submit orders, or write to brokers.

## Implementation status (as of 2026-09-07)

| Layer | Scope | Status |
| --- | --- | --- |
| D0 | This spec + console controls (preference / tier / status light) + promotion layout | Merged in `QuantRuntimeSettings` |
| D1 | `QuantPlatformKit` pure `equity -> envelope` function (`capital_risk_envelope`) + unit tests | Merged in `QuantPlatformKit` |
| D2 | Injected reconciliation equity to `account_new_risk_gate`; breaches prohibit new risk only | Merged in `QuantPlatformKit`; see [account-new-risk-gate.zh-CN.md](https://github.com/QuantStrategyLab/QuantPlatformKit/blob/main/docs/account-new-risk-gate.zh-CN.md) |
| D3 | Shared envelope across multi-account aggregate view (`evaluate_multi_account_envelope_view`) | Merged in `QuantPlatformKit`; read-only, no allocator or orders |
| W1 | Platform wiring (portfolio -> snapshot projection -> gate evaluation) | Merged and deployed to Cloud Run (`Schwab`, `IBKR`, `LongBridge`); buy/new-risk blocking wired |
| W2 | Read-only probe (console trio + QPK W2 CLI; live account readback verified separately) | Library merged; direct local credential reads remain `PARKED` |
| W3 | Live enablement (production default gate + explicit human live authorization) | `PARKED`: no new live enablement or orders; existing `ACTIVE_LKG` continuity grants no new authority |

W1 currently enforces buy/new-risk blocking only; applying `combined_scale` to platform target-position sizing remains `PARKED`. For the A→B portfolio path, see [Multi-Strategy Combo A→B V1](qsl-multi-strategy-combo-ab-v1.md) and `QuantPlatformKit/docs/synthetic-combo-evidence.zh-CN.md`.

## 1. Human-system division (product rule)

Human decisions must stay simple and consequential; tier math, scaling, de-risking, and explanations belong to the quantitative system and AI:

| Role | Responsibilities | Explicitly excluded |
| --- | --- | --- |
| **Human** | Choose one risk preference name; confirm cross-tier downgrade/upgrade prompts; reset circuit breakers; grant initial leveraged-product mandate | Tuning multiplier tables, computing vol targets, building combo weights, interpreting dual-basis details |
| **Quant system** | Map equity into capital tiers; compute `capital_scale * vol_scale * dd_scale`, product leverage caps, and drawdown brakes; trim strategy targets; apply correlation haircuts; fail closed | Silently stepping up to a more aggressive tier on equity gains; bypassing `RiskEngine` |
| **AI** | Explain current tier, de-risking reasons, and confirmation prompts in plain language; propose research candidates | Modifying envelope rules, raising leverage, authorizing live, resetting breakers, altering `BUY`/`SELL` |

By default, the console shows three items only: current risk preference (`CAPITAL_PRESERVATION` / `BALANCED_COMPOUNDING` / `GROWTH_COMPOUNDING`), read-only capital tier, and one status indicator (`Normal` / `De-risked` / `New risk prohibited`). Without account equity readback, the console may show `design_preview` without treating preview tiers as real account state or new-risk authorization. Detailed metrics (`1.50x` MDD, `0.75` size, component scalars) stay collapsed under Details.

## 2. Position in the sizing stack

```text
Strategy target weight
  * promotion sizing 0.50 / 0.75 / 1.00         (confirmation path; != Composer 1.50x)
  * plugin scalar (<= 1)
  * capital_scale * vol_scale * dd_scale        (this envelope; factors <= 1, scale down only)
      -> optional combo budget + correlation-group haircut
      -> hard account gate NEW_RISK_PROHIBITED
      -> RiskEngine -> execution
```

`combined_scale = clamp(capital_scale * vol_scale * dd_scale, 0, 1)`. Missing observations default an individual multiplier to `1` without claiming full risk coverage, while missing account equity keeps the status indicator `unknown` (`design_preview` only).

| Basis | Meaning | Chosen by |
| --- | --- | --- |
| Composer MDD ceiling | `1.00` / `1.25` / `1.50` relative to unlevered benchmark | Human risk preference name |
| Promotion sizing | `0.50` / `0.75` / `1.00` of strategy target (new promotions / material changes only) | Preference name |
| **Envelope `combined_scale`** | Equity tier * vol target * progressive drawdown de-risking, plus leverage caps and hard brake | Computed deterministically by table; human confirms cross-tier transitions |

### 2.1 Three multipliers

| Factor | Role | Rule |
| --- | --- | --- |
| `capital_scale` | Cap sizing by USD equity tier | See Section 3 table; automatic upward tier transitions forbidden |
| `vol_scale` | Lightweight volatility targeting | `min(1, target_vol / realized_vol)`; `1` when realized vol is absent; not an HRP/RL primary path |
| `dd_scale` | Progressive de-risking before hard stop | Roughly `0.5` at half the drawdown brake; `0` and `new_risk_allowed=false` at the brake |

Additional constraints (still bounded by the envelope): USD risk budgeting alongside percentage drawdown (protecting small accounts with shorter absolute ruin distance), and correlation-group haircuts (for example `TQQQ + SOXL` budgets cannot exceed the total risk sleeve; V1 includes no shared-account allocator).

## 3. Capital tiers (absolute USD equity default)

V1 keys on **USD equity tiers** because dollar loss capacity is clearer for personal accounts than abstract percentages; declared `total_net_worth_usd` may be shown read-only without relaxing the envelope.

Draft illustrative tier table (thresholds frozen per config version prior to production wiring):

| Equity tier (USD) | Default posture | `capital_scale` cap | Leveraged products | Drawdown brake (from equity peak) |
| --- | --- | --- | --- | --- |
| `< 50_000` | Allows fuller allocation under growth preference | `<= 1.00` | Full strategy 3x ETF allowed; margin requires separate mandate | ~12–15% -> prohibit new risk |
| `50_000–250_000` | Balanced | `<= 0.85` | Cap 3x ETF weight or shift part to unlevered sleeve | ~10% -> prohibit new risk |
| `250_000–1_000_000` | Preservation-tilted | `<= 0.65` | Reduce 3x sleeve by default; new leverage needs confirmation | ~7–8% -> prohibit new risk |
| `> 1_000_000` | Preservation | `<= 0.50` | Prohibit new leveraged exposure by default | ~5% -> prohibit new risk |

Rules: conservative downgrades apply automatically with console alerts; aggressive upgrades are **never automatic** and require both equity recovery plus human confirmation (or explicit preference change), with hysteresis thresholds preventing flip-flopping. Small-account flexibility never overrides product leverage caps or early `NEW_RISK_PROHIBITED` brakes.

## 4. Relationship to the portfolio layer

The envelope sits at the **account / aggregated-equity** boundary and cannot be bypassed by combinations:

1. Single account: trim member strategy targets first, then pass through envelope and hard gate.
2. Multi-account portfolio view: map aggregated equity through the same table, then allocate within per-account mandates while keeping one active writer per account.
3. Correlated groups (such as `TQQQ + SOXL`): combined budgets cannot exceed the correlation-haircut sleeve.
4. Shared-account multi-strategy allocator: excluded from V1.
5. Selected path: **A (virtual combo research) -> B (multi-account aggregate risk)** per [Multi-Strategy Combo A→B V1](qsl-multi-strategy-combo-ab-v1.md); no option C shared-account allocator.

## 5. AI automation boundaries

Permitted: summarize injected equity/drawdown state as "confirm downgrade" or "hold" recommendations; explain candidate/envelope conflicts in research HITL; translate dual-basis numbers into plain one-sentence status summaries.

Forbidden: editing tier tables, preferences, or mandates; raising `capital_scale` / `vol_scale` / `dd_scale` or leverage caps; treating Composer checks as live authority; resetting circuit breakers.

## 6. Phased wiring

### 6.1 Library and design (D0–D3)

| Phase | Scope | Definition of done | Status |
| --- | --- | --- | --- |
| D0 | Design spec + console copy trio (preference / tier / indicator) | Legible to operators, zero order side effects | Merged |
| D1 | QPK pure function `equity -> envelope` (with vol/dd) + unit tests | Unit proof of composition with promotion sizing | Merged |
| D2 | Inject reconciliation equity to account new-risk gate; block new risk on breach | No auto-liquidation or auto-reset | Merged in QPK; platform readback in W1/W2 |
| D3 | Shared envelope across multi-account aggregate view | Still zero shared-account allocator | Merged in QPK |

### 6.2 Platform wiring (W1–W3)

| Phase | Scope | Definition of done | Status |
| --- | --- | --- | --- |
| W1 | Project portfolio/reconciliation readbacks to `InjectedReconciliationSnapshot` and call `evaluate_new_risk_admission` | Unit tests + platform CI; fail-closed default | Merged and deployed to Cloud Run; buy/new-risk block wired |
| W2 | Read-only probe: console and diagnostics display envelope tier/status; `ACCOUNT_NEW_RISK_GATE=0` test-only | No orders, no live side effects | In progress (console merged; real-account probes pending) |
| W3 | Production default-on account gate + explicit human live/mandate confirmation | Independent acceptance; never bypass `RiskEngine` | Not started |

Platform sizing consumption of `combined_scale` remains unimplemented (scaling down only; missing/invalid inputs never relax risk). See [account-new-risk-gate.zh-CN.md](https://github.com/QuantStrategyLab/QuantPlatformKit/blob/main/docs/account-new-risk-gate.zh-CN.md).

## 7. Non-goals

- HRP/RL allocators, live mean-variance optimizers, Kelly primary sizing, or Bridgewater-style risk parity as the main path.
- AI automatic upgrades or leverage raises, or Composer auto-writing production policies.
- Silently increasing risk appetite from self-reported net worth or AUM growth.
- Replacing `RiskEngine` or weakening zero-submission `REJECT` semantics, or silently recomputing legacy live targets into new envelopes without read-only diff review first.

## 8. Design acceptance

- An operator can select a preference, confirm a tier downgrade, and reset a breaker in the console without inspecting `1.50` vs `1.00` details.
- Simulated equity tier crossings automatically scale down, require confirmation to scale up, and emit AI explanations with zero writable privilege fields.
- Documentation states clearly that the capital envelope shares one account gate with multi-strategy portfolio research.
