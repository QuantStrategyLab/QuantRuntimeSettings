# Account mapping authority

The account mapping authority classifies each existing account identity as
`eligible` or `display_only` for quant management and projects a generic
management status per displayed account. It is derived only from a complete
[account-identity inventory](account-identity-inventory.md) collection and
a protected mapping policy. It grants no trading, strategy, deployment or
execution authority, and nothing gates on it yet.

## Where it lives

| Part | File | Role |
| --- | --- | --- |
| Mapping policy | `web/strategy-switch-console/application/account_mapping/policy.js` | Policy document schema, class rules, status codes, evidence states and predicates. |
| Reader adapter | `web/strategy-switch-console/application/account_mapping/inventory_adapter.js` | Turns the private result of `assemble()` into the mapping authority input and classified accounts. |
| Read projection | `web/strategy-switch-console/application/runtime_instances/mapping_projection.js` | Joins the authority with the runtime-instance state; exposed as `RuntimeInstances.accountManagementProjection()`. |

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
one. Website and digest are to translate these same codes; neither may
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

## Read projection

`projectAccountManagement({ state, authority, effective, links })` returns,
per displayed account, only the deployment identities, accepted enrollment
links, `management_status`, `evidence_state`, `configuration_revision`
(instance state, mapping policy and applied management revisions),
`observed_at` and `source_ref`. Every current runtime instance is displayed;
one the authority does not cover reads `unknown`. Legacy keys and opaque
link IDs pass through byte-identical. Labels are neither read nor emitted.

Private enrollment links (the shape `python/scripts/project_digest_display_roster.py`
reads) are a compatibility edge onto resolved deployments. A link is
accepted only if it names exactly one current instance whose configuration
equals its recorded `config_identity`; one deployment with two opaque IDs,
one opaque ID across two accounts, or a duplicated binding is rejected.
Links never create, merge or reidentify an account.

No Worker route or Durable Object action dispatches the projection yet, so
the [read-contract registry](adr/0002-observation-and-identity-boundaries.md)
is unchanged. Adding one requires its registry entry in the same change.

## Boundaries

- The existing `DIGEST_EXPECTED_TARGETS_JSON` roster consumer is unchanged.
- Seeding the production policy, exporting protected mappings or links, and
  replacing the write-only roster setting are owner-flag F1 actions, outside
  this code.
- The management toggle, its applied-state storage and journal, and the
  processing gates are later work. Until applied management records exist,
  eligible accounts read `unknown`.
