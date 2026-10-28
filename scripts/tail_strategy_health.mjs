// The tail runs only in the protected Actions environment. Never print raw events.
export function classifyEvent(raw, expectedOrigin) {
  let event;
  try { event = JSON.parse(raw); } catch { return null; }
  const request = event?.event?.request;
  if (request?.method !== 'POST' || typeof request.url !== 'string') return null;
  let url;
  try { url = new URL(request.url); } catch { return null; }
  if (url.origin !== expectedOrigin || url.pathname !== '/api/internal/sync-strategy-health' || url.search || url.hash) return null;
  const status = event?.event?.response?.status;
  const timestamp = event?.eventTimestamp;
  return {
    matched: true,
    http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    time: Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp <= 8640000000000000 ? new Date(timestamp).toISOString() : null,
    outcome: ['ok', 'canceled', 'exception', 'exceededCpu', 'exceededMemory'].includes(event.outcome) ? event.outcome : 'unknown',
  };
}

export async function decodeMessage(data) {
  if (typeof data === 'string') return Buffer.byteLength(data) <= 1048576 ? data : null;
  if (data instanceof Blob) return data.size <= 1048576 ? await data.text() : null;
  if (data instanceof ArrayBuffer) return data.byteLength <= 1048576 ? new TextDecoder().decode(data) : null;
  return null;
}

export async function run() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  let expectedOrigin;
  try {
    const target = new URL(process.env.STRATEGY_SWITCH_CONSOLE_URL);
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash || !['', '/'].includes(target.pathname)) return { reason: 'config_invalid' };
    expectedOrigin = target.origin;
  } catch { return { reason: 'config_invalid' }; }
  if (!token || !/^[a-f0-9]{32}$/.test(account || '')) return { reason: 'config_invalid' };
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/qsl-strategy-switch-console/tails`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let id;
  let socket;
  let opened = false;
  let result = { reason: 'unknown' };
  try {
    const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ filters: [{ method: ['POST'] }] }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { reason: response.status === 403 ? 'tail_forbidden' : 'tail_http_failed', http_status: response.status };
    const envelope = await response.json();
    if (/^[a-f0-9]{32}$/.test(envelope?.result?.id || '')) id = envelope.result.id;
    if (envelope?.success !== true || !id || typeof envelope?.result?.url !== 'string') { result = { reason: 'tail_response_invalid' }; throw new Error(); }
    const tailUrl = new URL(envelope.result.url);
    if (tailUrl.protocol !== 'wss:') throw new Error('invalid_tail_url');
    result = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ reason: 'window_elapsed', matched: false }), 180000);
      const done = (value) => { clearTimeout(timer); resolve(value); };
      socket = new WebSocket(tailUrl, 'trace-v1');
      socket.addEventListener('open', () => {
        opened = true;
        try { socket.send(JSON.stringify({ debug: false })); } catch { done({ reason: 'stream_error' }); }
      });
      socket.addEventListener('message', async (message) => {
        try {
          const raw = await decodeMessage(message.data);
          const match = raw === null ? null : classifyEvent(raw, expectedOrigin);
          if (match) done({ reason: 'matched', ...match });
        } catch { done({ reason: 'stream_error' }); }
      });
      socket.addEventListener('error', () => done({ reason: 'stream_error' }));
      socket.addEventListener('close', () => done({ reason: 'stream_closed' }));
    });
  } catch { if (result.reason === 'unknown') result = { reason: 'transport_or_response_error' }; }
  finally {
    try { socket?.close(); } catch {}
    if (id) {
      try {
        const response = await fetch(`${base}/${id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) });
        result.cleanup = response.ok ? 'confirmed' : 'unconfirmed';
      } catch { result.cleanup = 'unconfirmed'; }
    }
  }
  result.stream_opened = opened;
  return result;
}

export function finish(result, code, output = process.stdout, exit = process.exit) {
  output.write(`${JSON.stringify(result)}\n`, () => exit(code));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((result) => finish(result, 0)).catch(() => finish({ reason: 'unknown' }, 1));
}
