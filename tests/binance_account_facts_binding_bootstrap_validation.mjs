import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildBinanceFactsBinding, runBootstrap } from "../scripts/bootstrap_binance_account_facts.mjs";
import { assertBinanceFactsSourceBinding, normalizeBinanceFactsBinding } from "../web/strategy-switch-console/binance_account_facts.js";

const reader = "4ca436a8910eecd35335f2d04dc69cfb9be4a327";
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
  BINANCE_FACTS_BOOTSTRAP_ROTATE_READER: "false",
  BINANCE_FACTS_BOOTSTRAP_APPLY: "false",
};
const accountOptionsText = JSON.stringify({ binance: [accountOption] });
const githubReads = [];
const secretNames = new Map([
  ["QuantStrategyLab/QuantRuntimeSettings", new Set()],
  ["QuantStrategyLab/BinancePlatform", new Set()],
]);
const existingVariables = new Map(Object.entries(variables));
existingVariables.set("BINANCE_ACCOUNT_FACTS_ENABLED", "false");
const environmentVariables = new Map();
const secretUpdatedAt = new Map([
  ["QuantStrategyLab/QuantRuntimeSettings", new Map()],
  ["QuantStrategyLab/BinancePlatform", new Map()],
]);
const writes = [];

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeFetch({ policy = "runtime-production-only", comparison = "ahead", untrustedRevision = null } = {}) {
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
    const comparedRevision = pathname.match(/\/compare\/([a-f0-9]{40})\.\.\.main$/)?.[1];
    if (comparedRevision) {
      if (comparedRevision === untrustedRevision) return response({
        status: "behind", base_commit: { sha: comparedRevision }, merge_base_commit: { sha: "a".repeat(40) },
        ahead_by: 0, behind_by: 1, total_commits: 1,
      });
      if (comparison === "identical") return response({
        status: "identical", base_commit: { sha: comparedRevision }, merge_base_commit: { sha: comparedRevision },
        ahead_by: 0, behind_by: 0, total_commits: 0,
      });
      if (comparison === "wrong-merge-base") return response({
        status: "ahead", base_commit: { sha: comparedRevision }, merge_base_commit: { sha: "a".repeat(40) },
        ahead_by: 12, behind_by: 0, total_commits: 12,
      });
      if (comparison === "inconsistent-counts") return response({
        status: "ahead", base_commit: { sha: comparedRevision }, merge_base_commit: { sha: comparedRevision },
        ahead_by: 12, behind_by: 0, total_commits: 11,
      });
      if (comparison === "behind") return response({
        status: "behind", base_commit: { sha: comparedRevision }, merge_base_commit: { sha: "a".repeat(40) },
        ahead_by: 0, behind_by: 1, total_commits: 1,
      });
      return response({
        status: "ahead", base_commit: { sha: comparedRevision }, merge_base_commit: { sha: comparedRevision },
        ahead_by: 12, behind_by: 0, total_commits: 12,
      });
    }
    if (pathname.endsWith("/environments/runtime-strategy-switch/secrets")) {
      const repository = "QuantStrategyLab/QuantRuntimeSettings";
      const secrets = [...secretNames.get(repository)].map(name => ({
        name, updated_at: secretUpdatedAt.get(repository).get(name) || "2026-10-01T00:00:00Z",
      }));
      return response({ secrets, total_count: secrets.length });
    }
    if (pathname.endsWith("/environments/binance-runtime/secrets")) {
      const repository = "QuantStrategyLab/BinancePlatform";
      const secrets = [...secretNames.get(repository)].map(name => ({
        name, updated_at: secretUpdatedAt.get(repository).get(name) || "2026-10-01T00:00:00Z",
      }));
      return response({ secrets, total_count: secrets.length });
    }
    const binanceEnvironmentVariable = pathname.match(
      /\/repos\/QuantStrategyLab\/BinancePlatform\/environments\/binance-runtime\/variables\/([^/]+)$/,
    )?.[1];
    if (binanceEnvironmentVariable) {
      if (!environmentVariables.has(binanceEnvironmentVariable)) return response({ message: "Not Found" }, 404);
      return response({ name: binanceEnvironmentVariable, value: environmentVariables.get(binanceEnvironmentVariable) });
    }
    const variable = pathname.match(/\/repos\/QuantStrategyLab\/BinancePlatform\/actions\/variables\/([^/]+)$/)?.[1];
    if (variable) {
      if (!existingVariables.has(variable)) return response({ message: "Not Found" }, 404);
      return response({ name: variable, value: existingVariables.get(variable) });
    }
    throw new Error("unexpected synthetic API request");
  };
}

function makeCommand({ failAt = -1, modelSecretWrites = false } = {}) {
  return (command, args, options = {}) => {
    writes.push({ command, args, input: options.input, timeout: options.timeout });
    if (writes.length === failAt) {
      const error = new Error("synthetic command failure");
      error.code = "protected_command_failed";
      throw error;
    }
    if (command === "npx") return accountOptionsText;
    if (modelSecretWrites && command === "gh" && args[0] === "secret" && args[1] === "set") {
      const name = args[2];
      const repository = args[args.indexOf("--repo") + 1];
      secretNames.get(repository).add(name);
      secretUpdatedAt.get(repository).set(name,
        new Date(Date.parse("2026-10-02T00:00:00Z") + writes.length * 1000).toISOString());
    }
    if (command === "gh" && args[0] === "variable" && args[1] === "set") {
      const name = args[2];
      const value = args[args.indexOf("--body") + 1];
      const repository = args[args.indexOf("--repo") + 1];
      if (repository === "QuantStrategyLab/BinancePlatform") existingVariables.set(name, value);
    }
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

const identicalPreview = await runBootstrap({
  env: fixture,
  fetchImpl: makeFetch({ comparison: "identical" }),
  command: makeCommand(),
  randomToken: () => { throw new Error("preview must not generate a token"); },
});
assert.deepEqual(identicalPreview, { status: "preview", match_count: 1, writes: 0 });

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
  fetchImpl: makeFetch({ comparison: "behind" }),
  command: makeCommand(),
  randomToken: () => "synthetic-new-one-purpose-sync-token-00000000000000000000",
}), error => error.code === "reader_revision_not_trusted_main_ancestor");
assert.equal(writes.length, 0);

for (const comparison of ["wrong-merge-base", "inconsistent-counts"]) {
  writes.length = 0;
  await assert.rejects(runBootstrap({
    env: { ...fixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
    fetchImpl: makeFetch({ comparison }),
    command: makeCommand(),
    randomToken: () => "synthetic-new-one-purpose-sync-token-00000000000000000000",
  }), error => error.code === "reader_revision_not_trusted_main_ancestor");
  assert.equal(writes.length, 0);
}

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

const nextReader = "d".repeat(40);
const rotationFixture = {
  ...fixture,
  BINANCE_FACTS_BOOTSTRAP_ROTATE_READER: "true",
  BINANCE_FACTS_NEXT_READER_REVISION: nextReader,
  BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(binding),
};
existingVariables.set("BINANCE_ACCOUNT_FACTS_READER_REVISION", reader);
const bindingSecret = "BINANCE_ACCOUNT_FACTS_BINDING_JSON";
const syncTokenSecret = "BINANCE_ACCOUNT_FACTS_SYNC_TOKEN";
for (const repository of ["QuantStrategyLab/QuantRuntimeSettings", "QuantStrategyLab/BinancePlatform"]) {
  secretNames.get(repository).add(bindingSecret);
  secretNames.get(repository).add(syncTokenSecret);
  secretUpdatedAt.get(repository).set(bindingSecret, "2026-09-30T00:00:00Z");
  secretUpdatedAt.get(repository).set(syncTokenSecret, "2026-09-30T00:00:00Z");
}

writes.length = 0;
const rotationPreview = await runBootstrap({
  env: rotationFixture,
  fetchImpl: makeFetch(),
  command: makeCommand(),
  randomToken: () => { throw new Error("reader rotation must not generate a token"); },
});
assert.deepEqual(rotationPreview, { status: "rotation_preview", match_count: 1, writes: 0 });
assert.equal(writes.filter(item => item.command === "gh").length, 0);
assert.equal(writes.filter(item => item.command === "npx").length, 1);
assert.ok(githubReads.every(item => item.method === "GET"));
assert.doesNotMatch(JSON.stringify(rotationPreview), /synthetic-account-selector|synthetic-wallet/);

writes.length = 0;
await assert.rejects(runBootstrap({
  env: { ...rotationFixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true", BINANCE_ACCOUNT_FACTS_BINDING_JSON:
    JSON.stringify({ ...binding, account_scope: "different-synthetic-scope" }) },
  fetchImpl: makeFetch(),
  command: makeCommand(),
}), error => error.code === "current_binding_conflict");
assert.equal(writes.filter(item => item.command === "gh").length, 0);

writes.length = 0;
existingVariables.set("BINANCE_ACCOUNT_FACTS_ENABLED", "true");
await assert.rejects(runBootstrap({
  env: { ...rotationFixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand(),
}), error => error.code === "binance_account_facts_repository_gate_not_disabled");
assert.equal(writes.filter(item => item.command === "gh").length, 0);
existingVariables.set("BINANCE_ACCOUNT_FACTS_ENABLED", "false");

environmentVariables.set("BINANCE_ACCOUNT_FACTS_ENABLED", "true");
await assert.rejects(runBootstrap({
  env: { ...rotationFixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand(),
}), error => error.code === "binance_account_facts_environment_gate_enabled");
assert.equal(writes.filter(item => item.command === "gh").length, 0);
environmentVariables.clear();

await assert.rejects(runBootstrap({
  env: { ...rotationFixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch({ untrustedRevision: nextReader }),
  command: makeCommand(),
}), error => error.code === "reader_revision_not_trusted_main_ancestor");
assert.equal(writes.filter(item => item.command === "gh").length, 0);

secretNames.get("QuantStrategyLab/BinancePlatform").delete(syncTokenSecret);
await assert.rejects(runBootstrap({
  env: { ...rotationFixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand(),
}), error => error.code === "account_facts_secret_pair_missing");
assert.equal(writes.filter(item => item.command === "gh").length, 0);
secretNames.get("QuantStrategyLab/BinancePlatform").add(syncTokenSecret);

existingVariables.set("BINANCE_ACCOUNT_FACTS_READER_REVISION", "c".repeat(40));
await assert.rejects(runBootstrap({
  env: { ...rotationFixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand(),
}), error => error.code === "reader_revision_conflict");
assert.equal(writes.filter(item => item.command === "gh").length, 0);
existingVariables.set("BINANCE_ACCOUNT_FACTS_READER_REVISION", reader);

writes.length = 0;
await assert.rejects(runBootstrap({
  env: { ...rotationFixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand({ failAt: 3, modelSecretWrites: true }),
}), error => error.code === "protected_command_failed");
assert.equal(writes.filter(item => item.command === "gh" && item.args[0] === "secret").length, 2);
assert.equal(writes.filter(item => item.command === "gh" && item.args[0] === "variable").length, 0);
assert.equal(secretUpdatedAt.get("QuantStrategyLab/QuantRuntimeSettings").get(bindingSecret),
  "2026-10-02T00:00:02.000Z");
assert.equal(existingVariables.get("BINANCE_ACCOUNT_FACTS_READER_REVISION"), reader);

for (const repository of ["QuantStrategyLab/QuantRuntimeSettings", "QuantStrategyLab/BinancePlatform"]) {
  secretUpdatedAt.get(repository).set(bindingSecret, "2026-09-30T00:00:00Z");
}
writes.length = 0;
const rotated = await runBootstrap({
  env: { ...rotationFixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand({ modelSecretWrites: true }),
  randomToken: () => { throw new Error("reader rotation must not generate a token"); },
});
assert.deepEqual(rotated, {
  status: "rotation_applied", binding_secret_write_count: 2, metadata_readback_count: 2,
  reader_revision_updated: true,
});
const rotationWrites = writes.filter(item => item.command === "gh");
assert.deepEqual(rotationWrites.map(item => item.args[0]), ["secret", "secret", "variable"]);
assert.deepEqual(rotationWrites.slice(0, 2).map(item => item.args[2]), [bindingSecret, bindingSecret]);
assert.deepEqual(rotationWrites.slice(0, 2).map(item => item.args[item.args.indexOf("--env") + 1]),
  ["runtime-strategy-switch", "binance-runtime"]);
assert.equal(rotationWrites[0].input, rotationWrites[1].input);
assert.equal(JSON.parse(rotationWrites[0].input).reader_revision, nextReader);
assert.equal(JSON.parse(rotationWrites[0].input).source_binding.id === binding.source_binding.id, false);
assert.equal(rotationWrites.at(-1).args[2], "BINANCE_ACCOUNT_FACTS_READER_REVISION");
assert.equal(rotationWrites.at(-1).args.at(-1), nextReader);
assert.ok(writes.every(item => item.timeout === 20_000));
assert.ok(rotationWrites.every(item => !item.args.some(argument => String(argument).includes(selector))));
assert.doesNotMatch(JSON.stringify(rotated), /synthetic-account-selector|synthetic-wallet|synthetic-scope/);
assert.equal(existingVariables.get("BINANCE_ACCOUNT_FACTS_READER_REVISION"), nextReader);
for (const repository of ["QuantStrategyLab/QuantRuntimeSettings", "QuantStrategyLab/BinancePlatform"]) {
  assert.equal(secretUpdatedAt.get(repository).get(syncTokenSecret), "2026-09-30T00:00:00Z");
  assert.ok(Date.parse(secretUpdatedAt.get(repository).get(bindingSecret)) > Date.parse("2026-09-30T00:00:00Z"));
}

const adoptedReader = "2e709fa75ffa2095d3e29873fe2460b003fc6838";
const subsequentReader = "e".repeat(40);
const adoptedBinding = buildBinanceFactsBinding({
  variables,
  accountOptions: { binance: [accountOption] },
  readerRevision: adoptedReader,
});
const adoptedRotationFixture = {
  ...rotationFixture,
  BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(adoptedBinding),
  BINANCE_FACTS_NEXT_READER_REVISION: subsequentReader,
};
existingVariables.set("BINANCE_ACCOUNT_FACTS_READER_REVISION", adoptedReader);
for (const repository of ["QuantStrategyLab/QuantRuntimeSettings", "QuantStrategyLab/BinancePlatform"]) {
  secretUpdatedAt.get(repository).set(bindingSecret, "2026-09-30T00:00:00Z");
  secretUpdatedAt.get(repository).set(syncTokenSecret, "2026-09-30T00:00:00Z");
}
writes.length = 0;
const adoptedPreview = await runBootstrap({
  env: adoptedRotationFixture,
  fetchImpl: makeFetch(),
  command: makeCommand(),
});
assert.deepEqual(adoptedPreview, { status: "rotation_preview", match_count: 1, writes: 0 });
assert.equal(writes.filter(item => item.command === "gh").length, 0);
assert.ok(githubReads.some(item => item.pathname.includes(`/compare/${adoptedReader}...main`)));

writes.length = 0;
await assert.rejects(runBootstrap({
  env: { ...adoptedRotationFixture, BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify({
    ...adoptedBinding, reader_revision: "f".repeat(40),
  }) },
  fetchImpl: makeFetch({ untrustedRevision: "f".repeat(40) }),
  command: makeCommand(),
}), error => error.code === "reader_revision_not_trusted_main_ancestor");
assert.equal(writes.filter(item => item.command === "gh").length, 0);

writes.length = 0;
existingVariables.set("BINANCE_ACCOUNT_FACTS_READER_REVISION", "c".repeat(40));
await assert.rejects(runBootstrap({
  env: { ...adoptedRotationFixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand({ modelSecretWrites: true }),
}), error => error.code === "reader_revision_conflict");
assert.equal(writes.filter(item => item.command === "gh").length, 0);
existingVariables.set("BINANCE_ACCOUNT_FACTS_READER_REVISION", adoptedReader);

for (const repository of ["QuantStrategyLab/QuantRuntimeSettings", "QuantStrategyLab/BinancePlatform"]) {
  secretUpdatedAt.get(repository).set(bindingSecret, "2026-09-30T00:00:00Z");
}
writes.length = 0;
const adoptedRotation = await runBootstrap({
  env: { ...adoptedRotationFixture, BINANCE_FACTS_BOOTSTRAP_APPLY: "true" },
  fetchImpl: makeFetch(),
  command: makeCommand({ modelSecretWrites: true }),
  randomToken: () => { throw new Error("reader rotation must not generate a token"); },
});
assert.deepEqual(adoptedRotation, {
  status: "rotation_applied", binding_secret_write_count: 2, metadata_readback_count: 2,
  reader_revision_updated: true,
});
assert.equal(JSON.parse(writes.filter(item => item.command === "gh" && item.args[0] === "secret")[0].input)
  .reader_revision, subsequentReader);
assert.equal(existingVariables.get("BINANCE_ACCOUNT_FACTS_READER_REVISION"), subsequentReader);

const bootstrapWorkflow = readFileSync(new URL("../.github/workflows/bootstrap-binance-account-facts.yml", import.meta.url),
  "utf8");
assert.match(bootstrapWorkflow, /rotate_reader:[\s\S]*?default: false/);
assert.match(bootstrapWorkflow, /BINANCE_FACTS_BOOTSTRAP_ROTATE_READER: \$\{\{ inputs\.rotate_reader \}\}/);
assert.match(bootstrapWorkflow, /BINANCE_FACTS_NEXT_READER_REVISION: \$\{\{ inputs\.reader_revision \}\}/);
assert.match(bootstrapWorkflow,
  /BINANCE_ACCOUNT_FACTS_BINDING_JSON: \$\{\{ inputs\.rotate_reader && secrets\.BINANCE_ACCOUNT_FACTS_BINDING_JSON \|\| '' \}\}/);

console.log("Binance account-facts bootstrap preview/apply boundaries and synthetic identity checks PASS");
