/**
 * Shared declarative field, object, and snapshot schema validation helpers.
 *
 * Pure leaf module under application/: never imports runtime_support.js
 * or worker.js.
 */

import { HttpError } from "./http_error.js";

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const UNSAFE_MARKERS = ["secret", "token", "password", "bearer", "traceback", "/users/", "/home/"];
const SECRET_FRAGMENT_RES = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:token|secret|password|api[_ -]?key|private[_ -]?key|cookie)\s*[:=]\s*[^\s,;]{8,}/i,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,})\b/,
  /(?:^|[\s(])(?:\/Users\/|\/home\/|[A-Za-z]:[\\/])/,
];

function buildError(errorFactory, message) {
  return errorFactory ? errorFactory(message) : new Error(message);
}

export function httpBadRequest(code) {
  return new HttpError(code, 400);
}

export function isPlainObject(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

export function assertPlainObject(value, fieldName, { message, errorFactory } = {}) {
  if (!isPlainObject(value)) {
    throw buildError(errorFactory, message || `${fieldName} must be an object`);
  }
  return value;
}

export function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function assertExactObject(value, keys, fieldName, { message, errorFactory } = {}) {
  assertPlainObject(value, fieldName, { message, errorFactory });
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw buildError(errorFactory, message || `${fieldName} has invalid fields`);
  }
  return value;
}

export function assertRequiredAndOptionalObject(value, requiredFields, optionalFields, fieldName, { message, errorFactory } = {}) {
  assertPlainObject(value, fieldName, { message, errorFactory });
  const allowed = new Set([...requiredFields, ...optionalFields]);
  const actual = Object.keys(value);
  if (
    requiredFields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))
    || actual.some((field) => !allowed.has(field))
  ) {
    throw buildError(errorFactory, message || `${fieldName} has invalid fields`);
  }
  return value;
}

export function assertConstantField(value, expected, message, { errorFactory } = {}) {
  if (value !== expected) {
    throw buildError(errorFactory, message);
  }
  return value;
}

export function assertBooleanField(value, fieldName, { expected, nullable = false, message, errorFactory } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "boolean") {
    throw buildError(errorFactory, message || `${fieldName} must be boolean`);
  }
  if (expected !== undefined && value !== expected) {
    throw buildError(errorFactory, message || `${fieldName} must be ${expected}`);
  }
  return value;
}

export function cleanChoice(value, allowed, field, { normalize, message, errorFactory } = {}) {
  const raw = normalize ? normalize(value) : String(value || "").trim();
  if (!allowed.includes(raw)) {
    throw buildError(errorFactory, message || `${field} is invalid`);
  }
  return raw;
}

export function cleanBoundedText(
  value,
  fieldName,
  {
    maxLength,
    minLength = 1,
    trim = true,
    strictString = false,
    nullable = false,
    emptyAsNull = false,
    pattern = null,
    rejectControlChars = false,
    rejectAngleBracketsOrBackslash = false,
    rejectLocalPaths = false,
    rejectUnsafeMarkers = false,
    message,
    errorFactory,
  } = {},
) {
  if (nullable && (value === null || (emptyAsNull && (value === undefined || value === "")))) {
    return null;
  }
  if (strictString && typeof value !== "string") {
    throw buildError(errorFactory, message || `${fieldName} is invalid`);
  }
  const raw = strictString ? value : String(value || "");
  const text = trim ? raw.trim() : raw;
  if (
    text.length < minLength
    || (maxLength !== undefined && text.length > maxLength)
    || (pattern && !pattern.test(text))
    || (rejectControlChars && CONTROL_CHAR_RE.test(text))
    || (rejectAngleBracketsOrBackslash && /[<>\\]/.test(text))
    || (rejectLocalPaths && (text.startsWith("/") || /^[A-Za-z]:[\\/]/.test(text)))
    || (rejectUnsafeMarkers && UNSAFE_MARKERS.some((marker) => text.toLowerCase().includes(marker)))
  ) {
    throw buildError(errorFactory, message || `${fieldName} is invalid`);
  }
  return text;
}

export function containsSecretFragment(text) {
  return SECRET_FRAGMENT_RES.some((re) => re.test(text));
}

export function cleanHexDigest(
  value,
  fieldName,
  {
    length = 64,
    allowUppercase = false,
    lowercase = false,
    strictString = false,
    trim = false,
    nullable = false,
    message,
    errorFactory,
  } = {},
) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (strictString && typeof value !== "string") {
    throw buildError(errorFactory, message || `${fieldName} is invalid`);
  }
  const raw = strictString ? value : String(value || "");
  const text = trim ? raw.trim() : raw;
  const re = allowUppercase ? new RegExp(`^[0-9a-fA-F]{${length}}$`) : new RegExp(`^[0-9a-f]{${length}}$`);
  if (!re.test(text)) {
    throw buildError(errorFactory, message || `${fieldName} is invalid`);
  }
  return lowercase ? text.toLowerCase() : text;
}

export function cleanBoundedNumber(
  value,
  fieldName,
  {
    min,
    max,
    absMax,
    integer = false,
    nullable = false,
    emptyAsNull = false,
    round = false,
    message,
    errorFactory,
  } = {},
) {
  if (nullable && (value === null || (emptyAsNull && (value === undefined || value === "")))) {
    return null;
  }
  const number = Number(value);
  if (
    !Number.isFinite(number)
    || (integer && !Number.isInteger(number))
    || (min !== undefined && number < min)
    || (max !== undefined && number > max)
    || (absMax !== undefined && Math.abs(number) > absMax)
  ) {
    throw buildError(errorFactory, message || `${fieldName} is invalid`);
  }
  return round ? Math.round(number) : number;
}

export function cleanIsoTimestamp(
  value,
  fieldName,
  {
    nullable = false,
    emptyAsNull = false,
    maxLength = 64,
    strictString = false,
    trim = true,
    pattern = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/,
    rejectAngleBracketsOrBackslash = true,
    rejectLocalPaths = true,
    message,
    errorFactory,
  } = {},
) {
  if (nullable && (value === null || (emptyAsNull && (value === undefined || value === "")))) {
    return null;
  }
  const text = cleanBoundedText(value, fieldName, {
    maxLength,
    strictString,
    trim,
    rejectAngleBracketsOrBackslash,
    rejectLocalPaths,
    message: message || `${fieldName} is invalid`,
    errorFactory,
  });
  if (!pattern.test(text) || Number.isNaN(Date.parse(text))) {
    throw buildError(errorFactory, message || `${fieldName} must be an ISO timestamp`);
  }
  return text;
}

export function parseIsoInstantMs(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[7] !== "Z" && (Number(match[8]) > 23 || Number(match[9]) > 59)) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return value;
}

export function cleanBoundedArray(
  value,
  fieldName,
  {
    maxLength,
    minLength = 0,
    itemValidator,
    uniqueKey,
    duplicateMessage,
    lengthMessage,
    errorFactory,
  } = {},
) {
  if (!Array.isArray(value) || value.length < minLength || (maxLength !== undefined && value.length > maxLength)) {
    throw buildError(
      errorFactory,
      lengthMessage || `${fieldName} must be an array with at most ${maxLength} items`,
    );
  }
  const items = [];
  const seen = uniqueKey ? new Set() : null;
  for (let index = 0; index < value.length; index += 1) {
    const item = itemValidator ? itemValidator(value[index], `${fieldName}[${index}]`, index) : value[index];
    if (seen) {
      const key = typeof uniqueKey === "function" ? uniqueKey(item) : item?.[uniqueKey];
      if (seen.has(key)) {
        throw buildError(errorFactory, duplicateMessage || `${fieldName} contains duplicate ${String(uniqueKey)}`);
      }
      seen.add(key);
    }
    items.push(item);
  }
  return items;
}

/**
 * Validate and normalize an object against a declarative schema specification.
 */
export function validateObjectSchema(value, schema, fieldName) {
  const {
    exactKeys,
    required,
    optional = [],
    keyErrorMessage,
    errorFactory,
    constants = {},
    fields = {},
    postValidate,
  } = schema;

  const source = exactKeys
    ? assertExactObject(value, exactKeys, fieldName, { message: keyErrorMessage, errorFactory })
    : required
      ? assertRequiredAndOptionalObject(value, required, optional, fieldName, { message: keyErrorMessage, errorFactory })
      : assertPlainObject(value, fieldName, { message: keyErrorMessage, errorFactory });

  for (const [key, spec] of Object.entries(constants)) {
    const expected = isPlainObject(spec) && Object.prototype.hasOwnProperty.call(spec, "value") ? spec.value : spec;
    const msg = isPlainObject(spec) && spec.message ? spec.message : `${fieldName}.${key} is unsupported`;
    assertConstantField(source[key], expected, msg, { errorFactory });
  }

  const normalized = {};
  for (const [key, validator] of Object.entries(fields)) {
    if (typeof validator === "function") {
      normalized[key] = validator(source[key], `${fieldName}.${key}`, source, normalized);
    } else {
      normalized[key] = source[key];
    }
  }
  if (postValidate) {
    postValidate(normalized, source, fieldName);
  }
  return normalized;
}

export function cleanSlug(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 120 || !/^[A-Za-z0-9._=-]+$/.test(text)) {
    throw new Error(`${field} must use letters, numbers, dot, underscore, dash, or equals`);
  }
  return text;
}

export function cleanRepositoryName(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 160 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    throw new Error(`${field} must be owner/repo`);
  }
  return text;
}

export function cleanLabel(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 80 || /[<>{}]/.test(text)) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}

export function cleanNumberText(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 32 || !/^(?:\d+|\d*\.\d+)$/.test(text)) {
    throw new Error(`${field} must be a finite decimal number`);
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) throw new Error(`${field} must be finite`);
  return text;
}

export function cleanPositiveNumber(value, field) {
  const text = cleanNumberText(value, field);
  if (Number(text) <= 0) throw new Error(`${field} must be greater than 0`);
  return text;
}

export function cleanNonNegativeNumber(value, field) {
  const text = cleanNumberText(value, field);
  if (Number(text) < 0) throw new Error(`${field} must be non-negative`);
  return text;
}

export function cleanRatio(value, field) {
  const text = cleanNumberText(value, field);
  const numeric = Number(text);
  if (numeric < 0 || numeric > 1) throw new Error(`${field} must be between 0 and 1`);
  return text;
}

export function cleanBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false" || value === "" || value === undefined || value === null) return false;
  throw new Error("boolean input is invalid");
}

export function cleanOptionalBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1") return true;
    if (text === "false" || text === "0") return false;
  }
  return null;
}

export function staleTtlSecondsFromEnv(envValue, defaultSeconds, { min = 300, max = 604800 } = {}) {
  const configured = Number(envValue);
  if (!Number.isFinite(configured) || configured < min || configured > max) {
    return defaultSeconds;
  }
  return Math.floor(configured);
}

export function normalizeSourceSnapshotEnvelope(
  payload,
  {
    schemaVersion,
    fieldName,
    itemsKey,
    itemLabel,
    maxItems = 1000,
    normalizeItem,
    uniqueKey,
    dataStatuses,
    normalizeIdentifier,
    normalizeTimestamp,
    normalizeErrors,
  },
) {
  const source = assertExactObject(
    payload,
    ["schema_version", "source_id", "generated_at", "computed_at", "data_status", itemsKey, "errors"],
    fieldName,
  );
  assertConstantField(source.schema_version, schemaVersion, `${fieldName}.schema_version is unsupported`);
  const dataStatus = cleanChoice(source.data_status, dataStatuses, `${fieldName}.data_status`);
  const items = cleanBoundedArray(source[itemsKey], `${fieldName}.${itemsKey}`, {
    maxLength: maxItems,
    itemValidator: (entry, itemPath) => normalizeItem(entry, itemPath),
    uniqueKey,
    duplicateMessage: `${fieldName}.${itemsKey} contains duplicate ${itemLabel || uniqueKey}`,
    lengthMessage: `${fieldName}.${itemsKey} must be an array with at most ${maxItems} items`,
  });
  if (dataStatus === "unavailable" && items.length) {
    throw new Error(`${fieldName}.${itemsKey} must be empty when unavailable`);
  }
  return {
    schema_version: schemaVersion,
    source_id: normalizeIdentifier(source.source_id, `${fieldName}.source_id`, false),
    generated_at: normalizeTimestamp(source.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeTimestamp(source.computed_at, `${fieldName}.computed_at`, true),
    data_status: dataStatus,
    [itemsKey]: items,
    errors: normalizeErrors(source.errors),
  };
}

export async function readIndexedSnapshotSources(
  env,
  {
    configStore,
    directoryList,
    readConfigJson,
    prefix,
    maxSources,
    normalizeSource,
    emptySource,
    listUnavailableCode,
    invalidSourceCode,
  },
) {
  const store = configStore(env);
  if (!store) return [];
  let listing;
  try {
    listing = await directoryList(env, prefix, maxSources);
  } catch {
    return [emptySource(listUnavailableCode)];
  }
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const sources = [];
  for (const entry of keys.slice(0, maxSources)) {
    const key = typeof entry?.name === "string" ? entry.name : "";
    if (!key.startsWith(prefix)) continue;
    try {
      const stored = await readConfigJson(env, key);
      if (!stored) throw new Error("indexed_record_unavailable");
      sources.push(await normalizeSource(stored, key));
    } catch {
      sources.push(emptySource(invalidSourceCode));
    }
  }
  return sources;
}

export function aggregateSnapshotMetrics(
  sources,
  {
    ttlSeconds,
    now = Date.now(),
    freshnessFn,
    earliestTimestampFn,
    staleErrorCode,
    uniqueStrings,
    onSource,
  },
) {
  const errors = [];
  const timestamps = [];
  let hasReadySource = false;
  let hasStaleSource = false;

  for (const source of sources) {
    const freshness = freshnessFn(source, ttlSeconds, now);
    if (source.generated_at) timestamps.push(source.generated_at);
    if (source.computed_at) timestamps.push(source.computed_at);
    if (freshness.data_status === "ready") hasReadySource = true;
    if (freshness.data_status === "stale") {
      hasStaleSource = true;
      errors.push(staleErrorCode);
    }
    if (onSource) {
      onSource(source, freshness, errors);
    }
    errors.push(...source.errors);
  }

  return {
    generated_at: earliestTimestampFn(timestamps),
    computed_at: earliestTimestampFn(timestamps),
    data_status: hasStaleSource ? "stale" : (hasReadySource ? "ready" : "unavailable"),
    errors: uniqueStrings(errors),
  };
}

export function stripAuditCompareFields(value, keys) {
  if (!value || typeof value !== "object") return value;
  const clone = structuredClone(value);
  for (const key of keys) delete clone[key];
  return clone;
}
