// Advisory HTTP preflight of the processing-admission gate (Q7). It reads the
// live management readback once and names the typed denial a Durable Object
// commit would raise, so a denied entrance stops before any outbound read or
// fallback write. It confers no authority: every entrance still re-resolves
// current state inside its Durable Object transaction, and an unreadable
// readback admits nothing new here, it simply leaves the decision to the object.
import { deploymentManagement, fetchManagementReadback } from "./account_management_readback.js";

const UNKNOWN = Object.freeze({ error: "management_status_unknown", status: 409 });

// `deployments` is a list of { platform, key }; a null key is a deployment the
// caller could not resolve and is denied as unknown. Returns the first denial
// as { error, status: 409 }, or null when every deployment is admitted or the
// readback is unavailable.
export async function managementPreflight(env, deployments) {
  const readback = await fetchManagementReadback(env);
  if (!readback) return null;
  for (const item of deployments) {
    if (typeof item?.platform !== "string" || typeof item?.key !== "string") return UNKNOWN;
    const view = deploymentManagement(readback, item.platform, item.key);
    if (!view) return UNKNOWN;
    if (!view.processing_eligible) return { error: view.processing_denial || UNKNOWN.error, status: 409 };
  }
  return null;
}

// The deployments of the risk-binding scopes a replacement changes: added,
// removed or modified. Unchanged scopes are not admitted, as in the object.
// A target naming no deployment or several resolves none and is unknown.
export function changedRiskDeployments(current, next, options, canonical) {
  const stored = new Map((current || []).map(binding => [binding?.scope_id, binding]));
  const wanted = new Map((next || []).map(binding => [binding?.scope_id, binding]));
  const out = [];
  for (const scopeId of new Set([...stored.keys(), ...wanted.keys()])) {
    const before = stored.get(scopeId), after = wanted.get(scopeId);
    if (before !== undefined && after !== undefined && canonical(before) === canonical(after)) continue;
    const target = after || before;
    out.push(riskTargetDeployment(options, target?.platform, target?.target_name));
  }
  return out;
}

export function riskTargetDeployment(options, platform, targetName) {
  const matches = (options?.[platform] || []).filter(config => config?.target_name === targetName);
  return { platform, key: matches.length === 1 ? matches[0].key : null };
}

export const preflightBody = denial => ({ ok: false, error: denial.error, no_order: true, execution_authority_granted: false });
