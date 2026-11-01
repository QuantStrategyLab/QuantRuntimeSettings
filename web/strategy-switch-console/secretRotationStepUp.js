// No factor material is persisted. Verification results are consumed by SQLite.
export const rotationId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
export class RotationError extends Error {
  constructor(message = 'credential_rotation_unavailable', status = 503) { super(message); this.status = status; }
}
const enc = new TextEncoder();
export async function keyedDigest(key, value, hash = 'SHA-256') {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function rotationConfig(env) {
  const owner = env.CREDENTIAL_ROTATION_OWNER;
  let recovery;
  try { recovery = JSON.parse(env.CREDENTIAL_ROTATION_RECOVERY_VERIFIERS || '[]'); } catch { throw new RotationError(); }
  if (typeof owner !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(owner)
    || !/^[A-Z2-7]{32,128}$/.test(env.CREDENTIAL_ROTATION_TOTP_SEED || '')
    || typeof env.CREDENTIAL_ROTATION_FINGERPRINT_KEY !== 'string' || env.CREDENTIAL_ROTATION_FINGERPRINT_KEY.length < 32
    || !Array.isArray(recovery) || recovery.length > 32 || recovery.some(v => !/^[a-f0-9]{64}$/.test(v))
    || new Set(recovery).size !== recovery.length) throw new RotationError();
  return { owner, seed: env.CREDENTIAL_ROTATION_TOTP_SEED, recovery, key: env.CREDENTIAL_ROTATION_FINGERPRINT_KEY };
}
function decodeBase32(seed) {
  let bits = 0, value = 0; const out = [];
  for (const c of seed) { value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c); bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 255); } }
  return new Uint8Array(out);
}
export async function totp(seed, step) {
  const key = await crypto.subtle.importKey('raw', decodeBase32(seed), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const data = new Uint8Array(8); new DataView(data.buffer).setBigUint64(0, BigInt(step));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  const offset = mac[19] & 15;
  return String((new DataView(mac.buffer).getUint32(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let result = 0; for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
export async function factorCandidates(config, factor, now) {
  if (factor.method === 'totp' && /^\d{6}$/.test(factor.code)) {
    const step = Math.floor(now / 30000), matches = [];
    for (const n of [step - 1, step, step + 1]) if (n >= 0 && equal(await totp(config.seed, n), factor.code))
      matches.push(await keyedDigest(config.key, `totp:${config.seed}:${n}`));
    return matches;
  }
  if (factor.method === 'recovery') {
    const verifier = await keyedDigest(config.key, `recovery:${factor.code}`);
    if (config.recovery.some(v => equal(v, verifier))) return [verifier];
  }
  return [];
}
