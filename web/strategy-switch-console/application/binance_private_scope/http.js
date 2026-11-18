import {
  BINANCE_PRIVATE_SCOPE_FUTURE_SKEW_MS,
  BINANCE_PRIVATE_SCOPE_KEY,
  BINANCE_PRIVATE_SCOPE_MAX_BODY_BYTES,
  BINANCE_PRIVATE_SCOPE_READ_MAX_AGE_MS,
  BINANCE_PRIVATE_SCOPE_WRITE_TTL_SECONDS,
} from "./constants.js";
import { normalizeBinancePrivateScopeReport } from "./helpers.js";

export async function syncBinancePrivateScopeResponseImpl(request, env, deps) {
  const { requireDedicatedReconciliationRecoverySyncToken, configStore, json, readBoundedJson } = deps;
  requireDedicatedReconciliationRecoverySyncToken(request, env);
  const store = configStore(env);
  if (!store) {
    return json({ ok: false, error: "binance_private_scope_storage_unavailable" }, 503);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, BINANCE_PRIVATE_SCOPE_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: "invalid_binance_private_scope_payload" }, error.status === 413 ? 413 : 400);
  }
  let report;
  try {
    report = normalizeBinancePrivateScopeReport(raw, { requireIngestFreshness: true });
  } catch {
    return json({ ok: false, error: "invalid_binance_private_scope_payload" }, 400);
  }
  try {
    await store.put(BINANCE_PRIVATE_SCOPE_KEY, JSON.stringify(report), {
      expirationTtl: BINANCE_PRIVATE_SCOPE_WRITE_TTL_SECONDS,
    });
  } catch {
    return json({ ok: false, error: "binance_private_scope_storage_unavailable" }, 503);
  }
  return json({
    ok: true,
    observed_at: report.observed_at,
    source_run_id: report.source_run_id,
    asset_count: report.assets.length,
  });
}

export async function binancePrivateScopeResponseImpl(request, env, deps) {
  const { readSession, hasConfigStore, readConfigJson, json } = deps;
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.allowed || !session.admin) return json({ ok: false, error: "admin required" }, 403);
  if (!hasConfigStore(env)) return json({ ok: true, report: null });
  try {
    const raw = await readConfigJson(env, BINANCE_PRIVATE_SCOPE_KEY);
    if (!raw) return json({ ok: true, report: null });
    const report = normalizeBinancePrivateScopeReport(raw);
    const ageMs = Date.now() - Date.parse(report.observed_at);
    if (ageMs > BINANCE_PRIVATE_SCOPE_READ_MAX_AGE_MS || ageMs < -BINANCE_PRIVATE_SCOPE_FUTURE_SKEW_MS) {
      return json({ ok: true, report: null });
    }
    return json({ ok: true, report });
  } catch {
    return json({ ok: true, report: null });
  }
}
