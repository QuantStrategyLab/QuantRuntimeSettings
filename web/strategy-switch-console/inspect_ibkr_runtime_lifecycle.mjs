import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { __test } from "./worker.js";
import { normalizeAccountOptionsPayload } from "./account_options_schema.js";
import { accountFactsOptionMatchesBinding, normalizeAccountFactsBindings } from "./account_facts.js";

const LIFECYCLE_TARGET_ID = "tqqq_growth_income";
const PLATFORM = "ibkr";
const FACTS_TARGET_ID = "primary-live";
const PREFIX = "runtime_target_lifecycle_source:";
const API_ORIGIN = "https://api.cloudflare.com/client/v4";
const ACCOUNT_OPTIONS_KEY = "account_options";
const ACCOUNT_FACTS_BINDINGS_KEY = "account_facts_bindings";
const MAX_SOURCES = 100;
const MAX_CONFIG_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_LIST_BYTES = 512 * 1024;
const TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 8 * 60 * 1000;
const REASONS = new Set([
  "retained_attention", "config_inconsistent", "check_not_due", "monitoring_agrees",
  "source_not_fresh", "deployment_missing", "deployment_not_fresh",
  "activation_unconfirmed", "evidence_insufficient",
]);

const countLabel = (count) => count === 0 ? "0" : count === 1 ? "1" : "multiple";
const fixedReason = (reason) => REASONS.has(reason) ? reason : "absent";

class LifecycleReadError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function inMemoryStore(sources) {
  const byKey = new Map(sources.map(({ key, value }) => [key, value]));
  return {
    async list({ prefix, limit }) {
      const keys = [...byKey.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit);
      return { keys: keys.map((name) => ({ name })) };
    },
    async get(key) { return byKey.get(key) ?? null; },
    async put() { throw new Error("read_only"); },
  };
}

function aggregate(sources) {
  return __test.aggregateRuntimeTargetLifecycleSources({
    STRATEGY_SWITCH_CONFIG: inMemoryStore(sources),
  });
}

export async function projectIbkrRuntimeLifecycle(optionsRaw, bindingsRaw, sourceRows) {
  let options;
  let bindings;
  const rawBindings = Array.isArray(bindingsRaw?.bindings)
    ? bindingsRaw.bindings.filter((item) => item?.platform === PLATFORM && item?.target_id === FACTS_TARGET_ID)
    : [];
  if (rawBindings.length === 0) return { ok: false, reason: "binding_missing" };
  if (rawBindings.length !== 1) return { ok: false, reason: "binding_duplicate" };
  try {
    options = normalizeAccountOptionsPayload(optionsRaw);
    bindings = normalizeAccountFactsBindings(bindingsRaw).bindings
      .filter((binding) => binding.platform === PLATFORM && binding.target_id === FACTS_TARGET_ID);
  } catch {
    return { ok: false, reason: "configuration_invalid" };
  }
  if (bindings.length === 0) return { ok: false, reason: "binding_missing" };
  if (bindings.length !== 1) return { ok: false, reason: "binding_duplicate" };
  const binding = bindings[0];
  const boundOptions = (options[PLATFORM] || []).filter((option) => option.key === binding.account_key);
  if (boundOptions.length !== 1 || !accountFactsOptionMatchesBinding(boundOptions[0], binding)) {
    return { ok: false, reason: "binding_mismatch" };
  }
  const account = boundOptions[0];
  if (!Array.isArray(sourceRows) || sourceRows.length > MAX_SOURCES) {
    return { ok: false, reason: "source_limit_exceeded" };
  }

  const sources = [];
  try {
    for (const row of sourceRows) {
      if (!row || typeof row.key !== "string" || !row.key.startsWith(PREFIX)
          || typeof row.value !== "string" || Buffer.byteLength(row.value, "utf8") > MAX_SOURCE_BYTES) {
        throw new Error("invalid_source");
      }
      JSON.parse(row.value);
      sources.push({ key: row.key, value: row.value });
    }
  } catch {
    return { ok: false, reason: "source_invalid" };
  }

  const all = await aggregate(sources);
  if (all.errors.includes("runtime_target_lifecycle_source_invalid")) {
    return { ok: false, reason: "source_invalid" };
  }
  const rawEntries = [];
  for (const source of sources) {
    const one = await aggregate([source]);
    for (const entry of one.targets) {
      if (entry.target.target_id === LIFECYCLE_TARGET_ID && entry.target.target.platform === PLATFORM) rawEntries.push(entry);
    }
  }
  const aggregateEntries = all.targets.filter((entry) =>
    entry.target.target_id === LIFECYCLE_TARGET_ID && entry.target.target.platform === PLATFORM);

  const reference = account.runtime_status_target_id || "";
  const referenceUseCount = Object.entries(options).flatMap(([platform, items]) =>
    (Array.isArray(items) ? items : []).filter((item) => item.runtime_status_target_id === LIFECYCLE_TARGET_ID && platform === PLATFORM))
    .length;
  let mapping = "missing";
  if (reference === LIFECYCLE_TARGET_ID && referenceUseCount > 1) mapping = "duplicate";
  else if (reference === LIFECYCLE_TARGET_ID && referenceUseCount === 1) mapping = "unique";

  const entry = aggregateEntries.length === 1 ? aggregateEntries[0] : null;
  const deployment = entry?.target?.deployment;
  const sourceFreshness = entry?.freshness?.data_status;
  const deploymentFreshness = deployment?.observed_at ? entry?.deployment_freshness?.data_status : "unavailable";
  const allowedFreshness = (value) => ["ready", "stale", "unavailable"].includes(value) ? value : "unavailable";
  return {
    ok: true,
    mapping,
    aggregate_target_matches: countLabel(aggregateEntries.length),
    raw_source_target_matches: countLabel(rawEntries.length),
    source_freshness: allowedFreshness(sourceFreshness),
    deployment_present: Boolean(deployment),
    deployment_observed_at_present: typeof deployment?.observed_at === "string" && deployment.observed_at.length > 0,
    deployment_freshness: allowedFreshness(deploymentFreshness),
    account_state_reason: entry ? fixedReason(__test.projectRuntimeAccountState(entry).reason) : "absent",
    ttl_source: "default_unconfirmed",
    configuration_scope: "legacy_kv_unconfirmed",
  };
}

export function summaryLine(result) {
  if (!result.ok) return `status=blocked reason=${result.reason} ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle\n`;
  return `status=ok mapping=${result.mapping}`
    + ` aggregate_target_matches=${result.aggregate_target_matches}`
    + ` raw_source_target_matches=${result.raw_source_target_matches}`
    + ` source_freshness=${result.source_freshness}`
    + ` deployment_present=${result.deployment_present}`
    + ` deployment_observed_at_present=${result.deployment_observed_at_present}`
    + ` deployment_freshness=${result.deployment_freshness}`
    + ` account_state_reason=${result.account_state_reason}`
    + ` ttl_source=${result.ttl_source} configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle\n`;
}

async function readLimited(response, limitBytes) {
  if (!response.ok || !response.body) throw new LifecycleReadError("read_failed");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limitBytes) throw new LifecycleReadError("read_failed");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limitBytes) {
      await reader.cancel();
      throw new LifecycleReadError("read_failed");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

export async function readRemoteLifecycleData(env, fetchImpl = fetch, now = Date.now) {
  const token = String(env.CLOUDFLARE_API_TOKEN || "");
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || "");
  const namespaceId = String(env.STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID || "");
  if (!token || !accountId || !namespaceId) throw new LifecycleReadError("credentials_missing");
  const root = `${API_ORIGIN}/accounts/${encodeURIComponent(accountId)}`
    + `/storage/kv/namespaces/${encodeURIComponent(namespaceId)}`;
  const headers = { Authorization: `Bearer ${token}` };
  const deadline = now() + TOTAL_TIMEOUT_MS;
  const get = async (url, maxBytes) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new LifecycleReadError("timeout");
    const signal = AbortSignal.timeout(Math.min(TIMEOUT_MS, remaining));
    let response;
    try {
      response = await fetchImpl(url, { method: "GET", headers, signal, redirect: "error" });
      return await readLimited(response, maxBytes, signal);
    } catch (error) {
      if (signal.aborted) throw new LifecycleReadError("timeout");
      if (error instanceof LifecycleReadError) throw error;
      throw new LifecycleReadError("read_failed");
    }
  };
  const parseJson = (text, code) => {
    try { return JSON.parse(text); } catch { throw new LifecycleReadError(code); }
  };
  const getConfig = async (key) => parseJson(
    await get(`${root}/values/${encodeURIComponent(key)}`, MAX_CONFIG_BYTES),
    "configuration_invalid",
  );
  const options = await getConfig(ACCOUNT_OPTIONS_KEY);
  const bindings = await getConfig(ACCOUNT_FACTS_BINDINGS_KEY);
  const listUrl = `${root}/keys?prefix=${encodeURIComponent(PREFIX)}&limit=${MAX_SOURCES}`;
  const listing = parseJson(await get(listUrl, MAX_LIST_BYTES), "read_failed");
  if (listing?.success !== true || !Array.isArray(listing.result) || listing.result.length > MAX_SOURCES) {
    throw new LifecycleReadError("read_failed");
  }
  const cursor = listing?.result_info?.cursor;
  if (cursor !== undefined && cursor !== null && (typeof cursor !== "string" || cursor.length > 0)) {
    throw new LifecycleReadError("read_failed");
  }
  const rows = [];
  for (const entry of listing.result) {
    const key = entry?.name;
    if (typeof key !== "string" || !key.startsWith(PREFIX)) throw new LifecycleReadError("read_failed");
    const valueUrl = `${root}/values/${encodeURIComponent(key)}`;
    const value = await get(valueUrl, MAX_SOURCE_BYTES);
    rows.push({ key, value });
  }
  return { options, bindings, sources: rows };
}

export async function main(argv, {
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
  write = (text) => process.stdout.write(text),
} = {}) {
  if (argv.length !== 0) {
    write("status=blocked reason=configuration_invalid ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle\n");
    return 1;
  }
  try {
    const data = await readRemoteLifecycleData(env, fetchImpl, now);
    const result = await projectIbkrRuntimeLifecycle(data.options, data.bindings, data.sources);
    write(summaryLine(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    const reason = ["credentials_missing", "configuration_invalid", "timeout"].includes(error?.code)
      ? error.code : "read_failed";
    write(`status=blocked reason=${reason} ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
