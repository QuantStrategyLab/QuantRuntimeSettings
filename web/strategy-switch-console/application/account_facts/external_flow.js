// Private account-facts extension. Never infer complete coverage from an empty list.
import { dateMs } from "../../performance_math.js";

export const EXTERNAL_FLOW_SCHEMA = "external_flow.v1";
export const DATED_FLOW_SCHEMA = "external_flow.v2";
const DAY = 86400000;
const SOURCES = new Set(["ibkr_flex", "schwab_transactions", "longbridge_cashflow", "binance_history"]);
const TYPES = new Set(["deposit", "withdrawal", "transfer_in", "transfer_out"]);
const HASH = /^[a-f0-9]{64}$/;
const MONEY = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/;
export const dateOnlyExternalFlow = flow => flow?.schema_version === DATED_FLOW_SCHEMA
  && flow.windows.every(w => w.time_precision === "date");
export const externalFlowEnabled = (env) => env?.CONSOLE_EXTERNAL_FLOW_ENABLED === "true";
export function flowError(code = "invalid_external_flow", status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}
function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
export function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19) ? ms : NaN;
}
const windowKey = w => `${w.currency}:${w.time_precision || "instant"}:${w.period_start}:${w.period_end}`;
const day = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(dateMs(value)) && new Date(dateMs(value)).toISOString().slice(0, 10) === value;
const stable = value => JSON.stringify(value);

export function normalizeExternalFlow(raw, { now = Date.now(), maxWindows = 31, maxRecords = 256 } = {}) {
  if (!exact(raw, ["schema_version", "windows"]) || ![EXTERNAL_FLOW_SCHEMA, DATED_FLOW_SCHEMA].includes(raw.schema_version)
      || !Array.isArray(raw.windows) || !raw.windows.length || raw.windows.length > maxWindows
      || new TextEncoder().encode(stable(raw)).length > (maxWindows === 31 ? 32768 : 524288)) throw flowError();
  let count = 0;
  const seen = new Map();
  const keys = new Set();
  const windows = raw.windows.map(w => {
    const dated = raw.schema_version === DATED_FLOW_SCHEMA && w?.time_precision === "date";
    if (!exact(w, ["currency", "date", "period_start", "period_end", "coverage", "source", "records", ...(dated ? ["time_precision"] : [])])
        || !/^[A-Z][A-Z0-9]{2,9}$/.test(w.currency) || !Number.isFinite(dateMs(w.date))
        || !SOURCES.has(w.source) || !(dated ? w.coverage === "reported" : ["complete", "incomplete"].includes(w.coverage))
        || !Array.isArray(w.records)) throw flowError();
    const start = dated ? dateMs(w.period_start) : instant(w.period_start);
    const end = dated ? dateMs(w.period_end) : instant(w.period_end);
    if (!Number.isFinite(start) || !Number.isFinite(end)
        || (dated ? !day(w.period_start) || !day(w.period_end) || end < start || end - start >= 31 * DAY
          : end <= start || end - start > 2 * DAY)
        || end > now || w.date !== w.period_end.slice(0, 10) || keys.has(windowKey(w))) throw flowError();
    keys.add(windowKey(w));
    const refs = new Map();
    for (const r of w.records) {
      if (++count > maxRecords || !exact(r, ["source_ref", "type", "amount", dated ? "effective_date" : "effective_at", "settlement_date", "transfer_ref"])
          || !HASH.test(r.source_ref) || !TYPES.has(r.type) || typeof r.amount !== "string" || !MONEY.test(r.amount)
          || !Number.isFinite(Number(r.amount)) || Number(r.amount) === 0
          || ((r.type === "deposit" || r.type === "transfer_in") !== (Number(r.amount) > 0))
          || (r.settlement_date !== null && !Number.isFinite(dateMs(r.settlement_date)))
          || (r.transfer_ref !== null && !HASH.test(r.transfer_ref))) throw flowError();
      const at = dated ? dateMs(r.effective_date) : instant(r.effective_at);
      if (!Number.isFinite(at) || (dated ? !day(r.effective_date) || at < start : at <= start) || at > end) throw flowError();
      const record = { source_ref: r.source_ref, type: r.type, amount: r.amount,
        ...(dated ? { effective_date: r.effective_date } : { effective_at: r.effective_at }),
        settlement_date: r.settlement_date, transfer_ref: r.transfer_ref };
      const prior = seen.get(r.source_ref);
      const identity = stable({ currency: w.currency, source: w.source, ...record });
      if (prior && prior !== identity) throw flowError("external_flow_conflict", 409);
      seen.set(r.source_ref, identity);
      refs.set(r.source_ref, record);
    }
    return { currency: w.currency, date: w.date, period_start: w.period_start, period_end: w.period_end,
      coverage: w.coverage, source: w.source, ...(dated ? { time_precision: "date" } : {}),
      records: [...refs.values()].sort((a, b) => a.source_ref.localeCompare(b.source_ref)) };
  }).sort((a, b) => windowKey(a).localeCompare(windowKey(b)));
  // Timestamp spellings with and without fractions do not sort by instant.
  // Keep the existing serialized order, but compare exact-time windows by time.
  const preciseWindows = windows.filter(w => !w.time_precision).sort((a, b) =>
    a.currency.localeCompare(b.currency) || instant(a.period_start) - instant(b.period_start));
  for (let i = 1; i < preciseWindows.length; i++) {
    const a = preciseWindows[i], b = preciseWindows[i - 1];
    if (a.currency === b.currency && instant(a.period_start) < instant(b.period_end))
      throw flowError("external_flow_overlap", 409);
  }
  return { schema_version: raw.schema_version, windows };
}

export function mergeExternalFlow(prior, incoming) {
  const rows = new Map((prior?.windows || []).map(w => [windowKey(w), w]));
  for (const w of incoming.windows) {
    const old = rows.get(windowKey(w));
    if (old && stable(old) !== stable(w)) {
      // Coverage may be completed later, but facts already accepted are immutable.
      if ((old.coverage !== "incomplete" && old.time_precision !== "date") || w.source !== old.source
          || old.records.some(r => !w.records.some(n => stable(n) === stable(r)))) throw flowError("external_flow_conflict", 409);
    }
    rows.set(windowKey(w), w);
  }
  const newest = Math.max(...[...rows.values()].map(w => dateMs(w.date)));
  const windows = [...rows.values()].filter(w => dateMs(w.date) >= newest - 365 * DAY);
  const schema_version = [prior?.schema_version, incoming.schema_version].includes(DATED_FLOW_SCHEMA)
    ? DATED_FLOW_SCHEMA : EXTERNAL_FLOW_SCHEMA;
  return normalizeExternalFlow({ schema_version, windows }, { maxWindows: 4096, maxRecords: 4096 });
}

export function initializeExternalFlow(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS account_external_flow (platform TEXT NOT NULL, account_key TEXT NOT NULL, context_json TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(platform, account_key))");
}
const identity = c => stable([c.target_id, c.source_binding_id, c.account_scope, c.account_selector,
  c.broker_account_hash ?? null, c.broker_account_id ?? null]);
export function readExternalFlow(sql, context, { dateOnly = false } = {}) {
  const row = sql.exec("SELECT context_json, payload_json FROM account_external_flow WHERE platform = ? AND account_key = ?",
    context.platform, context.account_key).toArray()[0];
  if (!row || row.context_json !== identity(context)) return null;
  const flow = normalizeExternalFlow(JSON.parse(row.payload_json), { maxWindows: 4096, maxRecords: 4096 });
  if (!dateOnly) return flow;
  const windows = flow.windows.filter(w => w.time_precision === "date");
  return windows.length ? { schema_version: DATED_FLOW_SCHEMA, windows } : null;
}
export function putExternalFlow(sql, context, raw) {
  const incoming = normalizeExternalFlow(raw);
  const prior = readExternalFlow(sql, context);
  const merged = mergeExternalFlow(prior, incoming);
  if (stable(prior) === stable(merged)) return { unchanged: true };
  sql.exec("INSERT INTO account_external_flow (platform, account_key, context_json, payload_json) VALUES (?, ?, ?, ?) ON CONFLICT(platform, account_key) DO UPDATE SET context_json = excluded.context_json, payload_json = excluded.payload_json",
    context.platform, context.account_key, identity(context), stable(merged));
  return { unchanged: false };
}
