// Native quantities for the explicitly covered Spot + Flexible Earn scope.
// This projection never produces account NAV, cash, FX totals, or trading authority.
export const BINANCE_FACTS_SCHEMA = "binance_account_facts.v1";
export const BINANCE_FACTS_KIND = "binance_readonly_scope_revision";
export const BINANCE_FACTS_KEY = "private_binance_account_facts";
export const BINANCE_FACTS_MAX_BYTES = 256 * 1024;
export const BINANCE_FACTS_STALE_MS = 36 * 60 * 60 * 1000;
const UNCOVERED = ["funding", "margin", "futures", "locked_earn"];
const IDENTITY = ["target_name", "service_name", "deployment_selector", "account_selector"];
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,30})?$/;

export class BinanceFactsError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
function fail(code, status = 400) { throw new BinanceFactsError(code, status); }
function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== fields.length
      || fields.some(key => !Object.hasOwn(value, key))) fail("invalid_binance_account_facts");
}
function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) {
    fail("invalid_binance_account_facts_time");
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail("invalid_binance_account_facts_time");
  const normalized = new Date(ms).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) fail("invalid_binance_account_facts_time");
  return ms;
}
function units(text) {
  if (typeof text !== "string" || !DECIMAL.test(text)) fail("invalid_binance_account_facts_quantity");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole + fraction.padEnd(30, "0"));
}

export function normalizeBinanceFactsBinding(raw) {
  exact(raw, ["platform", "account_key", "account_scope", ...IDENTITY, "target_id",
    "account_scope_sha256", "reader_revision", "approved_application_revision", "source_binding"]);
  if (raw.platform !== "binance" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(raw.account_key)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(raw.account_scope)
      || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.target_id)
      || !HASH.test(raw.account_scope_sha256) || !SHA.test(raw.reader_revision)
      || !SHA.test(raw.approved_application_revision)) fail("binance_account_facts_binding_invalid", 503);
  for (const field of IDENTITY) {
    if (typeof raw[field] !== "string" || raw[field].length > 256
        || (field !== "service_name" && !raw[field].length)) fail("binance_account_facts_binding_invalid", 503);
  }
  exact(raw.source_binding, ["kind", "id"]);
  if (raw.source_binding.kind !== BINANCE_FACTS_KIND || !HASH.test(raw.source_binding.id)) {
    fail("binance_account_facts_binding_invalid", 503);
  }
  return raw;
}

export function binanceFactsOptionMatches(option, binding) {
  return Boolean(option && binding && option.key === binding.account_key
    && option.account_scope === binding.account_scope
    && IDENTITY.every(field => (option[field] ?? "") === binding[field]));
}

export async function assertBinanceFactsSourceBinding(binding) {
  const material = {
    account_scope_sha256: binding.account_scope_sha256,
    approved_application_revision: binding.approved_application_revision,
    reader_public_revision: binding.reader_revision,
    scope: "spot+flexible_earn",
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(material)));
  const expected = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (binding.source_binding.id !== expected) fail("binance_account_facts_binding_invalid", 503);
}

export function normalizeBinanceAccountFacts(raw, binding, { now = Date.now(), ingest = false } = {}) {
  exact(raw, ["schema_version", "platform", "target_id", "account_scope_sha256", "source_binding",
    "source_revision", "approved_application_revision", "observed_started_at", "observed_finished_at",
    "spot_observed_at", "earn_observed_at", "snapshot_atomic", "scope", "completeness", "assets",
    "uncovered_scopes", "no_order", "execution_authority_granted"]);
  if (raw.schema_version !== BINANCE_FACTS_SCHEMA || raw.platform !== "binance"
      || raw.scope !== "spot+flexible_earn" || raw.completeness !== "complete_for_scope"
      || raw.snapshot_atomic !== false || raw.no_order !== true || raw.execution_authority_granted !== false) {
    fail("invalid_binance_account_facts");
  }
  exact(raw.source_binding, ["kind", "id"]);
  if (!binding || raw.target_id !== binding.target_id || raw.account_scope_sha256 !== binding.account_scope_sha256
      || raw.source_revision !== binding.reader_revision
      || raw.approved_application_revision !== binding.approved_application_revision
      || raw.source_binding.kind !== BINANCE_FACTS_KIND || raw.source_binding.id !== binding.source_binding.id) {
    fail("binance_account_facts_identity_mismatch", 409);
  }
  const start = instant(raw.observed_started_at), finish = instant(raw.observed_finished_at);
  const spot = instant(raw.spot_observed_at), earn = instant(raw.earn_observed_at);
  if (start > spot || spot > earn || earn > finish || finish - start > 5 * 60 * 1000
      || finish > now + 60 * 1000 || (ingest && now - finish > 10 * 60 * 1000)) {
    fail("binance_account_facts_observation_invalid", 409);
  }
  if (!Array.isArray(raw.uncovered_scopes) || raw.uncovered_scopes.length !== UNCOVERED.length
      || UNCOVERED.some((name, index) => raw.uncovered_scopes[index] !== name)) fail("invalid_binance_account_facts");
  if (!Array.isArray(raw.assets) || raw.assets.length > 5000) fail("invalid_binance_account_facts_assets");
  const seen = new Set();
  for (const asset of raw.assets) {
    exact(asset, ["asset", "quantity", "spot_free", "spot_locked", "flexible_earn"]);
    if (typeof asset.asset !== "string" || !/^[A-Z0-9]{1,128}$/.test(asset.asset) || seen.has(asset.asset)) {
      fail("invalid_binance_account_facts_assets");
    }
    seen.add(asset.asset);
    const total = units(asset.quantity);
    if (!total || total !== units(asset.spot_free) + units(asset.spot_locked) + units(asset.flexible_earn)) {
      fail("invalid_binance_account_facts_quantity");
    }
  }
  return raw;
}

export function projectBinanceAccountFacts(raw, binding, { now = Date.now() } = {}) {
  const report = normalizeBinanceAccountFacts(raw, binding, { now });
  if (now - instant(report.observed_finished_at) > BINANCE_FACTS_STALE_MS) return null;
  return {
    platform: "binance", account_key: binding.account_key, scope: report.scope,
    observed_finished_at: report.observed_finished_at, snapshot_atomic: false,
    assets: report.assets.map(row => ({ ...row })), uncovered_scopes: [...UNCOVERED],
  };
}
