// Pure account-facts projection helpers. Keeps broker snapshot history out of
// runtime-daily and never invents FX totals, returns, or historical backfill.

export const ACCOUNT_FACTS_BINDINGS_SCHEMA = "qsl_account_facts_bindings.v1";
export const ACCOUNT_FACTS_HISTORY_SCHEMA = "longbridge_account_snapshot_history.v1";
export const ACCOUNT_FACTS_SNAPSHOT_SCHEMA = "longbridge_account_snapshot.v1";
export const ACCOUNT_FACTS_SOURCE_KIND = "deployment_scope_token_version";
export const ACCOUNT_FACTS_BINDINGS_KEY = "account_facts_bindings";
export const ACCOUNT_FACTS_PLATFORM = "longbridge";
export const ACCOUNT_FACTS_PAYLOAD_SCOPE = "PAPER";
export const ACCOUNT_FACTS_OPTION_SCOPE = "paper";
export const ACCOUNT_FACTS_MAX_BODY_BYTES = 64 * 1024;
export const ACCOUNT_FACTS_STALE_MS = 36 * 60 * 60 * 1000;
export const ACCOUNT_FACTS_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const ACCOUNT_FACTS_OBSERVATION_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_FACTS_MAX_MONEY_SCALE = 8;
export const ACCOUNT_FACTS_MAX_MONEY_DIGITS = 15;
export const ACCOUNT_FACTS_RETURN_UNAVAILABLE = Object.freeze({
  status: "unavailable",
  reason: "external_cashflow_required",
});

const BINDING_ID_RE = /^[0-9a-f]{64}$/;
const TARGET_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const ACCOUNT_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const ACCOUNT_SCOPE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const OPTION_IDENTITY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const OPTION_IDENTITY_FIELDS = ["target_name", "service_name", "deployment_selector", "account_selector"];
const CURRENCY_RE = /^[A-Z]{3}$/;
const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BALANCE_FIELDS = ["currency", "net_assets", "total_cash"];
const CASH_FIELDS = ["currency", "available_cash", "frozen_cash", "settling_cash"];

export class AccountFactsError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function reject(code, status = 400) {
  throw new AccountFactsError(code, status);
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function parseInstant(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return null;
  if (match[7] !== "Z" && (Number(match[8]) > 23 || Number(match[9]) > 59)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calendarDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return value;
}

function assertMoneyText(cell, fieldName) {
  if (typeof cell !== "string" || !DECIMAL_RE.test(cell)) reject(`invalid_account_facts_${fieldName}`);
  const unsigned = cell.startsWith("-") ? cell.slice(1) : cell;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > ACCOUNT_FACTS_MAX_MONEY_SCALE) reject("invalid_account_facts_money_scale");
  if (whole.length > ACCOUNT_FACTS_MAX_MONEY_DIGITS) reject("invalid_account_facts_money_magnitude");
}

function moneyRows(value, fields, fieldName) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) reject(`invalid_account_facts_${fieldName}`);
  const seen = new Set();
  return value.map((item) => {
    if (!exactKeys(item, fields)) reject(`invalid_account_facts_${fieldName}`);
    const row = {};
    for (const field of fields) {
      const cell = item[field];
      if (field === "currency") {
        if (typeof cell !== "string" || !CURRENCY_RE.test(cell) || seen.has(cell)) {
          reject(`invalid_account_facts_${fieldName}`);
        }
        seen.add(cell);
        row.currency = cell;
        continue;
      }
      assertMoneyText(cell, fieldName);
      row[field] = cell;
    }
    return row;
  });
}

export function accountFactsReadModelEnabled(env) {
  return String(env?.ACCOUNT_FACTS_READ_MODEL_ENABLED || "") === "true";
}

export function canonicalizeAccountFactsHistory(history) {
  return JSON.stringify(history);
}

function requireOptionIdentityField(value) {
  if (typeof value !== "string" || !OPTION_IDENTITY_RE.test(value) || value.length > 120) {
    reject("invalid_account_facts_bindings");
  }
  return value;
}

export function normalizeAccountFactsBindings(raw) {
  if (!exactKeys(raw, ["schema_version", "bindings"])) reject("invalid_account_facts_bindings");
  if (raw.schema_version !== ACCOUNT_FACTS_BINDINGS_SCHEMA) reject("invalid_account_facts_bindings");
  if (!Array.isArray(raw.bindings) || raw.bindings.length > 64) reject("invalid_account_facts_bindings");
  const byAccount = new Map();
  const bySource = new Map();
  const bindings = raw.bindings.map((item, index) => {
    if (!exactKeys(item, [
      "platform", "account_key", "account_scope",
      "target_name", "service_name", "deployment_selector", "account_selector",
      "target_id", "source_binding",
    ])) {
      reject("invalid_account_facts_bindings");
    }
    if (item.platform !== ACCOUNT_FACTS_PLATFORM) reject("invalid_account_facts_bindings");
    if (typeof item.account_key !== "string" || !ACCOUNT_KEY_RE.test(item.account_key)) reject("invalid_account_facts_bindings");
    if (typeof item.account_scope !== "string" || !ACCOUNT_SCOPE_RE.test(item.account_scope)) {
      reject("invalid_account_facts_bindings");
    }
    // This LongBridge history entry only accepts the configured PAPER option scope.
    if (item.account_scope !== ACCOUNT_FACTS_OPTION_SCOPE) reject("invalid_account_facts_bindings");
    if (typeof item.target_id !== "string" || !TARGET_ID_RE.test(item.target_id)) reject("invalid_account_facts_bindings");
    if (!exactKeys(item.source_binding, ["kind", "id"])) reject("invalid_account_facts_bindings");
    if (item.source_binding.kind !== ACCOUNT_FACTS_SOURCE_KIND) reject("invalid_account_facts_bindings");
    if (typeof item.source_binding.id !== "string" || !BINDING_ID_RE.test(item.source_binding.id)) {
      reject("invalid_account_facts_bindings");
    }
    const identity = {
      target_name: requireOptionIdentityField(item.target_name),
      service_name: requireOptionIdentityField(item.service_name),
      deployment_selector: requireOptionIdentityField(item.deployment_selector),
      account_selector: requireOptionIdentityField(item.account_selector),
    };
    const accountId = `${item.platform}:${item.account_key}`;
    const sourceId = `${item.target_id}|${item.source_binding.id}`;
    if (byAccount.has(accountId) || bySource.has(sourceId)) reject("duplicate_account_facts_binding");
    byAccount.set(accountId, index);
    bySource.set(sourceId, index);
    return {
      platform: ACCOUNT_FACTS_PLATFORM,
      account_key: item.account_key,
      account_scope: item.account_scope,
      ...identity,
      target_id: item.target_id,
      source_binding: {
        kind: ACCOUNT_FACTS_SOURCE_KIND,
        id: item.source_binding.id,
      },
    };
  });
  return { schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings };
}

export function resolveTrustedAccountFactsBinding(bindings, targetId, sourceBindingId) {
  if (!bindings || !Array.isArray(bindings.bindings)) {
    return { ok: false, reason: "account_facts_bindings_missing" };
  }
  const matches = bindings.bindings.filter(
    (item) => item.target_id === targetId && item.source_binding.id === sourceBindingId,
  );
  if (matches.length === 0) return { ok: false, reason: "account_facts_binding_unmatched" };
  if (matches.length > 1) return { ok: false, reason: "duplicate_account_facts_binding" };
  if (matches[0].platform !== ACCOUNT_FACTS_PLATFORM) {
    return { ok: false, reason: "account_facts_platform_unsupported" };
  }
  return { ok: true, binding: matches[0] };
}

export function accountFactsOptionMatchesBinding(option, binding) {
  if (!option || !binding) return false;
  if (binding.platform !== ACCOUNT_FACTS_PLATFORM) return false;
  if (option.key !== binding.account_key) return false;
  if (typeof option.account_scope !== "string" || option.account_scope !== binding.account_scope) return false;
  if (binding.account_scope !== ACCOUNT_FACTS_OPTION_SCOPE) return false;
  for (const field of OPTION_IDENTITY_FIELDS) {
    if (typeof option[field] !== "string" || option[field] !== binding[field]) return false;
  }
  return true;
}

export function normalizeAccountFactsHistoryPayload(raw, {
  now = Date.now(),
  expectedTargetId,
  expectedBindingId,
  enforceObservationWindow = true,
} = {}) {
  if (!exactKeys(raw, [
    "schema_version", "snapshot_schema_version", "account_scope", "target_id", "source_binding",
    "observed_started_at", "observed_finished_at", "snapshot_atomic", "observation_date",
    "broker_reported_balances", "cash",
  ])) reject("invalid_account_facts_history");
  if (raw.schema_version !== ACCOUNT_FACTS_HISTORY_SCHEMA) reject("invalid_account_facts_history");
  if (raw.snapshot_schema_version !== ACCOUNT_FACTS_SNAPSHOT_SCHEMA) reject("invalid_account_facts_history");
  if (raw.account_scope !== ACCOUNT_FACTS_PAYLOAD_SCOPE) reject("invalid_account_facts_scope");
  if (typeof raw.target_id !== "string" || !TARGET_ID_RE.test(raw.target_id)) reject("invalid_account_facts_target");
  if (expectedTargetId && raw.target_id !== expectedTargetId) reject("account_facts_target_mismatch");
  if (!exactKeys(raw.source_binding, ["kind", "status", "id"])) reject("invalid_account_facts_source_binding");
  if (
    raw.source_binding.kind !== ACCOUNT_FACTS_SOURCE_KIND
    || raw.source_binding.status !== "bound"
    || typeof raw.source_binding.id !== "string"
    || !BINDING_ID_RE.test(raw.source_binding.id)
  ) reject("invalid_account_facts_source_binding");
  if (expectedBindingId && raw.source_binding.id !== expectedBindingId) reject("account_facts_binding_mismatch");
  if (raw.snapshot_atomic !== false) reject("invalid_account_facts_history");
  const startedMs = parseInstant(raw.observed_started_at);
  const finishedMs = parseInstant(raw.observed_finished_at);
  if (startedMs === null || finishedMs === null) reject("invalid_account_facts_time");
  if (finishedMs < startedMs) reject("invalid_account_facts_time");
  if (finishedMs > now + ACCOUNT_FACTS_FUTURE_SKEW_MS) reject("account_facts_future_observation");
  if (enforceObservationWindow && startedMs < now - ACCOUNT_FACTS_OBSERVATION_WINDOW_MS) {
    reject("account_facts_observation_window");
  }
  const observationDate = calendarDate(raw.observation_date);
  if (!observationDate) reject("invalid_account_facts_date");
  const startedDate = new Date(startedMs).toISOString().slice(0, 10);
  if (observationDate !== startedDate) reject("invalid_account_facts_date");
  const balances = moneyRows(raw.broker_reported_balances, BALANCE_FIELDS, "balances");
  const cash = moneyRows(raw.cash, CASH_FIELDS, "cash");
  return {
    schema_version: ACCOUNT_FACTS_HISTORY_SCHEMA,
    snapshot_schema_version: ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
    account_scope: ACCOUNT_FACTS_PAYLOAD_SCOPE,
    target_id: raw.target_id,
    source_binding: {
      kind: ACCOUNT_FACTS_SOURCE_KIND,
      status: "bound",
      id: raw.source_binding.id,
    },
    observed_started_at: raw.observed_started_at,
    observed_finished_at: raw.observed_finished_at,
    snapshot_atomic: false,
    observation_date: observationDate,
    broker_reported_balances: balances,
    cash,
  };
}

export function decideAccountFactsPut(existing, incomingHistory) {
  const incomingFinished = parseInstant(incomingHistory.observed_finished_at);
  if (incomingFinished === null) reject("invalid_account_facts_time");
  if (!existing) {
    return { action: "insert", unchanged: false };
  }
  const existingFinished = parseInstant(existing.observed_finished_at);
  if (existingFinished === null) reject("invalid_account_facts_stored");
  if (incomingFinished < existingFinished) {
    return { action: "reject", reason: "account_facts_stale_write", status: 409 };
  }
  const samePayload = canonicalizeAccountFactsHistory(existing) === canonicalizeAccountFactsHistory(incomingHistory);
  if (incomingFinished === existingFinished) {
    if (samePayload) return { action: "keep", unchanged: true };
    return { action: "reject", reason: "account_facts_observation_conflict", status: 409 };
  }
  return { action: "replace", unchanged: false };
}

export function projectStoredAccountFacts(stored, { now = Date.now() } = {}) {
  const history = normalizeAccountFactsHistoryPayload(stored, {
    now,
    expectedTargetId: stored?.target_id,
    expectedBindingId: stored?.source_binding?.id,
    enforceObservationWindow: false,
  });
  const finishedMs = parseInstant(history.observed_finished_at);
  const fresh = finishedMs !== null
    && finishedMs <= now + ACCOUNT_FACTS_FUTURE_SKEW_MS
    && now - finishedMs <= ACCOUNT_FACTS_STALE_MS;
  return {
    ...history,
    data_status: fresh ? "fresh" : "stale",
    identity_status: "partial_identity",
    return: { ...ACCOUNT_FACTS_RETURN_UNAVAILABLE },
  };
}

export function aggregateAccountFactsTotals(accountRows) {
  void accountRows;
  // LongBridge evidence is BROKER_API_PARTIAL only. Partial identity cannot
  // prove distinct physical accounts, so all-account totals stay unavailable.
  // Single-account currency facts remain on each account row.
  return {
    status: "unavailable",
    reason: "physical_identity_unverified",
    by_currency: [],
  };
}

export function buildAccountFactsReadModel({
  accountOptions = {},
  bindings = null,
  storedByAccount = new Map(),
  now = Date.now(),
} = {}) {
  const normalizedBindings = bindings
    ? normalizeAccountFactsBindings(bindings)
    : { schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings: [] };
  const bindingByAccount = new Map(
    normalizedBindings.bindings.map((item) => [`${item.platform}:${item.account_key}`, item]),
  );
  const sourceCounts = new Map();
  for (const item of normalizedBindings.bindings) {
    const key = `${item.target_id}|${item.source_binding.id}`;
    sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
  }

  const accounts = [];
  for (const [platform, options] of Object.entries(accountOptions || {})) {
    if (!Array.isArray(options)) continue;
    for (const option of options) {
      if (!option || typeof option.key !== "string" || !option.key) continue;
      const accountId = `${platform}:${option.key}`;
      const binding = bindingByAccount.get(accountId) || null;
      const sourceKey = binding ? `${binding.target_id}|${binding.source_binding.id}` : null;
      let bindingStatus = "missing";
      if (binding && sourceKey && (sourceCounts.get(sourceKey) || 0) > 1) bindingStatus = "duplicate";
      else if (binding && accountFactsOptionMatchesBinding(option, binding)) bindingStatus = "bound";
      else if (binding) bindingStatus = "identity_mismatch";

      const stored = storedByAccount.get(accountId) || null;
      let projected = null;
      if (stored && bindingStatus === "bound") {
        try {
          projected = projectStoredAccountFacts(stored, { now });
          if (
            projected.target_id !== binding.target_id
            || projected.source_binding.id !== binding.source_binding.id
            || projected.account_scope !== ACCOUNT_FACTS_PAYLOAD_SCOPE
            || binding.account_scope !== option.account_scope
          ) {
            projected = null;
          }
        } catch {
          projected = null;
        }
      }

      accounts.push({
        platform,
        account_key: option.key,
        binding_status: bindingStatus === "identity_mismatch" ? "missing" : bindingStatus,
        identity_status: bindingStatus === "bound" ? "partial_identity" : "missing_identity",
        identity_mismatch: bindingStatus === "identity_mismatch",
        data_status: projected ? projected.data_status : "unavailable",
        target_id: bindingStatus === "bound" ? binding.target_id : null,
        source_binding_id: bindingStatus === "bound" ? binding.source_binding.id : null,
        account_scope: typeof option.account_scope === "string" ? option.account_scope : null,
        observation_date: projected?.observation_date || null,
        observed_started_at: projected?.observed_started_at || null,
        observed_finished_at: projected?.observed_finished_at || null,
        balances: projected?.broker_reported_balances || [],
        cash: projected?.cash || [],
        return: { ...ACCOUNT_FACTS_RETURN_UNAVAILABLE },
      });
    }
  }

  accounts.sort((left, right) => {
    const platformCmp = left.platform.localeCompare(right.platform);
    return platformCmp !== 0 ? platformCmp : left.account_key.localeCompare(right.account_key);
  });

  const incomplete = accounts.some((row) => row.binding_status !== "bound" || row.data_status !== "fresh");
  const totals = incomplete
    ? { status: "unavailable", reason: "coverage_incomplete", by_currency: [] }
    : aggregateAccountFactsTotals(accounts);

  return {
    ok: true,
    accounts,
    totals,
    return: { ...ACCOUNT_FACTS_RETURN_UNAVAILABLE },
  };
}

export function formatCurrencyAmounts(rows, field) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows
    .map((row) => {
      const amount = row?.[field];
      const currency = row?.currency;
      if (typeof currency !== "string" || typeof amount !== "string") return null;
      return `${currency} ${amount}`;
    })
    .filter(Boolean)
    .join(" · ");
}

export function totalsUnavailableDetail(reason) {
  if (reason === "physical_identity_unverified") {
    return "券商身份仅部分核验，不能汇总全部账户总额；请查看单账户分币种事实。";
  }
  if (reason === "coverage_incomplete") {
    return "账户覆盖不全或快照过期，不提供全部账户总额；未知不等于零。";
  }
  if (reason === "duplicate_account_mapping") {
    return "账户映射重复，金额不汇总；未知不等于零。";
  }
  return "全部账户总额暂不可用；未知不等于零。";
}
