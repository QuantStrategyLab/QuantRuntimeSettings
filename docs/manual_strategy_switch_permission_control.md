# Manual strategy switch permission control

[简体中文](manual_strategy_switch_permission_control.zh-CN.md)

Simplified permission model for a personal quant stack, with guardrails against
mis-clicks and secret leakage.

**Current candidate status (2026-09-29): activation is not connected.** The console
rejects a switch before workflow dispatch. Even after Promotion Manifest
validation, the workflow rejects `apply=true` before variable writes or platform
sync. The existing account-settings path can now record an admin-OAuth-approved,
single-target `strategy_profile` change and an internal single-use Durable Object
claim. The claim has no public route or workflow consumer; neither record writes
platform variables nor proves a deployment is stopped. A token, confirmation word,
or allowlist entry does not remove the switch block. This describes candidate source,
not verified production state.

The approval is bound to the complete account identity, current instance and draft
revisions, trusted current profile, and the selectable profile already saved in the
draft. Approval requires the current `RUNTIME_TARGET_ENABLED` variable to read back
as the exact string `false`; this is variable-layer evidence only, not Cloud Run or scheduler
readback. The internal claim rechecks the account and draft revisions and binds one
caller-supplied workflow run ID/attempt. Those run fields are trace bindings, not
verified GitHub identity. An exact same-run replay only reads the existing record;
a different run cannot claim it. The downstream consumer must still authenticate
its run and independently verify the actual deployed target before applying settings.

If an unclaimed approval's identity or instance/draft revision has drifted, a
later valid approval transaction records it as `invalidated` before approving the
new request. Claimed records remain locked and are never released by drift.

`runtime_settings.py` also contains a variable-layer primitive for a future
controlled consumer. It accepts only a single-target `strategy_profile` change
with unchanged full identity and the exact string `RUNTIME_TARGET_ENABLED=false`
readback. The approval and claim records are not yet connected to that primitive;
it does not sync a platform or prove that a deployment is stopped. The current
console/workflow does not call it, and `apply=true` remains rejected as described
above.

## Default: single-operator mode

1. Only your GitHub account has write/admin on the runtime settings repository.
2. Configure `RUNTIME_SETTINGS_GH_TOKEN` as a GitHub secret.
3. Scope the token to the minimum variables/workflow permissions for target platform repos; do not grant `contents: write`.
4. Use `apply=false` to review the preview; stop there while activation is disconnected.
5. New strategy adoption, risk increases, and large capital changes remain human decisions.
   Single-operator mode removes the need for extra team reviewers, not investment authorization.

See the Chinese note for the full checklist, fork guidance, and threat-model notes.
