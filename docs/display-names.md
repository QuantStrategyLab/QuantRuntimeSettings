# Configurable display names

QRS `platform-config.json` owns public strategy/platform labels. `display-names.config.json` owns display-only account aliases, lanes, legacy labels and aliases. `python/scripts/build_display_names.py` combines them into one fixed mapping; it never changes trading catalog metadata or runtime configuration hashes.

Run `python3 python/scripts/build_display_names.py --repos-root /path/to/source/checkouts` from QRS, then `--check` with the same arguments. Review and commit each repository separately. Consumer `display_names.py/json` files are generated snapshots, not independently maintained maps. They avoid upgrading pinned trading dependencies just for labels. No runtime fetch is performed. Refresh the snapshots together when labels change.

Python: optional `QSL_DISPLAY_NAMES_JSON` JSON object. Console: optional `VITE_QSL_DISPLAY_NAMES_JSON` at build time. Example (synthetic): `{"strategies":{"custom_profile":{"zh":"ETF-轮动-202610","en":"ETF-Rotation-202610"}},"accounts":{"binance":{"crypto_combo":"live"}}}`. Invalid JSON falls back to defaults; unknown labels retain the supplied fallback. Set private aliases only in the existing protected configuration, never in public source or PR bodies.

Precedence: explicit override, generated map, caller fallback, unchanged technical key. Locale falls back to English. New strategy/variant display names use `<instrument>-<what it does>-<YYYYMM>` when the actual origin month is established. Existing reviewed names stay until an explicit dated name is provided; do not invent a month or rename a technical ID to fit the pattern. Keep legacy aliases/descriptions. `crypto_combo` is displayed as `live` only under Binance; `paper` remains `paper`. Binance notifications can explicitly select another display alias with `QSL_NOTIFICATION_ACCOUNT_ALIAS` (for example `paper` in an isolated preview).

Resolved names are for display only. Never pass them to trading selection, account selection, target IDs, fingerprints, release/continuity bindings, Secret names, storage/object keys, claim keys or notification deduplication. Workflow/environment IDs and report profile IDs retain their operational meaning. CI and source merges do not establish production adoption. Trading runtime changes require their separate reviewed deployment; this naming work deploys no trading service.

## Account config labels in the v3 daily digest

Account titles come from the existing selected account config, in order:
`label`, `key`, `target_name`. Carry these fields with the approved
`DIGEST_EXPECTED_TARGETS_JSON` binding (or `aggregator.expected_targets`),
or call `cloud_run_daily_digest.project_expected_target_label(binding, account_option)`
where the selected config and binding are available. `Configuration` calls this
projection during environment intake; it is not a separate alias registry.
No `QSL_DISPLAY_NAMES_JSON` account map is required.

For example, this binding uses entirely synthetic identity values:

```json
{"platform_id":"ibkr","opaque_account_uid":"synthetic-account","target_id":"synthetic-target","strategy_profile":"synthetic-strategy","candidate_slot":"synthetic-slot","label":"live","key":"paper","target_name":"sg"}
```

The projection adds the optional internal `account_label` (`live` here).
Existing callers may also supply a projected `account_label` directly; a valid
projected label takes precedence over retained source fields. It must
be a printable string of at most 70 characters. Empty labels use fallback;
invalid projected labels fail startup with a fixed reason and no input echo.
Unsafe source fields are skipped in priority order. Names such as `live`,
`paper`, `sg`, `hk` and already masked names remain valid. Raw broker IDs,
long numeric strings, URLs and control characters cannot become config labels.

Aggregation copies the label only from the trusted binding whose platform,
opaque account UID, target and strategy all match. Candidate-supplied labels
are discarded. Labels never affect grouping, execution selection, storage keys
or deduplication; distinct accounts with identical labels retain display ordinals.
Bindings without any account config fields remain compatible. This code does
not fetch console configuration or infer relationships between target IDs and
config names: the existing configuration owner must carry the selected fields
on each binding. No deployment or protected configuration update is included.

A safe config label takes precedence over the existing optional private runtime
mapping. That mapping remains supported for compatibility. Without either,
a valid IBKR, Schwab or Firstrade `account_hint` displays `***` plus its last
two characters; otherwise a generic account title is used. An exact binding
may supply the hint when the producer has none. Opaque IDs, scopes and target
IDs are never guessed into titles. Other notification formats retain their
existing display rules.

The authenticated console follows the same `label`, `key`, `target_name`
priority within the matching platform's account option. Config names are kept
as configured in either language; a generated alias or an IBKR selector cannot
override them. If no safe config name exists, it uses a safe alias, then a
masked broker identity or the localized generic account title. Selector-based
grouping and routing remain unchanged.

An account block requires at least one known positive order or fill count across
its runs. Account blocks with only zero or unknown counts are omitted; safe risk
and evidence diagnostics remain visible without account headers or observations.
Unknown counts remain unknown in window totals; they do not establish the
verified all-idle state needed for the single-line no-trades message.

Never put real identities in this file, generated snapshots, frontend build
variables, tests, PR text or artifacts. Read private mappings only at runtime. Config labels are private display metadata
and are excluded from serialized run receipts as well as public projections.
The authenticated Cloud Run preview returns status only; delivery records omit
the message body. CLI logs withhold the body, `--write-text` writes a withholding
notice, and the aggregator's `--write-json` exports the count-only public receipt.
The legacy sender's full receipt remains private; only the allowlisted public
projection may be published. Transport error logs omit response bodies that
could echo account identities. Tests use synthetic identities and mock transport.
