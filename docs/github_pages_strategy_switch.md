# GitHub Pages Strategy Switch Design

Use two layers:

1. GitHub Pages: public, read-only, no secrets.
2. Protected Worker: GitHub login, allowlist, and server-side workflow dispatch.

This keeps the open-source page safe while preserving a convenient one-click switch path for an allowlisted operator.

## GitHub Pages Layer

`docs/index.html` is the public console:

- Chinese and English UI.
- Platform, strategy, target, routing, and apply-mode inputs.
- Live workflow inputs and GitHub CLI preview.
- No token storage.
- No direct GitHub variable writes.
- No direct Cloud Run mutation.
- Dispatch button stays disabled unless the page is served behind the protected Worker.

GitHub Pages settings:

```text
Settings -> Pages -> Build and deployment
Source: Deploy from a branch
Branch: main
Folder: /docs
```

The published URL is usually:

```text
https://quantstrategylab.github.io/QuantRuntimeSettings/
```

Use the URL shown by GitHub Pages if the organization or repository name differs.

## Protected Worker Layer

The authenticated console lives in:

```text
web/strategy-switch-console/worker.js
```

The Worker reuses the same `docs/index.html` UI. After changing the page, run:

```bash
python3 scripts/sync_strategy_switch_page_asset.py
```

This regenerates `web/strategy-switch-console/page_asset.js`, keeping the public GitHub Pages UI and protected Worker UI aligned.

The Worker handles:

- GitHub OAuth login.
- `ALLOWED_GITHUB_LOGINS` checks.
- Server-side dispatch of `manual-strategy-switch.yml` using `RUNTIME_SETTINGS_DISPATCH_TOKEN`.

The Worker does not:

- Write platform repository variables directly.
- Call Cloud Run directly.
- Send tokens to the browser.

Actual platform variable writes still happen inside the GitHub Actions workflow using `RUNTIME_SETTINGS_GH_TOKEN`, confirmation text, and secret-name validation.

## Secret Boundaries

GitHub Pages:

```text
No secrets
```

Worker secrets:

```text
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
SESSION_SECRET
RUNTIME_SETTINGS_DISPATCH_TOKEN
ALLOWED_GITHUB_LOGINS
ALLOWED_GITHUB_ORGS
STRATEGY_SWITCH_ADMIN_LOGINS
STRATEGY_SWITCH_ADMIN_ORGS
```

GitHub Actions Environment secret:

```text
RUNTIME_SETTINGS_GH_TOKEN
```

Do not reuse these tokens. `RUNTIME_SETTINGS_DISPATCH_TOKEN` only dispatches the RuntimeSettings workflow. `RUNTIME_SETTINGS_GH_TOKEN` is only used inside Actions to write target platform variables.

## Rollout Order

1. Merge `docs/index.html` and enable GitHub Pages from `/docs`.
2. Configure `Manual Strategy Switch` and `RUNTIME_SETTINGS_GH_TOKEN`.
3. Deploy the Worker with GitHub OAuth, allowed users/orgs, and admin users/orgs.
4. Test sign-in, account dropdown loading, and workflow dispatch with a controlled account.
5. Test `apply=true` on a low-risk target.

## Why Pages Does Not Dispatch Directly

GitHub Pages is static hosting. Any token placed there can be discovered or reused after the project is open-sourced. Browser-only controls also make allowlisting, auditing, and revocation weaker.

Keep GitHub Pages read-only and place one-click dispatch behind the protected Worker.
