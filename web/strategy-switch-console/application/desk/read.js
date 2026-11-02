import { ACCOUNT_FACTS_STALE_MS, ACCOUNT_FACTS_FUTURE_SKEW_MS } from "../../account_facts.js";

const reasons = new Set(["never_read", "read_failed", "source_unavailable", "identity_unverified", "not_supported"]);
const millis = (value) => value instanceof Date ? value.getTime()
  : typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;

export function unknown(reason) {
  if (!reasons.has(reason)) throw new TypeError("invalid desk read reason");
  return { status: "unknown", reason };
}

export function classifyAge(observedAt, ttlSeconds = ACCOUNT_FACTS_STALE_MS / 1000, now = Date.now()) {
  const observed = millis(observedAt);
  const current = millis(now);
  if (!Number.isFinite(observed) || !Number.isFinite(current)
    || !Number.isFinite(ttlSeconds) || ttlSeconds < 0
    || observed > current + ACCOUNT_FACTS_FUTURE_SKEW_MS) return unknown("read_failed");
  return { status: current - observed > ttlSeconds * 1000 ? "stale" : "known" };
}

export function known(value, observedAt) {
  const observed = millis(observedAt);
  if (value === undefined || !Number.isFinite(observed)) return unknown("read_failed");
  return { status: "known", value, observed_at: new Date(observed).toISOString() };
}

export function stale(value, observedAt, now = Date.now()) {
  const age = classifyAge(observedAt, 0, now);
  if (age.status === "unknown" || value === undefined) return unknown("read_failed");
  return { ...known(value, observedAt), status: "stale", age_seconds: Math.max(0, Math.floor((millis(now) - millis(observedAt)) / 1000)) };
}

// Wrap each dependency separately; never expose source exception messages.
// source() returns { value, observed_at }, or an explicit unknown Read.
export async function readSource(source, { ttlSeconds = ACCOUNT_FACTS_STALE_MS / 1000, now = Date.now() } = {}) {
  try {
    const result = await source();
    if (result?.status === "unknown") return unknown(result.reason);
    const age = classifyAge(result?.observed_at, ttlSeconds, now);
    if (age.status === "unknown") return age;
    return age.status === "stale" ? stale(result.value, result.observed_at, now) : known(result.value, result.observed_at);
  } catch {
    return unknown("read_failed");
  }
}
