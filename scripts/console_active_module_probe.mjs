// Read-only, fixed Worker diagnostic. Never print provider response data or module bytes.
import { pathToFileURL } from 'node:url';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const moduleLimit = 10 * 1024 * 1024;
const responseLimit = Math.ceil(moduleLimit / 3) * 4 + 524288;
const reasons = new Set(['configuration_invalid', 'active_schema_invalid', 'active_not_single',
  'active_module_schema', 'unsupported_module_name', 'unsupported_module_type',
  'encoding_invalid', 'module_too_large', 'observation_changed', 'http_error',
  'transport_invalid', 'response_too_large', 'response_length_mismatch', 'json_invalid', 'envelope_invalid']);
const fail = reason => { throw new Error(reasons.has(reason) ? reason : 'probe_failed'); };
let stage = 'configuration', httpStatus = null, deploymentReads = 0, moduleCount = null;

function current(result) {
  const list = result?.deployments;
  if (!Array.isArray(list) || !list.length || list.length > 10) fail('active_schema_invalid');
  const item = list[0];
  if (!uuid(item?.id) || item.strategy !== 'percentage' || !Array.isArray(item.versions)) fail('active_schema_invalid');
  if (item.versions.length !== 1 || item.versions[0]?.percentage !== 100) fail('active_not_single');
  if (!uuid(item.versions[0]?.version_id)) fail('active_schema_invalid');
  return { id: item.id, version: item.versions[0].version_id };
}

// These are diagnostic hints only, not authorization to patch: a future patch
// must validate each complete known-old replacement and its complete dependency context.
const patterns = {
  config_read_old: /accountConfig\s*=\s*await\s+loadAccountOptionsConfig(?:\d+)?\(env\);\s*\}\s*catch\s*\{\s*if\s*\(requireCurrencies\)/,
  binding_read_old: /bindings\s*=\s*await\s+loadAccountFactsBindings(?:\d+)?\(env\);\s*\}\s*catch\s*\{\s*if\s*\(requireCurrencies\)/,
  history_read_old: /requireCurrencies\s*&&\s*\(!listed\s*\|\|\s*listed\.ok\s*!==\s*true/,
  history_read_new: /if\s*\(\s*!listed\s*\|\|\s*listed\.ok\s*!==\s*true/,
  trailing_gap_old: /(?:var|const|let)\s+status\s*=\s*gaps\s*\|\|\s*incompleteRange\s*\?/,
  trailing_gap_new: /(?:var|const|let)\s+trailingGap\s*=\s*hasGap(?:\d+)?\(daily\.at\(-1\),\s*\{\s*date:\s*input\.today\s*\}\)/,
  history_binding_propagation: /loadAccountFactsBindings:\s*\(?env\)?\s*=>\s*loadAccountFactsBindings(?:\d+)?\(env,\s*\{\s*propagateReadErrors:\s*true\s*\}\)/,
};

export function inspectModule(result, expected) {
  moduleCount = Array.isArray(result?.modules) && result.modules.length <= 128 ? result.modules.length : null;
  if (result?.id !== expected || moduleCount !== 1) fail('active_module_schema');
  const module = result.modules[0];
  if (module?.name !== 'worker.js') fail('unsupported_module_name');
  if (module.content_type !== 'application/javascript+module') fail('unsupported_module_type');
  if (typeof module.content_base64 !== 'string' || !module.content_base64.length) fail('encoding_invalid');
  if (module.content_base64.length > Math.ceil(moduleLimit / 3) * 4) fail('module_too_large');
  if (module.content_base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(module.content_base64)) fail('encoding_invalid');
  const bytes = Buffer.from(module.content_base64, 'base64');
  if (bytes.length > moduleLimit) fail('module_too_large');
  if (!bytes.length || bytes.toString('base64') !== module.content_base64) fail('encoding_invalid');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('encoding_invalid'); }
  const markers = Object.fromEntries(Object.entries(patterns).map(([name, pattern]) => [name, pattern.test(text)]));
  const markers_unique = Object.fromEntries(Object.entries(patterns).map(([name, pattern]) => {
    const matches = text.matchAll(new RegExp(pattern.source, 'g'));
    return [name, !matches.next().done && matches.next().done];
  }));
  return { single_javascript_module: true, module_size_within_limit: true, markers, markers_unique };
}

export async function probe(request, onModule) {
  const before = current(await request('/deployments?page=1&per_page=10', false));
  const module = await request(`/versions/${before.version}?include=modules`, true);
  const report = inspectModule(module, before.version);
  if (onModule) await onModule(Buffer.from(module.modules[0].content_base64, 'base64'));
  const after = current(await request('/deployments?page=1&per_page=10', false));
  if (before.id !== after.id || before.version !== after.version) fail('observation_changed');
  return { ok: true, read_only: true, active_observations_match: true, ...report };
}

export function createReadOnlyRequest() {
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !/^[0-9a-f]{32}$/i.test(account ?? '')) fail('configuration_invalid');
  const scripts = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/qsl-strategy-switch-console`;
  const workers = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/workers/qsl-strategy-switch-console`;
  async function request(path, beta) {
    stage = beta ? 'active_module' : (++deploymentReads === 1 ? 'active_before' : 'active_after');
    httpStatus = null;
    const response = await fetch((beta ? workers : scripts) + path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Encoding': 'identity' } });
    httpStatus = response.status;
    const limit = beta ? responseLimit : 524288;
    const length = response.headers.get('content-length');
    if (!response.ok) { await response.body?.cancel(); fail('http_error'); }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
      || !['', 'identity'].includes(response.headers.get('content-encoding') ?? '')
      || (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) || !response.body) {
      await response.body?.cancel(); fail('transport_invalid');
    }
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > limit) fail('response_too_large'); chunks.push(value);
      }
    } finally { await reader.cancel(); }
    if (length !== null && Number(length) !== size) fail('response_length_mismatch');
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { fail('json_invalid'); }
    if (body?.success !== true || (body.errors != null && (!Array.isArray(body.errors) || body.errors.length))) fail('envelope_invalid');
    return body.result;
  }
  return request;
}

async function main() {
  console.log(JSON.stringify(await probe(createReadOnlyRequest())));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ ok: false, read_only: true, error: 'active_module_probe_failed', stage, http_status: httpStatus, reason: reasons.has(error?.message) ? error.message : 'request_or_response_failed', module_count: moduleCount })); process.exitCode = 1; });
}
