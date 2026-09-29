# Manual strategy switch permission control

[简体中文](manual_strategy_switch_permission_control.zh-CN.md)

Simplified permission model for a personal quant stack, with guardrails against
mis-clicks and secret leakage.

**Current candidate status (2026-09-29): platform activation is not connected.** The console
rejects a switch before workflow dispatch. Even after Promotion Manifest
validation, the workflow rejects `apply=true` before variable writes or platform
sync. The account-settings path can record an admin-OAuth-approved, single-target
`strategy_profile` change and an internal single-use Durable Object claim. A narrow
GitHub OIDC route at `/api/internal/account-settings/profile-application/claim`
and its fixed LongBridge HK target/scope guard are implemented in candidate source.
The route remains closed unless `ACCOUNT_SETTINGS_PROFILE_APPLICATION_WORKFLOW_SHA`
is set to the exact 40-character workflow SHA. The proposed consumer workflow and
Python caller were moved to a local draft and are not part of this repository
candidate. That draft checks GitHub variables only; it lacks fresh, identity-bound
readback of the deployed Cloud Run revision and Scheduler. It must not be released
or enabled as a variable writer until that evidence path is connected. A token,
confirmation word, or allowlist entry does not remove the ordinary switch block.
This describes candidate source, not verified production configuration or use.

The approval is bound to the complete account identity, current instance and draft
revisions, trusted current profile, and the selectable profile already saved in the
draft. Approval requires the current `RUNTIME_TARGET_ENABLED` variable to read back
as the exact string `false`; this is variable-layer evidence only, not Cloud Run or scheduler
readback. Before claim, the OIDC route also requires the resolved repository,
variable scope, and environment to equal the fixed LongBridge HK target. It accepts
only `{ "request_key": "…" }`; it verifies an
RS256 token from GitHub's fixed JWKS endpoint and requires audience
`qrs-profile-application`, repository `QuantStrategyLab/QuantRuntimeSettings`,
`refs/heads/main`, and the fixed workflow ref
`QuantStrategyLab/QuantRuntimeSettings/.github/workflows/apply-approved-hk-profile.yml@refs/heads/main`.
Its SHA must equal `ACCOUNT_SETTINGS_PROFILE_APPLICATION_WORKFLOW_SHA`. The route
derives run ID and attempt only from signed claims, rejects non-LongBridge/HK
approvals before claim, and rechecks the identity/revisions and exact disabled/current
profile variable readback. Same-run retries only return the existing non-authorizing
claim result; a different run attempt or run is rejected. The worker's trusted SHA
remains unset by this source change, so production claim access stays closed until a
separate reviewed configuration update.

If an unclaimed approval's identity or instance/draft revision has drifted, a
later valid approval transaction records it as `invalidated` before approving the
new request. Claimed records remain locked and are never released by drift.

`runtime_settings.py` contains a variable-layer primitive for a future
controlled consumer. It accepts only a single-target `strategy_profile` change
with unchanged full identity and the exact string `RUNTIME_TARGET_ENABLED=false`
readback. It does not sync a platform or prove that a deployment is stopped. No
released consumer currently calls it; the local draft is not a substitute for the
required deployed-target readback. `apply=true` in the ordinary console workflow
remains rejected. Any later consumer must report variable readback separately from
platform adoption and keep `runtime_applied=false` until adoption is independently
verified.

## Default: single-operator mode

1. Only your GitHub account has write/admin on the runtime settings repository.
2. Configure `RUNTIME_SETTINGS_GH_TOKEN` as a GitHub secret.
3. Scope the token to the minimum variables/workflow permissions for target platform repos; do not grant `contents: write`.
4. Use `apply=false` to review the preview; stop there while activation is disconnected.
5. New strategy adoption, risk increases, and large capital changes remain human decisions.
   Single-operator mode removes the need for extra team reviewers, not investment authorization.

See the Chinese note for the full checklist, fork guidance, and threat-model notes.
