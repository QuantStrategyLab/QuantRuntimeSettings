// Registered live readback of the per-physical-account management setting
// (`qsl_account_management_readback.v1`). It is composed from one coherent
// synchronous read of the RuntimeInstances SQLite store: the same snapshot
// supplies the instance revision, the policy revision, the status of every
// physical group and the applied-row export. Its evidence scope is
// `runtime_instances_sqlite`; it is not the #1173 full projection
// (`qsl_account_management_projection.v1`) and never claims its completeness.
//
// The read is physically read-only: it runs through a facade that admits
// SELECT statements only, it is dispatched before storage initialization, and
// on missing tables or state it reports unavailable/unknown. It never
// initializes, caches or repairs anything. Drafts never enter this envelope.
import { MANAGEMENT_READBACK_FORMAT, deploymentManagement } from "../account_mapping/management_cohort.js";
import { deploymentId, MANAGEMENT_STATUS } from "../account_mapping/policy.js";
import { responseHeaders } from "../http_response.js";
import {
  MANAGEMENT_EVIDENCE_SCOPE,
  membershipOf,
  processingDenial,
  readManagementSnapshot,
  resolveManagement,
  storedPolicy,
} from "./account_management.js";

export { MANAGEMENT_READBACK_FORMAT, deploymentManagement };
export const MANAGEMENT_EFFECTIVE_EXPORT_FORMAT = "qsl_account_management_effective_export.v1";
export const MANAGEMENT_ROUTE = "/api/admin/account-management";
export const MANAGEMENT_READ_DO_PATH = "/internal/account-management-read";
export const MANAGEMENT_READ_ACTION = "account_management_read";
export const MANAGEMENT_READ_FIELDS = Object.freeze(["action"]);
const REQUEST_BYTE_LIMIT = 1024;

// The only storage surface the read can reach: SELECT statements, nothing else.
export function managementReadCapability(storage) {
  const sql = storage.sql;
  return Object.freeze({
    sql: Object.freeze({
      exec(statement, ...bindings) {
        if (typeof statement !== "string" || !/^\s*SELECT\b/i.test(statement) || statement.includes(";")) throw new Error("statement_not_allowed");
        return sql.exec(statement, ...bindings);
      },
    }),
  });
}

function readState(sql) {
  let row;
  try { row = sql.exec("SELECT revision, payload FROM instance_state WHERE id = 1").toArray()[0]; } catch { return { reason: "runtime_instances_state_unreadable" }; }
  if (!row) return { reason: "runtime_instances_not_initialized" };
  try {
    const instances = JSON.parse(row.payload);
    if (!Array.isArray(instances) || !Number.isSafeInteger(row.revision)) return { reason: "runtime_instances_state_unreadable" };
    return { state: { revision: row.revision, instances, initialized: true } };
  } catch { return { reason: "runtime_instances_state_unreadable" }; }
}

const EMPTY_COUNTS = Object.freeze({
  physical_accounts: null, display_deployments: null, uncovered_deployments: null,
  managed: null, management_disabled: null, not_under_management: null, unknown: null,
});

function unavailable(reason, observedAt) {
  return {
    ok: true, format: MANAGEMENT_READBACK_FORMAT, evidence_scope: MANAGEMENT_EVIDENCE_SCOPE, status: "unavailable",
    reasons: [reason], observed_at: observedAt, instance_revision: null, policy_revision: null, policy_status: "unknown",
    physical_grouping_complete: false, counts: { ...EMPTY_COUNTS }, groups: [], uncovered_deployments: [],
    effective_export: { format: MANAGEMENT_EFFECTIVE_EXPORT_FORMAT, instance_revision: null, policy_revision: null, records: [] },
  };
}

// The trusted adapter: current persisted applied rows in B1's exact
// five-field effective-record shape. Metadata columns are never forwarded; a
// stored boolean that is not 0/1 stays raw so the strict parser rejects it.
export function exportAppliedRecords(applied) {
  return applied.map(row => ({
    platform: row.platform, legacy_key: row.account_key,
    management_enabled: row.management_enabled === 1 ? true : row.management_enabled === 0 ? false : row.management_enabled,
    revision: row.revision, effective_at: row.effective_at,
  }));
}

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function scopeOf(members) {
  const environments = new Set(members.map(item => item.identity?.broker_environment ?? null));
  if (environments.size !== 1) return "unknown";
  const [environment] = environments;
  return environment === "paper" || environment === "live" ? environment : "unknown";
}

function present(state, item) {
  return state.instances.some(candidate => candidate?.kind === "existing" && candidate.platform === item.platform && candidate.key === item.legacy_key);
}

// The envelope for the object's current persisted state. `sql` must be the
// read-only facade; nothing here writes.
export function buildManagementReadback(sql, observedAt) {
  const read = readState(sql);
  if (!read.state) return unavailable(read.reason, observedAt);
  const { state } = read;
  const snapshot = readManagementSnapshot(sql, state);
  const parsed = storedPolicy(snapshot.policy);
  const current = state.instances.filter(item => item?.kind === "existing" && typeof item.platform === "string" && typeof item.key === "string");
  const effectiveExport = { format: MANAGEMENT_EFFECTIVE_EXPORT_FORMAT, instance_revision: state.revision,
    policy_revision: parsed.policy?.policy_revision ?? null, records: exportAppliedRecords(snapshot.applied) };
  // The typed denial an admission would raise: a missing or invalid policy is named as such.
  const uncoveredEntry = (item, reasons) => ({
    platform: item.platform, key: item.key, management_status: MANAGEMENT_STATUS.UNKNOWN, evidence_state: "unknown",
    reasons, processing_eligible: false,
    processing_denial: reasons.find(reason => reason.startsWith("management_policy_")) || "management_status_unknown",
  });
  const base = {
    ok: true, format: MANAGEMENT_READBACK_FORMAT, evidence_scope: MANAGEMENT_EVIDENCE_SCOPE, status: "available", reasons: snapshot.unreadable.length ? ["local_store_unreadable"] : [],
    observed_at: observedAt, instance_revision: state.revision, effective_export: effectiveExport,
  };
  const ordered = [...current].sort((left, right) => compare(deploymentId(left.platform, left.key), deploymentId(right.platform, right.key)));
  if (parsed.reason) {
    // Physical grouping is unavailable: every discoverable deployment stays visible, unknown.
    return {
      ...base, reasons: [...new Set([...base.reasons, parsed.reason])].sort(), policy_revision: null,
      policy_status: parsed.reason === "management_policy_unavailable" ? "unavailable" : "invalid", physical_grouping_complete: false,
      counts: { ...EMPTY_COUNTS, display_deployments: ordered.length, uncovered_deployments: ordered.length },
      groups: [], uncovered_deployments: ordered.map(item => uncoveredEntry(item, [parsed.reason])),
    };
  }
  const { policy } = parsed;
  const claimed = new Set();
  const groups = policy.accounts.map(account => {
    const members = membershipOf(account.deployments);
    for (const item of members) claimed.add(deploymentId(item.platform, item.legacy_key));
    const [first] = members;
    const resolution = resolveManagement(snapshot, first.platform, first.legacy_key);
    return {
      management_class: account.management_class, management_status: resolution.management_status, evidence_state: resolution.evidence_state,
      reasons: resolution.reasons, scope: scopeOf(members), processing_eligible: resolution.processing_eligible,
      processing_denial: processingDenial(resolution),
      applied: resolution.applied ? { management_enabled: resolution.applied.management_enabled === true, revision: resolution.applied.revision, effective_at: resolution.applied.effective_at } : null,
      deployments: members.map(item => ({ platform: item.platform, key: item.legacy_key, present: present(state, item) })),
    };
  }).sort((left, right) => compare(JSON.stringify(left.deployments), JSON.stringify(right.deployments)));
  const uncovered = ordered.filter(item => !claimed.has(deploymentId(item.platform, item.key))).map(item => uncoveredEntry(item, ["deployment_unclassified"]));
  const multiple = groups.some(group => group.reasons.includes("deployment_claimed_by_multiple_accounts"));
  const complete = uncovered.length === 0 && !multiple;
  const count = status => groups.filter(group => group.management_status === status).length;
  return {
    ...base, policy_revision: policy.policy_revision, policy_status: "available", physical_grouping_complete: complete,
    counts: {
      physical_accounts: complete ? groups.length : null, display_deployments: ordered.length, uncovered_deployments: uncovered.length,
      managed: count(MANAGEMENT_STATUS.MANAGED), management_disabled: count(MANAGEMENT_STATUS.DISABLED),
      not_under_management: count(MANAGEMENT_STATUS.NOT_UNDER_MANAGEMENT), unknown: count(MANAGEMENT_STATUS.UNKNOWN),
    },
    groups, uncovered_deployments: uncovered,
  };
}

const respond = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
});

// RuntimeInstances.fetch preamble delegate for the fixed read path, served
// before storage initialization.
export async function managementReadResponse(request, cap) {
  if (request.method !== "POST") return respond({ ok: false, error: "method_not_allowed" }, 405);
  let command;
  try {
    const text = await request.text();
    if (text.length > REQUEST_BYTE_LIMIT) return respond({ ok: false, error: "management_read_invalid" }, 400);
    command = JSON.parse(text);
  } catch { return respond({ ok: false, error: "management_read_invalid" }, 400); }
  if (!command || typeof command !== "object" || Array.isArray(command) || Object.keys(command).length !== 1 || command.action !== MANAGEMENT_READ_ACTION) {
    return respond({ ok: false, error: "management_read_invalid" }, 400);
  }
  try { return respond(buildManagementReadback(cap.sql, new Date().toISOString())); } catch { return respond({ ok: false, error: "management_read_failed" }, 500); }
}

// The Worker's one fetch of the object's live readback, or null when the
// object is unbound or unreadable. Advisory callers treat null as unknown.
export async function fetchManagementReadback(env) {
  const namespace = env?.STRATEGY_SWITCH_RUNTIME_INSTANCES;
  if (!namespace?.idFromName || !namespace?.get) return null;
  try {
    const response = await namespace.get(namespace.idFromName("runtime-instances")).fetch(`https://runtime-instances${MANAGEMENT_READ_DO_PATH}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: MANAGEMENT_READ_ACTION }),
    });
    const body = await response.json();
    return response.ok && body?.format === MANAGEMENT_READBACK_FORMAT ? body : null;
  } catch { return null; }
}

const publicRespond = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: responseHeaders({
  "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", ...extra,
}) });

// GET /api/admin/account-management: authenticated admin read. It accepts no
// caller authority input and has no provisioning side effect.
export async function accountManagementReadResponse(request, env, { readSession }) {
  if (request.method !== "GET") return publicRespond({ ok: false, error: "method_not_allowed" }, 405, { Allow: "GET" });
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].length) return publicRespond({ ok: false, error: "management_read_invalid" }, 400);
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if ((origin && origin !== url.origin) || (site && !["same-origin", "none"].includes(site))) return publicRespond({ ok: false, error: "cross_origin_rejected" }, 403);
  let session = null;
  try { session = await readSession(request, env); } catch { session = null; }
  if (!session) return publicRespond({ ok: false, error: "login_required" }, 401);
  if (!session.admin) return publicRespond({ ok: false, error: "admin_required" }, 403);
  if (!env?.STRATEGY_SWITCH_RUNTIME_INSTANCES) return publicRespond({ ok: false, error: "runtime_instances_not_bound" }, 503);
  const readback = await fetchManagementReadback(env);
  if (!readback) return publicRespond({ ok: false, error: "management_read_failed" }, 503);
  return publicRespond(readback);
}
