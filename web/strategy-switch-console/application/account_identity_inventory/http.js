// Account-identity inventory HTTP and storage orchestration. Two entries:
// `inventoryResponse(request, cap)`, the internal path RuntimeInstances
// serves before storage initialization, which only runs the fixed statements
// through a capability that rejects every other statement and never creates,
// upgrades, repairs, caches or checkpoints anything; and the owner/admin GET
// `accountIdentityInventoryResponse(request, env, { readSession })`, which
// reads the signed session, the two named RuntimeInstances objects through
// that internal path and, when separately enabled, the KV namespace by direct
// list/get and three fixed configuration bindings. It never calls ordinary
// console, settings, readback, control, directory or credential handlers.
import { responseHeaders } from "../http_response.js";
import { base64UrlEncodeBytes } from "../auth/cookies.js";
import {
  ADMISSION_PREFIX, ALLOWED, CHANGES_SQL, CURSOR_CLOCK_SKEW_MS, CURSOR_CONTEXT, CURSOR_MAX_LENGTH, CURSOR_TTL_MS, COMMAND_FIELDS,
  DO_ERRORS, HEX64, INVENTORY_DO_PATH, INVENTORY_OBJECTS, INVENTORY_ORDERING, INVENTORY_PAGE_SIZE, INVENTORY_SCHEMA_VERSION,
  INVENTORY_TABLES, KV_IDENTITY_FIELDS, KV_PAGE_SIZE, KV_VALUE_MAX_BYTES, REQUEST_BYTE_LIMIT, RESPONSE_BYTE_BUDGET, ROW_BYTE_LIMIT,
  SCHEMA_SQL, SECTIONS, STATEMENTS, TABLE_INFO_SQL, TABLE_SPECS, UNKNOWN_COUNT, UNKNOWN_IDENTIFIER, unknownCount,
} from "./constants.js";
import {
  InventoryError, InventoryHttpError, assertStable, byteLength, compareBytes, decodeKey, encodeKey, fingerprints, fromBase64Url,
  identityProjection, kvFamily, pageSize, parameters, projectDoKv, projectRow, requireScan, sealParameters, sha256Hex,
  strategiesCacheAccounts,
} from "./helpers.js";

// The only storage surface the inventory can reach: allowlisted reads, list
// and getAlarm. No exec of caller text, put, delete, alarm or transaction.
export function inventoryCapability(storage, nonce) {
  const sql = storage.sql;
  return Object.freeze({
    nonce,
    query(statement, ...bindings) {
      if (!ALLOWED.has(statement) && !UNKNOWN_COUNT.test(statement)) throw new InventoryError("statement_not_allowed", 500);
      if (!bindings.every(value => value === null || ["string", "number"].includes(typeof value) || value instanceof Uint8Array || value instanceof ArrayBuffer)) {
        throw new InventoryError("binding_not_allowed", 500);
      }
      return [...sql.exec(statement, ...bindings)];
    },
    list: options => storage.list(options),
    getAlarm: () => storage.getAlarm(),
  });
}

// One synchronous read of schema and the connection change counter. In this
// runtime total_changes() advances on every committed row change (SQL and
// DO-KV, including alarms) and stays fixed under reads. getCurrentBookmark()
// is deliberately not called: the local runtime advances it on every call.
function observeSync(cap) {
  const schema = cap.query(SCHEMA_SQL).map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql ?? null }));
  const changes = Number(cap.query(CHANGES_SQL)[0]?.n);
  return { schema, changes };
}

function tableInfo(cap, name) {
  const columns = cap.query(TABLE_INFO_SQL, name).map(row => ({ name: row.name, type: row.type, pk: Number(row.pk) }));
  return { columns, pk: columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name) };
}

function schemaManifest(cap, observed) {
  const present = new Set(observed.schema.filter(row => row.type === "table").map(row => row.name));
  const tables = {};
  for (const spec of TABLE_SPECS) {
    if (!present.has(spec.name)) { tables[spec.name] = { group: spec.group, present: false, lazy: spec.lazy || null }; continue; }
    const info = tableInfo(cap, spec.name);
    const actual = info.columns.map(column => column.name);
    const statements = STATEMENTS.get(spec.name);
    const pkMatches = info.pk.join("\u0000") === spec.pk.join("\u0000");
    tables[spec.name] = {
      group: spec.group, present: true, count_only: spec.countOnly || null,
      columns: actual, missing_columns: spec.columns.filter(name => !actual.includes(name)),
      unexpected_columns: actual.filter(name => !spec.columns.includes(name)),
      primary_key: info.pk, primary_key_matches: pkMatches,
      row_count: Number(cap.query(statements.count)[0].n),
      null_key_rows: pkMatches ? Number(cap.query(statements.nullKeys)[0].n) : null,
    };
  }
  const other = [];
  for (const row of observed.schema) {
    if (row.type === "table" && INVENTORY_TABLES[row.name]) continue;
    const internal = row.name.startsWith("_cf_") ? "platform_internal" : row.name.startsWith("sqlite_") ? "sqlite_internal" : null;
    const entry = { type: row.type, name: row.name, tbl_name: row.tbl_name, classification: internal || (row.type === "table" ? "unknown_table" : row.type) };
    if (!internal && row.type === "table") {
      entry.row_count = UNKNOWN_IDENTIFIER.test(row.name) ? Number(cap.query(unknownCount(row.name))[0].n) : null;
      if (entry.row_count === null) entry.error = "unsupported_identifier";
      entry.columns = tableInfo(cap, row.name).columns.map(column => column.name);
    }
    other.push(entry);
  }
  const known = Object.values(tables);
  const unknownTables = other.filter(entry => entry.classification === "unknown_table");
  const state = !known.some(table => table.present) && !unknownTables.length ? "schema_absent"
    : known.every(table => table.present ? !table.missing_columns.length && table.primary_key_matches : table.lazy) ? "current" : "partial";
  return {
    schema_state: state, tables, other_schema_objects: other,
    missing_tables: TABLE_SPECS.filter(spec => !tables[spec.name].present).map(spec => spec.name),
    incompatible_tables: known.filter(table => table.present && (!table.primary_key_matches || table.missing_columns.length)).length,
  };
}

async function sqlPage(cap, command) {
  const spec = INVENTORY_TABLES[command.table];
  if (!spec) throw new InventoryError("unsupported_table");
  if (spec.countOnly) throw new InventoryError("count_only_table");
  const scan = requireScan(command.scan);
  const size = pageSize(command.page_size);
  const after = command.after ?? null;
  if (after !== null && (typeof after !== "object" || Array.isArray(after))) throw new InventoryError("invalid_cursor");
  const last = after?.last === undefined || after?.last === null ? null : after.last;
  if (last !== null && (!Array.isArray(last) || last.length !== spec.pk.length)) throw new InventoryError("invalid_cursor");
  const nested = after?.nested ?? null;
  if (nested !== null && (!spec.nested || !Array.isArray(nested.pk) || nested.pk.length !== spec.pk.length
    || !Number.isSafeInteger(nested.offset) || nested.offset < 1 || !HEX64.test(nested.payload_sha256)
    || JSON.stringify(nested.pk) !== JSON.stringify(last))) throw new InventoryError("invalid_cursor");
  const alarm = await cap.getAlarm();
  const observed = observeSync(cap);
  const present = observed.schema.some(row => row.type === "table" && row.name === spec.name);
  let rows = [], rowCount = 0, nullKeys = 0, info = null, nestedRow = null;
  if (present) {
    info = tableInfo(cap, spec.name);
    if (info.pk.join("\u0000") === spec.pk.join("\u0000")) {
      const statements = STATEMENTS.get(spec.name);
      rowCount = Number(cap.query(statements.count)[0].n);
      nullKeys = Number(cap.query(statements.nullKeys)[0].n);
      if (nested) nestedRow = cap.query(statements.exact, ...nested.pk.map(decodeKey))[0] ?? null;
      rows = last === null ? cap.query(statements.first, size + 1) : cap.query(statements.after, ...last.map(decodeKey), size + 1);
    }
  }
  const alarmAfter = await cap.getAlarm();
  const current = await fingerprints(cap.nonce, observed, alarm);
  assertStable(scan, current);
  if ((alarmAfter ?? null) !== (alarm ?? null) || Number(cap.query(CHANGES_SQL)[0]?.n) !== observed.changes) throw new InventoryError("changed_during_scan", 409);
  if (!present) return { ok: true, table: spec.name, present: false, rows: [], row_count: 0, terminal: true, next: null };
  if (info.pk.join("\u0000") !== spec.pk.join("\u0000")) throw new InventoryError("primary_key_mismatch", 409);
  const base = { ok: true, table: spec.name, present: true, row_count: rowCount, null_key_rows: nullKeys };
  if (nested) {
    // Continue one row's nested entries, tied to the unchanged stored value.
    if (!nestedRow) throw new InventoryError("changed_during_scan", 409);
    if (await sha256Hex(String(nestedRow[spec.nested])) !== nested.payload_sha256) throw new InventoryError("changed_during_scan", 409);
    const projected = projectRow(spec, nestedRow, { nested, nestedSize: size });
    const entries = projected.columns[spec.nested];
    const next = entries.entries_offset + entries.entries.length < entries.entry_count
      ? { last: nested.pk, nested: { ...nested, offset: entries.entries_offset + entries.entries.length } }
      : rows.length ? { last: nested.pk, nested: null } : null;
    return { ...base, rows: [projected], nested_continuation: true, terminal: next === null, byte_limited: false, next };
  }
  const out = [];
  let bytes = 0, next = null, byteLimited = false, lastPk = null;
  const lookahead = rows.length > size;
  for (const row of rows.slice(0, size)) {
    // Cursors continue from the raw key; actor-keyed rows export only its digest.
    const rawPk = spec.pk.map(column => encodeKey(row[column]));
    const pk = spec.actorKey ? [{ actor_key_sha256: await sha256Hex(JSON.stringify(rawPk)) }] : rawPk;
    let projected;
    try { projected = { ...projectRow(spec, row, { nestedSize: size }), pk }; }
    catch { projected = { pk, projection_error: "row_projection_failed" }; }
    let text = JSON.stringify(projected);
    if (byteLength(text) > ROW_BYTE_LIMIT) {
      projected = { pk, projection_error: "row_projection_too_large" };
      text = JSON.stringify(projected);
    }
    if (out.length && bytes + byteLength(text) > RESPONSE_BYTE_BUDGET) { byteLimited = true; break; }
    bytes += byteLength(text);
    out.push(projected);
    lastPk = rawPk;
    const entries = spec.nested ? projected.columns?.[spec.nested] : null;
    if (entries?.entries && entries.entries.length < entries.entry_count) {
      next = { last: rawPk, nested: { pk: rawPk, offset: entries.entries.length,
        payload_sha256: await sha256Hex(String(row[spec.nested])) } };
      break;
    }
  }
  if (!next && (lookahead || byteLimited) && out.length) next = { last: lastPk, nested: null };
  return { ...base, rows: out, terminal: next === null, byte_limited: byteLimited, next };
}

async function doKvPage(cap, command) {
  const scan = requireScan(command.scan);
  const size = pageSize(command.page_size);
  const last = command.after?.last ?? null;
  if (last !== null && (typeof last !== "string" || !last)) throw new InventoryError("invalid_cursor");
  const alarm = await cap.getAlarm();
  const observed = observeSync(cap);
  const listing = await cap.list(last === null ? { limit: size + 1 } : { limit: size + 1, startAfter: last });
  const alarmAfter = await cap.getAlarm();
  const changesAfter = Number(cap.query(CHANGES_SQL)[0]?.n);
  assertStable(scan, await fingerprints(cap.nonce, observed, alarm));
  if ((alarmAfter ?? null) !== (alarm ?? null) || changesAfter !== observed.changes) throw new InventoryError("changed_during_scan", 409);
  const now = Date.now();
  const keys = [];
  let previous = last;
  for (const [key, value] of listing) {
    if (typeof key !== "string" || (previous !== null && compareBytes(key, previous) <= 0)) throw new InventoryError("listing_progression_invalid", 502);
    previous = key;
    keys.push([key, value]);
  }
  const lookahead = keys.length > size;
  const out = [];
  let bytes = 0, byteLimited = false;
  let lastKey = null;
  for (const [key, value] of keys.slice(0, size)) {
    // Admission keys embed a console login: export the key's digest only.
    const shown = key.startsWith(ADMISSION_PREFIX) ? `${ADMISSION_PREFIX}sha256:${await sha256Hex(key)}` : key;
    let projected;
    try { projected = { key: shown, ...projectDoKv(key, value, now) }; }
    catch { projected = { key: shown, projection_error: "value_projection_failed" }; }
    const length = byteLength(JSON.stringify(projected));
    if (out.length && bytes + length > RESPONSE_BYTE_BUDGET) { byteLimited = true; break; }
    bytes += length;
    out.push(projected);
    lastKey = key;
  }
  const next = (lookahead || byteLimited) && out.length ? { last: lastKey } : null;
  return { ok: true, entries: out, terminal: next === null, byte_limited: byteLimited, next, alarm: alarm ?? null };
}

async function schemaPage(cap) {
  const alarm = await cap.getAlarm();
  const observed = observeSync(cap);
  const manifest = schemaManifest(cap, observed);
  const alarmAfter = await cap.getAlarm();
  if ((alarmAfter ?? null) !== (alarm ?? null) || Number(cap.query(CHANGES_SQL)[0]?.n) !== observed.changes) throw new InventoryError("changed_during_scan", 409);
  const current = await fingerprints(cap.nonce, observed, alarm);
  return { ok: true, ...manifest, alarm: alarm ?? null, stability_method: "connection_total_changes_v1",
    bookmark: { read: false, reason: "bookmark_read_not_proven_read_only" },
    scan: { scan_id: crypto.randomUUID(), schema: current.schema, stability: current.stability } };
}

async function finalizePage(cap, command) {
  const scan = requireScan(command.scan);
  const alarm = await cap.getAlarm();
  const observed = observeSync(cap);
  const manifest = schemaManifest(cap, observed);
  const current = await fingerprints(cap.nonce, observed, alarm);
  const stable = current.schema === scan.schema && current.stability === scan.stability;
  return { ok: true, stable, reason: stable ? null : current.schema !== scan.schema ? "schema_changed" : "changed_during_scan",
    schema_state: manifest.schema_state,
    row_counts: Object.fromEntries(Object.entries(manifest.tables).map(([name, table]) => [name, table.present ? table.row_count : null])),
    null_key_rows: Object.fromEntries(Object.entries(manifest.tables).map(([name, table]) => [name, table.present ? table.null_key_rows : null])),
    alarm: alarm ?? null };
}

export async function inventoryResponse(request, cap) {
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });
  try {
    if (request.method !== "POST") throw new InventoryError("method_not_allowed", 405);
    const text = await request.text();
    if (byteLength(text) > REQUEST_BYTE_LIMIT) throw new InventoryError("invalid_request");
    let command;
    try { command = JSON.parse(text); } catch { throw new InventoryError("invalid_request"); }
    if (!command || typeof command !== "object" || Array.isArray(command) || Object.keys(command).some(key => !COMMAND_FIELDS.has(key))) {
      throw new InventoryError("invalid_request");
    }
    if (!Object.hasOwn(INVENTORY_OBJECTS, command.object)) throw new InventoryError("unsupported_object");
    const base = { schema_version: INVENTORY_SCHEMA_VERSION, object: command.object, section: command.section,
      ordering: INVENTORY_ORDERING, observed_at: new Date().toISOString() };
    if (command.section === "schema") return respond({ ...base, ...await schemaPage(cap) });
    if (command.section === "sql") return respond({ ...base, ...await sqlPage(cap, command) });
    if (command.section === "do_kv") return respond({ ...base, ...await doKvPage(cap, command) });
    if (command.section === "finalize") return respond({ ...base, ...await finalizePage(cap, command) });
    throw new InventoryError("unsupported_section");
  } catch (error) {
    // Fixed codes only: never echo stored values, statements or provider text.
    return error instanceof InventoryError ? respond({ ok: false, error: error.code }, error.status) : respond({ ok: false, error: "inventory_read_failed" }, 500);
  }
}

function respond(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders({
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", ...extra,
  }) });
}

// Exactly these three bindings, read by literal name. No caller-selected name.
const ENV_BINDINGS = Object.freeze([
  ["STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON", env => env.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON],
  ["BINANCE_ACCOUNT_FACTS_BINDING_JSON", env => env.BINANCE_ACCOUNT_FACTS_BINDING_JSON],
  ["BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON", env => env.BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON],
]);

const encoder = new TextEncoder();
// Cursors and scan tokens are AES-GCM sealed: tamper-evident and opaque, so
// record keys never appear in URLs or access logs. No server-side state.
async function cursorKey(env) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode(CURSOR_CONTEXT));
  return crypto.subtle.importKey("raw", derived, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function seal(env, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(sealParameters(iv), await cursorKey(env), encoder.encode(JSON.stringify(payload)));
  return `${base64UrlEncodeBytes(iv)}.${base64UrlEncodeBytes(new Uint8Array(sealed))}`;
}
async function unseal(env, token, kind) {
  if (typeof token !== "string" || token.length > CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/.test(token)) throw new InventoryHttpError("invalid_cursor");
  const [iv, body] = token.split(".");
  let payload;
  try {
    const opened = await crypto.subtle.decrypt(sealParameters(fromBase64Url(iv)), await cursorKey(env), fromBase64Url(body));
    payload = JSON.parse(new TextDecoder().decode(opened));
  } catch { throw new InventoryHttpError("invalid_cursor"); }
  if (payload?.v !== 1 || payload.kind !== kind || payload.schema_version !== INVENTORY_SCHEMA_VERSION) throw new InventoryHttpError("invalid_cursor");
  if (!Number.isFinite(payload.issued_at) || Date.now() - payload.issued_at > CURSOR_TTL_MS || payload.issued_at > Date.now() + CURSOR_CLOCK_SKEW_MS) {
    throw new InventoryHttpError("cursor_expired");
  }
  return payload;
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
    const bytes = byteLength(text);
    if (bytes > KV_VALUE_MAX_BYTES) { keys.push({ ...item, state: "value_too_large", bytes }); continue; }
    const value_sha256 = await sha256Hex(text);
    let value;
    try { value = JSON.parse(text); }
    catch { keys.push({ ...item, state: "invalid_json", bytes, value_sha256 }); continue; }
    keys.push({ ...item, state: "exported", bytes, value_sha256, identity: identityProjection(value, KV_IDENTITY_FIELDS),
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
    if (!raw.trim()) { bindings.push({ name, state: "empty", bytes: byteLength(raw) }); continue; }
    const base = { name, bytes: byteLength(raw), value_sha256: await sha256Hex(raw) };
    let value;
    try { value = JSON.parse(raw); } catch { bindings.push({ ...base, state: "invalid_json" }); continue; }
    bindings.push({ ...base, state: "present", identity: identityProjection(value, KV_IDENTITY_FIELDS) });
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
