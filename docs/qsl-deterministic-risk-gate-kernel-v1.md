# QSL Deterministic Risk Gate Kernel V1

English | [简体中文](qsl-deterministic-risk-gate-kernel-v1.zh-CN.md)

> Status: `DETERMINISTIC_CORE_IMPLEMENTED_NOT_WIRED`
>
> This document and `python/scripts/deterministic_risk_gate.py` implement a pure in-memory, side-effect-free decision kernel. It reads no accounts or credentials, makes no network or broker calls, submits no orders, writes no ledgers, and triggers no workflows or schedulers; it confers no P4, P5, P6, or execution capability.

## Role and boundaries

`qsl.forward_observation_risk_control.v1` pins P4/P5 candidates, P1/P2/P3 evidence, and coarse limits into a signable object without taking position snapshots. This kernel neither alters nor replaces that contract; `qsl.deterministic_risk_gate_policy.v1` references it by exact ID, version, and SHA-256 while adding account-level **decision rules**:

- Gross exposure, per-symbol exposure, and per-strategy exposure.
- Leverage (`gross / equity`, rounded up in integer bps).
- Intraday loss (hitting the cap prohibits new risk) and per-session decision frequency.
- Observation completeness, reconciliation health, and persisted circuit-breaker state.

The caller passes a redacted, injected `portfolio snapshot` and a new-risk request to `evaluate_new_risk`, which returns only:

| Decision | Meaning |
| --- | --- |
| `ALLOW_NEW_RISK` | All health checks and hard caps in the provided inputs pass. Not an order permission. |
| `NEW_RISK_PROHIBITED` | One or more health checks or hard caps failed; suggested next breaker state is `OPEN`. |

Any invalid structure, digest, field, value, or policy reference raises `DeterministicRiskGateError`. Future P4/P5 gateways must treat that exception identically to `NEW_RISK_PROHIBITED` with persisted breaker state `OPEN`, without degrading fail-closed behavior.

## Immutable inputs and reproducible outputs

### Policy

`qsl.deterministic_risk_gate_policy.v1` uses a closed field set, canonical JSON, and SHA-256. It requires:

- An exact reference to one `qsl.forward_observation_risk_control.v1` risk-policy digest.
- Integer cents (no floats) for all monetary amounts and integer bps for leverage.
- `manual_reset_required=true` (policies allowing automatic breaker reset are rejected).
- Zero account identifiers, broker endpoints, credentials, order payloads, or URLs.

### Evaluation input

`qsl.deterministic_risk_gate_input.v1` pairs the policy digest with a bounded portfolio snapshot and new-risk request. Per-symbol and per-strategy exposures inside the snapshot must each sum exactly to gross exposure so callers cannot bypass limits via inconsistent totals. It is an in-memory gateway projection only, not an account-reader implementation, and should never enter console or AI contexts directly.

### Decision output

`qsl.deterministic_risk_gate_decision.v1` emits fixed reason codes, projected limit metrics, suggested next breaker state, and SHA-256 without account, broker, order, fill, or credential fields. Audit persistence belongs to an external writer emitting minimal redacted receipts.

## Circuit-breaker rules

The kernel only **consumes** `CLOSED` / `OPEN` states and exposes no reset method:

```text
CLOSED + all conditions pass        -> ALLOW_NEW_RISK, next=CLOSED
CLOSED + any anomaly or cap breach  -> NEW_RISK_PROHIBITED, next=OPEN
OPEN   + any new-risk request       -> NEW_RISK_PROHIBITED, next=OPEN
```

A future independent gateway persists `next=OPEN` in controlled storage; recovery requires its predefined manual/external workflow and can never be automated by AI, GitHub Actions, the web console, strategy code, or this module. Position reduction and liquidation are outside V1 and must later be defined as pre-encoded, replayable rules.

## Account gate wiring status (2026-09)

- In `QuantRuntimeSettings`, this module remains a **pure decision kernel** with no real-account reads, deployment, account toggles, or breaker resets.
- `QuantPlatformKit` provides an injected read-only adapter (`account_new_risk_gate`) that returns `NEW_RISK_PROHIBITED` for unhealthy reconciliation snapshots; real-account readback is not yet wired to restore breakers or enable live.
- Until policies are frozen and execution identities isolated, P4 and P5 remain `PARKED`.

## Future wiring order (not implemented)

1. In an independent P5 shadow adapter, verify P1–P3, forward-observation risk control, policy-gate receipt, and prior minimal shadow receipt before injecting the bounded snapshot and re-checking digests prior to persistence.
2. Reuse the same kernel in an independent P4 paper gateway whose paper-only identity supplies snapshots, idempotency keys, and reconciliation records isolated from AI, console, Actions, and research.
3. Freeze per-candidate policies and deterministic replay fixtures beforehand, initially wiring "stop new risk" only; without these prerequisites, P4/P5 remain `PARKED`.

This layering matches [Deterministic Execution Gateway V1](qsl-deterministic-execution-gateway-v1.md): strategies/combos propose targets, the risk kernel decides, and only a future isolated execution service holds scoped external credentials.
