# Configurable display names

QRS `platform-config.json` owns public strategy/platform labels. `display-names.config.json` owns display-only account aliases, lanes, legacy labels and aliases. `python/scripts/build_display_names.py` combines them into one fixed mapping; it never changes trading catalog metadata or runtime configuration hashes.

Run `python3 python/scripts/build_display_names.py --repos-root /path/to/source/checkouts` from QRS, then `--check` with the same arguments. Review and commit each repository separately. Consumer `display_names.py/json` files are generated snapshots, not independently maintained maps. They avoid upgrading pinned trading dependencies just for labels. No runtime fetch is performed. Refresh the snapshots together when labels change.

Python: optional `QSL_DISPLAY_NAMES_JSON` JSON object. Console: optional `VITE_QSL_DISPLAY_NAMES_JSON` at build time. Example (synthetic): `{"strategies":{"custom_profile":{"zh":"ETF-轮动-202610","en":"ETF-Rotation-202610"}},"accounts":{"binance":{"crypto_combo":"live"}}}`. Invalid JSON falls back to defaults; unknown labels retain the supplied fallback. Set private aliases only in the existing protected configuration, never in public source or PR bodies.

Precedence: explicit override, generated map, caller fallback, unchanged technical key. Locale falls back to English. New strategy/variant display names use `<instrument>-<what it does>-<YYYYMM>` when the actual origin month is established. Existing reviewed names stay until an explicit dated name is provided; do not invent a month or rename a technical ID to fit the pattern. Keep legacy aliases/descriptions. `crypto_combo` is displayed as `live` only under Binance; `paper` remains `paper`. Binance notifications can explicitly select another display alias with `QSL_NOTIFICATION_ACCOUNT_ALIAS` (for example `paper` in an isolated preview).

Resolved names are for display only. Never pass them to trading selection, account selection, target IDs, fingerprints, release/continuity bindings, Secret names, storage/object keys, claim keys or notification deduplication. Workflow/environment IDs and report profile IDs retain their operational meaning. CI and source merges do not establish production adoption. Trading runtime changes require their separate reviewed deployment; this naming work deploys no trading service.

## Private account identities in the v3 daily digest

The v3 digest may show a full account identity in the Telegram body. Supply
`QSL_DISPLAY_NAMES_JSON` to the central digest service at runtime through its
protected configuration or secret reference. Its `accounts.<platform>` map is
queried by `opaque_account_uid`, then `target_id`, then existing alias/hint/scope
keys. These keys are lookup keys only; opaque IDs and target IDs are never
rendered as account names. A map value must be the actual configured account
identity, not a descriptive alias, a masked placeholder or an execution lane.

The following mapping is entirely synthetic:

```json
{"accounts":{"ibkr":{"fake-opaque-a":"U0000001"},"schwab":{"fake-opaque-b":"00000002"},"firstrade":{"fake-opaque-c":"00000003"},"longbridge":{"fake-opaque-d":"LB000004"},"binance":{"fake-opaque-e":"fake-binance-user"}}}
```

| Platform | Runtime source and digest lookup |
| --- | --- |
| IBKR | The producer projects `runtime_target.account_selector` from its report or protected `CLOUD_RUN_SERVICE_TARGETS_JSON` into `account_hint`. The digest uses the private mapping first, then a normalized `U`/`DU` account hint. |
| Schwab | The producer supplies `SCHWAB_DIGEST_OPAQUE_ACCOUNT_UID`, falling back to its configured runtime account hash. Map this key to the actual account number in the central service; the hash cannot supply the number. An explicit numeric `account_hint` is also supported. |
| Firstrade | The producer's protected binding supplies `DIGEST_OPAQUE_ACCOUNT_UID`. Map it to the configured `FIRSTRADE_ACCOUNT` / runtime account selector in the central service. An explicit numeric `account_hint` is also supported. |
| LongBridge | The producer supplies `DIGEST_OPAQUE_ACCOUNT_UID`. Map it to the actual configured broker account identity in the central service. Regions, channels and token secret names are not account numbers. |
| Binance | The producer supplies `DIGEST_OPAQUE_ACCOUNT_UID` or `BINANCE_DIGEST_OPAQUE_ACCOUNT_UID`. Map it to the actual configured account UID/name in the central service. `default`, `crypto_combo` and `live` do not identify the account. |

An exact protected `DIGEST_EXPECTED_TARGETS_JSON` binding may also provide an
`account_hint`; aggregation applies it only when platform, opaque account UID,
target and strategy all match, the hint has a valid format, and the producer
has not already supplied a valid identity. IBKR mapping values must be full
`U`/`DU` account IDs; Schwab and Firstrade mapping values must be numeric account
IDs (with optional separators or an `Account` prefix). No account number is inferred from a scope,
opaque ID, target ID or execution mode. Without a usable private identity the
notification uses a generic account label, with ordinals for collisions.
Bundled/public account aliases and global lane aliases do not identify v3
accounts. Other notification formats retain their existing masked-label rules.

Never put real identities in this file, generated snapshots, frontend build
variables, tests, PR text or artifacts. Read private mappings only at runtime.
The authenticated Cloud Run preview returns status only; delivery records omit
the message body. CLI logs withhold the body, `--write-text` writes a withholding
notice, and the aggregator's `--write-json` exports the count-only public receipt.
The legacy sender's full receipt remains private; only the allowlisted public
projection may be published. Transport error logs omit response bodies that
could echo account identities. Tests use synthetic identities and mock transport.
