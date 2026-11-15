# Account-identity inventory reader

The account-identity inventory reader enumerates the retained account-identity
state of the strategy-switch console's two named Durable Objects without writing
anything. It produces private identity and provenance projections, counts and
completeness receipts. An offline assembler turns a collected export into a
private mapping and a sanitized summary.

The reader is an observation tool. Its output grants no trading, settings,
approval, control or deployment authority. Reading a pending operation never
settles, retries or renews it.

## Scope

| Store | Covered by | Notes |
| --- | --- | --- |
| SQL tables in `runtime-instances` and `console-kv-directory-v1` | `schema`, `sql`, `finalize` sections | A fixed server-side table allowlist. Unknown tables are named and counted, not paged. |
| Durable Object KV in both objects | `do_kv` section | Every retained key, with an identity projection per known family; unknown keys are named and flagged without their values. |
| Worker KV namespace | Optional `kv` section, or the provider API | Direct `list`/`get` only. Values are fetched only for reviewed identity-bearing families. |
| Deployed configuration bindings | Optional `env` section | Exactly `STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON`, `BINANCE_ACCOUNT_FACTS_BINDING_JSON` and `BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON`. |
| External files, GCS archives, publisher configuration | Not covered | Needs owner-supplied evidence. The assembler reports this group as `external_evidence_required`. |

## Route contract

`GET /api/admin/account-identity-inventory` is dispatched by the Worker before
every ordinary console handler.

- Authentication uses the existing signed console session (`readSession`), which
  only verifies the cookie and reads the auth configuration. An expired or
  altered cookie returns `401`; a signed-in non-admin returns `403`. There is no
  login redirect and no cookie refresh.
- Only `GET` is accepted. A cross-origin `Origin` or a `Sec-Fetch-Site` other
  than `same-origin`/`none` is rejected. There are no CORS headers.
- Every response carries `Cache-Control: private, no-store`.
- No frontend page mounts this route. Fetch it directly; do not load
  `/api/config`, the inbox, settings, fresh readback, controls or credential
  pages to collect an inventory.

| `section` | Parameters | Result |
| --- | --- | --- |
| `manifest` | none | Allowlisted objects, tables, page bounds and which optional sections are enabled. |
| `schema` | `object` | Schema manifest: `schema_state` (`schema_absent`, `partial`, `current`), per-table presence, exact missing and unexpected columns, primary key, row and null-key counts, other schema objects, alarm. Returns a sealed `scan` token. |
| `sql` | `object`, `table`, `page_size`, then `scan` or `cursor` | One page of identity projections ordered by the full primary key. |
| `do_kv` | `object`, `page_size`, then `scan` or `cursor` | One page of DO-KV entries in key order. |
| `finalize` | `object`, `scan` | Re-reads schema and counts and reports whether the object is still identical to the scan baseline. |
| `kv` | `page_size`, `cursor` | One Worker KV listing page. Disabled unless `ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED` is `true`. |
| `env` | none | The three fixed bindings. Disabled unless `ACCOUNT_IDENTITY_INVENTORY_ENV_ENABLED` is `true`. |

`object` is `runtime` (the `runtime-instances` object) or `directory` (the
`console-kv-directory-v1` object). `page_size` is 1–500 for SQL and DO-KV
(default 100) and 1–100 for KV (default 50). Unknown parameters, repeated
parameters, unknown sections, objects or tables, caller-supplied SQL and
caller-selected environment names are rejected with fixed error codes. Errors
never echo stored values, statements, cookies or provider text.

## No-write enforcement

- **Constructor.** `RuntimeInstances` records storage and environment
  references and builds side-effect-free adapters only. The previous constructor
  SQL (table, index and trigger creation and column migrations) runs in
  `initializeStorage()`, once per instance, at the start of the ordinary `fetch`
  path and before `alarm`. The statement sequence is unchanged; ordinary
  methods reach SQL through the `sql` accessor, which initializes first.
- **Dispatch order.** The internal path `/internal/account-identity-inventory`
  is handled before `initializeStorage()` and before any ordinary command,
  including the Binance detail command. A fresh object therefore reports
  `schema_absent`; an old schema reports exact missing tables and columns. The
  reader never creates or upgrades anything.
- **Capability.** The reader receives only an allowlisted query function,
  `storage.list` and `storage.getAlarm`. The query function runs only
  statements generated from the table allowlist at module load, with bound
  parameters, plus `SELECT COUNT(*)` over an unknown table whose name matches a
  strict identifier pattern. It rejects every other statement. There is no `put`, `delete`,
  transaction, alarm change, `waitUntil` or external fetch on the path.
- **No persisted scan state.** Cursors and scan tokens are AES-GCM sealed by the
  Worker with a key derived from the session secret. They are tamper-evident,
  opaque (record keys do not appear in URLs or logs), expire after six hours and
  need no server-side reservation. The reader stores no checkpoint, manifest,
  audit row, temporary table, cache entry or alarm.

## Enumeration and stability

- SQL pages use the table's whole primary-key tuple with `COLLATE BINARY`
  row-value comparison and a one-row lookahead, never `OFFSET`. No predicate
  restricts rows to configured keys, valid JSON, current sources, dates or
  states. Rows whose primary key contains `NULL` cannot be paged; they are
  counted as `null_key_rows`, and the assembler withholds completeness for that
  table.
- The `instance_state` singleton array is paged by nested entries, tied to the
  SHA-256 of the unchanged stored value.
- DO-KV pages use `storage.list({ limit, startAfter })` with no prefix, strict
  UTF-8 byte-order progression and lookahead; a page is terminal only when the
  lookahead proves there is nothing after it.
- Each page records the alarm and the schema before and after the read and
  compares a stability token with the scan baseline. Any insert, update,
  delete, same-count replacement, DO-KV change, alarm change or schema change
  between pages returns `409 changed_during_scan` or `409 schema_changed`.
  `finalize` then reports `stable: false`, and the scan must restart.
- A row larger than 256 KB after projection is returned as
  `row_projection_too_large`; a page stops at 1.5 MB with `byte_limited: true`
  and a cursor. Neither is a cap reported as completion.

### Stability token, not storage bookmarks

The design called for recording the object's storage bookmark around each page.
In workerd, `storage.getCurrentBookmark()` advances the object's change counter
on every call, so reading a bookmark is itself a storage change. The reader
therefore does not call it, and reports `bookmark: { read: false }`.

The stability token is SHA-256 over:

- the per-instance nonce;
- SQLite `total_changes()` on the object's connection, which advances for every
  committed SQL and DO-KV row change and stays fixed under reads;
- the alarm;
- the schema digest.

A Durable Object has a single storage connection, so this covers every writer
in the object. If the object is evicted and restarted between pages, the nonce
changes and the scan restarts, which errs on the side of an incomplete result.
Validate this counter behavior on the deployed runtime version before relying on
a production scan. If an object changes continuously, a strict scan may never
complete. The reader reports that and does not impose a write fence.

## Output projections

The reader extracts identity, reference and status fields: legacy and storage
keys, platform, instance kind and status, selectors, broker account
identifiers, target and service names, source bindings, revisions, request,
ticket, application and operation identifiers, phases and timestamps. It
reports JSON validity, byte sizes and embedded array sizes separately from row
counts.

It does not copy amounts, balances, positions, free-text summaries, actor
logins, claim tokens, credential factors, rotation responses or secret-like
fields. Secret-like JSON keys are listed by path without their values. The
credential-factor table is count-only because its primary key is the factor.
Rows and DO-KV entries keyed by a console login (UX1 slots, rotation throttle,
Desk admissions) are located by a SHA-256 digest of the key.

The output is private. It contains real account keys and broker identifiers and
must stay in approved protected storage, never in Git, CI artifacts or public
review.

## Collection runbook

Run only against a deployed version that contains this reader, with an admin
console session, and write the output to protected storage.

1. Request `section=manifest`.
2. For each object (`runtime`, `directory`):
   1. Request `section=schema&object=<object>` and keep the returned `scan`.
   2. For every present table that is not count-only, request `section=sql`
      with `table`, `page_size` and `scan`, then follow `cursor` until it is
      `null`.
   3. Request `section=do_kv` with `scan`, then follow `cursor`.
   4. Request `section=finalize&object=<object>&scan=<scan>`. On a `409` or
      `stable: false`, discard that object's pages and restart it.
3. If enabled, collect two complete `section=kv` passes and one `section=env`
   response.
4. Save every request and response as one export file:

```json
{
  "format": "qsl_account_identity_inventory_export.v1",
  "responses": [
    { "request": { "section": "schema", "object": "runtime" }, "status": 200, "body": { "...": "..." } }
  ]
}
```

5. Assemble offline:

```bash
node web/strategy-switch-console/inspect_account_identity_inventory.mjs <private-export.json> \
  --private-out <protected-dir>/mapping.json --summary-out <protected-dir>/summary.json
```

The assembler makes no network request. It checks page chains and terminal
receipts, duplicate keys, page totals against schema and finalize counts, and
the two KV passes against each other. It derives a mapping keyed by every
`(platform, legacy_key)` with dated identity episodes, conflicts, cross-platform
collisions and an unattributed ledger for platform-less rows. Pending,
nonterminal and unknown operations are listed; only explicit terminal statuses
count as terminal. The summary contains aggregate counts only. The exit status
is `1` when the result is `incomplete`.

## Validation

`tests/account_identity_inventory_validation.mjs` runs as part of
`npm run test:operations --prefix web/strategy-switch-console`. It runs the real
Worker route over trap storage, which fails on any write SQL, PRAGMA, storage
mutation, bookmark read, KV write, `waitUntil`, external fetch or ordinary
`RuntimeInstances` method. It also runs the same code in workerd through
Miniflare. The workerd run checks byte-identical schema, rows, DO-KV, alarm and
`total_changes()` before and after a scan, drift detection between pages, and
that the ordinary-path schema matches the reader allowlist.
