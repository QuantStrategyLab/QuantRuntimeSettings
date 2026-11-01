import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { ProxyError, verifyRequest } from './hmac.js';
import { createFirestoreStore, createReplayStore } from './replayStore.js';
import { createSecretManager } from './secretManager.js';
const unknown = { stage: 'add_unknown', finalize: 'finalize_unknown', cancel: 'cancel_unknown' };
const safe = op => ({ ok: true, operation_id: op.operation_id, state: op.state, updated_at: op.updated_at });
const exact = (raw, keys) => raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === keys.length && keys.every(k => Object.hasOwn(raw, k));
export function createProxyHandler({ keys, store, manager, now = Date.now, onDenial = () => process.stderr.write('rotation_auth_denied\n') }) {
  const replay = createReplayStore(store, { now });
  // Anonymous denials do not allocate per-client state, log bodies, or notify.
  let denialWindow = 0, denials = 0;
  const save = (op, state, expected = op.state) => replay.update({ ...op, state, updated_at: new Date(now()).toISOString() }, expected);
  async function reconcile(op) {
    if (['finalizing', 'finalize_unknown', 'canceling', 'cancel_unknown'].includes(op.state) && op.old_version && op.new_version) {
      try {
        const old = await manager.get(op.old_version), staged = await manager.get(op.new_version);
        const confirmed = op.action === 'finalize' ? old.state === 'DISABLED' && staged.state === 'ENABLED'
          : staged.state === 'DISABLED' && old.state === 'ENABLED';
        if (confirmed) return await save(op, op.action === 'finalize' ? 'finalized' : 'canceled');
      } catch { /* metadata failure does not confirm a write */ }
    }
    if (['adding_version', 'finalizing', 'canceling'].includes(op.state)) return { ...op, state: unknown[op.action] };
    return op;
  }
  return async request => {
    const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    let value;
    try {
      const url = new URL(request.url);
      const fixed = /^\/v1\/secrets\/ibkr_flex\/(metadata|versions)$/.exec(url.pathname);
      const operation = /^\/v1\/operations\/([A-Za-z0-9][A-Za-z0-9_-]{7,127})(?:\/(finalize|cancel))?$/.exec(url.pathname);
      const action = fixed ? fixed[1] === 'versions' ? 'stage' : 'metadata' : operation ? operation[2] || 'read' : null;
      if (!action || url.search || request.method !== (['metadata', 'read'].includes(action) ? 'GET' : 'POST')) throw new ProxyError('rotation_not_found', 404);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || '')) throw new ProxyError('rotation_invalid_request', 400);
      if (Number(request.headers.get('Content-Length') || 0) > 4096) throw new ProxyError('rotation_invalid_request', 400);
      const reader = request.body?.getReader(), chunks = []; let count = 0;
      if (reader) while (true) { const { done, value: bytes } = await reader.read(); if (done) break; count += bytes.byteLength;
        if (count > 4096) { await reader.cancel(); throw new ProxyError('rotation_invalid_request', 400); } chunks.push(bytes); }
      let body;
      try { body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
      catch { throw new ProxyError('rotation_invalid_request', 400); }
      let auth;
      try { auth = verifyRequest(request, body, keys, now()); }
      catch {
        if (now() - denialWindow >= 300000) { denialWindow = now(); denials = 0; }
        denials++;
        if (denials === 1) { try { onDenial(); } catch { /* logging cannot change authority */ } }
        throw new ProxyError(denials > 50 ? 'rotation_rate_limited' : 'rotation_auth_invalid', denials > 50 ? 429 : 403);
      }
      if (operation && auth.operationId !== operation[1]) throw new ProxyError('rotation_invalid_request', 400);
      if (['metadata', 'read'].includes(action)) { if (body) throw new ProxyError('rotation_invalid_request', 400); }
      else {
        let raw; try { raw = JSON.parse(body); } catch { throw new ProxyError('rotation_invalid_request', 400); }
        if (!exact(raw, action === 'stage' ? ['new_value'] : []) || action === 'stage' && (typeof raw.new_value !== 'string' || Buffer.byteLength(raw.new_value) < 1 || Buffer.byteLength(raw.new_value) > 1024)) throw new ProxyError('rotation_invalid_request', 400);
        value = raw.new_value; raw = undefined;
      }
      body = '';
      const reserved = await replay.reserve(auth, action);
      if (reserved.error) return json({ ok: false, error: reserved.error }, reserved.status);
      if (action === 'metadata') { await manager.list(); return json({ ok: true, available: true }); }
      let op = reserved.operation;
      if (!op) throw new ProxyError('rotation_operation_not_found', 404);
      if (action === 'read' || reserved.replayed) return json(safe(await reconcile(op)));
      try {
        const versions = await manager.list(), enabled = versions.filter(v => v.state === 'ENABLED');
        if (action === 'stage') {
          if (enabled.length !== 1) { op = await save(op, 'failed'); return json(safe(op)); }
          op = await replay.update({ ...op, old_version: enabled[0].name }, op.state);
          const staged = await manager.add(value); value = undefined;
          if (staged.state !== 'ENABLED' || staged.name === op.old_version) throw new ProxyError();
          op = await replay.update({ ...op, new_version: staged.name, state: 'staged', updated_at: new Date(now()).toISOString() }, op.state);
        } else {
          if (!op.old_version || !op.new_version || op.old_version === op.new_version || enabled.length !== 2
            || !enabled.some(v => v.name === op.old_version) || !enabled.some(v => v.name === op.new_version)) {
            // State drift has no safe mutation target. Retain a blocked operation.
            op = await save(op, unknown[action]); return json(safe(op));
          }
          const target = action === 'finalize' ? op.old_version : op.new_version;
          const disabled = await manager.disable(target);
          if (disabled.name !== target || disabled.state !== 'DISABLED') throw new ProxyError();
          op = await save(op, action === 'finalize' ? 'finalized' : 'canceled');
        }
      } catch {
        try { op = await save(op, unknown[action]); } catch { op = { ...op, state: unknown[action] }; }
      }
      return json(safe(op));
    } catch (error) {
      return json({ ok: false, error: error instanceof ProxyError ? error.message : 'rotation_unavailable' }, error instanceof ProxyError ? error.status : 503);
    } finally { value = undefined; }
  };
}
export function serve(handler, port) {
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 4096) { res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"ok":false,"error":"rotation_invalid_request"}'); return; } chunks.push(chunk); }
      if (['GET', 'HEAD'].includes(req.method) && length) { res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"ok":false,"error":"rotation_invalid_request"}'); return; }
      const request = new Request('https://proxy.invalid' + req.url, { method: req.method, headers: req.headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch { res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"ok":false,"error":"rotation_unavailable"}'); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  return server.listen(port);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const keys = JSON.parse(process.env.ROTATION_HMAC_KEYS || '{}');
    if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !Object.keys(keys).length
      || Object.entries(keys).some(([id, key]) => !/^[A-Za-z0-9_-]{1,32}$/.test(id) || typeof key !== 'string' || key.length < 32)) throw new ProxyError();
    serve(createProxyHandler({ keys, store: createFirestoreStore(process.env.ROTATION_FIRESTORE_DATABASE), manager: createSecretManager(process.env.ROTATION_TARGET_SECRET) }), Number(process.env.PORT || 8080));
  } catch { process.stderr.write('rotation_configuration_unavailable\n'); process.exitCode = 1; }
}
