import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnose } from '../scripts/diagnose_strategy_health_403.mjs';
const account = 'a'.repeat(32), token = 'SENTINEL_SECRET';
const ok = result => new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 });
const settings = { observability: { enabled: true, logs: { enabled: true, invocation_logs: true, head_sampling_rate: 1 } }, secret: 'SENTINEL_SECRET' };
test('queries only fixed worker and two bounded windows, emits only allowed fields', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return ok(settings);
    return ok({ events: { count: 1, events: [{ $metadata: { statusCode: 403, message: 'SENTINEL_PRIVATE' } }] } });
  };
  const result = await diagnose({ account, token, request });
  assert.equal(result.status, 'complete'); assert.equal(calls.length, 4);
  assert.deepEqual(result.windows.map(x => x.status_403_count), [1, 1, 1]);
  assert(!JSON.stringify(result).includes('SENTINEL'));
  for (const call of calls.slice(1, 3)) {
    const body = JSON.parse(call.options.body);
    assert.equal(body.dry, true); assert.equal(body.limit, 25);
    assert.equal(body.parameters.filters[0].value, 'qsl-strategy-switch-console');
    assert.equal(body.parameters.filters[1].value, '/api/internal/sync-strategy-health');
  }
  const mobile = JSON.parse(calls[3].options.body);
  assert.deepEqual(mobile.parameters.filters[1].filters.map(x => x.value),
    ['/api/decisions-inbox', '/api/accounts', '/api/performance/', '/api/runtime/today']);
  assert.equal(result.windows[2].exception_present_count, 0);
  assert.equal(result.windows[2].exception_unknown_count, 1);
});
test('permission rejection stops without retries or leaking response', async () => {
  let count = 0;
  const result = await diagnose({ account, token, request: async () => {
    count++; return new Response(JSON.stringify({ errors: [{ code: 10000, message: 'SENTINEL_PRIVATE' }] }), { status: 403 });
  } });
  assert.equal(count, 1); assert.equal(result.status, 'unavailable'); assert.equal(result.http_status, 403);
  assert.equal(result.reason, 'http_failed'); assert.deepEqual(result.error_codes, [10000]);
  assert(!JSON.stringify(result).includes('SENTINEL'));
});
test('unknown error and malformed responses remain unavailable without leaking detail', async () => {
  for (const request of [async () => { throw new Error('SENTINEL_PRIVATE'); }, async () => ok({})]) {
    const result = await diagnose({ account, token, request });
    assert.equal(result.status, 'unavailable'); assert(!JSON.stringify(result).includes('SENTINEL'));
  }
});
test('query rejection after settings stops before next window', async () => {
  let count = 0;
  const result = await diagnose({ account, token, request: async () => {
    count++;
    return count === 1 ? ok(settings) : new Response(JSON.stringify({ errors: [{ code: 10000, message: 'SENTINEL_PRIVATE' }] }), { status: 403 });
  } });
  assert.equal(count, 2); assert.equal(result.stage, '0130_sgt');
  assert.equal(result.http_status, 403); assert.equal(result.windows.length, 0);
  assert(!JSON.stringify(result).includes('SENTINEL'));
});

test('envelope and streamed length failures return fixed reasons only', async () => {
  const envelope = await diagnose({ account, token, request: async () => new Response(
    JSON.stringify({ success: false, errors: [{ code: 1234, message: 'SENTINEL_PRIVATE' }] }), { status: 200 }) });
  assert.equal(envelope.reason, 'response_invalid'); assert.deepEqual(envelope.error_codes, [1234]);
  const huge = await diagnose({ account, token, request: async () => new Response('x'.repeat(1024 * 1024 + 1)) });
  assert.equal(huge.reason, 'response_too_large');
  assert(!JSON.stringify([envelope, huge]).includes('SENTINEL'));
});
