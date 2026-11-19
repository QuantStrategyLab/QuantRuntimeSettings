// The management cohort predicate shared by every aggregate (Q5): the
// account-facts totals and coverage, the Desk and Console summaries and the
// performance `scope=all` read. It is pure: it reads one registered live
// readback (`qsl_account_management_readback.v1`) and answers, per deployment,
// the physical group it belongs to, its management status and its evidence.
//
// A deployment the readback does not list, or any readback that is absent or
// unreadable, is unknown. Unknown never becomes disabled, paper or zero.
import { MANAGEMENT_STATUS } from "./policy.js";

export const MANAGEMENT_READBACK_FORMAT = "qsl_account_management_readback.v1";
export const MANAGEMENT_SCOPE = "managed_non_paper";

const UNKNOWN_VIEW = Object.freeze({ management_status: MANAGEMENT_STATUS.UNKNOWN, evidence_state: "unknown", scope: "unknown", revision: null, group: null });

// The deployment's view in a readback, or null when the readback does not list
// it. `group` identifies the physical account the deployment belongs to; it is
// null for a deployment no policy account claims.
export function deploymentManagement(readback, platform, key) {
  if (!readback || readback.format !== MANAGEMENT_READBACK_FORMAT) return null;
  for (const group of readback.groups || []) {
    const member = group.deployments?.find(item => item.platform === platform && item.key === key);
    if (member) {
      return {
        management_status: group.management_status, evidence_state: group.evidence_state, scope: group.scope, management_class: group.management_class,
        revision: group.applied?.revision ?? null, reasons: group.reasons, processing_eligible: group.processing_eligible === true,
        processing_denial: group.processing_denial, group: JSON.stringify(group.deployments.map(item => [item.platform, item.key])),
      };
    }
  }
  const loose = readback.uncovered_deployments?.find(item => item.platform === platform && item.key === key);
  return loose ? { management_status: loose.management_status, evidence_state: loose.evidence_state, scope: "unknown", management_class: null,
    revision: null, reasons: loose.reasons, processing_eligible: false, processing_denial: loose.processing_denial, group: null } : null;
}

// The cohort of one readback. `readback` may be null (the object is unbound or
// unreadable): every deployment is then unknown and nothing is resolved.
export function managementCohort(readback) {
  const valid = readback?.format === MANAGEMENT_READBACK_FORMAT && readback.status === "available";
  return Object.freeze({
    meta: Object.freeze({
      evidence_scope: valid ? readback.evidence_scope : null, observed_at: valid ? readback.observed_at : null,
      instance_revision: valid ? readback.instance_revision : null, policy_revision: valid ? readback.policy_revision : null,
    }),
    groupingComplete: valid && readback.physical_grouping_complete === true,
    view(platform, key) {
      const view = valid ? deploymentManagement(readback, platform, key) : null;
      return view || { ...UNKNOWN_VIEW };
    },
    // True when the readback listed the deployment at all.
    resolved(platform, key) { return valid && deploymentManagement(readback, platform, key)?.group != null; },
  });
}

// A known, evidenced status. Anything else (unknown, conflict, stale evidence)
// is not a known status.
export const knownStatus = view => view.evidence_state === "known" && Object.values(MANAGEMENT_STATUS).includes(view.management_status)
  && view.management_status !== MANAGEMENT_STATUS.UNKNOWN;

// A row's own environment and the group's scope are two observations of one
// fact. They conflict when one says paper and the other says live; the group's
// paper scope also only counts while its evidence is known. `environment` is
// the row's own broker environment, or null when it does not say.
export function scopeConflict({ paper, environment = null }, view) {
  const ownPaper = paper === true || environment === "paper", ownLive = environment === "live";
  return (ownPaper && view.scope === "live") || (ownLive && !ownPaper && view.scope === "paper")
    || (paper === true && environment === "live");
}

// The disposition of one displayed deployment under the cohort: paper (by the
// item's own scope or a known paper policy scope) is outside the live-money
// cohort whatever its status; a known disabled or display-only item is a clean
// exclusion; a known managed non-paper item is the cohort; every other
// non-paper item, including a missing environment or a scope conflict, is
// unknown. A policy scope proves paper only with known evidence.
export function managementDisposition({ paper, environment = null }, view) {
  if (scopeConflict({ paper, environment }, view)) return "unknown";
  if (paper === true || environment === "paper" || (view.scope === "paper" && view.evidence_state === "known")) return "paper";
  if (!knownStatus(view)) return "unknown";
  return { [MANAGEMENT_STATUS.MANAGED]: "managed", [MANAGEMENT_STATUS.DISABLED]: "disabled",
    [MANAGEMENT_STATUS.NOT_UNDER_MANAGEMENT]: "not_under_management" }[view.management_status] || "unknown";
}

// The nine management counts. Physical categories count each resolved group
// once; deployments the readback does not place in a group are counted apart
// and make the physical total null. A deployment count is never promoted to a
// physical one. `items` carry `platform` and `account_key`.
export function managementCounts(items, dispositions, cohort, isDuplicate = () => false) {
  const resolved = items.filter(item => cohort.resolved(item.platform, item.account_key));
  const groupsOf = predicate => new Set(resolved.filter(predicate).map(item => cohort.view(item.platform, item.account_key).group)).size;
  const by = name => item => dispositions.get(item) === name;
  const unresolved = items.length - resolved.length;
  return {
    display_physical: unresolved === 0 && cohort.groupingComplete ? groupsOf(() => true) : null,
    display_deployments: items.length,
    managed_non_paper: groupsOf(by("managed")),
    management_disabled_non_paper: groupsOf(by("disabled")),
    not_under_management_non_paper: groupsOf(by("not_under_management")),
    unknown_non_paper: groupsOf(by("unknown")),
    paper_excluded: groupsOf(by("paper")),
    duplicate_deployments: items.filter(isDuplicate).length,
    unresolved_deployments: unresolved,
  };
}
