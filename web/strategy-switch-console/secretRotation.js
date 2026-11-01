import { normalizeExpiryInstant, finalizeCredentialMaintenance } from './credentialMaintenance.js';
import { RotationError, rotationId, rotationConfig, keyedDigest, factorCandidates } from './secretRotationStepUp.js';
import { createRotationProxy, proxyConfiguration } from './secretRotationGcp.js';
const TERMINAL = new Set(['finalized', 'canceled', 'failed']);
const UNKNOWN = { stage: 'add_unknown', finalize: 'finalize_unknown', cancel: 'cancel_unknown' };
const PENDING = { stage: 'adding_version', finalize: 'finalizing', cancel: 'canceling' };
const DONE = { stage: 'staged', finalize: 'finalized', cancel: 'canceled' };
export const ROTATION_REASONS = ['proxy_unconfirmed', 'maintenance_revision_conflict', 'provider_failed'];
const invalid = () => { throw new RotationError('invalid_credential_rotation_request', 400); };
export function exactKeys(raw, keys) {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    && Object.keys(raw).length === keys.length && keys.every(k => Object.hasOwn(raw, k));
}
export function validateRotationRequest(raw, action, now) {
  const fields = action === 'stage' ? ['request_id', 'new_value', 'expires_at', 'step_up']
    : action === 'finalize' ? ['request_id', 'downstream_verified', 'step_up'] : ['request_id', 'step_up'];
  if (!exactKeys(raw, fields) || !rotationId(raw.request_id) || !exactKeys(raw.step_up, ['method', 'code'])
    || !['totp', 'recovery'].includes(raw.step_up.method) || typeof raw.step_up.code !== 'string'
    || raw.step_up.code.length < 1 || raw.step_up.code.length > 128) invalid();
  if (action === 'stage') {
    if (typeof raw.new_value !== 'string' || new TextEncoder().encode(raw.new_value).byteLength < 1
      || new TextEncoder().encode(raw.new_value).byteLength > 1024) invalid();
    try {
      const expiry = normalizeExpiryInstant(raw.expires_at);
      if (!expiry) throw Error();
      return { ...raw, expires_at: expiry };
    } catch { throw new RotationError('invalid_credential_expiry', 400); }
  }
  if (action === 'finalize' && raw.downstream_verified !== true) invalid();
  return raw;
}
export function initializeSecretRotation(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS credential_rotation_operations (operation_id TEXT PRIMARY KEY, record TEXT NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS credential_rotation_requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, operation_id TEXT NOT NULL, action TEXT NOT NULL, response TEXT NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS credential_rotation_factors (factor TEXT PRIMARY KEY)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS credential_rotation_throttle (actor TEXT PRIMARY KEY, window_start INTEGER NOT NULL, failures INTEGER NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS credential_rotation_audit (event_id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, operation_id TEXT, outcome TEXT NOT NULL, reason TEXT)`);
}
const load = (sql, id) => { const row = sql.exec('SELECT record FROM credential_rotation_operations WHERE operation_id = ?', id).toArray()[0]; return row ? JSON.parse(row.record) : null; };
const latest = sql => { const row = sql.exec('SELECT record FROM credential_rotation_operations ORDER BY rowid DESC LIMIT 1').toArray()[0]; return row ? JSON.parse(row.record) : null; };
const save = (sql, op) => sql.exec('INSERT INTO credential_rotation_operations VALUES (?, ?) ON CONFLICT(operation_id) DO UPDATE SET record=excluded.record', op.operation_id, JSON.stringify(op));
function audit(sql, command, action, outcome, reason = null, operationId = command.operation_id) {
  sql.exec('INSERT OR IGNORE INTO credential_rotation_audit VALUES (?, ?, ?, ?, ?, ?, ?)',
    `${command.event_id}:${action}:${outcome}`, new Date(command.now).toISOString(), command.actor || '', action, operationId ?? null, outcome, reason);
}
function metadata(sql) {
  const row = sql.exec("SELECT expires_at, last_rotated_at FROM credential_maintenance_metadata WHERE id = 'ibkr_flex'").toArray()[0];
  return { name: 'IBKR Flex token', last_rotated_at: row?.last_rotated_at ?? null, expires_at: row?.expires_at ?? null };
}
export function rotationEnvelope(sql, op, now, owner, replayed) {
  return { schema_version: 'qsl.credential_rotation.v1', ok: true, server_time: new Date(now).toISOString(), metadata: metadata(sql),
    operation: op ? { operation_id: op.operation_id, state: op.state, requested_expires_at: op.requested_expires_at,
      created_at: op.created_at, updated_at: op.updated_at, allowed_actions: owner && op.state === 'staged' ? ['finalize', 'cancel'] : [], reason_code: op.reason_code } : null,
    allowed_actions: owner && (!latest(sql) || TERMINAL.has(latest(sql).state)) ? ['stage'] : [],
    ...(replayed === undefined ? {} : { replayed }) };
}
const failure = (error, status) => ({ error, status });
// This entire function is synchronous and runs in a single owning SQLite transaction.
export function rotationCommand(sql, c, factors = []) {
  let op = c.operation_id ? load(sql, c.operation_id) : latest(sql);
  if (c.action === 'rotation_denied') { audit(sql, c, 'credential_rotation_denied', 'denied', c.reason); return { ok: true }; }
  if (c.action === 'rotation_read') {
    if (c.operation_id && !op) return failure('credential_rotation_operation_not_found', 404);
    return { envelope: rotationEnvelope(sql, op, c.now, c.owner), reconcile: op && !TERMINAL.has(op.state) && op.state !== 'staged' ? op.operation_id : null };
  }
  if (c.action === 'rotation_begin') {
    const prior = sql.exec('SELECT * FROM credential_rotation_requests WHERE request_id = ?', c.request_id).toArray()[0];
    if (prior) {
      if (prior.fingerprint !== c.fingerprint || prior.action !== c.write_action || (c.write_action !== 'stage' && prior.operation_id !== c.operation_id))
        return failure('credential_rotation_request_conflict', 409);
      return { replayed: true, envelope: { ...JSON.parse(prior.response), replayed: true } };
    }
    if (c.write_action === 'stage' && Date.parse(c.expires_at) <= c.now) return failure('invalid_credential_expiry', 400);
    if (c.write_action !== 'stage' && !op) return failure('credential_rotation_operation_not_found', 404);
    if (c.write_action === 'stage' ? latest(sql) && !TERMINAL.has(latest(sql).state) : op.state !== 'staged')
      return failure('credential_rotation_state_conflict', 409);
    const revision = sql.exec("SELECT revision FROM credential_maintenance_metadata WHERE id = 'ibkr_flex'").toArray()[0]?.revision ?? 0;
    if (c.write_action === 'finalize' && revision !== op.maintenance_revision) return failure('credential_maintenance_revision_conflict', 409);
    const throttle = sql.exec('SELECT * FROM credential_rotation_throttle WHERE actor = ?', c.actor).toArray()[0];
    const within = throttle && c.now - throttle.window_start < 300000;
    if (within && throttle.failures >= 5) { audit(sql, c, 'credential_rotation_denied', 'denied', 'step_up_rate_limited'); return failure('step_up_rate_limited', 429); }
    const used = factors.some(factor => sql.exec('SELECT factor FROM credential_rotation_factors WHERE factor = ?', factor).toArray().length);
    if (!factors.length || used) {
      sql.exec('INSERT INTO credential_rotation_throttle VALUES (?, ?, ?) ON CONFLICT(actor) DO UPDATE SET window_start=excluded.window_start, failures=excluded.failures',
        c.actor, within ? throttle.window_start : c.now, within ? throttle.failures + 1 : 1);
      audit(sql, c, 'credential_rotation_denied', 'denied', 'step_up_invalid'); return failure('step_up_invalid', 403);
    }
    for (const factor of factors) sql.exec('INSERT INTO credential_rotation_factors VALUES (?)', factor);
    sql.exec('DELETE FROM credential_rotation_throttle WHERE actor = ?', c.actor);
    const at = new Date(c.now).toISOString();
    if (c.write_action === 'stage') op = { operation_id: c.operation_id, credential_id: 'ibkr_flex', requested_expires_at: c.expires_at,
      maintenance_revision: revision, actor: c.actor, created_at: at };
    Object.assign(op, { state: PENDING[c.write_action], updated_at: at, reason_code: null, current_action: c.write_action, current_request_id: c.request_id });
    save(sql, op);
    const envelope = rotationEnvelope(sql, op, c.now, true, false);
    sql.exec('INSERT INTO credential_rotation_requests VALUES (?, ?, ?, ?, ?)', c.request_id, c.fingerprint, op.operation_id, c.write_action, JSON.stringify(envelope));
    return { envelope, operation_id: op.operation_id };
  }
  if (c.action === 'rotation_complete') {
    if (!op) return failure('credential_rotation_operation_not_found', 404);
    const action = op.current_action;
    if (TERMINAL.has(op.state) || op.state === 'staged') return { envelope: rotationEnvelope(sql, op, c.now, c.owner) };
    const expected = DONE[action];
    let state = c.proxy_state === expected ? expected : c.proxy_state === 'failed' ? 'failed' : UNKNOWN[action];
    let reason = state === UNKNOWN[action] ? 'proxy_unconfirmed' : state === 'failed' ? 'provider_failed' : null;
    if (state === 'finalized') {
      try { finalizeCredentialMaintenance(sql, op.maintenance_revision, op.requested_expires_at, new Date(c.now).toISOString()); }
      catch { state = 'finalize_unknown'; reason = 'maintenance_revision_conflict'; }
    }
    Object.assign(op, { state, updated_at: new Date(c.now).toISOString(), reason_code: reason });
    save(sql, op);
    audit(sql, { ...c, actor: op.actor, event_id: op.current_request_id }, `credential_rotation_${action}`, state, reason);
    const envelope = rotationEnvelope(sql, op, c.now, c.owner, false);
    sql.exec('UPDATE credential_rotation_requests SET response = ? WHERE request_id = ?', JSON.stringify(envelope), op.current_request_id);
    return { envelope };
  }
  throw new RotationError();
}
export async function durableRotationCommand(storage, sql, env, command) {
  let factors = [];
  if (command.action === 'rotation_begin') {
    const prior = sql.exec('SELECT request_id FROM credential_rotation_requests WHERE request_id = ?', command.request_id).toArray()[0];
    if (!prior) factors = await factorCandidates(rotationConfig(env), command.step_up, command.now);
  }
  return storage.transactionSync(() => rotationCommand(sql, command, factors));
}
// Dependencies also allow tests to run at synthetic instants without production flags.
export async function credentialRotationResponse(request, env, { session, command, now = Date.now, uuid = () => crypto.randomUUID(), proxy } = {}) {
  const respond = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  let raw, newValue;
  try {
    const who = await session(request, env);
    if (!who?.allowed) return respond({ ok: false, error: 'login required' }, 401);
    const url = new URL(request.url), match = /^\/api\/credential-rotation\/ibkr_flex(?:\/(stage)|\/operations\/([A-Za-z0-9_-]+)(?:\/(finalize|cancel))?)?$/.exec(url.pathname);
    if (!match || url.search) invalid();
    const action = match[1] || match[3], operationId = match[2];
    if (operationId && !rotationId(operationId)) invalid();
    if (request.method !== (action ? 'POST' : 'GET')) invalid();
    const config = rotationConfig(env); proxyConfiguration(env);
    const owner = who.admin === true && who.login === config.owner;
    const at = now(), event = uuid();
    const deny = async (error, status) => {
      await command(env, { action: 'rotation_denied', actor: who.login, now: at, event_id: event, reason: error });
      return respond({ ok: false, error }, status);
    };
    if (action) {
      const origin = request.headers.get('Origin');
      if (!origin) return await deny('origin_required', 403);
      if (origin !== url.origin) return await deny('cross_origin_rejected', 403);
      if (!owner) return await deny('rotation_owner_required', 403);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || '')) invalid();
      if (Number(request.headers.get('Content-Length') || 0) > 4096) invalid();
      const reader = request.body?.getReader(); if (!reader) invalid();
      const chunks = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 4096) { await reader.cancel(); invalid(); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { invalid(); }
      raw = validateRotationRequest(raw, action, at);
      const fingerprint = await keyedDigest(config.key, JSON.stringify([action, operationId ?? null, raw.request_id, raw.new_value ?? null, raw.expires_at ?? null, raw.downstream_verified ?? null, raw.step_up.method, raw.step_up.code]));
      newValue = raw.new_value; delete raw.new_value;
      const begin = await command(env, { action: 'rotation_begin', write_action: action, actor: who.login, owner: true, now: at,
        event_id: event, operation_id: operationId || uuid(), request_id: raw.request_id, fingerprint, expires_at: raw.expires_at, step_up: raw.step_up });
      raw.step_up = undefined;
      if (begin.error) return respond({ ok: false, error: begin.error }, begin.status);
      if (begin.replayed) return respond(begin.envelope);
      const invoke = proxy || createRotationProxy(env);
      let state;
      try { state = (await invoke(action, begin.operation_id, raw.request_id, newValue)).state; } catch { state = UNKNOWN[action]; }
      finally { newValue = undefined; }
      try {
        const completed = await command(env, { action: 'rotation_complete', operation_id: begin.operation_id, proxy_state: state,
          actor: who.login, owner: true, now: now() });
        return respond(completed.envelope);
      } catch {
        // The durable begin survives completion failure; GET reconciles it.
        return respond({ ...begin.envelope, operation: { ...begin.envelope.operation, state: UNKNOWN[action], allowed_actions: [], reason_code: 'proxy_unconfirmed' } });
      }
    }
    const read = await command(env, { action: 'rotation_read', operation_id: operationId, actor: who.login, owner, now: at });
    if (read.error) return respond({ ok: false, error: read.error }, read.status);
    if (read.reconcile) {
      let result;
      try { result = await (proxy || createRotationProxy(env))('read', read.reconcile); } catch { /* unknown stays unknown */ }
      const completed = await command(env, { action: 'rotation_complete', operation_id: read.reconcile, proxy_state: result?.state,
        actor: who.login, owner, now: now() });
      return respond(completed.envelope);
    }
    return respond(read.envelope);
  } catch (error) {
    if (error instanceof RotationError) return respond({ ok: false, error: error.message }, error.status);
    return respond({ ok: false, error: 'credential_rotation_unavailable' }, 503);
  } finally { newValue = undefined; raw = undefined; }
}
