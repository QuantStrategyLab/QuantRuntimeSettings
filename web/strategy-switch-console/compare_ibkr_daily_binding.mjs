import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { normalizeAccountOptionsPayload } from './account_options_schema.js';
import { normalizeAccountFactsBindings, accountFactsOptionMatchesBinding } from './account_facts.js';

// Fixed primary target established by the protected primary binding comparison.
const targetAnchor = '5069050c930b4951fdbb99138b0d1844ae719afb8743d803692084f64edacae2';
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const token = /^[A-Za-z0-9][A-Za-z0-9._|:-]{0,119}$/;

export function comparison(optionsRaw, bindingsRaw, nonce, anchor = targetAnchor) {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw Error('invalid_input');
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
  return sha(JSON.stringify({binding, domain:'qsl.ibkr-daily-binding-comparison.v1', nonce}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) try {
  const [optionsPath, bindingsPath] = process.argv.slice(2);
  const result = comparison(JSON.parse(readFileSync(optionsPath)), JSON.parse(readFileSync(bindingsPath)), process.env.DAILY_COMPARISON_NONCE || '');
  process.stdout.write(`status=ok comparison=${result}\n`);
} catch { process.stdout.write('status=blocked reason=comparison_unavailable\n'); process.exitCode = 1; }
