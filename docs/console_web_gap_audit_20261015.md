# Console gap audit, 2026-10-15

Scope: `QuantRuntimeSettings/web/strategy-switch-console`, inspected at
`ee6d42a2ce3e0f45731a881e360d2c53c198f742`. `quant-professional` is a local
agent harness, not this website. Notification consumers do not host a separate
owner dashboard.

All browser checks used loopback and invented fixtures. No production website,
server, market data, account data, credentials or deployment was accessed.

| Gap | Evidence | Status |
| --- | --- | --- |
| Local Vite page is blank | Chrome reports `createContext` used before initialization in `locales.ts` | Fixed in [draft #654](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/654); includes a synthetic-only local dev server |
| Account directory failure looks like an empty table | Synthetic `/api/config` 503 leaves settings with only table headers | Fixed in [draft #655](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/655); distinct failed/empty states and explicit GET recovery |
| Partial or stale decision reads have no queue-wide recovery control | `DecisionsPage` only offered re-read in the empty hard-failure branch | Fixed in draft #655; available items remain visible and re-read is disabled while busy |
| Long mobile queue hides selected details | At 375px, selecting item 2 of 12 leaves detail at approximately 1223px below the viewport top | Fixed in [draft #656](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/656); detail focus/scroll and return-to-list |
| T3 operations issues have no accepted queue kind or ingress | `DailyDecision` and human-decision dispatch support financial/recovery/maintenance subjects; no `operations_triage` | Existing [draft #653](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/653) owns the contract; implementation, authenticated publisher/storage and rollout remain pending; no duplicate draft |
| General strategy application and enablement remain incomplete | `ACCOUNT_PLAN_SUBMISSION_AVAILABLE=false`; ordinary settings are drafts, with separately scoped profile/paper application paths | Deferred: changing trading/permission behavior requires a reviewed implementation and a separate release; no fake successful application |
| Historical human decisions have no dedicated read-only UI | `listDailyDecisions` filters awaiting items; receipt reads are request-specific, not a history screen | Open: preserve existing records; a bounded history read model and UI still need implementation |

The three UI PRs are independent and remain drafts: the existing main-push
workflow automatically deploys any change under `web/strategy-switch-console`.
Merging them during a no-deployment task would violate the owner's boundary.
This documentation-only change is outside that deployment path filter.

## API, route and data-binding checks

- Current consumers exist for session, config, lifecycle, control-plane,
  research draft, owner decisions, recovery, promotion, credential maintenance,
  account facts/history, Binance facts/history, account settings/diagnosis,
  runtime daily records, benchmark/FX reads and admin models.
- Internal sync/claim/ack routes are producer/controller interfaces. Historical
  `/api/strategy-health`, `/api/execution-evidence`, `/api/research-tasks`,
  `/api/adaptive-selection` and `/api/m0-research` are not fetched by the current
  dashboard. Their existence alone is not a reason to add another screen.
- The Worker serves `/` and its generated versioned assets; workspace query
  links are the navigation contract. Unknown asset/routes return 404. Local
  navigation, Back/Forward, translations and theme controls were exercised.
- Anonymous access stays on the access screen. Synthetic reader sessions skip
  admin/private-scope reads. Existing Worker tests separately verify session,
  shell and route boundaries; mocks are not proof of production authentication.
- Missing account facts and benchmark/return inputs remain unknown. General
  fallback rendering does not prove real historical coverage, complete cash
  flows, comparability, source freshness or business recovery. No real data
  was requested to fill a gap.

## Verification

The fixes passed TypeScript/Vite builds, synchronized asset maps, translation
validation, Worker shell/routes and workflow/readback checks. Draft #655 adds
actual React rendering regressions for empty, failed, partial, busy and English
states. Draft #654 tests loopback fixtures, rejected writes and failure modes.
Chrome interaction covered 320/375px mobile widths and desktop behavior.

CI results and exact draft heads are recorded in the local job report. Source
prepared, checks passed, merged and deployed are separate statuses. No website
runtime fix has been deployed or verified against real accounts in this audit.
