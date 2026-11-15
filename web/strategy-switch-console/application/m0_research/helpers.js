/**
 * M0 research ledger normalize / projection / digest / token helpers.
 *
 * Pure helpers extracted from runtime_support so this module never imports
 * runtime_support.
 */

import { HttpError } from "../http_error.js";
import {
  assertExactFields,
  normalizeResearchTaskDigest,
  normalizeResearchTaskRepository,
  normalizeResearchTaskRevision,
} from "../research_task/helpers.js";
import {
  M0_RESEARCH_ALLOWED_PRODUCER_REPOSITORY,
  M0_RESEARCH_ALLOWED_SOURCE_REPOSITORY,
  M0_RESEARCH_CONFIDENCE,
  M0_RESEARCH_DASHBOARD_SCHEMA_VERSION,
  M0_RESEARCH_HORIZONS,
  M0_RESEARCH_LEDGER_SCHEMA_VERSION,
  M0_RESEARCH_RETENTION_SECONDS,
  M0_RESEARCH_STATES,
  M0_RESEARCH_STORAGE_SCHEMA_VERSION,
  M0_RESEARCH_STYLES,
  M0_RESEARCH_SUBJECT_KINDS,
  M0_RESEARCH_SUMMARY_FIELDS,
  M0_RESEARCH_TRANSPORT_SCHEMA_VERSION,
} from "./constants.js";

function cleanChoice(value, allowed, field) {
  const text = String(value || "").trim();
  if (!allowed.includes(text)) throw new Error(`${field} is invalid`);
  return text;
}

export function utcTimestampSeconds(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function requireDedicatedM0ResearchSyncToken(request, env) {
  const expected = String(env.M0_RESEARCH_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("M0 research sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("M0 research sync token is invalid", 401);
}

export async function normalizeM0ResearchLedgerTransport(payload, fieldName = "M0 research ledger transport") {
  const source = assertExactFields(payload, [
    "schema_version", "producer", "source_artifact", "ledger_sha256", "ledger",
  ], fieldName);
  if (source.schema_version !== M0_RESEARCH_TRANSPORT_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const normalized = {
    schema_version: M0_RESEARCH_TRANSPORT_SCHEMA_VERSION,
    producer: normalizeM0ResearchProducer(source.producer, `${fieldName}.producer`),
    source_artifact: normalizeM0ResearchSourceArtifact(source.source_artifact, `${fieldName}.source_artifact`),
    ledger_sha256: normalizeResearchTaskDigest(source.ledger_sha256, `${fieldName}.ledger_sha256`),
    ledger: normalizeM0ResearchLedger(source.ledger, `${fieldName}.ledger`),
  };
  // The ledger digest binds the closed embedded ledger.  source_artifact.sha256
  // intentionally remains a distinct immutable declaration about the QAR
  // source artifact; it is not a hash of this derived ledger.
  const recomputed = await calculateM0ResearchLedgerSha256(normalized.ledger);
  if (normalized.ledger_sha256 !== recomputed) {
    throw new Error(`${fieldName}.ledger_sha256 mismatch`);
  }
  const computedAt = Date.parse(normalized.ledger.computed_at);
  if (!Number.isFinite(computedAt) || computedAt > Date.now() + 5 * 60 * 1000) {
    throw new Error(`${fieldName}.ledger.computed_at is in the future`);
  }
  if (computedAt < Date.now() - M0_RESEARCH_RETENTION_SECONDS * 1000) {
    throw new Error(`${fieldName}.ledger is expired`);
  }
  return normalized;
}

export async function normalizeM0ResearchLedgerStorageRecord(payload, fieldName) {
  const record = assertExactFields(payload, ["schema_version", "stored_at", "expires_at", "envelope"], fieldName);
  if (record.schema_version !== M0_RESEARCH_STORAGE_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const storedAt = normalizeM0ResearchTimestamp(record.stored_at, `${fieldName}.stored_at`);
  const expiresAt = normalizeM0ResearchTimestamp(record.expires_at, `${fieldName}.expires_at`);
  const storedMillis = Date.parse(storedAt);
  const expiresMillis = Date.parse(expiresAt);
  if (expiresMillis - storedMillis !== M0_RESEARCH_RETENTION_SECONDS * 1000 || expiresMillis <= Date.now()) {
    throw new Error(`${fieldName} is expired`);
  }
  return {
    schema_version: M0_RESEARCH_STORAGE_SCHEMA_VERSION,
    stored_at: storedAt,
    expires_at: expiresAt,
    envelope: await normalizeM0ResearchLedgerTransport(record.envelope, `${fieldName}.envelope`),
  };
}

export function normalizeM0ResearchLedger(payload, fieldName) {
  const ledger = assertExactFields(payload, [
    "schema_version", "generated_at", "computed_at", "data_status", "summary", "subjects", "policy", "errors",
  ], fieldName);
  if (ledger.schema_version !== M0_RESEARCH_LEDGER_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const generatedAt = normalizeM0ResearchTimestamp(ledger.generated_at, `${fieldName}.generated_at`);
  const computedAt = normalizeM0ResearchTimestamp(ledger.computed_at, `${fieldName}.computed_at`);
  if (generatedAt !== computedAt || /\./.test(generatedAt)) {
    throw new Error(`${fieldName} timestamps must be the same canonical second`);
  }
  const dataStatus = cleanChoice(ledger.data_status, ["ready", "unavailable", "stale"], `${fieldName}.data_status`);
  if (!Array.isArray(ledger.subjects) || ledger.subjects.length > 50000) {
    throw new Error(`${fieldName}.subjects must be a bounded array`);
  }
  const subjects = ledger.subjects.map((subject, index) => normalizeM0ResearchSubject(
    subject, `${fieldName}.subjects[${index}]`, computedAt,
  ));
  assertM0ResearchSortedUnique(subjects, (subject) => `${subject.subject.kind}\u0000${subject.subject.identifier}`, `${fieldName}.subjects`);
  const summary = normalizeM0ResearchLedgerSummary(ledger.summary, `${fieldName}.summary`);
  const calculatedSummary = summarizeM0ResearchSubjects(subjects);
  if (!m0ResearchSummariesEqual(summary, calculatedSummary)) {
    throw new Error(`${fieldName}.summary does not match subjects`);
  }
  const expectedStatus = summary.fresh_observation_count > 0
    ? "ready"
    : (summary.observation_count > 0 ? "stale" : "unavailable");
  if (dataStatus !== expectedStatus) throw new Error(`${fieldName}.data_status does not match subjects`);
  if (dataStatus === "unavailable" && subjects.length) throw new Error(`${fieldName}.subjects must be empty when unavailable`);
  return {
    schema_version: M0_RESEARCH_LEDGER_SCHEMA_VERSION,
    generated_at: generatedAt,
    computed_at: computedAt,
    data_status: dataStatus,
    summary,
    subjects,
    policy: normalizeM0ResearchLedgerPolicy(ledger.policy, `${fieldName}.policy`),
    errors: normalizeM0ResearchErrorCodes(ledger.errors, `${fieldName}.errors`),
  };
}

export function normalizeM0ResearchLedgerSummary(value, fieldName) {
  const summary = assertExactFields(value, M0_RESEARCH_SUMMARY_FIELDS, fieldName);
  const result = {};
  for (const key of M0_RESEARCH_SUMMARY_FIELDS) {
    result[key] = normalizeM0ResearchCount(summary[key], `${fieldName}.${key}`);
  }
  return result;
}

export function m0ResearchSummariesEqual(left, right) {
  return M0_RESEARCH_SUMMARY_FIELDS.every((field) => left[field] === right[field]);
}

export function normalizeM0ResearchLedgerPolicy(value, fieldName) {
  const policy = assertExactFields(value, ["authority", "no_order", "permitted_next_step", "notice"], fieldName);
  if (policy.authority !== "research_only" || policy.no_order !== true || policy.permitted_next_step !== "research_validation_only") {
    throw new Error(`${fieldName} must remain research-only and no-order`);
  }
  return {
    authority: "research_only",
    no_order: true,
    permitted_next_step: "research_validation_only",
    notice: normalizeM0ResearchText(policy.notice, `${fieldName}.notice`, 240),
  };
}

export function normalizeM0ResearchSubject(value, fieldName, ledgerComputedAt) {
  const item = assertExactFields(value, ["subject", "observations", "horizon_conflict", "historical_stale_horizon_drift"], fieldName);
  const subject = assertExactFields(item.subject, ["kind", "identifier"], `${fieldName}.subject`);
  const normalizedSubject = {
    kind: cleanChoice(subject.kind, M0_RESEARCH_SUBJECT_KINDS, `${fieldName}.subject.kind`),
    identifier: normalizeM0ResearchIdentifier(subject.identifier, `${fieldName}.subject.identifier`),
  };
  if (!Array.isArray(item.observations) || !item.observations.length || item.observations.length > 100) {
    throw new Error(`${fieldName}.observations must be a non-empty bounded array`);
  }
  const observations = item.observations.map((observation, index) => normalizeM0ResearchObservation(
    observation, `${fieldName}.observations[${index}]`, ledgerComputedAt,
  ));
  assertM0ResearchSortedUnique(observations, (observation) => (
    `${observation.source_report_digest}\u0000${observation.source_entry_digest}`
  ), `${fieldName}.observations`);
  const expectedHorizonView = calculateM0ResearchHorizonViews(observations);
  const horizonConflict = normalizeM0ResearchHorizonView(
    item.horizon_conflict, `${fieldName}.horizon_conflict`, ["none", "conflict"], expectedHorizonView.horizon_conflict,
  );
  const historicalStaleHorizonDrift = normalizeM0ResearchHorizonView(
    item.historical_stale_horizon_drift, `${fieldName}.historical_stale_horizon_drift`,
    ["none", "drift", "unavailable"], expectedHorizonView.historical_stale_horizon_drift,
  );
  return {
    subject: normalizedSubject,
    observations,
    horizon_conflict: horizonConflict,
    historical_stale_horizon_drift: historicalStaleHorizonDrift,
  };
}

export function normalizeM0ResearchObservation(value, fieldName, ledgerComputedAt) {
  const item = assertExactFields(value, [
    "source_ids", "source_report_digest", "source_entry_digest", "hypothesis_id", "as_of", "generated_at", "expires_at",
    "research_context", "freshness",
  ], fieldName);
  if (!Array.isArray(item.source_ids) || !item.source_ids.length || item.source_ids.length > 100) {
    throw new Error(`${fieldName}.source_ids must be a non-empty bounded array`);
  }
  const sourceIds = item.source_ids.map((sourceId, index) => normalizeM0ResearchIdentifier(sourceId, `${fieldName}.source_ids[${index}]`));
  assertM0ResearchSortedUnique(sourceIds, (sourceId) => sourceId, `${fieldName}.source_ids`);
  const generatedAt = normalizeM0ResearchTimestamp(item.generated_at, `${fieldName}.generated_at`);
  const expiresAt = normalizeM0ResearchTimestamp(item.expires_at, `${fieldName}.expires_at`);
  const generatedMillis = Date.parse(generatedAt);
  const expiresMillis = Date.parse(expiresAt);
  if (expiresMillis - generatedMillis !== 7 * 24 * 60 * 60 * 1000) {
    throw new Error(`${fieldName} must have the fixed seven-day M0 expiry`);
  }
  const asOf = normalizeM0ResearchDate(item.as_of, `${fieldName}.as_of`);
  if (asOf > generatedAt.slice(0, 10)) throw new Error(`${fieldName}.as_of cannot be after generated_at`);
  const context = normalizeM0ResearchContext(item.research_context, `${fieldName}.research_context`);
  const freshness = normalizeM0ResearchFreshness(
    item.freshness, `${fieldName}.freshness`, generatedMillis, expiresMillis, Date.parse(ledgerComputedAt),
  );
  return {
    source_ids: sourceIds,
    source_report_digest: normalizeResearchTaskDigest(item.source_report_digest, `${fieldName}.source_report_digest`),
    source_entry_digest: normalizeResearchTaskDigest(item.source_entry_digest, `${fieldName}.source_entry_digest`),
    hypothesis_id: normalizeM0ResearchIdentifier(item.hypothesis_id, `${fieldName}.hypothesis_id`),
    as_of: asOf,
    generated_at: generatedAt,
    expires_at: expiresAt,
    research_context: context,
    freshness,
  };
}

export function normalizeM0ResearchContext(value, fieldName) {
  const context = assertExactFields(value, [
    "state", "primary_horizon", "suitable_horizons", "source_confidence", "source_style", "theme_ids",
  ], fieldName);
  const primaryHorizon = cleanChoice(context.primary_horizon, M0_RESEARCH_HORIZONS, `${fieldName}.primary_horizon`);
  if (!Array.isArray(context.suitable_horizons) || !context.suitable_horizons.length || context.suitable_horizons.length > 4) {
    throw new Error(`${fieldName}.suitable_horizons is invalid`);
  }
  const suitableHorizons = context.suitable_horizons.map((horizon, index) => cleanChoice(
    horizon, M0_RESEARCH_HORIZONS, `${fieldName}.suitable_horizons[${index}]`,
  ));
  if (!suitableHorizons.includes(primaryHorizon)) throw new Error(`${fieldName}.primary_horizon must be suitable`);
  assertM0ResearchUnique(suitableHorizons, `${fieldName}.suitable_horizons`);
  if (!Array.isArray(context.theme_ids) || context.theme_ids.length > 24) throw new Error(`${fieldName}.theme_ids is invalid`);
  const themeIds = context.theme_ids.map((themeId, index) => normalizeM0ResearchIdentifier(themeId, `${fieldName}.theme_ids[${index}]`));
  assertM0ResearchUnique(themeIds, `${fieldName}.theme_ids`);
  return {
    state: cleanChoice(context.state, M0_RESEARCH_STATES, `${fieldName}.state`),
    primary_horizon: primaryHorizon,
    suitable_horizons: suitableHorizons,
    source_confidence: cleanChoice(context.source_confidence, M0_RESEARCH_CONFIDENCE, `${fieldName}.source_confidence`),
    source_style: cleanChoice(context.source_style, M0_RESEARCH_STYLES, `${fieldName}.source_style`),
    theme_ids: themeIds,
  };
}

export function normalizeM0ResearchFreshness(value, fieldName, generatedMillis, expiresMillis, ledgerComputedMillis) {
  const freshness = assertExactFields(value, ["status", "age_seconds"], fieldName);
  const status = cleanChoice(freshness.status, ["fresh", "stale", "unknown"], `${fieldName}.status`);
  const expectedAge = generatedMillis > ledgerComputedMillis
    ? null
    : Math.max(0, Math.floor((ledgerComputedMillis - generatedMillis) / 1000));
  const age = freshness.age_seconds === null ? null : normalizeM0ResearchCount(freshness.age_seconds, `${fieldName}.age_seconds`, 315360000);
  if (status === "unknown") {
    if (age !== null || generatedMillis <= ledgerComputedMillis) throw new Error(`${fieldName} unknown state is invalid`);
    return { status, age_seconds: null };
  }
  if (age !== expectedAge || generatedMillis > ledgerComputedMillis) throw new Error(`${fieldName}.age_seconds is invalid`);
  if (status === "fresh" && ledgerComputedMillis >= expiresMillis) throw new Error(`${fieldName} cannot be fresh after expiry`);
  return { status, age_seconds: age };
}

export function calculateM0ResearchHorizonViews(observations) {
  const freshHorizons = [...new Set(observations
    .filter((observation) => observation.freshness.status === "fresh")
    .map((observation) => observation.research_context.primary_horizon))].sort();
  const staleHorizons = [...new Set(observations
    .filter((observation) => observation.freshness.status === "stale")
    .map((observation) => observation.research_context.primary_horizon))].sort();
  return {
    horizon_conflict: { status: freshHorizons.length > 1 ? "conflict" : "none", primary_horizons: freshHorizons },
    historical_stale_horizon_drift: {
      status: freshHorizons.length
        ? (staleHorizons.length && JSON.stringify(staleHorizons) !== JSON.stringify(freshHorizons) ? "drift" : "none")
        : (staleHorizons.length ? "unavailable" : "none"),
      primary_horizons: staleHorizons,
    },
  };
}

export function projectM0ResearchDashboardForRead(ledger, sourceLedgerSha256, now = new Date()) {
  // The stored envelope remains the immutable, digest-bound publication
  // record. This is deliberately a different dashboard schema: changing
  // freshness at read time must never pretend to be a re-validatable ledger.
  const nowMillis = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMillis)) return emptyM0ResearchDashboardPayload("m0_research_ledger_unavailable");
  const subjects = ledger.subjects.map((entry) => {
    const observations = entry.observations.map((observation) => ({
      ...observation,
      freshness: projectM0ResearchObservationFreshness(observation, nowMillis),
    }));
    const horizonViews = calculateM0ResearchHorizonViews(observations);
    return {
      subject: { ...entry.subject },
      observations,
      horizon_conflict: horizonViews.horizon_conflict,
      historical_stale_horizon_drift: horizonViews.historical_stale_horizon_drift,
    };
  });
  const summary = summarizeM0ResearchSubjects(subjects);
  const dataStatus = summary.fresh_observation_count > 0
    ? "ready"
    : (summary.observation_count > 0 ? "stale" : "unavailable");
  return {
    schema_version: M0_RESEARCH_DASHBOARD_SCHEMA_VERSION,
    source_ledger_sha256: sourceLedgerSha256,
    source_generated_at: ledger.generated_at,
    source_computed_at: ledger.computed_at,
    viewed_at: utcTimestampSeconds(new Date(nowMillis)),
    data_status: dataStatus,
    summary,
    subjects,
    policy: { ...ledger.policy },
    errors: [...ledger.errors],
  };
}

export function projectM0ResearchObservationFreshness(observation, nowMillis) {
  const generatedMillis = Date.parse(observation.generated_at);
  const expiresMillis = Date.parse(observation.expires_at);
  if (!Number.isFinite(generatedMillis) || !Number.isFinite(expiresMillis) || nowMillis < generatedMillis) {
    return { status: "unknown", age_seconds: null };
  }
  const ageSeconds = Math.max(0, Math.floor((nowMillis - generatedMillis) / 1000));
  // A stale source is never promoted by this projection.  A former fresh
  // observation is demoted as soon as its own expiry is reached.
  const status = observation.freshness.status === "fresh" && nowMillis < expiresMillis
    ? "fresh"
    : "stale";
  return { status, age_seconds: ageSeconds };
}

export function normalizeM0ResearchHorizonView(value, fieldName, allowedStatuses, expected) {
  const view = assertExactFields(value, ["status", "primary_horizons"], fieldName);
  const status = cleanChoice(view.status, allowedStatuses, `${fieldName}.status`);
  if (!Array.isArray(view.primary_horizons) || view.primary_horizons.length > 4) {
    throw new Error(`${fieldName}.primary_horizons is invalid`);
  }
  const horizons = view.primary_horizons.map((horizon, index) => cleanChoice(
    horizon, M0_RESEARCH_HORIZONS, `${fieldName}.primary_horizons[${index}]`,
  ));
  assertM0ResearchSortedUnique(horizons, (horizon) => horizon, `${fieldName}.primary_horizons`);
  if (status !== expected.status || JSON.stringify(horizons) !== JSON.stringify(expected.primary_horizons)) {
    throw new Error(`${fieldName} does not match observations`);
  }
  return { status, primary_horizons: horizons };
}

export function summarizeM0ResearchSubjects(subjects) {
  const observations = subjects.flatMap((subject) => subject.observations);
  return {
    subject_count: subjects.length,
    observation_count: observations.length,
    fresh_observation_count: observations.filter((observation) => observation.freshness.status === "fresh").length,
    stale_observation_count: observations.filter((observation) => observation.freshness.status === "stale").length,
    unknown_observation_count: observations.filter((observation) => observation.freshness.status === "unknown").length,
    horizon_conflict_count: subjects.filter((subject) => subject.horizon_conflict.status === "conflict").length,
    historical_stale_horizon_drift_count: subjects.filter((subject) => subject.historical_stale_horizon_drift.status === "drift").length,
  };
}

export function normalizeM0ResearchErrorCodes(value, fieldName) {
  if (!Array.isArray(value) || value.length > 20) throw new Error(`${fieldName} is invalid`);
  const errors = value.map((error, index) => {
    if (typeof error !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/.test(error)) {
      throw new Error(`${fieldName}[${index}] is invalid`);
    }
    return error;
  });
  assertM0ResearchSortedUnique(errors, (error) => error, fieldName);
  return errors;
}

export function normalizeM0ResearchRepository(value, fieldName, allowedRepository) {
  const repository = normalizeResearchTaskRepository(value, fieldName);
  if (repository !== allowedRepository) throw new Error(`${fieldName} is not an approved M0 repository`);
  return repository;
}

export function normalizeM0ResearchRevision(value, fieldName) {
  return normalizeResearchTaskRevision(value, fieldName);
}

export function normalizeM0ResearchProducer(value, fieldName) {
  const producer = assertExactFields(value, ["repository", "revision"], fieldName);
  return {
    repository: normalizeM0ResearchRepository(
      producer.repository, `${fieldName}.repository`, M0_RESEARCH_ALLOWED_PRODUCER_REPOSITORY,
    ),
    revision: normalizeM0ResearchRevision(producer.revision, `${fieldName}.revision`),
  };
}

export function normalizeM0ResearchSourceArtifact(value, fieldName) {
  const artifact = assertExactFields(value, ["repository", "revision", "run_id", "artifact_id", "sha256"], fieldName);
  return {
    repository: normalizeM0ResearchRepository(
      artifact.repository, `${fieldName}.repository`, M0_RESEARCH_ALLOWED_SOURCE_REPOSITORY,
    ),
    revision: normalizeM0ResearchRevision(artifact.revision, `${fieldName}.revision`),
    run_id: normalizeM0ResearchIdentifier(artifact.run_id, `${fieldName}.run_id`),
    artifact_id: normalizeM0ResearchArtifactId(artifact.artifact_id, `${fieldName}.artifact_id`),
    sha256: normalizeResearchTaskDigest(artifact.sha256, `${fieldName}.sha256`),
  };
}

export function normalizeM0ResearchArtifactId(value, fieldName) {
  // Keep this exactly aligned with #309's generic identifier schema.  Artifact
  // IDs are provenance labels, not strategy slugs, so uppercase and `:/` are
  // valid when they satisfy the closed source-artifact contract.
  return normalizeM0ResearchIdentifier(value, fieldName);
}

export function normalizeM0ResearchIdentifier(value, fieldName) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:/-]{1,128}$/.test(value)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
}

export function normalizeM0ResearchTimestamp(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} must be a UTC timestamp`);
  }
  if (new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error(`${fieldName} must be a real UTC timestamp`);
  }
  return value;
}

export function normalizeM0ResearchDate(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${fieldName} must be an ISO date`);
  }
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${fieldName} must be a real ISO date`);
  }
  return value;
}

export function normalizeM0ResearchCount(value, fieldName, maximum = 50000) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${fieldName} is invalid`);
  return value;
}

export function normalizeM0ResearchText(value, fieldName, maximum) {
  if (typeof value !== "string" || !value || value.length > maximum || /[<>\\\u0000-\u001f]/.test(value)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
}

export function assertM0ResearchUnique(values, fieldName) {
  if (new Set(values).size !== values.length) throw new Error(`${fieldName} contains duplicates`);
}

export function assertM0ResearchSortedUnique(values, key, fieldName) {
  let previous = null;
  for (const value of values) {
    const current = key(value);
    if (previous !== null && current <= previous) throw new Error(`${fieldName} must be sorted and unique`);
    previous = current;
  }
}

export function canonicalM0ResearchLedgerJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("M0 research ledger must use finite JSON values");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalM0ResearchLedgerJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("M0 research ledger must use JSON values");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalM0ResearchLedgerJson(value[key])}`).join(",")}}`;
}

export async function calculateM0ResearchLedgerSha256(ledger) {
  const raw = new TextEncoder().encode(canonicalM0ResearchLedgerJson(ledger));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function emptyM0ResearchDashboardPayload(errorCode, now = new Date()) {
  return {
    schema_version: M0_RESEARCH_DASHBOARD_SCHEMA_VERSION,
    source_ledger_sha256: null,
    source_generated_at: null,
    source_computed_at: null,
    viewed_at: utcTimestampSeconds(now),
    data_status: "unavailable",
    summary: {
      subject_count: 0,
      observation_count: 0,
      fresh_observation_count: 0,
      stale_observation_count: 0,
      unknown_observation_count: 0,
      horizon_conflict_count: 0,
      historical_stale_horizon_drift_count: 0,
    },
    subjects: [],
    policy: {
      authority: "research_only",
      no_order: true,
      permitted_next_step: "research_validation_only",
      notice: "M0 研究台账不可用；不会推断策略、平台、运行状态或订单。",
    },
    errors: [errorCode],
  };
}
