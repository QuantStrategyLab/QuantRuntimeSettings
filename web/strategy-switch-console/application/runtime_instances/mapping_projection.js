// Protected read projection of the account mapping authority over the
// runtime-instance state. Per displayed account it exposes the existing
// deployment identities, accepted enrollment links, a generic
// management-status code, the evidence state, the revisions, the
// observation time and the source reference. It never reads or emits a
// label, allocates no identity and rekeys nothing: legacy keys and opaque
// link IDs pass through byte-identical. Pure; the caller supplies the
// instance state read inside the Durable Object.
import { accountSettingsIdentity } from "../account_settings/helpers.js";
import { deriveMappingAuthority } from "../account_mapping/inventory_adapter.js";
import { MANAGEMENT_STATUS, deploymentId, effectiveManagementState, managementStatus, sameSettingsIdentity } from "../account_mapping/policy.js";

export const ACCOUNT_MANAGEMENT_PROJECTION_FORMAT = "qsl_account_management_projection.v1";
// The private enrollment link as the digest display-roster preparer reads
// it (python/scripts/project_digest_display_roster.py).
const LINK_BINDING_FIELDS = ["platform_id", "candidate_slot", "opaque_account_uid", "target_id"];
const LINK_CONFIG_FIELDS = ["account_selector", "deployment_selector", "service_name", "runtime_status_target_id"];

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.length > 0;
const rank = { known: 0, stale: 1, unknown: 2, conflict: 3 };
const worst = (...states) => states.reduce((left, right) => (rank[right] > rank[left] ? right : left), "known");

// Enrollment links are a compatibility edge onto deployments the authority
// already resolved: they never create, merge or reidentify an account. A
// link is accepted only when it names exactly one current instance whose
// configuration still equals its recorded identity, and when no other link
// makes that deployment, its physical account, the opaque ID or its
// platform candidate slot ambiguous.
function acceptLinks(links, current, accountOf) {
  const accepted = new Map(), rejected = [];
  const reject = (link, reason) => rejected.push({ ...(isObject(link) ? Object.fromEntries(LINK_BINDING_FIELDS.filter(field => text(link[field])).map(field => [field, link[field]])) : {}), reason });
  const candidates = [];
  for (const link of Array.isArray(links) ? links : []) {
    // Other fields (a label, a hint) are ignored as the legacy reader
    // ignores them, and never emitted.
    if (!isObject(link) || ![...LINK_BINDING_FIELDS, "account_key"].every(field => text(link[field]))
      || !isObject(link.config_identity) || Object.keys(link.config_identity).length !== LINK_CONFIG_FIELDS.length
      || !LINK_CONFIG_FIELDS.every(field => Object.hasOwn(link.config_identity, field))) { reject(link, "link_shape_rejected"); continue; }
    const matches = current.filter(item => item.platform === link.platform_id && item.key === link.account_key);
    if (matches.length !== 1) { reject(link, matches.length ? "link_target_ambiguous" : "link_target_missing"); continue; }
    const config = matches[0].config || {};
    if (!text(config.account_selector) || LINK_CONFIG_FIELDS.some(field => (config[field] ?? null) !== link.config_identity[field])) { reject(link, "link_identity_changed"); continue; }
    candidates.push(link);
  }
  const binding = link => JSON.stringify(LINK_BINDING_FIELDS.map(field => link[field]));
  // A platform candidate slot names one digest object: every link sharing
  // one is rejected, across deployments and accounts; none is chosen.
  const slot = link => JSON.stringify([link.platform_id, link.candidate_slot]);
  const slots = candidates.reduce((counts, link) => counts.set(slot(link), (counts.get(slot(link)) || 0) + 1), new Map());
  for (const link of candidates) {
    const id = deploymentId(link.platform_id, link.account_key), account = accountOf(id);
    const duplicate = candidates.filter(other => binding(other) === binding(link)).length > 1;
    const uids = new Set(candidates.filter(other => deploymentId(other.platform_id, other.account_key) === id).map(other => other.opaque_account_uid));
    const accounts = new Set(candidates.filter(other => other.platform_id === link.platform_id && other.opaque_account_uid === link.opaque_account_uid)
      .map(other => accountOf(deploymentId(other.platform_id, other.account_key))));
    if (duplicate) reject(link, "link_duplicated");
    else if (slots.get(slot(link)) > 1) reject(link, "link_candidate_slot_ambiguous");
    else if (uids.size > 1 || accounts.size > 1 || account === undefined) reject(link, "link_ambiguous");
    else accepted.set(account, [...(accepted.get(account) || []), Object.fromEntries(LINK_BINDING_FIELDS.map(field => [field, link[field]]))]);
  }
  return { accepted, rejected };
}

// The reader's `current` rule: existing, with no retirement requested.
const isCurrent = item => item?.kind === "existing" && (!item.retirement_status || item.retirement_status === "none");
const groupBy = items => items.reduce((groups, item) => groups.set(deploymentId(item?.platform, item?.legacy_key), [...(groups.get(deploymentId(item?.platform, item?.legacy_key)) || []), item]), new Map());

// The mapping authority is derived here, never accepted: any derivation
// failure (a missing or malformed inventory result, policy document or
// collection metadata) classifies nothing.
function derive(inventory, policy, collection) {
  try { return deriveMappingAuthority(inventory, policy, collection); } catch { return null; }
}

// Call options are normalized before any field is read: an absent, null or
// non-object argument supplies no state and no authority input.
const projectionOptions = options => (isObject(options) ? options : {});

// `state` is RuntimeInstances.read(). `inventory` is the private result of
// the #1173 assemble(), `policy` the protected mapping-policy document and
// `collection` its `{ observedAt, sourceRef }`; classification is derived
// from them here (deriveMappingAuthority), and no caller-supplied summary,
// class or evidence is read. The policy document is trusted only as far as
// the composing caller that supplies it: its content does not authenticate
// its origin. `effective` are applied management records, one per
// deployment; `links` are private enrollment links. Every current instance
// is displayed: one the derived authority does not cover reads `unknown`.
// An authority derived at an older instance revision reads `stale`.
export function projectAccountManagement(options) {
  const { state, inventory, policy, collection, effective = [], links = [] } = projectionOptions(options);
  const instances = state?.initialized === true && Array.isArray(state.instances) ? state.instances : [];
  const current = instances.filter(isCurrent);
  const authority = derive(inventory, policy, collection);
  const resolved = groupBy(authority?.deployments || []), excluded = groupBy(authority?.excluded || []);
  const accounts = (authority?.accounts || []).map(account => ({ account, ids: account.deployments.map(item => deploymentId(item.platform, item.legacy_key)), derived: true }));
  const covered = new Set(accounts.flatMap(item => item.ids));
  for (const item of current) {
    const id = deploymentId(item.platform, item.key);
    if (covered.has(id)) continue;
    covered.add(id);
    accounts.push({ account: { deployments: [{ platform: item.platform, legacy_key: item.key }], management_class: null, evidence_state: "unknown" }, ids: [id], derived: false });
  }
  const owner = new Map(accounts.flatMap((entry, index) => entry.ids.map(id => [id, index])));
  // Links keep the legacy target set: every existing instance.
  const { accepted, rejected } = acceptLinks(links, instances.filter(item => item?.kind === "existing"), id => owner.get(id));
  const stale = authority?.instance_revision !== state?.revision;
  const rows = accounts.map(({ account, ids, derived }, index) => {
    let evidence = derived && (account.evidence_state === "known" || account.evidence_state === "conflict") ? account.evidence_state : "unknown";
    for (const id of ids) {
      // Exactly one resolved reader entry, none excluded.
      const claims = resolved.get(id) || [], exclusions = excluded.get(id) || [];
      if (exclusions.length) evidence = worst(evidence, exclusions.some(item => item.evidence_state === "conflict") ? "conflict" : "unknown");
      if (claims.length !== 1) evidence = worst(evidence, claims.length > 1 ? "conflict" : "unknown");
      // Exactly one current instance, whose identity is still the resolved one.
      const matches = instances.filter(item => deploymentId(item?.platform, item?.key) === id);
      if (matches.length > 1) evidence = worst(evidence, "conflict");
      else if (!matches.length || !isCurrent(matches[0])) evidence = worst(evidence, "unknown");
      else if (claims.length === 1 && !sameSettingsIdentity(accountSettingsIdentity(matches[0]), claims[0].identity)) evidence = worst(evidence, "conflict");
    }
    if (stale && derived) evidence = worst(evidence, "stale");
    // Applied records are read against a policy class only; an unclassified
    // row stays unknown whatever they say.
    const applied = account.management_class ? effectiveManagementState(account, effective) : { evidence_state: "unknown", reasons: ["deployment_unclassified"] };
    // A display-only class needs no applied record; a conflicting one counts.
    if (applied.evidence_state === "conflict" || (account.management_class === "eligible" && applied.evidence_state !== "known")) evidence = worst(evidence, applied.evidence_state);
    const status = managementStatus({ ...account, evidence_state: evidence }, applied);
    return {
      deployments: account.deployments.map(item => ({ platform: item.platform, legacy_key: item.legacy_key })),
      enrollment_links: accepted.get(index) || [],
      management_status: status, evidence_state: evidence,
      configuration_revision: { instances: Number.isSafeInteger(state?.revision) ? state.revision : null, mapping_policy: authority?.policy_revision ?? null,
        management: applied.evidence_state === "known" ? applied.revision : null },
      observed_at: authority?.observed_at ?? null, source_ref: authority?.source_ref ?? null,
    };
  });
  const counts = Object.fromEntries(Object.values(MANAGEMENT_STATUS).map(code => [code, rows.filter(row => row.management_status === code).length]));
  return { format: ACCOUNT_MANAGEMENT_PROJECTION_FORMAT, accounts: rows, rejected_links: rejected, counts: { display_accounts: rows.length, ...counts } };
}
