# Strategy Switch Console Worker

## Effective account-setting sources

Authenticated `GET /api/account-settings` preserves the existing `effective` value shape and adds a separate seven-field `effective_read` map. Each metadata entry has `source=github_runtime_configuration`, `reason`, and `source_as_of=null`. The source names the existing account-matched GitHub runtime-configuration resolver, not a specific variable, deployed state or broker readback. The reader has no reliable field source timestamp. Existing known values, resolver precedence, identity, draft and write authority are unchanged. Non-DCA value fields remain absent so existing clients do not display an unverified DCA plan.

Missing reader configuration, repository mapping or account configuration produces unknown fields with `reader_not_configured`, `repository_not_configured` or `account_config_unavailable`. HTTP/network/JSON/list-shape failures, including a failed later page, produce `runtime_configuration_read_failed` for all seven fields without preserving earlier values or exposing upstream errors. A successful read that cannot resolve a field uses `runtime_setting_unresolved`; this does not distinguish absent, invalid or unmatched input. DCA fields use `dca_not_applicable` only for an unsupported platform or known non-DCA profile; an unresolved strategy uses `strategy_profile_unresolved`. Read failure takes priority. Known values have `reason=null`; explicit zero and false remain values. Unknown effective values have no `value`; metadata never contains values.

`GET /api/account-settings/diff` exposes the same information per row as `current_source`, `current_reason`, `current_source_as_of`, with unknown `current=null`. Legacy inputs without metadata use null source/time and `effective_field_unavailable`. HTTP 200 means the state projection was read, not that all effective values are known; existing authentication, storage failure and identity-conflict HTTP/status semantics remain. No zero fill, interpolation, stale-value fallback or default inference is performed. These endpoints do not change account parameters or prove that production source permissions or deployment are healthy.

## Reading by task

[Documentation index](../../docs/README.md) · [中文目录](README.zh-CN.md#按任务阅读)

- **Install and configure:** [platform directory](#platform-directory-configuration), [required secrets](#required-secrets), [GitHub OAuth](#github-oauth-app), [Wrangler deployment](#deploy-with-wrangler).
- **Interfaces:** [operator model](#operator-model), [account dropdowns](#account-dropdowns), [strategy profiles](#strategy-profile-alignment), [account facts/history](#account-facts-and-history-disabled-by-default), [API reference](../../docs/console-api.md).
- **Operate safely:** [stop-only boundary](#current-stop-only-boundary), [human decisions/readback](#human-decision-receipts-and-exact-read-back), [recovery intent](#existing-live-recovery-verification), [token scope](#token-scope).

These links group the existing sections; their permission, unknown-result and configuration-only limits still apply. Deployment examples require separately authorized target configuration.

[简体中文](README.zh-CN.md)

[Control-plane source retirement](../../docs/control-plane-source-retirement.md)

Alpaca Market Data supplies US equity research inputs; no Alpaca trading target is currently configured. The extra `alpaca` observability identifier preserves historical/research evidence compatibility and does not create a trading account or grant runtime control. Keep data-source health separate from execution heartbeats. The retained AlpacaPlatform shadow/paper contracts are not a deployment. IBKR Gateway is a connection/session component; QMT is an A-share adapter without a configured broker target. Account controls follow actual configured targets, not the repository inventory.

This is the authenticated backend for the personal strategy switch console. It is intentionally thin:

- Visitors who are not signed in, or are not in the allowlist, can only view the public page.
- Allowlisted GitHub logins can select an account from the dropdown and click `Switch now`; the Worker triggers the GitHub Actions workflow server-side.
- Tokens stay in Worker secrets and GitHub Actions environment secrets. They are not sent to the browser or committed to the repository.

## SOXL validation result publisher

`AAB_VALIDATION_SYNC_TOKEN` is an optional, separate credential for AIAuditBridge's
`aiaudit.soxl_manual_validation` source on `POST /api/internal/sync-control-plane-source`.
It accepts one `soxl_three_asset_mid_weight_validation_<run_id>` record whose
evidence refers to that run, with domain `us_equity`, lifecycle `P3/parked` and
recommendation `park`. It does not authorize other sources, research decisions,
runtime controls or the aggregate control-plane endpoint. The original
`CONTROL_PLANE_SYNC_TOKEN` remains available to existing publishers.

After explicit credential/deployment authorization, generate a distinct random
value in a restricted client and bind it without printing it to this repository's
`runtime-strategy-switch` environment and the AIAuditBridge repository secret of
the same name. Do not reuse a task, promotion, runtime or personal token. The
existing console deploy workflow installs this optional Worker secret; deploy
the accepting Worker before invoking AIAuditBridge's existing `publish_validation`
operation. A failure or unknown result stops publication; inspect before retrying.
Removing the new credential disables only this publication path. No migration
or rotation of the original control-plane credential is required.

## Current stop-only boundary

Choosing Disabled on the account runtime control and submitting the main action enters `/api/runtime-stop` and `manual-runtime-stop.yml`, without requiring the current strategy to be re-listed. Authentication, same-origin and an exact configured target remain required. There is no separate "save disable configuration only" button. The request accepts only platform, target name and `STOP_ONLY`; routing comes from server configuration, not editable strategy/risk/account form fields.

The workflow only saves and verifies GitHub disable configuration. It does not dispatch a platform workflow, authenticate to a cloud provider or update a running service. The CLI has no `--apply-platform` option. `configured=true` means the desired setting was verified; `platform_applied=false` means application is not established, so the UI must show unknown rather than stopped. No environment sync, cancellation, liquidation or guarantee of in-flight completion is implied. The existing `manual-strategy-switch.yml` activation-apply hard reject remains; it is not a stop-only channel.

Complete repository/environment reads preserve variable ownership and actual consumer precedence, including LongBridge's exact-service top-level enable override. Values travel through stdin, not logs or command arguments. Stop and switch share platform-level workflow concurrency because targets can share an inventory variable. Before/after comparisons are not an atomic CAS against outside administrators: other configuration writers must stay inactive. Ambiguous writes are never retried automatically; check the original request. Both UI entry points share the pending/unknown lock.

### Retained Cloud Run extension (disconnected from this configuration path)

The following adapter/action, their independent tests and four platform workflow drafts are retained, unpublished follow-on work. They are not required for G07 configuration-only acceptance and must not be included automatically in its release. The console, controller workflow and configuration CLI no longer invoke them. Retained executable files are not disabled if someone explicitly runs them; any future adoption needs a separately bounded decision.

`actions/stop-cloud-run-runtime` consumes a temporary access token generated by the platform's existing deployment identity, without a credentials file or a second gcloud authentication owner. The request is read from `GITHUB_EVENT_PATH`, and current configuration is read in-process through a restricted GH client, not dumped into runner env/with logs. The exact resource is derived from current configuration and bound identity. Caller validation runs before authentication and again before application; ordinary action inspection is the default, and writes require `apply=true` and `STOP_ONLY`.

It sends at most one etag-bound, narrow-field PATCH changing the existing `RUNTIME_TARGET_ENABLED` to false, preserving other environment values, strategy, account, risk and container settings. Because an environment update creates a revision, it only accepts a stable single-container service with a pinned image digest, numeric secret versions and all traffic following latest. Split/tagged traffic, reconciliation, mutable image/secret references, identity conflicts and unsupported shapes are rejected rather than repaired with broad deployment. The existing lifecycle publisher remains read-only.

After submission it observes the same operation and reads the actual serving revision. Conflict, timeout, failure or drift remains unverified, with no second PATCH or rollback. Success describes the standard execution flag at that instant, not completion of in-flight work, closure of every special execution entry, cancellation, liquidation or financial reconciliation. The earlier caller integration had synthetic tests; that historical result does not describe the now configuration-only web path. Released pins, remote CI and real Cloud Run validation remain incomplete.

Historical extension prerequisites (not current tasks or configuration-only prerequisites):
- LongBridge uses only its existing `longbridge-paper`, `longbridge-hk` and `longbridge-sg` environments. IBKR/Schwab/Firstrade retain repository/main/WIF boundaries and repository scope; no new runtime-stop approval environment is created. A skipped incompatible job is not a successful stop.
- Any separately approved future adoption needs a real published `QRT_RUNTIME_STOP_REF`, not a placeholder SHA. The four platform workflows are not part of the current configuration-only change. Optional `RUNTIME_SETTINGS_REPOSITORY` selects only an approved source repository.
- Supply matching deployment configuration through `GCP_PROJECT_ID` and `CLOUD_RUN_REGION`, and the same existing identity through `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT`; do not automatically migrate configuration or widen IAM.
- The existing platform GitHub token must read repository Variables and applicable Environment variables. If the built-in token is insufficient, confirm the existing approved client; an approved repository-only read token may be supplied as `RUNTIME_STOP_CONFIG_READ_TOKEN`. Do not copy a global configuration-write token or retry with another identity after refusal. Actual permissions remain unverified.
- Confirm service applicability in one authorized readback: single container, immutable image/secret versions and supported traffic. Actual validation also needs authorization, an adopted version and handling of pending requests; it does not require repeating the organization-wide audit or enabling a strategy.

## Platform directory configuration

- `platform-config.json` → `platforms` supplies labels, codes, colors, repositories, default accounts and capabilities. Menu order follows the platform order in that file.
- Set deployment variable `STRATEGY_SWITCH_HIDDEN_PLATFORMS` to comma-separated IDs to hide supported platforms (`qmt` hides QMT; an empty string shows all). Visibility does not disable trading or delete accounts/adapters.
- After catalog edits, run `python3 python/scripts/build_platform_config.py`, then test and deploy. Do not edit generated `config.js` or `strategy_profiles_asset.js` manually. The console page is the React app under `frontend/`.
- Frontend and backend use the same bundled catalog, not an independently fetched GitHub main. A new broker still needs an adapter and capability support before it can trade.

## Operator model

The web surface is for low-frequency human intervention, not a trading or P&L dashboard:

The interface uses a white canvas, a single deep teal accent and compact tables. Narrow screens use horizontal platform navigation and a horizontally scrollable account table that also accepts keyboard focus.

- **Decisions and accounts** is the daily surface: pending research candidates, owner decisions and reconciliation confirmations precede the account list. Completed items leave the confirmation area; a failed research queue read is unavailable, never an empty queue.
- Each account shows its configured strategy and switch, actual switch, scheduling, application status, observation age and one next step. Missing or stale readback stays unknown; an aligned switch with unknown scheduling is not shown as applied.
- **Strategy settings** starts collapsed. Clicking an account or “Review settings” only opens and selects that account; it does not save or enable anything. The existing main action handles enable/switch, while disable uses `STOP_ONLY`. A saved setting does not prove the platform stopped. Plugins, income and options remain under advanced settings; selection grants no runtime permission.
- Candidate confirmation remains outside strategy settings. Accept/reject records intent only, without account binding, paper/live enablement or replacement of a running strategy. The intended platform is explicit; risk-scale meanings and candidate IDs are in details. Submission feedback stays visible when settings are collapsed.
- Engineering monitoring and research diagnostics have no operator entry point. Pending recovery confirmations remain visible independently. There is no pretend AI-repair button.
- An account may configure optional `runtime_status_target_id` to reference an existing lifecycle `target_id`. Matching requires the same platform and a one-to-one link; missing, duplicate or stale records cannot look healthy. This display-only field is not sent to trading workflows. Monitoring success does not prove an order or fill.
- If no strategy meets all release, runtime-eligibility, and evidence gates, the page disables the Live choice. It never changes configuration automatically or treats health, candidates, or historical `live` metadata as order or runtime authority.

Submitting a plan still uses the existing GitHub Actions configuration workflow and writes an audit record. P4/P5/P6 and all live authority remain subject to independent, verifiable lifecycle contracts.

## Required Secrets

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

Optional variables:

```text
RUNTIME_SETTINGS_REPO=QuantStrategyLab/QuantRuntimeSettings
RUNTIME_SETTINGS_WORKFLOW=manual-strategy-switch.yml
RUNTIME_SETTINGS_REF=main
STRATEGY_SWITCH_PLATFORM_REPOSITORIES_JSON={"longbridge":"your-org/LongBridgePlatform","ibkr":"your-org/InteractiveBrokersPlatform","schwab":"your-org/CharlesSchwabPlatform","firstrade":"your-org/FirstradePlatform"}
STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON=<contents of account-options.example.json>
```

Forks can also override one platform at a time with `STRATEGY_SWITCH_LONGBRIDGE_REPO`, `STRATEGY_SWITCH_IBKR_REPO`, `STRATEGY_SWITCH_SCHWAB_REPO`, and `STRATEGY_SWITCH_FIRSTRADE_REPO`. The GitHub Actions workflow supports the same mapping with `RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON` or `RUNTIME_SETTINGS_*_REPO` repository variables.

`ALLOWED_GITHUB_LOGINS`, `ALLOWED_GITHUB_ORGS`, `STRATEGY_SWITCH_ADMIN_LOGINS`, and `STRATEGY_SWITCH_ADMIN_ORGS` are comma-separated lists. Prefer the organization name for admin access:

```text
STRATEGY_SWITCH_ADMIN_ORGS=QuantStrategyLab
STRATEGY_SWITCH_ADMIN_LOGINS=your-github-login
```

The login entrypoint is `/login` on the Worker domain. The page header keeps a single Login Management entry. After sign-in, `/api/session` returns:

```json
{
  "authenticated": true,
  "login": "your-github-login",
  "allowed": true,
  "admin": true
}
```

`admin=true` means the login or one of its GitHub organizations is listed in `STRATEGY_SWITCH_ADMIN_LOGINS`, `STRATEGY_SWITCH_ADMIN_ORGS`, or the KV-backed admin config. The console has no `/admin` page; that address returns the same 404 as any other unknown page. Login lists, organizations, and account routes stay in those variables and KV.

Account options may include `broker_environment: "live"` or `"paper"`. A missing value remains unknown for backward compatibility and cannot be selected for a new research promotion acceptance. `broker_environment` describes the broker account environment; `default_execution_mode` still describes the adapter mode (`live` or `dry_run`). LongBridge supports an explicit paper broker account with a live adapter, while IBKR is currently live-only. These candidate selections record research intent and do not activate an adapter.

## Admin Management

GitHub OAuth 2.0 is the only login method. The Worker requests the `read:org` scope to verify GitHub organization membership. Put `QuantStrategyLab` in `STRATEGY_SWITCH_ADMIN_ORGS`, and keep your own GitHub login in `STRATEGY_SWITCH_ADMIN_LOGINS` as a break-glass admin.

For editable admin settings, bind a Cloudflare KV namespace named `STRATEGY_SWITCH_CONFIG`. The Worker uses these KV keys:

```text
auth_config
account_options
strategy_profiles
risk_profile_bindings
audit_log
private_binance_scope_report
```

Without the KV binding, the Worker falls back to `ALLOWED_GITHUB_LOGINS`, `ALLOWED_GITHUB_ORGS`, `STRATEGY_SWITCH_ADMIN_LOGINS`, `STRATEGY_SWITCH_ADMIN_ORGS`, and `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`. The console does not edit those values.

## Portfolio Risk Preference (non-executable intent)

Administrators select Capital Preservation, Balanced Compounding, or Growth Compounding for a configured platform target on the account settings page. Same-origin, admin-only `GET` / `POST /api/risk-profiles` stores a self-validating `qsl.risk_profile_binding.v1` record under `risk_profile_bindings`; its portable selection is exactly `qsl.risk_profile_selection.v1`, the contract used by the core risk composer.

**Dual-scale clarification**: the same preference name carries two non-interchangeable numbers — Composer unlevered-benchmark MDD ceilings are `CAPITAL_PRESERVATION` 1.00 / `BALANCED_COMPOUNDING` 1.25 / `GROWTH_COMPOUNDING` 1.50; promotion `promotion_sizing` position scales are 0.50 / 0.75 / 1.00 and apply only to new promotions or material changes, never to recompute an existing live book, and never mean “position × 1.5”. This page stores preference intent only; it does not write production policy or weaken RiskEngine.

Every record is fixed to `no_order=true` and `execution_authority_granted=false`. It never enters `RUNTIME_TARGET_JSON`, changes strategy parameters or sizing, dispatches a workflow, accesses brokers or execution cloud resources, or enables paper, shadow, or live. A malformed KV record is unavailable rather than silently defaulted. A future independent, read-only control-plane adapter may consume only `profile_selection`, after separately validating observation evidence and all P4/P5/P6 gates.

## Web Owner Decisions (P6 intent)

Only a fresh P6 candidate with `owner_decision_required` and an `owner_live_decision` recommendation appears in the owner-decision area. Console administrators can record a limited-canary intent or keep the candidate parked. Retirement requires its separate proposal path.

`POST /api/owner-decisions` stores a `qsl_owner_decision_intent.v1` bound to the current P1/P2/P3/revision evidence fingerprint. The existing RuntimeInstances `human_decision_record` is the persistence authority; KV indexes and audit entries are convenience mirrors. If the candidate, stage, or evidence changes, an old receipt never completes the new material. Any new decision requires a fresh review.

This is not an execution API: every intent is fixed as `no_order=true` and `execution_authority_granted=false`. It does not dispatch a workflow, call a platform or broker, change funds, or enable Live. Only a future independent deterministic execution gateway may consume an intent after it verifies all current P4/P5/P6 conditions.

## Human decision receipts and exact read-back

Owner, recovery and promotion decisions return an additive `decision_receipt` only from a validated persisted terminal record. The bounded `qsl_human_decision_receipt.v1` projection (or `.v2` for a qualified promotion review) contains the kind, subject, exact material SHA-256, action, original actor/time, fixed logical target and stable receipt digest. Promotion receipts preserve the originally selected logical account, including historical records after rejection removes a ticket from the current queue. Raw request keys, stored payloads, broker account numbers and credentials are not exposed. No new table, execution authority or workflow is introduced.

The existing GET paths `/api/owner-decisions`, `/api/reconciliation-recovery` and `/api/research-promotion-tickets` accept the pair `decision_subject_id` and `decision_material_sha256` for one exact-material `qsl_human_decision_readback.v1`. This branch requires an allowed admin session, rejects an explicit cross-origin request, accepts a normal same-origin GET without an Origin header and uses `Cache-Control: no-store`. It queries the existing durable record index even when the source is removed, stale, ineligible or replaced. `not_found` describes only that completed lookup; it never authorizes resubmission. Missing/unreadable authority returns unavailable, without a legacy KV fallback. Current-material diagnostic flags cannot grant authority to act on a historical receipt.

Ordinary queues add a server-derived `decision_binding`. The new UI binds every confirmation to login, kind, subject, material index, complete promotion review, action and exact target. Promotion sends both `expected_material_sha256` and `expected_review_sha256` for accept and reject, alongside existing candidate/account guards. The existing six-field material SHA-256 remains the durable terminal index; it is not a hash of the complete review. The independent `qsl_promotion_review_binding.v2` covers the immutable saved producer review projection: candidate/shadow fields, notes and evidence hashes, research summary/comparison/limitations/AI binding, drift, budget, search iterations, suggested risk and static review text. Observation timestamps and decision-generated terminal fields are excluded. The original review snapshot/hash is stored in the same record payload and compared atomically against current material-summary metadata inside the DO transaction. No historical index or terminal record is rekeyed or rewritten. Legacy callers without the review hash retain their prior contract and v1 receipts; they do not gain v2 qualification.

The UI maintains independent ACK and exact-read-back facts. It uses synchronous same-material locks across opposite actions/account choices, rejects malformed ACKs, ignores superseded-session results and preserves a successful ACK if later reads fail. Unknown submissions allow GET rechecks only, never automatic POST retries. Results remain visible when the pending queue becomes empty. The decision transport times out after 15 seconds; a timeout does not prove the request was rejected.

A bounded sessionStorage locator (at most 24 operations / 48 KiB) is persisted and read back before POST. It contains only origin, a derived login namespace, exact logical binding/target, request ID and start time; no tokens, session object, full material, native account numbers or balances. Same-tab reload restores GET-only checks after authentication. Storage failure/corruption blocks new submissions rather than silently discarding unresolved work. At capacity, only exact-GET verified entries can retire, with the shortened journal persisted successfully before their in-memory locks are removed. Unknown, submitting, ACK-only, conflict and unqualified legacy entries are retained. A full unresolved list pauses new work but can recover capacity after a verified read, without logout. Logout clears private state and the locator; closing the tab or clearing browser data is outside this recovery guarantee. Original actor/time are shown for replayed or already-consistent records.

Rollout is staged: deploy the receiver/test/documentation group while retaining the currently deployed frontend. Ordinary old-client decisions remain compatible even when a pre-upgrade row lacks review metadata. Wait for the normal producer sync and read-only GET evidence showing a matching v2 review binding for every current pending promotion before adopting the client/assets group. GET never writes or certifies old rows; well-formed existing v1 receipts remain observable but unqualified for v2. A historical record missing or contradicting its required original target stays unavailable; this change does not broaden legacy import or reconstruct missing confirmation/account data. Missing readiness keeps the old client deployed. Do not force a source run or submit a production decision to manufacture readiness.

Validation: `node tests/human_decisions_worker_validation.mjs` explicitly uses `cf:false`, the workflow's existing disabled-CF-fetch contract, a host-side external-deny/loopback-only guard and a separate rejecting Worker outbound hook. It exercises all six decision outcomes and durable restart/history/auth boundaries; `node --experimental-strip-types tests/decision_readback_ui_validation.mjs` covers synthetic interrupted transport, session isolation, reload, locks and actual React server rendering. `node --experimental-strip-types tests/decision_review_material_pure_validation.mjs` verifies pure review/version projections under an all-network guard without Miniflare. The previously blocked independent review invocation is not a passing test; the new isolated guarded harness has separate evidence. These tests do not substitute for browser interaction, a production deployment or a real operator decision.

## UX1 local research

The research draft stays on the existing RuntimeInstances path. Persistent local use reads one private operator config and listens on `127.0.0.1` only:

```bash
node web/strategy-switch-console/ux1_local_demo.mjs start --config /absolute/path/ux1-local.json
node web/strategy-switch-console/ux1_local_demo.mjs status --config /absolute/path/ux1-local.json
node web/strategy-switch-console/ux1_local_demo.mjs stop --config /absolute/path/ux1-local.json
```

The config names a fixed interpreter, one installed UES program that reads a single JSON request on stdin and writes one JSON result on stdout, approved input roots, a stable `state_root`, a loopback port, and a login. `state_root/durable` is the Miniflare Durable Object directory for the draft, revision, and intent receipt. `state_root/session` is a mode `0600` session token for this process only; restart writes a new token and requires the operator to authenticate again. The token and auth secret are not stored in the durable draft and are not printed. `stop` signals only the pid recorded for this config when its command line is still this demo. `status` prints running or stopped, the listen URL, and the state root.

A failed, timed-out, disconnected, or rejected calculation clears the stored preview so the previous result is not the current one. A preview from an earlier process epoch, including a pre-RC1 preview with no epoch, is returned as stale until recomputed; the draft, revision, and existing intent receipt stay. Decision date `2023-03-29` stays separate from the next-day historical execution check on `2023-03-30`. The calculator child uses `shell: false`, a 30 second timeout, a 65536 byte stdout cap, and one in-flight process (`calculator_busy` when busy). Its environment is limited to `PATH`, `HOME`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TMPDIR`, `TZ`, and the three approved input paths.

The flag form without `start` still creates a temporary state directory and does not survive restart. This local binding is not a production service binding. Do not commit the operator config.

## Page

`worker.js` serves the React console from `v2_asset_map.js`. The strategy catalog fallback is `strategy_profiles_asset.js`, generated by `python3 python/scripts/build_platform_config.py`.

## Account Dropdowns

The Worker page ships sample targets as a fallback. After sign-in, switching stays disabled until the Worker loads configured account options; the Worker also rejects dispatches without matching account config. Copy the example and fill in your real target/account routes:

```bash
cp web/strategy-switch-console/account-options.example.json /tmp/strategy-switch-accounts.json
```

Store it as a Worker secret:

```bash
cd web/strategy-switch-console
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

After `STRATEGY_SWITCH_CONFIG` is bound, KV account config takes precedence over the secret; the secret remains a fallback. The console does not edit that JSON.

Each account item supports:

```json
{
  "key": "ibkr-primary",
  "label": "ibkr-primary",
  "target_name": "ibkr-primary",
  "account_selector": "DEMO_IBKR_PRIMARY",
  "deployment_selector": "demo-ibkr-tqqq",
  "account_scope": "demo-ibkr-tqqq",
  "service_name": "interactive-brokers-demo-ibkr-tqqq-service",
  "cash_currency": "USD",
  "supported_domains": ["us_equity", "hk_equity"]
}
```

The Worker validates dispatch inputs against this config, including whether the selected strategy domain is supported by the selected account. Keep only routing metadata here. Do not store broker passwords, tokens, or API keys in this config.

`/api/strategy-profiles` returns the public live-enabled strategy catalog for the dropdown. It reads the KV `strategy_profiles` key first, then `STRATEGY_SWITCH_STRATEGY_PROFILES_JSON`, then `strategy-profiles.example.json`.

For signed-in users, `/api/config` also reads the target repositories' current GitHub Variables. It prefers account-specific `CLOUD_RUN_SERVICE_TARGETS_JSON`, then matching `RUNTIME_TARGET_JSON.strategy_profile`, then `STRATEGY_PROFILE`. If no strategy is configured in GitHub variables, the page shows an empty (unconfigured) state rather than falling back to a hardcoded default.

The switch form also accepts optional reserved-cash overrides: minimum reserved cash in the selected account currency and reserved-cash ratio. Set `cash_currency` to `USD` or `HKD` in account config when the account has a fixed cash currency; otherwise the page infers HKD for HK-equity strategy selections and USD for US-equity selections. Keeping the current policy leaves existing platform variables unchanged; when no explicit platform variables are configured, the platform source default is no extra reserve (`0` in the account currency and `0%`). When set, the Worker passes the values to `manual-strategy-switch.yml`, which writes the platform-specific variables such as `IBKR_MIN_RESERVED_CASH_USD` and `IBKR_RESERVED_CASH_RATIO`.

Income-layer controls are sourced from `strategy-profiles.example.json` metadata for live-validated US equity strategies. The switch form can keep the current setting, enable the income layer with the profile default start amount and cap, or disable it. Option-layer controls use the same strategy profile metadata but only expose a three-state policy: keep current, enable the profile default recipe and budget, or disable and clear option overlay variables. Manual switch requests still cannot override direct option overlay or LEAPS fields through `extra_variables_json`; the Worker and build script reject those direct overrides.

Successful strategy switches sync account-level settings (plugin_mode, option_overlay_mode, cash_only_execution_mode, DCA mode) back to the KV `account_options` key. The strategy profile itself is stored only in GitHub variables (`RUNTIME_TARGET_JSON` / `STRATEGY_PROFILE`) and is not duplicated in KV.

## Strategy Profile Alignment

Treat `strategy_profile` as the canonical strategy id across the switch console, runtime settings, and platform repositories.

When adding or renaming a strategy profile:

- Add the runtime-enabled profile id and display label to `strategy-profiles.example.json`.
- Run `python3 python/scripts/build_platform_config.py` so `strategy_profiles_asset.js` is regenerated.
- Set `domain` on each strategy profile. Current values are `us_equity` and `hk_equity`.
- Set each affected account's `supported_domains` in `account-options.example.json` and the deployed KV account config. Strategy profiles are managed exclusively through GitHub variables via the strategy switch workflow.
- Use `["us_equity", "hk_equity"]` for LongBridge and IBKR accounts unless you intentionally want to narrow a specific account.
- The main-branch deploy workflow updates the deployed KV `strategy_profiles` key from `strategy-profiles.example.json` after deploying the Worker. For manual deploys, call `/api/internal/sync-strategy-profiles` with the Worker sync token.
- Make sure the platform repository's current `RUNTIME_TARGET_JSON.strategy_profile` or account-specific `CLOUD_RUN_SERVICE_TARGETS_JSON` uses the same id.
- Let `manual-strategy-switch.yml` manage platform plugin mounts. It writes an empty `*_STRATEGY_PLUGIN_MOUNTS_JSON` payload for strategies without plugin mounts, so old strategy plugin config is cleared instead of lingering.
- Use lower-case ids with letters, numbers, dot, underscore, dash, or equals only. Do not encode account names or secrets in profile ids.

The console only allows live-enabled profiles whose `domain` is included in the selected account's `supported_domains`. If a profile is dynamically read from GitHub Variables but is missing from the catalog, add it to the catalog before switching to it.

## Existing Live Recovery Verification

An already authorised target that entered `RECONCILE_ONLY` uses a separate, non-executable recovery path rather than the P6 new-strategy queue. A private runtime publishes a redacted `qsl_reconciliation_recovery_source_snapshot.v1` to `POST /api/internal/sync-reconciliation-recovery-source` with a dedicated `RECONCILIATION_RECOVERY_SYNC_TOKEN`; allowlisted users read `GET /api/reconciliation-recovery`, and an administrator may record `POST /api/reconciliation-recovery-confirmations`. A platform-owned controller reads only the current confirmation binding from `GET /api/internal/reconciliation-recovery-confirmation?recovery_id=...`, protected by a different `RECONCILIATION_RECOVERY_CONTROLLER_TOKEN`.

An item can await confirmation only when it remains `RECONCILE_ONLY`, has one or more source-bound read-only samples within a 15-minute ordered observation window, has a current candidate digest bound to the published row, and has no blocker. Model-review outcome and reviewer count remain visible advisory information; they do not grant or veto confirmation. Source and candidate evidence expire after 30 minutes by default. The confirmation is an immutable `no_order=true`, `execution_authority_granted=false` intent only: it cannot dispatch a workflow, read broker credentials, change an account, restore runtime, or place an order. A private platform controller must re-verify its protected source before it may restore the pre-existing runtime; `manual-strategy-switch.yml` rejects all legacy continuity states so it cannot bypass this boundary.

## Private Binance Asset List

A restricted collector on Oracle may use the existing `RECONCILIATION_RECOVERY_SYNC_TOKEN` to submit the current Binance account's minimal asset list to `POST /api/internal/binance-private-scope`. The Worker writes only the fixed `private_binance_scope_report` KV key with a 24-hour physical TTL. Observations must be no more than 10 minutes old and may be at most 60 seconds in the future. The success acknowledgement contains only the observation time, source run ID, and asset count; asset details never enter the ordinary audit, health, recovery, or admin aggregates.

`GET /api/binance-private-scope` requires both an allowed session and administrator status. Anonymous requests receive 401 and non-admin sessions receive 403. Missing, malformed, or older-than-24-hour records return `report: null`. The console shows the independent list only for an administrator viewing Binance, renders fixed-point quantities as text, and immediately clears it on logout, permission loss, or read failure. It does not persist the list in the browser, collect broker data, or expose remediation, confirmation, or order controls.

## GitHub OAuth App

Create a GitHub OAuth App:

- Homepage URL: your Worker URL
- Authorization callback URL: `https://your-worker-domain/callback`

Store the client ID and client secret in Worker secrets.

## Deploy With Wrangler

The manual **Diagnose Active Console Module** workflow performs a read-only
inspection of the single 100%-active Worker version. Supply the full reviewed
main commit SHA; the workflow checks the checkout and current remote main before
and after inspection. It reports bounded module shape and diagnostic code-pattern
booleans without logging the module, version
IDs, configuration, or credentials. The patterns are hints only: they do not
prove that a backend-only patch is safe, nor do they authorize or perform a
release. If traffic is split, the module shape is unsupported, or its two
observations of the active deployment differ, the workflow fails closed. Matching observations do not rule
out an intervening change. The existing **Deploy Strategy Switch Console**
workflow also runs this probe for the plain `read_only_preflight` mode with the
other release, rollback and special-check inputs disabled and `source_sha` empty.

The manual workflow also has a default-off `backend_only_release` mode for the
fixed reviewed history and native-return repair. It requires the active module
to match the fixed 54e build byte for byte and applies only the three reviewed
functions. It explicitly inherits bindings from the active version, verifies the
candidate and readable version configuration, and rechecks observations around
activation. Secret values cannot be read back. These observations do not form an
atomic compare-and-swap; a failed or uncertain write requires read-only review
rather than automatic retry or rollback.

Copy the example config:

```bash
cp web/strategy-switch-console/wrangler.toml.example web/strategy-switch-console/wrangler.toml
```

Set secrets:

```bash
cd web/strategy-switch-console
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put RUNTIME_SETTINGS_DISPATCH_TOKEN
wrangler secret put STRATEGY_SWITCH_SYNC_TOKEN # optional; defaults to RUNTIME_SETTINGS_DISPATCH_TOKEN
wrangler secret put M0_RESEARCH_SYNC_TOKEN
wrangler secret put RESEARCH_PROMOTION_SYNC_TOKEN
wrangler secret put RECONCILIATION_RECOVERY_SYNC_TOKEN
wrangler secret put RECONCILIATION_RECOVERY_CONTROLLER_TOKEN
wrangler secret put ALLOWED_GITHUB_LOGINS
wrangler secret put ALLOWED_GITHUB_ORGS
wrangler secret put STRATEGY_SWITCH_ADMIN_LOGINS
wrangler secret put STRATEGY_SWITCH_ADMIN_ORGS
wrangler secret put STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON < /tmp/strategy-switch-accounts.json
```

`RESEARCH_PROMOTION_SYNC_TOKEN` guards:
- `POST /api/internal/sync-research-promotion-ticket` (QPK soft-sync of awaiting tickets)
- `GET /api/internal/research-promotion-ticket?ticket_id=...` (QPK pull of console decisions)

QuantPlatformKit must send the same value as `RESEARCH_PROMOTION_SYNC_TOKEN`, with
`RESEARCH_PROMOTION_SYNC_URL` pointing at the sync endpoint (pull URL is derived from it).
Soft-sync never grants live authority; accept/reject on this console only records operator intent.

Create and bind KV so account settings and audit records can be stored:

```bash
wrangler kv namespace create STRATEGY_SWITCH_CONFIG
```

Add the returned namespace id to `wrangler.toml`.

For GitHub Actions auto-deploy, configure `STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID`, `STRATEGY_SWITCH_CONSOLE_URL`, `STRATEGY_SWITCH_SYNC_TOKEN`, `M0_RESEARCH_SYNC_TOKEN`, and either `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_WRANGLER_CONFIG_TOML` in the `runtime-strategy-switch` environment (or reuse `RUNTIME_SETTINGS_GH_TOKEN` only if it matches the Worker sync secret). Add `RESEARCH_PROMOTION_SYNC_TOKEN` when QPK soft-sync should publish awaiting-human tickets into this console; deploy copies it to the Worker only when present. Add separate `RECONCILIATION_RECOVERY_SYNC_TOKEN` and `RECONCILIATION_RECOVERY_CONTROLLER_TOKEN` values before enabling a recovery publisher/controller; the deploy synchronizes each only when present, and the Worker rejects an equal pair. `CLOUDFLARE_ACCOUNT_ID` is optional when Wrangler can infer it from the token. `M0_RESEARCH_SYNC_TOKEN` must match the separately protected `m0-research-publisher` environment secret; it is only copied to the Worker binding. A missing M0 token fails the deployment before it can retain a stale Worker secret. The workflow deploys the Worker and then syncs the bundled strategy profile catalog into KV so the website is not left with stale profile/plugin metadata.

An authenticated retry carrying the exact same immutable M0 source-artifact SHA is acknowledged with `200` and `replayed: true`, without another KV write. A different source/run replay or a ledger-time rollback remains rejected with `409`.

Deploy:

```bash
wrangler deploy
```

For a full fork checklist, see [docs/strategy-switch-fork-guide.md](../../docs/strategy-switch-fork-guide.md).

## Token Scope

`RUNTIME_SETTINGS_DISPATCH_TOKEN` only needs permission to dispatch workflows in the `QuantRuntimeSettings` repository. Cross-platform variable writes still happen inside `Manual Strategy Switch` with the GitHub Actions environment secret `RUNTIME_SETTINGS_GH_TOKEN`.

Configure `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON` as a secret if it contains real account routes. It is returned only after an allowlisted login. Keep broker, email, cloud, API key, and token values out of this config.

For the layered store model (Secret Manager / GitHub Environments / Worker secrets / redacted UI), see [docs/secrets-architecture.zh-CN.md](../../docs/secrets-architecture.zh-CN.md). Keep production routes out of public git; use `account-options.example.json` as a shape-only template.

Operator simplification: compatible strategies remain browsable even when live submission is blocked. Existing execution authorization checks are unchanged. Engineering health/research diagnostics have no operator-page entry point; APIs remain available. A configuration/last-check mismatch is not proof of current deployed state.

## Account facts and history (disabled by default)

Account-facts routes require `ACCOUNT_FACTS_READ_MODEL_ENABLED=true`, the existing configuration store and `STRATEGY_SWITCH_RUNTIME_INSTANCES` Durable Object. The deploy workflow renders the same-named non-secret variable from the `runtime-strategy-switch` GitHub Environment into Wrangler config; an empty value means `false`, and any other value is rejected before deploy. Enabling it also requires `ACCOUNT_FACTS_SYNC_TOKEN` to be non-empty, have no surrounding whitespace, and contain no HTTP control characters before deploy. LongBridge sync POSTs use that token. IBKR sync POSTs require the separate optional `IBKR_ACCOUNT_FACTS_SYNC_TOKEN`; when present it must be free of surrounding whitespace and HTTP control characters. The tokens must differ; a missing IBKR token rejects IBKR writes without falling back to the LongBridge token. GET `/api/account-facts` and `/api/account-facts/history?platform=longbridge&account_key=…&currency=USD` require the existing authorized session. There is no KV write fallback. Tokens are used only for preflight and Worker secret sync, never written to Wrangler TOML. Enabling the flag or configuring a token does not approve a production source.

GET `/api/account-facts` adds `asset_coverage` for the existing account-facts totals only (`scope=account_facts_totals`, `source=validated_account_facts_snapshot`). Its `totals_status`/`totals_reason` mirror `totals`; each configured account has only `platform`, `account_key` (configured alias), `status`, `reason`, `observation_date` (valuation date), and `observed_finished_at` (observation time). `included` means it contributes to available totals; `excluded` identifies paper/duplicate accounts; `unavailable` gives a fixed source, binding, identity, snapshot, freshness or balance reason; `blocked` means locally eligible but the aggregate is unavailable, with an `aggregate_` reason. Binance wallet history is a separate source, reported as `source_not_supported` here. Missing/invalid dates stay null; stale dates remain explicitly stale. No amounts, broker identities, inferred zeros, carried values, interpolation or FX conversion are added. Configuration/binding read failures return sanitized HTTP 503 (`account_options_unreadable` / `account_facts_bindings_unreadable`), never a successful empty inventory. This projection does not establish holdings, cashflow or performance-history coverage.

The trusted `account_facts_bindings` configuration uses `qsl_account_facts_bindings.v1`. LongBridge bindings retain their `deployment_scope_token_version` source and exact account-option identity. IBKR uses `platform=ibkr`, `source_binding.kind=deployment_runtime_account`, and separately binds the exact option `account_scope` and `account_selector`. Its history contract is `ibkr_account_snapshot_history.v1` / `ibkr_account_snapshot.v1`; the server derives platform from the schema and dedicated token, and callers cannot supply platform or account key. `account_ids` must contain exactly the native account ID selected by the server binding. IBKR balances contain only per-currency `net_assets` (nullable); cash contains per-currency `cash_balance` with an allowed source tag. The receiver never invents total cash, and a null net asset is neither plotted nor treated as zero. Binding does not prove verified physical-account ownership or live authorization; all-account totals remain unavailable.

The receiver accepts the same persisted LongBridge snapshot history body within its original 15-minute observation window; it does not backfill history. Latest and daily observations are transactional, with at most 366 UTC observation days retained. Missing dates/currencies remain gaps. Assets are not returns; missing external cash flows keep returns unavailable and unverified physical identity prevents all-account totals. The existing runtime-daily view separately uses the `America/New_York` business date. The UI uses concise fallback states; implementation details remain in operational evidence.

### Fixed daily-runtime targets

The existing `/api/runtime-daily/sync` receiver supports only LongBridge
`longbridge-quant-paper-service|russell_top50_leader_rotation|paper` and Schwab
`charles-schwab-quant-service|soxl_soxx_trend_income|live`. The deployment flag
`RUNTIME_DAILY_READ_MODEL_ENABLED` must be exactly `true`. POST still requires
only the existing dedicated `EXECUTION_EVIDENCE_SYNC_TOKEN`; account-facts,
dispatch and session credentials are not fallbacks. GET requires an allowed login.

Schwab POST additionally requires `X-QSL-Source-Binding-ID`, using the existing
64-lowercase-hex `source_binding.id` from the protected account-facts binding.
Each request must match the currently resolved protected registry entry, including
first writes on a new business day and idempotent requests. Missing/malformed
values return 400; mismatches return 409 without echoing either ID. Duplicate
combined headers are invalid. A body field or an old cache fingerprint cannot
replace this check. LongBridge's protocol is unchanged. This header is a bounded
publisher assertion, not another credential or standalone proof of a raw report's
physical account: the future caller must independently verify its configured
account against each report before deriving the existing ID.

New reads explicitly supply `date`, `platform` and `account_key`. Legacy date-only
GET always means LongBridge PAPER; it never chooses the first account or falls
back to Schwab. Repeated or incomplete selectors are rejected. Only protected
server configuration attributes an account. Schwab additionally requires a unique,
exact match to the existing `account_facts_bindings` across all identity fields.
Missing scope or an absent/mismatched binding remains unresolved. The existing
authenticated `/api/config` adds a redacted `runtimeDailyBindings` status summary.

The existing target/day KV key and retention policy are retained. LongBridge keeps
its original stored projection. Schwab adds a server-generated private binding
fingerprint in the same stored entry so later account/source changes cannot
reattribute history. This cache is not an atomic ledger or exactly-once delivery.
The page keeps daily data, loading and errors separate by platform/account/date;
today's health reads remain independent of a selected historical day, and stale
requests cannot update a different selection.

LongBridge's exact seven-field evidence and unmatched-report protocol remain
unchanged. Schwab uses nine evidence fields, adding `receipt_state` and
`receipt_id`, and reason-only unmatched records. Missing/invalid receipts are not
created or promoted. Public reads omit private receipt, URI and account-binding
details, retaining only safe run-issue classifications. Limits remain 64 KiB,
20 runs and 20 list entries; oversized input is rejected. Missing data is not a
no-trade claim. Fills remain `not_connected`, empty records and null count.

Daily GET responses add `read_summary` from the existing stored, validated daily
projection (`source: stored_runtime_daily_projection`). `status` is `complete`,
`partial`, `no_data`, or `read_failed`; `reason` is null or a fixed public code.
`observed_run_count` counts only retained source runs; `total_run_count` is known
only for a complete projection. A partial HTTP 200 preserves all available runs
and uses reason `runtime_daily_incomplete` with a null total. Missing keys remain
HTTP 200 / `no_data` / `runtime_daily_record_missing`, with both counts null.
KV/JSON failures and invalid stored projections remain HTTP 503 / `read_failed`,
with their existing fixed error code as reason and both counts null. Auth,
selection, and binding errors retain their existing responses. No exception text,
private diagnostics, interpolation, or replacement zero is added. An explicitly
complete schedule can report a real zero. This summary describes the saved
projection, not proof that its producer discovered every real run; completeness
also does not imply successful execution or freshness. Existing `record`, `runs`,
`read_error_codes`, `data_status` and source timestamps remain unchanged. Historical
cells can therefore have a partial source read and several observed runs at once.
History-directory coverage (`history`, including null when not read) is separate.

For the exact bound Schwab source, public schedules retain only the safe reason
codes `no_cron_on_business_date` and `market_closed`. After the existing identity,
lifecycle/deployment freshness, current New York date, completeness, run-issue and
execution-lane checks pass, an explicitly matching closed-session schedule observed
on that business date can be healthy with `next_due_at: null`. Its schedule date,
timezone, reason and time fields must agree; health does not invent a future due
time or claim a completed run. The current-day check expires the exception at New
York midnight, including DST, using the existing page clock and read refreshes.
Missing or unknown reasons, stale/incomplete evidence, future observations,
identity conflicts, pending runs and errors cannot use this exception. Ordinary
`before_schedule` still requires a future next due time; LongBridge's original
public shape and future-due contract are unchanged. Arbitrary diagnostic reasons
remain private. These display rules never change trading or risk authority.

Source code and synthetic contract tests do not establish live Schwab connectivity.
Before cutover, the caller must independently compare the original report's account
hash and existing derived source-binding ID against protected expected identity,
verify the authorized report prefix and schedule, and establish complete or explicitly
incomplete read coverage. The existing lossy latest execution-evidence snapshot cannot
reconstruct a daily feed; 100 recent reports do not prove complete-day coverage.
Then verify a real POST ACK, authenticated GET, matching account card and a natural
cycle. No new broker query is needed. Publication does not authorize new credentials,
IAM grants, account bindings or production flag changes.

### Partial promotion review isolation (2026-10-07)

Ordinary promotion GET isolates only canonical review-material validation failures. A JSON legacy numeric string can pass the old normalizer but become non-finite; it must not fail every valid ticket's read. The bounded response stays `data_status: partial` with the single fixed `research_promotion_review_material_invalid` error, `summary.invalid_review_count` (1–100), and matching `invalid_tickets` diagnostics. Invalid entries have `decision_material.eligible: false`, `blocked: true`, the fixed blocker code and no `decision_binding`; their malformed numeric material is not returned as an invented zero/null. Valid tickets and applications retain their original contracts. Crypto, authority and other infrastructure failures are not converted to this partial result. Invalid decision/source POSTs still fail before writes, including callers with and without a v2 review hash.

The existing promotion adapter alone accepts the valid subset of this exact partial envelope after checking schema, singleton error, bounds/counts, diagnostic flags, unique identities and material bindings. The source never becomes ready, so the existing incomplete-list warning remains. Unknown partials, extra errors, stale/unavailable sources and transport errors stay blocked; owner/recovery adapters are unchanged. This small consumer repair does not adopt the historical full v2 decision client, change page copy/layout/styles, or add refreshes. Receiver deployment, producer readiness and real operator acceptance remain separate evidence.

`tests/promotion_queue_partial_validation.mjs`, invoked through the existing presentation validation entry, uses representable persisted JSON, fake KV/DO and an all-network deny guard. It covers mixed/all-invalid queues, bounded diagnostics, legacy/v2 bad POSTs and source sync with zero writes, infrastructure failures, strict adapter negatives and actual unchanged React SSR with a visible valid item plus the existing warning. Synthetic reproduction does not identify the cause of a production partial warning.


Firstrade facts use `firstrade_account_snapshot_history.v1` / `firstrade_account_snapshot.v1` and a distinct optional `FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN`. The binding workflow accepts `platform=firstrade` with one protected `FIRSTRADE_ACCOUNT_FACTS_BINDING_JSON` entry. It preserves other entries and rejects replacement of an existing conflicting binding. Each entry adds private `broker_account_id`; the public account selector may remain an alias. Native identity must match at ingress, storage, current read and history read; neither ACK nor authorized read models return it. Source kind is `deployment_runtime_account`. A snapshot contains one provider-reported currency/net-assets row and optional cash row with `cash_balance` / `source_tag=provider.cash_balance` in that same currency. Missing currency/equity is rejected; buying power, inferred USD and derived position totals are not accepted. Existing money, time, session and retention limits apply. The frontend includes fresh Firstrade assets and cash balance in configuration totals; absent cash stays missing. This interface does not enable collection or trading, configure private credentials, or prove live source adoption.

Holdings release order and rollback: [staged rollout runbook](../../docs/account-facts-holdings-rollout.md).

### Notification receipt read coverage

GET `/api/notifications/send-log` exposes `read_status` and fixed `read_reason_codes` separately from each receipt's delivery outcome. `complete` means every listed run has a readable public receipt and the completed-run list fits the existing five-run limit; it does not prove delivery, current-business-day coverage, or coverage of other notification workflows. `no_data` requires an explicitly empty completed-run list (`total_count=0`). Missing listing totals remain `unknown` for an empty list or `partial` with rows. Truncation, incomplete listings, missing/expired receipts and skipped senders produce `partial`; access/read failures produce `partial` when other rows remain readable, otherwise `read_failed`. Missing repository/token is `not_connected`. The existing top-level `status` is also `partial` for incomplete/unknown coverage; `unavailable_reason` distinguishes `notification_receipts_incomplete` from `notification_receipts_read_failed`. Partial rows and original delivery booleans/dates remain intact. `as_of` is the read time, `workflow_updated_at` is workflow metadata, and `sent_at` stays null when absent from the public receipt. No timestamps, amounts, zeros, delivery evidence or missing records are inferred. This GET-only projection neither sends notifications nor changes source permissions or production configuration.

When qualified native daily returns contain a gap, the returns response sets `coverage.native_daily_only` and exposes only observed daily percentages with explicit breaks. The UI displays daily returns without benchmarks or a cumulative-mode switch; full-period return and drawdown remain unavailable. Existing contiguous-return responses are unchanged.

### Fixed backend patch dry-run (2026-10-30)

The ordinary main-branch `read_only_preflight` also checks whether the three reviewed #946 backend functions can be applied to the active module while preserving its other bytes. It builds the fixed parent and merge commits with identical synthetic assets, checks their approved bundle hashes, and locates complete top-level functions using the existing TypeScript parser. All other top-level declarations and route wiring must match the fixed baseline; only three strictly static V2 asset declarations may differ. The candidate must reproduce the reviewed synthetic new bundle, retain the active assets, and reverse exactly to the original active bytes. A marker match alone never passes this check.

The same Miniflare regression runs against the synthetic and active-derived candidates, with fixed synthetic account data, Cloudflare metadata fetching disabled, Worker outbound requests denied, and no production credentials passed to the child process. Only a private temporary test copy receives fixed test exports; it is removed on normal completion and exception paths. The final candidate remains in memory. The result distinguishes a successful GET from `patch_ready`; it never uploads a version, activates a deployment, synchronizes configuration, or changes page assets.

The original metadata preflight and the fixed module GET steps retain their existing identities. Build and synthetic-test steps do not receive Cloudflare credentials. CI builds the historical synthetic evidence only when the verifier, its workflows/tests, or their locked dependencies change; unrelated changes do not acquire this historical-build requirement. CI artifacts contain only fixed repository-source synthetic bundles, never an active or active-derived module.

A separate fixed-source diagnostic rebuilds public commit `54e146fcef01fecc6c7ec2d4cfd858b9946679eb` with its tracked frontend assets, example build configuration and Wrangler 4.106.0. It compares that full bundle with the version-scoped active module in memory and reports only fixed booleans, including three complete old-function matches and two known public asset IDs. It does not execute the active module or relax the #946 verifier. Asset-ID or individual-function matches do not prove the active source. A full-byte mismatch, including a source-map trailer difference, does not distinguish a source change from a build/configuration difference. No historical private runtime configuration is reconstructed.
