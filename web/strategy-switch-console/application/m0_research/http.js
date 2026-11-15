/**
 * M0 research ledger sync / dashboard HTTP use cases.
 *
 * Inject runtime_support-owned helpers (bounded JSON, audit) so this module
 * never imports runtime_support and cannot form a cycle.
 */

import { readSession } from "../auth/session.js";
import { configStore, hasConfigStore, readConfigJson } from "../config_kv.js";
import { json } from "../http_response.js";
import {
  M0_RESEARCH_ARCHIVE_PREFIX,
  M0_RESEARCH_CURRENT_KEY,
  M0_RESEARCH_MAX_BODY_BYTES,
  M0_RESEARCH_RETENTION_SECONDS,
  M0_RESEARCH_STORAGE_SCHEMA_VERSION,
} from "./constants.js";
import {
  emptyM0ResearchDashboardPayload,
  normalizeM0ResearchLedgerStorageRecord,
  normalizeM0ResearchLedgerTransport,
  projectM0ResearchDashboardForRead,
  requireDedicatedM0ResearchSyncToken,
  utcTimestampSeconds,
} from "./helpers.js";

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   readBoundedJson: Function,
 *   appendAuditLog: Function,
 * }} deps
 */
export async function syncM0ResearchLedgerResponse(request, env, deps) {
  const { readBoundedJson, appendAuditLog } = deps;
  requireDedicatedM0ResearchSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "M0 research ledger KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, M0_RESEARCH_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid M0 research ledger payload" }, error.status || 400);
  }

  let envelope;
  try {
    envelope = await normalizeM0ResearchLedgerTransport(raw, "M0 research ledger transport");
  } catch (error) {
    // Validation deliberately completes before any KV write.  A malformed,
    // over-scoped, or digest-mismatched payload can therefore never replace
    // the last known-good current ledger.
    return json({ ok: false, error: error.message || "invalid M0 research ledger payload" }, 400);
  }

  const current = await readCurrentM0ResearchLedgerRecord(env);
  if (current) {
    // A retry for the exact immutable source is not a new decision or a
    // second write. Acknowledge it so a lost response cannot make a valid
    // no-order publication look failed, while retaining the guards below.
    if (envelope.source_artifact.sha256 === current.envelope.source_artifact.sha256) {
      return json({
        ok: true,
        schema_version: current.envelope.schema_version,
        source_repository: current.envelope.source_artifact.repository,
        source_revision: current.envelope.source_artifact.revision,
        source_run_id: current.envelope.source_artifact.run_id,
        artifact_id: current.envelope.source_artifact.artifact_id,
        ledger_sha256: current.envelope.ledger_sha256,
        replayed: true,
        no_order: true,
        expires_at: current.expires_at,
      });
    }
    const replayError = m0ResearchLedgerReplayError(current.envelope, envelope);
    if (replayError) return json({ ok: false, error: replayError }, 409);
  }

  // Capture once so the persisted interval is exactly the requested physical
  // retention even when the request crosses a wall-clock second boundary.
  const storedNow = new Date();
  const storedAt = utcTimestampSeconds(storedNow);
  const expiresAt = utcTimestampSeconds(new Date(storedNow.getTime() + M0_RESEARCH_RETENTION_SECONDS * 1000));
  const record = {
    schema_version: M0_RESEARCH_STORAGE_SCHEMA_VERSION,
    stored_at: storedAt,
    expires_at: expiresAt,
    envelope,
  };
  try {
    // Archive first: an archive failure must not advance the current pointer.
    // The archive identity is derived exclusively from the verified digest;
    // callers never choose a KV key.
    await writeM0ResearchLedgerRecord(env, m0ResearchLedgerArchiveKey(envelope.ledger_sha256), record);
    await writeM0ResearchLedgerRecord(env, M0_RESEARCH_CURRENT_KEY, record);
  } catch {
    return json({ ok: false, error: "M0 research ledger persistence failed" }, 503);
  }

  try {
    await appendAuditLog(env, {
      ts: storedAt,
      login: "m0-research-ledger-sync",
      action: "sync_m0_research_ledger",
      source_repository: envelope.source_artifact.repository,
      source_revision: envelope.source_artifact.revision,
      source_run_id: envelope.source_artifact.run_id,
      artifact_id: envelope.source_artifact.artifact_id,
      ledger_sha256: envelope.ledger_sha256,
      no_order: true,
    });
  } catch {
    // Retention of an optional convenience log must not change a valid,
    // already persisted no-order research ledger.
  }
  return json({
    ok: true,
    schema_version: envelope.schema_version,
    source_repository: envelope.source_artifact.repository,
    source_revision: envelope.source_artifact.revision,
    source_run_id: envelope.source_artifact.run_id,
    artifact_id: envelope.source_artifact.artifact_id,
    ledger_sha256: envelope.ledger_sha256,
    replayed: false,
    no_order: true,
    expires_at: expiresAt,
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   readSession?: Function,
 *   readCurrentM0ResearchLedgerRecord?: Function,
 * }} [deps]
 */
export async function m0ResearchLedgerResponse(request, env, deps = {}) {
  const readAuthSession = deps.readSession || readSession;
  const readCurrentRecord = deps.readCurrentM0ResearchLedgerRecord || readCurrentM0ResearchLedgerRecord;
  const session = await readAuthSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyM0ResearchDashboardPayload("m0_research_ledger_unavailable"));
  const record = await readCurrentRecord(env);
  return json(record
    ? projectM0ResearchDashboardForRead(record.envelope.ledger, record.envelope.ledger_sha256)
    : emptyM0ResearchDashboardPayload("m0_research_ledger_unavailable"));
}

export function m0ResearchLedgerReplayError(current, incoming) {
  if (!current || !incoming) return null;
  if (incoming.ledger_sha256 === current.ledger_sha256
    || incoming.source_artifact.sha256 === current.source_artifact.sha256) {
    return "M0 research ledger current replay rejected";
  }
  // Run IDs are closed identifiers rather than an assumed numeric sequence.
  // An equal source/run identity is a replay; ledger time is the portable
  // ordering guard for a different run identifier.
  if (incoming.source_artifact.repository === current.source_artifact.repository
    && incoming.source_artifact.run_id === current.source_artifact.run_id) {
    return "M0 research ledger current replay rejected";
  }
  const incomingTime = Date.parse(incoming.ledger.computed_at);
  const currentTime = Date.parse(current.ledger.computed_at);
  if (Number.isFinite(incomingTime) && Number.isFinite(currentTime) && incomingTime <= currentTime) {
    return "M0 research ledger time rollback rejected";
  }
  return null;
}

export function m0ResearchLedgerArchiveKey(ledgerSha256) {
  return `${M0_RESEARCH_ARCHIVE_PREFIX}${ledgerSha256}`;
}

export async function writeM0ResearchLedgerRecord(env, key, record) {
  const store = configStore(env);
  if (!store) throw new Error("M0 research ledger KV is not configured");
  await store.put(key, JSON.stringify(record), { expirationTtl: M0_RESEARCH_RETENTION_SECONDS });
}

export async function readCurrentM0ResearchLedgerRecord(env) {
  if (!hasConfigStore(env)) return null;
  let stored;
  try {
    stored = await readConfigJson(env, M0_RESEARCH_CURRENT_KEY);
  } catch {
    return null;
  }
  if (!stored) return null;
  try {
    return await normalizeM0ResearchLedgerStorageRecord(stored, "M0 research ledger current record");
  } catch {
    return null;
  }
}
