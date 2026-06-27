# Manual strategy switch permission control

[简体中文](manual_strategy_switch_permission_control.zh-CN.md)

Simplified permission model for a personal quant stack: you can switch strategies
like Codex would, while keeping basic guardrails against mis-clicks and secret
leakage.

## Default: single-operator mode

1. Only your GitHub account has write/admin on the runtime settings repository.
2. Configure `RUNTIME_SETTINGS_GH_TOKEN` as a GitHub secret.
3. Scope the token to the minimum variables/workflow permissions for target platform repos; do not grant `contents: write`.
4. Run the workflow once with `apply=false` to review the preview before applying.

See the Chinese note for the full checklist, fork guidance, and threat-model notes.
