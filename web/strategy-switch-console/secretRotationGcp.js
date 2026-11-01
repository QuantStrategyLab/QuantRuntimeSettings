import { keyedDigest, rotationId, RotationError } from './secretRotationStepUp.js';
export const PROXY_STATES = ['adding_version', 'staged', 'finalizing', 'finalized', 'canceling', 'canceled', 'add_unknown', 'finalize_unknown', 'cancel_unknown', 'failed'];
export const canonicalRequest = ({ method, path, timestamp, nonce, operationId, requestId, digest }) =>
  ['qsl.rotation.v1', method, path, timestamp, nonce, operationId, requestId, digest].join('\n');
export async function bodyDigest(body) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function proxyConfiguration(env) {
  let url;
  try { url = new URL(env.CREDENTIAL_ROTATION_PROXY_URL); } catch { throw new RotationError(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !/^[A-Za-z0-9_-]{1,32}$/.test(env.CREDENTIAL_ROTATION_HMAC_KEY_ID || '')
    || typeof env.CREDENTIAL_ROTATION_HMAC_KEY !== 'string' || env.CREDENTIAL_ROTATION_HMAC_KEY.length < 32) throw new RotationError();
  return { url: url.origin, keyId: env.CREDENTIAL_ROTATION_HMAC_KEY_ID, key: env.CREDENTIAL_ROTATION_HMAC_KEY };
}
export function safeProxyResult(raw, operationId) {
  if (!raw || Object.keys(raw).sort().join() !== 'ok,operation_id,state,updated_at' || raw.ok !== true
    || raw.operation_id !== operationId || !PROXY_STATES.includes(raw.state)
    || typeof raw.updated_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.updated_at)
    || !Number.isFinite(Date.parse(raw.updated_at)) || new Date(raw.updated_at).toISOString() !== raw.updated_at) throw new RotationError();
  return { ok: true, operation_id: raw.operation_id, state: raw.state, updated_at: raw.updated_at };
}
export function createRotationProxy(env, { fetcher = fetch, now = Date.now, nonce = () => crypto.randomUUID(), timeoutMs = 5000 } = {}) {
  const config = proxyConfiguration(env);
  // Workerd accepts only manual/follow. Probe before any network call; manual
  // plus strict status rejection enforces the same no-redirect boundary.
  let redirect = 'error';
  try { new Request(config.url, { redirect: 'error' }); } catch { redirect = 'manual'; }
  return async (action, operationId, requestId = operationId, value) => {
    if (!rotationId(operationId) || !rotationId(requestId) || !['stage', 'finalize', 'cancel', 'read', 'metadata'].includes(action)) throw new RotationError();
    const method = ['read', 'metadata'].includes(action) ? 'GET' : 'POST';
    const path = action === 'stage' ? '/v1/secrets/ibkr_flex/versions' : action === 'metadata' ? '/v1/secrets/ibkr_flex/metadata'
      : `/v1/operations/${operationId}${action === 'read' ? '' : '/' + action}`;
    let body = method === 'GET' ? '' : JSON.stringify(action === 'stage' ? { new_value: value } : {});
    const timestamp = String(Math.floor(now() / 1000)), random = nonce();
    if (!rotationId(random) || new TextEncoder().encode(body).byteLength > 4096) throw new RotationError();
    const signature = await keyedDigest(config.key, canonicalRequest({ method, path, timestamp, nonce: random, operationId, requestId, digest: await bodyDigest(body) }));
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(config.url + path, { method, redirect, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Rotation-Key': config.keyId, 'X-Rotation-Time': timestamp,
          'X-Rotation-Nonce': random, 'X-Rotation-Operation': operationId, 'X-Rotation-Request': requestId, 'X-Rotation-Signature': signature },
        ...(method === 'GET' ? {} : { body }) });
      if (!response.ok || response.redirected || response.status !== 200) throw new RotationError();
      const reader = response.body?.getReader(); let size = 0, text = '';
      if (!reader) throw new RotationError();
      const decoder = new TextDecoder();
      while (true) { const { done, value: bytes } = await reader.read(); if (done) break;
        size += bytes.byteLength; if (size > 4096) { await reader.cancel(); throw new RotationError(); } text += decoder.decode(bytes, { stream: true }); }
      text += decoder.decode();
      const result = JSON.parse(text);
      if (action === 'metadata') {
        if (!result || Object.keys(result).sort().join() !== 'available,ok' || result.ok !== true || result.available !== true) throw new RotationError();
        return { ok: true, available: true };
      }
      return safeProxyResult(result, operationId);
    } catch { throw new RotationError(); }
    finally { clearTimeout(timer); body = ''; value = undefined; }
  };
}
