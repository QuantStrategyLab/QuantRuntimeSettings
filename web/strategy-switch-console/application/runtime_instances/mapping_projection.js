// Protected read projection of the account mapping authority over the
// runtime-instance state. Per displayed account it exposes the existing
// deployment identities, accepted enrollment links, a generic
// management-status code, the evidence state, the revisions, the
// observation time and the source reference. It never reads or emits a
// label, allocates no identity and rekeys nothing: legacy keys and opaque
// link IDs pass through byte-identical. Pure; the caller supplies the
// instance state read inside the Durable Object.
import { accountSettingsIdentity } from "../account_settings/helpers.js";
import { MAPPING_AUTHORITY_INPUT_FORMAT } from "../account_mapping/inventory_adapter.js";
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
// makes that deployment, its physical account or the opaque ID ambiguous.
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
  for (const link of candidates) {
    const id = deploymentId(link.platform_id, link.account_key), account = accountOf(id);
    const duplicate = candidates.filter(other => binding(other) === binding(link)).length > 1;
    const uids = new Set(candidates.filter(other => deploymentId(other.platform_id, other.account_key) === id).map(other => other.opaque_account_uid));
    const accounts = new Set(candidates.filter(other => other.platform_id === link.platform_id && other.opaque_account_uid === link.opaque_account_uid)
      .map(other => accountOf(deploymentId(other.platform_id, other.account_key))));
    if (duplicate) reject(link, "link_duplicated");
    else if (uids.size > 1 || accounts.size > 1 || account === undefined) reject(link, "link_ambiguous");
    else accepted.set(account, [...(accepted.get(account) || []), Object.fromEntries(LINK_BINDING_FIELDS.map(field => [field, link[field]]))]);
  }
  return { accepted, rejected };
}

// `state` is RuntimeInstances.read(); `authority` is a mapping authority
// derived offline from a complete inventory (deriveMappingAuthority);
// `effective` are applied management records, one per deployment; `links`
// are private enrollment links. Every current instance is displayed: one
// not covered by the authority reads `unknown`. An authority bound to an
// older instance revision reads `stale`.
export function projectAccountManagement({ state, authority, effective = [], links = [] }) {
  const current = state?.initialized === true && Array.isArray(state.instances) ? state.instances.filter(item => item?.kind === "existing") : [];
  const usable = isObject(authority) && authority.format === MAPPING_AUTHORITY_INPUT_FORMAT && Array.isArray(authority.accounts) && Array.isArray(authority.deployments);
  const resolved = new Map((usable ? authority.deployments : []).map(item => [deploymentId(item.platform, item.legacy_key), item]));
  const accounts = (usable ? authority.accounts : []).map(account => ({ account, ids: account.deployments.map(item => deploymentId(item.platform, item.legacy_key)) }));
  const covered = new Set(accounts.flatMap(item => item.ids));
  for (const item of current) {
    const id = deploymentId(item.platform, item.key);
    if (!covered.has(id)) accounts.push({ account: { deployments: [{ platform: item.platform, legacy_key: item.key }], management_class: null, evidence_state: "unknown" }, ids: [id] });
  }
  const owner = new Map(accounts.flatMap((entry, index) => entry.ids.map(id => [id, index])));
  const { accepted, rejected } = acceptLinks(links, current, id => owner.get(id));
  const stale = !usable || authority.instance_revision !== state?.revision;
  const rows = accounts.map(({ account, ids }, index) => {
    let evidence = account.evidence_state === "known" || account.evidence_state === "conflict" ? account.evidence_state : "unknown";
    // The authority's resolved identity must still be the current one.
    for (const id of ids) {
      const instance = current.find(item => deploymentId(item.platform, item.key) === id);
      if (!instance) evidence = worst(evidence, "unknown");
      else if (resolved.has(id) && !sameSettingsIdentity(accountSettingsIdentity(instance), resolved.get(id).identity)) evidence = worst(evidence, "conflict");
    }
    if (stale && usable && covered.has(ids[0])) evidence = worst(evidence, "stale");
    const applied = effectiveManagementState(account, effective);
    // A display-only class needs no applied record; a conflicting one counts.
    if (applied.evidence_state === "conflict" || (account.management_class === "eligible" && applied.evidence_state !== "known")) evidence = worst(evidence, applied.evidence_state);
    const status = managementStatus({ ...account, evidence_state: evidence }, applied);
    return {
      deployments: account.deployments.map(item => ({ platform: item.platform, legacy_key: item.legacy_key })),
      enrollment_links: accepted.get(index) || [],
      management_status: status, evidence_state: evidence,
      configuration_revision: { instances: Number.isSafeInteger(state?.revision) ? state.revision : null, mapping_policy: usable ? authority.policy_revision ?? null : null,
        management: applied.evidence_state === "known" ? applied.revision : null },
      observed_at: usable ? authority.observed_at : null, source_ref: usable ? authority.source_ref : null,
    };
  });
  const counts = Object.fromEntries(Object.values(MANAGEMENT_STATUS).map(code => [code, rows.filter(row => row.management_status === code).length]));
  return { format: ACCOUNT_MANAGEMENT_PROJECTION_FORMAT, accounts: rows, rejected_links: rejected, counts: { display_accounts: rows.length, ...counts } };
}
