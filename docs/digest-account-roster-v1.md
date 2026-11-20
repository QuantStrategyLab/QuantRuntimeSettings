# Mapping-driven digest account roster (`qsl_digest_account_roster.v1`)

The mapping-driven digest roster connects [account mapping authority](account-mapping-authority.md) (`qsl_account_management_readback.v1` and `qsl_account_management_projection.v1`) to the Cloud Run account-oriented daily digest without creating a second management API or changing broker or trading authority. Live class, status, evidence, scope, and applied values come only from B2's registered `GET /api/admin/account-management` read; saved enrollment artifacts supply validated physical membership, safe display labels, accepted legacy run bindings, and typed account-observation bindings only.

## Versioned envelopes and closed schemas

| Format | Schema | Role |
| --- | --- | --- |
| `qsl_digest_account_roster.v1` | [`qsl-digest-account-roster.v1.schema.json`](../schemas/qsl-digest-account-roster.v1.schema.json) | Generation-scoped digest roster envelope built from a validated `GenerationOutcome` (`current`, `fallback`, or `unavailable`). |
| `qsl_digest_enrollment_selection.v1` | [`qsl-digest-enrollment-selection.v1.schema.json`](../schemas/qsl-digest-enrollment-selection.v1.schema.json) | Authenticated selection pointer binding source, membership/label/link versions, and artifact SHA-256 digest. |
| `qsl_digest_enrollment_artifact.v1` | [`qsl-digest-enrollment-artifact.v1.schema.json`](../schemas/qsl-digest-enrollment-artifact.v1.schema.json) | Offline-prepared structural enrollment document validated against one coherent DO observation, B2 `exportAppliedRecords`, and B1 `projectAccountManagement`. |

### Format rejection, null cases, and cardinalities

All three envelopes are closed (`additionalProperties: false` at the root and on every nested object):

- **Format and strict-input rejection**: readers (`validate_roster_envelope`, `read_selection`, `validate_artifact`) reject duplicate JSON keys, `NaN`/`Infinity`, non-UTF-8 bytes, unsupported `format` values (`roster_format_unsupported`), unrecognized status/evidence/failure codes, missing required fields, ill-typed values (including booleans where integers are required), inconsistent declared counts (`roster_counts_inconsistent`), and `management_status` / `processing_eligible` combinations that contradict B2's reducer. Incompatible field additions, removals, or meaning changes require a new format version and explicit reader support.
- **Null cases by `generation_status`**:
  - `current`: `observed_at`, `decided_at`, `observation_age_seconds`, `instance_revision`, `policy_revision`, `selection`, `prepared_at`, `enrollment_observed_at`, and all `counts` fields are non-null (`physical_grouping_complete: true`); `failure_code` and `failure_kind` are `null`. `groups[*].applied` is `null` for `display_only` groups and for `eligible` groups missing an applied record.
  - `fallback`: `observed_at`, `counts.display_groups`, and `groups` (one header per retained physical group) come from the last-validated display snapshot; `decided_at`, `instance_revision`, `policy_revision`, `selection`, `prepared_at`, `enrollment_observed_at`, `counts.physical_accounts`, all four status counts, `groups[*].management_class`, and `groups[*].applied` are `null`. Every group renders `management_status: "unknown"`, `evidence_state: "unknown"`, `processing_eligible: false`, and empty binding arrays (`[]`); `failure_code` and `failure_kind` (`stale`, `conflict`, or `unavailable`) are non-null.
  - `unavailable`: `observed_at`, `decided_at`, `observation_age_seconds`, `instance_revision`, `policy_revision`, `selection`, `prepared_at`, `enrollment_observed_at`, `counts.physical_accounts`, and all four status counts are `null`; `groups`, `uncovered_deployments`, and `rejected` are empty; `counts.display_groups` and `counts.uncovered_deployments` are `0`.
- **Cardinalities**: each group in `groups` requires at least one deployment (`minItems: 1`). `legacy_run_bindings` and `observation_bindings` are separate typed arrays of zero or more entries (`[]` is valid and reaches aggregation as typed empty). Declared `counts.display_groups`, `counts.uncovered_deployments`, and (when `current`) `counts.physical_accounts` plus the four status counts must equal the enumerated items.

## Constructor modes and context precedence

`cloud_run_daily_digest.Configuration` supports two explicit modes selected via `RosterBootConfig`:

- **Legacy array mode (default when no mapping boot configuration is supplied)**: requires a non-empty `expected` array (`DIGEST_EXPECTED_TARGETS_JSON` in `Configuration.from_environment()`) validated by `notification_candidate_adapter.validate_expected`. Passing a `qsl_digest_account_roster.v1` object without mapping mode fails with `digest_roster_mode_required` before reaching the legacy array parser.
- **Mapping mode (`mode: "mapping_v1"` via `RosterBootConfig.from_protected` / `DIGEST_ROSTER_BOOT_JSON`)**: validates the console HTTPS origin, service-authentication policy, enrollment source, configuration context, and bounded timeout without requiring or reading `DIGEST_EXPECTED_TARGETS_JSON`. Private IBKR Telegram recipient bindings are revalidated per generation against the `current` `GenerationRoster` (`generation_recipient_accounts`) and withheld on `fallback`, `unavailable`, previews, and non-authorized trigger provenances.

In shared aggregation (`daily_digest_aggregator.collect_digest_runs` and `build_digest_payload`), an explicit `roster_context` takes precedence over `DIGEST_EXPECTED_TARGETS_JSON` and `platform-config.json` `expected_targets`: a `current` roster uses its exact `legacy_run_bindings` (with typed empty `[]` remaining empty), and a `fallback` or `unavailable` outcome degrades without legacy fallback. Legacy-only calls with no `roster_context` retain their existing environment/config precedence.

## Standalone consolidated presentation deferral

Standalone consolidated presentation (`unified_daily_digest.render` and `daily_digest_aggregator.build_digest_payload(..., render_text=True)`) is deferred to B9 for mapping-mode rosters:

- Requesting mapping mode (`roster_mode="mapping_v1"`, a non-null `roster_context`, `DIGEST_ROSTER_MODE="mapping_v1"`, or `DIGEST_ROSTER_BOOT_JSON` with `mode: "mapping_v1"`) returns `UnsupportedConsolidatedPresentation(supported=False, reason_code="standalone_consolidated_mapping_unsupported", deferred_to="B9", requested_mode="mapping_v1")` before any legacy fallback or consolidated text rendering.
- Run-grouped consolidated output is never exposed as a B3 physical account roster, and target counts are never relabeled as physical account counts.
- Cloud's account-oriented path (`cloud_run_daily_digest._report` and `account_daily_digest.render_account_daily`) invokes shared aggregation with `render_text=False` and displays roster-only groups (zero run bindings) even when `QRS_UNIFIED_NOTIFICATION_ENABLED=true`.
- Legacy standalone consolidated callers without mapping mode retain target/run rendering over the legacy array.

## Preparation, status copy, and B9 package handoff

- **Offline preparation**: `scripts/prepare_digest_enrollment_inputs.mjs` runs B2's `buildManagementReadback` and `exportAppliedRecords` together with B1's `projectAccountManagement` over one coherent DO observation, and `python/scripts/project_digest_display_roster.py prepare-mapping` validates and writes `qsl_digest_enrollment_artifact.v1` and `qsl_digest_enrollment_selection.v1`. Existing display-roster wrappers (`project_display_roster`, `project_telegram_display_settings`) retain their legacy CLI and library interfaces.
- **Status text and compact rendering**: [`digest_roster_status_text.py`](../python/scripts/digest_roster_status_text.py) consumes the pinned B2 status/evidence table (`web/strategy-switch-console/application/runtime_instances/account_management_text.js`) at exact parity (default `en`, explicit `zh`). `account_daily_digest.render_account_daily` reserves all distinguishable account headers and concise status lines before adding lower-priority details within the 3850 UTF-16-unit Cloud limit.
- **Service authentication boundary**: `AcquisitionClient` defaults to `DormantServiceAuth` (`service_auth_unavailable`) and never sends cookies; concrete workload-principal provisioning belongs to a separate authorization step.
- **B9 manifest and preflight**: [`digest_package_manifest.json`](../python/scripts/digest_package_manifest.json) (`qsl_digest_package_manifest.v1`) and [`digest_package_preflight.py`](../python/scripts/digest_package_preflight.py) declare all base and B3-overlay generation and preparer members, schemas, status resources, and entry points. `.github/workflows/release-digest-package.yml` is not modified by B3; B9 owns release-overlay integration.
