# Account mapping authority

The account mapping authority classifies each existing account identity as
`eligible` or `display_only` for quant management and projects a generic
management status per displayed account. Local processing admissions and
managed-cohort aggregates gate on the synchronous `RuntimeInstances` live
resolver (`processingEligible`), while `projectAccountManagement`
(`qsl_account_management_projection.v1`) remains the strict offline
[account-identity inventory](account-identity-inventory.md) projection. Neither
surface grants trading, strategy-execution, deployment, or runtime-activation
authority.

## Where it lives

| Part | File | Role |
| --- | --- | --- |
| Mapping policy | `web/strategy-switch-console/application/account_mapping/policy.js` | Policy document schema, class rules, status codes, evidence states and predicates. |
| Cohort predicate | `web/strategy-switch-console/application/account_mapping/management_cohort.js` | Pure Q5 cohort disposition and nine-counter builder over `qsl_account_management_readback.v1`. |
| Reader adapter | `web/strategy-switch-console/application/account_mapping/inventory_adapter.js` | Turns the private result of `assemble()` into the mapping authority input and classified accounts. |
| Read projection | `web/strategy-switch-console/application/runtime_instances/mapping_projection.js` | Joins the offline #1173 authority with runtime-instance state; exposed as `RuntimeInstances.accountManagementProjection()`. |
| Live resolver & store | `web/strategy-switch-console/application/runtime_instances/account_management.js` | Synchronous DO-internal resolver (`qsl_account_management_live_resolution.v1`), policy provisioning, sibling draft/apply, journal and idempotency store. |
| Live readback & export | `web/strategy-switch-console/application/runtime_instances/account_management_readback.js` | Physically read-only `qsl_account_management_readback.v1` builder, five-field applied adapter (`qsl_account_management_effective_export.v1`), `managementSettingsView`, and `GET /api/admin/account-management`. |
| HTTP control layer | `web/strategy-switch-console/application/runtime_instances/account_management_http.js` | Closed-shape handlers for `management_draft`, `POST /api/account-settings/management/apply`, and dormant `POST /api/internal/account-mapping-policy`. |
| Advisory preflight | `web/strategy-switch-console/application/runtime_instances/management_preflight.js` | Worker-side advisory readback preflight (`409 management_*`) before forwarding admission commands. |
| Status text table | `web/strategy-switch-console/application/runtime_instances/account_management_text.js` | Single pinned bilingual (`zh-CN` primary, `en` alongside) status and evidence text map. |

The policy values themselves (which deployments form an account, and each
account's class) are protected configuration. They are not in this
repository; tests use synthetic fixtures only.

## Mapping policy

A `qsl_account_mapping_policy.v1` document has a `policy_revision` and a
list of accounts. Each account has a `management_class` and the deployments
it consists of. A deployment is named by its existing platform and legacy
key and carries the settings identity (as `accountSettingsIdentity()`
derives it) it was classified at.

- Classification is policy data. It is not an account setting, and no
  management request can change it: an applied management record carrying a
  class, a label or a status is rejected.
- A physical account with several deployments lists them together, so they
  form one mapping entry. Physical identity is never inferred from a
  selector, channel or label.
- An unknown class, extra fields, a deployment whose identity does not match
  its key, or an account spanning platforms or broker environments rejects
  the whole document.
- A deployment listed under two accounts is a conflict for both; no account
  wins it.
- `display_only` can never have management enabled. Code branches on the
  class only, never on a platform, account or label.

## Evidence states and status codes

| Evidence | Meaning |
| --- | --- |
| `known` | Complete reader result, classified, identity unchanged, applied state present where the class needs it. |
| `unknown` | Missing or partial evidence: incomplete reader groups, truncated or unreadable identity, unclassified deployment, missing applied state. |
| `conflict` | Contradicting evidence: reader identity conflicts, cross-platform collisions, a deployment claimed twice, a changed physical identity, disagreeing or tampered applied records. |
| `stale` | The authority was derived at an earlier instance-state revision than the current one. |

Status codes are generic: `managed`, `management_disabled`,
`not_under_management` and `unknown`. Any evidence other than `known` reads
`unknown`; a disabled status is never invented for missing state. An
eligible account needs an applied management record for every deployment,
all agreeing; a display-only account reads `not_under_management` without
one.

`effectiveManagementState(account, records)` inspects the records of every
deployment before choosing the outcome:

1. `conflict` if any deployment has a duplicated or malformed record, any
   valid record enables management for a class that may not have it, or the
   available valid records disagree on `management_enabled` or `revision`.
   This holds even when another deployment has no record.
2. Otherwise `unknown` if any deployment has no record.
3. Otherwise `known`, with the agreed state and revision.

The outcome does not depend on deployment or record order. Only a `known`
outcome carries a management revision. A display-only account with no
contradicting record stays `not_under_management`, even when records are
missing; a contradiction makes it `conflict` and `unknown`. Website and digest are to translate these same codes; neither may
display a label supplied by a candidate producer in their place.

`processingEligible(row)` is true only for `known` evidence with status
`managed`. It is a predicate for later admission gates and grants nothing
else.

## Adapter contract

`mappingAuthorityInput(result, { observedAt, sourceRef })` consumes the
private result of `assemble()` unchanged. The input is authoritative only if
all of these hold: status `retained_state_enumerated_external_evidence_required`,
groups 1-22 `complete`, group 23 `external_evidence_required`, both objects
complete, a stable KV pass pair, a collected environment section, no identity
losses and no reasons, and the instance-state row agreeing with the current
reader entries. Otherwise every account stays listed with `unknown` evidence.
A collection with groups 16-22 left to the provider export is therefore not
authoritative.

Per deployment, the reader's current settings identity is carried as is.
Reader conflicts (`identity_episodes_differ`,
`stored_identity_differs_from_current` and the others) and cross-platform
collisions make the deployment a conflict. Drafts, retirement requests and
orphans are excluded with a reason. Unattributed rows are counted and never
mapped. `observedAt` and `sourceRef` are the collection time and an opaque
protected reference to the export, supplied by the operator.

`deriveMappingAuthority(result, policy, meta)` adds the classified accounts.
The adapter allocates no canonical identity, renames nothing and rewrites no
history; a later identity migration can replace it.

The assembled result carries `groups`, `group_reasons` and `identity_losses`
at its root, not under `mapping`. The adapter reads completeness from
`status`, `groups`, `objects`, `kv`, `env`, the top-level `reasons` and
`identity_losses`. It does not read `group_reasons`: those are diagnostic
causes for the incomplete groups, and changing them alone changes nothing.

## Read projection

`projectAccountManagement({ state, inventory, policy, collection, effective, links })`
derives the mapping authority itself. `inventory` is the private result of
`assemble()`, `policy` the mapping-policy document and `collection` the
`{ observedAt, sourceRef }` metadata; the projection calls
`deriveMappingAuthority()` on them. It never reads a caller-supplied
authority summary, account list, class or evidence. A call in the old
authority-only shape, or with a missing or malformed inventory result,
policy or collection metadata, displays the current instances as
unclassified `unknown` rows, with no policy revision and nothing managed.
`RuntimeInstances.accountManagementProjection({ inventory, policy, collection, effective, links })`
passes these inputs with its own `read()` state.

Both entries read their options only after normalizing them: an omitted,
`null` or other non-object argument counts as an empty options object and
never throws. The Durable Object still reads its own state and displays
each current instance once as an unclassified `unknown` row. The helper
called without a usable `state` returns an empty projection; with a usable
`state`, a missing or malformed inventory, policy or collection keeps the
current instances as unclassified `unknown` rows. A `null` or non-array
`effective` or `links` reads as an absent list. Normalization covers only
the call options; a storage failure inside `read()` is not caught.

A row's evidence is `known` only when all of these hold:

- the collection is authoritative and the policy validates;
- every deployment of the account is claimed by that one policy account
  and has exactly one resolved reader entry, with `known` evidence and none
  excluded;
- every deployment is exactly one current runtime instance (existing, no
  retirement requested) whose settings identity is still the resolved one,
  and the resolved identity is still the policy's;
- the authority was derived at the current instance revision; otherwise
  the row reads `stale`.

Duplicate or contradictory entries, claims or current instances make the
affected account a `conflict`; no claimant wins. An absent, draft or
retiring instance reads `unknown`. Applied records are read against the
policy class only; an unclassified row stays `unknown` whatever they say.

The projection returns, per displayed account, only the deployment
identities, accepted enrollment links, `management_status`,
`evidence_state`, `configuration_revision` (instance state, mapping policy
and applied management revisions), `observed_at` and `source_ref`. Every
current runtime instance is displayed; one the authority does not cover
reads `unknown`. Legacy keys and opaque link IDs pass through
byte-identical. Labels are neither read nor emitted.

Private enrollment links (the shape `python/scripts/project_digest_display_roster.py`
reads) are a compatibility edge onto resolved deployments. A link is
accepted only if it names exactly one existing instance whose configuration
equals its recorded `config_identity`. Every other link that passes those
checks is then compared with it, and these are rejected:

| Case | Reason |
| --- | --- |
| The same full binding twice | `link_duplicated`, for every copy |
| Two links with the same `platform_id` and `candidate_slot`, within one deployment, across the deployments of one account or across accounts | `link_candidate_slot_ambiguous`, for every link sharing the slot |
| One deployment with two opaque IDs, or one opaque ID across two accounts | `link_ambiguous` |
| A deployment that two or more displayed accounts claim, even for a single link | `link_ambiguous` |

The duplicate and slot rules are checked first, so their participants keep
those reasons. A link attaches only to the one row that owns its
deployment: a policy account, or the unclassified row of an existing
deployment no account claims. A deployment with several owner rows has no
owner, whatever the account order, and the link attaches to none of them.
A uniquely owned deployment keeps its link even when another deployment of
the same account is in conflict; that row's evidence is unchanged.

No participant in a collision is accepted. Different platforms may use the
same slot. This matches the digest `Configuration`, which rejects two
bindings for one platform and slot with `digest_duplicate_target_binding`.
Accepted links keep `platform_id`, `candidate_slot`, `opaque_account_uid`
and `target_id` byte-identical. Links never create, merge or reidentify an
account, and a rejected link leaves the account's evidence unchanged. The
Python consumers are unchanged.

### Trust boundary

The protected `qsl_account_mapping_policy.v1` singleton in `RuntimeInstances`
(`account_mapping_policy`) is the sole classification source for live reads and
admissions; the offline projection accepts the same document shape via its
composing caller. An applied management record, draft, enrollment link,
producer label, or client-supplied class/status/sibling list never classifies an
account.

Provisioning (`POST /api/internal/account-mapping-policy` ->
`account_mapping_policy_replace`) accepts only the dedicated
`ACCOUNT_MAPPING_POLICY_PROVISION_TOKEN` Bearer secret; missing binding fails
with `503 account_mapping_policy_provisioning_unavailable`, and neither user
sessions nor producer/dispatch tokens authenticate it. Read routes
(`GET /api/admin/account-management`) and control routes are registered in
`web/strategy-switch-console/application/read_contracts.js` under
[observation and identity boundaries](adr/0002-observation-and-identity-boundaries.md).

## Live resolution versus full inventory projection

The live resolver and the offline #1173 projection serve distinct boundaries and
must not be conflated or substituted for one another:

| Dimension | Live resolution & readback (`qsl_account_management_live_resolution.v1` / `qsl_account_management_readback.v1`) | Full #1173 projection (`qsl_account_management_projection.v1`) |
| --- | --- | --- |
| Evidence scope | `evidence_scope: "runtime_instances_sqlite"` (local DO SQLite only; never claims KV, `env`, or directory completeness). | Full inventory `assemble()` across SQL groups 1–22, two equal KV passes, and collected `env`. |
| Purpose | Commit-time DO admission gates inside `storage.transactionSync`, advisory HTTP preflight, `GET /api/account-settings` management section, and live cohort aggregates. | Strict offline audit projection joining complete retained inventory with opaque enrollment links. |
| Revision advances | Identity-preserving `instance_revision` increments (such as `sync_defaults` or paper application results) keep valid local accounts live without recollecting the full #1173 export; stale CAS requests still fail with `409`. | Any `instance_revision` mismatch between the authority input and current `instance_state` marks every row `stale` until a fresh #1173 inventory is collected. |
| Failure mode | Missing/malformed policy, unreadable SQL tables (`local_store_unreadable`, `local_history_unreadable`, `stored_identity_unreadable`, `management_journal_unreadable`), changed identity, retired/missing sibling, duplicate policy claim, or cross-platform collision fail closed (`unknown` or `conflict`). | Incomplete inventory, KV instability, truncated projections, or identity conflicts mark the projection non-authoritative (`unknown` or `conflict`) while preserving opaque link bytes (`link_*` rules). |
| Substitution | Never claims #1173-wide completeness or substitutes for `projectAccountManagement()`. | Never bypassed by live readback; remains unchanged for offline audit and Python roster projection compatibility. |

## Live readback and effective-record export

`GET /api/admin/account-management` (handler `accountManagementReadResponse`, DO
path `/internal/account-management-read`, DO action `account_management_read`)
provides an authenticated admin readback (`qsl_account_management_readback.v1`)
with `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.

- **Authentication and inputs**: requires a valid admin session and same-origin
  request (`401 login_required`, `403 admin_required` /
  `cross_origin_rejected`, `405 method_not_allowed`). Any query parameter fails
  with `400 management_read_invalid`; no caller authority input is accepted and
  no provisioning occurs. Missing DO binding or read failure yields `503`.
- **Physically read-only DO execution**: `RuntimeInstances.fetch` dispatches
  `/internal/account-management-read` **before** `initializeStorage` through
  `managementReadCapability`, a SQL facade admitting single `SELECT` statements
  only (any write or multi-statement SQL throws `statement_not_allowed`). When
  tables or `instance_state` are absent or unreadable, the DO returns HTTP 200
  with `status: "unavailable"`, `reasons: ["runtime_instances_not_initialized"]`
  or `["runtime_instances_state_unreadable"]`, `physical_grouping_complete: false`,
  null counts, and zero SQL, KV, or alarm writes.
- **Schema and nullability (`qsl_account_management_readback.v1`)**:
  - Top-level scalars: `ok` (`true`), `format`, `evidence_scope`
    (`"runtime_instances_sqlite"`), `status` (`"available" | "unavailable"`),
    `reasons` (`string[]`), `observed_at` (server UTC timestamp),
    `instance_revision` (`integer | null`), `policy_revision` (`integer | null`),
    `policy_status` (`"available" | "unavailable" | "invalid" | "unknown"`),
    `physical_grouping_complete` (`boolean`).
  - `counts`: `physical_accounts` (`integer | null`), `display_deployments`,
    `uncovered_deployments`, `managed`, `management_disabled`,
    `not_under_management`, `unknown` (`integer | null`). When `status` is
    `"unavailable"`, every count is `null`. When policy is missing or invalid, or
    when any deployment is uncovered or claimed twice, `physical_grouping_complete`
    is `false` and `physical_accounts` is `null` (deployment counts are never
    promoted to a physical count), while `display_deployments` and
    `uncovered_deployments` still report every discoverable existing instance.
  - `groups[]`: per policy physical account, sorted deterministically:
    `management_class`, `management_status`, `evidence_state`, `reasons`,
    `scope` (`"live" | "paper" | "unknown"`), `processing_eligible` (`boolean`),
    `processing_denial` (`string | null`), `applied` (`{ management_enabled,
    revision, effective_at } | null`), and `deployments[]` (`{ platform, key,
    present }`).
  - `uncovered_deployments[]`: existing instances not covered by a valid policy
    (`platform`, `key`, `management_status: "unknown"`, `evidence_state:
    "unknown"`, `reasons`, `processing_eligible: false`, `processing_denial`).
- **Privacy and bilingual text**: responses contain existing `(platform, key)`
  deployment identifiers only; actors, credentials, policy JSON internals, and
  pending management drafts never enter this envelope. UI surfaces translate
  codes strictly from `MANAGEMENT_STATUS_TEXT` and `MANAGEMENT_EVIDENCE_TEXT`
  (`account_management_text.js`); producer labels never replace them.
- **Applied-state adapter contract (`qsl_account_management_effective_export.v1`)**:
  `effective_export` (`{ format, instance_revision, policy_revision, records }`)
  is read from the same synchronous DO snapshot as the envelope's revisions.
  `exportAppliedRecords` maps each row of `account_management_applied` to
  strictly the five `EFFECTIVE_MANAGEMENT_FIELDS` (`platform`, `legacy_key`,
  `management_enabled`, `revision`, `effective_at`). Metadata columns
  (`identity_json`, `membership_json`) are never forwarded, pending drafts never
  enter the export, and a stored non-`0/1` `management_enabled` passes through
  raw so `normalizeEffectiveManagement` / `effectiveManagementState` rejects it
  as `conflict` rather than coercing it to a boolean.

## Account-settings management section and control routes

- **`GET /api/account-settings` `management` section**: built by
  `managementSettingsView(resolution)` from the same `RuntimeInstances` snapshot:
  `evidence_scope`, `policy_revision` (`integer | null`), `instance_revision`
  (`integer | null`), `management_class` (`string | null`), `management_status`,
  `evidence_state`, `reasons`, `processing_eligible` (`boolean`),
  `siblings` (`Array<{ platform, key }>`), `applied` (`{ management_enabled,
  revision, effective_at } | null`), and `draft` (`{ management_enabled,
  revision, base_applied_revision, status, consumed_applied_revision } | null`).
  Draft and applied revisions are independent per-physical-account axes; when
  policy or applied state is missing, `applied` stays `null` and
  `management_status` stays `unknown`.
- **Management draft save (`POST /api/account-settings`, DO action
  `account_management_draft_save`)**: closed request body (`platform`, `key`,
  `identity`, UUID `request_key`, `expected_instance_revision`, positive
  `expected_policy_revision`, `expected_management_draft_revision`,
  `expected_management_revision`, and `management_draft: { management_enabled }`).
  Mixing `overrides`, `risk_change`, `declaration`, or extra fields returns
  `400 management_request_invalid`. A valid save atomically writes all sibling
  rows in `account_management_draft` with the next shared draft revision and
  never modifies `account_management_applied` or `account_management_change`.
- **Management apply (`POST /api/account-settings/management/apply`, DO action
  `account_management_apply`)**: closed request body (same common fields, no
  editable boolean or `acknowledge_identity_conflict` bypass). Inside one
  `storage.transactionSync`, the DO re-checks replay receipts
  (`account_management_requests`), policy/instance/draft/applied CAS revisions,
  exact eight-field sibling identities, and complete eligible membership before
  fanning out `account_management_applied`, marking the draft `consumed`,
  appending one logical `account_management_change` journal row, and recording
  the idempotent receipt. A validated apply matching the current applied boolean
  records a `no_op` receipt without incrementing applied revision or appending a
  journal row. One physical apply surfaces once globally in
  `GET /api/audit-events` (`source: "account_management_change"`) and in
  `GET /api/account-settings/history` for every sibling deployment; KV failures
  do not hide durable DO management history.
- **Policy provisioning (`POST /api/internal/account-mapping-policy`, DO action
  `account_mapping_policy_replace`)**: dormant authenticated endpoint accepting
  `{ expected_policy_revision, policy }` with monotonic revision and
  canonical-content comparison (`409 management_policy_revision_conflict` /
  `management_policy_content_conflict`, same revision + identical canonical
  content idempotent). Responses return `{ ok, replaced, policy_revision,
  no_order: true, execution_authority_granted: false }` with `Cache-Control:
  private, no-store`; tokens and policy payloads are never logged or echoed.

## Managed cohort aggregates and performance unavailability

- **Account facts (`GET /api/account-facts`)**: `aggregateAccountFactsTotals`
  and `accountFactsAssetCoverage` classify the complete displayed cohort via
  `managementCohort` before summing non-paper balances. Each row carries
  `management_status`, `evidence_state`, `management_revision`,
  `management_disposition` (`"managed" | "disabled" | "not_under_management" | "paper" | "unknown"`),
  and optional `management_scope_conflict` (copied into `asset_coverage.accounts`
  when the cohort is attached; legacy unstamped payloads omit them);
  `asset_coverage` adds `management_scope: "managed_non_paper"`,
  `management_coverage_status` (`"complete" | "incomplete"`),
  `management_observed_at`, `management_instance_revision`,
  `management_policy_revision`, and `management_counts` (`display_physical`,
  `display_deployments`, `managed_non_paper`, `management_disabled_non_paper`,
  `not_under_management_non_paper`, `unknown_non_paper`, `paper_excluded`,
  `duplicate_deployments`, `unresolved_deployments`). Any non-paper row with
  unknown/conflict/stale status forces `totals_status: "unavailable"` and
  `totals_reason: "management_status_unknown"` (row disposition `unavailable`,
  otherwise-eligible managed rows `blocked` / `aggregate_management_status_unknown`).
  When all non-paper rows are known and none are managed, totals report
  `unavailable` / `no_managed_non_paper_accounts`. Known paper, disabled, and
  display-only rows are clean exclusions; raw account cards stay visible.
- **Performance (`GET /api/performance/{summary,equity,returns,trades}`)**:
  for `scope=all`, unknown non-paper cohort membership returns HTTP 200 with
  `status: "unavailable"`, `unavailable_reason: "management_status_unknown"`,
  the `management_scope` / `management_coverage_status` / `management_counts`
  / metadata fields, and no aggregate curve, equity, valuation, or trade total.
  Account-specific scopes remain directly readable.

## Boundaries

- The existing `DIGEST_EXPECTED_TARGETS_JSON` roster consumer and all Python
  scripts under `python/` are separate downstream work (B3).
- Seeding production policy data, exporting protected mappings or links, and
  replacing the write-only roster setting are owner-gated F1 actions outside
  this repository state.
- `SWITCH_ACTIVATION_CONNECTED` stays `false`; management actions never dispatch
  workflows, change lifecycle flags, modify strategies/risk, or authorize live
  trading.
