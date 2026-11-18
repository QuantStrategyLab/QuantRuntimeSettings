import {
  STRATEGY_HEALTH_MAX_BODY_BYTES,
  STRATEGY_HEALTH_SNAPSHOT_KEY,
} from "./constants.js";
import {
  emptyStrategyHealthPayload,
  normalizeStrategyHealthSnapshot,
  strategyHealthAuditSignature,
  strategyHealthStaleTtlSeconds,
} from "./helpers.js";

export async function syncStrategyHealthResponseImpl(request, env, deps) {
  const {
    requireDedicatedStrategyHealthSyncToken,
    hasConfigStore,
    json,
    readBoundedJson,
    readConfigJson,
    writeConfigJson,
    appendAuditLog,
  } = deps;
  requireDedicatedStrategyHealthSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "strategy health KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, STRATEGY_HEALTH_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid strategy health payload" }, error.status || 400);
  }

  let snapshot;
  try {
    snapshot = normalizeStrategyHealthSnapshot(raw, "strategy health snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid strategy health payload" }, 400);
  }

  let materialChanged = true;
  try {
    const stored = await readConfigJson(env, STRATEGY_HEALTH_SNAPSHOT_KEY);
    if (stored) {
      const normalizedPrev = normalizeStrategyHealthSnapshot(stored, STRATEGY_HEALTH_SNAPSHOT_KEY);
      materialChanged = strategyHealthAuditSignature(normalizedPrev) !== strategyHealthAuditSignature(snapshot);
    }
  } catch {
    materialChanged = true;
  }

  await writeConfigJson(env, STRATEGY_HEALTH_SNAPSHOT_KEY, snapshot);
  if (materialChanged) {
    try {
      await appendAuditLog(env, {
        ts: new Date().toISOString(),
        login: "strategy-health-sync",
        action: "sync_strategy_health",
        schema_version: snapshot.schema_version,
        strategy_count: snapshot.summary.strategy_count,
        data_status: snapshot.data_status,
      });
    } catch {
      // Snapshot delivery remains successful; audit data must never expose the payload.
    }
  }
  return json({
    ok: true,
    schema_version: snapshot.schema_version,
    strategy_count: snapshot.summary.strategy_count,
    generated_at: snapshot.generated_at,
  });
}

export async function strategyHealthResponseImpl(request, env, deps) {
  const { readSession, json, hasConfigStore, readConfigJson } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyStrategyHealthPayload("snapshot_unavailable"));

  let snapshot;
  try {
    const stored = await readConfigJson(env, STRATEGY_HEALTH_SNAPSHOT_KEY);
    if (!stored) return json(emptyStrategyHealthPayload("snapshot_unavailable"));
    snapshot = normalizeStrategyHealthSnapshot(stored, STRATEGY_HEALTH_SNAPSHOT_KEY);
  } catch {
    return json(emptyStrategyHealthPayload("snapshot_invalid"));
  }

  const ttlSeconds = strategyHealthStaleTtlSeconds(env);
  const freshnessTimestamps = [snapshot.generated_at, snapshot.computed_at]
    .filter(Boolean)
    .map((value) => Date.parse(value));
  const freshnessAt = freshnessTimestamps.length ? Math.min(...freshnessTimestamps) : Number.NaN;
  const now = Date.now();
  const futureBeyondClockSkew = Number.isFinite(freshnessAt) && freshnessAt > now + 5 * 60 * 1000;
  const ageSeconds = futureBeyondClockSkew
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(freshnessAt)
      ? Math.max(0, (now - freshnessAt) / 1000)
      : Number.POSITIVE_INFINITY;
  if (["ready", "partial"].includes(snapshot.data_status) && ageSeconds > ttlSeconds) {
    snapshot.data_status = "stale";
  }
  return json(snapshot);
}
