# Desk API contract v1 (frozen copy)

This file freezes the approved v1 Desk API contract (draft v1) that the N1 read
projection delta in [`desk-n1-read-projection-contract.md`](desk-n1-read-projection-contract.md)
overrides for five routes. Do not edit the frozen text.

Compatibility note (2026-11-14), outside the frozen text: on the authenticated
Desk accounts and switch-targets projections, an IBKR target's `account_ref` is
the full validated native broker ID from `account_selector` (`U` or `DU`
followed by digits), not the masked suffix shown in the §1.3 example. Missing or
invalid IBKR selectors and all other platforms keep the masked form. Target
readback displays valid IBKR selector values in full and still compares complete
values with the existing unknown-state rules. `target_id`, `account_suffix` and
the field types are unchanged; `account_alias` remains the technical key, and
the strategy stays a separate field.

The original document is kept byte-for-byte below as an indented block: remove
the first four spaces of every non-empty line to recover it. The recovered
UTF-8 bytes have SHA-256
`45e5b9f79ad623425becc6b506b6b082086f2e98a905a6c7e7193cab948a91fe`, which
`tests/desk_n1_projection_validation.mjs` checks.

    # QSL Desk API contract (frontend ⇄ backend)

    Status: DRAFT v1 for Codex review · 2026-11-02 · author: Claude Code (frontend owner)
    Source of truth for this document: the approved design in `/workspace/codex-jobs/claude-design-v2/out/` (`overview`, `switch`, `accounts`, `performance`, `alerts`, `mobile-overview`) and the repo `/workspace/repos/QuantRuntimeSettings` at `db53a94`.
    All paths below are relative to `web/strategy-switch-console/` unless noted. Line numbers are from that checkout and may drift; search by function name.
    All ids, accounts, tokens and amounts in examples are fake.

    ---

    ## 0. How to read this document

    Every endpoint has: method + path, auth, a response shape with an example, and an **Exists?** tag:

    | Tag | Meaning |
    |---|---|
    | **EXISTS** | Works today as described. Frontend may call it as-is. |
    | **CHANGED** | Exists, but fields or behaviour must change. The change is listed. |
    | **NEW** | Does not exist. Backend must build it. |

    Frontend will build against mocks (see FE-PLAN.md) until each NEW/CHANGED endpoint lands, so shapes here are what the frontend will type against. Backend: if a shape is wrong or costly, say so in the PR for BE-0 (see BE-TASKS.md) rather than diverging silently.

    ### 0.1 Where the new endpoints live

    All new, desk-specific reads/writes use the prefix **`/api/desk/`**. Existing `/api/...` routes keep their current behaviour except where tagged CHANGED. This keeps the old console working during the rebuild and gives one place to find the contract.

    The desk endpoints are **read models that compose existing sources** (account facts, runtime lifecycle, runtime-daily, account settings, market benchmark, credential maintenance). They must not create new execution authority. Every write response carries `no_order: true` where it can (existing convention, e.g. `accountSettingsPayload`, `worker.js`).

    ---

    ## 1. Conventions (apply to every endpoint)

    ### 1.1 Transport and auth

    - Same-origin only, cookie session set by `/login` → `/callback` (`worker.js` `startLogin`/`finishLogin`). Frontend sends `credentials: "same-origin"`, `cache: "no-store"` (`frontend/src/api.ts` `getJson`/`postJson`).
    - **Read auth ("allowed")**: session exists and `session.allowed === true`. Else `401 {ok:false,error:"login required"}`. Existing pattern: `strategyHealthResponse`, `runtimeDailyResponse`.
    - **Admin auth**: `session.admin === true`, else `403 {ok:false,error:"admin required"}`.
    - **Write auth**: allowed (or admin where stated) **and** `requireSameOrigin(request,{requireOrigin:true})` (`worker.js`, used by `dispatchSwitch`). Writes are JSON `POST`, `Content-Type: application/json`, body ≤ 8 KiB.
    - **Idempotency**: every desk write takes an `idempotency_key` (UUID v4 or `[A-Za-z0-9._:-]{1,128}`). Same key + same body returns the original response with `"reused": true`. Same key + different body → `409 idempotency_key_conflict`. Pattern already used by `request_id` in HK stop (`dispatchHkRuntimeStop`) and `humanDecisionRequestKey`.
    - `Cache-Control: no-store` on every response.

    ### 1.2 Errors

    Keep the existing shape; the frontend client already parses it (`getJson` reads `error`, `reason_code`, `reason`):

    ```json
    { "ok": false, "error": "preview_expired", "reason_code": "preview_expired", "reason": "Preview is older than 5 minutes. Run the diff again." }
    ```

    `error` is a stable snake_case code. `reason` is optional, human English, no secrets, no stack traces. Status codes: 400 validation, 401/403 auth, 404 unknown id, 409 state conflict, 422 refused by a gate, 429 rate limited, 502 upstream (GitHub/broker) failed, 503 store unavailable.

    **A failed read of a *dependency* is not an error for the whole response.** It becomes an `unknown` field (next section). Only fail the whole request when the request itself is invalid or the caller is not allowed.

    ### 1.3 Formats

    | Thing | Format | Note |
    |---|---|---|
    | Time | ISO-8601 UTC, `Z` suffix, e.g. `2026-11-02T14:31:12Z` | Same canonical form as `canonicalCredentialExpiry` in `api.ts`. |
    | Dates | `YYYY-MM-DD` | State the timezone in a sibling `timezone` field (runtime-daily uses `America/New_York`, benchmark uses `Asia/Shanghai`). |
    | Money | **decimal string**, never a JS number: `"412380.55"` | Matches account-facts (`net_assets: string`). Always paired with `currency` (ISO 4217 or `USDT`). |
    | Ratios | decimal string ratio, `"0.0184"` = 1.84 % | Field name ends in `_ratio` or sits in an object with `unit: "ratio"`. Frontend does the ×100. Do not mix percent and ratio. |
    | Counts / ages | JSON integers | `age_seconds`, `count`. |
    | Ids | `target_id` = `"<platform>/<target_name>"`, e.g. `"ibkr/tqqq"`. | Derived from `platform` + `target_name` already used by `/api/switch`. Stable, URL-safe. |
    | Account ref | masked display string, e.g. `"U•••0001"` plus `account_suffix` (last 4) | The full broker account number is never sent to the browser unless it already is today. Backend decides mask; see §3.4. |

    ### 1.4 The `Read` wrapper: unknown is first-class

    This is the most important rule in the contract.

    > A value the backend could not read, could not verify, or that is too old to trust is **`unknown`**. It is never defaulted to `false`, `0`, `"stopped"`, `"disabled"`, or an empty list.

    The repo already does this for account settings (`effectiveAccountSettings` returns `{status:"known",value}` or `{status:"unknown"}`) and for HK stop (`hkStopObservation` always returns `{status:"unknown"}` because it cannot yet prove the state). The desk contract generalises that:

    ```ts
    type Read<T> =
      | { status: "known";   value: T; observed_at: string }          // fresh enough to show
      | { status: "stale";   value: T; observed_at: string; age_seconds: number }  // show greyed, with age
      | { status: "unknown"; reason: ReadReason; observed_at?: string | null };    // show "?"

    type ReadReason =
      | "never_read"        // no read has ever happened
      | "read_failed"       // the read errored (broker/API/network)
      | "source_unavailable"// backing store down or not configured
      | "identity_unverified" // read exists but cannot be tied to this account (see lifecycle comment in hkStopObservation)
      | "not_supported";    // platform cannot expose this field
    ```

    Frontend rendering rule (design: "Unknown ≠ stopped"): `known` → value; `stale` → value + age + muted style; `unknown` → `?` + reason tooltip. A control that would act on an `unknown` field is disabled with the reason shown.

    Tri-state runtime status uses the same idea:

    ```ts
    type RuntimeState = "running" | "stopped" | "unknown";
    ```

    `"stopped"` may be emitted **only** when a fresh, identity-verified platform read affirms it (or a stop request was confirmed per `stop_confirmed` rules). A request that merely "was accepted" is `phase:"accepted"`, not `stopped`. Test requirement in BE-TASKS.md.

    ### 1.5 Freshness block (reuse)

    Reuse the existing shape (`Freshness` in `api.ts`):

    ```ts
    type Freshness = { data_status: "ready" | "stale" | "unavailable"; age_seconds: number | null };
    ```

    Stale thresholds stay backend-owned (account facts: 36 h, `ACCOUNT_FACTS_STALE_MS` in `account_facts.js`). The frontend shows the number it is given and does not re-derive "stale" except the display-time expiry that `accountFactsForDisplay` already does.

    ### 1.6 Polling, pagination

    - Frontend polls; no websockets/SSE required in v1. Minimum poll interval 2 s (switch verify), 15 s (log tail), 60 s (everything else). Backend may send `retry_after_ms`.
    - List endpoints that can grow use an opaque `cursor`: request `?limit=50&cursor=<opaque>`, response `{ items, next_cursor }` (`next_cursor: null` at end). Limits: default 50, max 200.

    ---

    ## 2. Endpoint index

    | # | Method + path | Screen | Auth | Exists? |
    |---|---|---|---|---|
    | 1 | `GET /api/session` | all | none (returns anonymous) | **CHANGED** (additive) |
    | 2 | `GET /api/desk/ribbon` | header + ribbon + run tape (all pages) | allowed | **NEW** |
    | 3 | `GET /api/desk/overview` | Overview | allowed | **NEW** |
    | 4 | `GET /api/desk/targets/{target_id}/readback` | Accounts, Switch step 3/5 | allowed | **NEW** |
    | 5 | `POST /api/desk/readbacks` + `GET /api/desk/readbacks/{id}` | Accounts "Re-read all" | allowed | **NEW** |
    | 6 | `GET /api/desk/switch/targets` | Switch step 1 | allowed | **NEW** |
    | 7 | `GET /api/desk/switch/targets/{target_id}/strategies` | Switch step 2 | allowed | **NEW** (builds on `/api/account-settings`) |
    | 8 | `POST /api/desk/switch/previews` | Switch step 3 | allowed | **NEW** |
    | 9 | `POST /api/desk/switch/requests` | Switch step 4 | allowed + same-origin | **NEW** (wraps `POST /api/switch`) |
    | 10 | `GET /api/desk/switch/requests/{request_id}` | Switch step 5 | allowed | **NEW** |
    | 11 | `GET/POST /api/runtime-stop`, `POST /api/runtime-resume` | Switch "Stop-only" panel | allowed + same-origin | **CHANGED** |
    | 12 | `POST /api/desk/reconcile` | Accounts "Re-apply saved" / "Adopt platform" | allowed + same-origin | **NEW, gated (open question Q1)** |
    | 13 | `GET /api/desk/accounts` | Accounts broker matrix | allowed | **NEW** |
    | 14 | `GET /api/desk/accounts/{target_id}` | Accounts detail (holdings, facts) | allowed | **NEW** (builds on `/api/account-facts`) |
    | 15 | `GET /api/desk/performance` | Performance | allowed | **NEW** |
    | 16 | `GET /api/market-benchmark` | Performance, Overview chart | allowed | **CHANGED** (ids + range) |
    | 17 | `GET /api/desk/alerts` | Alerts list, header badge | allowed | **NEW** |
    | 18 | `GET /api/desk/alerts/delivery` | Alerts "Delivery" card | allowed | **NEW** |
    | 19 | `GET /api/desk/logs` | Run log + live tail | allowed | **NEW** |
    | 20 | `GET /api/desk/credentials` | Accounts matrix, Overview "Needs you" | allowed | **NEW** |
    | 21 | `GET /api/credential-maintenance` (+ POST) | IBKR Flex rotation panel | allowed / admin write | **EXISTS** |

    Existing endpoints the desk keeps reading directly (no change, listed so nothing is orphaned): `GET /api/config`, `GET /api/runtime-target-lifecycle`, `GET /api/account-facts`, `GET /api/account-facts/history`, `GET /api/runtime-daily`, `GET /api/strategy-health`, `GET /api/control-plane`, `GET /api/owner-decisions`, `GET /api/overview-fx`, `GET /api/account-settings`. The new `/api/desk/*` reads are the preferred way for desk screens; the old ones stay for the legacy console and as backend sources.

    ---

    ## 3. Endpoints in detail

    ### 3.1 `GET /api/session` — **CHANGED (additive)**

    Exists: `sessionPayload`, `worker.js` (~L4810) returns `{authenticated, login, allowed, admin}`; `Session` type in `frontend/src/api.ts`.

    Change: add `server_time` so the header clock and "refreshed 6m ago" are computed against server time, not a skewed browser clock.

    ```json
    { "authenticated": true, "login": "owner-demo", "allowed": true, "admin": true,
      "server_time": "2026-11-02T14:32:07Z" }
    ```

    `login` is the display initial source (design shows "LS" avatar); frontend derives initials.

    ---

    ### 3.2 `GET /api/desk/ribbon` — **NEW**

    Feeds: header (LIVE pill, clock, alert badge), the 24 h session ribbon, "NEXT RUN", and the run tape that appears on every page.

    No existing route returns this. Sources to compose: `runtimeDailyPublicRecord` (`worker.js` ~L8600: `schedule.next_due_at`, `runs[]`), lifecycle `RuntimeSnapshot` (`/api/runtime-target-lifecycle`).

    Query: `?date=YYYY-MM-DD` (default today UTC).

    ```json
    {
      "ok": true,
      "generated_at": "2026-11-02T14:32:07Z",
      "date": "2026-11-02",
      "console_state": { "mode": "live", "gateways": { "status": "known", "value": "all_reachable", "observed_at": "2026-11-02T14:31:48Z" } },
      "alert_badge": { "open_count": 3, "critical_count": 1 },
      "sessions": [
        { "market": "US", "state": "open",   "open_utc": "14:30", "close_utc": "21:00", "next_change_at": "2026-11-02T21:00:00Z", "holiday": null },
        { "market": "HK", "state": "closed", "open_utc": "01:30", "close_utc": "08:00", "next_change_at": "2026-11-03T01:30:00Z", "holiday": null },
        { "market": "CN", "state": "closed", "open_utc": "01:30", "close_utc": "07:00", "next_change_at": "2026-11-03T01:30:00Z", "holiday": null }
      ],
      "next_run": { "target_id": "ibkr/tqqq", "kind": "pre_close_check", "due_at": "2026-11-02T20:55:00Z" },
      "tape": [
        { "id": "run_demo_0001", "at": "2026-11-02T14:30:00Z", "target_id": "binance/spot", "label": "BTC DCA", "kind": "dca",
          "outcome": "filled", "outcome_detail": "1 fill", "state": "done" },
        { "id": "run_demo_0002", "at": "2026-11-02T13:55:00Z", "target_id": "ibkr/tqqq", "label": "rebalance check", "kind": "rebalance_check",
          "outcome": "no_op", "outcome_detail": null, "state": "done" },
        { "id": "run_demo_0003", "at": "2026-11-02T09:05:00Z", "target_id": "longbridge/hk", "label": "HK close cycle", "kind": "close_cycle",
          "outcome": "drift", "outcome_detail": "2 fields differ", "state": "done" },
        { "id": "sched_demo_0004", "at": "2026-11-02T20:55:00Z", "target_id": "ibkr/tqqq", "label": "pre-close check", "kind": "pre_close_check",
          "outcome": null, "outcome_detail": null, "state": "scheduled" }
      ]
    }
    ```

    Field rules:

    - `sessions[].state`: `"open" | "closed" | "pre" | "post" | "unknown"`. `unknown` when the calendar source is unavailable. `holiday` is a short name or `null`. Times are UTC `HH:MM` for drawing the ribbon; `next_change_at` is an instant.
    - `tape[].state`: `"done" | "running" | "scheduled" | "missed" | "unknown"`. `missed` only if the schedule says it was due and grace has ended with no run (`publication_grace_ended` in runtime-daily). Otherwise `unknown`.
    - `tape[].outcome`: `"filled" | "orders_submitted" | "no_op" | "drift" | "error" | "skipped" | null` (null for scheduled). Never invent `error` from absence of data; absence is `state:"unknown"`.
    - `console_state.gateways.value`: `"all_reachable" | "degraded" | "down"`. When gateways cannot be read, `status:"unknown"` and the header pill shows "UNKNOWN", not "DOWN".
    - `alert_badge` equals the count from `GET /api/desk/alerts?status=open` (single source).

    Exists? **NEW.** Closest: `GET /api/runtime-daily?date=` (`runtimeDailyResponse`, `worker.js` ~L8773) gives per-target schedule and runs for **one** target; this endpoint aggregates all targets plus the market calendar.

    ---

    ### 3.3 `GET /api/desk/overview` — **NEW**

    Feeds the Overview page: key-figure row, the Book table (one row per target), the equity-vs-benchmark chart summary, and "Needs you". One call so the page does not fan out to ~11 requests (today `loadReadModel` in `api.ts` does 11).

    Sources to compose: `/api/account-facts` (`AccountFactsSnapshot`, `types.ts`), `/api/account-facts/history`, lifecycle, runtime-daily, account-settings `effective`, `/api/overview-fx`, credential maintenance, alerts.

    ```json
    {
      "ok": true,
      "generated_at": "2026-11-02T14:32:07Z",
      "snapshot_at": "2026-11-02T14:26:00Z",
      "freshness": { "data_status": "ready", "age_seconds": 367 },
      "reporting_currency": "USD",
      "totals": {
        "status": "complete",
        "coverage": { "included": 7, "total": 7, "excluded_reasons": [] },
        "fx": { "status": "known", "as_of": "2026-11-02T14:00:00Z", "source": "overview_fx" },
        "nav": "1189800.00",
        "day_change": { "amount": "11120.00", "ratio": "0.0094" },
        "drawdown": { "ratio": "-0.049", "limit_ratio": "-0.15", "peak_date": "2026-09-18" },
        "gross_exposure_ratio": "0.964",
        "leveraged_etf_exposure_ratio": "0.412",
        "runs_today": { "done": 11, "expected": 12, "pending": [{ "target_id": "ibkr/tqqq", "due_at": "2026-11-02T20:55:00Z" }] },
        "config_drift": { "count": 1, "target_ids": ["longbridge/hk"] },
        "data_age_seconds": 22320
      },
      "book": [
        {
          "target_id": "ibkr/tqqq",
          "platform": "ibkr",
          "platform_label": "IBKR",
          "account_ref": "U•••0001",
          "account_suffix": "0001",
          "strategy": { "status": "known", "value": { "profile": "tqqq_growth_income", "label": "TQQQ Growth Income" }, "observed_at": "2026-11-02T14:31:12Z" },
          "mode": { "status": "known", "value": "live", "observed_at": "2026-11-02T14:31:12Z" },
          "runtime": { "status": "known", "value": "running", "observed_at": "2026-11-02T14:31:48Z" },
          "nav": { "currency": "USD", "amount": "412380.00", "usd": "412380.00", "status": "known", "observed_at": "2026-11-02T14:26:00Z" },
          "day_change": { "ratio": "0.0184", "amount": "7588.00", "currency": "USD" },
          "sparkline_30d": { "points": ["398100.00", "399400.00", "404200.00"], "dates_from": "2026-10-04", "dates_to": "2026-11-02", "gap_dates": [] },
          "drawdown": { "ratio": "-0.062", "limit_ratio": "-0.15", "state": "ok" },
          "config": { "state": "synced", "drift_count": 0, "checked_at": "2026-11-02T14:31:12Z" },
          "last_run": { "at": "2026-11-02T14:25:00Z", "outcome": "no_op" },
          "return_basis": "native_ibkr_twr"
        },
        {
          "target_id": "longbridge/hk",
          "platform": "longbridge",
          "platform_label": "LongBridge",
          "account_ref": "LB•••0001",
          "account_suffix": "0001",
          "strategy": { "status": "known", "value": { "profile": "hk_global_etf_tactical_rotation", "label": "HK ETF Tactical Rotation" }, "observed_at": "2026-11-02T14:31:12Z" },
          "mode": { "status": "known", "value": "live", "observed_at": "2026-11-02T14:31:12Z" },
          "runtime": { "status": "unknown", "reason": "identity_unverified" },
          "nav": { "currency": "HKD", "amount": "1113000.00", "usd": "142700.00", "status": "known", "observed_at": "2026-11-02T09:06:00Z" },
          "day_change": { "ratio": "-0.0088", "amount": "-1256.00", "currency": "USD" },
          "sparkline_30d": { "points": ["145800.00", "144900.00", "142700.00"], "dates_from": "2026-10-04", "dates_to": "2026-11-02", "gap_dates": ["2026-10-12"] },
          "drawdown": { "ratio": "-0.059", "limit_ratio": "-0.15", "state": "ok" },
          "config": { "state": "drift", "drift_count": 2, "checked_at": "2026-11-02T14:31:12Z" },
          "last_run": { "at": "2026-11-02T09:05:00Z", "outcome": "drift" },
          "return_basis": "nav_change_unadjusted"
        }
      ],
      "equity_curve": {
        "range": "6M",
        "portfolio": { "dates": ["2026-10-09", "2026-10-10"], "indexed": ["100.00", "100.41"] },
        "benchmark": { "id": "nasdaq100", "label": "Nasdaq 100", "indexed": ["100.00", "100.52"] },
        "drawdown": ["0.000", "-0.002"],
        "history_starts": "2026-10-09",
        "return_basis": "mixed"
      },
      "needs_you": [
        { "id": "alr_demo_0001", "kind": "config_drift", "severity": "critical", "target_id": "longbridge/hk",
          "title": "Platform read-back differs from saved config",
          "detail": "2 fields: enabled, cash_reserve_ratio. Platform shows older values.",
          "action": { "label": "Review diff", "route": "/accounts?target=longbridge/hk" } }
      ]
    }
    ```

    Field rules:

    - `totals.status`: `"complete"` (all accounts included with fresh facts and FX) | `"partial"` (some excluded; `coverage` says which and why) | `"unavailable"` (no defensible total). On `partial` the frontend shows the total with "N of M accounts" and never silently drops an account. This mirrors `AccountFactsTotals.status` (`by_currency`/`unavailable`) and `summarizeAccountFactsCoverage` (`types.ts`). `excluded_reasons` use the existing vocabulary: `physical_identity_unverified`, `coverage_incomplete`, `no_non_paper_accounts`, plus `fx_unavailable`.
    - Paper accounts are in `book` but **excluded from `totals`** (existing behaviour: totals count non-paper only). Say so in `coverage.excluded_reasons` with `"paper_excluded"`.
    - `book[].nav.usd` is `null` when FX is unknown. `nav.amount` stays in account currency.
    - `book[].config.state`: `"synced" | "drift" | "unknown"`. `unknown` when the platform read-back failed. Never `synced` by default.
    - `book[].runtime`: `Read<RuntimeState>`. For `longbridge/hk` today this will be `unknown` (see `hkStopObservation`).
    - `book[].return_basis`: `"native_ibkr_twr" | "nav_change_unadjusted" | "unavailable"`. Existing facts: only IBKR has a native TWR (`AccountFactsReturn`, `types.ts`); every other broker reports `status:"unavailable", reason:"external_cashflow_required"`. A deposit would look like profit in a plain NAV difference, so the frontend labels `nav_change_unadjusted` figures "NAV change, not cash-flow adjusted".
    - `drawdown.state`: `"ok" | "near_limit" | "breached" | "unknown"`; `near_limit` threshold is backend-owned (design shows SOXL at -14.8 % against -15.0 %).
    - `sparkline_30d.points`: oldest→newest net-asset strings, same currency as `nav.amount`; gaps listed in `gap_dates` (existing `gap_dates` semantic from history series); do not interpolate. Fewer than 2 points → `points: []`, frontend draws "no history".
    - `needs_you[]` ≤ 5 items, severity `critical | warning | info`, sorted critical first. `kind` ∈ `config_drift | credential_expiring | decision_pending | drawdown_near_limit | run_missed | data_stale | other`.
    - `equity_curve` benchmark: see §3.16 for ids and inception limit. `history_starts` tells the frontend where data really begins so it never draws an empty 6 M axis as if it were full.

    Exists? **NEW.** Today the same information is assembled client-side in `OverviewPage.tsx`/`overviewUsd.ts` from 11 requests.

    ---

    ### 3.4 `GET /api/desk/targets/{target_id}/readback` — **NEW** (saved vs platform diff)

    Feeds: Accounts "saved vs platform" diff table, the DRIFT chip, Switch step 3 baseline and step 5 verification.

    Definitions (these words are used consistently everywhere):

    - **Saved**: what the console/backend has stored as intended configuration (account option in the durable store + approved overrides; `draft.overrides`/`config` in `account_settings_read`, `worker.js` `accountSettingsResponse`).
    - **Platform read-back**: what the live platform repo/service actually reports now (GitHub variable read via `effectiveAccountSettings` / `accountSettingsProfileRuntimeReadback`, `worker.js` ~L15730/15788).

    ```json
    {
      "ok": true,
      "target_id": "longbridge/hk",
      "readback_id": "rb_demo_0001",
      "read_at": "2026-11-02T14:31:12Z",
      "saved_revision": 42,
      "overall": "drift",
      "summary": { "match": 5, "drift": 2, "unknown": 0 },
      "fields": [
        { "key": "strategy_profile", "label": "strategy_profile",
          "saved":    { "status": "known", "value": "hk_global_etf_tactical_rotation", "observed_at": "2026-11-02T13:00:00Z" },
          "platform": { "status": "known", "value": "hk_global_etf_tactical_rotation", "observed_at": "2026-11-02T14:31:12Z" },
          "state": "match" },
        { "key": "enabled", "label": "enabled",
          "saved":    { "status": "known", "value": "true",  "observed_at": "2026-11-02T13:00:00Z" },
          "platform": { "status": "known", "value": "false", "observed_at": "2026-11-02T14:31:12Z" },
          "state": "drift" },
        { "key": "cash_reserve_ratio", "label": "cash_reserve_ratio",
          "saved":    { "status": "known", "value": "0.08", "observed_at": "2026-11-02T13:00:00Z" },
          "platform": { "status": "known", "value": "0.12", "observed_at": "2026-11-02T14:31:12Z" },
          "state": "drift" },
        { "key": "income_layer_enabled", "label": "income_layer_enabled",
          "saved":    { "status": "known", "value": "false", "observed_at": "2026-11-02T13:00:00Z" },
          "platform": { "status": "unknown", "reason": "read_failed" },
          "state": "unknown" }
      ],
      "identity": { "account_suffix": "0001", "broker_environment": "live", "service": "longbridge-hk-service", "runtime_status_target_id": "longbridge.hk" },
      "facts_binding": { "status": "known", "value": "verified", "observed_at": "2026-11-02T13:02:00Z" },
      "alert_route": "QuantSentinel · Telegram",
      "actions": { "reapply_saved": { "allowed": false, "reason_code": "not_enabled" }, "adopt_platform": { "allowed": false, "reason_code": "not_enabled" } }
    }
    ```

    Rules:

    - `fields[].state`: `"match" | "drift" | "unknown"`. `unknown` if **either** side is not `known`. `match` only when both are `known` and equal after the normalisation below. `overall` = `drift` if any `drift`; else `unknown` if any `unknown`; else `match`. (Drift outranks unknown: a known difference must not be hidden by an unrelated unknown.)
    - Normalisation is backend-side and listed per field in code, e.g. booleans as `"true"/"false"`, ratios via `cleanCurrentRatio` (existing, `worker.js`). The frontend compares nothing; it renders `state`.
    - Field set comes from the existing effective settings keys: `strategy_profile`, `broker_environment`, `income_layer_enabled`, `option_overlay_enabled`, `reserved_cash_floor`, `reserved_cash_ratio`, `dca_mode`, `dca_base_investment_usd` (`effectiveAccountSettings`), **plus** `enabled` (`runtime_target_enabled`, already read in `accountSettingsProfileRuntimeReadback`) and identity fields (`account_selector`, `cash_currency`, `runtime_status_target_id`) from the account option. Backend may add keys; frontend renders any `key` generically.
    - `saved_revision` = account-options revision (`accountOptionsRevision` in `ConfigPayload`); used for optimistic concurrency in §3.9.
    - Platform values must not include secrets; only the whitelisted keys above.

    Exists? **NEW** as a unified diff. Pieces exist: `GET /api/account-settings?platform=&key=` returns `effective` with known/unknown (`accountSettingsPayload`), but only for the *effective* value and without a side-by-side saved column or `state`.

    ### 3.5 `POST /api/desk/readbacks`, `GET /api/desk/readbacks/{readback_id}` — **NEW** ("Re-read all platforms")

    Starts a fresh read for one or all targets. Reading GitHub variables for several repos is slow, so it is asynchronous.

    Request:
    ```json
    { "target_ids": ["longbridge/hk"], "idempotency_key": "demo-rb-0001" }
    ```
    (`target_ids` omitted = all configured targets; max 20.)

    Response `202`:
    ```json
    { "ok": true, "readback_id": "rbj_demo_0001", "state": "running", "started_at": "2026-11-02T14:33:00Z", "retry_after_ms": 2000 }
    ```

    `GET` poll:
    ```json
    { "ok": true, "readback_id": "rbj_demo_0001", "state": "done",
      "results": [ { "target_id": "longbridge/hk", "state": "done", "overall": "drift", "readback_id": "rb_demo_0002" },
                   { "target_id": "schwab/core", "state": "failed", "error": "read_failed" } ] }
    ```
    `state`: `running | done | partial | failed`. A failed target yields `unknown` fields on its next `GET .../readback`, never a synthesized value. Rate limit: 1 active job per session; extra POST → `429 readback_in_progress`.

    Exists? **NEW.** Today the read happens inside `GET /api/account-settings` / `configPayload` (with a memory+KV cache, `CURRENT_STRATEGIES_CACHE_TTL_MS`); there is no forced refresh.

    ---

    ### 3.6 Strategy switch — five steps

    The design flow: **1 Target → 2 Strategy → 3 Diff (with pre-flight) → 4 Confirm (type account suffix) → 5 Verify read-back.** Stop-only is a separate panel (§3.11).

    Current backend: `POST /api/switch` (`worker.js` route ~L965, `dispatchSwitch` ~L6502) validates inputs, then dispatches a GitHub workflow. **At this commit `SWITCH_ACTIVATION_CONNECTED = false` (`worker.js` L533), so it always answers `409 {ok:false, error:"账户应用尚未接通，系统未提交变更", workflow_dispatched:false}`.** The response when it does succeed has no request id and says `account_options_sync: {synced:false, deferred:true, reason:"workflow_success_required"}`; there is no way to learn that the platform actually changed. That is the gap steps 3–5 close. The frontend will not ship the switch screen as "live" until BE-7 and BE-8 land; behind the mock it is a prototype.

    #### Step 1: `GET /api/desk/switch/targets` — NEW

    ```json
    {
      "ok": true,
      "targets": [
        { "target_id": "ibkr/tqqq", "platform": "ibkr", "platform_label": "IBKR", "account_ref": "U•••0001", "account_suffix": "0001",
          "mode": { "status": "known", "value": "live", "observed_at": "2026-11-02T14:31:12Z" },
          "domains": ["us_equity", "hk_equity"],
          "current_strategy": { "status": "known", "value": { "profile": "tqqq_growth_income", "label": "TQQQ Growth Income" }, "observed_at": "2026-11-02T14:31:12Z" },
          "execution_modes": ["dry_run", "paper", "live"],
          "switchable": { "allowed": true, "reason_code": null },
          "pending_request_id": null }
      ]
    }
    ```
    `switchable.allowed=false` with a `reason_code` such as `switch_not_connected`, `request_in_flight`, `no_domain_declared`, `identity_incomplete`. `pending_request_id` non-null while a request for that target is unfinished (prevents two switches racing). Built from `/api/config` `accountOptions` (`ConfigPayload`) + `supportedModes`/domains logic (`supportedDomainsForAccount`, `supportedExecutionModesForPlatform`, `worker.js`). Exists? **NEW**, data exists in `/api/config`.

    #### Step 2: `GET /api/desk/switch/targets/{target_id}/strategies` — NEW (builds on existing `strategy_options`)

    ```json
    {
      "ok": true,
      "target_id": "ibkr/tqqq",
      "domain": "us_equity",
      "catalog_revision": "2026-10-28",
      "strategies": [
        { "profile": "soxl_soxx_trend_income", "label": "Semiconductor Trend Income", "domain": "us_equity",
          "eligibility": "eligible", "reason": null, "allowed_execution_modes": ["live", "paper", "dry_run"], "lifecycle_stage": "live",
          "option_overlay_enabled": false, "dca_supported": false },
        { "profile": "us_equity_combo_core", "label": "US Core Combo", "domain": "us_equity",
          "eligibility": "no_live", "reason": "Paper and dry-run only.", "allowed_execution_modes": ["paper", "dry_run"], "lifecycle_stage": "paper" },
        { "profile": "cn_industry_etf_rotation_aggressive", "label": "CN ETF Rotation", "domain": "cn_equity",
          "eligibility": "blocked", "reason": "wrong_domain", "allowed_execution_modes": [], "lifecycle_stage": "research" }
      ]
    }
    ```
    `eligibility`: `eligible | no_live | blocked`. `eligible` = can be chosen for at least `live`. `no_live` = selectable only for paper/dry-run. `blocked` = not selectable, with `reason` code (`wrong_domain`, `research_only`, `frozen`, `dca_platform_unsupported`, `not_in_catalog`). Today's `AccountDraftStrategyOption` (`api.ts`; built by `accountDraftStrategyChoices`, `worker.js`) already carries `lifecycle_stage`, `allowed_execution_modes`, `can_switch_live`, `blocked_live_reason` but **omits** blocked/wrong-domain rows (it `continue`s over them) and has no `eligibility` enum. CHANGED/NEW: include them with a reason so the UI can show why.

    #### Step 3: `POST /api/desk/switch/previews` — NEW (diff + pre-flight)

    Request:
    ```json
    { "target_id": "ibkr/tqqq", "strategy_profile": "soxl_soxx_trend_income", "execution_mode": "live" }
    ```
    Response (no state is changed; this is a pure read; it is not an order and does not call a broker write API):
    ```json
    {
      "ok": true,
      "preview_id": "pv_demo_0001",
      "created_at": "2026-11-02T14:32:30Z",
      "expires_at": "2026-11-02T14:37:30Z",
      "target_id": "ibkr/tqqq",
      "base": { "readback_id": "rb_demo_0003", "saved_revision": 42, "platform_overall": "match" },
      "diff": [
        { "key": "strategy_profile", "platform_now": { "status": "known", "value": "tqqq_growth_income" }, "after": "soxl_soxx_trend_income", "changed": true },
        { "key": "income_layer_max_ratio", "platform_now": { "status": "known", "value": "0.55" }, "after": "0.50", "changed": true },
        { "key": "option_overlay", "platform_now": { "status": "unknown", "reason": "not_supported" }, "after": "off", "changed": true },
        { "key": "execution_mode", "platform_now": { "status": "known", "value": "live" }, "after": "live", "changed": false }
      ],
      "estimates": {
        "turnover_ratio": { "status": "unknown", "reason": "not_supported" },
        "orders": { "status": "unknown", "reason": "not_supported" },
        "leveraged_etf_ratio_after": { "status": "unknown", "reason": "not_supported" },
        "backtest_max_drawdown_ratio": { "status": "known", "value": "-0.384", "observed_at": "2026-10-28T00:00:00Z" }
      },
      "preflight": [
        { "id": "domain_supported", "state": "pass", "title": "Domain supported", "detail": "us_equity is routed for ibkr/tqqq.", "source": "config", "observed_at": "2026-11-02T14:32:30Z" },
        { "id": "lifecycle_runtime_enabled", "state": "pass", "title": "Lifecycle: runtime_enabled", "detail": "Live switch allowed on ibkr.", "source": "lifecycle", "observed_at": "2026-11-02T14:31:48Z" },
        { "id": "no_open_orders", "state": "unknown", "title": "No open orders", "detail": "Broker read not available.", "source": "broker", "observed_at": null },
        { "id": "market_open", "state": "warn", "title": "Market is open", "detail": "US session until 20:00 UTC. Switching now reallocates intraday.", "source": "calendar", "observed_at": "2026-11-02T14:32:30Z" },
        { "id": "saved_equals_platform", "state": "pass", "title": "Saved = platform on 0 fields", "detail": "Clean baseline.", "source": "readback", "observed_at": "2026-11-02T14:31:12Z" },
        { "id": "auth_owner", "state": "pass", "title": "Signed in as allow-listed owner", "detail": "Same-origin POST; an audit entry will be written.", "source": "auth", "observed_at": "2026-11-02T14:32:30Z" }
      ],
      "blocking_count": 0,
      "unknown_count": 1,
      "confirm": { "required": true, "suffix_length": 4, "account_suffix_hint": "last 4 characters of the account number", "schedule_options": ["now", "after_us_close"] }
    }
    ```
    Rules:

    - `preflight[].state`: `pass | warn | block | unknown`. `unknown` **does not count as pass.** Policy: `block` always prevents step 4. `unknown` on a gate marked `required_for_live` (see next) also prevents live execution unless backend says otherwise via `blocking_count`; the frontend only trusts `blocking_count` and `confirm.allowed`. Add `"required": true` to a preflight row whose `unknown` must block. The design's "No open orders — broker read" is exactly such a row; if backend cannot do the broker read, it is `unknown` + `required` and Switch-live is blocked. Question for backend: Q2.
    - `estimates.*`: the design shows turnover, order count and leveraged-ETF weight. The console has no source for these today (nothing in the repo computes them). Default is `unknown/not_supported`; the frontend hides the row rather than printing a guess. If a platform repo can supply them later, only the Read status changes.
    - `diff[].platform_now` is a `Read`; `after` is a plain string (the value the request would set). `changed:false` rows are shown muted.
    - The preview binds to `base.readback_id` + `saved_revision`. Step 4 refuses if either moved (409 `base_changed`), so a user never confirms a diff against a stale baseline.
    - Reuses validation: `normalizeSwitchInputs`, `assertConfiguredAccount`, `assertStrategyAllowedForAccount`, `assertSwitchIntent` (`worker.js`). A validation failure returns `422 {error:<code>}` with the reason, not a preview.
    - Previews are stored for audit with 24 h TTL; `expires_at` is 5 min.

    Exists? **NEW.**

    #### Step 4: `POST /api/desk/switch/requests` — NEW (confirm + dispatch)

    Request:
    ```json
    { "preview_id": "pv_demo_0001", "confirm_account_suffix": "0001", "schedule": "now", "idempotency_key": "demo-sw-0001" }
    ```
    Server must re-check: session allowed + same-origin; preview exists, not expired, `confirm_account_suffix` equals the target's real suffix (server-side; the UI typing gate is not the security boundary); `blocking_count === 0`; no other unfinished request for this target; `base` still current. Then it records a request row and dispatches the existing workflow (`dispatchSwitch` logic). `schedule: "after_us_close"` creates a scheduled request (dispatch later); allowed values come from `confirm.schedule_options`.

    Response `202`:
    ```json
    { "ok": true, "request_id": "swr_demo_0001", "state": "dispatched", "created_at": "2026-11-02T14:33:10Z", "reused": false,
      "no_order": true, "retry_after_ms": 2000,
      "actions_url": "https://github.com/example-org/example-repo/actions/workflows/switch.yml" }
    ```
    Errors: `409 switch_not_connected` (while `SWITCH_ACTIVATION_CONNECTED` is false), `409 base_changed`, `409 request_in_flight`, `422 confirm_suffix_mismatch`, `422 preflight_blocking`, `410 preview_expired`, `502 dispatch_failed`.

    Exists? **CHANGED / NEW.** `POST /api/switch` (`dispatchSwitch`) stays as the internal dispatcher; desk adds the preview binding, request ledger and suffix check around it.

    #### Step 5: `GET /api/desk/switch/requests/{request_id}` — NEW (verify read-back)

    ```json
    {
      "ok": true,
      "request_id": "swr_demo_0001",
      "target_id": "ibkr/tqqq",
      "state": "readback_pending",
      "terminal": false,
      "created_at": "2026-11-02T14:33:10Z",
      "updated_at": "2026-11-02T14:33:42Z",
      "retry_after_ms": 2000,
      "timeout_at": "2026-11-02T14:48:10Z",
      "workflow": { "status": "completed", "conclusion": "success", "run_url": "https://github.com/example-org/example-repo/actions/runs/1000001" },
      "expected": [ { "key": "strategy_profile", "value": "soxl_soxx_trend_income" }, { "key": "income_layer_max_ratio", "value": "0.50" } ],
      "readback": {
        "readback_id": "rb_demo_0004",
        "read_at": "2026-11-02T14:33:40Z",
        "fields": [
          { "key": "strategy_profile", "expected": "soxl_soxx_trend_income", "platform": { "status": "known", "value": "tqqq_growth_income", "observed_at": "2026-11-02T14:33:40Z" }, "state": "pending" },
          { "key": "income_layer_max_ratio", "expected": "0.50", "platform": { "status": "unknown", "reason": "read_failed" }, "state": "unknown" }
        ]
      },
      "timeline": [
        { "at": "2026-11-02T14:33:10Z", "step": "dispatched", "detail": "Workflow dispatch accepted (HTTP 204)." },
        { "at": "2026-11-02T14:33:38Z", "step": "workflow_completed", "detail": "success" },
        { "at": "2026-11-02T14:33:40Z", "step": "readback_started", "detail": null }
      ]
    }
    ```

    State machine (strict; backend must emit only these):

    ```
    scheduled → dispatched → applying → readback_pending → verified            (terminal, success)
                    │            │            │          ↘ mismatch            (terminal, needs attention)
                    │            └→ failed    └→ unknown                      (terminal, outcome not provable)
                    └→ failed (dispatch rejected)
    ```

    - `verified`: only if a read-back taken **after** workflow completion returns `known` and equal values for **every** `expected` key. Not on workflow success alone.
    - `mismatch`: read-back is `known` for all keys and at least one differs after the timeout/grace window. The row `state` is `mismatch`; show the diff.
    - `unknown`: timeout reached and read-back is still unreadable, or workflow conclusion cannot be fetched. Copy: "Could not confirm. The platform may or may not have changed." It is **not** `failed` and is **never** shown as "stopped" or "not applied".
    - `failed`: dispatch rejected (4xx) or workflow `conclusion` is `failure/cancelled`. Even then the UI says "workflow failed; run read-back to see current state" with a button to start a read-back.
    - `readback.fields[].state`: `pending | match | mismatch | unknown`. `pending` = read OK, value not yet at target (waiting for the platform to catch up).
    - `terminal: true` iff state ∈ `verified | mismatch | unknown | failed`.
    - `GET` is cheap; backend advances the state on read when due (lazy), or via cron — backend's choice. Frontend only polls.

    Also `GET /api/desk/switch/requests?target_id=&limit=` list for "recent switches", same row without `readback`/`timeline` — optional, can follow later.

    Exists? **NEW.** Closest today: the dispatch response's `account_options_sync` placeholder and `POST /api/internal/sync-account-default` (`syncAccountDefaultResponse`, `worker.js`), which the workflow calls back after success. That callback can be the trigger that moves `workflow_completed → readback_pending`.

    ---

    ### 3.11 Stop-only: `GET /api/runtime-stop`, `POST /api/runtime-stop`, `POST /api/runtime-resume` — **CHANGED**

    Exists: `readRuntimeStop` (L6261), `dispatchRuntimeStop` (L6365), `dispatchBinanceResume` (L6454); routes ~L966–968; HK-only and Binance-only. `GET` for any other target returns `{ok:true, configured:false, platform_applied:false, request_succeeded:false, phase:null, runtime_observation:{status:"unknown", request_succeeded:false}}`. `hkStopObservation` always returns `{status:"unknown"}` — deliberately, because lifecycle snapshots cannot prove which account they describe.

    Current `GET` response (HK):
    ```json
    { "ok": true, "configured": false, "platform_applied": false, "request_succeeded": false, "stop_confirmed": false,
      "in_flight_state": "unknown", "request_id": "hkstop_demo_0001", "phase": "accepted", "dispatch_result": "accepted",
      "requested_at": "2026-11-02T14:40:00Z", "updated_at": "2026-11-02T14:40:01Z",
      "actions_url": "https://github.com/example-org/example-repo/actions/workflows/manual-runtime-stop.yml",
      "runtime_observation": { "status": "unknown", "request_succeeded": false } }
    ```

    Changes requested:

    1. Accept any `target_id` the platform registry declares stop-capable (not just `longbridge/hk`): `GET /api/runtime-stop?target_id=ibkr/tqqq` (keep `platform`/`target_name` params working). Capability list in `GET /api/desk/switch/targets` → `stop: {supported: boolean, resume_supported: boolean}`.
    2. `runtime_observation` becomes `{ "status": "running" | "stopped" | "unknown", "observed_at": "...", "reason": "identity_unverified" }`. Keep `unknown` as the only value until an identity-verified read exists; do **not** map `phase:"accepted"` to `stopped`.
    3. Request body for stop (`POST`) keeps the existing confirm literal `STOP_ONLY` (`dispatchRuntimeStop`); add `confirm_account_suffix` to match the Switch confirm. Response unchanged.
    4. Stop never changes strategy, config or positions: `no_order: true` stays in the response.

    The Stop-only panel only ever says "Stop requested" / "Stop confirmed" (when `stop_confirmed`) / "Runtime state unknown". It never says "Stopped" from `phase:"accepted"`.

    ---

    ### 3.12 `POST /api/desk/reconcile` — NEW, **gated** (Open question Q1)

    Feeds the two buttons on the drift panel: "Re-apply saved config" (push saved → platform) and "Adopt platform values" (pull platform → saved).

    ```json
    { "target_id": "longbridge/hk", "direction": "apply_saved", "readback_id": "rb_demo_0001", "fields": ["enabled", "cash_reserve_ratio"],
      "confirm_account_suffix": "0001", "idempotency_key": "demo-rc-0001" }
    ```
    Response/state machine: identical to §3.6 step 5 (`request_id`, `GET /api/desk/switch/requests/{id}` serves both; add `kind: "switch" | "apply_saved" | "adopt_platform"`).

    Why gated: the settings payload hard-codes `adopted:false` and `execution_authority_granted:false` (`accountSettingsPayload`), and "adopt" would write platform state into the saved record. That is an owner policy decision, not a UI decision. **Until backend returns `actions.reapply_saved.allowed:true` / `actions.adopt_platform.allowed:true` in §3.4, the frontend renders the buttons disabled with the `reason_code`.** Exists? **NEW.**

    ---

    ### 3.13 `GET /api/desk/accounts` — NEW (broker health matrix)

    Rows are brokers; each broker lists its targets.

    ```json
    {
      "ok": true,
      "generated_at": "2026-11-02T14:32:07Z",
      "brokers": [
        {
          "platform": "ibkr", "label": "IBKR",
          "targets": [ { "target_id": "ibkr/tqqq", "account_ref": "U•••0001" }, { "target_id": "ibkr/soxl", "account_ref": "U•••0002" } ],
          "connectivity": { "status": "known", "value": "up", "observed_at": "2026-11-02T14:31:00Z" },
          "connectivity_detail": "gateway",
          "heartbeat": { "status": "known", "value": { "at": "2026-11-02T14:31:00Z" }, "observed_at": "2026-11-02T14:31:00Z" },
          "data_freshness": { "data_status": "ready", "age_seconds": 11040 },
          "config": { "state": "synced", "drift_count": 0 },
          "credential": { "kind": "session", "expiry": { "status": "none" }, "phase": "not_due", "requires_action": false },
          "last_order": { "status": "known", "value": { "at": "2026-11-02T14:05:00Z", "count": 2 }, "observed_at": "2026-11-02T14:31:00Z" }
        },
        {
          "platform": "binance", "label": "Binance",
          "targets": [ { "target_id": "binance/spot", "account_ref": "BN•••0001" } ],
          "connectivity": { "status": "unknown", "reason": "read_failed" },
          "connectivity_detail": null,
          "heartbeat": { "status": "unknown", "reason": "never_read" },
          "data_freshness": { "data_status": "unavailable", "age_seconds": null },
          "config": { "state": "unknown", "drift_count": 0 },
          "credential": { "kind": "api_key", "expiry": { "status": "none" }, "phase": "not_due", "requires_action": false, "note": "IP-restricted" },
          "last_order": { "status": "unknown", "reason": "never_read" }
        }
      ]
    }
    ```

    - `connectivity.value`: `"up" | "degraded" | "down"`. If heartbeat is missing/old and nothing proves it is down: `unknown`, never `down`. (Lifecycle already separates `monitoring.execution_heartbeat` from `deployment` state; `RuntimeSnapshot.targets[].monitoring`, `api.ts`.)
    - `credential` here is a summary of §3.20 for the broker's worst-phase credential.
    - Exists? **NEW.** Sources: `/api/runtime-target-lifecycle` (`runtimeTargetLifecycleResponse`, `worker.js` ~L9027), `/api/account-facts`, readback summary.

    ### 3.14 `GET /api/desk/accounts/{target_id}` — NEW (detail: holdings + account facts)

    ```json
    {
      "ok": true,
      "target_id": "longbridge/hk",
      "platform": "longbridge",
      "account_ref": "LB•••0001",
      "mode": { "status": "known", "value": "live", "observed_at": "2026-11-02T14:31:12Z" },
      "nav": { "currency": "HKD", "amount": "1113000.00", "usd": "142700.00", "status": "known", "observed_at": "2026-11-02T09:06:00Z" },
      "holdings": {
        "status": "known",
        "scope": "strategy_symbols_only",
        "observed_at": "2026-11-02T09:06:00Z",
        "rows": [
          { "symbol": "3033.HK", "name": "Hang Seng TECH ETF", "quantity": "18200", "last_price": { "status": "known", "value": "4.82", "observed_at": "2026-11-02T08:00:00Z" },
            "day_change_ratio": { "status": "unknown", "reason": "not_supported" }, "market_value": "87724.00", "currency": "HKD", "weight_ratio": "0.298" },
          { "symbol": "CASH", "name": "HKD", "quantity": null, "last_price": null, "day_change_ratio": null, "market_value": "133560.00", "currency": "HKD", "weight_ratio": "0.12" }
        ]
      },
      "facts": {
        "environment": "live",
        "strategy_domains": ["us_equity", "hk_equity"],
        "facts_binding": { "status": "known", "value": "verified", "observed_at": "2026-11-02T13:02:00Z" },
        "service": "longbridge-hk-service",
        "alert_route": "QuantSentinel · Telegram",
        "cash": [ { "currency": "HKD", "available_cash": "133560.00", "frozen_cash": "0.00", "settling_cash": "0.00" } ],
        "financing": []
      }
    }
    ```
    - `holdings.scope` is exactly the existing `positions_scope` (`"stocks_only" | "strategy_symbols_only"`, `AccountFactsAccount`, `types.ts`). The frontend labels the table with the scope and never calls it "all holdings" unless the backend says so.
    - `last_price`/`day_change_ratio` require a quote source that the console does not have today (account facts give `quantity`, `market_value`, `avg_cost` only: `AccountFactsPosition`). Default `unknown/not_supported`; the Day column then shows `?`.
    - `weight_ratio` computed backend-side from `market_value / nav` in one currency; `null` when NAV unknown.
    - Exists? **NEW** wrapper. Data source exists: `GET /api/account-facts` (`accountFactsResponse`, `worker.js` ~L10509) positions/balances/cash/financing, and `GET /api/account-facts/history`.

    ---

    ### 3.15 `GET /api/desk/performance` — NEW

    Query: `?range=1M|3M|6M|YTD|1Y|ALL` (default `6M`), `&scope=all|strategy`, `&target_id=` (optional filter), `&benchmark=nasdaq100` (default).

    ```json
    {
      "ok": true,
      "generated_at": "2026-11-02T14:32:07Z",
      "range": "6M",
      "scope": "all",
      "history": { "first_date": "2026-09-14", "requested_from": "2026-05-02", "truncated_by": "retention", "retention_days": 366 },
      "return_basis": { "kind": "mixed", "per_target": { "ibkr/tqqq": "native_ibkr_twr", "longbridge/hk": "nav_change_unadjusted" } },
      "equity": {
        "dates": ["2026-10-09", "2026-10-10"],
        "portfolio_indexed": ["100.00", "100.41"],
        "benchmark": { "id": "nasdaq100", "label": "Nasdaq 100", "indexed": ["100.00", "100.52"] },
        "drawdown_ratio": ["0.000", "-0.002"],
        "gap_dates": []
      },
      "risk": {
        "return_ratio": { "status": "known", "value": "0.184", "observed_at": "2026-11-02T14:26:00Z" },
        "vs_benchmark_pts": { "status": "known", "value": "0.041", "observed_at": "2026-11-02T14:26:00Z" },
        "volatility_ann_ratio": { "status": "unknown", "reason": "insufficient_history" },
        "sharpe": { "status": "unknown", "reason": "insufficient_history" },
        "sortino": { "status": "unknown", "reason": "insufficient_history" },
        "max_drawdown_ratio": { "status": "known", "value": "-0.098", "observed_at": "2026-11-02T14:26:00Z" },
        "time_under_water_days": { "status": "known", "value": 41, "observed_at": "2026-11-02T14:26:00Z" },
        "best_day_ratio": { "status": "known", "value": "0.042", "observed_at": "2026-11-02T14:26:00Z" },
        "worst_day_ratio": { "status": "known", "value": "-0.039", "observed_at": "2026-11-02T14:26:00Z" }
      },
      "scorecard": [
        { "target_id": "ibkr/tqqq", "strategy_label": "TQQQ Growth Income", "since": "2026-05-04", "days": 182,
          "cagr_ratio": { "status": "known", "value": "0.318" },
          "max_dd_ratio": { "status": "known", "value": "-0.264" },
          "sharpe": { "status": "known", "value": "1.12" },
          "vol_ratio": { "status": "known", "value": "0.84" },
          "capital_share_ratio": "0.41", "return_basis": "native_ibkr_twr" }
      ],
      "contribution": { "period": "MTD", "unit": "pts_of_nav", "rows": [ { "target_id": "ibkr/tqqq", "label": "TQQQ Growth Income", "points": "0.042" } ] },
      "monthly": { "unit": "ratio", "rows": [ { "year": 2026, "months": ["-0.000", "0.000", "0.100", null, null, null, null, null, null, null, null, null], "ytd": "0.47" } ] }
    }
    ```

    Rules:

    - **History is limited. Be honest about it.** Account-facts history keeps `ACCOUNT_FACTS_HISTORY_MAX_DAYS = 366` days (`account_facts.js` L55) and there is a gap list; the benchmark set starts at inception `2026-10-09` (`MARKET_BENCHMARK_INCEPTION_DATE`, `infrastructure/market_benchmark/market_benchmark.js`). The design mockup draws two years of monthly returns and 6 M curves with day counts up to 203; today's data cannot support that for most targets. `history.first_date` tells the frontend where the real series starts; ranges that reach earlier show a "history starts {date}" note, and metrics that need ≥ N days are `unknown/insufficient_history` (N is backend-owned and returned in `reason`: `"insufficient_history"`).
    - **Return basis.** Only IBKR provides a time-weighted return (`native_ibkr_twr`). Others are `nav_change_unadjusted` (deposits/withdrawals look like performance) or `unavailable`. The frontend must change the subtitle accordingly. The mockup's "Time-weighted returns, net of fees" is only true for the IBKR rows. Portfolio-level `return_basis.kind`: `"native_ibkr_twr" | "nav_change_unadjusted" | "mixed" | "unavailable"`. This is a copy requirement, not decoration: the UI must not print "time-weighted" unless it is.
    - `benchmark` fallback: `"unavailable"` object `{ "id": null, "label": null, "indexed": [] }` when no benchmark data covers the range.
    - `scope=strategy` returns one `equity` series per strategy under `equity_by_target`.
    - `monthly.rows[].months` has 12 entries; `null` = no data (not zero). Mockup shows "+0" for no change, which is different from no data.
    - Sparklines on Overview are served by `GET /api/desk/overview` (`book[].sparkline_30d`) so no extra request.

    Exists? **NEW.** Inputs exist (`GET /api/account-facts/history?platform=&account_key=&currency=` returns `series.points` of `net_assets`, `gap_dates`, `truncated`, `retention_days`; `AccountFactsHistorySnapshot`, `types.ts`). No endpoint computes drawdown, Sharpe, contribution or monthly tables.

    ### 3.16 `GET /api/market-benchmark` — **CHANGED**

    Exists: route `MARKET_BENCHMARK_API_PATH` (`worker.js` ~L777), handler `marketBenchmarkResponse` (~L15994), module `infrastructure/market_benchmark/market_benchmark.js`.

    Current response:
    ```json
    { "ok": true, "schema_version": "qsl.market_benchmark_points.v1", "inception_date": "2026-10-09", "timezone": "Asia/Shanghai",
      "points": [ { "seriesId": "纳斯达克100", "observationDate": "2026-10-09", "close": "17000.12", "source": "demo_source" } ] }
    ```
    Series ids are Chinese labels (`标普500`, `纳斯达克100`, `道琼斯工业平均指数`, `罗素2000`).

    Requested changes (additive, non-breaking):

    1. Add `series: [{ id: "nasdaq100", legacy_id: "纳斯达克100", label_en: "Nasdaq 100", label_zh: "纳斯达克100", kind: "index" }, ...]` so the frontend maps stable ASCII ids (`sp500`, `nasdaq100`, `djia`, `russell2000`) to display labels, with no hard-coded Chinese strings. Keep `seriesId` in points unchanged for the old console.
    2. Optional `?from=&to=&series=` filters to cut payload.
    3. **Design mismatch to resolve:** the mockups compare against "QQQ" (an ETF). The backend only stores index closes. Frontend will say "Nasdaq 100" (index) unless the owner wants an ETF series added. See Q3.

    ---

    ### 3.17 `GET /api/desk/alerts` — NEW

    Query: `?severity=critical,warning&status=open|resolved|all&since=<ISO>&target_id=&limit=&cursor=`

    ```json
    {
      "ok": true,
      "generated_at": "2026-11-02T14:32:07Z",
      "counts": { "open": 3, "critical": 1, "warning": 2, "info": 1, "last_7d_total": 34 },
      "items": [
        { "id": "alr_demo_0001", "severity": "critical", "status": "open", "kind": "config_drift", "target_id": "longbridge/hk",
          "title": "Drift: saved ≠ platform", "detail": "enabled, cash_reserve_ratio differ. Detected by daily read-back.",
          "first_seen_at": "2026-11-02T14:26:00Z", "last_seen_at": "2026-11-02T14:31:12Z", "resolved_at": null,
          "source": "readback", "route": "/accounts?target=longbridge/hk", "log_ref": { "run_id": "r-20261102-hk" } },
        { "id": "alr_demo_0005", "severity": "info", "status": "resolved", "kind": "digest", "target_id": null,
          "title": "Daily digest sent · Telegram", "detail": "QuantSentinel delivered to 1 chat. 7 targets, 11 runs.",
          "first_seen_at": "2026-11-02T06:00:00Z", "last_seen_at": "2026-11-02T06:00:04Z", "resolved_at": "2026-11-02T06:00:04Z",
          "source": "digest", "route": null, "log_ref": null }
      ],
      "next_cursor": null
    }
    ```
    - `kind` is the same enum as `needs_you[].kind` plus `digest | delivery_failed | candidate_ready | other`.
    - `status`: `open | resolved`; backend owns auto-resolve.
    - No chat ids, tokens, order ids beyond 8-char prefixes, no account numbers beyond `target_id`/suffix. Redaction is backend-side.
    - Exists? **NEW.** There is no alert store or read route. The only persisted trail is the admin audit log: key `audit_log`, capped at `AUDIT_LOG_LIMIT = 50` (`worker.js` L169–170), returned only inside the admin `GET /api/admin/config` as `auditLog`. Config changes are audited; runs and drift are not. Alerts come from: drift (derived from §3.4), credential phase (§3.20), drawdown limits (§3.3), strategy health (`/api/strategy-health`), digest results (`daily digest`, merged in #1045), candidate-ready (`/api/owner-decisions`, `/api/research-promotion-tickets`). Backend decides storage (KV list with TTL is acceptable; 30 days).

    ### 3.18 `GET /api/desk/alerts/delivery` — NEW

    ```json
    { "ok": true,
      "channel": { "name": "QuantSentinel · Telegram", "status": { "status": "known", "value": "ok", "observed_at": "2026-11-02T06:00:04Z" } },
      "last_delivery": { "at": "2026-11-02T06:00:04Z", "outcome": "ok", "recipients": 1 },
      "digest": { "schedule_utc": "06:00", "last_composed_at": "2026-11-02T06:00:00Z", "targets": 7, "runs": 11 } }
    ```
    `channel.status.value`: `"ok" | "failing"`. If the last delivery cannot be verified: `unknown`. Exists? **NEW** (delivery receipts are not exposed today).

    ### 3.19 `GET /api/desk/logs` — NEW (run log + live tail)

    Query: `?target_id=&run_id=&source=&level=info|warn|error|debug&q=&after=<cursor>&limit=200`. For live tail the frontend sends the last `cursor` as `after` every 15 s.

    ```json
    {
      "ok": true,
      "items": [
        { "id": "log_demo_0001", "at": "2026-11-02T14:31:12Z", "level": "warn", "source": "longbridge/hk", "run_id": "r-20261102-hk",
          "message": "readback mismatch enabled: saved=true platform=false" },
        { "id": "log_demo_0002", "at": "2026-11-02T14:30:03Z", "level": "info", "source": "binance/spot", "run_id": "r-20261102-bn",
          "message": "BTC DCA order 7c1e… FILLED qty=0.00112" }
      ],
      "next_cursor": "c_demo_0002",
      "retention": { "days": 7, "truncated": false },
      "redaction": "applied"
    }
    ```
    - `level` enum `debug|info|warn|error`; `source` is `target_id` or one of `control-plane | account-facts | research | digest`.
    - **Backend redacts before storing/returning**: message is plain text ≤ 400 chars; no tokens, full account numbers, full order ids, chat ids (mask as `***412`). The frontend renders as text (never HTML) and does not try to redact.
    - Exists? **NEW.** There is no log API. Runtime logs live in the platform repos / GCP; `runtime-daily` has run summaries with `errors_present` booleans only (`runtimeDailyPublicRecord`). Backend decides the ingestion path (platform repos POST structured events through an internal token route like `/api/internal/sync-*`). See BE-13.

    ---

    ### 3.20 `GET /api/desk/credentials` — NEW (credential expiry, all brokers)

    ```json
    {
      "ok": true,
      "generated_at": "2026-11-02T14:32:07Z",
      "items": [
        { "id": "schwab_refresh", "platform": "schwab", "label": "Refresh token", "kind": "oauth_refresh",
          "expiry": { "status": "known", "at": "2026-11-04T17:30:00Z", "source": "issued_at_plus_ttl" },
          "limit_days": 7, "phase": "7", "requires_action": true,
          "rotation": { "supported": false, "route": null }, "runbook": "schwab-token-refresh", "last_rotated_at": "2026-10-28T17:30:00Z" },
        { "id": "ibkr_flex", "platform": "ibkr", "label": "Flex query token", "kind": "flex_token",
          "expiry": { "status": "known", "at": "2027-03-01T00:00:00Z", "source": "operator_provided" },
          "limit_days": null, "phase": "not_due", "requires_action": false,
          "rotation": { "supported": true, "route": "/api/credential-maintenance" }, "runbook": null, "last_rotated_at": null },
        { "id": "binance_api_key", "platform": "binance", "label": "API key", "kind": "api_key",
          "expiry": { "status": "none" }, "limit_days": null, "phase": "not_due", "requires_action": false,
          "rotation": { "supported": false, "route": null }, "runbook": null, "last_rotated_at": null },
        { "id": "longbridge_access", "platform": "longbridge", "label": "Access token", "kind": "access_token",
          "expiry": { "status": "unknown", "reason": "never_read" }, "limit_days": null, "phase": "unknown", "requires_action": false,
          "rotation": { "supported": false, "route": null }, "runbook": null, "last_rotated_at": null }
      ]
    }
    ```
    - `expiry.status`: `known` (has `at` + `source`) | `none` (credential does not expire, e.g. IP-locked key — a **fact**, not unknown) | `unknown` (+ `reason`). The mockup shows `n/a`, `IP-locked`, `41d`, `28d`; the frontend maps `none` to a short label, never `n/a` for unknown.
    - `phase` reuses the **existing** vocabulary from `CredentialMaintenance` (`api.ts`): `unknown | not_due | "30" | "7" | "1" | expired`. `requires_action` = `phase` ∈ `30|7|1|expired` (existing invariant: `requires_action === (phase !== "not_due")`; for `unknown` it stays `false`, as `validCredentialMaintenance` allows). The design says Schwab warns at 2 d 03 h; the exact day is derived from `expiry.at` on the client with the server clock from the session payload; `phase` is the server's coarse bucket.
    - Secrets never appear: only metadata. Write-only entry for IBKR Flex already exists and is not part of this list's contract (see §3.21).
    - `kind`: `oauth_refresh | flex_token | access_token | api_key | password | session | other`.
    - Exists? **NEW** list. **EXISTS** for one credential: IBKR Flex only (§3.21). Expiry for Schwab/LongBridge/Firstrade/Binance is not stored anywhere in the Worker today; backend must pick the source (platform repos push metadata, or operator-provided like Flex). Open question Q4.

    ### 3.21 `GET/POST /api/credential-maintenance` — **EXISTS**

    Route + handler: `credentialMaintenanceResponse` (`worker.js` ~L1048); client + validator: `loadCredentialMaintenance`, `validCredentialMaintenance`, `validCredentialRegistrationAck` (`frontend/src/api.ts`). Merged: #1043 (backend), #1044 (UI).

    `GET` response (unchanged):
    ```json
    { "id": "ibkr_flex", "metadata_source": "operator_provided", "metadata_revision": 3,
      "expires_at": "2027-03-01T00:00:00Z", "phase": "not_due", "requires_action": false, "delivery": "not_reserved" }
    ```
    `POST` (admin, same-origin, body ≤ 1024 bytes) registers the expiry. No change requested. The desk reuses this exact panel/validator for the IBKR row; the new §3.20 list references it via `rotation.route`.

    ---

    ## 4. Screen → endpoint map

    | Screen / component | Endpoints |
    |---|---|
    | Header, session ribbon, run tape, alert badge | §3.1, §3.2 |
    | Overview: key figures, Book, sparklines, equity chart, Needs you | §3.3 (+ §3.16 for chart label ids) |
    | Overview mobile rows | §3.3 (same payload) |
    | Strategy switch steps 1–5 | §3.6 (6, 7, 8, 9, 10), §3.4 |
    | Strategy switch, Stop-only panel | §3.11 |
    | Accounts: broker matrix | §3.13, §3.20 |
    | Accounts: drift/diff panel, "Re-read" | §3.4, §3.5, §3.12 |
    | Accounts: holdings + facts | §3.14 |
    | Performance | §3.15, §3.16 |
    | Alerts list + delivery | §3.17, §3.18 |
    | Run log + live tail | §3.19 |
    | Credential expiry (matrix cell, Overview Needs you, IBKR rotation) | §3.20, §3.21 |

    ## 5. Open questions for the owner/backend (answer in BE-0)

    - **Q1** Are "Re-apply saved" and "Adopt platform" allowed at all? Current code marks adoption false everywhere. Default plan: buttons ship disabled.
    - **Q2** Pre-flight "No open orders" needs a broker read. Does any platform expose it to the Worker? If not, the row is `unknown` and live switch is blocked (safe default) or downgraded to `warn` by owner decision.
    - **Q3** Benchmark: index series (Nasdaq 100) or add ETF closes (QQQ) to match the mockup?
    - **Q4** Where does credential expiry for Schwab/LongBridge/Firstrade/Binance come from (platform repo push vs operator-entered like Flex)?
    - **Q5** Turnover/order-count/leveraged-ETF estimates on the diff: out of scope (stay `unknown`) or does a platform repo expose a dry-run planner?
    - **Q6** Log and alert retention (proposal: 7 d logs, 30 d alerts) and ingestion route.
    - **Q7** Holdings quotes/day change: is there an allowed market-data source for the Worker, or do we ship holdings without Last/Day?

    ## 6. Compatibility and versioning

    - Additive changes (new optional fields, new enum values) are non-breaking. Frontend treats unknown enum values as `unknown` in the UI and logs a console warning. Removing or retyping a field requires a new path (`/api/desk/v2/...`) and an overlap period.
    - Every `/api/desk/*` response includes `ok: true` and `generated_at`. Add a `schema_version` string (`"qsl.desk.<name>.v1"`) at the top level of each response so contract tests can pin it (precedent: `MARKET_BENCHMARK_SCHEMA`).
    - JSON Schema files for each response live in `schemas/desk/` (BE-0) and are the machine-readable form of this document; the frontend generates TS types from them.
