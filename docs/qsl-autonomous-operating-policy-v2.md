# QSL Autonomous Operating Policy V2

English | [简体中文](qsl-autonomous-operating-policy-v2.zh-CN.md)

> Status: `P0_CONTROL_PLANE_AND_VERIFICATION_GATE`
>
> Together with `qsl.activation.v2`, this document defines control boundaries for unattended operation; it does not enable `paper`, `shadow`, `live`, orders, funds, or deployments.

## Purpose

Instead of requiring manual clicks on every workflow run, the owner sets an expiring, stage-scoped policy before deployment. Automation may generate candidates, validate evidence, and perform verified non-execution tasks only within that boundary.

`qsl.activation.v2` stores only an immutable reference to that policy and its SHA-256 receipt. Two offline verifiers exist: `autonomous_policy_gate.py` checks OpenSSH SSHSIG signatures, and `gcp_kms_policy_gate.py` checks Cloud KMS `EC_SIGN_P256_SHA256` PEM public keys and DER signatures. Neither calls a signing service; signing keys, trusted root digests, and execution entry points remain in an independent control root. Contract verification alone does not issue, sign, or authorize execution.

## Three privilege zones

| Zone | Permitted | Explicitly forbidden |
| --- | --- | --- |
| AI research zone | Read-only monitoring, research candidate generation, evidence validation, release eligibility assessment. | Reading production credentials, direct order submission, mutating policies or control roots. |
| Deterministic control zone | Verifying pinned dependencies, data/evidence/policy versions, autonomy policy receipts, and stage bindings. | LLM relaxation of rules or treating candidates as approved versions. |
| Execution and risk zone | Future execution of released versions accepted by an independent risk gateway; continuous reconciliation and halting new orders. | Direct AI-to-broker access, AI kill-switch resets, or expanding risk ceilings. |

No direct write path may exist between AI and any broker. Any future order must flow through an independent execution service with its own least-privilege identity, rejecting requests not bound to an exact deployment bundle, Activation, and risk policy.

## V2 contract boundaries

`operating_authority.mode` is fixed to `PREAUTHORIZED_AUTONOMY` and binds one exact `stage`, `policy_id`, `policy_version`, and `policy_receipt_sha256`. A policy covers repeated unattended runs within that stage only and cannot cross stages; advancing a stage requires a new policy version and receipt.

Allowed AI actions are fixed to:

- `monitor_readonly`
- `research_candidate_generation`
- `evidence_validation`
- `release_evaluation`

Forbidden AI actions are fixed to:

- `credential_access`
- `direct_order_submission`
- `kill_switch_reset`
- `policy_mutation`
- `risk_limit_mutation`

These two sets are enforced contract rules rather than prompts; changing them requires releasing a new policy/contract version through an independent control root.

## External control roots and verification gate

The verification gate joins four separate inputs:

1. Trusted root: `qsl.trusted_policy_root.v1` (OpenSSH) or `qsl.gcp_kms_policy_root.v1` (Cloud KMS P-256), holding public keys, validity windows, and root digests only—never private keys or KMS credentials.
2. `qsl.autonomous_operating_policy.v1`: binds one exact deployment bundle, target, stage, AI action set, and `risk_control` digest.
3. Detached signature: SSHSIG for OpenSSH roots or P-256 DER signature for KMS roots, verified against canonical policy JSON so any single-byte mutation fails.
4. **Out-of-repo pinned trusted-root SHA-256**: supplied by the execution service's own AI-immutable deployment configuration or gate, never accepted from workflow inputs, PR payloads, or repository files.

OpenSSH roots verify via `ssh-keygen -Y verify` with allowed signers, identity, and namespace constraints ([OpenSSH `ssh-keygen` manual](https://man.openbsd.org/OpenBSD-7.3/ssh-keygen.1)). Cloud KMS roots pin a concrete `CryptoKeyVersion` using `EC_SIGN_P256_SHA256`, verified offline with PEM public key, DER signature, and OpenSSL ([KMS algorithms](https://docs.cloud.google.com/kms/docs/algorithms); [creating and validating signatures](https://docs.cloud.google.com/kms/docs/create-validate-signatures)).

The gate passes only when policy, root, signature, bundle, Activation target, stage, receipt digest, and validity window all match. The execution/risk service itself must invoke the gate before touching a broker; a CI-only invocation would be bypassable.

On success, the gate may emit `qsl.gcp_kms_policy_gate_receipt.v1`, a minimal self-verifying projection for the P5 no-broker scheduler binding bundle, policy, activation, target commitment, risk-control digest, root digest, and validity window without account aliases, digests, public keys, raw signatures, or credentials. Alpaca's P5 v2 input adapter verifies exact binding across receipt, daily forward observation, and risk control, failing closed to `PARKED` on any gap; no active policy, scheduler, or live shadow receipt exists in the repository.

`risk_control` currently binds an immutable risk-policy digest into the admission chain. P0 implements zero-new-risk `RECONCILE_ONLY` admission (`new_risk_ceiling=0`, `write_action_ceiling=0`, otherwise `PARKED`); it does not enforce position/exposure/loss caps or read accounts, which remain the responsibility of an actual execution gateway.

## Unattended safety defaults

1. Any failure in data integrity, evidence, policy version, clock, connectivity, or reconciliation defaults to `PARKED` and forbids new risk.
2. A future execution gateway's first automatic response is halting new opens; automated position reduction requires pre-defined deterministic risk rules rather than ad-hoc AI decisions.
3. `paper` and `live` must use separate credentials, endpoints, and autonomy policies; paper results provide channel evidence only and never prove live eligibility.
4. Control roots, credentials, and circuit-breaker recovery authority remain isolated from AI research identities with an auditable event chain.

## One-time migration and current roots

This control-plane upgrade replaces `qsl.activation.v1` / `human_authority` and dependent `qsl.reconciliation_record.v1` in one step without dual-protocol fallback, as no issued v1 activation artifacts existed.

Six bootstrap Quant GCP projects hold verified public Cloud KMS roots without signer IAM. A separate P5 shadow-control project (`<alpaca-shadow-project-id>`) created on 2026-08-21 was never wired to any runtime or active policy, and its public root record has been removed and the project retired; see [GCP P0 Control Root Deployment V1](qsl-gcp-p0-control-root-deployment-v1.md). No root digest is injected into any runtime service yet, and no active autonomy policy, P4–P6 runtime, account access, order submission, or fund movement is enabled.
