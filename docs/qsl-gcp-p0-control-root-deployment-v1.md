# QSL GCP P0 Control Root Deployment V1

English | [简体中文](qsl-gcp-p0-control-root-deployment-v1.zh-CN.md)

> Status: `P0_SIX_ROOTS_ALPACA_SHADOW_CONTROL_RETIRED_NOT_RUNTIME_WIRED`
>
> This document records public Cloud KMS verification root initialization (formerly including the retired standalone `AlpacaShadowControl` P5 shadow domain); it creates no order endpoints, reads no broker or market data, and alters no Cloud Run, GitHub Actions, account, or fund paths.

## Why roots follow trust domains rather than per-repository copies

`QuantRuntimeSettings`, `QuantPlatformKit`, strategy repositories, and data repositories share one verification contract rather than acting as separate broker write boundaries. Duplicating keys into every Git repository widens rotation exposure without adding security.

P0 isolates roots by runtime/GCP project: one root maps to one project's future policy lane, while policies still pin exact target repositories, revisions, environments, account digests, and zero-risk control digests so sharing a project root grants no cross-repo authority.

| GCP project | Primary repositories / domains covered | Resource status (2026-08-19 inventory) |
| --- | --- | --- |
| `<binance-project-id>` | `BinancePlatform`, `CryptoStrategies`, `CryptoLivePoolPipelines` | Initialized and read-verified |
| `<schwab-project-id>` | `CharlesSchwabPlatform`, `SchwabTokenAutoRefresher` | Initialized and read-verified |
| `<firstrade-project-id>` | `FirstradePlatform` | Initialized and read-verified |
| `<ibkr-project-id>` | `InteractiveBrokersPlatform`, `IBKRGatewayManager`, US equity chains | Initialized and read-verified |
| `<longbridge-project-id>` | `LongBridgePlatform`, HK equity chains | Initialized and read-verified |
| `<research-project-id>` | Research, signal, and context repositories | Initialized and read-verified |

Core control/reference repositories (`QuantRuntimeSettings`, `QuantPlatformKit`, `AIAuditBridge`) do not own Cloud KMS roots directly; they verify public root records only and cannot sign.

## Minimal resources and permissions

For each project, the initializer creates only:

1. Enabled `cloudkms.googleapis.com` API.
2. Non-deletable key ring: `global/qsl-p0-policy-root`.
3. One software-protected `ASYMMETRIC_SIGN` key: `autonomy-policy-root-v1`, fixed to `EC_SIGN_P256_SHA256`, initial version `1`.
4. A repository public `qsl.gcp_kms_policy_root.v1` JSON record carrying the PEM public key, full key-version resource name, and self-check digest.

The initializer creates no signer service accounts, grants no `roles/cloudkms.signer` or `cloudkms.cryptoKeyVersions.useToSign`, and binds no runtime, scheduler, deploy, GitHub OIDC, or AI identity to the keys. A separate P5 shadow-control domain (`<alpaca-shadow-project-id>`, display name `AlpacaShadowControl`) initialized on 2026-08-21 was never wired to a runtime service; its public root record has been removed from the repository and the project is retired (cloud shutdown executed separately after removal). None of the six bootstrap roots carry signer IAM, so roots can be verified independently while no active policy, automated issuer, or runtime path exists.

Cloud KMS recommends `EC_SIGN_P256_SHA256`, whose PEM public keys and DER signatures verify offline via OpenSSL ([Google Cloud KMS algorithms](https://docs.cloud.google.com/kms/docs/algorithms); [creating and validating signatures](https://docs.cloud.google.com/kms/docs/create-validate-signatures)).

## Controlled execution

Generate local previews without network mutations first:

```bash
python3 python/scripts/provision_gcp_kms_policy_roots.py \
  --project <binance-project-id> --project <schwab-project-id> --project <firstrade-project-id> \
  --project <ibkr-project-id> --project <longbridge-project-id> --project <research-project-id>
```

Adding `--apply` requires explicit authorization and waits until billing prechecks pass across all projects; re-runs verify existing key purposes and algorithms without replacing keys. Public records under `docs/p0_control_roots/gcp/<project>.json` contain zero private keys, KMS credentials, or order/account data; the formerly empty `<retired-alpaca-project-id>` project was retired after migration verification and must not be treated as trusted.

Root SHA-256 digests must not be passed via workflow inputs or repository variables as an "external pin". Any future read-only verification service must inject `QSL_TRUSTED_POLICY_ROOT_SHA256` from its own independently controlled deployment config. Because the six projects own isolated roots, research policies must never be issued under a broker project's root.
