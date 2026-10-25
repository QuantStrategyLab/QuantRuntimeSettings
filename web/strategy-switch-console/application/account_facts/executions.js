// Broker executions are private observed facts, not orders or a complete P/L ledger.
import { dateMs } from "../../performance_math.js";

export const EXECUTIONS_SCHEMA = "broker_executions.v1";
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/;
const FEE_DECIMAL = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,18})?$/;
const CURRENCY = /^[A-Z][A-Z0-9]{2,9}$/;
const DAY = 86400000;
const KEYS = ["schema_version", "target_id", "source_binding_id", "account_scope", "account_selector",
  "period", "observed_at", "source", "source_ref", "coverage", "records"];
const RECORD_KEYS = ["execution_ref", "report_ref", "trade_date", "local_time", "time_zone", "symbol",
  "asset_category", "side", "quantity", "price", "currency", "commission", "commission_currency", "taxes"];
const OPTIONAL = ["local_time", "time_zone", "commission", "commission_currency", "taxes"];
const stable = value => JSON.stringify(value);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const day = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(dateMs(value)) && new Date(dateMs(value)).toISOString().slice(0, 10) === value;
const decimal = value => typeof value === "string" && DECIMAL.test(value) && Number.isFinite(Number(value));
const feeDecimal = value => typeof value === "string" && FEE_DECIMAL.test(value);
export function executionError(code = "invalid_broker_executions", status = 400) {
  return Object.assign(new Error(code), { code, status });
}

export function normalizeExecutions(raw, { binding, now = Date.now(), enforceFresh = true,
  maxRecords = 256, maxPeriodDays = 366 } = {}) {
  if (!exact(raw, KEYS) || raw.schema_version !== EXECUTIONS_SCHEMA || raw.source !== "ibkr_flex"
      || raw.coverage !== "reported_executions" || !HASH.test(raw.source_ref)
      || !HASH.test(raw.source_binding_id) || !Array.isArray(raw.records) || raw.records.length > maxRecords
      || !exact(raw.period, ["from", "to"]) || !day(raw.period.from) || !day(raw.period.to)
      || raw.period.from > raw.period.to || dateMs(raw.period.to) - dateMs(raw.period.from) >= maxPeriodDays * DAY
      || dateMs(raw.period.to) > now || typeof raw.observed_at !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(raw.observed_at)
      || !Number.isFinite(Date.parse(raw.observed_at)) || Date.parse(raw.observed_at) > now + 300000
      || (enforceFresh && now - Date.parse(raw.observed_at) > 2 * DAY)) throw executionError();
  for (const name of ["target_id", "account_scope", "account_selector"]) {
    if (typeof raw[name] !== "string" || !raw[name] || raw[name].length > 256) throw executionError();
  }
  if (binding && (raw.target_id !== binding.target_id || raw.account_scope !== binding.account_scope
      || raw.account_selector !== binding.account_selector
      || raw.source_binding_id !== (binding.source_binding?.id ?? binding.source_binding_id))) {
    throw executionError("execution_identity_mismatch", 409);
  }
  const seen = new Set();
  const records = raw.records.map(row => {
    if (!exact(row, RECORD_KEYS) || !HASH.test(row.execution_ref) || !HASH.test(row.report_ref)
        || !day(row.trade_date) || row.trade_date < raw.period.from || row.trade_date > raw.period.to
        || !["BUY", "SELL"].includes(row.side) || !decimal(row.quantity) || Number(row.quantity) === 0
        || !decimal(row.price) || Number(row.price) < 0 || !CURRENCY.test(row.currency)
        || typeof row.symbol !== "string" || !/^[A-Z0-9][A-Z0-9. /_-]{0,63}$/.test(row.symbol)
        || typeof row.asset_category !== "string" || !/^[A-Z][A-Z0-9_]{0,15}$/.test(row.asset_category)
        || (row.commission !== null && !feeDecimal(row.commission))
        || (row.taxes !== null && !feeDecimal(row.taxes))
        || (row.commission_currency !== null && !CURRENCY.test(row.commission_currency))
        || seen.has(row.execution_ref)) throw executionError();
    seen.add(row.execution_ref);
    if (row.local_time !== null && (typeof row.local_time !== "string"
        || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(row.local_time)
        || row.local_time.slice(0, 10) !== row.trade_date)) throw executionError();
    if (row.time_zone !== null) {
      if (typeof row.time_zone !== "string" || row.time_zone.length > 64) throw executionError();
      try { new Intl.DateTimeFormat("en", { timeZone: row.time_zone }); } catch { throw executionError(); }
    }
    return Object.fromEntries(RECORD_KEYS.map(key => [key, row[key]]));
  }).sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.execution_ref.localeCompare(b.execution_ref));
  const result = { ...raw, period: { ...raw.period }, records };
  if (new TextEncoder().encode(stable(result)).length > 1048576) throw executionError("execution_history_too_large", 413);
  return result;
}

function mergeRecord(old, incoming) {
  const result = { ...old };
  for (const key of RECORD_KEYS) {
    if (key === "report_ref") continue;
    if (OPTIONAL.includes(key)) {
      if (old[key] === null) result[key] = incoming[key];
      else if (incoming[key] !== null && incoming[key] !== old[key]) throw executionError("execution_history_conflict", 409);
    } else if (old[key] !== incoming[key]) throw executionError("execution_history_conflict", 409);
  }
  if (stable(result) !== stable(old)) result.report_ref = incoming.report_ref;
  return result;
}

export function mergeExecutions(prior, incoming) {
  if (!prior) return incoming;
  for (const key of ["target_id", "source_binding_id", "account_scope", "account_selector", "source"]) {
    if (prior[key] !== incoming[key]) throw executionError("execution_identity_mismatch", 409);
  }
  const rows = new Map(prior.records.map(row => [row.execution_ref, row]));
  for (const row of incoming.records) rows.set(row.execution_ref,
    rows.has(row.execution_ref) ? mergeRecord(rows.get(row.execution_ref), row) : row);
  const latest = Date.parse(incoming.observed_at) >= Date.parse(prior.observed_at) ? incoming : prior;
  return normalizeExecutions({ ...latest, period: {
    from: prior.period.from < incoming.period.from ? prior.period.from : incoming.period.from,
    to: prior.period.to > incoming.period.to ? prior.period.to : incoming.period.to,
  }, records: [...rows.values()] }, { enforceFresh: false, maxRecords: 2048, maxPeriodDays: 36500 });
}

const identity = context => stable([context.platform, context.target_id, context.account_scope,
  context.account_selector, context.broker_account_hash ?? null, context.broker_account_id ?? null]);
export function initializeExecutions(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS account_executions (platform TEXT NOT NULL, account_key TEXT NOT NULL, source_binding_id TEXT NOT NULL, context_json TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(platform, account_key, source_binding_id))");
}
export function readExecutions(sql, context) {
  const allowed = [context.source_binding_id, ...(context.history_source_binding_ids || [])];
  const rows = sql.exec(`SELECT source_binding_id, context_json, payload_json FROM account_executions
    WHERE platform = ? AND account_key = ? AND source_binding_id IN (${allowed.map(() => "?").join(",")})`,
  context.platform, context.account_key, ...allowed).toArray();
  const records = new Map();
  const reports = [];
  for (const stored of rows) {
    if (stored.context_json !== identity(context)) continue;
    const payload = normalizeExecutions(JSON.parse(stored.payload_json), { binding: { ...context,
      source_binding_id: stored.source_binding_id }, enforceFresh: false, maxRecords: 2048, maxPeriodDays: 36500 });
    reports.push({ period: payload.period, observed_at: payload.observed_at, coverage: payload.coverage });
    for (const row of payload.records) records.set(row.execution_ref,
      records.has(row.execution_ref) ? mergeRecord(records.get(row.execution_ref), row) : row);
  }
  if (!reports.length) return null;
  return { source: "ibkr_flex", coverage: "reported_executions", reports,
    records: [...records.values()].sort((a, b) => b.trade_date.localeCompare(a.trade_date) || a.execution_ref.localeCompare(b.execution_ref)) };
}
export function putExecutions(sql, context, raw) {
  const incoming = normalizeExecutions(raw, { binding: context });
  if (incoming.records.some(row => row.report_ref !== incoming.source_ref)) throw executionError();
  const stored = sql.exec("SELECT context_json, payload_json FROM account_executions WHERE platform = ? AND account_key = ? AND source_binding_id = ?",
    context.platform, context.account_key, context.source_binding_id).toArray()[0];
  const prior = stored?.context_json === identity(context)
    ? normalizeExecutions(JSON.parse(stored.payload_json), { binding: context, enforceFresh: false,
      maxRecords: 2048, maxPeriodDays: 36500 }) : null;
  const merged = mergeExecutions(prior, incoming);
  if (stable(prior) === stable(merged)) return { unchanged: true };
  sql.exec("INSERT INTO account_executions (platform, account_key, source_binding_id, context_json, payload_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(platform, account_key, source_binding_id) DO UPDATE SET context_json = excluded.context_json, payload_json = excluded.payload_json",
    context.platform, context.account_key, context.source_binding_id, identity(context), stable(merged));
  return { unchanged: false };
}
