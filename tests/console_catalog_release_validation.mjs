import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  catalogReleaseDecision,
  catalogSyncProjection,
  readCatalogAsset,
} from "../web/strategy-switch-console/catalog_release.js";

const profile = {
  profile: "example",
  label: "中文名",
  label_en: "English",
  runtime_enabled: false,
  lifecycle_stage: "research_active",
  can_switch_live: false,
  allowed_execution_modes: ["paper", "dry_run"],
  blocked_live_reason: "not_runtime_enabled",
};

test("label and color differences do not request a private catalog overwrite", () => {
  const built = { ...profile, label: "另一个名字", accent: "#fff" };
  const decision = catalogReleaseDecision({
    baseline: [profile],
    built: [built],
    baselineAvailable: true,
  });
  assert.deepEqual(decision, { ok: true, changed: false, reason: "catalog_unchanged" });
  assert.deepEqual(catalogSyncProjection([profile]), catalogSyncProjection([built]));
});

test("a real eligibility change requests a catalog sync", () => {
  const decision = catalogReleaseDecision({
    baseline: [profile],
    built: [{ ...profile, can_switch_live: true, blocked_live_reason: "" }],
    baselineAvailable: true,
  });
  assert.deepEqual(decision, { ok: true, changed: true, reason: "catalog_changed" });
});

test("a missing baseline fails without requesting an overwrite", () => {
  const decision = catalogReleaseDecision({
    baseline: null,
    built: [profile],
    baselineAvailable: false,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.changed, false);
  assert.equal(decision.reason, "baseline_unavailable");
});

test("a comparison failure fails without requesting an overwrite", () => {
  const decision = catalogReleaseDecision({
    baseline: [{ label: "missing profile" }],
    built: [profile],
    baselineAvailable: true,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.changed, false);
  assert.equal(decision.reason, "comparison_failed");
});

test("the generated catalog asset parses back to the same sync projection", () => {
  const asset = readFileSync(new URL("../web/strategy-switch-console/strategy_profiles_asset.js", import.meta.url), "utf8");
  const example = JSON.parse(readFileSync(new URL("../web/strategy-switch-console/strategy-profiles.example.json", import.meta.url), "utf8"));
  const decision = catalogReleaseDecision({
    baseline: readCatalogAsset(asset),
    built: example,
    baselineAvailable: true,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.changed, false);
});

test("the deploy workflow compares built catalogs and keeps the manual sync choice", () => {
  const workflow = readFileSync(new URL("../.github/workflows/deploy-strategy-switch-console.yml", import.meta.url), "utf8");
  assert.match(workflow, /catalogReleaseDecision/);
  assert.match(workflow, /strategy_profiles_asset\.js/);
  assert.match(workflow, /inputs\.sync_strategy_profiles/);
  assert.doesNotMatch(workflow, /git diff --quiet "\$BEFORE" HEAD -- platform-config\.json/);
  const gate = workflow.slice(workflow.indexOf("id: catalog-change"), workflow.indexOf("id: catalog-change") + 1800);
  assert.match(gate, /process\.exit\(1\)/);
  assert.doesNotMatch(gate, /changed=true/);
});

test("the deploy renderer pins account-facts and runtime-daily flags and fails closed before deploy", () => {
  const workflow = readFileSync(new URL("../.github/workflows/deploy-strategy-switch-console.yml", import.meta.url), "utf8");
  const template = new URL("../web/strategy-switch-console/wrangler.toml.example", import.meta.url);
  const heredoc = workflow.match(/          python3 - <<'PY'\n([\s\S]*?)\n          PY\n/);
  assert.ok(heredoc, "prepare step must keep its tested Python renderer heredoc");
  const renderer = heredoc[1].split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
  assert.match(workflow, /ACCOUNT_FACTS_READ_MODEL_ENABLED: \$\{\{ vars\.ACCOUNT_FACTS_READ_MODEL_ENABLED \}\}/);
  assert.match(workflow, /ACCOUNT_FACTS_SYNC_TOKEN: \$\{\{ secrets\.ACCOUNT_FACTS_SYNC_TOKEN \}\}/);
  assert.match(workflow, /RUNTIME_DAILY_READ_MODEL_ENABLED: \$\{\{ vars\.RUNTIME_DAILY_READ_MODEL_ENABLED \}\}/);
  assert.match(workflow, /EXECUTION_EVIDENCE_SYNC_TOKEN: \$\{\{ secrets\.EXECUTION_EVIDENCE_SYNC_TOKEN \}\}/);
  assert.match(workflow, /node tests\/console_catalog_release_validation\.mjs/);

  function render({ flag, token, runtimeDailyFlag, executionEvidenceToken } = {}) {
    const directory = mkdtempSync(join(tmpdir(), "qsl-config-render-"));
    try {
      copyFileSync(template, join(directory, "wrangler.toml.example"));
      const env = { ...process.env, WORKER_DIR: directory, STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: "synthetic-kv-id", CLOUDFLARE_ACCOUNT_ID: "synthetic-account-id" };
      for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_WRANGLER_CONFIG_TOML", "UX1_RESEARCH_JOB_TOKEN"]) delete env[key];
      env.UX1_PREVIEW_MODE = "";
      env.UX1_UES_REVISION = "";
      env.UX1_RUNTIME_EPOCH = "";
      env.UX1_EXPECTED_EVIDENCE_HASHES = "";
      if (flag === undefined) delete env.ACCOUNT_FACTS_READ_MODEL_ENABLED;
      else env.ACCOUNT_FACTS_READ_MODEL_ENABLED = flag;
      if (token === undefined) delete env.ACCOUNT_FACTS_SYNC_TOKEN;
      else env.ACCOUNT_FACTS_SYNC_TOKEN = token;
      if (runtimeDailyFlag === undefined) delete env.RUNTIME_DAILY_READ_MODEL_ENABLED;
      else env.RUNTIME_DAILY_READ_MODEL_ENABLED = runtimeDailyFlag;
      if (executionEvidenceToken === undefined) delete env.EXECUTION_EVIDENCE_SYNC_TOKEN;
      else env.EXECUTION_EVIDENCE_SYNC_TOKEN = executionEvidenceToken;
      const result = spawnSync("python3", ["-c", renderer], { encoding: "utf8", env });
      const target = join(directory, "wrangler.toml");
      const exists = existsSync(target);
      const toml = exists ? readFileSync(target, "utf8") : "";
      return { result, toml, targetExists: exists };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  function parsedConfig(toml) {
    const result = spawnSync("python3", ["-c", "import json,sys,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))"], { input: toml, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }

  for (const [flag, expected] of [["true", "true"], ["false", "false"], ["", "false"], [undefined, "false"]]) {
    const token = flag === "true" ? "synthetic-account-facts-token-sentinel" : undefined;
    const { result, toml } = render({ flag, token });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((toml.match(/^ACCOUNT_FACTS_READ_MODEL_ENABLED\s*=/gm) || []).length, 1);
    const config = parsedConfig(toml);
    assert.equal(config.vars.ACCOUNT_FACTS_READ_MODEL_ENABLED, expected);
    assert.equal(config.vars.RUNTIME_DAILY_READ_MODEL_ENABLED, "false");
    assert.equal(config.vars.STRATEGY_SWITCH_HIDDEN_PLATFORMS, "qmt");
    assert.doesNotMatch(toml, /synthetic-account-facts-token-sentinel/);
    assert.equal(config.kv_namespaces[0].binding, "STRATEGY_SWITCH_CONFIG");
    assert.equal(config.kv_namespaces[0].id, "synthetic-kv-id");
    assert.equal(config.durable_objects.bindings.find((binding) => binding.name === "STRATEGY_SWITCH_RUNTIME_INSTANCES")?.class_name, "RuntimeInstances");
  }

  for (const flag of ["TRUE", " true", "true ", "enabled"]) {
    const { result, toml, targetExists } = render({ flag, token: "synthetic-account-facts-token-sentinel" });
    assert.notEqual(result.status, 0, `accepted invalid flag ${JSON.stringify(flag)}`);
    assert.match(result.stderr, /ACCOUNT_FACTS_READ_MODEL_ENABLED/);
    assert.equal(targetExists, false, "invalid flag must fail before creating a deploy config");
    assert.equal(toml, "");
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-account-facts-token-sentinel/);
  }

  for (const token of [undefined, "", "   ", " synthetic-token", "synthetic-token ", "synthetic\r-token", "synthetic\n-token"]) {
    const { result, toml, targetExists } = render({ flag: "true", token });
    assert.notEqual(result.status, 0, "true must require a non-blank token with no surrounding whitespace or HTTP control characters");
    assert.match(result.stderr, /ACCOUNT_FACTS_SYNC_TOKEN/);
    assert.equal(targetExists, false, "missing or malformed token must fail before creating a deploy config");
    assert.equal(toml, "");
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-token/);
  }

  for (const [flag, expected] of [["true", "true"], ["false", "false"], ["", "false"], [undefined, "false"]]) {
    const executionEvidenceToken = flag === "true" ? "synthetic-execution-evidence-token-sentinel" : undefined;
    const { result, toml } = render({ runtimeDailyFlag: flag, executionEvidenceToken });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((toml.match(/^RUNTIME_DAILY_READ_MODEL_ENABLED\s*=/gm) || []).length, 1);
    const config = parsedConfig(toml);
    assert.equal(config.vars.RUNTIME_DAILY_READ_MODEL_ENABLED, expected);
    assert.doesNotMatch(toml, /synthetic-execution-evidence-token-sentinel/);
  }

  for (const flag of ["TRUE", " true", "true ", "enabled"]) {
    const { result, toml, targetExists } = render({ runtimeDailyFlag: flag, executionEvidenceToken: "synthetic-execution-evidence-token-sentinel" });
    assert.notEqual(result.status, 0, `accepted invalid flag ${JSON.stringify(flag)}`);
    assert.match(result.stderr, /RUNTIME_DAILY_READ_MODEL_ENABLED/);
    assert.equal(targetExists, false, "invalid flag must fail before creating a deploy config");
    assert.equal(toml, "");
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-execution-evidence-token-sentinel/);
  }

  for (const executionEvidenceToken of [undefined, "", "   ", " synthetic-token", "synthetic-token ", "synthetic\r-token", "synthetic\n-token"]) {
    const { result, toml, targetExists } = render({ runtimeDailyFlag: "true", executionEvidenceToken });
    assert.notEqual(result.status, 0, "true must require a non-blank execution evidence token without surrounding whitespace or HTTP control characters");
    assert.match(result.stderr, /EXECUTION_EVIDENCE_SYNC_TOKEN/);
    assert.equal(targetExists, false, "missing or malformed token must fail before creating a deploy config");
    assert.equal(toml, "");
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-token/);
  }
});
