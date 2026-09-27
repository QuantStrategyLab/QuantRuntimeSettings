# Manual strategy switch permission control

[简体中文](manual_strategy_switch_permission_control.zh-CN.md)

Simplified permission model for a personal quant stack, with guardrails against
mis-clicks and secret leakage.

**Current candidate status (2026-09-27): activation is not connected.** The console
rejects a switch before workflow dispatch. Even after Promotion Manifest
validation, the workflow rejects `apply=true` before variable writes or platform
sync. Durable single-use authorization consumption and immutable cross-platform
activation are not wired. A token, confirmation word, or allowlist entry does not
remove this block. This describes candidate source, not verified production state.

## Default: single-operator mode

1. Only your GitHub account has write/admin on the runtime settings repository.
2. Configure `RUNTIME_SETTINGS_GH_TOKEN` as a GitHub secret.
3. Scope the token to the minimum variables/workflow permissions for target platform repos; do not grant `contents: write`.
4. Use `apply=false` to review the preview; stop there while activation is disconnected.
5. New strategy adoption, risk increases, and large capital changes remain human decisions.
   Single-operator mode removes the need for extra team reviewers, not investment authorization.

See the Chinese note for the full checklist, fork guidance, and threat-model notes.
