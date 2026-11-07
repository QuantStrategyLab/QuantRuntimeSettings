import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Exact release semantics; tests bind these functions to the deploy workflow.
const fail = () => { throw new Error('schema_unknown'); };
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const canonical = value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});
  function resources(version, id) {
    if (version?.id !== id) fail();
    const value = version.resources, runtime = value?.script_runtime, script = value?.script;
    if (!value || Object.keys(value).some(key => !['bindings', 'script', 'script_runtime'].includes(key))
      || !Array.isArray(value.bindings) || !value.bindings.length || value.bindings.length > 128 || !runtime || !script
      || Object.keys(runtime).some(key => !['compatibility_date', 'compatibility_flags', 'usage_model', 'limits', 'migration_tag', 'exports'].includes(key))
      || Object.keys(script).some(key => !['etag', 'handlers', 'named_handlers', 'last_deployed_from', 'placement_mode'].includes(key))
      || typeof script.etag !== 'string' || !script.etag || script.etag.length > 256
      || !(script.handlers === null || (Array.isArray(script.handlers) && script.handlers.every(x => typeof x === 'string')))
      || !/^\d{4}-\d{2}-\d{2}$/.test(runtime.compatibility_date ?? '')
      || (runtime.compatibility_flags !== undefined && (!Array.isArray(runtime.compatibility_flags) || runtime.compatibility_flags.some(x => typeof x !== 'string')))
      || !['standard', 'bundled', 'unbound'].includes(runtime.usage_model)) fail();
    // Current API also reports named exports (including DO classes).
    // Validate their identity/handler shape and compare them below; do
    // not discard this field merely to accept a newer response schema.
    if (script.named_handlers !== undefined) {
      if (!Array.isArray(script.named_handlers) || script.named_handlers.length > 128) fail();
      // A handler identifier occupies at least three JSON bytes. The
      // 512 KiB transport limit bounds the complete list; 32 is not
      // an API contract and rejects the existing unchanged export.
      const handlerEntryLimit = Math.floor(524288 / 3);
      const exports = new Set();
      for (const item of script.named_handlers) {
        if (!item || Object.keys(item).some(key => !['name', 'handlers'].includes(key))
          || typeof item.name !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(item.name) || exports.has(item.name)
          || (item.handlers !== undefined && (!Array.isArray(item.handlers) || item.handlers.length > handlerEntryLimit
            || item.handlers.some(handler => typeof handler !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(handler))))) fail();
        exports.add(item.name);
      }
    }
    const names = new Set();
    for (const binding of value.bindings) {
      if (!binding || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(binding.name ?? '') || names.has(binding.name)
        || !['plain_text', 'json', 'secret_text', 'kv_namespace', 'durable_object_namespace'].includes(binding.type)) fail();
      if (binding.type === 'kv_namespace' && !/^[0-9a-f]{32}$/i.test(typeof binding.namespace_id === 'string' ? binding.namespace_id : '')) fail();
      if (binding.type === 'durable_object_namespace' && (
        !/^[0-9a-f]{32}$/i.test(typeof binding.namespace_id === 'string' ? binding.namespace_id : '')
        || typeof binding.class_name !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(binding.class_name)
        || ['script_name', 'environment', 'dispatch_namespace'].some(key => binding[key] !== undefined && (typeof binding[key] !== 'string' || !binding[key] || binding[key].length > 128)))) fail();
      if (binding.type === 'plain_text' && (typeof binding.text !== 'string' || binding.text.length > 131072)) fail();
      if (binding.type === 'json' && !Object.hasOwn(binding, 'json')) fail();
      if (binding.type === 'secret_text' && Object.keys(binding).some(key => !['name', 'type'].includes(key))) fail();
      names.add(binding.name);
    }
    // Existing resources only: no resource provisioning or DO migration request.
    if (!value.bindings.some(b => b.name === 'STRATEGY_SWITCH_CONFIG' && b.type === 'kv_namespace')
      || !value.bindings.some(b => b.name === 'STRATEGY_SWITCH_RUNTIME_INSTANCES' && b.type === 'durable_object_namespace')) fail();
    return value;
  }
  const comparable = value => ({ bindings: [...value.bindings].sort((a, b) => a.name.localeCompare(b.name)),
    script_runtime: value.script_runtime, handlers: value.script.handlers,
    named_handlers: value.script.named_handlers === undefined ? null : [...value.script.named_handlers].sort((a,b) => a.name.localeCompare(b.name)),
    placement_mode: value.script.placement_mode ?? null });
  const configHash = value => createHash('sha256').update(canonical(comparable(value))).digest('hex');

const types = ['plain_text', 'json', 'secret_text', 'kv_namespace', 'durable_object_namespace'];
const runtimeKeys = ['compatibility_date', 'compatibility_flags', 'usage_model', 'limits', 'migration_tag', 'exports'];
const groups = ['bindings', 'binding_types', 'script_runtime', 'handlers', 'named_handlers', 'placement_mode'];
const categories = ['FULL_COMPARISON', 'DERIVED_COMPARISON', 'CANDIDATE_ONLY_PARTIAL', 'STOPPED', 'configuration', 'budget', 'transport', 'http_error', 'response_invalid', 'oversize', 'unavailable', 'baseline_unavailable', 'identity_mismatch', 'unknown_field', 'schema_unknown', 'migration_tag_mismatch', 'drift_observed'];
const check = (ok, category) => { if (!ok) throw new Error(category); };
const keysOnly = (object, keys) => check(object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).every(key => keys.includes(key)), 'unknown_field');

// No provider strings reach stdout: this is a typed, closed output projection.
// Unknown keys and values fail rather than being redacted into accepted evidence.
export function safeOutput(output) {
  const booleans = ['candidate_commitment_matched', 'baseline_commitment_matched', 'normalized_config_equal', 'etag_equal', 'candidate_in_window_active_set', 'drift_observed'];
  keysOnly(output, ['executor_sha', 'baseline_mode', 'gets_used', 'category', 'diff_key_path_kinds', 'group_equal', ...booleans]);
  for (const [key, value] of Object.entries(output)) {
    let ok = booleans.includes(key) ? value === null || typeof value === 'boolean' : false;
    if (key === 'executor_sha') ok = value === null || /^[0-9a-f]{40}$/.test(value);
    if (key === 'baseline_mode') ok = value === null || ['saved', 'derived', 'none'].includes(value);
    if (key === 'gets_used') ok = Number.isInteger(value) && value >= 0 && value <= 6;
    if (key === 'category') ok = categories.includes(value);
    if (key === 'diff_key_path_kinds') ok = Array.isArray(value) && value.every(v => groups.includes(v));
    if (key === 'group_equal') {
      keysOnly(value, groups); ok = true;
      for (const [group, equal] of Object.entries(value)) {
        if (['binding_types', 'script_runtime'].includes(group)) {
          keysOnly(equal, group === 'binding_types' ? types : runtimeKeys);
          ok &&= Object.values(equal).every(v => typeof v === 'boolean');
        } else ok &&= typeof equal === 'boolean';
      }
    }
    if (!ok) throw new Error('output_invalid');
  }
  return JSON.stringify(output);
}

export function boundedReader({account, token, fetchImpl, now = () => performance.now()}) {
  const start = now(); let count = 0, total = 0;
  const read = async path => {
    check(count < 6 && now() - start < 120000, 'budget');
    check(path === '/deployments?page=1&per_page=10' || path === '/versions?page=1&per_page=10' || /^\/versions\/[0-9a-f-]{36}$/i.test(path), 'configuration');
    count++;
    const signal = AbortSignal.timeout(Math.min(20000, 120000 - (now() - start)));
    let response;
    try {
      response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/qsl-strategy-switch-console${path}`, {
        method: 'GET', redirect: 'error', signal,
        headers: {Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Encoding': 'identity'},
      });
    } catch { throw new Error('transport'); }
    const responseCheck = async (ok, category) => {
      if (!ok) { await response.body?.cancel(); check(false, category); }
    };
    await responseCheck(response.ok && !response.redirected, 'http_error');
    await responseCheck(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') && ['', 'identity'].includes(response.headers.get('content-encoding') ?? ''), 'response_invalid');
    const length = response.headers.get('content-length');
    await responseCheck(length === null || (/^\d+$/.test(length) && Number(length) <= 524288), 'oversize');
    const reader = response.body?.getReader(); check(reader, 'response_invalid');
    let size = 0, text = ''; const decoder = new TextDecoder('utf-8', {fatal:true});
    try {
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength; total += value.byteLength;
        check(size <= 524288 && total <= 3145728, 'oversize');
        check(now() - start < 120000, 'budget');
        text += decoder.decode(value, {stream:true});
      }
      text += decoder.decode();
    } finally { await reader.cancel(); }
    check(!signal.aborted && now() - start < 120000, 'budget');
    check(length === null || Number(length) === size, 'response_invalid');
    let body; try { body = JSON.parse(text); } catch { throw new Error('response_invalid'); }
    keysOnly(body, ['success', 'result', 'errors', 'messages', 'result_info']);
    check(body.success === true && (body.errors == null || (Array.isArray(body.errors) && body.errors.length === 0)), 'response_invalid');
    return body.result;
  };
  Object.defineProperty(read, 'count', {get:()=>count});
  return read;
}

function validateVersion(version, id) {
  keysOnly(version, ['id', 'number', 'metadata', 'annotations', 'resources']);
  check(version.id === id, 'identity_mismatch');
  keysOnly(version.resources, ['bindings', 'script', 'script_runtime']);
  keysOnly(version.resources.script_runtime, runtimeKeys);
  keysOnly(version.resources.script, ['etag', 'handlers', 'named_handlers', 'last_deployed_from', 'placement_mode']);
  const value = resources(version, id);
  for (const binding of value.bindings) {
    const allowed = {plain_text:['text'],json:['json'],secret_text:[],kv_namespace:['namespace_id'],durable_object_namespace:['namespace_id','class_name','script_name','environment','dispatch_namespace']}[binding.type];
    keysOnly(binding, ['name','type', ...allowed]);
  }
  return value;
}
function deployments(envelope) {
  keysOnly(envelope, ['deployments']);
  const result = envelope.deployments;
  check(Array.isArray(result) && result.length > 0 && result.length <= 10, 'schema_unknown');
  const ids = new Set();
  for (const item of result) {
    keysOnly(item, ['id', 'source', 'strategy', 'author_email', 'annotations', 'created_on', 'versions']);
    check(typeof item.id === 'string' && !ids.has(item.id) && typeof item.created_on === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(item.created_on) && Number.isFinite(Date.parse(item.created_on)), 'schema_unknown');
    check(item.strategy === 'percentage', 'schema_unknown');
    ids.add(item.id);
    check(Array.isArray(item.versions) && item.versions.length > 0 && item.versions.length <= 10, 'schema_unknown');
    const versions = new Set();
    for (const entry of item.versions) {
      keysOnly(entry, ['version_id', 'percentage']);
      check(uuid(entry.version_id) && !versions.has(entry.version_id) && Number.isFinite(entry.percentage) && entry.percentage >= 0 && entry.percentage <= 100, 'schema_unknown');
      versions.add(entry.version_id);
    }
    check(Math.abs(item.versions.reduce((sum, v)=>sum+v.percentage,0)-100) < 0.000001, 'schema_unknown');
  }
  // The provider contract orders deployments newest first. Reject contradictory order.
  check(result.every((v,i)=>i===0 || Date.parse(result[i-1].created_on) > Date.parse(v.created_on)), 'schema_unknown');
  return result;
}
export async function compareVersions(env, fetchImpl = fetch) {
  const output = {executor_sha:null,candidate_commitment_matched:false,baseline_mode:null,baseline_commitment_matched:null,normalized_config_equal:null,etag_equal:null,candidate_in_window_active_set:null,drift_observed:false,gets_used:0,category:'STOPPED'};
  let read;
  try {
    check(/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') && env.GITHUB_SHA === env.RO_COMPARATOR_EXECUTOR_SHA, 'configuration');
    output.executor_sha = env.GITHUB_SHA;
    check(['saved','derived','none'].includes(env.BASELINE_MODE), 'configuration'); output.baseline_mode=env.BASELINE_MODE;
    check(/^[0-9a-f]{64}$/.test(env.CANDIDATE_COMMITMENT ?? '') && (env.BASELINE_MODE === 'saved' ? /^[0-9a-f]{64}$/.test(env.BASELINE_COMMITMENT ?? '') : !env.BASELINE_COMMITMENT), 'configuration');
    check(/^[0-9a-f]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? '') && env.CLOUDFLARE_READ_ONLY_API_TOKEN, 'configuration');
    read=boundedReader({account:env.CLOUDFLARE_ACCOUNT_ID,token:env.CLOUDFLARE_READ_ONLY_API_TOKEN,fetchImpl});
    const start=deployments(await read('/deployments?page=1&per_page=10'));
    const listed=await read('/versions?page=1&per_page=10');
    keysOnly(listed,['items']); check(Array.isArray(listed.items) && listed.items.length > 0 && listed.items.length <= 10, 'schema_unknown');
    const ids=listed.items.map(item=>{keysOnly(item,['id','number','metadata','annotations']);check(uuid(item.id),'schema_unknown');return item.id;});
    check(new Set(ids).size === ids.length,'unavailable');
    const matches=ids.filter(id=>hash(id) === env.CANDIDATE_COMMITMENT);check(matches.length === 1,'unavailable');
    const candidate=matches[0]; output.candidate_commitment_matched=true;
    output.candidate_in_window_active_set=start[0].versions.some(v=>v.version_id === candidate && v.percentage > 0);
    let baseline=null;
    if(env.BASELINE_MODE === 'saved') {
      const matches=ids.filter(id=>hash(id) === env.BASELINE_COMMITMENT);check(matches.length === 1,'baseline_unavailable');baseline=matches[0];output.baseline_commitment_matched=true;
    } else if(env.BASELINE_MODE === 'derived') {
      const prior=start.find(v=>Date.parse(v.created_on) < Date.parse('2026-11-07T01:29:40Z'));
      if(prior?.versions.length === 1 && prior.versions[0].percentage === 100 && ids[ids.indexOf(candidate)+1] === prior.versions[0].version_id) baseline=prior.versions[0].version_id;
    }
    check(!baseline || baseline !== candidate,'baseline_unavailable');
    const next=validateVersion(await read('/versions/'+candidate),candidate);
    if(baseline) {
      const old=validateVersion(await read('/versions/'+baseline),baseline);
      const oldTag=old.script_runtime.migration_tag,newTag=next.script_runtime.migration_tag;
      check(typeof oldTag === 'string' && oldTag && (newTag === undefined || newTag === oldTag),'migration_tag_mismatch');
      const normalized=structuredClone(next);normalized.script_runtime.migration_tag=oldTag;
      output.normalized_config_equal=configHash(normalized) === configHash(old);
      output.etag_equal=next.script.etag === old.script.etag;
      const before=comparable(old),after=comparable(normalized),equal=(a,b)=>canonical(a) === canonical(b);
      output.group_equal={bindings:equal(before.bindings,after.bindings),binding_types:Object.fromEntries(types.map(type=>[type,equal(before.bindings.filter(b=>b.type===type),after.bindings.filter(b=>b.type===type))])),script_runtime:Object.fromEntries(runtimeKeys.map(key=>[key,equal(before.script_runtime[key],after.script_runtime[key])])),handlers:equal(before.handlers,after.handlers),named_handlers:equal(before.named_handlers,after.named_handlers),placement_mode:equal(before.placement_mode,after.placement_mode)};
      output.diff_key_path_kinds=groups.filter(key=> typeof output.group_equal[key] === 'boolean' ? !output.group_equal[key] : Object.values(output.group_equal[key]).some(v=>!v));
    }
    const repeat=validateVersion(await read('/versions/'+candidate),candidate);
    if(configHash(next) !== configHash(repeat) || next.script.etag !== repeat.script.etag) {output.drift_observed=true;throw new Error('drift_observed');}
    const end=deployments(await read('/deployments?page=1&per_page=10'));
    if(canonical(start) !== canonical(end)) {output.drift_observed=true;throw new Error('drift_observed');}
    output.category=baseline ? (env.BASELINE_MODE === 'saved' ? 'FULL_COMPARISON':'DERIVED_COMPARISON'):'CANDIDATE_ONLY_PARTIAL';
    output.gets_used=read.count; safeOutput(output);return {output,exitCode:0};
  } catch(error) {
    output.gets_used=read?.count ?? 0;
    output.category=categories.includes(error?.message) ? error.message:'STOPPED';
    safeOutput(output);return {output,exitCode:1};
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result=await compareVersions(process.env);
  console.log(safeOutput(result.output));process.exitCode=result.exitCode;
}
