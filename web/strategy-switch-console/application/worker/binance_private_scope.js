/**
 * Isolated Binance private-scope report validation and read/sync handlers.
 */

import {
  assertBooleanField,
  assertConstantField,
  assertExactObject,
  cleanBoundedArray,
  cleanBoundedText,
  cleanHexDigest,
  validateObjectSchema,
} from "./schema_validators.js";

export const BINANCE_PRIVATE_SCOPE_KEY = "private_binance_scope_report";
export const BINANCE_PRIVATE_SCOPE_MAX_BODY_BYTES = 256 * 1024;
export const BINANCE_PRIVATE_SCOPE_MAX_ASSETS = 5000;
export const BINANCE_PRIVATE_SCOPE_WRITE_TTL_SECONDS = 24 * 60 * 60;
export const BINANCE_PRIVATE_SCOPE_INGEST_MAX_AGE_MS = 10 * 60 * 1000;
export const BINANCE_PRIVATE_SCOPE_FUTURE_SKEW_MS = 60 * 1000;
export const BINANCE_PRIVATE_SCOPE_READ_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const BINANCE_PRIVATE_SCOPE_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function normalizeBinancePrivateScopeDecimal(value, fieldName) {
  return cleanBoundedText(value, fieldName, {
    strictString: true,
    trim: false,
    pattern: /^\d+(?:\.\d+)?$/,
    message: `${fieldName} must be a non-negative finite decimal string`,
  });
}

export function binancePrivateScopeDecimalIsZero(value) {
  return /^0+(?:\.0+)?$/.test(value);
}

export function normalizeBinancePrivateScopeReport(payload, { requireIngestFreshness = false } = {}) {
  const report = assertExactObject(
    payload,
    [
      "platform",
      "observed_at",
      "source_run_id",
      "source_sha",
      "account_scope_sha256",
      "assets",
      "historical_difference_unresolved",
      "no_order",
      "execution_authority_granted",
    ],
    "Binance private scope report",
  );
  assertConstantField(report.platform, "binance", "Binance private scope report.platform must be binance");

  const observedAt = cleanBoundedText(report.observed_at, "Binance private scope report.observed_at", {
    strictString: true,
    trim: false,
    pattern: BINANCE_PRIVATE_SCOPE_TS_RE,
    message: "Binance private scope report.observed_at must be an ISO timestamp with timezone",
  });
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) {
    throw new Error("Binance private scope report.observed_at must be valid");
  }
  if (requireIngestFreshness) {
    const ageMs = Date.now() - observedAtMs;
    if (ageMs > BINANCE_PRIVATE_SCOPE_INGEST_MAX_AGE_MS || ageMs < -BINANCE_PRIVATE_SCOPE_FUTURE_SKEW_MS) {
      throw new Error("Binance private scope report.observed_at is outside the ingestion window");
    }
  }

  const sourceRunId = cleanBoundedText(report.source_run_id, "Binance private scope report.source_run_id", {
    strictString: true,
    trim: false,
    pattern: /^[1-9]\d{0,19}$/,
    message: "Binance private scope report.source_run_id must be a decimal string",
  });
  const sourceSha = cleanHexDigest(report.source_sha, "Binance private scope report.source_sha", {
    length: 40,
    allowUppercase: true,
    lowercase: true,
    strictString: true,
    message: "Binance private scope report.source_sha must be a 40 character hex string",
  });
  const accountScopeSha256 = cleanHexDigest(
    report.account_scope_sha256,
    "Binance private scope report.account_scope_sha256",
    {
      length: 64,
      allowUppercase: true,
      lowercase: true,
      strictString: true,
      message: "Binance private scope report.account_scope_sha256 must be a 64 character hex string",
    },
  );
  const assets = cleanBoundedArray(report.assets, "Binance private scope report.assets", {
    maxLength: BINANCE_PRIVATE_SCOPE_MAX_ASSETS,
    uniqueKey: "asset",
    duplicateMessage: "Binance private scope report.assets contains duplicate assets",
    lengthMessage: `Binance private scope report.assets must contain at most ${BINANCE_PRIVATE_SCOPE_MAX_ASSETS} items`,
    itemValidator: (value, assetField) => validateObjectSchema(
      value,
      {
        exactKeys: ["asset", "free", "locked"],
        fields: {
          asset: (v, p) => cleanBoundedText(v, p, {
            strictString: true,
            trim: false,
            pattern: /^[\p{L}\p{N}]{1,20}$/u,
            message: `${p} is invalid`,
          }),
          free: (v, p) => normalizeBinancePrivateScopeDecimal(v, p),
          locked: (v, p) => normalizeBinancePrivateScopeDecimal(v, p),
        },
        postValidate: (normalized, _raw, itemField) => {
          if (binancePrivateScopeDecimalIsZero(normalized.free) && binancePrivateScopeDecimalIsZero(normalized.locked)) {
            throw new Error(`${itemField} must not be an all-zero row`);
          }
        },
      },
      assetField,
    ),
  });

  assertBooleanField(report.historical_difference_unresolved, "Binance private scope report.historical_difference_unresolved", {
    expected: true,
    message: "Binance private scope report.historical_difference_unresolved must be true",
  });
  assertBooleanField(report.no_order, "Binance private scope report.no_order", {
    expected: true,
    message: "Binance private scope report.no_order must be true",
  });
  assertBooleanField(report.execution_authority_granted, "Binance private scope report.execution_authority_granted", {
    expected: false,
    message: "Binance private scope report.execution_authority_granted must be false",
  });

  return {
    platform: "binance",
    observed_at: observedAt,
    source_run_id: sourceRunId,
    source_sha: sourceSha,
    account_scope_sha256: accountScopeSha256,
    assets,
    historical_difference_unresolved: true,
    no_order: true,
    execution_authority_granted: false,
  };
}

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
