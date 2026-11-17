// Account mapping policy: the protected classification of existing account
// identities as `eligible` or `display_only` for quant management. Pure
// functions over supplied documents; no storage, environment or network
// access. Classification is policy data bound to the existing settings
// identity of each deployment and to a policy revision. It is not a user
// setting, no management request can change it, and no code here branches
// on a platform, an account or a label: only on the class.

export const MAPPING_POLICY_FORMAT = "qsl_account_mapping_policy.v1";
export const MANAGEMENT_CLASSES = Object.freeze(["eligible", "display_only"]);
// Generic management-status codes. Website and digest translate these codes;
// no producer-supplied label is ever displayed in their place.
export const MANAGEMENT_STATUS = Object.freeze({
  MANAGED: "managed",
  DISABLED: "management_disabled",
  NOT_UNDER_MANAGEMENT: "not_under_management",
  UNKNOWN: "unknown",
});
export const EVIDENCE_STATES = Object.freeze(["known", "unknown", "conflict", "stale"]);
// The settings identity as accountSettingsIdentity() derives it.
export const SETTINGS_IDENTITY_FIELDS = Object.freeze(["platform", "key", "target_name", "broker_environment", "account_selector",
  "deployment_selector", "account_scope", "service_name"]);
export const EFFECTIVE_MANAGEMENT_FIELDS = Object.freeze(["platform", "legacy_key", "management_enabled", "revision", "effective_at"]);
export const MAPPING_POLICY_LIMITS = Object.freeze({ accounts: 256, deployments: 16, text: 200 });

export class MappingPolicyError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const boundedText = value => typeof value === "string" && value.length <= MAPPING_POLICY_LIMITS.text;
const identifier = value => boundedText(value) && value.length > 0;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export const validInstant = value => typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
export const deploymentId = (platform, legacyKey) => JSON.stringify([platform, legacyKey]);

// A settings identity exactly as stored: every field present, strings only,
// broker environment `live`, `paper` or null. Values are kept byte-identical.
export function validSettingsIdentity(identity) {
  if (!exactKeys(identity, SETTINGS_IDENTITY_FIELDS)) return false;
  return SETTINGS_IDENTITY_FIELDS.every(field => field === "broker_environment"
    ? identity[field] === null || identity[field] === "live" || identity[field] === "paper"
    : boundedText(identity[field])) && identifier(identity.platform) && identifier(identity.key);
}
export const sameSettingsIdentity = (left, right) => SETTINGS_IDENTITY_FIELDS.every(field => left?.[field] === right?.[field]);

// Strict policy document. A malformed document, an unknown class or a
// physical account whose deployments span platforms or broker environments
// rejects the whole document: nothing in it is classified. A deployment
// listed under two accounts is kept and reported as a conflict by
// classifyAccounts(); no account wins it.
export function normalizeMappingPolicy(document) {
  if (!exactKeys(document, ["format", "policy_revision", "accounts"]) || document.format !== MAPPING_POLICY_FORMAT) throw new MappingPolicyError("invalid_mapping_policy");
  if (!Number.isSafeInteger(document.policy_revision) || document.policy_revision < 1) throw new MappingPolicyError("invalid_mapping_policy_revision");
  if (!Array.isArray(document.accounts) || !document.accounts.length || document.accounts.length > MAPPING_POLICY_LIMITS.accounts) throw new MappingPolicyError("invalid_mapping_policy_accounts");
  const accounts = document.accounts.map(account => {
    if (!exactKeys(account, ["management_class", "deployments"])) throw new MappingPolicyError("invalid_mapping_policy_account");
    if (!MANAGEMENT_CLASSES.includes(account.management_class)) throw new MappingPolicyError("invalid_management_class");
    if (!Array.isArray(account.deployments) || !account.deployments.length || account.deployments.length > MAPPING_POLICY_LIMITS.deployments) {
      throw new MappingPolicyError("invalid_mapping_policy_deployments");
    }
    const deployments = account.deployments.map(item => {
      if (!exactKeys(item, ["platform", "legacy_key", "identity"]) || !identifier(item.platform) || !identifier(item.legacy_key)
        || !validSettingsIdentity(item.identity) || item.identity.platform !== item.platform || item.identity.key !== item.legacy_key) {
        throw new MappingPolicyError("invalid_mapping_policy_deployment");
      }
      return { platform: item.platform, legacy_key: item.legacy_key, identity: { ...item.identity } };
    });
    if (new Set(deployments.map(item => item.platform)).size !== 1) throw new MappingPolicyError("physical_account_spans_platforms");
    if (new Set(deployments.map(item => item.identity.broker_environment)).size !== 1) throw new MappingPolicyError("physical_account_spans_environments");
    if (new Set(deployments.map(item => deploymentId(item.platform, item.legacy_key))).size !== deployments.length) {
      throw new MappingPolicyError("invalid_mapping_policy_deployments");
    }
    return { management_class: account.management_class, deployments };
  });
  return { policy_revision: document.policy_revision, accounts };
}

const rank = { known: 0, unknown: 1, conflict: 2 };
const worst = (left, right) => (rank[right] > rank[left] ? right : left);

// Classify resolved deployments by policy. `resolved` is the mapping
// authority input: `{ authoritative, reasons, deployments: [{ platform,
// legacy_key, identity, evidence_state, reasons }] }`. Each policy account
// becomes one mapping entry, however many deployments it lists. A resolved
// deployment no policy account lists stays visible as its own unclassified
// entry with `unknown` evidence. Evidence is `known` only when the input is
// authoritative, every deployment is resolved as `known` with its policy
// identity unchanged, and no other policy account lists it.
export function classifyAccounts(resolved, policy) {
  const byId = new Map((resolved?.deployments || []).map(item => [deploymentId(item.platform, item.legacy_key), item]));
  const claims = new Map();
  for (const account of policy.accounts) for (const item of account.deployments) {
    const id = deploymentId(item.platform, item.legacy_key);
    claims.set(id, (claims.get(id) || 0) + 1);
  }
  const accounts = policy.accounts.map(account => {
    let evidence = resolved?.authoritative === true ? "known" : "unknown";
    const reasons = resolved?.authoritative === true ? [] : ["mapping_authority_unavailable"];
    for (const item of account.deployments) {
      const id = deploymentId(item.platform, item.legacy_key), found = byId.get(id);
      if (claims.get(id) > 1) { evidence = worst(evidence, "conflict"); reasons.push("deployment_claimed_by_multiple_accounts"); }
      if (!found) { evidence = worst(evidence, "unknown"); reasons.push("deployment_not_resolved"); continue; }
      if (found.evidence_state !== "known") { evidence = worst(evidence, found.evidence_state === "conflict" ? "conflict" : "unknown"); reasons.push(...found.reasons); }
      if (!sameSettingsIdentity(found.identity, item.identity)) { evidence = worst(evidence, "conflict"); reasons.push("physical_identity_changed"); }
    }
    return { deployments: account.deployments.map(item => ({ platform: item.platform, legacy_key: item.legacy_key })),
      management_class: account.management_class, evidence_state: evidence, reasons: [...new Set(reasons)].sort() };
  });
  const unclassified = [...byId.entries()].filter(([id]) => !claims.has(id)).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, item]) => ({ deployments: [{ platform: item.platform, legacy_key: item.legacy_key }], management_class: null, evidence_state: item.evidence_state === "conflict" ? "conflict" : "unknown",
      reasons: [...new Set(["deployment_unclassified", ...(item.reasons || [])])].sort() }));
  return [...accounts, ...unclassified];
}

// Applied management state, one record per deployment. A record carrying
// any other field (a class, a label, a status) is rejected, not trimmed: no
// management record can reclassify an account or supply display text.
export function normalizeEffectiveManagement(record) {
  if (!exactKeys(record, EFFECTIVE_MANAGEMENT_FIELDS)) return { rejected: "effective_state_shape_rejected" };
  if (!identifier(record.platform) || !identifier(record.legacy_key) || typeof record.management_enabled !== "boolean"
    || !Number.isSafeInteger(record.revision) || record.revision < 1 || !validInstant(record.effective_at)) return { rejected: "effective_state_shape_rejected" };
  return { platform: record.platform, legacy_key: record.legacy_key, management_enabled: record.management_enabled, revision: record.revision, effective_at: record.effective_at };
}

// Whether management may ever be enabled for a class. The class alone
// decides; the account, platform and label never do.
export const managementEnableAllowed = managementClass => managementClass === "eligible";

// The effective management state of one classified account from the
// per-deployment records. Every deployment's records are inspected before
// the outcome is chosen. Any contradiction is a conflict: a duplicated or
// malformed record, a record enabling management for a class that may not
// have it, or available records disagreeing on value or revision. Without
// one, a missing record makes the state unknown; otherwise the agreed state
// is known. The outcome does not depend on deployment or record order, and
// only a known outcome carries a revision. A display-only account is never
// reported as managed.
export function effectiveManagementState(account, records) {
  const list = Array.isArray(records) ? records : [];
  const states = [], conflicts = [];
  let missing = false;
  for (const item of account.deployments) {
    const matching = list.filter(record => record?.platform === item.platform && record?.legacy_key === item.legacy_key);
    if (!matching.length) { missing = true; continue; }
    if (matching.length > 1) { conflicts.push("effective_state_duplicated"); continue; }
    const accepted = normalizeEffectiveManagement(matching[0]);
    if (accepted.rejected) { conflicts.push(accepted.rejected); continue; }
    if (accepted.management_enabled && !managementEnableAllowed(account.management_class)) conflicts.push("management_enabled_for_ineligible_class");
    states.push(accepted);
  }
  if (new Set(states.map(state => JSON.stringify([state.management_enabled, state.revision]))).size > 1) conflicts.push("effective_state_differs_across_deployments");
  if (conflicts.length) return { evidence_state: "conflict", reasons: [...new Set(conflicts)].sort() };
  if (missing) return { evidence_state: "unknown", reasons: ["effective_state_missing"] };
  const [state] = states;
  return { evidence_state: "known", reasons: [], management_enabled: state.management_enabled, revision: state.revision,
    effective_at: states.map(item => item.effective_at).sort().at(-1) };
}

// The generic status code of a classified account. Anything not known
// reads `unknown`; a disabled label is never invented for missing state.
export function managementStatus(account, effective) {
  if (account.evidence_state !== "known") return MANAGEMENT_STATUS.UNKNOWN;
  if (account.management_class === "display_only") return effective?.evidence_state === "conflict" ? MANAGEMENT_STATUS.UNKNOWN : MANAGEMENT_STATUS.NOT_UNDER_MANAGEMENT;
  if (account.management_class !== "eligible" || effective?.evidence_state !== "known") return MANAGEMENT_STATUS.UNKNOWN;
  return effective.management_enabled ? MANAGEMENT_STATUS.MANAGED : MANAGEMENT_STATUS.DISABLED;
}

// Processing predicate over a projected row: known evidence and applied
// management enabled, which managementStatus() reports only for an eligible
// class. It grants nothing else: live execution, strategy binding and every
// other permission stay separately gated. No caller gates on it yet.
export const processingEligible = row => row?.evidence_state === "known" && row.management_status === MANAGEMENT_STATUS.MANAGED;
