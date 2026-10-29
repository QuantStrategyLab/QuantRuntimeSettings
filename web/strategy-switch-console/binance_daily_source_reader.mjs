import { matchBinanceDailyBinding } from './binance_daily_binding.mjs';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const sourceUrl = 'https://api.github.com/repos/QuantStrategyLab/BinancePlatform/actions/variables/RUNTIME_TARGET_JSON';
const maxBytes = 128 * 1024;

async function boundedJson(response) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw Error('response_invalid');
  if (!response.body) throw Error('response_invalid');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error('response_invalid');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
}

/** Read exactly one protected variable and match entirely in runner memory. */
export async function matchBinanceDailyFromGitHub({options, wallet, nonce, expected, githubToken, fetchImpl = fetch}) {
  if (typeof githubToken !== 'string' || !githubToken || githubToken.trim() !== githubToken)
    return {status:'unavailable'};
  let response;
  try {
    response = await fetchImpl(sourceUrl, {method:'GET', redirect:'error', signal:AbortSignal.timeout(20000),
      headers:{Authorization:`Bearer ${githubToken}`, Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'QuantStrategyLab-RuntimeDaily/1.0'}});
  } catch { return {status:'unavailable'}; }
  if (response.status === 403 || response.status === 404) {
    await response.body?.cancel().catch(() => {});
    return {status:response.status === 403 ? 'forbidden' : 'not_found'};
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return {status:'unavailable'};
  }
  try {
    const data = await boundedJson(response);
    if (!data || data.name !== 'RUNTIME_TARGET_JSON' || typeof data.value !== 'string') return {status:'unavailable'};
    const runtimeTarget = JSON.parse(data.value);
    const binding = await matchBinanceDailyBinding(options, wallet, runtimeTarget, nonce, expected);
    return {status:'matched', binding};
  } catch { return {status:'unavailable'}; }
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options=JSON.parse(readFileSync(process.argv[2],'utf8'));
    const wallet=JSON.parse(process.env.BINANCE_ACCOUNT_FACTS_BINDING_JSON || '');
    const result=await matchBinanceDailyFromGitHub({options,wallet,nonce:process.env.DAILY_COMPARISON_NONCE,
      expected:process.env.DAILY_COMPARISON_DIGEST,githubToken:process.env.RUNTIME_SETTINGS_GH_TOKEN});
    if (result.status==='matched') console.log('status=ok unique_match=true business_writes=0');
    else {console.log(`status=blocked reason=${result.status}`);process.exitCode=1;}
  } catch {console.log('status=blocked reason=unavailable');process.exitCode=1;}
}
