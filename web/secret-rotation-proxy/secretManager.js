import { ProxyError } from './hmac.js';
// Runtime identity only. No target-payload read or long-lived credential support.
export function googleTransport({ fetcher = fetch } = {}) {
  return async (url, options = {}, allowMissing = false) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
    try {
      const tokenResponse = await fetcher('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        { headers: { 'Metadata-Flavor': 'Google' }, redirect: 'error', signal: controller.signal });
      if (!tokenResponse.ok) throw new ProxyError();
      const token = await tokenResponse.json();
      if (typeof token.access_token !== 'string' || !token.access_token) throw new ProxyError();
      const response = await fetcher(url, { ...options, redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.access_token}` } });
      if (allowMissing && response.status === 404) return null;
      if (!response.ok) throw new ProxyError();
      return await response.json();
    } catch { throw new ProxyError(); } finally { clearTimeout(timer); }
  };
}
export function createSecretManager(target, { transport = googleTransport() } = {}) {
  if (typeof target !== 'string' || !/^projects\/[a-z0-9-]+\/secrets\/[A-Za-z0-9_-]+$/.test(target)) throw new ProxyError();
  const base = 'https://secretmanager.googleapis.com/v1/';
  const valid = name => typeof name === 'string' && name.startsWith(target + '/versions/') && /^[1-9]\d*$/.test(name.slice((target + '/versions/').length));
  const project = raw => {
    if (!raw || !valid(raw.name) || !['ENABLED', 'DISABLED', 'DESTROYED'].includes(raw.state)) throw new ProxyError();
    return { name: raw.name, state: raw.state };
  };
  return Object.freeze({
    async list() {
      const result = []; let page = '';
      for (let count = 0; count < 100; count++) {
        const raw = await transport(base + target + '/versions?pageSize=100' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
        if (!raw || (raw.versions !== undefined && !Array.isArray(raw.versions))) throw new ProxyError();
        result.push(...(raw.versions || []).map(project)); page = raw.nextPageToken || '';
        if (!page) return result;
      }
      throw new ProxyError();
    },
    async get(name) { if (!valid(name)) throw new ProxyError(); return project(await transport(base + name)); },
    async add(value) {
      if (typeof value !== 'string' || Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > 1024) throw new ProxyError();
      try { return project(await transport(base + target + ':addVersion', { method: 'POST', body: JSON.stringify({ payload: { data: Buffer.from(value, 'utf8').toString('base64') } }) })); }
      finally { value = undefined; }
    },
    async disable(name) { if (!valid(name)) throw new ProxyError(); return project(await transport(base + name + ':disable', { method: 'POST', body: '{}' })); },
  });
}
