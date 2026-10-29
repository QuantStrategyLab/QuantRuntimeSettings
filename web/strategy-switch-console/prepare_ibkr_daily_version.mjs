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

// Extend the existing registration only for three uniquely matched additional sources.
// Values stay within the protected runner; target identifiers are not credentials.
export function prepareAdditionalDailySetup({registry, matches, suffixes, activeVersion, resources, moduleBase64, primaryAccountKey}) {
  const slots=['additional-1','additional-2','additional-3'];
  if (!registry || registry.schema_version !== 'qsl_runtime_daily_bindings.v1' || !Array.isArray(registry.bindings)
      || registry.bindings.filter(x=>x?.account_key===primaryAccountKey && (x.platform ?? 'ibkr')==='ibkr').length !== 1
      || !matches || !suffixes || !/^[a-f0-9-]{36}$/i.test(activeVersion ?? '') || !resources?.script_runtime
      || !Array.isArray(resources.bindings) || !moduleBase64) throw Error('invalid_existing_setup');
  const primary=registry.bindings.find(x=>x.account_key===primaryAccountKey && (x.platform ?? 'ibkr')==='ibkr'), primaryTarget=parseRuntimeDailyTargetKey(primary.target_key,'ibkr');
  if (!primaryTarget || primary.target_key.split('|').length!==4 || !primary.account_key) throw Error('invalid_existing_setup');
  const additions=slots.map(slot=>{
    const b=matches[slot], suffix=suffixes[slot];
    if (!b || !/^[a-f0-9]{32}$/.test(suffix ?? '')) throw Error('invalid_additional_binding');
    const target_key=`${b.service_name}|${b.strategy_profile}|${b.account_scope}|${suffix}`;
    const target=parseRuntimeDailyTargetKey(target_key,'ibkr');
    if (!target || target_key.split('|').length!==4 || !/^[a-f0-9]{64}$/.test(b.source_binding_id ?? '')) throw Error('invalid_additional_binding');
    return {account_key:b.account_key,target_id:b.target_id,source_binding_id:b.source_binding_id,strategy_profile:b.strategy_profile,target_key};
  });
  const entries=[...registry.bindings,...additions];
  for (const key of ['account_key','target_id','source_binding_id','target_key']) {
    if (entries.some(x=>typeof x[key]!=='string' || !x[key]) || new Set(entries.map(x=>x[key])).size!==entries.length) throw Error('registration_collision');
  }
  const targetItems=resources.bindings.filter(x=>x?.name==='IBKR_RUNTIME_DAILY_TARGET_KEY');
  if (targetItems.length!==1 || targetItems[0].type!=='secret_text') throw Error('target_binding_invalid');
  const names=resources.bindings.map(x=>x?.name);
  if (new Set(names).size!==names.length || names.some(x=>typeof x!=='string' || !x)) throw Error('invalid_bindings');
  const mapping=Object.fromEntries([['primary-live',primary],...slots.map((slot,index)=>[slot,additions[index]])]
    .map(([slot,row])=>[slot,{target_key:row.target_key,account_key:row.account_key}]));
  const settings=JSON.stringify({ibkr:[primary,...additions].map(x=>x.target_key),execution:[]});
  const runtime=resources.script_runtime;
  const metadata={main_module:'worker.js',bindings:[...resources.bindings.filter(x=>x.name!=='IBKR_RUNTIME_DAILY_TARGET_KEY')
    .map(({name})=>({type:'inherit',name,version_id:activeVersion})),{type:'secret_text',name:'IBKR_RUNTIME_DAILY_TARGET_KEY',text:settings}],
    compatibility_date:runtime.compatibility_date,usage_model:runtime.usage_model,
    annotations:{'workers/message':'IBKR additional daily target bindings'}};
  for (const key of ['compatibility_flags','limits']) if (runtime[key]!==undefined) metadata[key]=runtime[key];
  return {registry:{schema_version:registry.schema_version,bindings:entries},mapping,version:{...metadata,
    modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:moduleBase64}]}};
}

export function validateAdditionalDailyVersion(before, after, deployed=false) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
  const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  if (!before?.script_runtime || !after?.script_runtime || !before?.script || !after?.script
      || !Array.isArray(before.bindings) || !Array.isArray(after.bindings)) throw Error('invalid_resources');
  const name='IBKR_RUNTIME_DAILY_TARGET_KEY', old=before.bindings.filter(x=>x.name===name), next=after.bindings.filter(x=>x.name===name);
  if (old.length!==1 || next.length!==1 || old[0].type!=='secret_text' || next[0].type!=='secret_text'
      || Object.keys(next[0]).sort().join(',')!=='name,type') throw Error('target_binding_invalid');
  const sorted=x=>x.filter(b=>b.name!==name).sort((a,b)=>a.name.localeCompare(b.name));
  if (!same(sorted(before.bindings),sorted(after.bindings))) throw Error('bindings_changed');
  const runtime=structuredClone(after.script_runtime);
  if (!deployed && runtime.migration_tag===undefined) runtime.migration_tag=before.script_runtime.migration_tag;
  if (!same(before.script_runtime,runtime)) throw Error('runtime_changed');
  for (const key of ['handlers','named_handlers','placement_mode']) if (!same(before.script[key]??null,after.script[key]??null)) throw Error('script_metadata_changed');
  return true;
}
