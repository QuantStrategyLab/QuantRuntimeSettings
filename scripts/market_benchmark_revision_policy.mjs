/**
 * Benchmark history revision policy (default-off, pure, no I/O).
 *
 * Default policy is "frozen": a stored (seriesId, observationDate) close is
 * immutable. Any candidate that differs from stored history blocks the WHOLE
 * batch (no partial POST of the "new" keys, no filtering of conflicts, no
 * overwrite, no delete). The receiver's 409 history-consistency protection is
 * unchanged; this module only decides what a producer may propose.
 *
 * Opt-in policy "revision_proposal" (MARKET_BENCHMARK_REVISION_POLICY) still
 * performs no write. It emits an append-only, traceable revision proposal
 * (hashes, not prices) that an owner must review and apply through a separate,
 * not-yet-existing revision endpoint. Restoring the scheduled sync is NOT
 * implied by either policy.
 */
import { createHash } from "node:crypto";

export const REVISION_POLICIES = Object.freeze(["frozen", "revision_proposal"]);
export const DEFAULT_REVISION_POLICY = "frozen";
export const REVISION_PROPOSAL_SCHEMA = "qsl.market_benchmark_revision_proposal.v1";
// Owner-approved tolerance: same-source closes within 0.01% are treated as
// consistent. The stored value is kept; the candidate is never posted.
export const PRIMARY_SOURCE = "yahoo_chart_v8";
export const RELATIVE_TOLERANCE = "0.0001";

function decimalParts(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("benchmark_close_not_decimal");
  const [i, f = ""] = text.split(".");
  return { digits: BigInt(i + f), scale: f.length };
}

/** Exact decimal check: |candidate - stored| <= tolerance * stored (inclusive). */
export function withinRelativeTolerance(stored, candidate, tolerance = RELATIVE_TOLERANCE) {
  const s = decimalParts(stored);
  const c = decimalParts(candidate);
  const t = decimalParts(tolerance);
  if (s.digits <= 0n) return false;
  const scale = Math.max(s.scale, c.scale);
  const sv = s.digits * 10n ** BigInt(scale - s.scale);
  const cv = c.digits * 10n ** BigInt(scale - c.scale);
  const diff = cv > sv ? cv - sv : sv - cv;
  // diff / sv <= t.digits / 10^t.scale  <=>  diff * 10^t.scale <= t.digits * sv
  return diff * 10n ** BigInt(t.scale) <= t.digits * sv;
}

export function resolveRevisionPolicy(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_REVISION_POLICY;
  if (!REVISION_POLICIES.includes(value)) throw new Error("benchmark_revision_policy_invalid");
  return value;
}

const keyOf = (p) => `${p.seriesId}\0${p.observationDate}`;
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

/**
 * @param {Array<{seriesId,observationDate,close,source?}>} candidates normalized
 * @param {Array<{seriesId,observationDate,close}>} stored normalized
 * @param {{policy?: string, detectedAt?: string}} options
 */
export function planBenchmarkRevision(candidates, stored, options = {}) {
  const policy = resolveRevisionPolicy(options.policy);
  const storedMap = new Map();
  for (const p of stored) {
    if (storedMap.has(keyOf(p))) throw new Error("benchmark_stored_duplicate_key");
    storedMap.set(keyOf(p), p);
  }
  const cand = new Map();
  for (const p of candidates) {
    const prior = cand.get(keyOf(p));
    if (prior && prior.close !== p.close) throw new Error("benchmark_candidate_conflicting_key");
    cand.set(keyOf(p), p);
  }
  const tolerance = options.relativeTolerance ?? null;
  const primarySource = options.primarySource ?? PRIMARY_SOURCE;
  const identical = [];
  const unseen = [];
  const tolerated = [];
  const differing = [];
  for (const [k, p] of cand) {
    const s = storedMap.get(k);
    if (!s) unseen.push(p);
    else if (s.close === p.close) identical.push(p);
    else if (tolerance !== null && p.source === primarySource
        && withinRelativeTolerance(s.close, p.close, tolerance)) tolerated.push(p);
    else differing.push({ stored: s, candidate: p });
  }
  const blocked = differing.length > 0;
  const plan = {
    policy,
    post_allowed: !blocked,
    post_points: blocked ? 0 : unseen.length + identical.length,
    identical_keys: identical.length,
    unseen_keys: unseen.length,
    tolerated_keys: tolerated.length,
    differing_keys: differing.length,
    deletes: 0,
    overwrites: 0,
    block_reason: blocked ? "frozen_history_conflict" : null,
    revision_proposal: null,
  };
  // Tolerated keys keep the stored close and are never sent (no overwrite).
  Object.defineProperty(plan, "post_candidates", {
    value: blocked ? [] : [...unseen, ...identical], enumerable: false,
  });
  if (blocked && policy === "revision_proposal") {
    if (!options.detectedAt || Number.isNaN(Date.parse(options.detectedAt))) {
      throw new Error("benchmark_revision_detected_at_required");
    }
    const entries = differing
      .map(({ stored: s, candidate: c }) => ({
        series_id_sha256: digest(s.seriesId),
        observation_date: s.observationDate,
        prior_close_sha256: digest(s.close),
        candidate_close_sha256: digest(c.close),
        candidate_source: c.source || "unknown",
        reason: "upstream_revision_unverified",
      }))
      .sort((a, b) => (a.series_id_sha256 + a.observation_date).localeCompare(b.series_id_sha256 + b.observation_date));
    plan.revision_proposal = {
      schema_version: REVISION_PROPOSAL_SCHEMA,
      detected_at: options.detectedAt,
      status: "pending_owner_review",
      applied: false,
      append_only: true,
      entries,
      proposal_sha256: digest(JSON.stringify(entries)),
    };
  }
  return plan;
}
