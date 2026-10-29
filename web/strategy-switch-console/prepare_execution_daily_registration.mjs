import {parseRuntimeDailyTargetKey} from './runtime_daily_contract.js';

// Reconstruct only the four targets confirmed by the immediately preceding
// protected IBKR setup; unrelated registry entries never confer authorization.
export function firstExecutionAuthorization(registry, originals) {
  if (!Array.isArray(registry?.bindings) || !Array.isArray(originals) || originals.length!==4) throw Error('invalid_existing_setup');
  const ibkr=originals.map(source=>{
    const rows=registry.bindings.filter(row=>(row.platform??'ibkr')==='ibkr' && row.account_key===source.account_key
      && row.target_id===source.target_id && row.source_binding_id===source.source_binding_id && row.strategy_profile===source.strategy_profile);
    if (rows.length!==1) throw Error('binding_not_unique');
    return rows[0].target_key;
  });
  if (new Set(ibkr).size!==4 || registry.bindings.some(row=>['longbridge','firstrade','binance'].includes(row.platform))) throw Error('invalid_existing_setup');
  return {ibkr,execution:[]};
}

// Pure plan only. The caller supplies independently matched sources and the
// existing authorization groups from protected state; this function does no I/O.
export function prepareExecutionDailyRegistration({registry, matches, targetKeys, authorizedTargets, activeVersion, resources, moduleBase64}) {
  const text = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value);
  const bounded = value => typeof value === 'string' && value.length > 0 && value.length <= 120
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !['secret','token','password','bearer','traceback','/users/','/home/'].some(x => value.toLowerCase().includes(x));
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!registry || registry.schema_version !== 'qsl_runtime_daily_bindings.v1'
      || Object.keys(registry).sort().join(',') !== 'bindings,schema_version'
      || !Array.isArray(registry.bindings) || !Array.isArray(matches) || !matches.length
      || !Array.isArray(targetKeys) || matches.length !== targetKeys.length
      || registry.bindings.length + matches.length > 64
      || !authorizedTargets || Object.keys(authorizedTargets).sort().join(',') !== 'execution,ibkr'
      || !['ibkr','execution'].every(group => Array.isArray(authorizedTargets[group])
        && authorizedTargets[group].length <= 64 && new Set(authorizedTargets[group]).size === authorizedTargets[group].length
        && authorizedTargets[group].every(key => parseRuntimeDailyTargetKey(key, group === 'ibkr' ? 'ibkr' : 'longbridge')
          && (group !== 'ibkr' || key.split('|').length === 4)))
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(activeVersion ?? '')
      || !resources?.script_runtime || !Array.isArray(resources.bindings)
      || typeof moduleBase64 !== 'string' || !moduleBase64) throw Error('invalid_input');
  const names = resources.bindings.map(binding => binding?.name);
  if (names.some(name => typeof name !== 'string' || !name) || new Set(names).size !== names.length)
    throw Error('invalid_bindings');
  const oldSecret = resources.bindings.filter(binding => binding.name === 'IBKR_RUNTIME_DAILY_TARGET_KEY');
  if (oldSecret.length !== 1 || oldSecret[0].type !== 'secret_text') throw Error('target_binding_invalid');
  const validRegistration = entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const platform = entry.platform ?? 'ibkr';
    const fields = ['account_key','target_id','source_binding_id','strategy_profile','target_key',
      ...(Object.hasOwn(entry, 'platform') ? ['platform'] : [])];
    const target = parseRuntimeDailyTargetKey(entry.target_key, platform);
    return Object.keys(entry).sort().join(',') === fields.sort().join(',')
      && ['ibkr','longbridge','firstrade','binance'].includes(platform)
      && bounded(entry.account_key) && bounded(entry.target_id) && bounded(entry.strategy_profile)
      && hex(entry.source_binding_id) && target && target.strategy_profile === entry.strategy_profile
      && (platform !== 'ibkr' || entry.target_key.split('|').length === 4)
      && [target.service,target.strategy_profile,target.account_scope].every(text);
  };
  if (!registry.bindings.every(validRegistration)) throw Error('invalid_registry');
  const additions = matches.map((match, index) => {
    if (!match || !['longbridge','firstrade','binance'].includes(match.platform)
        || !['account_key','target_id'].every(key => bounded(match[key]))
        || !['service_name','strategy_profile','account_scope'].every(key => text(match[key]))
        || !hex(match.source_binding_id)) throw Error('invalid_match');
    const target = parseRuntimeDailyTargetKey(targetKeys[index], match.platform);
    const expectedScope = match.platform === 'longbridge' && match.account_scope === 'HK' ? 'hk' : match.account_scope;
    if (!target || targetKeys[index].split('|').length !== 3 || target.service !== match.service_name
        || target.strategy_profile !== match.strategy_profile || target.account_scope !== expectedScope)
      throw Error('target_mismatch');
    return {platform: match.platform, account_key: match.account_key, target_id: match.target_id,
      source_binding_id: match.source_binding_id, strategy_profile: match.strategy_profile, target_key: targetKeys[index]};
  });
  const entries = [...registry.bindings, ...additions];
  for (const key of ['target_id','source_binding_id','target_key']) {
    if (new Set(entries.map(entry => entry[key])).size !== entries.length) throw Error('registration_collision');
  }
  const accounts = entries.map(entry => `${entry.platform ?? 'ibkr'}|${entry.account_key}`);
  if (new Set(accounts).size !== accounts.length) throw Error('registration_collision');
  const execution = [...authorizedTargets.execution, ...targetKeys];
  if (execution.length > 64 || new Set(execution).size !== execution.length) throw Error('authorization_collision');
  const authorization = {ibkr: [...authorizedTargets.ibkr], execution};
  const runtime = resources.script_runtime;
  if (typeof runtime.compatibility_date !== 'string' || typeof runtime.usage_model !== 'string') throw Error('invalid_runtime');
  const metadata = {main_module:'worker.js',
    bindings:[...resources.bindings.filter(binding => binding.name !== 'IBKR_RUNTIME_DAILY_TARGET_KEY')
      .map(({name}) => ({type:'inherit',name,version_id:activeVersion})),
      {type:'secret_text',name:'IBKR_RUNTIME_DAILY_TARGET_KEY',text:JSON.stringify(authorization)}],
    compatibility_date:runtime.compatibility_date,usage_model:runtime.usage_model,
    annotations:{'workers/message':'Add matched execution daily bindings'}};
  for (const key of ['compatibility_flags','limits']) if (runtime[key] !== undefined) metadata[key] = runtime[key];
  return {registry:{schema_version:registry.schema_version,bindings:entries}, authorization,
    version:{...metadata,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:moduleBase64}]}};
}
