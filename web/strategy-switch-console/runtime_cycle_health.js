// Compact source attestations only; no broker evidence or execution authority.
export class CycleHealthError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
const fail = (code, status) => { throw new CycleHealthError(code, status); };
const HEX = /^[a-f0-9]{64}$/;
const SUCCESS = new Set(["no_action", "no_signal", "no_rebalance", "not_due", "filled"]);
const REASONS = {
  not_due: ["no_cron_on_business_date", "before_schedule"],
  market_closed: ["market_closed"], outside_window: ["outside_expected_window"],
  within_grace: ["publication_grace_open"], due: ["publication_grace_ended"],
  unevaluable: ["missing_timezone", "invalid_timezone", "missing_schedule", "invalid_schedule", "missing_market_calendar", "market_calendar_unavailable"],
};
function fields(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== names.length || names.some(k => !Object.hasOwn(value, k))) fail("cycle_health_invalid_fields");
  return value;
}
export function canonicalCycleJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalCycleJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalCycleJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function cycleHealthSha256(value) {
  const bytes = new TextEncoder().encode(canonicalCycleJson(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
}
export function normalizeCycleInstant(value) {
  // Python datetime.isoformat(): seconds, or precisely six nonzero microseconds.
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{6})?Z$/.test(value)
    || value.slice(0, 4) === "0000" || value.endsWith(".000000Z")) fail("cycle_health_invalid_instant");
  const seconds = value.slice(0, 19);
  const ms = Date.parse(`${seconds}Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== seconds) fail("cycle_health_invalid_instant");
  return value;
}
function instantKey(value) { normalizeCycleInstant(value); return `${value.slice(0, 19)}.${value.length === 20 ? "000000" : value.slice(20, 26)}Z`; }
export function compareCycleInstants(a, b) { const x = instantKey(a), y = instantKey(b); return x < y ? -1 : x > y ? 1 : 0; }
export function cycleCoverageComplete(c, { since = null, through = null } = {}) {
  fields(c, ["from", "through", "listed_count", "read_count", "terminal_page_seen", "limit_hit", "errors_present"]);
  normalizeCycleInstant(c.from); normalizeCycleInstant(c.through);
  if (compareCycleInstants(c.from, c.through) > 0
    || [c.listed_count, c.read_count].some(n => !Number.isSafeInteger(n) || n < 0)
    // LB can detect a cap on one final bounded page (20 prior + 21 items).
    || c.listed_count > 41 || c.read_count > 20
    || c.read_count > c.listed_count
    || [c.terminal_page_seen, c.limit_hit, c.errors_present].some(b => typeof b !== "boolean")) fail("cycle_health_invalid_coverage");
  return c.terminal_page_seen && !c.limit_hit && !c.errors_present && c.listed_count === c.read_count && c.listed_count <= 20
    && (since === null || compareCycleInstants(c.from, since) <= 0)
    && (through === null || compareCycleInstants(c.through, through) >= 0);
}
export async function normalizeCycleHealth(raw, { target_id, source_binding_id, observed_at }) {
  const h = fields(raw, ["schema_version", "configuration_sha256", "schedule", "coverage", "cycles", "resolutions"]);
  if (h.schema_version !== "qsl.runtime_cycle_health.v1" || typeof h.configuration_sha256 !== "string" || !HEX.test(h.configuration_sha256)
    || typeof source_binding_id !== "string" || !HEX.test(source_binding_id)) fail("cycle_health_invalid_identity");
  normalizeCycleInstant(observed_at);
  if (!Array.isArray(h.resolutions) || h.resolutions.length) fail("cycle_health_resolutions_not_admitted", 409);
  if (!Array.isArray(h.cycles) || h.cycles.length > 20) fail("cycle_health_cycle_limit");
  const s = fields(h.schedule, ["state", "reason", "timezone", "latest_due_at", "next_due_at", "deadline_at"]);
  if (typeof s.state !== "string" || !Object.hasOwn(REASONS, s.state) || !REASONS[s.state].includes(s.reason)) fail("cycle_health_invalid_schedule");
  const unavailableZone = s.state === "unevaluable" && ["missing_timezone", "invalid_timezone"].includes(s.reason);
  if (s.timezone === null) { if (!unavailableZone) fail("cycle_health_invalid_timezone"); }
  else {
    if (typeof s.timezone !== "string" || !/^[A-Za-z0-9_+\-/]{1,128}$/.test(s.timezone)) fail("cycle_health_invalid_timezone");
    try { new Intl.DateTimeFormat("en", { timeZone: s.timezone }); } catch { fail("cycle_health_invalid_timezone"); }
    if (unavailableZone) fail("cycle_health_invalid_timezone");
  }
  for (const k of ["latest_due_at", "next_due_at", "deadline_at"]) if (s[k] !== null) normalizeCycleInstant(s[k]);
  if ((s.latest_due_at !== null && compareCycleInstants(s.latest_due_at, observed_at) > 0)
    || (s.next_due_at !== null && compareCycleInstants(s.next_due_at, observed_at) <= 0)
    || (s.deadline_at !== null && s.latest_due_at !== null && compareCycleInstants(s.deadline_at, s.latest_due_at) < 0)) fail("cycle_health_schedule_chronology");
  cycleCoverageComplete(h.coverage);
  if (h.coverage.through !== observed_at) fail("cycle_health_cutoff_mismatch");
  const receipts = new Map(), unique = new Map();
  for (const rawCycle of h.cycles) {
    const c = fields(rawCycle, ["cycle_id", "scheduled_for", "receipt_ref", "completed_at", "outcome", "execution_state", "correlation"]);
    normalizeCycleInstant(c.scheduled_for);
    if (compareCycleInstants(c.scheduled_for, observed_at) > 0) fail("cycle_health_future_cycle");
    const id = `cycle.${await cycleHealthSha256([target_id, source_binding_id, h.configuration_sha256, c.scheduled_for])}`;
    if (c.cycle_id !== id) fail("cycle_health_cycle_id_mismatch");
    if (!["explicit", "window_matched", "unconfirmed"].includes(c.correlation)) fail("cycle_health_invalid_correlation");
    if (c.outcome === "missing_report") {
      if (c.receipt_ref !== null || c.completed_at !== null || c.execution_state !== "unresolved" || c.correlation !== "unconfirmed"
        || !cycleCoverageComplete(h.coverage, { since: c.scheduled_for })
        || s.state !== "due" || s.deadline_at === null || s.latest_due_at === null
        || compareCycleInstants(c.scheduled_for, s.latest_due_at) > 0 || compareCycleInstants(s.deadline_at, observed_at) > 0) fail("cycle_health_invalid_missing_report");
    } else {
      if (typeof c.receipt_ref !== "string" || !/^execution-receipt\.[a-f0-9]{32}$/.test(c.receipt_ref)) fail("cycle_health_invalid_receipt");
      normalizeCycleInstant(c.completed_at);
      if (compareCycleInstants(c.completed_at, c.scheduled_for) < 0 || compareCycleInstants(c.completed_at, observed_at) > 0) fail("cycle_health_completion_chronology");
      const expected = c.outcome === "failed" ? ["no_submission", "unresolved"]
        : c.outcome === "filled" ? ["terminal_confirmed"]
        : SUCCESS.has(c.outcome) || c.outcome === "risk_blocked" ? ["no_submission"]
        : ["submitted", "broker_acknowledged", "partially_filled", "reconciliation_required"].includes(c.outcome) ? ["unresolved"] : [];
      if (!expected.includes(c.execution_state)) fail("cycle_health_outcome_certainty_mismatch");
      const bytes = canonicalCycleJson(c);
      if (receipts.has(c.receipt_ref) && receipts.get(c.receipt_ref) !== bytes) fail("cycle_health_receipt_conflict", 409);
      receipts.set(c.receipt_ref, bytes);
    }
    unique.set(canonicalCycleJson(c), structuredClone(c));
  }
  return { ...structuredClone(h), cycles: [...unique.values()] };
}
function category(c) { return c.execution_state === "unresolved" || c.outcome === "missing_report" ? "execution_uncertainty" : SUCCESS.has(c.outcome) ? null : "operational"; }
const faultTime = c => c.completed_at || c.scheduled_for;
const attemptKey = c => c.receipt_ref || `missing:${c.cycle_id}`;
export function reduceCycleCheckpoint(context, health, previous = null) {
  // Configuration provenance is per attempt; changes never filter fault history.
  const state = previous ? structuredClone(previous) : { target_id: context.target_id, source_binding_id: context.source_binding_id, incidents: [] };
  if (state.target_id !== context.target_id || state.source_binding_id !== context.source_binding_id) fail("cycle_health_binding_changed_unconfirmed", 409);
  for (const c of health.cycles) {
    // Stable receipts cannot be reinterpreted, including fault -> success.
    for (const item of state.incidents) for (const a of item.fault_attempts) {
      if (attemptKey(a.cycle) === attemptKey(c) && canonicalCycleJson(a.cycle) !== canonicalCycleJson(c)) fail("cycle_health_fault_receipt_conflict", 409);
    }
    if (category(c) === null) continue;
    let item = state.incidents.find(i => i.cycle.cycle_id === c.cycle_id);
    if (!item) { item = { cycle: structuredClone(c), fault_attempts: [], resolution_history: [] }; state.incidents.push(item); }
    if (!item.fault_attempts.some(a => attemptKey(a.cycle) === attemptKey(c))) item.fault_attempts.push({ cycle: structuredClone(c), configuration_sha256: health.configuration_sha256, resolution_ref: null });
    if (item.fault_attempts.length > 20 || state.incidents.length > 20) fail("cycle_health_history_capacity_requires_support", 409);
  }
  for (const item of state.incidents) {
    if (!item.fault_attempts?.length || !Array.isArray(item.resolution_history)) fail("cycle_health_checkpoint_invalid", 409);
    item.fault_attempts.sort((a, b) => compareCycleInstants(faultTime(a.cycle), faultTime(b.cycle)) || attemptKey(a.cycle).localeCompare(attemptKey(b.cycle)));
    const ordered = [...item.fault_attempts].sort((a, b) => Number(category(a.cycle) === "execution_uncertainty") - Number(category(b.cycle) === "execution_uncertainty") || compareCycleInstants(faultTime(a.cycle), faultTime(b.cycle)) || attemptKey(a.cycle).localeCompare(attemptKey(b.cycle)));
    item.cycle = structuredClone(ordered.at(-1).cycle);
    item.category = category(item.cycle);
    item.latest_fault_at = faultTime(item.fault_attempts.at(-1).cycle);
    const active = item.fault_attempts.filter(a => a.resolution_ref === null);
    item.active_category = active.some(a => category(a.cycle) === "execution_uncertainty") ? "execution_uncertainty" : active.length ? "operational" : null;
    item.resolution = active.length ? null : item.resolution_history.at(-1) || null;
  }
  state.unresolved_count = state.incidents.filter(i => i.active_category !== null).length;
  state.execution_authority_granted = false;
  return state;
}
