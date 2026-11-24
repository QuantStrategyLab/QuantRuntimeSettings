# Observation and identity boundaries

Status: accepted (2026-11-14, adopted in part)

## Context

An architecture assessment of the strategy-switch console found the same
problems in several layers, not one isolated bug:

- The `RuntimeInstances` Durable Object creates tables and indexes, attempts
  ALTERs and drops/recreates an index before `fetch` selects an operation.
  This ran in the constructor; it now runs lazily in `initializeStorage()`,
  once per instance, at the start of the ordinary `fetch` path and of `alarm`,
  and construction runs no SQL. Every ordinary read of either named object
  (`runtime-instances`, `console-kv-directory-v1`) still inherits those
  writes; only the account-identity inventory and account-management readback
  paths are dispatched before them. `binance_detail_read` originally created
  its own table as well; table creation has moved to `binance_detail_put`
  (B5 retired).
- Six read families also repair, migrate, reconcile, refresh or collect: risk
  authority import, cycle-health checkpoint migration, runtime-stop receipt
  reconciliation, credential-rotation settlement, the fresh Desk readback and
  the config/current-strategy cache refresh. Tests protect these behaviours, so
  they are supported patterns, not leftovers.
- Technical account keys serve as display names and as operational identity.
  Joins across registries rely on unqualified `(platform, key)` without a
  canonical account boundary.
- Capped, filtered and configured-only projections are reused as though they
  enumerated retained state, and lose scope and completeness on the way.

The existing authority/evidence separation, exact binding checks, N1 coverage
semantics and explicit maintenance paths are sound and stay.

## Decision

Adopt a small, enforced baseline. Do not add a global "safe mode" flag, another
deployment mode, or a rule that every operation is read-only: commands,
maintenance and scheduled jobs write legitimately. The baseline separates
whether invoking an observation can change application state, and whether the
resulting view states its identity and coverage honestly.

The five rules, stated normatively with their test obligations:

- **R1** Observations receive read capabilities, end to end, including
  construction, error branches, cold or old schemas and deferred work.
- **R2** Initialization, persistent repair and migration are explicit, versioned
  commands.
- **R3** Resolve one canonical account identity. Keep account, instance, target
  and display separate.
- **R4** Every projection declares its scope, bounds and completeness.
- **R5** Administrative inspection uses independent retained-state readers.

The rules apply to new and changed observation paths now. Existing violations
are grandfathered only through a finite register with absolute expiry dates.
There is no caller-supplied `safe=true` escape hatch, and no second meaning of
paper, live or dry-run.

## Boundaries

- The effect class of an operation (`observation`, `command`, or a named
  exception) is recorded per public method and path and per internal action in
  [`application/read_contracts.js`](../../web/strategy-switch-console/application/read_contracts.js).
  The HTTP verb alone is not the policy: internal POST RPC can be
  observational, and a GET can still be a command.
- A transaction containing only reads is allowed. An atomic read-and-claim,
  read-and-ack or work reservation is a command.
- Idempotency and replay records belong to command paths. A GET retry does not
  reserve an idempotency record.
- Alarms and scheduled jobs keep their maintenance, expiry and reconciliation
  under their own registered entry points. A read never creates an alarm.
- Request-local computation and bounded in-memory caches of already-read,
  version-qualified data are not persistent effects. Application-owned access
  auditing and durable rate limiting are; classify them explicitly. No security
  control is disabled to pass a test.
- A fresh subset can be incomplete, a complete retained set can be stale, and a
  fully scanned retained store is not recovered deleted history. Contracts keep
  these statements separate.

## Exceptions

[`tests/fixtures/read-contract-exceptions.json`](../../tests/fixtures/read-contract-exceptions.json)
lists each existing violation with its reachable operations, effect type, exact
helpers and their call sites, responsible work item, acceptance test and an
absolute expiry date. T0 is 2026-11-14. Dates are materialized once and never
recomputed.

| Id | Debt | Expires |
| --- | --- | --- |
| B0 | Shared lazy-initialization DDL/ALTER before ordinary dispatch on both named objects | 2027-01-13 (N1 interim deadline consolidated from 2026-12-14 within the 60-day window) |
| B1 | Risk-authority import in risk and settings reads | 2027-01-13 (bounded re-date from 2026-12-14 within the 60-day window) |
| B2 | Cycle-health lazy checkpoint migration | 2027-01-13 (bounded re-date from 2026-12-14 within the 60-day window) |
| B3 | Runtime-stop receipt reconciliation on GET | 2027-01-13 (bounded re-date from 2026-12-14 within the 60-day window) |
| B4 | Credential-rotation settlement on GET | 2027-01-13 (bounded re-date from 2026-12-14 within the 60-day window) |
| B5 | `binance_detail_read` table creation | Retired (table creation moved to `binance_detail_put`; missing-table reads return empty without DDL) |
| B6 | Fresh Desk readback admission, snapshot and alarm on GET | 2027-01-13 |
| B7 | Config/current-strategy durable cache refresh on GET | 2027-01-13 |
| I1 | Technical keys rendered as account names (IBKR isolated in PR #1172; non-IBKR fallback and schema defaults remain) | 2027-01-13 (bounded re-date from 2026-12-14 within the 60-day window) |
| I2 | Legacy `(platform, key)` joins without a canonical boundary | 2027-01-13 (review checkpoint) |
| P1 | Projections without a declared scope/completeness contract | 2027-01-13 |

Pre-`2026-12-14` disposition summary: `B5` is retired (`binance_detail_read`
performs no DDL and returns `{ ok: true, report: null }` when
`binance_detail_daily` is absent, while `binance_detail_put` validates input
and creates the table explicitly). `B0` (N1 interim), `B1`, `B2`, `B3`, `B4`,
and `I1` are re-dated inside ADR 0002's 60-day window from `2026-11-14` to
`2027-01-13` with per-entry `expiry_basis` records in
`tests/fixtures/read-contract-exceptions.json`: `B1` and `B2` require new
explicit import/migration commands and GET contract changes on absent or
legacy v1 rows; `B3` and `B4` require decoupling polling GET side-effects
while preserving pending-operation servicing paths; `B0`'s N1 interim scope
consolidates with full `B0` preamble/missing-table work; and `I1`'s remaining
non-IBKR fallback and schema defaults align with the `R3`/`I2` checkpoint
after PR `#1172` isolated IBKR titles and confirmations. `B6`, `B7`, `I2`,
`P1`, and full `B0` remain at `2027-01-13`.

`tests/read_contract_boundaries_validation.mjs` runs in the `Validate`
workflow. It fails when a route branch or internal action is unclassified or
stale, when an operation reaches an exception the register does not list, when
an excepted helper gains or loses a call site without a register change, when a
helper no longer exists, and once a deadline has passed. A deadline is an
inclusive UTC date: an entry due 2027-01-13 is still valid on that date and
fails the suite from 2027-01-14 (UTC). B0 and B1 are also
reproduced under the read-only trap in `tests/helpers/read_only_storage.mjs`
(while retired B5 is verified zero-write under the same trap);
when a write disappears the suite fails until the entry is closed. With the
trap armed before construction, construction writes nothing and B0 reproduces
on the first ordinary initialization, `fetch` and `alarm`. The runtime
manifest keeps the `RuntimeInstances` constructor as a conservative monitored
writer entry in explicit setup phases; it is not evidence of constructor DDL.

### Extraction contract

The route and action surface is read from source by
[`tests/helpers/read_contract_surface.mjs`](../../tests/helpers/read_contract_surface.mjs),
which parses with the TypeScript version pinned by the console frontend. Run
`npm ci` in `web/strategy-switch-console/frontend` before running the suite
locally; CI installs it before the check. There is no fallback tokenizer.

The dispatch set is the Worker default export entries and `fetch`; the
RuntimeInstances `fetch` (its reviewed preamble: the fixed account-identity
inventory path, then storage initialization, then one try/catch), `alarm`
(storage initialization, then the Desk readback alarm) and the transaction
callback at the end of `fetch`; the inventory delegate `inventoryResponse`,
whose closed section set is classified per section; the `rotation_` delegates (`durableRotationCommand`,
`rotationCommand`); `ux1ResearchCommand`; `KvDirectory.command` and
`KvDirectory.run`; and the action families these test. The suite passes only
when every file in that set parses without a diagnostic, the dispatch code is
admitted, and the extracted route conditions and internal operations equal the
registry entries as sets. Registry conditions are compared as syntax trees, so
whitespace, comments, quote style and redundant parentheses do not matter.

Admission is closed:

- Entries are located structurally. A missing, duplicated or replaced entry,
  or an unsupported export form, fails. Replacement is found by binding, not
  spelling: the entry classes, the Worker default export and the delegate
  functions may be referenced only in their admitted use (`new KvDirectory`,
  a call), so a computed or reflective write through any alias fails.
- Every dispatch-level statement, including every statement of a catch
  clause, is a recognised dispatch branch (an equality or inequality with a
  string literal, a literal list, a family `.has`, a reviewed prefix, or a
  Worker route condition on `url.pathname`) or an exact reviewed statement
  template listed in the helper. Catch clauses are compared whole. Anything
  else fails.
- Every reference to a request, URL or command receiver is resolved through
  bindings, parameters included, and examined. Direct and optional property
  access and truthiness are admitted. Passing a whole receiver to a call is
  admitted only as one of the reviewed forward calls listed in the helper,
  matched as a whole call with its multiplicity inside a gated branch, and
  every module-level name in it must resolve to its reviewed binding (the
  same import, namespace element or local declaration); a same-named
  replacement fails. A gated branch alone authorizes nothing. Method calls on
  a receiver, computed access whatever its key, aliases, destructuring,
  spread, reflection, immediately invoked functions, reassignment, mutation,
  shadowing and dynamic evaluation in any spelling are rejected.
- The instance may not be used as a value. The one admitted position is the
  exact reviewed RuntimeInstances `sql` setter, which defines `sql` as a plain
  data property holding the setter's parameter through the unshadowed built-in
  `Object.defineProperty`; another key, descriptor, member, class or alias fails.
- An action family must resolve through imports and re-exports to one
  `const NAME = new Set([...string literals])` and be used only through
  `.has()` in every module the Worker bundle reaches. Uses are followed by
  import identity (named, namespace and re-exported bindings, escaped
  identifiers), and the module set is every console source file, generated
  ones included. A module that exports a family or entry binding may not be
  dynamically imported or re-exported as a namespace.

This contract covers classification coverage of the dispatch set only. It does
not show that every branch is reachable or that an observation is free of
effects; the trap probes and exception register cover those. A legitimate new
dispatch form requires a change to the helper, reviewed with the code that uses
it.

An exception is not evidence that a path is safe. All B reads are excluded from
strict administrative inventory immediately. A missed deadline blocks the
check until the change, or a documented bounded replan, is reviewed; it never
switches off running controls or changes production behaviour by itself.
Touching an excepted effect requires its migration or an explicit bounded
disposition in the same review. Cosmetic changes need not absorb a subsystem
rewrite.

## Consequences

Authors classify effects, initialize test fixtures explicitly and write
old-schema and pending-state cases. Reviewers verify one boundary instead of
rediscovering hidden effects in each caller. Removing read-triggered writes can
expose older observations or more unavailable states until maintenance runs,
and explicit refresh adds a command round trip. These costs are measured under
synthetic volumes before rollout expands.

The work proceeds in order: this baseline; the bounded display correction and
the independent inventory reader, dispatched before storage initialization
with a wire-only constructor; ordinary reader separation starting from that
lazy initialization; explicit import, migration and reconciliation commands; protected
inventory; canonical identity migration; then projection metadata in bounded
batches.

## Not changed by this decision

1. Trading authority, strategy selection, risk budgets, leverage,
   live/paper/dry-run semantics, enablement, source admission or publisher
   permission. `live_configured` and a console switch remain non-authoritative.
2. Financial calculations, amounts, currencies, source evidence, fingerprint
   qualification, date/time domains or retention policies. Matching is not
   loosened, and no returns, FX or zero values are invented to make a
   migration look complete.
3. Runtime target, deployment, service or source IDs, digest/receipt/dedup
   identities and signed authority tuples merely because they contain "alias".
   Canonical account migration needs its own approved compatibility scope.
4. Original historical financial records, approvals, receipts or
   pending-operation identities. No automatic deduplication, history rewrite,
   settlement, cancellation, reapproval or replay under a new key.
5. Existing POST authorization, step-up authentication, CSRF/origin protection,
   revision guards, idempotency, command transactions, alarms, security
   controls and required CI or branch protection. Their placement may change;
   their guarantees do not weaken.
6. Public privacy boundaries, synthetic examples, generated-file ownership,
   bilingual UI and both themes. Authenticated IBKR display does not permit
   public broker IDs or hashes that reveal private objects.
7. Namespace/class identity, storage bindings, deployment, IAM, secrets,
   notification delivery, cloud jobs or production configuration. There is no
   global safe-mode toggle and no all-platform big-bang migration.

This decision changes no request behaviour. Implementation, deployment and
protected migrations remain separately authorized work.
