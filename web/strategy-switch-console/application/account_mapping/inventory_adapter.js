// Thin adapter from the #1173 account-identity inventory to the mapping
// authority input. It consumes the private result of assemble()
// (inspect_account_identity_inventory.mjs) unchanged and resolves nothing
// itself: identities come from the reader's current instance episodes, and
// every incomplete, truncated, ambiguous or conflicting reader result is
// carried through as `unknown` or `conflict`. It allocates no canonical
// identity and rekeys nothing; a later identity migration can replace it.
// Pure; no storage, environment or network access.
import { MappingPolicyError, classifyAccounts, deploymentId, normalizeMappingPolicy, validInstant, validSettingsIdentity } from "./policy.js";

export const MAPPING_AUTHORITY_INPUT_FORMAT = "qsl_account_mapping_authority_input.v1";
// The only reader status that enumerates retained state; group 23 is
// external evidence by design and never complete.
const ENUMERATED = "retained_state_enumerated_external_evidence_required";
const RETAINED_GROUPS = Array.from({ length: 22 }, (_, index) => String(index + 1));
const EXTERNAL_GROUP = "23";
const SOURCE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LIVE_STATES = ["current", "draft", "retirement_requested"];

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sortedUnique = items => [...new Set(items)].sort();

// Completeness evidence of the whole result. Any reason makes the result
// non-authoritative: missing data could hold an episode that changes any
// account's identity, so no subset is certified.
function completeness(result) {
  const reasons = [];
  if (result.status !== ENUMERATED) reasons.push(`inventory_status:${result.status}`);
  for (const group of RETAINED_GROUPS) if (result.groups?.[group] !== "complete") reasons.push(`group:${group}:${result.groups?.[group] ?? "missing"}`);
  if (result.groups?.[EXTERNAL_GROUP] !== "external_evidence_required") reasons.push(`group:${EXTERNAL_GROUP}:${result.groups?.[EXTERNAL_GROUP] ?? "missing"}`);
  for (const object of result.objects || []) if (object?.complete !== true) reasons.push(`object:${object?.object}:incomplete`);
  if ((result.objects || []).length !== 2) reasons.push("objects:unexpected");
  if (result.kv?.stable !== true) reasons.push("kv:not_stable");
  if (!result.env) reasons.push("env:not_collected");
  if (result.identity_losses?.length) reasons.push("identity_losses");
  if (result.reasons?.length) reasons.push("inventory_reasons");
  return reasons;
}

// The instance-state row of the runtime object: its revision and the
// (platform, key) pairs of its existing, non-retiring instances.
function instanceState(result) {
  const rows = result.objects?.find(object => object?.object === "runtime")?.tables?.instance_state?.rows;
  const row = rows?.length === 1 ? rows[0] : null;
  const payload = row?.columns?.payload;
  if (!row || !Number.isSafeInteger(row.columns?.revision) || payload?.state !== "valid" || !Array.isArray(payload.entries)
    || payload.entries.length !== payload.entry_count) return null;
  // The reader's own `current` rule: existing, with no retirement requested.
  const existing = payload.entries.filter(item => item?.kind === "existing" && (!item.retirement_status || item.retirement_status === "none"))
    .map(item => deploymentId(item.platform, item.key));
  return { revision: row.columns.revision, existing };
}

// Mapping authority input from an assembled inventory. `observedAt` is the
// collection time and `sourceRef` an opaque protected reference to the
// export; both are supplied by the operator and carried, not derived.
export function mappingAuthorityInput(result, { observedAt, sourceRef } = {}) {
  if (!isObject(result) || !isObject(result.mapping) || !["entries", "conflicts", "collisions", "unattributed"].every(name => Array.isArray(result.mapping[name]))
    || !isObject(result.groups) || !Array.isArray(result.objects)) throw new MappingPolicyError("invalid_inventory_result");
  if (!validInstant(observedAt)) throw new MappingPolicyError("invalid_observed_at");
  if (typeof sourceRef !== "string" || !SOURCE_REF.test(sourceRef)) throw new MappingPolicyError("invalid_source_ref");
  const reasons = completeness(result);
  const state = instanceState(result);
  if (!state) reasons.push("instance_state_unavailable");
  const { entries, conflicts, collisions, unattributed } = result.mapping;
  const conflictKinds = new Map();
  for (const conflict of conflicts) {
    const id = deploymentId(conflict?.platform, conflict?.legacy_key);
    conflictKinds.set(id, [...(conflictKinds.get(id) || []), String(conflict?.kind)]);
  }
  const collided = new Set(collisions.map(collision => collision?.legacy_key));
  const deployments = [], excluded = [];
  for (const entry of entries) {
    const id = deploymentId(entry.platform, entry.legacy_key);
    const states = Array.isArray(entry.states) ? entry.states : [];
    const episodes = Array.isArray(entry.episodes) ? entry.episodes : [];
    // Several entries for one deployment would be a reader defect; neither is used.
    if (entries.filter(other => deploymentId(other.platform, other.legacy_key) === id).length > 1) {
      excluded.push({ platform: entry.platform, legacy_key: entry.legacy_key, evidence_state: "conflict", reasons: ["mapping_entry_duplicated"] });
      continue;
    }
    if (!states.includes("current")) {
      const why = states.includes("orphan") ? "orphan" : states.find(item => LIVE_STATES.includes(item)) ?? "not_current";
      excluded.push({ platform: entry.platform, legacy_key: entry.legacy_key, evidence_state: "unknown", reasons: [`instance_${why}`] });
      continue;
    }
    const local = [], conflicting = [];
    const current = episodes.filter(episode => episode?.state === "current");
    const identity = current.length === 1 ? current[0].identity?.settings_identity : null;
    if (current.length !== 1) conflicting.push("current_episode_ambiguous");
    else if (current[0].identity?.settings_identity_qualification || !validSettingsIdentity(identity)) local.push("identity_unreadable");
    if (states.includes("draft") || states.includes("retirement_requested")) local.push("instance_not_settled");
    if (episodes.some(episode => episode?.locator?.path_qualification)) local.push("identity_path_unparseable");
    if (conflictKinds.has(id)) conflicting.push(...conflictKinds.get(id));
    if (collided.has(entry.legacy_key)) conflicting.push("cross_platform_collision");
    if (state && !state.existing.includes(id)) local.push("instance_state_mismatch");
    deployments.push({ platform: entry.platform, legacy_key: entry.legacy_key, identity: validSettingsIdentity(identity) ? { ...identity } : null,
      evidence_state: conflicting.length ? "conflict" : local.length ? "unknown" : "known", reasons: sortedUnique([...conflicting, ...local]) });
  }
  // Every existing instance must be a current reader entry, and only once.
  if (state && (state.existing.length !== new Set(state.existing).size
    || state.existing.some(id => !deployments.some(item => deploymentId(item.platform, item.legacy_key) === id)))) reasons.push("instance_state_mismatch");
  return {
    format: MAPPING_AUTHORITY_INPUT_FORMAT, authoritative: !reasons.length, reasons: sortedUnique(reasons),
    instance_revision: state?.revision ?? null, observed_at: observedAt, source_ref: sourceRef, deployments, excluded,
    // Unattributed references name no platform: they are counted, never mapped.
    counts: { entries: entries.length, deployments: deployments.length, conflicts: conflicts.length, collisions: collisions.length, unattributed: unattributed.length },
  };
}

// The mapping authority: classified accounts over the authority input. A
// policy that does not validate classifies nothing; the resolved
// deployments stay visible as unclassified `unknown` entries.
export function deriveMappingAuthority(result, policyDocument, meta) {
  const input = mappingAuthorityInput(result, meta);
  let policy = null, policyError = null;
  try { policy = normalizeMappingPolicy(policyDocument); } catch (error) {
    if (!(error instanceof MappingPolicyError)) throw error;
    policyError = error.code;
  }
  const accounts = classifyAccounts(input, policy ?? { accounts: [] });
  return { ...input, policy_revision: policy?.policy_revision ?? null, policy_error: policyError, accounts };
}
