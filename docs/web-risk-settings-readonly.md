# Risk settings: read-only implementation

`web-risk-console.readonly.v1` adds an account risk tab and authenticated catalogue/account reads. Research values always carry “建议/未生效” / “Suggestion / not effective”. The disclosure is a placeholder, not final. Legacy risk preferences are display mappings and never populate effective values or select a research level automatically.

This version does not implement account mutations. The existing authority contains preference enums, not a verified 30-parameter effective policy. Verified identity, applicability, effective parameters, budget and breaker evidence are unbound. Account editing, restoration, confirmation and cancellation remain disabled. There is no environment switch or client field that enables these operations.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/risk-levels/catalog` | Authenticated pinned research catalogue, definition digest, server time and safety flags |
| `GET /api/accounts/{platform}/{key}/risk-settings` | Exact existing account, SELECT-only legacy preference, null effective values, read-only capabilities and UNKNOWN audit |
| `GET /api/accounts/{platform}/{key}/risk-settings/audit` | Admin-only UNKNOWN / partial discovery; no fabricated successful audit |
| `POST /api/risk-settings/preview` | Admin and same-origin checks; schema validation, then 503 write service unavailable; no token issued |
| `POST /api/risk-settings/confirm` | Admin and same-origin checks, then 503 before processing |
| `POST /api/risk-settings/{request_id}/cancel` | Same unavailable behavior; no command dispatched |

The new read handler does not call the legacy account settings reader, which can initialize risk authority. It SELECTs existing authority only. No risk defaults, budgets, configurations or authority are updated.

The 30 catalogue parameters and request schema are pinned from UsEquityStrategies commit `c4279eef09c660dca6774a7a61a0fe6d7816a7a9`, `docs/research/risk-levels`. They are research definitions, not runtime defaults. `definitions.js` is an ESM copy of the JSON data for Worker compatibility; tests check exact equality and the catalogue byte digest. Frontend display metadata contains no economic defaults.

The frontend can project a supplied server request into cooldown, awaiting final confirmation, or request expired, using `[t0+48h, t0+120h)` and server time plus monotonic elapsed time. These are **display helpers**, not server-side authorization. Current production reads return no request. Synthetic SSR fixtures exercise those states and audit blocking reasons; they do not prove persistence, reconciliation or actual 72-hour confirmation enforcement.

Remaining blocked work: approved read-only source integration; accepted P4 preview and fresh confirmation binding; INITIAL/FINAL/CANCEL persistence and replay; server-side deadline/disclosure enforcement; append-only audit, receipts and recovery/backfill through DESIGN-09. These require a separately reviewed mutation implementation after the missing authority source is specified. The placeholder disclosure still needs final wording. No deployment is part of this change.
