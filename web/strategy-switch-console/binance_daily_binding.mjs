import { createHash } from 'node:crypto';
import { normalizeAccountOptionsPayload } from './account_options_schema.js';
import { normalizeBinanceFactsBinding, assertBinanceFactsSourceBinding, binanceFactsOptionMatches } from './binance_account_facts.js';

const identifier = /^[A-Za-z0-9._:-]{1,128}$/;
const hash = /^[a-f0-9]{64}$/;

/** Match the independently read Binance runtime target and wallet source to one website account. */
export async function matchBinanceDailyBinding(optionsRaw, walletRaw, runtimeTarget, nonce, expected) {
  if (!hash.test(nonce) || !hash.test(expected) || !runtimeTarget || typeof runtimeTarget !== 'object'
      || Array.isArray(runtimeTarget)) throw Error('invalid_input');
  const wallet = normalizeBinanceFactsBinding(walletRaw);
  await assertBinanceFactsSourceBinding(wallet);
  const options = normalizeAccountOptionsPayload(optionsRaw).binance || [];
  const matches = options.filter(option => binanceFactsOptionMatches(option, wallet));
  if (matches.length !== 1 || options.filter(option => option.key === wallet.account_key).length !== 1)
    throw Error('binding_not_unique');
  const selectors = runtimeTarget.account_selector;
  if ((runtimeTarget.platform_id !== undefined && runtimeTarget.platform_id !== 'binance')
      || !Array.isArray(selectors) || selectors.length !== 1 || selectors[0] !== wallet.account_selector
      || runtimeTarget.account_scope !== wallet.account_scope
      || runtimeTarget.deployment_selector !== wallet.deployment_selector
      || (wallet.service_name && runtimeTarget.service_name !== wallet.service_name)) throw Error('target_mismatch');
  const binding = {
    account_scope: runtimeTarget.account_scope,
    account_selector: selectors[0],
    deployment_selector: runtimeTarget.deployment_selector,
    platform: 'binance',
    service_name: runtimeTarget.service_name,
    source_binding_id: wallet.source_binding.id,
    strategy_profile: runtimeTarget.strategy_profile,
    target_id: wallet.target_id,
  };
  if (Object.values(binding).some(value => typeof value !== 'string' || !identifier.test(value))
      || !hash.test(binding.source_binding_id)) throw Error('invalid_input');
  const actual = createHash('sha256').update(JSON.stringify({binding, domain:'qsl.binance-daily-binding.v1', nonce}), 'utf8').digest('hex');
  if (actual !== expected) throw Error('binding_not_unique');
  return {...binding, account_key: wallet.account_key};
}
