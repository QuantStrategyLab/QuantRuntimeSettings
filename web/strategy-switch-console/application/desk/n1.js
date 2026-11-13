// N1 local read/time/version helpers for the five Desk read projections
// (docs/desk-n1-read-projection-contract.md). These helpers are local to the
// v2 responses: the global v1 Read/Mode definitions and deskResponse() stay
// untouched, and nothing here reads a source, writes state or calls a provider.
import { DeskError, deskJson, deskErrorResponse } from "./http.js";

export const N1_REASONS = Object.freeze([
  "never_read", "read_failed", "source_unavailable", "identity_unverified", "not_supported",
  "insufficient_history", "coverage_incomplete", "mixed_currency", "time_basis_unavailable",
]);
const reasonSet = new Set(N1_REASONS);
const DAY_MS = 86_400_000;

function reasonList(reasons) {
  const list = [...new Set((reasons || []).filter(reason => reasonSet.has(reason)))].sort();
  if (list.length !== (new Set(reasons || [])).size) throw new TypeError("invalid n1 reason");
  return list;
}

/** Coverage counts evidenced sources/identities; an unknown total stays null. */
export function coverage(state, included, total, reasons = []) {
  if (!["complete", "partial", "unavailable", "verified_empty"].includes(state)) throw new TypeError("invalid n1 coverage");
  if (!Number.isSafeInteger(included) || included < 0) throw new TypeError("invalid n1 coverage");
  if (total !== null && (!Number.isSafeInteger(total) || total < included)) throw new TypeError("invalid n1 coverage");
  return { state, included, total, reasons: reasonList(reasons) };
}

/** Instant normalization: an offset is honoured, never dropped; no zone is rejected. */
export function utcInstant(value) {
  // A trusted clock reading (epoch milliseconds) is an instant; so is a valid Date.
  if (typeof value === "number") return Number.isFinite(value) ? utcInstant(new Date(value)) : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().replace(/\.000Z$/, "Z") : null;
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  if (!validDate(value.slice(0, 10))) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.000Z$/, "Z") : null;
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Business date of `now` in an IANA time zone. */
export function zonedDate(now, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export function known(value, observedAt, cover) {
  const at = utcInstant(observedAt);
  if (value === undefined || at === null) return unknown("time_basis_unavailable", coverage("unavailable", 0, cover?.total ?? null));
  if (!["complete", "verified_empty"].includes(cover.state)) throw new TypeError("known read requires complete coverage");
  return { status: "known", value, observed_at: at, coverage: cover };
}

export function stale(value, observedAt, now, cover) {
  const at = utcInstant(observedAt);
  if (value === undefined || at === null) return unknown("time_basis_unavailable", coverage("unavailable", 0, cover?.total ?? null));
  return { status: "stale", value, observed_at: at, age_seconds: Math.max(0, Math.floor((Number(now) - Date.parse(at)) / 1000)), coverage: cover };
}

export function partial(value, observedAt, cover) {
  const at = utcInstant(observedAt);
  if (value === undefined || at === null) return unknown("time_basis_unavailable", coverage("unavailable", 0, cover?.total ?? null));
  if (cover.state !== "partial") throw new TypeError("partial read requires partial coverage");
  return { status: "partial", value, observed_at: at, coverage: cover };
}

/** An unknown read never carries a value key. */
export function unknown(reason, cover = coverage("unavailable", 0, null, [])) {
  if (!reasonSet.has(reason)) throw new TypeError("invalid n1 reason");
  if (!["unavailable", "partial"].includes(cover.state)) throw new TypeError("unknown read coverage");
  return { status: "unknown", reason, observed_at: null, coverage: cover };
}

export const notSupported = () => unknown("not_supported", coverage("unavailable", 0, null, ["not_supported"]));

/** Fixed source keys only; no account, URL or environment value. */
export function timeBasis(viewTimezone, domains) {
  const seen = new Map();
  for (const [source_key, timezone] of domains) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(source_key) || typeof timezone !== "string") throw new TypeError("invalid time basis");
    seen.set(source_key, timezone);
  }
  return { view_timezone: viewTimezone, source_domains: [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([source_key, timezone]) => ({ source_key, timezone })) };
}

/** Freshness from the oldest displayed source observation, never generated_at. */
export function freshness(observedTimes, { now, ttlSeconds, staleKnown = false }) {
  const times = observedTimes.map(utcInstant);
  if (!times.length || times.some(time => time === null)) return { data_status: "unavailable", age_seconds: null };
  const oldest = Math.min(...times.map(time => Date.parse(time)));
  if (oldest > Number(now) + 300_000) return { data_status: "unavailable", age_seconds: null };
  const age = Math.max(0, Math.floor((Number(now) - oldest) / 1000));
  return { data_status: staleKnown || age > ttlSeconds ? "stale" : "ready", age_seconds: age };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function n1Response(name, payload, { now }) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new TypeError("invalid desk schema name");
  return deskJson({ ok: true, schema_version: `qsl.desk.${name}.v2`, generated_at: utcInstant(new Date(Number(now))), ...payload });
}

/** Shared GET-only route frame: method gate, existing desk auth, safe errors. */
export async function n1Route(request, env, deps, handler) {
  try {
    if (request.method !== "GET") throw new DeskError("not_found", 404);
    await deps.auth(request, env);
    return await handler(new URL(request.url));
  } catch (error) {
    return deskErrorResponse(error);
  }
}

/** Run one source read; any exception becomes a fixed failure marker. */
export async function readOnce(source) {
  try { return { ok: true, value: await source() }; }
  catch { return { ok: false }; }
}
