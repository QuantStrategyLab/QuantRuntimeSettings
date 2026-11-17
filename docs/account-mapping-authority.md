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

### Trust boundary

The policy input is the only classification source. An applied management
record, an enrollment link, a producer label or a derived summary never
classifies an account. The policy document is trusted only as far as the
composing caller that supplies it: a JSON document or a policy revision does
not authenticate where it came from. No route or protected policy storage
supplies it yet; later integration work must read it from the protected
source and register that read.

Private enrollment links (the shape `python/scripts/project_digest_display_roster.py`
reads) are a compatibility edge onto resolved deployments. A link is
accepted only if it names exactly one current instance whose configuration
equals its recorded `config_identity`. Every other link that passes those
checks is then compared with it, and these are rejected:

| Case | Reason |
| --- | --- |
| The same full binding twice | `link_duplicated`, for every copy |
| Two links with the same `platform_id` and `candidate_slot`, within one deployment, across the deployments of one account or across accounts | `link_candidate_slot_ambiguous`, for every link sharing the slot |
| One deployment with two opaque IDs, or one opaque ID across two accounts | `link_ambiguous` |

No participant in a collision is accepted. Different platforms may use the
same slot. This matches the digest `Configuration`, which rejects two
bindings for one platform and slot with `digest_duplicate_target_binding`.
Accepted links keep `platform_id`, `candidate_slot`, `opaque_account_uid`
and `target_id` byte-identical. Links never create, merge or reidentify an
account, and a rejected link leaves the account's evidence unchanged. The
Python consumers are unchanged.

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
- This code adds no route, dispatcher, policy storage, production policy
  seed or roster transition. Later integration must supply the policy from
  the protected source, register the routed read and establish its
  lifecycle guarantees.
