// N1 §4.A: GET /api/desk/switch/targets/{id}/strategies (qsl.desk.switch_strategies.v2).
//
// A projection of the saved account configuration and the strategy catalog.
// Configuration compatibility is not runtime switchability: `switchable` stays
// false (switch_not_connected) and no switch write route changes. Eligibility
// is only given where the existing configuration/catalog checks prove it;
// otherwise the row keeps an unknown eligibility rather than being dropped.
import { DeskError } from "./http.js";
import { readbackTargets } from "./readback.js";
import {
  canonicalJson, coverage, known, n1Response, n1Route, partial, readOnce, sha256Hex, timeBasis, unknown,
} from "./n1.js";

const MODES = ["dry_run", "paper", "live"];
const REASONS = new Set(["domain_not_supported", "strategy_frozen", "platform_live_not_supported", "catalog_not_live_enabled"]);
const FINGERPRINT_SOURCE = "qsl.desk.switch_strategies.v2/catalog_projection.v1";

/** Decode the path id exactly once; anything malformed is an unknown target. */
export function switchStrategiesTargetId(pathname) {
  const match = /^\/api\/desk\/switch\/targets\/([^/]+)\/strategies$/.exec(pathname);
  if (!match) return null;
  let id;
  try { id = decodeURIComponent(match[1]); }
  catch { return null; }
  return /^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(id) ? id : null;
}

function modes(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(mode => MODES.includes(mode)))].sort();
}

/** Stable fingerprint of the public projection; not a Git commit or runtime version. */
export async function catalogFingerprint({ targetId, platform, supportedDomains, domain, rows }) {
  const material = {
    source_schema: FINGERPRINT_SOURCE,
    target_id: targetId,
    platform,
    domain,
    constraints: { supported_domains: [...supportedDomains].sort() },
    profiles: [...rows].sort((a, b) => a.profile.localeCompare(b.profile)).map(row => ({
      profile: row.profile,
      label: row.label,
      domain: row.domain,
      lifecycle_stage: row.lifecycle_stage,
      allowed_execution_modes: modes(row.allowed_execution_modes),
      eligibility: row.eligibility.status === "known" ? row.eligibility.value : null,
      reason: row.reason,
    })),
  };
  return { kind: "projection_fingerprint", algorithm: "sha256", value: await sha256Hex(canonicalJson(material)) };
}

export async function switchStrategiesProjection({ targetId, config, profiles, domainsFor, eligibilityFor, readAt }) {
  const target = readbackTargets(config).find(item => item.id === targetId);
  if (!target) throw new DeskError("not_found", 404);
  const option = target.config || {};
  let supported;
  try { supported = domainsFor(target.platform, option); }
  catch { supported = null; }
  const domains = Array.isArray(supported) ? [...new Set(supported.filter(item => typeof item === "string"))].sort() : null;
  const domain = domains === null ? unknown("read_failed", coverage("unavailable", 0, 1, ["read_failed"]))
    : domains.length === 1 ? known(domains[0], readAt, coverage("complete", 1, 1))
    // No domain, or several: never pick the first one.
    : unknown(domains.length ? "not_supported" : "source_unavailable",
      coverage("unavailable", 0, 1, [domains.length ? "not_supported" : "source_unavailable"]));
  if (!Array.isArray(profiles)) {
    return {
      target_id: target.id, domain, switchable: { allowed: false, reason_code: "switch_not_connected" },
      catalog_revision: unknown("read_failed", coverage("unavailable", 0, null, ["read_failed"])),
      strategies: unknown("read_failed", coverage("unavailable", 0, null, ["read_failed"])),
    };
  }
  let unknownRows = 0;
  const rows = profiles.filter(profile => profile && typeof profile.profile === "string").map(profile => {
    let verdict = null;
    if (domains !== null) {
      try { verdict = eligibilityFor(target.platform, option, profile, profiles, domains); }
      catch { verdict = null; }
    }
    const value = ["eligible", "no_live", "blocked"].includes(verdict?.value) ? verdict.value : null;
    const reason = value && value !== "eligible" && REASONS.has(verdict.reason) ? verdict.reason : null;
    if (value === null) unknownRows += 1;
    return {
      profile: profile.profile,
      label: typeof profile.label === "string" && profile.label ? profile.label : profile.profile,
      domain: typeof profile.domain === "string" ? profile.domain : "unknown",
      allowed_execution_modes: modes(profile.allowed_execution_modes),
      lifecycle_stage: typeof profile.lifecycle_stage === "string" && profile.lifecycle_stage ? profile.lifecycle_stage : "research_active",
      eligibility: value === null
        ? unknown(domains === null ? "read_failed" : "not_supported", coverage("unavailable", 0, 1, [domains === null ? "read_failed" : "not_supported"]))
        : known(value, readAt, coverage("complete", 1, 1)),
      reason,
    };
  }).sort((a, b) => a.profile.localeCompare(b.profile));
  const total = rows.length;
  const strategies = total === 0
    ? known([], readAt, coverage("verified_empty", 0, 0))
    : unknownRows === 0 ? known(rows, readAt, coverage("complete", total, total))
      : partial(rows, readAt, coverage("partial", total - unknownRows, total, ["coverage_incomplete"]));
  const catalog_revision = strategies.status === "known" && domain.status === "known"
    ? known(await catalogFingerprint({ targetId: target.id, platform: target.platform, supportedDomains: domains, domain: domain.value, rows }),
      readAt, coverage("complete", 1, 1))
    : unknown("coverage_incomplete", coverage("unavailable", 0, 1, ["coverage_incomplete"]));
  return {
    target_id: target.id,
    domain,
    switchable: { allowed: false, reason_code: "switch_not_connected" },
    catalog_revision,
    strategies,
  };
}

export async function deskSwitchStrategiesResponse(request, env, deps) {
  return n1Route(request, env, deps, async (url) => {
    const targetId = switchStrategiesTargetId(url.pathname);
    if (!targetId) throw new DeskError("not_found", 404);
    if ([...url.searchParams.keys()].length) throw new DeskError("invalid_query", 400);
    const now = deps.now();
    const config = await readOnce(() => deps.options(env));
    // The target list itself is configuration; without it no target can be proven.
    if (!config.ok || !config.value?.options || typeof config.value.options !== "object") throw new DeskError("read_failed", 502);
    const profiles = await readOnce(() => deps.profiles(env));
    const body = await switchStrategiesProjection({
      targetId, config: config.value, profiles: profiles.ok ? profiles.value : null,
      domainsFor: deps.domains, eligibilityFor: deps.eligibility, readAt: now,
    });
    return n1Response("switch_strategies", {
      time_basis: timeBasis("UTC", [["account_options", "UTC"], ["strategy_catalog", "UTC"]]),
      ...body,
    }, { now });
  });
}
