import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { normalizeAccountOptionsPayload } from "./account_options_schema.js";
import { normalizeAccountFactsBindings } from "./account_facts.js";

const SCHEMA = "qsl_account_facts_bindings.v1";
const FT_REPO = "QuantStrategyLab/FirstradePlatform";
const QRS_REPO = "QuantStrategyLab/QuantRuntimeSettings";
const QRS_ENV = "runtime-strategy-switch";
const SETTINGS = [
  "FIRSTRADE_ACCOUNT_FACTS_TARGET_ID", "FIRSTRADE_ACCOUNT_FACTS_SOURCE_BINDING_ID",
  "FIRSTRADE_ACCOUNT_FACTS_ACCOUNT_KEY", "FIRSTRADE_ACCOUNT_FACTS_ACCOUNT_SCOPE",
];
const fail = (reason) => { throw new Error(reason); };

export function firstradeSourceBindingId({
  service_name, deployment_selector, account_scope, broker_account_id,
}) {
  return createHash("sha256").update(JSON.stringify({
    platform: "firstrade", service_name, deployment_selector, account_scope, broker_account_id,
  })).digest("hex");
}

export function prepareFirstradeFactsBinding(source, optionsRaw, bindingsRaw) {
  const target = source?.runtime_target;
  if (!source || Object.keys(source).sort().join(",") !== "runtime_target,service_name,serving_source_sha"
      || !/^[a-f0-9]{40}$/.test(source.serving_source_sha || "")
      || !target || target.platform_id !== "firstrade"
      || typeof source.service_name !== "string" || !source.service_name
      || target.service_name !== source.service_name
      || typeof target.deployment_selector !== "string" || !target.deployment_selector
      || typeof target.account_scope !== "string" || !target.account_scope) fail("runtime_source_invalid");
  const selectors = typeof target.account_selector === "string"
    ? [target.account_selector] : target.account_selector;
  if (!Array.isArray(selectors) || selectors.length !== 1
      || typeof selectors[0] !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(selectors[0])) {
    fail("runtime_selector_invalid");
  }
  const options = normalizeAccountOptionsPayload(optionsRaw);
  const existing = normalizeAccountFactsBindings(bindingsRaw);
  const matches = (options.firstrade || []).filter((option) =>
    option.service_name === target.service_name
    && option.deployment_selector === target.deployment_selector
    && option.account_scope === target.account_scope);
  if (matches.length !== 1) fail("firstrade_account_option_not_unique");
  const option = matches[0];
  const identity = {
    platform: "firstrade", account_key: option.key, account_scope: option.account_scope,
    target_name: option.target_name, service_name: option.service_name,
    deployment_selector: option.deployment_selector, account_selector: option.account_selector,
    broker_account_id: selectors[0],
  };
  const prior = existing.bindings.filter((item) => item.platform === "firstrade");
  if (prior.length) {
    const same = prior[0];
    const actual = Object.fromEntries(Object.keys(identity).map((key) => [key, same[key]]));
    if (prior.length !== 1 || !isDeepStrictEqual(actual, identity)) fail("existing_firstrade_binding_conflict");
    return { schema_version: SCHEMA, bindings: [same] };
  }
  const binding = {
    ...identity, target_id: "firstrade-homepage",
    source_binding: {
      kind: "deployment_runtime_account",
      id: firstradeSourceBindingId({
        service_name: target.service_name,
        deployment_selector: target.deployment_selector,
        account_scope: target.account_scope,
        broker_account_id: selectors[0],
      }),
    },
  };
  if (existing.bindings.some((item) => item.target_id === binding.target_id)) fail("facts_target_already_used");
  return normalizeAccountFactsBindings({ schema_version: SCHEMA, bindings: [binding] });
}

export function rotateFirstradeFactsBrokerAccount(rotation, bindingsRaw) {
  if (!rotation || Array.isArray(rotation)
      || Object.keys(rotation).sort().join(",")
        !== "next_broker_account_id,next_source_binding_id,previous_source_binding_id,target_id"
      || !/^[a-f0-9]{64}$/.test(rotation.previous_source_binding_id || "")
      || !/^[a-f0-9]{64}$/.test(rotation.next_source_binding_id || "")
      || rotation.next_source_binding_id === rotation.previous_source_binding_id
      || typeof rotation.target_id !== "string"
      || typeof rotation.next_broker_account_id !== "string"
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(rotation.next_broker_account_id)) {
    fail("rotation_config_invalid");
  }
  const existing = normalizeAccountFactsBindings(bindingsRaw);
  const candidates = existing.bindings.filter((item) => item.platform === "firstrade"
    && item.target_id === rotation.target_id);
  if (candidates.length !== 1) fail("expected_existing_firstrade_binding");
  const current = candidates[0];
  if (current.source_binding.id !== rotation.previous_source_binding_id) fail("previous_binding_mismatch");
  if (current.broker_account_id === rotation.next_broker_account_id) fail("rotation_broker_unchanged");
  const expectedId = firstradeSourceBindingId({
    service_name: current.service_name,
    deployment_selector: current.deployment_selector,
    account_scope: current.account_scope,
    broker_account_id: rotation.next_broker_account_id,
  });
  if (expectedId !== rotation.next_source_binding_id) fail("rotation_binding_id_mismatch");
  const updated = {
    ...current,
    broker_account_id: rotation.next_broker_account_id,
    source_binding: { ...current.source_binding, id: rotation.next_source_binding_id },
  };
  return normalizeAccountFactsBindings({ schema_version: SCHEMA, bindings: [updated] });
}

function protectedCommand(args, input, env) {
  const result = spawnSync("gh", args, { input, env, encoding: "utf8", timeout: 20_000,
    maxBuffer: 1024 * 1024 });
  // Capture every response, including stderr: neither private configuration nor
  // provider/CLI error text belongs in the workflow log.
  if (result.error || result.status !== 0) fail("protected_configuration_write_failed_or_unknown");
  return result.stdout;
}

export function applyFirstradeFactsSettings(payload, {
  env = process.env, command = protectedCommand,
} = {}) {
  const normalized = normalizeAccountFactsBindings(payload);
  if (normalized.bindings.length !== 1 || normalized.bindings[0].platform !== "firstrade"
      || !env.GH_TOKEN) fail("protected_configuration_unavailable");
  let metadata;
  try { metadata = JSON.parse(command(["api", `repos/${FT_REPO}/actions/secrets?per_page=100`], undefined, env)); }
  catch { fail("protected_configuration_metadata_unavailable"); }
  if (!Array.isArray(metadata?.secrets) || metadata.total_count !== metadata.secrets.length
      || metadata.secrets.some((item) => typeof item?.name !== "string")) fail("protected_configuration_metadata_invalid");
  if (metadata.secrets.some((item) => SETTINGS.includes(item.name))) fail("firstrade_settings_already_present");
  let gate;
  try {
    const text = command(["variable", "list", "--repo", FT_REPO, "--json", "name,value"], undefined, env);
    const variables = JSON.parse(text);
    if (!Array.isArray(variables)) fail("protected_configuration_metadata_invalid");
    gate = variables.find((item) => item.name === "FIRSTRADE_ACCOUNT_FACTS_SYNC_ENABLED")?.value;
  } catch { fail("protected_configuration_metadata_unavailable"); }
  if (gate !== undefined && gate !== "false") fail("firstrade_sync_gate_not_disabled");
  const binding = normalized.bindings[0];
  const values = [binding.target_id, binding.source_binding.id, binding.account_key, binding.account_scope];
  SETTINGS.forEach((name, index) => command(["secret", "set", name, "--repo", FT_REPO], values[index], env));
  command(["secret", "set", "FIRSTRADE_ACCOUNT_FACTS_BINDING_JSON", "--repo", QRS_REPO,
    "--env", QRS_ENV], JSON.stringify(normalized), env);
  const variables = {
    FIRSTRADE_ACCOUNT_FACTS_SYNC_ENABLED: "false",
    FIRSTRADE_ACCOUNT_FACTS_SYNC_URL: "https://qsl-strategy-switch-console.pigbibi.workers.dev/api/account-facts/sync",
    FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN_SECRET_NAME: "firstrade-account-facts-sync",
  };
  // Values travel on stdin, including non-secret settings, to keep one rule.
  for (const [name, value] of Object.entries(variables)) {
    command(["variable", "set", name, "--repo", FT_REPO], value, env);
  }
  try {
    const secrets = JSON.parse(command(["api", `repos/${FT_REPO}/actions/secrets?per_page=100`], undefined, env));
    const names = new Set(secrets.secrets.map((item) => item.name));
    const readback = JSON.parse(command(["variable", "list", "--repo", FT_REPO, "--json", "name,value"], undefined, env));
    const values = Object.fromEntries(readback.map((item) => [item.name, item.value]));
    const bindingSecret = JSON.parse(command(["api", `repos/${QRS_REPO}/environments/${QRS_ENV}/secrets/FIRSTRADE_ACCOUNT_FACTS_BINDING_JSON`], undefined, env));
    if (!SETTINGS.every((name) => names.has(name))
        || Object.entries(variables).some(([name, value]) => values[name] !== value)
        || bindingSecret.name !== "FIRSTRADE_ACCOUNT_FACTS_BINDING_JSON") fail("readback_mismatch");
  } catch { fail("firstrade_configuration_readback_failed"); }
  return { secret_writes: 5, sync_enabled: false };
}

export function applyFirstradeSourceBindingRotation(payload, {
  env = process.env, command = protectedCommand,
} = {}) {
  const normalized = normalizeAccountFactsBindings(payload);
  if (normalized.bindings.length !== 1 || normalized.bindings[0].platform !== "firstrade"
      || !env.GH_TOKEN) fail("protected_configuration_unavailable");
  const binding = normalized.bindings[0];
  command(["secret", "set", "FIRSTRADE_ACCOUNT_FACTS_SOURCE_BINDING_ID", "--repo", FT_REPO],
    binding.source_binding.id, env);
  command(["secret", "set", "FIRSTRADE_ACCOUNT_FACTS_BINDING_JSON", "--repo", QRS_REPO,
    "--env", QRS_ENV], JSON.stringify(normalized), env);
  try {
    const secrets = JSON.parse(command(["api", `repos/${FT_REPO}/actions/secrets?per_page=100`], undefined, env));
    const names = new Set(secrets.secrets.map((item) => item.name));
    const bindingSecret = JSON.parse(command(["api",
      `repos/${QRS_REPO}/environments/${QRS_ENV}/secrets/FIRSTRADE_ACCOUNT_FACTS_BINDING_JSON`], undefined, env));
    if (!names.has("FIRSTRADE_ACCOUNT_FACTS_SOURCE_BINDING_ID")
        || bindingSecret.name !== "FIRSTRADE_ACCOUNT_FACTS_BINDING_JSON") fail("readback_mismatch");
  } catch { fail("firstrade_configuration_readback_failed"); }
  return { secret_writes: 2, rotated: true };
}
