# QSL Deterministic Execution Gateway V1: Design Contract

English | [简体中文](qsl-deterministic-execution-gateway-v1.zh-CN.md)

> Status: `P0_RECONCILE_ONLY_GATE_IMPLEMENTED_NOT_WIRED`
>
> This document does not enable any account, broker, `paper`, `shadow`, `live`, order, or funds operation, and assigns no scope or completion status to P4–P6.

## Why a separate gateway is required

Passing pre-authorized policy verification proves only that a short-lived, externally signed permission chain exists for an exact bundle. It cannot by itself enforce position limits, loss limits, order rate caps, or safe handling of uncertain broker outcomes.

P0 currently implements [`reconcile_only_admission_gate.py`](../python/scripts/reconcile_only_admission_gate.py): it validates both OpenSSH SSHSIG and Cloud KMS P-256 external roots and returns at most `RECONCILE_ONLY` when the signed policy, exact risk digest, exact target, and validity window match—otherwise returning structured `PARKED`. That module reads no accounts, opens no network or broker connections, runs no reconciliation, and exposes no order interface.

Any future automated trading stack must separate three layers:

```text
AI / driver (research, monitoring, evidence)
        │ writes candidates and evidence only; cannot call brokers
        ▼
Policy root + autonomous_policy_gate (signature, TTL, bundle, target)
        │ returns allow / PARKED only; cannot submit orders
        ▼
Deterministic execution gateway (risk limits, idempotency, reconciliation, breakers)
        │ sole holder of scoped broker credentials
        ▼
Broker API
```

The strategy-switch web console, GitHub Actions, coordinator sessions, drivers, and LLMs sit upstream of the first two layers and cannot act as broker write paths. They may request re-evaluation but cannot bypass the gateway or reset circuit breakers.

## Exclusive acceptance conditions

Before any request that could change account state, a future gateway must simultaneously verify:

1. Current clock, connectivity, and latest reconciliation are healthy; any gap defaults to `PARKED`.
2. `autonomous_policy_gate` succeeds with `QSL_TRUSTED_POLICY_ROOT_SHA256` injected from the gateway's own protected deployment configuration—never from requests, workflow inputs, or repository files.
3. Exact deployment bundle, target, stage, and `risk_control` digests in the policy match the immutable version loaded by the gateway.
4. The request carries a gateway-generated idempotency key; identical keys return the recorded outcome, and uncertain broker outcomes are never blindly retried.
5. Every deterministic risk limit passes **before** execution: per-order size, gross exposure, strategy exposure, intraday loss, frequency, market session, allowed symbols, and account state.
6. No circuit breaker is tripped; when tripped, only logging and reconciliation are permitted, with any de-risking or liquidation governed by pre-encoded deterministic rules rather than AI judgment.

"Signed policy", "green CI", "passing backtest", and "AI order suggestion" are never sufficient on their own.

## Minimal interface and states

The V1 P0 admission interface emits only two outcomes:

| Outcome | Meaning | Next action |
| --- | --- | --- |
| `PARKED` | Any input is missing, expired, mismatched, unknown, or over limit. | Prohibit new risk, write minimal audit event, wait for deterministic conditions to recover. |
| `RECONCILE_ONLY` | Ineligible for new risk, but permitted to read and reconcile existing state. | Never create, modify, or resubmit orders. |

`ORDER_ACCEPTED` is intentionally undefined until independent paper/shadow evidence proves readiness, preventing an "order-capable first, risk-controls later" inversion. `RECONCILE_ONLY` is an admission token for a future read-only service and performs no reads itself.

## Identity and data boundaries

- Only the gateway process may access broker credentials; AI, CI, web console, strategy code, policy files, and audit logs never read them.
- Policy signing keys stay out of this repo, CI, and gateway runtime accounts; the gateway reads public roots, signed policies, and its protected root digest only.
- Raw market data, account data, and audit indexes stay separated; audit events retain hashes, timestamps, outcomes, reason codes, and versions without copying credentials or order payloads.
- Policy-root issuer, gateway credential, and AI research service identities must remain distinct.

## Keeping automation unattended

Unattended operation means continuous enforcement of boundaries by preconfigured deterministic services rather than removing boundaries: AI may detect anomalies, generate candidates, run evidence, and propose release evaluations; a policy root may issue or renew **non-expanding** policies under fixed rules; the gateway still admits only verified, unexpired inputs within risk limits. Expanding stages, accounts, bundles, risk limits, tradable symbols, or AI permissions requires a new policy/risk version processed independently.

## Integration order

1. Prepare a public trusted root isolated from AI/CI and pin its SHA-256 in the future gateway deployment config (pinning a concrete `EC_SIGN_P256_SHA256` key version and PEM for GCP KMS rather than dynamic runtime key lookup).
2. Issue a short-lived **zero-order** policy for one target and verify auditable gate outputs.
3. Connect read-only reconciliation and verify disconnects, clock skew, data/policy mismatches, and duplicate idempotency keys all fail closed to `PARKED`.
4. Only with complete evidence above, propose separate reviewable tasks for paper or shadow execution.

Step 1 public Cloud KMS roots are initialized and read-verified across the six Quant GCP projects; the separate P5 shadow-control project (`<alpaca-shadow-project-id>`) was retired with its public record removed before any runtime wiring; see [GCP P0 Control Root Deployment V1](qsl-gcp-p0-control-root-deployment-v1.md). No root SHA-256 is injected into any gateway deployment config yet, and steps 2–3 remain uninstalled. Neither this design nor the P0 admission code authorizes deployment, trading, or promotion.
