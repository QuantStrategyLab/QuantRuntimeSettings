import assert from "node:assert/strict";
import { buildBinanceFactsBinding, runBootstrap } from "../scripts/bootstrap_binance_account_facts.mjs";
import { assertBinanceFactsSourceBinding, normalizeBinanceFactsBinding } from "../web/strategy-switch-console/binance_account_facts.js";

const reader = "a7bf700c6b85bd20dbc6fb0b2962adc51006c859";
const app = "8cb56617115fa45028e34d788e71884b6a303d77";
const selector = "synthetic-account-selector";
const scopeHash = "b".repeat(64);
const runtimeTarget = {
  platform_id: "binance",
  strategy_profile: "crypto_live_pool_rotation",
  service_name: "synthetic-service",
  deployment_selector: "synthetic-deployment",
  account_selector: [selector],
  account_scope: "synthetic-account-scope",
  execution_mode: "dry_run",
  dry_run_only: true,
};
const accountOption = {
  key: "synthetic-wallet",
  target_name: runtimeTarget.target_name,
  service_name: runtimeTarget.service_name,
  deployment_selector: runtimeTarget.deployment_selector,
  account_selector: selector,
  account_scope: runtimeTarget.account_scope,
  runtime_status_target_id: `binance.${runtimeTarget.strategy_profile}`,
};
const variables = {
  RUNTIME_TARGET_JSON: JSON.stringify(runtimeTarget),
  BINANCE_RECONCILIATION_EXPECTED_DIGESTS_JSON: JSON.stringify({ account_scope_sha256: scopeHash }),
  BINANCE_RUNTIME_RELEASE_SHA: app,
  RUNTIME_TARGET_ENABLED: "false",
};
const binding = buildBinanceFactsBinding({ variables, accountOptions: { binance: [accountOption] } });
assert.deepEqual(Object.keys(binding).sort(), [
  "account_key", "account_scope", "account_scope_sha256", "account_selector", "approved_application_revision",
  "deployment_selector", "platform", "reader_revision", "service_name", "source_binding", "target_id", "target_name",
].sort());
assert.equal(binding.platform, "binance");
assert.equal(binding.reader_revision, reader);
assert.equal(binding.approved_application_revision, app);
assert.equal(binding.account_scope_sha256, scopeHash);
assert.equal(binding.target_id, "binance-homepage");
assert.equal(binding.source_binding.kind, "binance_readonly_scope_revision");
assert.match(binding.source_binding.id, /^[a-f0-9]{64}$/);
assert.equal(normalizeBinanceFactsBinding(binding), binding);
await assertBinanceFactsSourceBinding(binding);

const fixture = {
  ...variables,
  GITHUB_REPOSITORY: "QuantStrategyLab/QuantRuntimeSettings",
  GITHUB_REF: "refs/heads/main",
  GH_TOKEN: "synthetic-github-token",
  STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: "synthetic-namespace",
  CLOUDFLARE_API_TOKEN: "synthetic-cloudflare-token",
  BINANCE_FACTS_BOOTSTRAP_APPLY: "false",
};
const accountOptionsText = JSON.stringify({ binance: [accountOption] });
const githubReads = [];
const secretNames = new Map([
  ["QuantStrategyLab/QuantRuntimeSettings", new Set()],
  ["QuantStrategyLab/BinancePlatform", new Set()],
]);
const existingVariables = new Map(Object.entries(variables));
const writes = [];

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeFetch({ policy = "runtime-production-only", ancestor = true } = {}) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    githubReads.push({ pathname, method: options.method || "GET" });
    if (pathname.endsWith("/environments/binance-runtime/deployment-branch-policies")) {
      const branchPolicies = policy === "runtime-production-only"
        ? [{ name: "runtime-production", type: "branch" }] : [];
      return response({ branch_policies: branchPolicies, total_count: branchPolicies.length });
    }
    if (pathname.endsWith("/environments/binance-runtime")) {
      return response({ deployment_branch_policy: policy === "runtime-production-only"
        ? { protected_branches: false, custom_branch_policies: true }
        : { protected_branches: true, custom_branch_policies: false } });
    }
    if (pathname.endsWith(`/compare/${reader}...main`)) {
      return response(ancestor ? { status: "ahead", base_commit: { sha: reader },
        head_commit: { sha: "a".repeat(40) }, ahead_by: 12, behind_by: 0 }
        : { status: "behind", base_commit: { sha: reader },
          head_commit: { sha: "a".repeat(40) }, ahead_by: 0, behind_by: 1 });
    }
    if (pathname.endsWith("/environments/runtime-strategy-switch/secrets")) {
      const secrets = [...secretNames.get("QuantStrategyLab/QuantRuntimeSettings")].map(name => ({ name }));
      return response({ secrets, total_count: secrets.length });
    }
    if (pathname.endsWith("/environments/binance-runtime/secrets")) {
      const secrets = [...secretNames.get("QuantStrategyLab/BinancePlatform")].map(name => ({ name }));
      return response({ secrets, total_count: secrets.length });
    }
    const variable = pathname.match(/\/repos\/QuantStrategyLab\/BinancePlatform\/actions\/variables\/([^/]+)$/)?.[1];
    if (variable) {
      if (!existingVariables.has(variable)) return response({ message: "Not Found" }, 404);
      return response({ name: variable, value: existingVariables.get(variable) });
    }
    throw new Error("unexpected synthetic API request");
  };
}

function makeCommand({ failAt = -1 } = {}) {
  return (command, args, options = {}) => {
    writes.push({ command, args, input: options.input, timeout: options.timeout });
    if (writes.length === failAt) {
      const error = new Error("synthetic command failure");
      error.code = "protected_command_failed";
      throw error;
    }
    if (command === "npx") return accountOptionsText;
    return "";
  };
}

const preview = await runBootstrap({
  env: fixture,
  fetchImpl: makeFetch(),
  command: makeCommand(),
  randomToken: () => { throw new Error("preview must not generate a token"); },
});
assert.deepEqual(preview, { status: "preview", match_count: 1, writes: 0 });
assert.equal(writes.length, 1);
assert.equal(writes[0].command, "npx");
assert.ok(githubReads.every(item => item.method === "GET"));
assert.doesNotMatch(JSON.stringify(preview), /synthetic-account-selector|synthetic-wallet|synthetic-account-scope/);

writes.length = 0;
githubReads.length = 0;
const applied = await runBootstrap({
  env: { ...fixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand(),
  randomToken: () => "synthetic-new-one-purpose-sync-token-00000000000000000000",
});
assert.deepEqual(applied, { status: "applied", match_count: 1, secret_write_count: 4, reader_revision_set: true });
const secretWrites = writes.filter(item => item.command === "gh" && item.args[0] === "secret");
assert.equal(secretWrites.length, 4);
assert.deepEqual(secretWrites.map(item => item.args.at(-1)), [
  "runtime-strategy-switch", "runtime-strategy-switch", "binance-runtime", "binance-runtime",
]);
assert.equal(secretWrites[0].input, secretWrites[2].input);
assert.equal(secretWrites[1].input, secretWrites[3].input);
assert.equal(JSON.parse(secretWrites[0].input).reader_revision, reader);
assert.equal(JSON.parse(secretWrites[0].input).approved_application_revision, app);
assert.equal(secretWrites[1].input, "synthetic-new-one-purpose-sync-token-00000000000000000000");
const variableWrite = writes.find(item => item.command === "gh" && item.args[0] === "variable");
assert.ok(variableWrite);
assert.equal(variableWrite.args.at(-1), reader);
assert.equal(writes.filter(item => item.command === "gh" && item.args[0] === "variable").length, 1);
assert.ok(writes.filter(item => item.command === "gh").every(item => !item.args.includes(secretWrites[1].input)
  && !item.args.some(arg => String(arg).includes(selector))));
assert.equal(writes.filter(item => item.command === "npx").length, 1);
assert.ok(writes.every(item => item.timeout === 20_000));
assert.doesNotMatch(JSON.stringify(applied), /synthetic-account-selector|synthetic-wallet|synthetic-new-one-purpose/);

existingVariables.set("BINANCE_ACCOUNT_FACTS_READER_REVISION", reader);
writes.length = 0;
const alreadyPinned = await runBootstrap({
  env: { ...fixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand(),
  randomToken: () => "synthetic-new-one-purpose-sync-token-00000000000000000000",
});
assert.deepEqual(alreadyPinned, { status: "applied", match_count: 1, secret_write_count: 4, reader_revision_set: false });
assert.equal(writes.filter(item => item.command === "gh" && item.args[0] === "variable").length, 0);
existingVariables.delete("BINANCE_ACCOUNT_FACTS_READER_REVISION");

for (const [changedVariables, changedOptions, code] of [
  [{ ...variables, BINANCE_RUNTIME_RELEASE_SHA: "a".repeat(40) }, { binance: [accountOption] }, "runtime_application_revision_mismatch"],
  [variables, { binance: [{ ...accountOption, service_name: "different-service" }] }, "binance_account_option_not_unique"],
  [{ ...variables, RUNTIME_TARGET_JSON: JSON.stringify({ ...runtimeTarget, account_selector: [selector, "second-selector"] }) },
    { binance: [accountOption] }, "runtime_selector_invalid"],
  [{ ...variables, RUNTIME_TARGET_JSON: JSON.stringify({ ...runtimeTarget, account_selector: selector }) },
    { binance: [accountOption] }, "runtime_selector_invalid"],
  [variables, { binance: [accountOption, { ...accountOption, key: "second-wallet" }] },
    "binance_account_option_not_unique"],
  [variables, { binance: [accountOption], schwab: [{ ...accountOption, key: "other", runtime_status_target_id:
    accountOption.runtime_status_target_id }] }, "binance_runtime_status_target_not_unique"],
]) {
  assert.throws(() => buildBinanceFactsBinding({ variables: changedVariables, accountOptions: changedOptions }),
    error => error.code === code);
}

writes.length = 0;
await assert.rejects(runBootstrap({
  env: { ...fixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch({ policy: "not-runtime-production-only" }),
  command: makeCommand(),
  randomToken: () => "synthetic-new-one-purpose-sync-token-00000000000000000000",
}), error => error.code === "binance_environment_policy_mismatch");
assert.equal(writes.length, 0);

writes.length = 0;
await assert.rejects(runBootstrap({
  env: { ...fixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch({ ancestor: false }),
  command: makeCommand(),
  randomToken: () => "synthetic-new-one-purpose-sync-token-00000000000000000000",
}), error => error.code === "reader_revision_not_trusted_main_ancestor");
assert.equal(writes.length, 0);

writes.length = 0;
existingVariables.set("BINANCE_ACCOUNT_FACTS_READER_REVISION", "c".repeat(40));
await assert.rejects(runBootstrap({
  env: { ...fixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand(),
  randomToken: () => "synthetic-new-one-purpose-sync-token-00000000000000000000",
}), error => error.code === "reader_revision_conflict");
assert.equal(writes.length, 0);
existingVariables.delete("BINANCE_ACCOUNT_FACTS_READER_REVISION");

writes.length = 0;
await assert.rejects(runBootstrap({
  env: { ...fixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand({ failAt: 3 }),
  randomToken: () => "synthetic-new-one-purpose-sync-token-00000000000000000000",
}), error => error.code === "protected_command_failed");
assert.equal(writes.filter(item => item.command === "gh" && item.args[0] === "secret").length, 2);

secretNames.get("QuantStrategyLab/BinancePlatform").add("BINANCE_ACCOUNT_FACTS_SYNC_TOKEN");
writes.length = 0;
await assert.rejects(runBootstrap({
  env: { ...fixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand(),
  randomToken: () => "synthetic-new-one-purpose-sync-token-00000000000000000000",
}), error => error.code === "account_facts_secret_already_exists");
assert.equal(writes.length, 0);

console.log("Binance account-facts bootstrap preview/apply boundaries and synthetic identity checks PASS");
