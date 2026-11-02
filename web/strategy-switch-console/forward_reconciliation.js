// Informational metadata only; no ledger, storage, transport or control imports.
export const FORWARD_RECONCILIATION_SCHEMA = "qsl.forward_reconciliation_read.v1";
const START = "2026-11-03";
const ZONES = new Set(["UTC", "America/New_York", "Asia/Hong_Kong", "Asia/Singapore"]);
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw new Error("invalid_forward_reconciliation_evidence"); };

// Preserve the native spelling and offset, but reject Date.parse normalization.
function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)) invalid();
  const local = value.slice(0, 19), localMs = Date.parse(`${local}Z`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || !Number.isFinite(localMs)
      || new Date(localMs).toISOString().slice(0, 19) !== local
      || /[+-]14:(?!00)/.test(value)) invalid();
  return ms;
}

function snapshot(value, now) {
  if (value === null) return null;
  if (!exact(value, ["source_as_of", "timezone", "capture_started_at", "capture_finished_at"])
      || !ZONES.has(value.timezone)) invalid();
  const source = instant(value.source_as_of), start = instant(value.capture_started_at), end = instant(value.capture_finished_at);
  // The explicit native offset must agree with the source timezone at that instant.
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: value.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(source)).map(part => [part.type, part.value]));
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  if (local !== value.source_as_of.slice(0, 19) || local.slice(0, 10) < START
      || source > end || start > end || end > now) invalid();
  return { source_as_of: value.source_as_of, timezone: value.timezone,
    capture_started_at: value.capture_started_at, capture_finished_at: value.capture_finished_at };
}

function notification(value, now) {
  if (value === null) return { status: "unknown", requested_at: null, confirmed_at: null };
  if (!exact(value, ["status", "requested_at", "confirmed_at"]) || !["unknown", "pending", "confirmed"].includes(value.status)) invalid();
  if (value.status === "unknown") {
    if (value.requested_at !== null || value.confirmed_at !== null) invalid();
  } else {
    const requested = instant(value.requested_at);
    // Earliest November 3 boundary among the supported native zones is HK/SG.
    if (requested < Date.parse("2026-11-02T16:00:00Z") || requested > now) invalid();
    if (value.status === "pending") {
      if (value.confirmed_at !== null) invalid();
    } else {
      const confirmed = instant(value.confirmed_at);
      if (confirmed < requested || confirmed > now) invalid();
    }
  }
  return { status: value.status, requested_at: value.requested_at, confirmed_at: value.confirmed_at };
}

// Evidence is supplied only by a separately authenticated, source-bound reader.
// Shape validation cannot establish authenticity. Existing account storage is NOT
// such a source and intentionally invokes this with null. No public write API.
export function projectForwardReconciliation(evidence = null, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) invalid();
  if (evidence !== null && !exact(evidence, ["source", "baseline", "later_anchor", "notification"])) invalid();
  const source = snapshot(evidence === null ? null : evidence.source, now);
  const baseline = snapshot(evidence === null ? null : evidence.baseline, now);
  const later = snapshot(evidence === null ? null : evidence.later_anchor, now);
  if (baseline && baseline.source_as_of.slice(0, 10) !== START) invalid();
  if (later && baseline && instant(later.source_as_of) <= instant(baseline.source_as_of)) invalid();
  if (source && [baseline, later].some(anchor => anchor && instant(anchor.source_as_of) > instant(source.source_as_of))) invalid();
  return {
    schema_version: FORWARD_RECONCILIATION_SCHEMA, informational_only: true,
    generated_at: evidence === null ? null : new Date(now).toISOString(), forward_start_date: START,
    source_status: source === null ? "unknown" : now - instant(source.source_as_of) > 1800000 ? "stale" : "present",
    source, baseline_status: baseline ? "present" : "missing",
    baseline_reason: baseline ? null : "opening_snapshot_missing", baseline, later_anchor: later,
    dimensions: { positions: "UNRECONCILED", cash: "UNRECONCILED", events: "UNRECONCILED" },
    notification: notification(evidence === null ? null : evidence.notification, now),
  };
}
