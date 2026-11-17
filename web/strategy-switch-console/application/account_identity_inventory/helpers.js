// Account-identity inventory pure helpers: error types, scalar, JSON, key,
// byte and digest helpers, the identity projections of stored rows, Desk
// records and KV values, and request parameter validation. No SQL, storage,
// session, environment or network access.
import {
  ADMISSION_PREFIX, CACHE_ACCOUNTS, CACHE_QUALIFIERS, CONFIG_IDENTITY, CURSOR_CONTEXT, DECLARATION_VALUES, DESK_IDENTITY_FIELDS,
  DESK_RECORD_PREFIX, DIRECTORY_STATE_KEY, HEX64, IDEMPOTENCY_PREFIX, IDENTITY_KEYS, INSTANCE_FIELDS, INVENTORY_OBJECTS,
  INVENTORY_PAGE_SIZE, INVENTORY_TABLES, KV_EXCLUDED_KEYS, KV_EXCLUDED_PREFIXES, KV_KEYS, KV_PAGE_SIZE, KV_PREFIXES, LONG_STRING,
  PARAMETERS, PROJECTION_MAX_DEPTH, ROW_IDENTITY_FIELDS, SCAN_ID, SECRET_KEY, SECTION_PARAMETERS, SECTIONS, SNAPSHOT_OVERALL,
  STRATEGIES_WRITE_STATE_KEY,
} from "./constants.js";

// The internal inventory path's error.
export class InventoryError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

// The Worker route's error.
export class InventoryHttpError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

const utf8 = new TextEncoder();
export const byteLength = text => utf8.encode(text).byteLength;
export async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest("SHA-256", utf8.encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function base64(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
export function encodeKey(value) {
  if (value instanceof ArrayBuffer) return { $blob: base64(new Uint8Array(value)) };
  if (value instanceof Uint8Array) return { $blob: base64(value) };
  return value;
}
export function decodeKey(value) {
  if (value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (value && typeof value === "object" && Object.keys(value).length === 1 && typeof value.$blob === "string") {
    return Uint8Array.from(atob(value.$blob), char => char.charCodeAt(0));
  }
  throw new InventoryError("invalid_cursor_key");
}
export const fromBase64Url = text => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)), char => char.charCodeAt(0));
// AES-GCM parameters of a sealed cursor or scan token.
export const sealParameters = iv => ({ name: "AES-GCM", iv, additionalData: utf8.encode(CURSOR_CONTEXT) });

export function scalar(value) {
  if (typeof value === "string") return value.length > LONG_STRING ? { long_string: value.length } : value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return null;
  if (value instanceof ArrayBuffer || value instanceof Uint8Array) return { blob_bytes: value.byteLength };
  return { type: typeof value };
}

// Bounded walk collecting identity scalars by path and array sizes as
// embedded record counts. Secret-like keys are named, never valued.
// With `optionKeyEvidence` (account-options sources only) the result also
// carries `option_key_truthy`: for each object directly in a root
// `platform` array whose first direct key or ID field is retained,
// `Boolean(option.key)` under its `platform[index]` path. It costs no field.
export function identityProjection(value, cap = ROW_IDENTITY_FIELDS, { optionKeyEvidence = false } = {}) {
  const fields = {}, counts = {}, redacted = [], evidence = {};
  let entries = 0, truncated = false;
  const visit = (node, path, depth, parentKey, slot) => {
    if (truncated) return;
    if (depth > PROJECTION_MAX_DEPTH) { truncated = true; return; }
    if (Array.isArray(node)) {
      counts[path || "$"] = node.length;
      const platformArray = optionKeyEvidence && depth === 1 && /^[^.[]+$/.test(path);
      node.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1, parentKey, platformArray));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, item] of Object.entries(node)) {
      const next = path ? `${path}.${key}` : key;
      if (SECRET_KEY.test(key) && key !== "account_key" && key !== "legacy_key" && key !== "storage_account_key" && key !== "target_key") {
        redacted.push(next);
        continue;
      }
      if (item && typeof item === "object") visit(item, next, depth + 1, key, false);
      else if (IDENTITY_KEYS.has(key) && (key !== "id" || parentKey !== undefined)) {
        if (++entries > cap) { truncated = true; return; }
        fields[next] = scalar(item);
        if (slot && (key === "key" || key === "id") && !Object.hasOwn(evidence, path)) evidence[path] = Boolean(node.key);
      }
    }
  };
  visit(value, "", 0, undefined, false);
  return optionKeyEvidence ? { fields, counts, redacted, truncated, option_key_truthy: evidence } : { fields, counts, redacted, truncated };
}

// `current_strategies_cache` stores `{ ts, data: { [platform]: { [accountKey]:
// entry } } }` (writeCurrentStrategiesCache and the KV directory `cache`
// action). The account is named only by its object key, and a fallback entry
// carries nothing but `execution_evidence`. This walk applies to that family
// alone; object keys elsewhere are never account identities.
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
export function strategiesCacheAccounts(value, cap = CACHE_ACCOUNTS) {
  if (!isObject(value)) return { state: "unexpected_shape", accounts: [], unexpected_platforms: 0, truncated: false };
  if (!Object.hasOwn(value, "data")) return { state: "data_absent", accounts: [], unexpected_platforms: 0, truncated: false };
  if (!isObject(value.data)) return { state: "unexpected_shape", accounts: [], unexpected_platforms: 0, truncated: false };
  const accounts = [];
  let unexpected = 0, truncated = false;
  for (const [platform, entries] of Object.entries(value.data)) {
    if (!isObject(entries)) { unexpected++; continue; }
    for (const [accountKey, entry] of Object.entries(entries)) {
      if (accounts.length >= cap) { truncated = true; break; }
      const evidence = isObject(entry) && isObject(entry.execution_evidence) ? entry.execution_evidence : null;
      const qualifiers = {};
      for (const source of [evidence, isObject(entry) ? entry : null]) {
        for (const field of CACHE_QUALIFIERS) if (typeof source?.[field] === "string" && source[field]) qualifiers[field] = scalar(source[field]);
      }
      const entryShape = !isObject(entry) ? "non_object" : Object.keys(entry).length === 1 && evidence ? "execution_evidence_only" : "strategy";
      accounts.push({ platform, account_key: accountKey, entry_shape: entryShape, evidence_status: scalar(evidence?.status ?? null), qualifiers });
    }
    if (truncated) break;
  }
  return { state: "valid", accounts, unexpected_platforms: unexpected, truncated };
}

function parseJson(text) {
  if (text === null || text === undefined) return { state: "null" };
  if (typeof text !== "string") return { state: "non_text", type: scalar(text) };
  try { return { state: "valid", bytes: byteLength(text), value: JSON.parse(text) }; }
  catch { return { state: "invalid_json", bytes: byteLength(text) }; }
}
function jsonIdentity(text, cap) {
  const parsed = parseJson(text);
  if (parsed.state !== "valid") return parsed;
  return { state: "valid", bytes: parsed.bytes, ...identityProjection(parsed.value, cap) };
}
function opaque(text) {
  const parsed = parseJson(text);
  return parsed.state === "valid" ? { state: "valid", bytes: parsed.bytes } : parsed;
}
function objectKeys(text) {
  const parsed = parseJson(text);
  if (parsed.state !== "valid") return parsed;
  const value = parsed.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? { state: "valid", bytes: parsed.bytes, keys: Object.keys(value).sort() }
    : { state: "unexpected_shape", bytes: parsed.bytes };
}

// Each declaration field reports absent, null, an accepted value, or an
// invalid value by type only.
function declarationField(object, field) {
  if (!Object.hasOwn(object, field)) return { present: false };
  const item = object[field];
  if (item === null) return { present: true, value: null, valid: true };
  return DECLARATION_VALUES[field].includes(item) ? { present: true, value: item, valid: true }
    : { present: true, valid: false, value_type: Array.isArray(item) ? "array" : typeof item };
}
export function declarationProjection(text) {
  const parsed = parseJson(text);
  if (parsed.state !== "valid") return parsed;
  const value = parsed.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { state: "unexpected_shape", bytes: parsed.bytes };
  return { state: "valid", bytes: parsed.bytes, environment: declarationField(value, "environment"),
    account_type: declarationField(value, "account_type"),
    unexpected_keys: Object.keys(value).filter(name => !Object.hasOwn(DECLARATION_VALUES, name)).sort() };
}

export function instanceIdentity(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return { unexpected_shape: true };
  const config = item.config && typeof item.config === "object" && !Array.isArray(item.config) ? item.config : null;
  const out = {};
  for (const field of INSTANCE_FIELDS) out[field] = scalar(item[field]);
  out.config = config ? Object.fromEntries(CONFIG_IDENTITY.filter(field => field in config).map(field => [field, scalar(config[field])])) : null;
  out.top_config_key_mismatch = config ? config.key !== item.key : null;
  return out;
}

// Binance wallet history alone stores `<legacy_key>:<source_binding_id>`
// composites (binanceWalletHistoryContext): an `account_facts_daily` row with
// platform `binance` and a 64-hex source binding the key ends with. Every
// other account key is literal, whatever its shape.
function logicalAccount(spec, row) {
  if (spec.name !== "account_facts_daily" || row.platform !== "binance") return undefined;
  const accountKey = row.account_key, bindingId = row.source_binding_id;
  if (typeof accountKey !== "string" || typeof bindingId !== "string" || !HEX64.test(bindingId)) return undefined;
  const prefix = accountKey.slice(0, -(bindingId.length + 1));
  return prefix && accountKey === `${prefix}:${bindingId}` ? { legacy_key: prefix, binding_id: bindingId, composite: true } : undefined;
}

export function projectRow(spec, row, { nested = null, nestedSize = 0 } = {}) {
  const out = { pk: spec.pk.map(column => encodeKey(row[column])) };
  const columns = {}, unexpected = [];
  for (const [name, value] of Object.entries(row)) {
    if (spec.pk.includes(name)) continue;
    if (spec.copy.includes(name)) columns[name] = scalar(value);
    else if (spec.json.includes(name)) columns[name] = jsonIdentity(value, ROW_IDENTITY_FIELDS);
    else if (spec.opaque.includes(name)) columns[name] = opaque(value);
    else if (spec.redact.includes(name)) columns[name] = { present: value !== null && value !== undefined && value !== "" };
    else if (spec.keys?.includes(name)) columns[name] = objectKeys(value);
    else if (spec.declaration === name) columns[name] = declarationProjection(value);
    else if (spec.history === name) {
      const parsed = parseJson(value);
      columns[name] = parsed.state !== "valid" ? parsed : !parsed.value || typeof parsed.value !== "object" ? { state: "unexpected_shape" } : {
        state: "valid", bytes: parsed.bytes, revision: scalar(parsed.value.revision), ts: scalar(parsed.value.ts),
        action: scalar(parsed.value.action), actor_present: Boolean(parsed.value.login),
        before: parsed.value.before ? instanceIdentity(parsed.value.before) : null,
        after: parsed.value.after ? instanceIdentity(parsed.value.after) : null,
      };
    } else if (spec.reportMetadata === name) {
      const parsed = parseJson(value);
      const meta = parsed.value;
      columns[name] = parsed.state !== "valid" ? parsed : !meta || typeof meta !== "object" ? { state: "unexpected_shape" } : {
        state: "valid", bytes: parsed.bytes, report_count: Array.isArray(meta.reports) ? meta.reports.length : null,
        reports_truncated: scalar(meta.reports_truncated ?? null), untracked_payload_write: scalar(meta.untracked_payload_write ?? null),
      };
    } else if (spec.nested === name) {
      const parsed = parseJson(value);
      if (parsed.state !== "valid") columns[name] = parsed;
      else if (!Array.isArray(parsed.value)) columns[name] = { state: "unexpected_shape", bytes: parsed.bytes };
      else {
        const offset = nested?.offset ?? 0;
        columns[name] = { state: "valid", bytes: parsed.bytes, entry_count: parsed.value.length, entries_offset: offset,
          entries: parsed.value.slice(offset, offset + nestedSize).map(instanceIdentity) };
      }
    } else unexpected.push(name);
  }
  for (const name of [...spec.copy, ...spec.json, ...spec.opaque, ...spec.redact, ...(spec.declaration ? [spec.declaration] : [])]) {
    if (!(name in row)) columns[name] = { column_absent: true };
  }
  out.columns = columns;
  if (unexpected.length) out.unexpected_columns = unexpected.sort();
  const logical = logicalAccount(spec, row);
  if (logical) out.logical_account = logical;
  if (spec.name === "binance_detail_daily" && typeof row.observation_date === "string" && row.observation_date.startsWith("digest:")) {
    out.digest_record = { business_day: row.observation_date.slice("digest:".length) };
  }
  return out;
}

// Schema and stability fingerprints of one observation: the capability
// nonce, the connection change counter, the alarm and the schema rows.
export async function fingerprints(nonce, observed, alarm) {
  const schema = await sha256Hex(JSON.stringify(observed.schema));
  const stability = await sha256Hex(JSON.stringify([nonce, observed.changes, alarm ?? null, schema]));
  return { schema, stability };
}

export function pageSize(value) {
  if (value === undefined || value === null) return INVENTORY_PAGE_SIZE.default;
  if (!Number.isSafeInteger(value) || value < 1 || value > INVENTORY_PAGE_SIZE.max) throw new InventoryError("invalid_page_size");
  return value;
}
export function requireScan(scan) {
  if (!scan || typeof scan !== "object" || Array.isArray(scan) || typeof scan.scan_id !== "string" || !SCAN_ID.test(scan.scan_id)
    || !HEX64.test(scan.schema) || !HEX64.test(scan.stability)) throw new InventoryError("invalid_scan");
  return scan;
}
export function assertStable(scan, current) {
  if (current.schema !== scan.schema) throw new InventoryError("schema_changed", 409);
  if (current.stability !== scan.stability) throw new InventoryError("changed_during_scan", 409);
}

export function compareBytes(left, right) {
  const a = utf8.encode(left), b = utf8.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}

// The Desk record store holds two shapes. `desk_readback_put` stores
// `{ owner, expires, payload: buildReadback() }`: a completed target snapshot
// under its own `rb_` id, with no job state, pending list or results.
// `desk_readback_start` stores a job with `payload.state`, `pending` and
// `results`. Anything else is `unrecognized` and is classified by state alone.
export function deskRecordKind(readbackId, value) {
  const record = value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  const payload = record?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "unrecognized";
  if (!Object.hasOwn(payload, "state") && !Object.hasOwn(record, "pending") && !Object.hasOwn(record, "results")
    && readbackId.startsWith("rb_") && payload.readback_id === readbackId && typeof payload.target_id === "string" && payload.target_id
    && SNAPSHOT_OVERALL.has(payload.overall) && typeof payload.read_at === "string" && Array.isArray(payload.fields)
    && payload.summary !== null && typeof payload.summary === "object") return "snapshot";
  if (Object.hasOwn(payload, "state") && Array.isArray(record.pending) && Array.isArray(record.results)) return "job";
  return "unrecognized";
}
export function projectDoKv(key, value, now) {
  const expiry = record => Number.isFinite(record?.expires) ? { expires: record.expires, expired: record.expires <= now } : {};
  if (key.startsWith(DESK_RECORD_PREFIX)) {
    const payload = value?.payload;
    const readbackId = key.slice(DESK_RECORD_PREFIX.length);
    return { family: "desk_readback_record", readback_id: readbackId, record_kind: deskRecordKind(readbackId, value), ...expiry(value),
      owner_present: Boolean(value?.owner), actor_present: Boolean(value?.actor),
      payload_state: scalar(payload?.state ?? null), pending: Array.isArray(value?.pending) ? value.pending.map(scalar) : null,
      result_count: Array.isArray(value?.results) ? value.results.length : null,
      payload_identity: payload && typeof payload === "object" ? identityProjection(payload, DESK_IDENTITY_FIELDS) : null };
  }
  if (key.startsWith(ADMISSION_PREFIX)) {
    // `active_state` keeps what `active` alone cannot: an explicit idle
    // (`active: null`, as release() writes) is distinct from an absent field,
    // a non-object value or an invalid `active` value.
    const record = value !== null && typeof value === "object" && !Array.isArray(value);
    const activeState = !record ? "unreadable" : !Object.hasOwn(value, "active") ? "missing" : value.active === null ? "idle"
      : typeof value.active === "string" && value.active ? "active" : `invalid:${typeof value.active}`;
    return { family: "desk_readback_admission", ...expiry(value), active_state: activeState,
      active: scalar(value?.active ?? null), next_allowed: scalar(value?.nextAllowed ?? null) };
  }
  if (key.startsWith(IDEMPOTENCY_PREFIX)) {
    return { family: "desk_idempotency", state: scalar(value?.state ?? null), request_id: scalar(value?.request_id ?? null),
      fingerprint_present: Boolean(value?.fingerprint), response_status: scalar(value?.response?.status ?? null) };
  }
  if (key === DIRECTORY_STATE_KEY) {
    return { family: "kv_directory_state", complete: scalar(value?.complete ?? null),
      key_count: Array.isArray(value?.keys) ? value.keys.length : null, cursor_present: Boolean(value?.cursor),
      scanned_at: scalar(value?.scanned_at ?? null), retry_at: scalar(value?.retry_at ?? null), list_day: scalar(value?.list_day ?? null),
      list_attempts: scalar(value?.list_attempts ?? null), error: scalar(value?.error ?? null),
      last_error: scalar(value?.last_error?.code ?? null), mirror_dirty: scalar(value?.mirror_dirty ?? null) };
  }
  if (key === STRATEGIES_WRITE_STATE_KEY) {
    return { family: "current_strategies_write_state", ts: scalar(value?.ts ?? null), signature_present: Boolean(value?.signature) };
  }
  return { family: "unknown", flag: "unknown_key", value_type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value };
}

export function kvFamily(name) {
  if (KV_KEYS.has(name)) return { family: name, reviewed: true };
  const prefix = KV_PREFIXES.find(value => name.startsWith(value));
  if (prefix) return { family: prefix, reviewed: true };
  if (KV_EXCLUDED_KEYS.has(name)) return { family: name, reviewed: false, state: "scope_excluded" };
  const excluded = KV_EXCLUDED_PREFIXES.find(value => name.startsWith(value));
  if (excluded) return { family: excluded, reviewed: false, state: "scope_excluded" };
  return { family: "unknown", reviewed: false, state: "unknown_family" };
}

// The Worker route's query: one value per supported parameter, only the
// parameters its section takes.
export function parameters(url) {
  const values = {};
  for (const [name, value] of url.searchParams) {
    if (!PARAMETERS.has(name)) throw new InventoryHttpError("unsupported_parameter");
    if (Object.hasOwn(values, name)) throw new InventoryHttpError("duplicate_parameter");
    values[name] = value;
  }
  if (!SECTIONS.has(values.section)) throw new InventoryHttpError("unsupported_section");
  const allowed = SECTION_PARAMETERS[values.section];
  if (Object.keys(values).some(name => name !== "section" && !allowed.includes(name))) throw new InventoryHttpError("unsupported_parameter");
  if (allowed.includes("object") && !Object.hasOwn(INVENTORY_OBJECTS, values.object)) throw new InventoryHttpError("unsupported_object");
  if (values.section === "sql" && !Object.hasOwn(INVENTORY_TABLES, values.table)) throw new InventoryHttpError("unsupported_table");
  if (values.page_size !== undefined) {
    const max = values.section === "kv" ? KV_PAGE_SIZE.max : INVENTORY_PAGE_SIZE.max;
    if (!/^[1-9][0-9]{0,3}$/.test(values.page_size) || Number(values.page_size) > max) throw new InventoryHttpError("invalid_page_size");
    values.page_size = Number(values.page_size);
  }
  if (["sql", "do_kv"].includes(values.section) && (values.cursor === undefined) === (values.scan === undefined)) {
    throw new InventoryHttpError("scan_or_cursor_required");
  }
  if (values.section === "finalize" && values.scan === undefined) throw new InventoryHttpError("scan_required");
  return values;
}
