# `qsl.development_research_review.v1`

English | [简体中文](qsl-development-research-review-v1.zh-CN.md)

This is a read-only review message for completed development research. It is a
distinct contract from `qsl.research_task.v1`: it does not represent native P3
observation and cannot be converted into a P3 task, experiment authorization,
strategy adoption, or production configuration.

`AIAuditBridge` generates the message from a fixed summary; `QuantRuntimeSettings`
independently validates and projects review state in
`python/scripts/development_research_review_consumer.py` without importing
`AIAuditBridge` runtime code.

## Inputs and validation

The message binds:

- Raw summary byte SHA-256:
  `<raw-summary-sha256>`
- Normalized result digest and 25 upstream input-index entries
- Candidate, runner, strategy-engine, policy, settlement, and cost identities
- Session count, capital scale, path metrics, and signed comparison outcomes

The input index covers the source manifest, R6/R7/R8 inputs, future manifest,
page and license records, policies, runner, and TQQQ contract, excluding output
ledgers. Both producer and `QuantRuntimeSettings` verify the index aggregate
digest, normalized result digest, and R8 strategy, runner, capital-policy, and
settlement identities against matching index entries; tampering cannot pass by
recomputing the message seal or duplicate key while keeping fixed source digests.

`producer_revision_sha256` is the SHA-256 of the `AIAuditBridge` producer module
source bytes—denoting source identity rather than a cryptographic signature or
attested build. `QuantRuntimeSettings` validates its format and includes it in
duplicate-key and state-identity derivation.

`QuantRuntimeSettings` independently checks schema version, fixed origin and
candidate, all input-index entries, digests, window, completion status, provenance
guarantees, PIT status, authority flags, and numerical results. Missing inputs,
digest conflicts, provenance or PIT upgrades, privilege escalation,
path/credential/account fields, or impersonation of legacy tasks or P3 schemas
are rejected. Negative return deltas are valid outcomes and are preserved
unaltered.

Authority fields are fixed to `review_disposition=advisory`, `mode=read_only`,
`no_order=true`, and `false` for `adoption`, `codegen`, `experiment`,
`notification`, and `trade`. The consumer invokes no AI, experiment,
notification, config-write, or trading interfaces. Repeated readbacks return
the same normalized state identity; the economic duplicate key combines research,
candidate/combo, producer/runner, upstream inputs, policy/settlement/cost, and
message version, comparing `result_digest` separately to reject conflicting
results under the same economic identity. `created_at` is excluded from
duplicate keys and state identity.

After installing `python/`, `qsl-development-research-review` can be run from
outside either repository without adding multiple trees to `PYTHONPATH`, or
invoked directly as a script:

```sh
python3 python/scripts/development_research_review_consumer.py \
  --input <message.json> \
  --state <receipt.json> \
  --expected-producer-revision <producer-sha256>
```

`--integration-manifest <manifest.json>` may replace the explicit revision flag,
reading `producer_revision_sha256` from top-level, `aab`, or `producer` objects
(requiring equality if more than one is present). This D1 path rejects messages
whose producer revision mismatches the bound value even if duplicate key and
message seal were recomputed.

`--state` persists a local receipt. Re-running with the same duplicate key and
`result_digest` returns the existing reviewable state without appending a
duplicate entry, even if `created_at` and the message seal changed. A different
`result_digest` for the same duplicate key fails without overwriting the receipt.
Writes stage to a temporary file in the same directory and swap atomically with
`os.replace`, keeping mode `0600` on receipts and per-receipt lock files, and
triggering no AI, experiments, notifications, or publications.

The executable JSON Schema is `schemas/qsl-development-research-review.v1.schema.json`.
SHA-256 provides integrity checking rather than identity attestation or
signatures. The underlying source reaches single-source structural evidence only;
corporate-action `process_date` is an ex-post proxy, keeping
`strict_point_in_time_certified` set to `false`. Local end-to-end consumer
validation does not imply automated AI analysis, Watcher wiring, console
publication, live trading, or strategy promotion.
