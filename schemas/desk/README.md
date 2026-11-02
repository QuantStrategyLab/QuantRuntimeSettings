# Desk response contracts

These draft 2020-12 schemas implement **BE-0** of the coordinator's
`API-CONTRACT.md`, draft v1 dated 2026-11-02. That document is the source of
truth. No routes, broker reads, dispatchers or execution permissions are added.

[`manifest.json`](manifest.json) maps each response to its contract section,
method/path and fixture scenarios. The optional recent-switch list has no
specified response and is deferred. Unchanged dependency endpoints listed at
the end of contract §2 are outside this inventory.

`common.json` publishes reusable `$defs`, including `Read`, enums, formats,
freshness and flat NAV variants. Typed Reads intersect `Read` with a `value`
schema. Every object closes additional properties; `Read.value` alone is
generic. Register schemas by `$id` before compilation. The example.invalid
IDs are identifiers, not remote fetch locations; no network lookup is needed.

Fixtures live in `tests/fixtures/desk/<name>.<scenario>.json`. All identities,
times and values are synthetic. `ok` describes a successful response that can
contain honest unknowns. `degraded` illustrates unavailable/stale reads,
partial jobs or reduced information. Acknowledgements and legacy envelopes
without a degraded-success shape may share their success shape; HTTP failures
use `error.json`. `empty` means a verified empty collection, never a substituted
read failure. Successful switch/reconcile request fixtures describe future
response shapes only; those operations remain disabled.

Run from the repository root:

```bash
npm ci --prefix web/strategy-switch-console
npm run test:contracts --prefix web/strategy-switch-console
```

Existing `test:operations` also runs the harness through
`tests/console_v2_operations_validation.mjs`. Frontend files are unchanged.
Ajv and ajv-formats are development dependencies only, providing complete
2020-12 reference/composition support and calendar-aware format validation.

## Coordinator defaults

| Question | Default used by fixtures and contract policy |
|---|---|
| Q1 | Re-apply saved and Adopt platform ship disabled (`not_enabled`). |
| Q2 | An unavailable broker open-orders read is `unknown`, required, and counted as blocking. |
| Q3 | Retain stored index benchmarks and legacy Chinese series IDs; no QQQ ETF source. |
| Q4 | Expiry stays `unknown/never_read` without a source. IBKR and Schwab are first priorities; these fixtures have only synthetic IBKR metadata. |
| Q5 | All preview estimates stay `unknown/not_supported`. |
| Q6 | Alerts and logs retain 90 days. Only logs expose a retention field; no alerts field is invented. Ingestion remains BE-12/BE-13 work. |
| Q7 | No unapproved holdings quotes. Last/Day stay `unknown/not_supported`; CASH keeps the contract's explicit nulls. |

Switch activation stays disconnected (409) until BE-7/BE-8 are reviewed.
Fixture targets and confirmations remain disabled. zh-CN is required as the
primary UI language at cutover, en secondary. This PR adds no UI copy or
localization system; examples keep the contract's display vocabulary.

## Compatibility notes for contract review

- Prose takes precedence over abbreviated examples: every desk success gets
  `ok`, `generated_at` and `schema_version`; known/stale Reads require
  `observed_at`. Actions include `no_order:true`. New write acknowledgements
  allow the documented idempotent `reused` field.
- Previews require `preflight[].required` and `confirm.allowed`. The example's
  unavailable open-orders read contributes one blocker rather than zero.
- `ReadReason` stays exactly the five values in §1.4. `MetricRead` adds
  `insufficient_history` only for performance metrics required by §3.15.
- NAV and holdings keep the flat example shapes with known/stale/unknown
  variants: stale carries age, unknown a reason without fabricated amounts or
  rows. Unavailable plain aggregate decimals, dates and last-run records are
  nullable. Benchmarks use §3.15's `{id:null,label:null,indexed:[]}` fallback.
- Proposed absence encodings where examples lack degraded shapes: null
  calendar times/next-run and null delivery/digest records with an unknown
  channel status. Review these choices before BE-3/BE-4/BE-12 connects them.
- `equity_by_target` is a target-ID-keyed map of equity objects for
  `scope=strategy`, requested but not illustrated in §3.15. Review its shape
  before BE-11 connects it. The map is required for strategy scope; map keys
  reject undeclared non-target keys. A `strategy` fixture covers this variant.
- New desk credential records and broker summaries enforce
  `requires_action === phase in [30,7,1,expired]`, including false for unknown.
- §3.14 illustrates `financing:[]` without an item contract. Only the empty
  array is accepted until BE-5 defines financing rows; this does not establish
  that financing is absent in a real account.
- Legacy session, market-benchmark, runtime-control and credential-maintenance
  envelopes keep their distinct shapes. The desk envelope is not imposed on
  them. These schemas describe requested/example payloads, not every existing
  Worker projection.
- Current credential-maintenance code has a `14` day phase, additional
  presentation fields and `requires_action:true` for unknown expiry. The new
  desk list specifies `1` instead of `14`, and false for unknown. BE-6 must
  resolve adapter/legacy compatibility without silently changing the existing
  API. BE-0 changes neither interface.

No live Worker, source availability, account binding or stored retention is
verified here. Auth, headers, idempotency, redaction and execution gating need
route tests in the later tasks.
