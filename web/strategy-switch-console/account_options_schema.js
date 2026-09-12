// Account-options schema validation for Worker KV/secret payloads.

export const ACCOUNT_OPTION_SCHEMA_VERSION = "qsl.strategy_switch_account_options.v1";
export const BROKER_ENVIRONMENTS = ["live", "paper"];

const PLATFORM_KEY_RE = /^[a-z][a-z0-9_]*$/;
const OPTION_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

function asString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function asOptionalString(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  return asString(value, field);
}

function asOptionalBrokerEnvironment(value, field) {
  const text = asOptionalString(value, field);
  if (text === undefined) return undefined;
  if (!BROKER_ENVIRONMENTS.includes(text)) {
    throw new Error(`${field} must be live or paper`);
  }
  return text;
}

function asStringArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((item, index) => asString(item, `${field}[${index}]`));
}

export function normalizeAccountOption(platform, raw, index = 0) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${platform}[${index}] must be an object`);
  }
  const key = asString(raw.key || raw.id, `${platform}[${index}].key`);
  if (!OPTION_KEY_RE.test(key)) {
    throw new Error(`${platform}[${index}].key has invalid characters`);
  }
  const option = {
    key,
    label: asString(raw.label || key, `${platform}[${index}].label`),
    target_name: asString(raw.target_name || key, `${platform}[${index}].target_name`),
    supported_domains: asStringArray(raw.supported_domains || [], `${platform}[${index}].supported_domains`),
  };
  const optionalFields = [
    "account_selector",
    "deployment_selector",
    "account_scope",
    "service_name",
    "runtime_status_target_id",
    "github_environment",
    "variable_scope",
    "cash_currency",
    "default_execution_mode",
    "default_strategy_profile",
  ];
  for (const field of optionalFields) {
    const value = asOptionalString(raw[field], `${platform}[${index}].${field}`);
    if (value !== undefined) option[field] = value;
  }
  const brokerEnvironment = asOptionalBrokerEnvironment(
    raw.broker_environment,
    `${platform}[${index}].broker_environment`,
  );
  if (brokerEnvironment !== undefined) option.broker_environment = brokerEnvironment;
  return option;
}

export function normalizeAccountOptionsPayload(raw, fieldName = "account_options") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${fieldName} must be an object keyed by platform`);
  }
  const normalized = {};
  for (const [platform, options] of Object.entries(raw)) {
    if (!PLATFORM_KEY_RE.test(platform)) {
      throw new Error(`${fieldName} platform id ${platform} is invalid`);
    }
    if (!Array.isArray(options)) {
      throw new Error(`${fieldName}.${platform} must be an array`);
    }
    normalized[platform] = options.map((item, index) => normalizeAccountOption(platform, item, index));
  }
  return normalized;
}

export function parseAccountOptionsJson(raw, fieldName = "account_options") {
  if (!raw || !String(raw).trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw new Error(`${fieldName} must be valid JSON`);
  }
  return normalizeAccountOptionsPayload(parsed, fieldName);
}
