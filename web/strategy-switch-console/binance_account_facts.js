// Native quantities for the explicitly covered Spot + Flexible Earn scope.
// This projection never produces account NAV, cash, FX totals, or trading authority.
export const BINANCE_FACTS_SCHEMA = "binance_account_facts.v1";
export const BINANCE_FACTS_KIND = "binance_readonly_scope_revision";
export const BINANCE_FACTS_KEY = "private_binance_account_facts";
export const BINANCE_FACTS_MAX_BYTES = 256 * 1024;
export const BINANCE_FACTS_STALE_MS = 36 * 60 * 60 * 1000;
export const BINANCE_WALLET_HISTORY_SCHEMA = "binance_wallet_valuation_history.v1";
export const BINANCE_WALLET_HISTORY_METRIC = "wallet_valuation";
export const BINANCE_WALLET_HISTORY_SCOPE = "provider_returned_wallet_rows";
export const BINANCE_WALLET_HISTORY_MAX_DAYS = 366;
export const BINANCE_FACTS_HISTORY_BINDINGS_MAX = 16;
const UNCOVERED = ["funding", "margin", "futures", "locked_earn"];
const IDENTITY = ["target_name", "service_name", "deployment_selector", "account_selector"];
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,30})?$/;
const CANONICAL_DECIMAL = /^(?:0|[1-9]\d{0,29})(?:\.\d{0,29}[1-9])?(?![\s\S])/;
const WALLET_VALUATION_SOURCE = "GET /sapi/v1/asset/wallet/balance";
const WALLET_VALUATION_SCOPE = "provider_returned_wallet_rows";
const PROVIDER_PRODUCT_TYPE_SOURCE = "GET /api/v3/account.accountType";
const WALLET_VALUATION_FAILURES = new Set([
  "wallet_read_failed", "wallet_response_invalid", "wallet_row_invalid",
  "wallet_duplicate_name", "wallet_inactive_nonzero", "wallet_balance_invalid",
]);
const ASSET_CODE_POINT = /^[\p{L}\p{N}]$/u;
const ASCII_LOWERCASE = /[a-z]/;
const DEFAULT_IGNORABLE_LETTERS = new Set(["\u115f", "\u1160", "\u3164", "\uffa0"]);

export class BinanceFactsError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
function fail(code, status = 400) { throw new BinanceFactsError(code, status); }
function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== fields.length
      || fields.some(key => !Object.hasOwn(value, key))) fail("invalid_binance_account_facts");
}
function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) {
    fail("invalid_binance_account_facts_time");
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail("invalid_binance_account_facts_time");
  const normalized = new Date(ms).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) fail("invalid_binance_account_facts_time");
  return ms;
}
function units(text) {
  if (typeof text !== "string" || !DECIMAL.test(text)) fail("invalid_binance_account_facts_quantity");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole + fraction.padEnd(30, "0"));
}

function safeProviderProductType(report, start, spot, finish) {
  if (!Object.hasOwn(report, "provider_product_type")) return null;
  try {
    const value = report.provider_product_type;
    exact(value, ["value", "source", "observed_at"]);
    if (!(["SPOT", "unknown"].includes(value.value))
        || value.source !== PROVIDER_PRODUCT_TYPE_SOURCE
        || value.observed_at !== report.spot_observed_at) return null;
    const observed = instant(value.observed_at);
    if (observed < start || observed > finish || observed !== spot) return null;
    return { value: value.value, source: PROVIDER_PRODUCT_TYPE_SOURCE, observed_at: value.observed_at };
  } catch {
    // This optional classification must not invalidate otherwise valid balances.
    return null;
  }
}

function validNativeAsset(value) {
  if (typeof value !== "string") return false;
  const codePoints = Array.from(value);
  return codePoints.length >= 1 && codePoints.length <= 128
    && codePoints.every(codePoint => ASSET_CODE_POINT.test(codePoint)
      && !ASCII_LOWERCASE.test(codePoint) && !DEFAULT_IGNORABLE_LETTERS.has(codePoint));
}

export function normalizeBinanceFactsBinding(raw) {
  exact(raw, ["platform", "account_key", "account_scope", ...IDENTITY, "target_id",
    "account_scope_sha256", "reader_revision", "approved_application_revision", "source_binding"]);
  if (raw.platform !== "binance" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(raw.account_key)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(raw.account_scope)
      || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.target_id)
      || !HASH.test(raw.account_scope_sha256) || !SHA.test(raw.reader_revision)
      || !SHA.test(raw.approved_application_revision)) fail("binance_account_facts_binding_invalid", 503);
  for (const field of IDENTITY) {
    if (typeof raw[field] !== "string" || raw[field].length > 256
        || (field !== "service_name" && !raw[field].length)) fail("binance_account_facts_binding_invalid", 503);
  }
  exact(raw.source_binding, ["kind", "id"]);
  if (raw.source_binding.kind !== BINANCE_FACTS_KIND || !HASH.test(raw.source_binding.id)) {
    fail("binance_account_facts_binding_invalid", 503);
  }
  return raw;
}

export function binanceFactsOptionMatches(option, binding) {
  return Boolean(option && binding && option.key === binding.account_key
    && option.account_scope === binding.account_scope
    && IDENTITY.every(field => (option[field] ?? "") === binding[field]));
}

export async function assertBinanceFactsSourceBinding(binding) {
  const material = {
    account_scope_sha256: binding.account_scope_sha256,
    approved_application_revision: binding.approved_application_revision,
    reader_public_revision: binding.reader_revision,
    scope: "spot+flexible_earn",
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(material)));
  const expected = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (binding.source_binding.id !== expected) fail("binance_account_facts_binding_invalid", 503);
}

export function normalizeBinanceFactsHistoryBindings(raw, currentBinding) {
  if (!Array.isArray(raw) || raw.length > BINANCE_FACTS_HISTORY_BINDINGS_MAX) {
    fail("binance_account_facts_history_bindings_invalid", 503);
  }
  const current = normalizeBinanceFactsBinding(currentBinding);
  const seen = new Set();
  const identityFields = ["platform", "account_key", "account_scope", ...IDENTITY, "target_id",
    "account_scope_sha256", "approved_application_revision"];
  return raw.map((candidate) => {
    let binding;
    try { binding = normalizeBinanceFactsBinding(candidate); }
    catch { fail("binance_account_facts_history_bindings_invalid", 503); }
    if (!identityFields.every((field) => binding[field] === current[field])
        || binding.source_binding.kind !== current.source_binding.kind
        || binding.reader_revision === current.reader_revision
        || binding.source_binding.id === current.source_binding.id
        || seen.has(binding.source_binding.id)) {
      fail("binance_account_facts_history_bindings_invalid", 503);
    }
    seen.add(binding.source_binding.id);
    return binding;
  });
}

export async function assertBinanceFactsHistoryBindings(raw, currentBinding) {
  const bindings = normalizeBinanceFactsHistoryBindings(raw, currentBinding);
  for (const binding of bindings) await assertBinanceFactsSourceBinding(binding);
  return bindings;
}

export function normalizeBinanceAccountFacts(raw, binding, { now = Date.now(), ingest = false } = {}) {
  exact(raw, ["schema_version", "platform", "target_id", "account_scope_sha256", "source_binding",
    "source_revision", "approved_application_revision", "observed_started_at", "observed_finished_at",
    "spot_observed_at", "earn_observed_at", "snapshot_atomic", "scope", "completeness", "assets",
    "uncovered_scopes", "no_order", "execution_authority_granted"].concat(
      Object.hasOwn(raw || {}, "wallet_valuation") ? ["wallet_valuation"] : [],
      Object.hasOwn(raw || {}, "provider_product_type") ? ["provider_product_type"] : []));
  if (raw.schema_version !== BINANCE_FACTS_SCHEMA || raw.platform !== "binance"
      || raw.scope !== "spot+flexible_earn" || raw.completeness !== "complete_for_scope"
      || raw.snapshot_atomic !== false || raw.no_order !== true || raw.execution_authority_granted !== false) {
    fail("invalid_binance_account_facts");
  }
  exact(raw.source_binding, ["kind", "id"]);
  if (!binding || raw.target_id !== binding.target_id || raw.account_scope_sha256 !== binding.account_scope_sha256
      || raw.source_revision !== binding.reader_revision
      || raw.approved_application_revision !== binding.approved_application_revision
      || raw.source_binding.kind !== BINANCE_FACTS_KIND || raw.source_binding.id !== binding.source_binding.id) {
    fail("binance_account_facts_identity_mismatch", 409);
  }
  const start = instant(raw.observed_started_at), finish = instant(raw.observed_finished_at);
  const spot = instant(raw.spot_observed_at), earn = instant(raw.earn_observed_at);
  if (start > spot || spot > earn || earn > finish || finish - start > 5 * 60 * 1000
      || finish > now + 60 * 1000 || (ingest && now - finish > 10 * 60 * 1000)) {
    fail("binance_account_facts_observation_invalid", 409);
  }
  safeProviderProductType(raw, start, spot, finish);
  if (!Array.isArray(raw.uncovered_scopes) || raw.uncovered_scopes.length !== UNCOVERED.length
      || UNCOVERED.some((name, index) => raw.uncovered_scopes[index] !== name)) fail("invalid_binance_account_facts");
  if (Object.hasOwn(raw, "wallet_valuation")) {
    const valuation = raw.wallet_valuation;
    if (!valuation || typeof valuation !== "object" || Array.isArray(valuation)
        || valuation.source !== WALLET_VALUATION_SOURCE || valuation.scope !== WALLET_VALUATION_SCOPE) {
      fail("invalid_binance_account_facts_wallet_valuation");
    }
    if (valuation.status === "available") {
      exact(valuation, ["status", "amount", "currency", "source", "scope", "observed_at", "wallet_count"]);
      const valuationAt = instant(valuation.observed_at);
      if (typeof valuation.amount !== "string" || !CANONICAL_DECIMAL.test(valuation.amount)
          || valuation.currency !== "USDT"
          || !Number.isInteger(valuation.wallet_count) || valuation.wallet_count < 1 || valuation.wallet_count > 32
          || valuationAt < earn || valuationAt > finish) {
        fail("invalid_binance_account_facts_wallet_valuation");
      }
    } else if (valuation.status === "unavailable") {
      exact(valuation, ["status", "amount", "currency", "source", "scope", "observed_at", "wallet_count", "reason_code"]);
      if (valuation.amount !== null || valuation.currency !== null || valuation.observed_at !== null
          || valuation.wallet_count !== null || !WALLET_VALUATION_FAILURES.has(valuation.reason_code)) {
        fail("invalid_binance_account_facts_wallet_valuation");
      }
    } else {
      fail("invalid_binance_account_facts_wallet_valuation");
    }
  }
  if (!Array.isArray(raw.assets) || raw.assets.length > 5000) fail("invalid_binance_account_facts_assets");
  const seen = new Set();
  for (const asset of raw.assets) {
    exact(asset, ["asset", "quantity", "spot_free", "spot_locked", "flexible_earn"]);
    if (!validNativeAsset(asset.asset) || seen.has(asset.asset)) {
      fail("invalid_binance_account_facts_assets");
    }
    seen.add(asset.asset);
    const total = units(asset.quantity);
    if (!total || total !== units(asset.spot_free) + units(asset.spot_locked) + units(asset.flexible_earn)) {
      fail("invalid_binance_account_facts_quantity");
    }
  }
  return raw;
}

export function projectBinanceAccountFacts(raw, binding, { now = Date.now() } = {}) {
  const report = normalizeBinanceAccountFacts(raw, binding, { now });
  if (now - instant(report.observed_finished_at) > BINANCE_FACTS_STALE_MS) return null;
  const providerProductType = safeProviderProductType(
    report,
    instant(report.observed_started_at),
    instant(report.spot_observed_at),
    instant(report.observed_finished_at),
  );
  return {
    platform: "binance", account_key: binding.account_key, scope: report.scope,
    observed_finished_at: report.observed_finished_at, snapshot_atomic: false,
    assets: report.assets.map(row => ({ ...row })), uncovered_scopes: [...UNCOVERED],
    ...(providerProductType ? { provider_product_type: providerProductType } : {}),
    ...(Object.hasOwn(report, "wallet_valuation")
      ? { wallet_valuation: { ...report.wallet_valuation } }
      : {}),
  };
}

export function binanceWalletHistoryStorageKey(binding) {
  return `${binding.account_key}:${binding.source_binding.id}`;
}

export function binanceWalletHistoryEntry(report, binding) {
  const valuation = report.wallet_valuation;
  const available = valuation?.status === "available";
  const reportFinishedAt = report.observed_finished_at;
  const observedAt = available ? valuation.observed_at : null;
  return normalizeBinanceWalletHistoryEntry({
    schema_version: BINANCE_WALLET_HISTORY_SCHEMA,
    metric: BINANCE_WALLET_HISTORY_METRIC,
    currency: "USDT",
    scope: BINANCE_WALLET_HISTORY_SCOPE,
    status: available ? "available" : "gap",
    observation_date: new Date(Date.parse(observedAt || reportFinishedAt)).toISOString().slice(0, 10),
    amount: available ? valuation.amount : null,
    observed_at: observedAt,
    report_observed_finished_at: reportFinishedAt,
    target_id: binding.target_id,
    account_scope: binding.account_scope,
    source_binding: binding.source_binding,
  }, binding);
}

export function normalizeBinanceWalletHistoryEntry(raw, binding) {
  const fields = ["schema_version", "metric", "currency", "scope", "status", "observation_date", "amount",
    "observed_at", "report_observed_finished_at", "target_id", "account_scope", "source_binding"];
  exact(raw, fields);
  exact(raw.source_binding, ["kind", "id"]);
  if (raw.schema_version !== BINANCE_WALLET_HISTORY_SCHEMA || raw.metric !== BINANCE_WALLET_HISTORY_METRIC
      || raw.currency !== "USDT" || raw.scope !== BINANCE_WALLET_HISTORY_SCOPE
      || !["available", "gap"].includes(raw.status)
      || raw.target_id !== binding?.target_id || raw.account_scope !== binding?.account_scope
      || raw.source_binding?.kind !== binding?.source_binding?.kind
      || raw.source_binding?.id !== binding?.source_binding?.id) {
    fail("invalid_binance_wallet_history");
  }
  const reportFinished = instant(raw.report_observed_finished_at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.observation_date)
      || !Number.isFinite(Date.parse(`${raw.observation_date}T00:00:00Z`))
      || new Date(Date.parse(`${raw.observation_date}T00:00:00Z`)).toISOString().slice(0, 10) !== raw.observation_date) {
    fail("invalid_binance_wallet_history");
  }
  if (raw.status === "available") {
    const observed = instant(raw.observed_at);
    if (typeof raw.amount !== "string" || !CANONICAL_DECIMAL.test(raw.amount)
        || raw.observation_date !== new Date(observed).toISOString().slice(0, 10)
        || observed > reportFinished || reportFinished - observed > 5 * 60 * 1000) {
      fail("invalid_binance_wallet_history");
    }
  } else if (raw.amount !== null || raw.observed_at !== null
      || raw.observation_date !== new Date(reportFinished).toISOString().slice(0, 10)) {
    fail("invalid_binance_wallet_history");
  }
  return raw;
}

export function projectBinanceWalletHistory(days, binding) {
  const normalized = days.map((entry) => normalizeBinanceWalletHistoryEntry(entry, binding))
    .sort((left, right) => left.observation_date.localeCompare(right.observation_date));
  const byDate = new Map();
  for (const entry of normalized) {
    if (byDate.has(entry.observation_date)) fail("invalid_binance_wallet_history");
    byDate.set(entry.observation_date, entry);
  }
  const dates = [...byDate.keys()];
  const gapDates = [];
  if (dates.length) {
    let cursor = Date.parse(`${dates[0]}T00:00:00Z`);
    const last = Date.parse(`${dates.at(-1)}T00:00:00Z`);
    for (; cursor <= last; cursor += 86_400_000) {
      const date = new Date(cursor).toISOString().slice(0, 10);
      if (byDate.get(date)?.status !== "available") gapDates.push(date);
    }
  }
  return {
    ok: true,
    metric: BINANCE_WALLET_HISTORY_METRIC,
    currency: "USDT",
    scope: BINANCE_WALLET_HISTORY_SCOPE,
    points: normalized.filter((entry) => entry.status === "available").map((entry) => ({
      observation_date: entry.observation_date,
      observed_at: entry.observed_at,
      amount: entry.amount,
    })),
    gap_dates: gapDates,
    first_sample_date: normalized.find((entry) => entry.status === "available")?.observation_date ?? null,
    retention_days: BINANCE_WALLET_HISTORY_MAX_DAYS,
    return: { status: "unavailable", reason: "external_cashflow_required" },
  };
}

function sameWalletHistoryObservation(left, right) {
  return ["schema_version", "metric", "currency", "scope", "status", "observation_date", "amount",
    "observed_at", "target_id", "account_scope"]
    .every((field) => left[field] === right[field]);
}

export function projectBinanceWalletHistoryFromSources(buckets, currentBinding, historyBindings) {
  const history = normalizeBinanceFactsHistoryBindings(historyBindings, currentBinding);
  const current = normalizeBinanceFactsBinding(currentBinding);
  if (!Array.isArray(buckets) || buckets.length !== history.length + 1
      || buckets[0]?.binding?.source_binding?.id !== current.source_binding.id) {
    fail("binance_wallet_history_stored_invalid", 409);
  }
  const byDate = new Map();
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    const binding = index === 0 ? current : history[index - 1];
    if (bucket?.binding?.source_binding?.id !== binding.source_binding.id
        || !Array.isArray(bucket.days) || bucket.days.length > BINANCE_WALLET_HISTORY_MAX_DAYS) {
      fail("binance_wallet_history_stored_invalid", 409);
    }
    const sourceDates = new Set();
    for (const value of bucket.days) {
      let entry;
      try { entry = normalizeBinanceWalletHistoryEntry(value, binding); }
      catch { fail("binance_wallet_history_stored_invalid", 409); }
      if (sourceDates.has(entry.observation_date)) fail("binance_wallet_history_stored_invalid", 409);
      sourceDates.add(entry.observation_date);
      const existing = byDate.get(entry.observation_date);
      const finishedAt = Date.parse(entry.report_observed_finished_at);
      const existingFinishedAt = existing ? Date.parse(existing.entry.report_observed_finished_at) : -Infinity;
      if (!existing || finishedAt > existingFinishedAt) {
        byDate.set(entry.observation_date, { entry, binding });
      } else if (finishedAt === existingFinishedAt
          && !sameWalletHistoryObservation(entry, existing.entry)) {
        fail("binance_wallet_history_conflict", 409);
      }
    }
  }
  const allRows = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (allRows.length) {
    const latestDay = Date.parse(`${allRows.at(-1)[0]}T00:00:00Z`);
    const cutoff = new Date(latestDay - (BINANCE_WALLET_HISTORY_MAX_DAYS - 1) * 86_400_000)
      .toISOString().slice(0, 10);
    for (const [date] of allRows) if (date < cutoff) byDate.delete(date);
  }
  const rows = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right));
  const gapDates = [];
  if (rows.length) {
    let cursor = Date.parse(`${rows[0][0]}T00:00:00Z`);
    const last = Date.parse(`${rows.at(-1)[0]}T00:00:00Z`);
    for (; cursor <= last; cursor += 86_400_000) {
      const date = new Date(cursor).toISOString().slice(0, 10);
      if (byDate.get(date)?.entry.status !== "available") gapDates.push(date);
    }
  }
  const points = [];
  let previousSource = null;
  for (const [, value] of rows) {
    if (value.entry.status !== "available") continue;
    const point = {
      observation_date: value.entry.observation_date,
      observed_at: value.entry.observed_at,
      amount: value.entry.amount,
      ...(previousSource && previousSource !== value.binding.source_binding.id ? { break_before: true } : {}),
    };
    points.push(point);
    previousSource = value.binding.source_binding.id;
  }
  return {
    ok: true,
    metric: BINANCE_WALLET_HISTORY_METRIC,
    currency: "USDT",
    scope: BINANCE_WALLET_HISTORY_SCOPE,
    points,
    gap_dates: gapDates,
    first_sample_date: points[0]?.observation_date ?? null,
    retention_days: BINANCE_WALLET_HISTORY_MAX_DAYS,
    return: { status: "unavailable", reason: "external_cashflow_required" },
  };
}
