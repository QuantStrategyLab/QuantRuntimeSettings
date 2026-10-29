import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { DEFAULT_STRATEGY_PROFILES } from "./strategy_profiles_asset.js";
import { normalizeAccountOptionsPayload } from './account_options_schema.js';
import { normalizeAccountFactsBindings, accountFactsOptionMatchesBinding } from './account_facts.js';

// Fixed primary target established by the protected primary binding comparison.
const targetAnchor = '5069050c930b4951fdbb99138b0d1844ae719afb8743d803692084f64edacae2';
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const token = /^[A-Za-z0-9][A-Za-z0-9._|:-]{0,119}$/;

export function primaryBinding(optionsRaw, bindingsRaw, anchor = targetAnchor) {
  const options = normalizeAccountOptionsPayload(optionsRaw).ibkr;
  const bindings = normalizeAccountFactsBindings(bindingsRaw).bindings;
  const selected = bindings.filter(b => b.platform === 'ibkr' && sha(b.target_id) === anchor);
  if (selected.length !== 1) throw Error('target_not_unique');
  const b = selected[0];
  const matched = options.filter(o => o.key === b.account_key && accountFactsOptionMatchesBinding(o, b));
  if (matched.length !== 1 || options.filter(o => o.key === b.account_key).length !== 1) throw Error('option_mismatch');
  const binding = {account_key:b.account_key, account_scope:b.account_scope, account_selector:b.account_selector,
    deployment_selector:b.deployment_selector, platform:'ibkr', service_name:b.service_name,
    source_binding_id:b.source_binding.id, strategy_profile:'tqqq_growth_income', target_id:b.target_id};
  if (Object.values(binding).some(v => typeof v !== 'string' || !token.test(v))
      || !/^[a-f0-9]{64}$/.test(binding.source_binding_id)) throw Error('invalid_input');
  return binding;
}

export function comparison(optionsRaw, bindingsRaw, nonce, anchor = targetAnchor) {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw Error('invalid_input');
  const binding = primaryBinding(optionsRaw, bindingsRaw, anchor);
  return sha(JSON.stringify({binding, domain:'qsl.ibkr-daily-binding-comparison.v1', nonce}));
}

// Match against the protected runtime inventory's nonce-bound full identity digest.
// Candidate profiles are not trusted by themselves; only an exact digest can select one.
export function matchAdditionalDailyBinding(optionsRaw, bindingsRaw, profilesRaw, nonce, expected) {
  if (!/^[a-f0-9]{64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(expected)) throw Error('invalid_input');
  const options = normalizeAccountOptionsPayload(optionsRaw).ibkr || [];
  const bindings = normalizeAccountFactsBindings(bindingsRaw).bindings.filter(b => b.platform === 'ibkr');
  const profiles = profilesRaw === null ? DEFAULT_STRATEGY_PROFILES : profilesRaw;
  if (!Array.isArray(profiles) || profiles.length > 100) throw Error('profiles_invalid');
  const names = [...new Set(profiles.map(item => item?.profile || item?.strategy_profile).filter(name => typeof name === 'string' && token.test(name)))];
  const matches = [];
  for (const b of bindings) {
    const matched = options.filter(o => o.key === b.account_key && accountFactsOptionMatchesBinding(o, b));
    if (matched.length !== 1 || options.filter(o => o.key === b.account_key).length !== 1) continue;
    for (const strategy_profile of names) {
      const binding = {account_key:b.account_key, account_scope:b.account_scope, account_selector:b.account_selector,
        deployment_selector:b.deployment_selector, platform:'ibkr', service_name:b.service_name,
        source_binding_id:b.source_binding.id, strategy_profile, target_id:b.target_id};
      if (Object.values(binding).some(v => typeof v !== 'string' || !token.test(v)) || !/^[a-f0-9]{64}$/.test(binding.source_binding_id)) continue;
      const comparison = sha(JSON.stringify({binding, domain:'qsl.ibkr-daily-additional-binding.v1', nonce}));
      if (comparison === expected) matches.push(binding);
    }
  }
  if (matches.length !== 1) throw Error('binding_not_unique');
  return matches[0];
}

// Other existing platforms share the same protected source identity fields.
export function matchExecutionDailyBinding(optionsRaw, bindingsRaw, profilesRaw, platform, nonce, expected) {
  if (!['longbridge','firstrade'].includes(platform) || !/^[a-f0-9]{64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(expected)) throw Error('invalid_input');
  const options = normalizeAccountOptionsPayload(optionsRaw)[platform] || [];
  const bindings = normalizeAccountFactsBindings(bindingsRaw).bindings.filter(b => b.platform === platform);
  const profiles = profilesRaw === null ? DEFAULT_STRATEGY_PROFILES : profilesRaw;
  if (!Array.isArray(profiles) || profiles.length > 100) throw Error('profiles_invalid');
  const names = [...new Set(profiles.map(item => item?.profile || item?.strategy_profile).filter(name => typeof name === 'string' && token.test(name)))];
  const matches=[];
  for (const b of bindings) {
    const opts=options.filter(o=>o.key===b.account_key && accountFactsOptionMatchesBinding(o,b));
    if (opts.length!==1 || options.filter(o=>o.key===b.account_key).length!==1) continue;
    for (const strategy_profile of names) {
      const binding={account_scope:b.account_scope,account_selector:b.account_selector,deployment_selector:b.deployment_selector,
        platform,service_name:b.service_name,source_binding_id:b.source_binding.id,strategy_profile,target_id:b.target_id};
      if (Object.values(binding).some(v=>typeof v!=='string' || !token.test(v)) || !/^[a-f0-9]{64}$/.test(binding.source_binding_id)) continue;
      const domain=platform==='longbridge'?'qsl.longbridge-daily-binding.v1':'qsl.firstrade-daily-binding.v1';
      if (sha(JSON.stringify({binding,domain,nonce}))===expected) matches.push({...binding,account_key:b.account_key});
    }
  }
  if (matches.length!==1) throw Error('binding_not_unique');
  return matches[0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) try {
  const [optionsPath, bindingsPath, profilesPath] = process.argv.slice(2);
  const options = JSON.parse(readFileSync(optionsPath)), bindings = JSON.parse(readFileSync(bindingsPath));
  if (process.env.DAILY_COMPARISON_DIGEST) {
    const profiles = profilesPath ? JSON.parse(readFileSync(profilesPath)) : null;
    const platform=process.env.DAILY_COMPARISON_PLATFORM || 'ibkr';
    if (platform === 'ibkr') matchAdditionalDailyBinding(options, bindings, profiles, process.env.DAILY_COMPARISON_NONCE || '', process.env.DAILY_COMPARISON_DIGEST);
    else matchExecutionDailyBinding(options, bindings, profiles, platform, process.env.DAILY_COMPARISON_NONCE || '', process.env.DAILY_COMPARISON_DIGEST);
    process.stdout.write('status=ok unique_match=true business_writes=0\n');
  } else {
    const result = comparison(options, bindings, process.env.DAILY_COMPARISON_NONCE || '');
    process.stdout.write(`status=ok comparison=${result}\n`);
  }
} catch { process.stdout.write('status=blocked reason=comparison_unavailable\n'); process.exitCode = 1; }
