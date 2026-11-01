import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
export class ProxyError extends Error {
  constructor(code = 'rotation_unavailable', status = 503) { super(code); this.status = status; }
}
export const canonicalRequest = ({ method, path, timestamp, nonce, operationId, requestId, digest }) =>
  ['qsl.rotation.v1', method, path, timestamp, nonce, operationId, requestId, digest].join('\n');
export const digest = body => createHash('sha256').update(body).digest('hex');
export const sign = (key, message) => createHmac('sha256', key).update(message).digest('hex');
export function verifyRequest(request, body, keys, now) {
  const keyId = request.headers.get('X-Rotation-Key'), key = Object.hasOwn(keys, keyId) ? keys[keyId] : null;
  const timestamp = request.headers.get('X-Rotation-Time'), nonce = request.headers.get('X-Rotation-Nonce');
  const operationId = request.headers.get('X-Rotation-Operation'), requestId = request.headers.get('X-Rotation-Request');
  const signature = request.headers.get('X-Rotation-Signature');
  if (!key || typeof key !== 'string' || key.length < 32 || !/^[A-Za-z0-9_-]{1,32}$/.test(keyId || '')
    || !/^\d{10}$/.test(timestamp || '') || Math.abs(now - Number(timestamp) * 1000) > 300000
    || !id(nonce) || !id(operationId) || !id(requestId) || !/^[a-f0-9]{64}$/.test(signature || '')) throw new ProxyError('rotation_auth_invalid', 403);
  const url = new URL(request.url), bodyHash = digest(body);
  const expected = sign(key, canonicalRequest({ method: request.method, path: url.pathname, timestamp, nonce, operationId, requestId, digest: bodyHash }));
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) throw new ProxyError('rotation_auth_invalid', 403);
  // A keyed comparison token, not a body digest or wire signature. Clock/nonce
  // changes do not change logical request identity. Never send it to a client.
  const fingerprint = sign(key, ['dedup.v1', request.method, url.pathname, operationId, requestId, bodyHash].join('\n'));
  return { keyId, nonce, operationId, requestId, fingerprint };
}
