/**
 * Apply an owner-approved market-benchmark revision proposal.
 * Pure: no I/O. Digest is injected so Node and the Worker share one path.
 * Prices never appear in returned ledger rows (hashes only).
 */
export const MARKET_BENCHMARK_REVISION_PATH = "/api/market-benchmark/revision";
export const REVISION_APPLY_SCHEMA = "qsl.market_benchmark_revision_apply.v1";
export const REVISION_LEDGER_SCHEMA = "qsl.market_benchmark_revision_ledger.v1";
export const REVISION_PROPOSAL_SCHEMA = "qsl.market_benchmark_revision_proposal.v1";

export class MarketBenchmarkRevisionError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function keyOf(seriesId, observationDate) {
  return `${seriesId}\0${observationDate}`;
}

/**
 * @param {{
 *   proposal: object,
 *   approvedProposalSha256: string,
 *   replacements: Array<{seriesId,observationDate,close,source?}>,
 *   storedPoints: Array<{seriesId,observationDate,close,source?}>,
 *   digest: (value: string) => string,
 *   appliedAt: string,
 *   previouslyAppliedProposalSha256s?: string[],
 * }} input
 */
export function planRevisionApply(input) {
  const {
    proposal, approvedProposalSha256, replacements, storedPoints, digest, appliedAt,
    previouslyAppliedProposalSha256s = [],
  } = input;
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_proposal_invalid");
  }
  if (proposal.schema_version !== REVISION_PROPOSAL_SCHEMA) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_proposal_schema_invalid");
  }
  if (typeof proposal.proposal_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(proposal.proposal_sha256)) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_proposal_hash_invalid");
  }
  if (typeof approvedProposalSha256 !== "string" || !approvedProposalSha256) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_approval_required", 401);
  }
  if (approvedProposalSha256 !== proposal.proposal_sha256) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_approval_mismatch", 401);
  }
  if (previouslyAppliedProposalSha256s.includes(proposal.proposal_sha256)) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_already_applied", 409);
  }
  if (!Array.isArray(proposal.entries) || proposal.entries.length === 0 || proposal.entries.length > 64) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_entries_invalid");
  }
  if (!Array.isArray(replacements) || replacements.length !== proposal.entries.length) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_replacements_mismatch");
  }
  if (typeof appliedAt !== "string" || Number.isNaN(Date.parse(appliedAt))) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_applied_at_invalid");
  }
  const recomputed = digest(JSON.stringify(proposal.entries));
  if (recomputed !== proposal.proposal_sha256) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_proposal_tampered");
  }

  const stored = new Map();
  for (const point of storedPoints) {
    const key = keyOf(point.seriesId, point.observationDate);
    if (stored.has(key)) throw new MarketBenchmarkRevisionError("benchmark_stored_duplicate_key");
    stored.set(key, point);
  }

  const byEntryKey = new Map();
  for (const entry of proposal.entries) {
    const k = `${entry.series_id_sha256}\0${entry.observation_date}`;
    if (byEntryKey.has(k)) throw new MarketBenchmarkRevisionError("benchmark_revision_duplicate_entry");
    byEntryKey.set(k, entry);
  }

  const updates = [];
  const ledgerEntries = [];
  for (let index = 0; index < replacements.length; index += 1) {
    const replacement = replacements[index];
    if (!replacement || typeof replacement !== "object") {
      throw new MarketBenchmarkRevisionError("benchmark_revision_replacement_invalid");
    }
    const { seriesId, observationDate, close, source } = replacement;
    if (typeof seriesId !== "string" || typeof observationDate !== "string" || typeof close !== "string") {
      throw new MarketBenchmarkRevisionError("benchmark_revision_replacement_invalid");
    }
    const seriesHash = digest(seriesId);
    const entry = byEntryKey.get(`${seriesHash}\0${observationDate}`);
    if (!entry) throw new MarketBenchmarkRevisionError("benchmark_revision_replacement_not_in_proposal");
    const existing = stored.get(keyOf(seriesId, observationDate));
    if (!existing) throw new MarketBenchmarkRevisionError("benchmark_revision_target_missing", 404);
    if (digest(existing.close) !== entry.prior_close_sha256) {
      throw new MarketBenchmarkRevisionError("benchmark_revision_prior_mismatch", 409);
    }
    if (digest(close) !== entry.candidate_close_sha256) {
      throw new MarketBenchmarkRevisionError("benchmark_revision_candidate_mismatch");
    }
    if (close === existing.close) {
      throw new MarketBenchmarkRevisionError("benchmark_revision_noop");
    }
    const nextSource = typeof source === "string" && source ? source : (entry.candidate_source || "yahoo_chart_v8");
    updates.push({
      seriesId,
      observationDate,
      close,
      source: nextSource,
    });
    ledgerEntries.push({
      schema_version: REVISION_LEDGER_SCHEMA,
      proposal_sha256: proposal.proposal_sha256,
      entry_index: index,
      series_id_sha256: entry.series_id_sha256,
      observation_date: observationDate,
      prior_close_sha256: entry.prior_close_sha256,
      new_close_sha256: entry.candidate_close_sha256,
      candidate_source: nextSource,
      reason: entry.reason || "upstream_revision_unverified",
      applied_at: appliedAt,
    });
  }
  if (ledgerEntries.length !== proposal.entries.length) {
    throw new MarketBenchmarkRevisionError("benchmark_revision_incomplete");
  }
  return {
    schema_version: REVISION_APPLY_SCHEMA,
    proposal_sha256: proposal.proposal_sha256,
    applied: true,
    overwrites: updates.length,
    deletes: 0,
    updates,
    ledger_entries: ledgerEntries,
  };
}

/** Ratio-only / hash-only summary safe for logs (never includes closes). */
export function revisionApplyLogSummary(plan) {
  return {
    schema_version: plan.schema_version,
    proposal_sha256: plan.proposal_sha256,
    applied: plan.applied,
    overwrites: plan.overwrites,
    deletes: plan.deletes,
    entry_count: plan.ledger_entries.length,
    observation_dates: [...new Set(plan.ledger_entries.map((e) => e.observation_date))].sort(),
  };
}
