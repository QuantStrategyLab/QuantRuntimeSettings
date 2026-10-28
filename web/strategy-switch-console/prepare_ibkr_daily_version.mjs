import {parseRuntimeDailyTargetKey} from './runtime_daily_contract.js';

// Prepare only the two IBKR daily bindings for a version pinned to its active base.
// The caller owns request, deployment, concurrency and readback protections.
export function prepareIbkrDailyVersion({activeVersion, existingBindings, runtime, moduleBase64, token, targetKey}) {
  if (typeof activeVersion !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(activeVersion)
      || !Array.isArray(existingBindings) || !existingBindings.length || !runtime || typeof runtime !== 'object'
      || typeof moduleBase64 !== 'string' || !moduleBase64 || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
      || typeof targetKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\|tqqq_growth_income\|[A-Za-z0-9][A-Za-z0-9._-]{0,119}\|[a-f0-9]{32}$/.test(targetKey)) {
    throw Error('invalid_input');
  }
  const names = new Set();
  for (const binding of existingBindings) {
    if (!binding || typeof binding.name !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(binding.name)
        || names.has(binding.name)) throw Error('invalid_bindings');
    names.add(binding.name);
  }
  const added = ['IBKR_RUNTIME_DAILY_SYNC_TOKEN', 'IBKR_RUNTIME_DAILY_TARGET_KEY'];
  if (added.some(name => names.has(name))) throw Error('binding_exists');
  if (typeof runtime.compatibility_date !== 'string' || typeof runtime.usage_model !== 'string') throw Error('invalid_runtime');
  const metadata = {
    main_module: 'worker.js',
    bindings: [...existingBindings.map(({name}) => ({type:'inherit',name,version_id:activeVersion})),
      {type:'secret_text',name:added[0],text:token}, {type:'secret_text',name:added[1],text:targetKey}],
    compatibility_date:runtime.compatibility_date, usage_model:runtime.usage_model,
    annotations:{'workers/message':'IBKR primary daily binding; retain active version'},
  };
  for (const key of ['compatibility_flags','limits']) if (runtime[key] !== undefined) metadata[key] = runtime[key];
  return {...metadata, modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:moduleBase64}]};
}

// Preserve all previously registered entries and refuse collisions or invalid shape.
export function appendPrimaryDailyRegistration(registry, registration) {
  const keys = ['account_key','target_id','source_binding_id','strategy_profile','target_key'];
  const valid = entry => entry && typeof entry === 'object' && !Array.isArray(entry)
    && Object.keys(entry).sort().join(',') === [...keys].sort().join(',')
    && keys.every(key => typeof entry[key] === 'string' && entry[key].length > 0 && entry[key].length <= (key === 'target_key' ? 393 : 120))
    && /^[a-f0-9]{64}$/.test(entry.source_binding_id)
    && (() => { const target = parseRuntimeDailyTargetKey(entry.target_key,'ibkr');
      return target && entry.target_key.split('|').length === 4 && target.strategy_profile === entry.strategy_profile
        && [target.service,target.strategy_profile,target.account_scope].every(value=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)); })();
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)
      || Object.keys(registry).sort().join(',') !== 'bindings,schema_version'
      || registry.schema_version !== 'qsl_runtime_daily_bindings.v1' || !Array.isArray(registry.bindings)
      || registry.bindings.length >= 64 || !registry.bindings.every(valid) || !valid(registration)
      || registration.strategy_profile !== 'tqqq_growth_income') throw Error('invalid_registry');
  for (const key of ['account_key','target_id','source_binding_id','target_key']) {
    if (new Set([...registry.bindings.map(entry => entry[key]),registration[key]]).size !== registry.bindings.length + 1) {
      throw Error('registration_collision');
    }
  }
  return {schema_version:registry.schema_version,bindings:[...registry.bindings,registration]};
}

// Compare metadata only. Secret values are opaque in the Cloudflare response.
export function validateIbkrDailyVersion(before, after, deployed = false) {
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
    return value;
  };
  const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  if (!before || !after || !Array.isArray(before.bindings) || !Array.isArray(after.bindings)
      || !before.script_runtime || !after.script_runtime || !before.script || !after.script) throw Error('invalid_resources');
  const expectedNames = ['IBKR_RUNTIME_DAILY_SYNC_TOKEN','IBKR_RUNTIME_DAILY_TARGET_KEY'];
  const newItems = after.bindings.filter(item=>expectedNames.includes(item?.name));
  if (newItems.length !== 2 || new Set(newItems.map(item=>item.name)).size !== 2
      || newItems.some(item=>item.type !== 'secret_text' || Object.keys(item).sort().join(',') !== 'name,type')
      || before.bindings.some(item=>expectedNames.includes(item?.name))) throw Error('new_bindings_invalid');
  const named = items => [...items].sort((a,b)=>a.name.localeCompare(b.name));
  if (!same(named(before.bindings),named(after.bindings.filter(item=>!expectedNames.includes(item?.name))))) throw Error('bindings_changed');
  const runtime = structuredClone(after.script_runtime);
  // Before activation Cloudflare may omit migration_tag; after activation it must match.
  if (!deployed && runtime.migration_tag === undefined) runtime.migration_tag = before.script_runtime.migration_tag;
  if (!same(before.script_runtime,runtime)) throw Error('runtime_changed');
  for (const key of ['handlers','named_handlers','placement_mode']) {
    if (!same(before.script[key] ?? null,after.script[key] ?? null)) throw Error('script_metadata_changed');
  }
  return true;
}
