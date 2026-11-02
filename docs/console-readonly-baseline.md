# Read-only console preflight baseline

The read-only #946 preflight distinguishes the original 54e bytes, its exact
fixed #946 candidate, and one reviewed later main release. Every other module
hash fails with `active_54e_bytes_mismatch`. Recognition of the later release
returns `reviewed_main: true`, `patch_ready: false` and `already_applied: null`;
it does not assert that the historical patch can be applied to that release.
The production `console_946_54e_patch.mjs` validator remains unchanged.

## Pinned repository build

| Input | Pin |
| --- | --- |
| Reviewed main release commit | `9b695a4ade90bcc9931f53109e0ad33f63407927` |
| Source tree | `4838ce604b01f6ba94a2880809d87562fab40b43` |
| Node / npm | `22.23.4` / `10.9.9` |
| Wrangler | `4.106.0` |
| TypeScript / Vite | `5.9.2` / `7.3.7` |
| Module SHA-256 | `0c423d325873d85f9a6b6506c6a9ae35f44753a157e90e3ef1c049b094e0aec2` |
| Config SHA-256 | `ca64496a2ed4ff8d022841e073915fc2a1e2f83fc06243431a8104fcb7db1c16` |

The machine-readable identity is in
[`console_946_reviewed_main_baseline.mjs`](../scripts/console_946_reviewed_main_baseline.mjs).
All dependency locks come from the pinned commit. The build regenerates frontend
assets before bundling; the module digest is not a Git blob or frontend build ID.

The exact configuration is
[`console_946_reviewed_main.wrangler.json`](../scripts/console_946_reviewed_main.wrangler.json).
It uses synthetic resource names, no account IDs or credentials, compatibility
date `2026-06-08`, placement off, and the checked-in closed read-model and
external-flow defaults. It includes the SQLite binding and migration from the
source example. This is the repository reconstruction config; deployment-time
bindings, secrets and overrides have not been read or compared.

From the repository root, with Node and npm at the pinned versions and no
provider credentials, run these exact commands:

```bash
git fetch --no-tags origin 9b695a4ade90bcc9931f53109e0ad33f63407927
export RUNNER_TEMP="$(mktemp -d)"
bash scripts/console_946_reviewed_main_build.sh
```

The builder archives the fixed commit into a fresh directory, runs `npm ci` for
the Worker and frontend, then `npm run build` and `npm run sync:v2-assets` for
the frontend. Its exact module build command, run twice from the archived
`web/strategy-switch-console` directory, is:

```bash
npx --yes wrangler@4.106.0 deploy --dry-run --config wrangler.json --outdir "$result"
```

The second invocation uses a separate output directory. Both complete modules
must be byte-identical and match the pinned SHA-256. Telemetry and Cloudflare
remote fetching are disabled. No deploy or Cloudflare API request is performed.
Build logs and artifacts remain under `RUNNER_TEMP`, outside tracked files.

## Verification limits

**Live-hash verification: PENDING — not verified against the live deployment.**
Live configuration verification is also pending. The repository build does not
establish the current active deployment or prove that historical deployment-time
inputs produced these bytes. A different live hash continues to fail closed.

The runtime check in `console_946_active_dry_run.mjs` still executes only the
fixed historical #946 test candidate after classification. Its
`candidate_runtime_passed` result does not validate the later main release's
runtime behavior or its live configuration. This baseline grants no release,
rollback, configuration-change or trading authorization.
