# QSL Multi-Strategy Combo A→B V1 (Design)

English | [简体中文](qsl-multi-strategy-combo-ab-v1.zh-CN.md)

> Status: `DESIGN_FROZEN_A_LIBRARY_READY_B_VIEW_READY`
> Scope: path selection for virtual combo research and multi-account aggregate risk; does not authorize `live`, submit orders, write to brokers, or deploy to live accounts.
> Upstream: [Capital Risk Envelope V1](qsl-capital-risk-envelope-v1.md).

## 1. Decision summary

Build **A (virtual combo research)** first, then **B (multi-account aggregate risk)**, and **explicitly exclude C (shared-account allocator)**. The portfolio layer only trims and explains; it never bypasses account gates or `RiskEngine`.

## 2. Path A: Virtual combo research (zero fund access)

Goal: synthesize member strategies into **research evidence** showing whether combined risk sleeves stay within correlated-group bounds, without opening shared-writer accounts.

| Included | Excluded |
| --- | --- |
| Synthesizing return/drawdown paths (synthetic or frozen net-of-cost paths) | Reading/writing real accounts, credentials, or broker sessions |
| Correlation-group haircuts (capping combined budgets such as `TQQQ + SOXL`) | Shared-account weight allocation or automated rebalancing |
| Emitting `learning_only` / `promotion_eligible=false` combo evidence | Granting `live`, changing mandates, or raising leverage |
| Comparing against Composer / promotion dual bases under the same preference name | Treating synthetic combos as live health or recovery prerequisites |

Definition of done for A: reproducible `synthetic combo evidence` contract and unit tests declaring synthetic assumptions and failing closed when correlation estimates are missing.

## 3. Path B: Multi-account aggregate risk (shared capital envelope)

Goal: map **aggregated equity** in console/diagnostic views through the single capital-tier table and interpret limits per account mandate, while execution stays strictly **one active writer per account**.

| Included | Excluded |
| --- | --- |
| Aggregated equity -> shared `capital_scale * vol_scale * dd_scale` table | Cross-account merged order submission or shared claims |
| Annotating portfolio-budget / correlation-sleeve breaches in account views | Silently resizing any account from the aggregate view |
| Emitting explanations and `NEW_RISK_PROHIBITED` candidate signals on breach | Automatic liquidation or cross-account fund transfers |

Path B relies on envelope D2/D3 wiring phases rather than inventing a second account gate.

## 4. Excluded path C: Shared-account allocator

Running multiple concurrent capital writers inside one physical account, sharing an allocator, or splitting portfolio weights into single-account sub-orders is **out of scope for V1**. Organization constraints enforce one active strategy per account and prohibit concurrent capital writers without unique identity, claim, and single-writer locks; combinations require separate member accounts or portfolio-level OOS/cost/stress evidence rather than shared-account packing.

## 5. Integration with the capital envelope stack

Trimming order (inserting only the correlation haircut into the existing envelope chain):

```text
Strategy target weight
  * promotion sizing 0.50 / 0.75 / 1.00
  * plugin scalar (<= 1)
  * capital_scale * vol_scale * dd_scale
      -> correlation haircut (correlated-group total risk sleeve)
      -> NEW_RISK_PROHIBITED (hard account gate)
      -> RiskEngine -> execution
```

Path A previews `promotion * plugin * capital * vol * dd -> haircut` on synthetic research evidence without execution wiring. Path B consumes the same envelope table across aggregated equity, applying haircuts and hard gates per writer without bypassing zero-submission `REJECT`.

## 6. Non-goals and implementation status (as of 2026-09-07)

Non-goals: HRP/RL/mean-variance live optimizers as primary path, Kelly primary sizing, AI upgrades/leverage raises/live authorization/breaker resets, live-account deployment, and parallel risk frameworks weakening `RiskEngine`.

| Item | Status |
| --- | --- |
| Path selection A -> B (excluding C) | Frozen in this document |
| Synthetic combo evidence | Merged in `QuantPlatformKit` |
| Multi-account aggregate view (Path B / D3) | Merged (`evaluate_multi_account_envelope_view`); read-only explanation, zero execution authority |
| Real-account readback / `live` / deployment | `PARKED`; requires credentials and separate enable authorization |
