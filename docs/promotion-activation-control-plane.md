# Promotion Activation Control Plane (Signature + Single-Use Consumption + Readback)

English | [简体中文](promotion-activation-control-plane.zh-CN.md)

Status: code ready, **disabled by default**. Until the owner completes the prerequisites below, `apply` fails closed.

## Flow (`manual-strategy-switch.yml`, `apply=true`)

1. Generate the target file. Previews print `config_sha256` in the summary so the issuer can bind it into the manifest.
2. `Verify immutable Promotion Manifest`: runs v2 validation (exact field set, self-hash, and expiry window).
3. `Verify Promotion Manifest KMS signature`: `promotion_signature.py` verifies the detached DER signature over `b"qsl.promotion_signature.v1\n" + canonical_promotion_json(manifest)`.
   - The domain prefix prevents cross-use between promotion signatures and autonomy policy signatures sharing a KMS root.
   - The trust anchor is private secret `QSL_PROMOTION_ROOT_RECORDS_JSON` (`{platform: root_record}`), scoped per platform project with no cross-platform root sharing. It is accepted only when its `trusted_policy_root_sha256` matches the pinned digest in `runtime-strategy-switch` Environment variable `QSL_PROMOTION_TRUSTED_ROOTS_JSON` (`{platform: sha256}`).
   - Unpinned roots, mismatches, invalid signatures, or validity windows exceeding 24 hours are rejected.
4. `Consume single_use_id`: `promotion_ledger.py` creates an annotated tag `qsl-promotion-consumed/<id>` in `QuantRuntimeSettings`.
   - `POST git/refs` returns 422 if the ref already exists, providing atomic create-if-absent without extra cloud services; the tag stores `promotion_sha256`, signature digest, and run ID with no secrets.
   - Before consuming, the check verifies that an active tag ruleset covers `refs/tags/qsl-promotion-consumed/**`, blocks both `deletion` and `update`, and allows no bypass (`conditions` contains only `ref_name` with string lists `include` and `exclude`; `exclude` contains no pattern capable of matching ledger tags such as `~ALL`, `~DEFAULT_BRANCH`, non-`refs/` patterns, or intersecting wildcards, checked case-insensitively; visible `bypass_actors` is empty; `current_user_can_bypass` is `never`). Missing or malformed fields fail closed.
   - Consumption happens before variable writes. If any subsequent step fails, that `single_use_id` is spent and must be re-signed rather than retried.
5. `Apply GitHub variable updates`, followed by `Read back applied variables` (`verify_applied_assignments.py`, printing variable names only).
6. `trigger_platform_sync` remains rejected; platform synchronization runs separately.

Unchanged paths: `apply=false` previews, other platform previews, and IBKR preflight remain unchanged. Platforms without pinned trust roots cannot `apply`. Console `SWITCH_ACTIVATION_CONNECTED` stays `false`, so the console cannot trigger signed `apply`.

## Manual signing (outside CI)

The dedicated issuer service account `qsl-promotion-signer@<project>` holds `roles/cloudkms.signerVerifier` on that platform's root key only. The owner runs `python/scripts/sign_promotion_manifest.sh` via impersonation rather than inside GitHub workflows so repository write access cannot self-authorize promotions.

Steps:

- Generate the manifest with `build_promotion_manifest.py`.
- Sign with `sign_promotion_manifest.sh`.
- Verify locally with `promotion_signature.py verify`.
- Supply the envelope `{"promotion_manifest": …, "kms_signature_b64": …}` in `promotion_manifest_json` and the manifest ID in `promotion_single_use_id`.

Candidate field conventions:

- `source_revision`: target platform repository commit.
- `artifact_sha256`: SHA-256 of `uv.lock` at that commit.
- `config_sha256`: value printed by preview.
- `risk_sha256`: SHA-256 of canonical `runtime_target.runtime_risk_limits` JSON (`{}` when absent).

## Authorizing a new target (e.g., LB SG TQQQ)

- This flow enforces `live_continuity_state=NONE` and never fabricates legacy baselines.
- Live authorization for a new target equals the consumed signed promotion: ledger tag plus `promotion_sha256`.
- A future `release_attested` continuity mode (`strategy_release = {source_revision, promotion_sha256, ledger_ref}`) can be verified by platform runtimes in a separate platform PR; whether a platform accepts live orders without `live_continuity` must be verified in that platform's dry-run.

## Owner prerequisites

1. Create the tag ruleset protecting `refs/tags/qsl-promotion-consumed/**` against update/deletion with zero bypass actors.
2. Add secret `QSL_PROMOTION_LEDGER_TOKEN` (fine-grained token with `contents: read/write` on `QuantRuntimeSettings` only).
3. Set Environment variable `QSL_PROMOTION_TRUSTED_ROOTS_JSON` to independently verified `{platform: sha256}` digests (never derived dynamically from unverified records), and provide project mappings and root records in secrets `QSL_PROMOTION_ROOT_PROJECTS_JSON` and `QSL_PROMOTION_ROOT_RECORDS_JSON`.
4. Provision the KMS IAM signer service account and permissions.
