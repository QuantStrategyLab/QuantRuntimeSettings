// Bounded read-only metadata query for the existing monitor failures.
const WORKER = 'qsl-strategy-switch-console';
const PATH = '/api/internal/sync-strategy-health';
const WINDOWS = [
  { name: '0130_sgt', from: Date.parse('2026-10-28T17:30:50Z'), to: Date.parse('2026-10-28T17:31:40Z') },
  { name: '0200_sgt', from: Date.parse('2026-10-28T18:00:50Z'), to: Date.parse('2026-10-28T18:01:30Z') },
  { name: 'mobile_0210_sgt', from: Date.parse('2026-10-28T18:10:00Z'), to: Date.parse('2026-10-28T18:14:00Z') },
];
const boundedStatus = n => Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
const bool = value => typeof value === 'boolean' ? value : null;
const sample = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;

export async function diagnose({ account, token, request = fetch }) {
  const result = { status: 'unavailable', stage: 'configuration', http_status: null,
    reason: 'configuration', error_codes: [],
    waf: 'workers_dev_zone_not_available', settings: null, windows: [] };
  if (!/^[a-f0-9]{32}$/i.test(account || '') || !token) return result;
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function call(path, body) {
    let response;
    try {
      response = await request(base + path, { method: body ? 'POST' : 'GET', headers,
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('transport'); }
    result.http_status = boundedStatus(response.status);
    result.error_codes = [];
    let text = '', size = 0;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('response_invalid');
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) throw new Error('response_too_large');
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel(); }
    } catch (error) {
      if (error?.message === 'response_too_large') throw error;
      if (!response.ok) throw new Error('http_failed');
      throw new Error('response_invalid');
    }
    let value;
    try { value = JSON.parse(text); } catch {
      throw new Error(response.ok ? 'response_invalid' : 'http_failed');
    }
    if (Array.isArray(value?.errors)) {
      result.error_codes = value.errors.slice(0, 10).map(item => item?.code)
        .filter(code => Number.isSafeInteger(code) && code >= 0 && code <= 99999999);
    }
    if (!response.ok) throw new Error('http_failed');
    if (value?.success !== true || result.error_codes.length || (Array.isArray(value.errors) && value.errors.length)) {
      throw new Error('response_invalid');
    }
    return value.result;
  }

  try {
    result.stage = 'settings';
    const settings = await call(`/workers/scripts/${WORKER}/settings`);
    const obs = settings?.observability, logs = obs?.logs;
    result.settings = { enabled: bool(obs?.enabled), logs_enabled: bool(logs?.enabled),
      invocation_logs: bool(logs?.invocation_logs), head_sampling_rate: sample(logs?.head_sampling_rate) };
    for (const window of WINDOWS) {
      result.stage = window.name;
      const mobile = window.name === 'mobile_0210_sgt';
      const triggers = mobile ? ['/api/decisions-inbox', '/api/accounts', '/api/performance/', '/api/runtime/today'] : [PATH];
      const triggerFilter = triggers.length === 1
        ? { key: '$metadata.trigger', operation: 'includes', type: 'string', value: triggers[0] }
        : { kind: 'group', filterCombination: 'or', filters: triggers.map(value =>
          ({ key: '$metadata.trigger', operation: 'includes', type: 'string', value })) };
      const query = { queryId: 'monitor-403-readonly', dry: true, view: 'events', limit: 25,
        timeframe: { from: window.from, to: window.to }, parameters: { datasets: ['cloudflare-workers'],
          filterCombination: 'and', filters: [
            { key: '$metadata.service', operation: 'eq', type: 'string', value: WORKER },
            triggerFilter,
          ] } };
      const value = await call('/workers/observability/telemetry/query', query);
      const collection = value?.events;
      if (!collection || !Array.isArray(collection.events) || typeof collection.count !== 'number'
          || !Number.isFinite(collection.count) || collection.count < 0) throw new Error('response_invalid');
      const rows = collection.events;
      const codes = rows.map(row => boundedStatus(row?.$metadata?.statusCode));
      result.windows.push({ window: window.name, matched_count: Math.min(collection.count, 1000000),
        returned_count: rows.length, truncated: collection.count > rows.length,
        status_403_count: codes.filter(code => code === 403).length,
        status_2xx_count: codes.filter(code => code !== null && code >= 200 && code < 300).length,
        status_4xx_count: codes.filter(code => code !== null && code >= 400 && code < 500).length,
        status_5xx_count: codes.filter(code => code !== null && code >= 500).length,
        exception_present_count: rows.filter(row => typeof row?.$metadata?.error === 'string' && row.$metadata.error.length > 0).length,
        exception_unknown_count: rows.filter(row => typeof row?.$metadata?.error !== 'string').length,
        status_unknown_count: codes.filter(code => code === null).length });
    }
    result.stage = 'complete'; result.status = 'complete'; result.reason = null;
  } catch (error) {
    // Stop on first error. Never emit URL, credentials, response body or exception text.
    result.reason = ['http_failed', 'response_invalid', 'response_too_large', 'transport'].includes(error?.message)
      ? error.message : 'response_invalid';
    result.status = 'unavailable';
  }
  return result;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = await diagnose({ account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
  console.log(JSON.stringify(result));
  if (result.status !== 'complete') process.exitCode = 1;
}
