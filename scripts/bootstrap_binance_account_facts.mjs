import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { normalizeAccountOptionsPayload } from "../web/strategy-switch-console/account_options_schema.js";

const QRS_REPOSITORY = "QuantStrategyLab/QuantRuntimeSettings";
const BINANCE_REPOSITORY = "QuantStrategyLab/BinancePlatform";
const QRS_ENVIRONMENT = "runtime-strategy-switch";
const BINANCE_ENVIRONMENT = "binance-runtime";
const BINANCE_ACCOUNT_FACTS_READER_REVISION = "4ca436a8910eecd35335f2d04dc69cfb9be4a327";
const APPROVED_APPLICATION_REVISION = "8cb56617115fa45028e34d788e71884b6a303d77";
const SOURCE_BINDING_KIND = "binance_readonly_scope_revision";
const SOURCE_SCOPE = "spot+flexible_earn";
const OPTION_IDENTITY_FIELDS = ["service_name", "deployment_selector"];
const SECRET_NAMES = ["BINANCE_ACCOUNT_FACTS_BINDING_JSON", "BINANCE_ACCOUNT_FACTS_SYNC_TOKEN"];
const GITHUB_API = "https://api.github.com";
const BINANCE_TARGET_ID = "binance-homepage";
const COMMAND_TIMEOUT_MS = 20_000;
const BINANCE_ACCOUNT_FACTS_ENABLED_VARIABLE = "BINANCE_ACCOUNT_FACTS_ENABLED";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function requiredString(value, code) {
  if (typeof value !== "string" || !value.trim()) fail(code);
  return value.trim();
}

function exactDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function singleSelector(value) {
  const selectors = Array.isArray(value) && value.length === 1 ? value : [];
  if (selectors.length !== 1 || typeof selectors[0] !== "string"
      || !selectors[0].trim() || selectors[0].includes(",")) fail("runtime_selector_invalid");
  return selectors[0].trim();
}

export function buildBinanceFactsBinding({
  variables,
  accountOptions,
  readerRevision = BINANCE_ACCOUNT_FACTS_READER_REVISION,
}) {
  if (typeof readerRevision !== "string" || !/^[a-f0-9]{40}$/.test(readerRevision)) {
    fail("reader_revision_invalid");
  }
  let target;
  let expected;
  try {
    target = JSON.parse(requiredString(variables.RUNTIME_TARGET_JSON, "runtime_target_missing"));
    expected = JSON.parse(requiredString(
      variables.BINANCE_RECONCILIATION_EXPECTED_DIGESTS_JSON, "expected_digests_missing",
    ));
  } catch (error) {
    if (error?.code) throw error;
    fail("protected_configuration_invalid");
  }
  if (!target || typeof target !== "object" || Array.isArray(target)
      || target.platform_id !== "binance") fail("runtime_target_invalid");
  if (!expected || typeof expected !== "object" || Array.isArray(expected)
      || !exactDigest(expected.account_scope_sha256)) fail("account_scope_digest_invalid");
  if (!/^[a-f0-9]{40}$/.test(variables.BINANCE_RUNTIME_RELEASE_SHA || "")
      || variables.BINANCE_RUNTIME_RELEASE_SHA !== APPROVED_APPLICATION_REVISION) {
    fail("runtime_application_revision_mismatch");
  }
  if (!["true", "false"].includes(variables.RUNTIME_TARGET_ENABLED)) fail("runtime_enabled_invalid");

  const accountScope = requiredString(target.account_scope, "runtime_account_scope_missing");
  const selector = singleSelector(target.account_selector);
  const strategy = requiredString(target.strategy_profile, "runtime_strategy_missing");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(strategy)) fail("runtime_strategy_invalid");
  const runtimeTargetId = `binance.${strategy}`;
  const runtimeServiceIdentity = {
    service_name: requiredString(target.service_name, "runtime_target_identity_missing"),
    deployment_selector: requiredString(target.deployment_selector, "runtime_target_identity_missing"),
  };

  let normalizedOptions;
  try {
    normalizedOptions = normalizeAccountOptionsPayload(accountOptions);
  } catch {
    fail("binance_account_options_invalid");
  }
  const options = normalizedOptions?.binance;
  if (!Array.isArray(options)) fail("binance_account_options_invalid");
  const matches = options.filter((option) => option && typeof option === "object"
    && option.account_scope === accountScope
    && option.account_selector === selector
    && OPTION_IDENTITY_FIELDS.every((field) => option[field] === runtimeServiceIdentity[field])
    && option.runtime_status_target_id === runtimeTargetId);
  if (matches.length !== 1) fail("binance_account_option_not_unique");
  const option = matches[0];
  const sameLifecycleTargets = Object.entries(normalizedOptions)
    .flatMap(([platform, rows]) => rows.map((item) => ({ platform, item })))
    .filter(({ item }) => item.runtime_status_target_id === runtimeTargetId);
  if (sameLifecycleTargets.length !== 1 || sameLifecycleTargets[0].platform !== "binance"
      || sameLifecycleTargets[0].item.key !== option.key) fail("binance_runtime_status_target_not_unique");
  const accountKey = requiredString(option.key, "binance_account_key_missing");
  const targetName = requiredString(option.target_name, "binance_target_name_missing");

  const material = {
    account_scope_sha256: expected.account_scope_sha256,
    approved_application_revision: APPROVED_APPLICATION_REVISION,
    reader_public_revision: readerRevision,
    scope: SOURCE_SCOPE,
  };
  const sourceBindingId = createHash("sha256").update(JSON.stringify(material)).digest("hex");
  return {
    platform: "binance",
    account_key: accountKey,
    account_scope: accountScope,
    target_name: targetName,
    ...runtimeServiceIdentity,
    account_selector: selector,
    target_id: BINANCE_TARGET_ID,
    account_scope_sha256: expected.account_scope_sha256,
    reader_revision: readerRevision,
    approved_application_revision: APPROVED_APPLICATION_REVISION,
    source_binding: { kind: SOURCE_BINDING_KIND, id: sourceBindingId },
  };
}

function defaultCommand(command, args, { input = undefined, cwd = process.cwd(), env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail("protected_command_failed");
  return result.stdout || "";
}

async function githubJson(path, { token, fetchImpl, allowNotFound = false }) {
  let response;
  try {
    response = await fetchImpl(`${GITHUB_API}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    fail("protected_metadata_read_failed");
  }
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) fail("protected_metadata_read_failed");
  try {
    return await response.json();
  } catch {
    fail("protected_metadata_invalid");
  }
}

async function readVariable(repository, name, context, { optional = false } = {}) {
  const record = await githubJson(`/repos/${repository}/actions/variables/${name}`, {
    ...context,
    allowNotFound: optional,
  });
  if (optional && record === null) return null;
  if (record?.name !== name || typeof record.value !== "string") fail("protected_variable_missing");
  return record.value;
}

async function readEnvironmentVariable(repository, environment, name, context, { optional = false } = {}) {
  const record = await githubJson(
    `/repos/${repository}/environments/${environment}/variables/${name}`,
    { ...context, allowNotFound: optional },
  );
  if (optional && record === null) return null;
  if (record?.name !== name || typeof record.value !== "string") fail("protected_variable_missing");
  return record.value;
}

async function assertBinanceFactsReaderDisabled(context) {
  const [repositoryGate, environmentGate] = await Promise.all([
    readVariable(BINANCE_REPOSITORY, BINANCE_ACCOUNT_FACTS_ENABLED_VARIABLE, context),
    readEnvironmentVariable(
      BINANCE_REPOSITORY,
      BINANCE_ENVIRONMENT,
      BINANCE_ACCOUNT_FACTS_ENABLED_VARIABLE,
      context,
      { optional: true },
    ),
  ]);
  if (repositoryGate !== "false") fail("binance_account_facts_repository_gate_not_disabled");
  if (environmentGate !== null && environmentGate !== "false") {
    fail("binance_account_facts_environment_gate_enabled");
  }
}

async function readSecretNames(repository, environment, context) {
  const record = await githubJson(
    `/repos/${repository}/environments/${environment}/secrets?per_page=100`, context,
  );
  if (!Array.isArray(record?.secrets) || record.secrets.some((item) => typeof item?.name !== "string")
      || record.total_count !== record.secrets.length) {
    fail("protected_secret_metadata_invalid");
  }
  return new Set(record.secrets.map((item) => item.name));
}

async function readRequiredSecretMetadata(repository, environment, context) {
  const record = await githubJson(
    `/repos/${repository}/environments/${environment}/secrets?per_page=100`, context,
  );
  if (!Array.isArray(record?.secrets) || record.secrets.some((item) => typeof item?.name !== "string")
      || record.total_count !== record.secrets.length) fail("protected_secret_metadata_invalid");
  const metadata = {};
  for (const name of SECRET_NAMES) {
    const matches = record.secrets.filter((item) => item.name === name);
    if (matches.length !== 1 || typeof matches[0].updated_at !== "string"
        || !Number.isFinite(Date.parse(matches[0].updated_at))) {
      fail("account_facts_secret_pair_missing");
    }
    metadata[name] = matches[0].updated_at;
  }
  return metadata;
}

async function assertRuntimeProductionOnlyEnvironment(context) {
  const environment = await githubJson(
    `/repos/${BINANCE_REPOSITORY}/environments/${BINANCE_ENVIRONMENT}`, context,
  );
  const policies = await githubJson(
    `/repos/${BINANCE_REPOSITORY}/environments/${BINANCE_ENVIRONMENT}/deployment-branch-policies?per_page=100`,
    context,
  );
  const branchPolicy = environment.deployment_branch_policy;
  if (!branchPolicy || branchPolicy.protected_branches !== false
      || branchPolicy.custom_branch_policies !== true
      || !Array.isArray(policies.branch_policies) || policies.branch_policies.length !== 1
      || policies.total_count !== policies.branch_policies.length
      || policies.branch_policies[0]?.name !== "runtime-production"
      || policies.branch_policies[0]?.type !== "branch") {
    fail("binance_environment_policy_mismatch");
  }
}

async function assertReaderRevisionIsTrustedAncestor(
  context,
  readerRevision = BINANCE_ACCOUNT_FACTS_READER_REVISION,
) {
  if (typeof readerRevision !== "string" || !/^[a-f0-9]{40}$/.test(readerRevision)) {
    fail("reader_revision_invalid");
  }
  const compare = await githubJson(
    `/repos/${BINANCE_REPOSITORY}/compare/${readerRevision}...main`, context,
  );
  const ahead = compare?.ahead_by;
  const total = compare?.total_commits;
  const countsMatch = Number.isSafeInteger(ahead) && ahead >= 0
    && Number.isSafeInteger(total) && total >= 0 && ahead === total;
  const relationMatches = compare?.status === "identical"
    ? ahead === 0 && total === 0
    : compare?.status === "ahead" && ahead > 0;
  if (!compare || !relationMatches || !countsMatch
      || compare.base_commit?.sha !== readerRevision
      || compare.merge_base_commit?.sha !== readerRevision
      || compare.behind_by !== 0) {
    fail("reader_revision_not_trusted_main_ancestor");
  }
}

async function readProtectedVariables(context) {
  const names = [
    "RUNTIME_TARGET_JSON",
    "BINANCE_RECONCILIATION_EXPECTED_DIGESTS_JSON",
    "BINANCE_RUNTIME_RELEASE_SHA",
    "RUNTIME_TARGET_ENABLED",
  ];
  const pairs = await Promise.all(names.map(async (name) => [name, await readVariable(BINANCE_REPOSITORY, name, context)]));
  return Object.fromEntries(pairs);
}

function parseJson(text, code) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
    return value;
  } catch {
    fail(code);
  }
}

async function applySecret(repository, name, environment, value, { command, env }) {
  command("gh", ["secret", "set", name, "--repo", repository, "--env", environment], {
    input: value,
    env,
    timeout: COMMAND_TIMEOUT_MS,
  });
}

async function runReaderRotation({ env, fetchImpl, command }) {
  if (env.GITHUB_REPOSITORY !== QRS_REPOSITORY || env.GITHUB_REF !== "refs/heads/main") {
    fail("main_branch_required");
  }
  if (env.BINANCE_FACTS_BOOTSTRAP_APPLY !== "true"
      && env.BINANCE_FACTS_BOOTSTRAP_APPLY !== "false") fail("apply_mode_invalid");
  const oldBindingJson = requiredString(
    env.BINANCE_ACCOUNT_FACTS_BINDING_JSON, "current_binding_missing",
  );
  const oldBinding = parseJson(oldBindingJson, "current_binding_invalid");
  const oldReaderRevision = oldBinding.reader_revision;
  if (typeof oldReaderRevision !== "string" || !/^[a-f0-9]{40}$/.test(oldReaderRevision)) {
    fail("reader_revision_invalid");
  }
  const nextReaderRevision = requiredString(
    env.BINANCE_FACTS_NEXT_READER_REVISION, "reader_revision_missing",
  );
  if (!/^[a-f0-9]{40}$/.test(nextReaderRevision)
      || nextReaderRevision === oldReaderRevision) {
    fail("reader_revision_invalid");
  }
  const ghToken = requiredString(env.GH_TOKEN, "github_token_unavailable");
  const namespaceId = requiredString(env.STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID, "kv_namespace_missing");
  if (!env.CLOUDFLARE_API_TOKEN && !env.CLOUDFLARE_WRANGLER_CONFIG_TOML) {
    fail("cloudflare_credentials_missing");
  }
  const context = { token: ghToken, fetchImpl };

  await assertRuntimeProductionOnlyEnvironment(context);
  await assertReaderRevisionIsTrustedAncestor(context, oldReaderRevision);
  await assertReaderRevisionIsTrustedAncestor(context, nextReaderRevision);
  await assertBinanceFactsReaderDisabled(context);

  const [qrsSecretMetadata, binanceSecretMetadata, variables] = await Promise.all([
    readRequiredSecretMetadata(QRS_REPOSITORY, QRS_ENVIRONMENT, context),
    readRequiredSecretMetadata(BINANCE_REPOSITORY, BINANCE_ENVIRONMENT, context),
    readProtectedVariables(context),
  ]);
  const currentReaderRevision = await readVariable(
    BINANCE_REPOSITORY,
    "BINANCE_ACCOUNT_FACTS_READER_REVISION",
    context,
  );
  if (currentReaderRevision !== oldReaderRevision) {
    fail("reader_revision_conflict");
  }
  const accountOptions = parseJson(command("npx", ["--yes", "wrangler@4.106.0", "kv", "key", "get", "account_options",
    "--namespace-id", namespaceId, "--remote"], {
    cwd: "web/strategy-switch-console", env, timeout: COMMAND_TIMEOUT_MS,
  }), "account_options_invalid");
  const oldExpected = buildBinanceFactsBinding({
    variables,
    accountOptions,
    readerRevision: oldReaderRevision,
  });
  if (!isDeepStrictEqual(oldBinding, oldExpected)) fail("current_binding_conflict");
  const nextBinding = buildBinanceFactsBinding({
    variables,
    accountOptions,
    readerRevision: nextReaderRevision,
  });
  const expectedNextBinding = {
    ...oldBinding,
    reader_revision: nextReaderRevision,
    source_binding: { ...oldBinding.source_binding, id: nextBinding.source_binding.id },
  };
  if (!isDeepStrictEqual(nextBinding, expectedNextBinding)) fail("binding_rotation_scope_changed");

  if (env.BINANCE_FACTS_BOOTSTRAP_APPLY !== "true") {
    return { status: "rotation_preview", match_count: 1, writes: 0 };
  }

  const bindingJson = JSON.stringify(nextBinding);
  const targets = [
    {
      repository: QRS_REPOSITORY,
      environment: QRS_ENVIRONMENT,
      baseline: qrsSecretMetadata,
    },
    {
      repository: BINANCE_REPOSITORY,
      environment: BINANCE_ENVIRONMENT,
      baseline: binanceSecretMetadata,
    },
  ];
  for (const target of targets) {
    const name = SECRET_NAMES[0];
    await applySecret(target.repository, name, target.environment, bindingJson, { command, env });
    const metadata = await readRequiredSecretMetadata(target.repository, target.environment, context);
    if (Date.parse(metadata[name]) <= Date.parse(target.baseline[name])) {
      fail("binding_secret_metadata_readback_failed");
    }
    if (metadata[SECRET_NAMES[1]] !== target.baseline[SECRET_NAMES[1]]) {
      fail("sync_token_metadata_changed");
    }
  }

  command("gh", ["variable", "set", "BINANCE_ACCOUNT_FACTS_READER_REVISION", "--repo", BINANCE_REPOSITORY,
    "--body", nextReaderRevision], { env, timeout: COMMAND_TIMEOUT_MS });
  const readerRevisionReadback = await readVariable(
    BINANCE_REPOSITORY,
    "BINANCE_ACCOUNT_FACTS_READER_REVISION",
    context,
  );
  if (readerRevisionReadback !== nextReaderRevision) fail("reader_revision_readback_failed");
  return { status: "rotation_applied", binding_secret_write_count: 2, metadata_readback_count: 2, reader_revision_updated: true };
}

export async function runBootstrap({
  env = process.env,
  fetchImpl = fetch,
  command = defaultCommand,
  randomToken = () => randomBytes(32).toString("base64url"),
} = {}) {
  const rotationMode = env.BINANCE_FACTS_BOOTSTRAP_ROTATE_READER ?? "false";
  if (rotationMode !== "true" && rotationMode !== "false") fail("reader_rotation_mode_invalid");
  if (rotationMode === "true") return runReaderRotation({ env, fetchImpl, command });
  if (env.GITHUB_REPOSITORY !== QRS_REPOSITORY || env.GITHUB_REF !== "refs/heads/main") {
    fail("main_branch_required");
  }
  if (env.BINANCE_FACTS_BOOTSTRAP_APPLY !== "true"
      && env.BINANCE_FACTS_BOOTSTRAP_APPLY !== "false") fail("apply_mode_invalid");
  const ghToken = requiredString(env.GH_TOKEN, "github_token_unavailable");
  const namespaceId = requiredString(env.STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID, "kv_namespace_missing");
  if (!env.CLOUDFLARE_API_TOKEN && !env.CLOUDFLARE_WRANGLER_CONFIG_TOML) {
    fail("cloudflare_credentials_missing");
  }
  const context = { token: ghToken, fetchImpl };

  await assertRuntimeProductionOnlyEnvironment(context);
  await assertReaderRevisionIsTrustedAncestor(context);
  // Existence is checked, but neither secret value is ever requested or read back.
  const [qrsSecrets, binanceSecrets, variables] = await Promise.all([
    readSecretNames(QRS_REPOSITORY, QRS_ENVIRONMENT, context),
    readSecretNames(BINANCE_REPOSITORY, BINANCE_ENVIRONMENT, context),
    readProtectedVariables(context),
  ]);
  if (SECRET_NAMES.some((name) => qrsSecrets.has(name) || binanceSecrets.has(name))) {
    fail("account_facts_secret_already_exists");
  }
  const existingReaderRevision = await readVariable(
    BINANCE_REPOSITORY,
    "BINANCE_ACCOUNT_FACTS_READER_REVISION",
    context,
    { optional: true },
  );
  if (existingReaderRevision !== null
      && existingReaderRevision !== BINANCE_ACCOUNT_FACTS_READER_REVISION) {
    fail("reader_revision_conflict");
  }
  const accountOptionsText = command("npx", ["--yes", "wrangler@4.106.0", "kv", "key", "get", "account_options",
    "--namespace-id", namespaceId, "--remote"], {
    cwd: "web/strategy-switch-console", env, timeout: COMMAND_TIMEOUT_MS,
  });
  const accountOptions = parseJson(accountOptionsText, "account_options_invalid");
  const binding = buildBinanceFactsBinding({ variables, accountOptions });
  if (env.BINANCE_FACTS_BOOTSTRAP_APPLY !== "true") return { status: "preview", match_count: 1, writes: 0 };

  const bindingJson = JSON.stringify(binding);
  const token = randomToken();
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,}$/.test(token)) fail("token_generation_failed");
  for (const repository of [QRS_REPOSITORY, BINANCE_REPOSITORY]) {
    await applySecret(repository, SECRET_NAMES[0], repository === QRS_REPOSITORY ? QRS_ENVIRONMENT : BINANCE_ENVIRONMENT,
      bindingJson, { command, env });
    await applySecret(repository, SECRET_NAMES[1], repository === QRS_REPOSITORY ? QRS_ENVIRONMENT : BINANCE_ENVIRONMENT,
      token, { command, env });
  }
  const readerRevisionSet = existingReaderRevision === null;
  if (readerRevisionSet) {
    command("gh", ["variable", "set", "BINANCE_ACCOUNT_FACTS_READER_REVISION", "--repo", BINANCE_REPOSITORY,
      "--body", BINANCE_ACCOUNT_FACTS_READER_REVISION], { env, timeout: COMMAND_TIMEOUT_MS });
  }
  return { status: "applied", match_count: 1, secret_write_count: 4, reader_revision_set: readerRevisionSet };
}

async function main() {
  try {
    const result = await runBootstrap();
    process.stdout.write(Object.entries(result).map(([key, value]) => `${key}=${value}`).join(" ") + "\n");
    return 0;
  } catch (error) {
    const code = /^[a-z0-9_]+$/.test(error?.code || "") ? error.code : "bootstrap_failed";
    process.stdout.write(`status=blocked reason=${code}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
