# QSL P4/P5 Unattended Delivery V1

English | [简体中文](qsl-p4-p5-autonomy-delivery-v1.zh-CN.md)

> Status: `CONTROL_CONTRACT_IMPLEMENTED_EXECUTOR_NOT_WIRED`
>
> This design splits paper (`P4`) and shadow (`P5`) into two independent lanes for unattended operation; it does not enable accounts, brokers, orders, funds, or `P6`.

## Purpose

Under normal conditions, operators should not have to click daily approvals for `paper` or `shadow`. Within a pre-authorized, unexpired, exact candidate boundary, automated services run, record, reconcile, retry, and park automatically—escalating to the owner only when deterministic rules cannot clear a material risk. `P6` live execution always requires explicit owner confirmation.

| Stage | Automated actions | Never allowed |
| --- | --- | --- |
| `P4` `PAPER_DRY_RUN` | Submit bounded paper orders to an **isolated paper account**, record receipts, and reconcile automatically. | Using live endpoints or live credentials, or treating paper results as live authority. |
| `P5` `SHADOW` | Generate and persist hypothetical decisions / virtual ledgers compared against real market data and read-only reconciliation. | Submitting broker orders or reading/mutating live funds. |

`PAPER_BROKER` is an optional per-platform automated lane rather than a global prerequisite: one fixed strategy may hold `paper` or `live` evidence on platform A while running `P5` `shadow` on platform B without false failure alerts. Only when strategy, data, and target execution evidence match exactly and remain fresh does the console emit `P6_LIMITED_LIVE_CANARY_DECISION_REQUIRED` for an owner decision (which itself grants no `P6` enablement or orders).

Alpaca requires separate paper endpoints and credentials distinct from live ([Paper Trading](https://docs.alpaca.markets/us/v1.4.2/docs/paper-trading); [Authentication](https://docs.alpaca.markets/us/docs/authentication)), so market-data configuration never implies `P4` trading authority or credentials.

## Implemented machine gate

`qsl.forward_observation_risk_control.v1` defines the minimal signable risk object per automated `P4`/`P5` lane, validated in `python/scripts/forward_observation_risk_control.py`:

- One-to-one stage/channel binding: `P4` requires `PAPER_BROKER`; `P5` requires `SHADOW_LEDGER`.
- Exact candidate, strategy revision, and `P1`/`P2`/`P3` digests.
- Allowed symbol digest, max open positions, per-order/gross exposure, daily turnover, decisions per session, and consecutive failure caps.
- Fail-closed breaker on data, evidence, reconciliation, execution errors, or unknown order outcomes, requiring reconciliation before the next cycle.
- Maximum 31-day validity window, canonical SHA-256, and closed field set.

The validator has no network, broker, credential, account, order, scheduler, or write capability; it participates only when referenced by matching `risk_policy_id`, version, and SHA-256 from a verified `qsl.autonomous_operating_policy.v1` inside an independent execution gateway.

## Automated runtime state machine

```text
P3 terminal evidence + signed P4/P5 policy + risk-control digest
                         │ any missing / expired / mismatched input
                         ▼
                    PARKED (record reason, recheck next window)
                         │ all inputs match
                         ▼
              P4 paper gateway / P5 shadow ledger
                         │
        reconcile ok ────┴──────► write minimal receipt, wait for next session
        data/exec error ────────► trip breaker, auto-retry, deduplicated alert
        unknown outcome ────────► block new risk, reconcile first; alert if unresolved
```

`PARKED`, `DEFERRED`, and recoverable data glitches enter bounded retry without invalidating history or requiring daily manual clicks. Unknown order outcomes, non-converging reconciliation, risk-limit breaches, or policy/target drift halt new risk and escalate as high-priority events.

## Rollout order

1. `P5`: deploy an independent shadow-ledger scheduler consuming verified `P3` outputs and writing minimal daily receipts with zero broker write authority.
2. `P4`: deploy an independent Alpaca paper adapter whose identity receives paper credentials only and hardcodes paper endpoints in code/deployment rather than workflow inputs, AI, strategies, or policies.
3. Both invoke the policy gate, risk-control validator, and reconciliation gate before each cycle, keeping credentials, order payloads, account IDs, full positions, and raw bars out of the console and AI.
4. Feed redacted `P4`/`P5` receipts into the unified console for AI monitoring and notifications without auto-advancing candidates to `P6`.

No signed `P4`/`P5` policies, paper identities, or wired executors exist in the repository yet. The existing `P5` GCS adapter accepts an injected bucket client for exact-cycle reads and generation-matched create-only receipt writes (closing storage errors to `PARKED`) with zero cloud buckets, workload identities, runners, or schedulers provisioned.
