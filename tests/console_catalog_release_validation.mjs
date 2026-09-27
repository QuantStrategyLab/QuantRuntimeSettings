import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
