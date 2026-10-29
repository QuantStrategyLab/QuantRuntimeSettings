// Initial enrollment hashes the reviewed facts and candidate with their source
// contracts; these do not authorize execution or replace reconciliation.
const FIELDS = ['positions', 'cash', 'open_orders', 'recent_executions', 'local_execution_ledger'];
const HASH = /^[a-f0-9]{64}$/;
const SCOPES = { positions: 'account_strategy_positions', cash: 'returned_account_cash',
  open_orders: 'all_client_open_orders', recent_executions: 'broker_requested_window',
  local_execution_ledger: 'bounded_live_claims_and_outcomes' };
const SCOPE_KEYS = ['kind', 'currency', 'window_start', 'window_end', 'limit_per_namespace', 'gateway_availability', 'truncated'];
const CANDIDATE_KEYS = ['schema_version', 'platform_id', 'strategy_profile', 'account_scope_sha256',
  'baseline_id', 'baseline_target_sha256', 'source_evidence_sha256', 'source_receipts_sha256',
  'first_observed_at', 'last_observed_at', ...FIELDS.map(name => `${name}_sha256`),
  'mode', 'facts_sha256', 'coverage', 'candidate_sha256'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const CONTRACT_KEYS = ['con_id', 'symbol', 'local_symbol', 'sec_type', 'currency'];
const ORDER_KEYS = ['contract', 'perm_id', 'action', 'order_type', 'total_quantity', 'limit_price', 'aux_price', 'status', 'filled', 'remaining'];
const EXECUTION_KEYS = ['contract', 'execution_id', 'order_id', 'time', 'side', 'shares', 'price'];
const CASH_TAGS = new Set(['$LEDGER-CashBalance', '$LEDGER-TotalCashBalance', 'CashBalance', 'TotalCashBalance', 'SettledCash']);
const textFields = (value, keys) => exact(value, keys) && keys.every(key => value[key] === null
  || (typeof value[key] === 'string' && value[key].length <= 512));
function validItem(name, item) {
  if (name === 'positions') return textFields(item, ['symbol', 'quantity', 'average_cost', 'currency'])
    || textFields(item, ['underlier', 'local_symbol', 'expiration', 'right', 'strike', 'quantity', 'average_cost', 'currency']);
  if (name === 'cash') return exact(item, ['currency', 'tags']) && typeof item.currency === 'string'
    && item.tags && typeof item.tags === 'object' && !Array.isArray(item.tags)
    && Object.keys(item.tags).length === 1 && Object.entries(item.tags).every(([key, value]) => CASH_TAGS.has(key)
      && typeof value === 'string' && value.length <= 512);
  if (name === 'local_execution_ledger') return textFields(item, ['record_count']) && /^\d+$/.test(item.record_count || '');
  const keys = name === 'open_orders' ? ORDER_KEYS : EXECUTION_KEYS;
  return exact(item, keys) && textFields(item.contract, CONTRACT_KEYS)
    && keys.filter(key => key !== 'contract').every(key => item[key] === null
      || (typeof item[key] === 'string' && item[key].length <= 512));
}
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace('Z', '.000Z');

function canonical(value, ascii) {
  const string = value => {
    const json = JSON.stringify(value);
    return ascii ? json.replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) : json;
  };
  if (value === null) return 'null';
  if (typeof value === 'string') return string(value);
  if (typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, ascii)).join(',')}]`;
  if (!value || typeof value !== 'object') throw new Error('invalid_initial_enrollment_value');
  return `{${Object.keys(value).sort().map(key => `${string(key)}:${canonical(value[key], ascii)}`).join(',')}}`;
}

async function digest(value, ascii = false) {
  const bytes = new TextEncoder().encode(canonical(value, ascii));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}

// The full candidate and facts are checked again at the authorized source
// ingress before publishing the review material. The per-surface data remains
// partial or unknown when the source has not established completeness.
export async function initialEnrollmentBindingsMatch(candidate, facts) {
  if (!exact(candidate, CANDIDATE_KEYS) || candidate.schema_version !== 'broker_reconciliation_baseline_candidate.v3'
      || candidate.mode !== 'initial_enrollment' || !HASH.test(candidate.candidate_sha256 || '')
      || !HASH.test(candidate.facts_sha256 || '') || !facts || facts.schema_version !== 'ibkr_initial_facts.v1'
      || candidate.account_scope_sha256 !== facts.account_scope_sha256
      || !exact(candidate.coverage, FIELDS) || !exact(facts, ['schema_version', 'account_scope_sha256', 'observed_at', 'surfaces'])
      || !exact(facts.surfaces, FIELDS) || !timestamp(facts.observed_at)
      || !timestamp(candidate.first_observed_at) || !timestamp(candidate.last_observed_at)
      || candidate.first_observed_at > candidate.last_observed_at
      || !['platform_id', 'strategy_profile', 'baseline_id'].every(key => typeof candidate[key] === 'string' && candidate[key].length > 0)
      || !['account_scope_sha256', 'baseline_target_sha256', 'source_receipts_sha256'].every(key => HASH.test(candidate[key] || ''))
      || !Array.isArray(candidate.source_evidence_sha256) || !candidate.source_evidence_sha256.length
      || candidate.source_evidence_sha256.some(item => !HASH.test(item))
      || candidate.source_evidence_sha256.some((item, index, all) => index > 0 && all[index - 1] >= item)) return false;
  for (const name of FIELDS) {
    const surface = facts.surfaces[name];
    if (!exact(surface, ['status', 'items', 'scope']) || !exact(surface.scope, SCOPE_KEYS)
        || surface.scope.kind !== SCOPES[name]
        || SCOPE_KEYS.some(key => surface.scope[key] !== null && (typeof surface.scope[key] !== 'string' || surface.scope[key].length > 128))
        || ![null, 'true', 'false'].includes(surface.scope.truncated)
        || (surface.status === 'complete' && surface.scope.truncated === 'true') || !['complete', 'partial', 'unknown'].includes(surface.status)
        || candidate.coverage[name] !== surface.status
        || (surface.status === 'unknown' && surface.items !== null)
        || (Array.isArray(surface.items) && surface.items.some(item => !validItem(name, item)))
        || (surface.status === 'complete' && !Array.isArray(surface.items))
        || (surface.status === 'partial' && surface.items !== null && (!Array.isArray(surface.items) || !surface.items.length))
        || (surface.status === 'complete' && !HASH.test(candidate[`${name}_sha256`] || ''))
        || (surface.status !== 'complete' && candidate[`${name}_sha256`] !== null)) return false;
  }
  try {
    const { candidate_sha256, ...material } = candidate;
    return candidate.facts_sha256 === await digest(facts)
      && candidate_sha256 === await digest(material, true);
  } catch { return false; }
}

export { canonical as initialEnrollmentCanonical, digest as initialEnrollmentDigest };
