import assert from 'node:assert/strict';
import { classifyEvent, decodeMessage } from './tail_strategy_health.mjs';
const event = { outcome: 'exception', eventTimestamp: 1793214000000, event: { request: { method: 'POST', url: 'https://example.invalid/api/internal/sync-strategy-health', headers: { authorization: 'SENTINEL_SECRET' } }, response: { status: 403 } }, logs: [{ message: ['SENTINEL_BODY'] }] };
const result = classifyEvent(JSON.stringify(event), 'https://example.invalid');
assert.equal(result.http_status, 403);
assert.equal(result.outcome, 'exception');
assert(!JSON.stringify(result).includes('SENTINEL'));
event.event.request.url += '?private=SENTINEL';
assert.equal(classifyEvent(JSON.stringify(event), 'https://example.invalid'), null);
event.event.request.url = 'https://example.invalid/other';
assert.equal(classifyEvent(JSON.stringify(event), 'https://example.invalid'), null);
event.event.request.method = 'GET';
assert.equal(classifyEvent(JSON.stringify(event), 'https://example.invalid'), null);
assert.equal(classifyEvent('not-json SENTINEL', 'https://example.invalid'), null);
event.event.request.method = 'POST';
event.event.request.url = 'https://wrong.invalid/api/internal/sync-strategy-health';
assert.equal(classifyEvent(JSON.stringify(event), 'https://example.invalid'), null);
event.event.request.url = 'https://example.invalid/api/internal/sync-strategy-health';
event.event.response.status = '403';
event.eventTimestamp = Number.MAX_SAFE_INTEGER;
event.outcome = 'SENTINEL_UNKNOWN';
const bounded = classifyEvent(JSON.stringify(event), 'https://example.invalid');
assert.equal(bounded.http_status, null);
assert.equal(bounded.time, null);
assert.equal(bounded.outcome, 'unknown');
assert(!JSON.stringify(bounded).includes('SENTINEL'));
const { run } = await import('./tail_strategy_health.mjs');
process.env.STRATEGY_SWITCH_CONSOLE_URL = 'https://example.invalid';
process.env.CLOUDFLARE_API_TOKEN = 'SENTINEL_TOKEN';
process.env.CLOUDFLARE_ACCOUNT_ID = 'a'.repeat(32);
const requests = [];
globalThis.fetch = async (url, options) => {
  requests.push(options.method);
  if (options.method === 'DELETE') return { ok: true };
  return { ok: true, json: async () => ({ success: true, result: { id: 'b'.repeat(32), url: 'wss://example.invalid/tail' } }) };
};
globalThis.WebSocket = class {
  constructor() { this.handlers = {}; queueMicrotask(() => { this.handlers.open?.(); this.handlers.message?.({ data: JSON.stringify(event) }); }); }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  send() {}
  close() {}
};
const observed = await run();
assert.equal(observed.reason, 'matched');
assert.equal(observed.cleanup, 'confirmed');
assert.deepEqual(requests, ['POST', 'DELETE']);
assert(!JSON.stringify(observed).includes('SENTINEL'));
globalThis.fetch = async () => ({ ok: false, status: 403 });
assert.deepEqual(await run(), { reason: 'tail_forbidden', http_status: 403 });

assert.equal(await decodeMessage(new Blob(['abc'])), 'abc');
assert.equal(await decodeMessage(new TextEncoder().encode('abc').buffer), 'abc');
assert.equal(await decodeMessage(new Blob([new Uint8Array(1048577)])), null);
assert.equal(await decodeMessage(new ArrayBuffer(1048577)), null);
requests.length = 0;
globalThis.fetch = async (url, options) => { requests.push(options.method); return options.method === 'DELETE' ? { ok: true } : { ok: true, json: async () => ({ success: true, result: { id: 'b'.repeat(32) } }) }; };
const invalid = await run();
assert.equal(invalid.reason, 'tail_response_invalid');
assert.equal(invalid.cleanup, 'confirmed');
assert.deepEqual(requests, ['POST', 'DELETE']);
