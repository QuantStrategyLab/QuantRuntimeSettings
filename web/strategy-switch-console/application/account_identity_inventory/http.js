// Owner/admin GET for the read-only account-identity inventory. It reads the
// signed session, the two named RuntimeInstances objects through the internal
// inventory path, and, when separately enabled, the KV namespace by direct
// list/get and three fixed configuration bindings. It never calls ordinary
// console, settings, readback, control, directory or credential handlers.
import { responseHeaders } from "../http_response.js";
import { base64UrlEncodeBytes } from "../auth/cookies.js";
import {
  INVENTORY_DO_PATH, INVENTORY_OBJECTS, INVENTORY_ORDERING, INVENTORY_PAGE_SIZE, INVENTORY_SCHEMA_VERSION, INVENTORY_TABLES,
  identityProjection, strategiesCacheAccounts,
} from "./reader.js";

export const INVENTORY_ROUTE = "/api/admin/account-identity-inventory";
const SECTIONS = new Set(["manifest", "schema", "sql", "do_kv", "finalize", "kv", "env"]);
const PARAMETERS = new Set(["section", "object", "table", "page_size", "cursor", "scan"]);
const CURSOR_TTL_MS = 6 * 3600_000;
const KV_PAGE_SIZE = Object.freeze({ default: 50, max: 100 });
const KV_VALUE_MAX_BYTES = 2_000_000;
const CURSOR_CONTEXT = "qsl-account-identity-inventory-cursor-v1";
const DO_ERRORS = new Set(["invalid_request", "unsupported_object", "unsupported_section", "unsupported_table", "count_only_table",
  "invalid_scan", "invalid_cursor", "invalid_cursor_key", "invalid_page_size", "schema_changed", "changed_during_scan",
  "primary_key_mismatch", "listing_progression_invalid", "statement_not_allowed", "binding_not_allowed", "method_not_allowed"]);

// Reviewed identity-bearing KV families. Values outside this list are named
// in the page but never fetched.
const KV_KEYS = new Set(["account_options", "account_facts_bindings", "runtime_daily_bindings", "current_strategies_cache", "audit_log",
  "risk_profile_bindings", "private_binance_scope_report", "private_binance_account_facts", "console_kv_directory:v1"]);
const KV_PREFIXES = ["runtime_daily:", "account_facts_primary_backup:", "research_promotion_ticket:", "owner_decision_intent:",
  "owner_decision_current:", "reconciliation_recovery_source:", "reconciliation_recovery_confirmation:", "reconciliation_recovery_current:",
  "private_binance_account_facts:", "control_plane_source:", "adaptive_selection_source:", "execution_evidence_source:",
  "runtime_target_lifecycle_source:", "research_task_source:"];
const KV_EXCLUDED_KEYS = new Set(["auth_config", "strategy_profiles", "strategy_health_snapshot", "control_plane_snapshot",
  "control_plane_source_retirements", "m0_research_ledger_current"]);
const KV_EXCLUDED_PREFIXES = ["m0_research_ledger_archive:"];

// Exactly these three bindings, read by literal name. No caller-selected name.
const ENV_BINDINGS = Object.freeze([
  ["STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON", env => env.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON],
  ["BINANCE_ACCOUNT_FACTS_BINDING_JSON", env => env.BINANCE_ACCOUNT_FACTS_BINDING_JSON],
  ["BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON", env => env.BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON],
]);

class InventoryHttpError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function respond(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders({
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", ...extra,
  }) });
}

const encoder = new TextEncoder();
// Cursors and scan tokens are AES-GCM sealed: tamper-evident and opaque, so
// record keys never appear in URLs or access logs. No server-side state.
async function cursorKey(env) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode(CURSOR_CONTEXT));
  return crypto.subtle.importKey("raw", derived, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
const sealParameters = iv => ({ name: "AES-GCM", iv, additionalData: encoder.encode(CURSOR_CONTEXT) });
async function seal(env, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(sealParameters(iv), await cursorKey(env), encoder.encode(JSON.stringify(payload)));
  return `${base64UrlEncodeBytes(iv)}.${base64UrlEncodeBytes(new Uint8Array(sealed))}`;
}
const fromBase64Url = text => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)), char => char.charCodeAt(0));
async function unseal(env, token, kind) {
  if (typeof token !== "string" || token.length > 8192 || !/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/.test(token)) throw new InventoryHttpError("invalid_cursor");
  const [iv, body] = token.split(".");
  let payload;
  try {
    const opened = await crypto.subtle.decrypt(sealParameters(fromBase64Url(iv)), await cursorKey(env), fromBase64Url(body));
    payload = JSON.parse(new TextDecoder().decode(opened));
  } catch { throw new InventoryHttpError("invalid_cursor"); }
  if (payload?.v !== 1 || payload.kind !== kind || payload.schema_version !== INVENTORY_SCHEMA_VERSION) throw new InventoryHttpError("invalid_cursor");
  if (!Number.isFinite(payload.issued_at) || Date.now() - payload.issued_at > CURSOR_TTL_MS || payload.issued_at > Date.now() + 60_000) {
    throw new InventoryHttpError("cursor_expired");
  }
  return payload;
}

function parameters(url) {
  const values = {};
  for (const [name, value] of url.searchParams) {
    if (!PARAMETERS.has(name)) throw new InventoryHttpError("unsupported_parameter");
    if (Object.hasOwn(values, name)) throw new InventoryHttpError("duplicate_parameter");
    values[name] = value;
  }
  if (!SECTIONS.has(values.section)) throw new InventoryHttpError("unsupported_section");
  const allowed = {
    manifest: [], env: [], schema: ["object"], finalize: ["object", "scan"], kv: ["page_size", "cursor"],
    sql: ["object", "table", "page_size", "cursor", "scan"], do_kv: ["object", "page_size", "cursor", "scan"],
  }[values.section];
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

async function objectCall(env, object, command) {
  const namespace = env.STRATEGY_SWITCH_RUNTIME_INSTANCES;
  if (!namespace?.idFromName || !namespace?.get) throw new InventoryHttpError("runtime_instances_not_bound", 503);
  let response, body;
  try {
    response = await namespace.get(namespace.idFromName(INVENTORY_OBJECTS[object])).fetch(`https://runtime-instances${INVENTORY_DO_PATH}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object, ...command }),
    });
    body = await response.json();
  } catch { throw new InventoryHttpError("inventory_read_failed", 503); }
  if (!response.ok || body?.ok !== true) {
    const code = DO_ERRORS.has(body?.error) ? body.error : "inventory_read_failed";
    throw new InventoryHttpError(code, [400, 409].includes(response.status) ? response.status : 502);
  }
  return body;
}

async function scanFor(env, values) {
  if (values.cursor !== undefined) {
    const cursor = await unseal(env, values.cursor, "page");
    if (cursor.section !== values.section || cursor.object !== values.object || (cursor.table ?? null) !== (values.table ?? null)
      || cursor.ordering !== INVENTORY_ORDERING) throw new InventoryHttpError("cursor_scope_mismatch");
    return { cursor, scan: cursor.scan };
  }
  const scan = await unseal(env, values.scan, "scan");
  if (scan.object !== values.object) throw new InventoryHttpError("cursor_scope_mismatch");
  return { cursor: null, scan };
}
const scanFields = scan => ({ scan_id: scan.scan_id, schema: scan.schema, stability: scan.stability });

async function pageSection(env, values) {
  const { cursor, scan } = await scanFor(env, values);
  const command = { section: values.section, page_size: values.page_size ?? INVENTORY_PAGE_SIZE.default, scan: scanFields(scan),
    after: cursor ? cursor.after : null };
  if (values.section === "sql") command.table = values.table;
  const body = await objectCall(env, values.object, command);
  const page = (cursor?.page ?? 0) + 1;
  const next = body.next ? await seal(env, { v: 1, kind: "page", schema_version: INVENTORY_SCHEMA_VERSION, section: values.section,
    object: values.object, table: values.table ?? null, ordering: INVENTORY_ORDERING, after: body.next, scan, page,
    issued_at: Date.now() }) : null;
  delete body.next;
  return { ...body, scan_id: scan.scan_id, page, cursor: next };
}

function kvFamily(name) {
  if (KV_KEYS.has(name)) return { family: name, reviewed: true };
  const prefix = KV_PREFIXES.find(value => name.startsWith(value));
  if (prefix) return { family: prefix, reviewed: true };
  if (KV_EXCLUDED_KEYS.has(name)) return { family: name, reviewed: false, state: "scope_excluded" };
  const excluded = KV_EXCLUDED_PREFIXES.find(value => name.startsWith(value));
  if (excluded) return { family: excluded, reviewed: false, state: "scope_excluded" };
  return { family: "unknown", reviewed: false, state: "unknown_family" };
}
async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function kvSection(env, values) {
  if (env.ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED !== "true") throw new InventoryHttpError("section_disabled", 404);
  const store = env.STRATEGY_SWITCH_CONFIG;
  if (!store || typeof store.list !== "function" || typeof store.get !== "function") throw new InventoryHttpError("kv_not_bound", 503);
  const cursor = values.cursor === undefined ? null : await unseal(env, values.cursor, "page");
  if (cursor && cursor.section !== "kv") throw new InventoryHttpError("cursor_scope_mismatch");
  const limit = values.page_size ?? KV_PAGE_SIZE.default;
  let listing;
  try { listing = await store.list({ limit, ...(cursor ? { cursor: cursor.provider_cursor } : {}) }); }
  catch { throw new InventoryHttpError("kv_list_failed", 503); }
  if (!Array.isArray(listing?.keys) || typeof listing.list_complete !== "boolean"
    || (!listing.list_complete && (typeof listing.cursor !== "string" || !listing.cursor))) throw new InventoryHttpError("kv_listing_invalid", 502);
  const seen = new Set(), keys = [];
  for (const entry of listing.keys) {
    if (typeof entry?.name !== "string" || seen.has(entry.name)) throw new InventoryHttpError("kv_listing_invalid", 502);
    seen.add(entry.name);
    const family = kvFamily(entry.name);
    const item = { name: entry.name, family: family.family, expiration: entry.expiration ?? null, metadata_present: entry.metadata !== undefined && entry.metadata !== null };
    if (!family.reviewed) { keys.push({ ...item, state: family.state }); continue; }
    let text;
    try { text = await store.get(entry.name); }
    catch { keys.push({ ...item, state: "read_failed" }); continue; }
    if (text === null || text === undefined) { keys.push({ ...item, state: "missing_after_list" }); continue; }
    if (typeof text !== "string") { keys.push({ ...item, state: "non_text" }); continue; }
    const bytes = encoder.encode(text).byteLength;
    if (bytes > KV_VALUE_MAX_BYTES) { keys.push({ ...item, state: "value_too_large", bytes }); continue; }
    const value_sha256 = await sha256Hex(text);
    let value;
    try { value = JSON.parse(text); }
    catch { keys.push({ ...item, state: "invalid_json", bytes, value_sha256 }); continue; }
    keys.push({ ...item, state: "exported", bytes, value_sha256, identity: identityProjection(value, 4000),
      ...(family.family === "current_strategies_cache" ? { cache_accounts: strategiesCacheAccounts(value) } : {}) });
  }
  const page = (cursor?.page ?? 0) + 1;
  const scanId = cursor?.scan_id ?? crypto.randomUUID();
  const next = listing.list_complete ? null : await seal(env, { v: 1, kind: "page", schema_version: INVENTORY_SCHEMA_VERSION,
    section: "kv", provider_cursor: listing.cursor, scan_id: scanId, page, issued_at: Date.now() });
  return { ok: true, consistency: "eventual", keys, list_complete: listing.list_complete, terminal: listing.list_complete,
    scan_id: scanId, page, cursor: next };
}

async function envSection(env) {
  if (env.ACCOUNT_IDENTITY_INVENTORY_ENV_ENABLED !== "true") throw new InventoryHttpError("section_disabled", 404);
  const bindings = [];
  for (const [name, read] of ENV_BINDINGS) {
    const raw = read(env);
    if (raw === undefined || raw === null) { bindings.push({ name, state: "absent" }); continue; }
    if (typeof raw !== "string") { bindings.push({ name, state: "non_text" }); continue; }
    if (!raw.trim()) { bindings.push({ name, state: "empty", bytes: encoder.encode(raw).byteLength }); continue; }
    const base = { name, bytes: encoder.encode(raw).byteLength, value_sha256: await sha256Hex(raw) };
    let value;
    try { value = JSON.parse(raw); } catch { bindings.push({ ...base, state: "invalid_json" }); continue; }
    bindings.push({ ...base, state: "present", identity: identityProjection(value, 4000) });
  }
  const metadata = env.CF_VERSION_METADATA;
  const version = metadata && typeof metadata === "object"
    ? { available: true, id: metadata.id ?? null, tag: metadata.tag ?? null, timestamp: metadata.timestamp ?? null }
    : { available: false, reason: "version_metadata_binding_absent" };
  return { ok: true, bindings, deployment_version: version, binding_source: "deployed_worker_environment" };
}

function manifest(env) {
  return { ok: true, objects: Object.keys(INVENTORY_OBJECTS),
    tables: Object.values(INVENTORY_TABLES).map(spec => ({ name: spec.name, group: spec.group, primary_key: spec.pk, count_only: spec.countOnly || null })),
    sections: [...SECTIONS], page_size: INVENTORY_PAGE_SIZE, kv_page_size: KV_PAGE_SIZE,
    optional_sections: { kv: env.ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED === "true", env: env.ACCOUNT_IDENTITY_INVENTORY_ENV_ENABLED === "true" },
    stability_method: "connection_total_changes_v1", no_order: true, execution_authority_granted: false };
}

export async function accountIdentityInventoryResponse(request, env, { readSession }) {
  try {
    if (request.method !== "GET") return respond({ ok: false, error: "method_not_allowed" }, 405, { Allow: "GET" });
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const site = request.headers.get("Sec-Fetch-Site");
    if ((origin && origin !== url.origin) || (site && !["same-origin", "none"].includes(site))) {
      return respond({ ok: false, error: "cross_origin_rejected" }, 403);
    }
    let session = null;
    try { session = await readSession(request, env); } catch { session = null; }
    if (!session) return respond({ ok: false, error: "login_required" }, 401);
    if (!session.admin) return respond({ ok: false, error: "admin_required" }, 403);
    const values = parameters(url);
    const base = { schema_version: INVENTORY_SCHEMA_VERSION, section: values.section, observed_at: new Date().toISOString() };
    if (values.section === "manifest") return respond({ ...base, ...manifest(env) });
    if (values.section === "env") return respond({ ...base, ...await envSection(env) });
    if (values.section === "kv") return respond({ ...base, ...await kvSection(env, values) });
    if (values.section === "schema") {
      const body = await objectCall(env, values.object, { section: "schema" });
      const scan = await seal(env, { v: 1, kind: "scan", schema_version: INVENTORY_SCHEMA_VERSION, object: values.object,
        ...body.scan, issued_at: Date.now() });
      return respond({ ...body, scan_id: body.scan.scan_id, scan });
    }
    if (values.section === "finalize") {
      const scan = await unseal(env, values.scan, "scan");
      if (scan.object !== values.object) throw new InventoryHttpError("cursor_scope_mismatch");
      return respond({ ...await objectCall(env, values.object, { section: "finalize", scan: scanFields(scan) }), scan_id: scan.scan_id });
    }
    return respond(await pageSection(env, values));
  } catch (error) {
    // Fixed codes only. Records, statements, cookies and provider text are never echoed.
    if (error instanceof InventoryHttpError) return respond({ ok: false, error: error.code }, error.status);
    return respond({ ok: false, error: "inventory_failed" }, 500);
  }
}
