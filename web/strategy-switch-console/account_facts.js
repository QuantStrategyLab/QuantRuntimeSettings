// Pure account-facts projection helpers. Keeps broker snapshot history out of
// runtime-daily and never invents FX totals, returns, or historical backfill.

export const ACCOUNT_FACTS_BINDINGS_SCHEMA = "qsl_account_facts_bindings.v1";
export const ACCOUNT_FACTS_HISTORY_SCHEMA = "longbridge_account_snapshot_history.v1";
export const ACCOUNT_FACTS_SNAPSHOT_SCHEMA = "longbridge_account_snapshot.v1";
export const ACCOUNT_FACTS_SOURCE_KIND = "deployment_scope_token_version";
export const IBKR_ACCOUNT_FACTS_HISTORY_SCHEMA = "ibkr_account_snapshot_history.v1";
export const IBKR_ACCOUNT_FACTS_SNAPSHOT_SCHEMA = "ibkr_account_snapshot.v1";
export const IBKR_ACCOUNT_FACTS_SOURCE_KIND = "deployment_runtime_account";
export const SCHWAB_ACCOUNT_FACTS_HISTORY_SCHEMA = "schwab_account_snapshot_history.v1";
export const SCHWAB_ACCOUNT_FACTS_SNAPSHOT_SCHEMA = "schwab_account_snapshot.v1";
export const SCHWAB_ACCOUNT_FACTS_SOURCE_KIND = "deployment_runtime_account";
export const FIRSTRADE_ACCOUNT_FACTS_HISTORY_SCHEMA = "firstrade_account_snapshot_history.v1";
export const FIRSTRADE_ACCOUNT_FACTS_SNAPSHOT_SCHEMA = "firstrade_account_snapshot.v1";
export const FIRSTRADE_ACCOUNT_FACTS_SOURCE_KIND = "deployment_runtime_account";
export const FIRSTRADE_ACCOUNT_FACTS_PLATFORM = "firstrade";
export const ACCOUNT_FACTS_BINDINGS_KEY = "account_facts_bindings";
export const ACCOUNT_FACTS_PLATFORM = "longbridge";
export const IBKR_ACCOUNT_FACTS_PLATFORM = "ibkr";
export const SCHWAB_ACCOUNT_FACTS_PLATFORM = "schwab";
/** @deprecated Use ACCOUNT_FACTS_SUPPORTED_PLATFORMS for current server validation. */
export const ACCOUNT_FACTS_PLATFORMS = Object.freeze([ACCOUNT_FACTS_PLATFORM, IBKR_ACCOUNT_FACTS_PLATFORM]);
export const ACCOUNT_FACTS_SUPPORTED_PLATFORMS = Object.freeze([
  ACCOUNT_FACTS_PLATFORM,
  IBKR_ACCOUNT_FACTS_PLATFORM,
  SCHWAB_ACCOUNT_FACTS_PLATFORM,
  FIRSTRADE_ACCOUNT_FACTS_PLATFORM,
]);
// Exact LongBridge option↔payload pairs only. Not interchangeable sets.
export const ACCOUNT_FACTS_SCOPE_PAIRS = Object.freeze([
  Object.freeze({ option_scope: "paper", payload_scope: "PAPER" }),
  Object.freeze({ option_scope: "HK", payload_scope: "HK" }),
  Object.freeze({ option_scope: "sg", payload_scope: "SG" }),
]);
export const ACCOUNT_FACTS_OPTION_SCOPES = Object.freeze(
  ACCOUNT_FACTS_SCOPE_PAIRS.map((pair) => pair.option_scope),
);
export const ACCOUNT_FACTS_PAYLOAD_SCOPES = Object.freeze(
  ACCOUNT_FACTS_SCOPE_PAIRS.map((pair) => pair.payload_scope),
);
/** @deprecated Prefer ACCOUNT_FACTS_OPTION_SCOPES; kept as the paper pair default. */
export const ACCOUNT_FACTS_OPTION_SCOPE = "paper";
/** @deprecated Prefer ACCOUNT_FACTS_PAYLOAD_SCOPES; kept as the paper pair default. */
export const ACCOUNT_FACTS_PAYLOAD_SCOPE = "PAPER";
export const ACCOUNT_FACTS_MAX_BODY_BYTES = 64 * 1024;
export const ACCOUNT_FACTS_STALE_MS = 36 * 60 * 60 * 1000;
export const ACCOUNT_FACTS_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const ACCOUNT_FACTS_OBSERVATION_WINDOW_MS = ACCOUNT_FACTS_STALE_MS;
export const ACCOUNT_FACTS_MAX_MONEY_SCALE = 8;
export const ACCOUNT_FACTS_MAX_MONEY_DIGITS = 15;
/** Native LongBridge financing detail money bound; does not widen primary 15/8. */
export const ACCOUNT_FACTS_MAX_NATIVE_MONEY_DIGITS = 30;
export const ACCOUNT_FACTS_MAX_NATIVE_MONEY_SCALE = 28;
export const ACCOUNT_FACTS_HISTORY_MAX_DAYS = 366;
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
const IBKR_ACCOUNT_ID_RE = /^(?:U|DU)[0-9]+$/;
const SCHWAB_ACCOUNT_HASH_MAX_LENGTH = 256;
const SCHWAB_ACCOUNT_TYPE_SOURCE_TAG = "securitiesAccount.type";
const IBKR_CASH_SOURCE_TAGS = new Set([
  "$LEDGER-CashBalance", "$LEDGER-TotalCashBalance", "CashBalance", "TotalCashBalance", "SettledCash",
]);
const CURRENCY_RE = /^[A-Z]{3}$/;
const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const NATIVE_FINANCING_MONEY_RE = /^-?(?:0|[1-9]\d{0,29})(?:\.\d{1,28})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LONG_BRIDGE_BALANCE_FIELDS = ["currency", "net_assets", "total_cash"];
const LONG_BRIDGE_CASH_FIELDS = ["currency", "available_cash", "frozen_cash", "settling_cash"];
const LONG_BRIDGE_FINANCING_MONEY_FIELDS = Object.freeze([
  "max_finance_amount",
  "remaining_finance_amount",
  "init_margin",
  "maintenance_margin",
  "margin_call",
  "buy_power",
]);
const LONG_BRIDGE_FINANCING_ALLOWED_FIELDS = Object.freeze([
  "currency",
  ...LONG_BRIDGE_FINANCING_MONEY_FIELDS,
  "risk_level",
]);
const LONG_BRIDGE_RISK_LEVEL_WIRE = Object.freeze(["0", "1", "2", "3"]);
const IBKR_BALANCE_FIELDS = ["currency", "net_assets"];
const IBKR_CASH_FIELDS = ["currency", "cash_balance", "source_tag"];
const SCHWAB_BALANCE_FIELDS = ["currency", "net_assets", "source_tag", "currency_source"];

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

function assertNativeFinancingMoneyText(cell) {
  if (typeof cell !== "string" || !NATIVE_FINANCING_MONEY_RE.test(cell)) {
    reject("invalid_account_facts_financing");
  }
}

function normalizeRiskLevelWire(cell) {
  // Wire enum only. SDK int→string conversion belongs to the Python projector.
  if (typeof cell === "string" && LONG_BRIDGE_RISK_LEVEL_WIRE.includes(cell)) return cell;
  reject("invalid_account_facts_financing");
}

function normalizeLongBridgeFinancing(value, balances) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    reject("invalid_account_facts_financing");
  }
  const allowedCurrencies = new Set(
    (Array.isArray(balances) ? balances : [])
      .map((row) => row?.currency)
      .filter((currency) => typeof currency === "string"),
  );
  const seen = new Set();
  let previousCurrency = null;
  const rows = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      reject("invalid_account_facts_financing");
    }
    const keys = Object.keys(item);
    if (!keys.length || keys.some((key) => !LONG_BRIDGE_FINANCING_ALLOWED_FIELDS.includes(key))) {
      reject("invalid_account_facts_financing");
    }
    if (!Object.prototype.hasOwnProperty.call(item, "currency")) {
      reject("invalid_account_facts_financing");
    }
    const currency = item.currency;
    if (typeof currency !== "string" || !CURRENCY_RE.test(currency)
        || seen.has(currency) || !allowedCurrencies.has(currency)) {
      reject("invalid_account_facts_financing");
    }
    if (previousCurrency !== null && currency < previousCurrency) {
      reject("invalid_account_facts_financing");
    }
    seen.add(currency);
    previousCurrency = currency;
    const row = { currency };
    let hasNativeField = false;
    for (const field of LONG_BRIDGE_FINANCING_MONEY_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(item, field)) continue;
      assertNativeFinancingMoneyText(item[field]);
      row[field] = item[field];
      hasNativeField = true;
    }
    if (Object.prototype.hasOwnProperty.call(item, "risk_level")) {
      row.risk_level = normalizeRiskLevelWire(item.risk_level);
      hasNativeField = true;
    }
    if (!hasNativeField) reject("invalid_account_facts_financing");
    rows.push(row);
  }
  return rows;
}

function moneyRows(value, fields, fieldName, {
  nullableFields = [],
  rejectBase = false,
  sourceTags = null,
  fixedFields = null,
  allowedCurrencies = null,
  allowEmpty = false,
  maxRows = 32,
} = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maxRows) {
    reject(`invalid_account_facts_${fieldName}`);
  }
  const seen = new Set();
  return value.map((item) => {
    if (!exactKeys(item, fields)) reject(`invalid_account_facts_${fieldName}`);
    const row = {};
    for (const field of fields) {
      const cell = item[field];
      if (field === "currency") {
        if (typeof cell !== "string" || !CURRENCY_RE.test(cell) || seen.has(cell)
            || (rejectBase && cell === "BASE")
            || (allowedCurrencies && !allowedCurrencies.includes(cell))) {
          reject(`invalid_account_facts_${fieldName}`);
        }
        seen.add(cell);
        row.currency = cell;
        continue;
      }
      if (field === "source_tag") {
        if (typeof cell !== "string" || !sourceTags?.has(cell)) reject(`invalid_account_facts_${fieldName}`);
        row[field] = cell;
        continue;
      }
      if (fixedFields && Object.prototype.hasOwnProperty.call(fixedFields, field)) {
        if (cell !== fixedFields[field]) reject(`invalid_account_facts_${fieldName}`);
        row[field] = cell;
        continue;
      }
      if (nullableFields.includes(field) && cell === null) {
        row[field] = null;
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

export function accountFactsPayloadScopeForOption(optionScope) {
  const pair = ACCOUNT_FACTS_SCOPE_PAIRS.find((item) => item.option_scope === optionScope);
  return pair ? pair.payload_scope : null;
}

export function accountFactsOptionScopeForPayload(payloadScope) {
  const pair = ACCOUNT_FACTS_SCOPE_PAIRS.find((item) => item.payload_scope === payloadScope);
  return pair ? pair.option_scope : null;
}

export function accountFactsScopesMatch(optionScope, payloadScope) {
  return accountFactsPayloadScopeForOption(optionScope) === payloadScope;
}

export function accountFactsScopesMatchForPlatform(platform, optionScope, payloadScope) {
  if (platform === ACCOUNT_FACTS_PLATFORM) return accountFactsScopesMatch(optionScope, payloadScope);
  return (platform === IBKR_ACCOUNT_FACTS_PLATFORM || platform === SCHWAB_ACCOUNT_FACTS_PLATFORM
    || platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM)
    && typeof optionScope === "string"
    && optionScope === payloadScope;
}

export function accountFactsPlatformForHistory(raw) {
  if (raw?.schema_version === ACCOUNT_FACTS_HISTORY_SCHEMA
      && raw?.snapshot_schema_version === ACCOUNT_FACTS_SNAPSHOT_SCHEMA) return ACCOUNT_FACTS_PLATFORM;
  if (raw?.schema_version === IBKR_ACCOUNT_FACTS_HISTORY_SCHEMA
      && raw?.snapshot_schema_version === IBKR_ACCOUNT_FACTS_SNAPSHOT_SCHEMA) return IBKR_ACCOUNT_FACTS_PLATFORM;
  if (raw?.schema_version === SCHWAB_ACCOUNT_FACTS_HISTORY_SCHEMA
      && raw?.snapshot_schema_version === SCHWAB_ACCOUNT_FACTS_SNAPSHOT_SCHEMA) return SCHWAB_ACCOUNT_FACTS_PLATFORM;
  if (raw?.schema_version === FIRSTRADE_ACCOUNT_FACTS_HISTORY_SCHEMA
      && raw?.snapshot_schema_version === FIRSTRADE_ACCOUNT_FACTS_SNAPSHOT_SCHEMA) return FIRSTRADE_ACCOUNT_FACTS_PLATFORM;
  reject("invalid_account_facts_history");
}

function sourceKindForPlatform(platform) {
  if (platform === ACCOUNT_FACTS_PLATFORM) return ACCOUNT_FACTS_SOURCE_KIND;
  if (platform === IBKR_ACCOUNT_FACTS_PLATFORM) return IBKR_ACCOUNT_FACTS_SOURCE_KIND;
  if (platform === SCHWAB_ACCOUNT_FACTS_PLATFORM) return SCHWAB_ACCOUNT_FACTS_SOURCE_KIND;
  if (platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM) return FIRSTRADE_ACCOUNT_FACTS_SOURCE_KIND;
  return null;
}

export function validFirstradeAccountId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && !/[^A-Za-z0-9._:-]/.test(value);
}

function validSchwabAccountHash(value) {
  return typeof value === "string" && value.length > 0 && value.length <= SCHWAB_ACCOUNT_HASH_MAX_LENGTH;
}

function validSchwabAccountTypeToken(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 32) return false;
  for (const character of value) {
    if (!((character >= "A" && character <= "Z")
        || (character >= "a" && character <= "z")
        || character === "_")) return false;
  }
  return true;
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
    const expectedKeys = [
      "platform", "account_key", "account_scope",
      "target_name", "service_name", "deployment_selector", "account_selector",
      "target_id", "source_binding",
    ];
    if (item?.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM) expectedKeys.push("broker_account_hash");
    if (item?.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM) expectedKeys.push("broker_account_id");
    if (!exactKeys(item, expectedKeys)) {
      reject("invalid_account_facts_bindings");
    }
    if (!ACCOUNT_FACTS_SUPPORTED_PLATFORMS.includes(item.platform)) reject("invalid_account_facts_bindings");
    if (typeof item.account_key !== "string" || !ACCOUNT_KEY_RE.test(item.account_key)) reject("invalid_account_facts_bindings");
    if (typeof item.account_scope !== "string" || !ACCOUNT_SCOPE_RE.test(item.account_scope)) {
      reject("invalid_account_facts_bindings");
    }
    if (item.platform === ACCOUNT_FACTS_PLATFORM && !ACCOUNT_FACTS_OPTION_SCOPES.includes(item.account_scope)) {
      reject("invalid_account_facts_bindings");
    }
    if (typeof item.target_id !== "string" || !TARGET_ID_RE.test(item.target_id)) reject("invalid_account_facts_bindings");
    if (!exactKeys(item.source_binding, ["kind", "id"])) reject("invalid_account_facts_bindings");
    if (item.source_binding.kind !== sourceKindForPlatform(item.platform)) reject("invalid_account_facts_bindings");
    if (typeof item.source_binding.id !== "string" || !BINDING_ID_RE.test(item.source_binding.id)) {
      reject("invalid_account_facts_bindings");
    }
    const identity = {
      target_name: requireOptionIdentityField(item.target_name),
      service_name: requireOptionIdentityField(item.service_name),
      deployment_selector: requireOptionIdentityField(item.deployment_selector),
      account_selector: requireOptionIdentityField(item.account_selector),
    };
    if (item.platform === IBKR_ACCOUNT_FACTS_PLATFORM && !IBKR_ACCOUNT_ID_RE.test(identity.account_selector)) {
      reject("invalid_account_facts_bindings");
    }
    if (item.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM && !validSchwabAccountHash(item.broker_account_hash)) {
      reject("invalid_account_facts_bindings");
    }
    if (item.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM && !validFirstradeAccountId(item.broker_account_id)) {
      reject("invalid_account_facts_bindings");
    }
    const accountId = `${item.platform}:${item.account_key}`;
    const sourceId = `${item.target_id}|${item.source_binding.id}`;
    if (byAccount.has(accountId) || bySource.has(sourceId)) reject("duplicate_account_facts_binding");
    byAccount.set(accountId, index);
    bySource.set(sourceId, index);
    return {
      platform: item.platform,
      account_key: item.account_key,
      account_scope: item.account_scope,
      ...identity,
      target_id: item.target_id,
      ...(item.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM
        ? { broker_account_hash: item.broker_account_hash }
        : {}),
      ...(item.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM ? { broker_account_id: item.broker_account_id } : {}),
      source_binding: {
        kind: sourceKindForPlatform(item.platform),
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
  if (!ACCOUNT_FACTS_SUPPORTED_PLATFORMS.includes(matches[0].platform)) {
    return { ok: false, reason: "account_facts_platform_unsupported" };
  }
  return { ok: true, binding: matches[0] };
}

export function accountFactsOptionMatchesBinding(option, binding) {
  if (!option || !binding) return false;
  if (!ACCOUNT_FACTS_SUPPORTED_PLATFORMS.includes(binding.platform)) return false;
  if (option.key !== binding.account_key) return false;
  if (typeof option.account_scope !== "string" || option.account_scope !== binding.account_scope) return false;
  if (binding.platform === ACCOUNT_FACTS_PLATFORM && !ACCOUNT_FACTS_OPTION_SCOPES.includes(binding.account_scope)) return false;
  if (binding.platform === IBKR_ACCOUNT_FACTS_PLATFORM && !IBKR_ACCOUNT_ID_RE.test(binding.account_selector)) return false;
  if (binding.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM && !validSchwabAccountHash(binding.broker_account_hash)) return false;
  if (binding.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM && !validFirstradeAccountId(binding.broker_account_id)) return false;
  for (const field of OPTION_IDENTITY_FIELDS) {
    if (typeof option[field] !== "string" || option[field] !== binding[field]) return false;
  }
  return true;
}

export function normalizeAccountFactsHistoryPayload(raw, {
  now = Date.now(),
  expectedPlatform,
  expectedTargetId,
  expectedBindingId,
  expectedOptionScope = null,
  expectedAccountSelector = null,
  expectedBrokerAccountHash = null,
  expectedBrokerAccountId = null,
  enforceObservationWindow = true,
} = {}) {
  const platform = accountFactsPlatformForHistory(raw);
  if (expectedPlatform && platform !== expectedPlatform) reject("account_facts_identity_mismatch", 409);
  const ibkr = platform === IBKR_ACCOUNT_FACTS_PLATFORM;
  const schwab = platform === SCHWAB_ACCOUNT_FACTS_PLATFORM;
  const firstrade = platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM;
  const longbridge = platform === ACCOUNT_FACTS_PLATFORM;
  const expectedKeys = [
    "schema_version", "snapshot_schema_version", "account_scope", "target_id", "source_binding",
    "observed_started_at", "observed_finished_at", "snapshot_atomic", "observation_date",
    "broker_reported_balances", "cash",
  ];
  if (ibkr) expectedKeys.push("account_ids");
  if (firstrade) expectedKeys.push("broker_account_id");
  if (schwab) {
    expectedKeys.push("account_hash");
    if (Object.prototype.hasOwnProperty.call(raw, "broker_account_type")) {
      expectedKeys.push("broker_account_type");
    }
  }
  const hasFinancing = longbridge && Object.prototype.hasOwnProperty.call(raw, "financing");
  if (hasFinancing) expectedKeys.push("financing");
  if (!exactKeys(raw, expectedKeys)) reject("invalid_account_facts_history");
  if (typeof raw.account_scope !== "string" || !ACCOUNT_SCOPE_RE.test(raw.account_scope)
      || (platform === ACCOUNT_FACTS_PLATFORM && !ACCOUNT_FACTS_PAYLOAD_SCOPES.includes(raw.account_scope))) {
    reject("invalid_account_facts_scope");
  }
  if (expectedOptionScope != null
      && !accountFactsScopesMatchForPlatform(platform, expectedOptionScope, raw.account_scope)) {
    reject("account_facts_identity_mismatch", 409);
  }
  let accountIds;
  if (ibkr) {
    if (!Array.isArray(raw.account_ids) || raw.account_ids.length !== 1
        || typeof raw.account_ids[0] !== "string" || !IBKR_ACCOUNT_ID_RE.test(raw.account_ids[0])
        || (expectedAccountSelector !== null && raw.account_ids[0] !== expectedAccountSelector)) {
      reject("account_facts_identity_mismatch", 409);
    }
    accountIds = [raw.account_ids[0]];
  }
  if (schwab && (!validSchwabAccountHash(raw.account_hash)
      || (expectedBrokerAccountHash !== null && raw.account_hash !== expectedBrokerAccountHash))) {
    reject("account_facts_identity_mismatch", 409);
  }
  if (firstrade && (!validFirstradeAccountId(raw.broker_account_id)
      || (expectedBrokerAccountId !== null && raw.broker_account_id !== expectedBrokerAccountId))) {
    reject("account_facts_identity_mismatch", 409);
  }
  let brokerAccountType;
  if (schwab && Object.prototype.hasOwnProperty.call(raw, "broker_account_type")) {
    const value = raw.broker_account_type;
    if (!exactKeys(value, ["value", "source_tag"])
        || !validSchwabAccountTypeToken(value.value)
        || value.source_tag !== SCHWAB_ACCOUNT_TYPE_SOURCE_TAG) {
      reject("invalid_account_facts_account_type");
    }
    brokerAccountType = { value: value.value, source_tag: SCHWAB_ACCOUNT_TYPE_SOURCE_TAG };
  }
  if (typeof raw.target_id !== "string" || !TARGET_ID_RE.test(raw.target_id)) reject("invalid_account_facts_target");
  if (expectedTargetId && raw.target_id !== expectedTargetId) reject("account_facts_target_mismatch");
  if (!exactKeys(raw.source_binding, ["kind", "status", "id"])) reject("invalid_account_facts_source_binding");
  if (
    raw.source_binding.kind !== sourceKindForPlatform(platform)
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
  const balances = moneyRows(
    raw.broker_reported_balances,
    (ibkr || firstrade) ? IBKR_BALANCE_FIELDS : (schwab ? SCHWAB_BALANCE_FIELDS : LONG_BRIDGE_BALANCE_FIELDS),
    "balances",
    schwab
      ? {
        maxRows: 1,
        allowedCurrencies: ["USD"],
        sourceTags: new Set(["liquidationValue"]),
        fixedFields: { currency_source: "owner_confirmed" },
      }
      : (firstrade ? { maxRows: 1 } : { nullableFields: ibkr ? ["net_assets"] : [] }),
  );
  const cash = moneyRows(
    raw.cash,
    (ibkr || firstrade) ? IBKR_CASH_FIELDS : (schwab ? ["currency", "cash_balance", "source_tag", "currency_source"] : LONG_BRIDGE_CASH_FIELDS),
    "cash",
    ibkr
      ? { rejectBase: true, sourceTags: IBKR_CASH_SOURCE_TAGS }
      : (schwab
        ? {
          allowEmpty: true,
          maxRows: 1,
          allowedCurrencies: ["USD"],
          sourceTags: new Set(["cashBalance"]),
          fixedFields: { currency_source: "owner_confirmed" },
        }
        : (firstrade ? {allowEmpty: true, maxRows: 1, sourceTags: new Set(["provider.cash_balance"]),
          allowedCurrencies: balances.map(row => row.currency)} : {})),
  );
  const financing = hasFinancing
    ? normalizeLongBridgeFinancing(raw.financing, balances)
    : null;
  const normalized = {
    schema_version: firstrade ? FIRSTRADE_ACCOUNT_FACTS_HISTORY_SCHEMA : ibkr
      ? IBKR_ACCOUNT_FACTS_HISTORY_SCHEMA
      : (schwab ? SCHWAB_ACCOUNT_FACTS_HISTORY_SCHEMA : ACCOUNT_FACTS_HISTORY_SCHEMA),
    snapshot_schema_version: firstrade ? FIRSTRADE_ACCOUNT_FACTS_SNAPSHOT_SCHEMA : ibkr
      ? IBKR_ACCOUNT_FACTS_SNAPSHOT_SCHEMA
      : (schwab ? SCHWAB_ACCOUNT_FACTS_SNAPSHOT_SCHEMA : ACCOUNT_FACTS_SNAPSHOT_SCHEMA),
    account_scope: raw.account_scope,
    target_id: raw.target_id,
    source_binding: {
      kind: sourceKindForPlatform(platform),
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
  if (financing) normalized.financing = financing;
  if (ibkr) normalized.account_ids = accountIds;
  if (firstrade) normalized.broker_account_id = raw.broker_account_id;
  if (schwab) {
    normalized.account_hash = raw.account_hash;
    if (brokerAccountType) normalized.broker_account_type = brokerAccountType;
  }
  return normalized;
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

export function projectStoredAccountFacts(stored, {
  now = Date.now(),
  expectedPlatform,
  expectedTargetId,
  expectedBindingId,
  expectedOptionScope = null,
  expectedAccountSelector = null,
  expectedBrokerAccountHash = null,
  expectedBrokerAccountId = null,
} = {}) {
  const history = normalizeAccountFactsHistoryPayload(stored, {
    now,
    expectedPlatform,
    expectedTargetId: expectedTargetId || stored?.target_id,
    expectedBindingId: expectedBindingId || stored?.source_binding?.id,
    expectedOptionScope,
    expectedAccountSelector,
    expectedBrokerAccountHash,
    expectedBrokerAccountId,
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

function physicalIdentityForProjection(platform, projected) {
  // Only exact broker identities already checked against protected bindings.
  // Keep these values in worker memory, never in the public read model.
  if (!projected) return null;
  if (platform === IBKR_ACCOUNT_FACTS_PLATFORM) return JSON.stringify([platform, projected.account_ids[0]]);
  if (platform === SCHWAB_ACCOUNT_FACTS_PLATFORM) return JSON.stringify([platform, projected.account_hash]);
  if (platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM) return JSON.stringify([platform, projected.broker_account_id]);
  return null; // LongBridge channel identity does not prove a physical account.
}

function sumMoneyTexts(amounts) {
  const scale = Math.max(...amounts.map(amount => (amount.split(".")[1] || "").length));
  const total = amounts.reduce((sum, amount) => {
    const [whole, fraction = ""] = amount.replace(/^-/, "").split(".");
    const value = BigInt(whole + fraction.padEnd(scale, "0"));
    return sum + (amount.startsWith("-") ? -value : value);
  }, 0n);
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, "0");
  return `${total < 0n ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "") : digits}`;
}

export function aggregateAccountFactsTotals(accountRows, physicalIdentities = new Map()) {
  const rows = Array.isArray(accountRows) ? accountRows : [];
  const nonPaper = row => row?.broker_environment !== "paper" && row?.account_scope !== "paper";
  const unavailable = reason => ({ status: "unavailable", reason, by_currency: [] });
  const groups = new Map();
  for (const row of rows) {
    const identity = physicalIdentities.get(row);
    row.aggregation_status = identity ? "included" : "unverified";
    if (identity) groups.set(identity, [...(groups.get(identity) || []), row]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const fingerprint = row => JSON.stringify({
      paper: !nonPaper(row),
      balances: [...(row.balances || [])].sort((a, b) => a.currency.localeCompare(b.currency)),
      cash: [...(row.cash || [])].sort((a, b) => a.currency.localeCompare(b.currency)),
    });
    if (group.some(row => row.binding_status !== "bound" || row.data_status !== "fresh"
        || fingerprint(row) !== fingerprint(group[0]))) {
      for (const row of group) row.aggregation_status = "conflict";
    } else {
      for (const row of group.slice(1)) row.aggregation_status = "duplicate";
    }
  }
  const included = rows.filter(row => nonPaper(row) && row.aggregation_status !== "duplicate");
  if (!included.length) return unavailable("no_non_paper_accounts");
  if (included.some(row => row.aggregation_status === "conflict")) return unavailable("duplicate_account_mapping");
  if (included.some(row => row.binding_status !== "bound" || row.data_status !== "fresh")) return unavailable("coverage_incomplete");
  if (included.some(row => !physicalIdentities.has(row))) return unavailable("physical_identity_unverified");
  if (included.some(row => !row.balances?.length || row.balances.some(balance => balance.net_assets === null))) {
    return unavailable("coverage_incomplete");
  }
  const byCurrency = new Map();
  for (const row of included) {
    for (const balance of row.balances) {
      const entries = byCurrency.get(balance.currency) || [];
      entries.push({ balance, cash: row.cash.find(cash => cash.currency === balance.currency) });
      byCurrency.set(balance.currency, entries);
    }
  }
  return {
    status: "by_currency", reason: null,
    by_currency: Array.from(byCurrency, ([currency, entries]) => ({
      currency, net_assets: sumMoneyTexts(entries.map(entry => entry.balance.net_assets)),
      // Different native cash meanings stay separate; absent cash is not zero.
      available_cash: entries.every(entry => typeof entry.cash?.available_cash === "string")
        ? sumMoneyTexts(entries.map(entry => entry.cash.available_cash)) : null,
      cash_balance: entries.every(entry => typeof entry.cash?.cash_balance === "string")
        ? sumMoneyTexts(entries.map(entry => entry.cash.cash_balance)) : null,
      account_count: entries.length,
    })).sort((a, b) => a.currency.localeCompare(b.currency)),
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
  const physicalIdentities = new Map();
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
          projected = projectStoredAccountFacts(stored, {
            now,
            expectedPlatform: binding.platform,
            expectedTargetId: binding.target_id,
            expectedBindingId: binding.source_binding.id,
            expectedOptionScope: binding.account_scope,
            expectedAccountSelector: binding.platform === IBKR_ACCOUNT_FACTS_PLATFORM
              ? binding.account_selector
              : null,
            expectedBrokerAccountHash: binding.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM
              ? binding.broker_account_hash
              : null,
            expectedBrokerAccountId: binding.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM
              ? binding.broker_account_id
              : null,
          });
          if (
            projected.target_id !== binding.target_id
            || projected.source_binding.id !== binding.source_binding.id
            || !accountFactsScopesMatchForPlatform(binding.platform, binding.account_scope, projected.account_scope)
            || binding.account_scope !== option.account_scope
          ) {
            projected = null;
          }
        } catch {
          projected = null;
        }
      }

      const accountRow = {
        platform,
        account_key: option.key,
        binding_status: bindingStatus === "identity_mismatch" ? "missing" : bindingStatus,
        identity_status: bindingStatus === "bound" ? "partial_identity" : "missing_identity",
        identity_mismatch: bindingStatus === "identity_mismatch",
        data_status: projected ? projected.data_status : "unavailable",
        broker_environment: typeof option.broker_environment === "string" ? option.broker_environment : null,
        target_id: bindingStatus === "bound" ? binding.target_id : null,
        source_binding_id: bindingStatus === "bound" ? binding.source_binding.id : null,
        account_scope: typeof option.account_scope === "string" ? option.account_scope : null,
        observation_date: projected?.observation_date || null,
        observed_started_at: projected?.observed_started_at || null,
        observed_finished_at: projected?.observed_finished_at || null,
        balances: projected?.broker_reported_balances || [],
        cash: projected?.cash || [],
        ...(platform === ACCOUNT_FACTS_PLATFORM
          && projected?.data_status === "fresh"
          && Array.isArray(projected?.financing)
          ? { financing: projected.financing.map((row) => ({ ...row })) }
          : {}),
        ...(platform === SCHWAB_ACCOUNT_FACTS_PLATFORM && projected?.broker_account_type
          ? { broker_account_type: { ...projected.broker_account_type } }
          : {}),
        return: { ...ACCOUNT_FACTS_RETURN_UNAVAILABLE },
      };
      accounts.push(accountRow);
      const physicalIdentity = physicalIdentityForProjection(platform, projected);
      if (physicalIdentity) physicalIdentities.set(accountRow, physicalIdentity);
    }
  }

  accounts.sort((left, right) => {
    const platformCmp = left.platform.localeCompare(right.platform);
    return platformCmp !== 0 ? platformCmp : left.account_key.localeCompare(right.account_key);
  });

  const totals = aggregateAccountFactsTotals(accounts, physicalIdentities);

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

function dayUtcMs(dateText) {
  const day = calendarDate(dateText);
  if (!day) return null;
  return Date.parse(`${day}T00:00:00Z`);
}

function addUtcDays(dateText, delta) {
  const ms = dayUtcMs(dateText);
  if (ms === null) return null;
  return new Date(ms + delta * 86400000).toISOString().slice(0, 10);
}

export function accountFactsHistoryIdentityMatches(row, binding) {
  if (!row || !binding) return false;
  if (row.target_id !== binding.target_id) return false;
  if (row.source_binding_id !== binding.source_binding.id) return false;
  // Storage metadata keeps the option scope (for LongBridge this is lowercase
  // `paper`), while the broker payload carries its paired scope (`PAPER`).
  if (row.account_scope !== binding.account_scope) return false;
  return true;
}

export function decideAccountFactsDailyUpsert(existingDayPayload, incomingHistory) {
  const incomingFinished = parseInstant(incomingHistory.observed_finished_at);
  if (incomingFinished === null) reject("invalid_account_facts_time");
  if (!existingDayPayload) return { action: "insert", unchanged: false };
  const existingFinished = parseInstant(existingDayPayload.observed_finished_at);
  if (existingFinished === null) reject("invalid_account_facts_stored");
  if (incomingFinished < existingFinished) {
    return { action: "skip", reason: "account_facts_daily_stale", unchanged: true };
  }
  const samePayload = canonicalizeAccountFactsHistory(existingDayPayload)
    === canonicalizeAccountFactsHistory(incomingHistory);
  if (incomingFinished === existingFinished) {
    if (samePayload) return { action: "keep", unchanged: true };
    return { action: "reject", reason: "account_facts_daily_conflict", status: 409 };
  }
  return { action: "replace", unchanged: false };
}

export function historyRetentionCutoff(latestDate, maxDays = ACCOUNT_FACTS_HISTORY_MAX_DAYS) {
  const latest = calendarDate(latestDate);
  if (!latest) return null;
  const bounded = Number.isInteger(maxDays) && maxDays > 0 ? Math.min(maxDays, ACCOUNT_FACTS_HISTORY_MAX_DAYS) : ACCOUNT_FACTS_HISTORY_MAX_DAYS;
  return addUtcDays(latest, -(bounded - 1));
}

function balanceForCurrency(history, currency) {
  if (!history || typeof currency !== "string" || !CURRENCY_RE.test(currency)) return null;
  const row = (history.broker_reported_balances || []).find((item) => item.currency === currency);
  if (!row || typeof row.net_assets !== "string") return null;
  return {
    currency,
    net_assets: row.net_assets,
    total_cash: typeof row.total_cash === "string" ? row.total_cash : null,
  };
}

export function projectAccountFactsHistorySeries({
  days = [],
  binding = null,
  currency = null,
  maxDays = ACCOUNT_FACTS_HISTORY_MAX_DAYS,
} = {}) {
  if (!binding || typeof currency !== "string" || !CURRENCY_RE.test(currency)) {
    return {
      ok: true,
      currency: typeof currency === "string" ? currency : null,
      points: [],
      gap_dates: [],
      first_sample_date: null,
      truncated: false,
      retention_days: ACCOUNT_FACTS_HISTORY_MAX_DAYS,
      note: "identity_or_currency_unavailable",
    };
  }
  const matching = [];
  for (const day of days) {
    if (!day || !accountFactsHistoryIdentityMatches(day, binding)) continue;
    const observationDate = calendarDate(day.observation_date);
    if (!observationDate) continue;
    let payload = day.payload;
    if (!payload) continue;
    try {
      payload = normalizeAccountFactsHistoryPayload(payload, {
        now: parseInstant(payload.observed_finished_at) || Date.now(),
        expectedPlatform: binding.platform,
        expectedTargetId: binding.target_id,
        expectedBindingId: binding.source_binding.id,
        expectedOptionScope: binding.account_scope,
        expectedAccountSelector: binding.platform === IBKR_ACCOUNT_FACTS_PLATFORM
          ? binding.account_selector
          : null,
        expectedBrokerAccountHash: binding.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM
          ? binding.broker_account_hash
          : null,
        expectedBrokerAccountId: binding.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM
          ? binding.broker_account_id
          : null,
        enforceObservationWindow: false,
      });
    } catch {
      continue;
    }
    if (
      payload.target_id !== binding.target_id
      || payload.source_binding.id !== binding.source_binding.id
      || !accountFactsScopesMatchForPlatform(binding.platform, binding.account_scope, payload.account_scope)
    ) continue;
    const balance = balanceForCurrency(payload, currency);
    if (!balance) {
      matching.push({ observation_date: observationDate, gap: true, reason: "currency_missing" });
      continue;
    }
    matching.push({
      observation_date: observationDate,
      gap: false,
      observed_finished_at: payload.observed_finished_at,
      net_assets: balance.net_assets,
      total_cash: balance.total_cash,
    });
  }
  matching.sort((left, right) => left.observation_date.localeCompare(right.observation_date));
  const retentionDays = Number.isInteger(maxDays) && maxDays > 0
    ? Math.min(maxDays, ACCOUNT_FACTS_HISTORY_MAX_DAYS)
    : ACCOUNT_FACTS_HISTORY_MAX_DAYS;
  let truncated = matching.length > retentionDays;
  const kept = truncated ? matching.slice(matching.length - retentionDays) : matching;
  const points = [];
  const gapDates = [];
  for (const item of kept) {
    if (item.gap) {
      gapDates.push(item.observation_date);
      continue;
    }
    points.push({
      observation_date: item.observation_date,
      observed_finished_at: item.observed_finished_at,
      currency,
      net_assets: item.net_assets,
      total_cash: item.total_cash,
    });
  }
  // Leave calendar gaps between accepted points; callers must not interpolate.
  if (points.length >= 2) {
    for (let index = 1; index < points.length; index += 1) {
      const prev = points[index - 1].observation_date;
      const next = points[index].observation_date;
      const expected = addUtcDays(prev, 1);
      if (expected && expected !== next) {
        let cursor = expected;
        while (cursor && cursor < next) {
          gapDates.push(cursor);
          cursor = addUtcDays(cursor, 1);
        }
      }
    }
  }
  gapDates.sort();
  return {
    ok: true,
    currency,
    points,
    gap_dates: [...new Set(gapDates)],
    first_sample_date: points[0]?.observation_date || null,
    truncated,
    retention_days: retentionDays,
    note: truncated ? "history_truncated_to_retention" : null,
  };
}

export function buildAccountFactsHistoryReadModel({
  platform,
  accountKey,
  currency,
  option = null,
  binding = null,
  days = [],
  maxDays = ACCOUNT_FACTS_HISTORY_MAX_DAYS,
} = {}) {
  if (!ACCOUNT_FACTS_SUPPORTED_PLATFORMS.includes(platform) || typeof accountKey !== "string" || !accountKey) {
    return {
      ok: true,
      platform: platform || null,
      account_key: accountKey || null,
      binding_status: "missing",
      identity_status: "missing_identity",
      identity_mismatch: false,
      series: projectAccountFactsHistorySeries({ days: [], binding: null, currency }),
      return: { ...ACCOUNT_FACTS_RETURN_UNAVAILABLE },
    };
  }
  let bindingStatus = "missing";
  if (binding && accountFactsOptionMatchesBinding(option, binding) && binding.account_key === accountKey) {
    bindingStatus = "bound";
  } else if (binding) {
    bindingStatus = "identity_mismatch";
  }
  const series = bindingStatus === "bound"
    ? projectAccountFactsHistorySeries({ days, binding, currency, maxDays })
    : projectAccountFactsHistorySeries({ days: [], binding: null, currency });
  return {
    ok: true,
    platform,
    account_key: accountKey,
    binding_status: bindingStatus === "identity_mismatch" ? "missing" : bindingStatus,
    identity_status: bindingStatus === "bound" ? "partial_identity" : "missing_identity",
    identity_mismatch: bindingStatus === "identity_mismatch",
    target_id: bindingStatus === "bound" ? binding.target_id : null,
    source_binding_id: bindingStatus === "bound" ? binding.source_binding.id : null,
    account_scope: bindingStatus === "bound" ? binding.account_scope : null,
    series,
    return: { ...ACCOUNT_FACTS_RETURN_UNAVAILABLE },
  };
}
