import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { RISK_TIER_POLICY_BINDINGS } from "../web/strategy-switch-console/application/console_api/risk_tiers.js";
import {
  CANONICAL_ENVIRONMENTS,
  CANONICAL_MARKETS,
  CANONICAL_NAMING_REGISTRY,
  CANONICAL_PLATFORM_SLUGS,
  CANONICAL_RISK_TIER_MAP,
  CANONICAL_STRATEGY_DISPOSITIONS,
  NAMING_REGISTRY_SCHEMA,
} from "../web/strategy-switch-console/application/naming_canonical/constants.js";
import {
  consoleTierToEngineTier,
  engineTierToConsoleTier,
  formatAccountSlotKey,
  isRawAccountIdentifier,
  isUnsafePrivateLocator,
  isValidPlatformSlug,
  isValidPluginId,
  isValidStrategyProfileId,
  parseAccountSlotKey,
  pluginCapabilityClass,
  resolveCanonicalAlias,
  validateNamingRegistry,
} from "../web/strategy-switch-console/application/naming_canonical/helpers.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");

const namingSchema = JSON.parse(
  readFileSync(new URL("../schemas/qsl-canonical-naming-registry.v1.schema.json", import.meta.url), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
const validateSchema = ajv.compile(namingSchema);

const cloneRegistry = () => structuredClone(CANONICAL_NAMING_REGISTRY);

const PRIVATE_LOCATOR_RE = new RegExp(
  "(?:source_ref|kv_key|do_key|kv://|do://|/" + "Users/|/" + "home/|broker_account_hash)",
);

// 1. Schema compilation, canonical instance validation, freeze & immutability flags.
assert.equal(CANONICAL_NAMING_REGISTRY.schema_version, NAMING_REGISTRY_SCHEMA);
assert.equal(NAMING_REGISTRY_SCHEMA, "qsl.canonical_naming_registry.v1");
assert.equal(CANONICAL_NAMING_REGISTRY.immutable_legacy_hashes, true);
assert.equal(CANONICAL_NAMING_REGISTRY.authority.convention_only, true);
assert.equal(CANONICAL_NAMING_REGISTRY.authority.authorizes_rename_or_migration, false);
assert.equal(CANONICAL_NAMING_REGISTRY.authority.authorizes_deployment_or_trading, false);
assert.equal(Object.isFrozen(CANONICAL_NAMING_REGISTRY), true);
assert.equal(Object.isFrozen(CANONICAL_NAMING_REGISTRY.platforms), true);
assert.equal(Object.isFrozen(CANONICAL_NAMING_REGISTRY.legacy_aliases), true);

assert.ok(
  validateSchema(CANONICAL_NAMING_REGISTRY),
  `CANONICAL_NAMING_REGISTRY schema failure: ${ajv.errorsText(validateSchema.errors)}`,
);
const semanticCheck = validateNamingRegistry(CANONICAL_NAMING_REGISTRY);
assert.deepEqual(semanticCheck, { ok: true, errors: [] });

// Verify pure leaf boundary (constants.js has zero imports; helpers.js imports only ./constants.js).
const stripJsComments = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const constantsSource = readFileSync(
  new URL("../web/strategy-switch-console/application/naming_canonical/constants.js", import.meta.url),
  "utf8",
);
const constantsCode = stripJsComments(constantsSource);
assert.equal(/\bimport\b|\brequire\s*\(/.test(constantsCode), false, "constants.js must have zero imports");

const helpersSource = readFileSync(
  new URL("../web/strategy-switch-console/application/naming_canonical/helpers.js", import.meta.url),
  "utf8",
);
const helpersCode = stripJsComments(helpersSource);
assert.equal(/\bimport\s*\(|\brequire\s*\(/.test(helpersCode), false, "helpers.js must not use dynamic import/require");
const helperImportSpecifiers = [...helpersCode.matchAll(/\bimport\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g)].map(
  (match) => match[1],
);
assert.deepEqual(helperImportSpecifiers, ["./constants.js"], "helpers.js must import only inward from ./constants.js");
assert.equal(/runtime_support|worker\.js|\bhttp\b|storage/i.test(helpersCode), false);
assert.equal(
  PRIVATE_LOCATOR_RE.test(JSON.stringify(CANONICAL_NAMING_REGISTRY)),
  false,
  "registry must contain zero private locators",
);

// 2. Exact key equality between CANONICAL_RISK_TIER_MAP and RISK_TIER_POLICY_BINDINGS.
assert.deepEqual(Object.keys(CANONICAL_RISK_TIER_MAP), Object.keys(RISK_TIER_POLICY_BINDINGS));

// 3. Platform slugs: closed 5, binance dormant, zero active A-share venue.
assert.deepEqual(CANONICAL_PLATFORM_SLUGS, ["schwab", "firstrade", "ibkr", "longbridge", "binance"]);
assert.deepEqual(CANONICAL_ENVIRONMENTS, ["live", "paper", "research"]);
assert.deepEqual(CANONICAL_MARKETS, ["us", "hk", "global", "crypto"]);
assert.deepEqual(CANONICAL_STRATEGY_DISPOSITIONS, ["active_pilot", "phase8_review", "archived"]);

for (const slug of CANONICAL_PLATFORM_SLUGS) {
  assert.equal(isValidPlatformSlug(slug), true, `expected valid platform slug ${slug}`);
}
assert.equal(CANONICAL_NAMING_REGISTRY.platforms.binance.status, "dormant");
for (const activeSlug of ["schwab", "firstrade", "ibkr", "longbridge"]) {
  assert.equal(CANONICAL_NAMING_REGISTRY.platforms[activeSlug].status, "active");
}
assert.equal(Object.hasOwn(CANONICAL_NAMING_REGISTRY.platforms, "cn_a_share"), false);
assert.equal(Object.hasOwn(CANONICAL_NAMING_REGISTRY.platforms, "qmt"), false);

for (const badSlug of ["cn_a_share", "interactive-brokers", "longport", "alpaca", "qmt", "", null, undefined, "IBKR"]) {
  assert.equal(isValidPlatformSlug(badSlug), false, `expected rejected platform slug ${String(badSlug)}`);
}

{
  const withAshare = cloneRegistry();
  withAshare.platforms.cn_a_share = { slug: "cn_a_share", status: "active", label_zh: "A股", label_en: "CN A-Share" };
  assert.equal(validateSchema(withAshare), false);
  assert.equal(validateNamingRegistry(withAshare).ok, false);

  const withActiveBinance = cloneRegistry();
  withActiveBinance.platforms.binance.status = "active";
  assert.equal(validateSchema(withActiveBinance), false);
  assert.equal(validateNamingRegistry(withActiveBinance).ok, false);
}

// 4. Account slot keys: accept canonical tuples, reject raw brokerage IDs & unsafe private locators.
for (const validSlot of [
  "ibkr:live:a1",
  "ibkr:live:a2",
  "ibkr:live:a3",
  "ibkr:live:a4",
  "longbridge:paper:pilot",
  "schwab:live:main",
  "firstrade:live:main",
  "binance:live:dormant",
  "binance:research:archive",
]) {
  const parsed = parseAccountSlotKey(validSlot);
  assert.equal(parsed.ok, true, `expected valid slot ${validSlot}`);
  assert.equal(formatAccountSlotKey(parsed.platform, parsed.env, parsed.slot), validSlot);
}

const unsafeUserPath = "/" + "Users/alice/account";
const unsafeHomePath = "/" + "home/alice/account";
const unsafeEmbeddedUserPath = "Source: /" + "Users/example/account";
const invalidSlots = [
  "ibkr:live:U1234567",
  "ibkr:live:DU987654",
  "ibkr:live:u1234567",
  "ibkr:live:du987654",
  "schwab:live:12345678",
  "schwab:live:0000-0099",
  "ibkr:live:12-34-56",
  "ibkr:live:1-2-3-4-5-6",
  "ibkr:live:12_34_56",
  "ibkr:live:acct_123456",
  "ibkr:live:acct123456",
  "https://broker.example/ibkr:live:a1",
  "kv://ibkr/live/a1",
  "do://ibkr/live/a1",
  unsafeUserPath,
  unsafeHomePath,
  unsafeEmbeddedUserPath,
  "../secret/slot",
  "ibkr:live:a1?token=secret",
  "ibkr:prod:a1",
  "alpaca:live:a1",
  "cn_a_share:live:a1",
  "ibkr:live:A1",
  "ibkr:live",
  "ibkr:live:a1:extra",
  "",
  null,
];
for (const badSlot of invalidSlots) {
  assert.equal(parseAccountSlotKey(badSlot).ok, false, `expected rejected account slot ${String(badSlot)}`);
}
assert.equal(formatAccountSlotKey("ibkr", "live", "U1234567"), null);
assert.equal(formatAccountSlotKey("ibkr", "live", "DU987654"), null);
assert.equal(formatAccountSlotKey("schwab", "live", "12345678"), null);
assert.equal(formatAccountSlotKey("schwab", "live", "0000-0099"), null);
assert.equal(formatAccountSlotKey("ibkr", "live", "12-34-56"), null);
assert.equal(formatAccountSlotKey("ibkr", "live", "1-2-3-4-5-6"), null);
assert.equal(formatAccountSlotKey("ibkr", "live", "12_34_56"), null);
assert.equal(formatAccountSlotKey("ibkr", "live", "acct123456"), null);
assert.equal(formatAccountSlotKey("alpaca", "live", "a1"), null);
assert.equal(formatAccountSlotKey("ibkr", "prod", "a1"), null);
assert.equal(formatAccountSlotKey("ibkr", "live", unsafeUserPath), null);

{
  for (const rawKey of [
    "ibkr:live:U1234567",
    "ibkr:live:DU987654",
    "schwab:live:12345678",
    "schwab:live:0000-0099",
    "ibkr:live:12-34-56",
    "ibkr:live:1-2-3-4-5-6",
    "ibkr:live:12_34_56",
    "ibkr:live:acct123456",
  ]) {
    const badReg = cloneRegistry();
    badReg.account_slots.push({
      slot_key: rawKey,
      platform: rawKey.split(":")[0],
      env: "live",
      slot: rawKey.split(":")[2],
      synthetic: true,
      label_zh: "非法账号",
      label_en: "Invalid Account",
    });
    assert.equal(validateSchema(badReg), false, `schema must reject ${rawKey}`);
    assert.equal(validateNamingRegistry(badReg).ok, false, `validator must reject ${rawKey}`);
  }
}

// 5. Strategy profile IDs: 4-segment {market}_{asset}_{family}_{horizon} without version/tier suffixes.
for (const validStrategy of [
  "us_tqqq_trend_daily",
  "us_soxl_trend_daily",
  "us_soxx_core_daily",
  "global_etf_rot_weekly",
  "hk_div_qual_daily",
  "us_ibit_dca_weekly",
]) {
  assert.equal(isValidStrategyProfileId(validStrategy), true, `expected valid strategy ${validStrategy}`);
}

for (const badStrategy of [
  "tqqq_growth_income_v7_aggressive",
  "us_soxl_trend_v2",
  "us_tqqq_v5_daily",
  "us_tqqq_trend_aggressive",
  "us_tqqq_trend_conservative",
  "us_tqqq_trend_balanced",
  "us_tqqq_trend_daily_extra",
  "us_u12345_trend_daily",
  "us_du987654_trend_daily",
  "us_123456_trend_daily",
  "us_123_456_daily",
  "us_tqqq_trend",
  "cn_csi300_rot_daily",
  "US_TQQQ_TREND_DAILY",
  "us-tqqq-trend-daily",
  "kv://us_tqqq_trend_daily",
  "",
  null,
]) {
  assert.equal(isValidStrategyProfileId(badStrategy), false, `expected rejected strategy ${String(badStrategy)}`);
}

{
  for (const [badStrategyId, asset, family, horizon, version] of [
    ["tqqq_growth_income_v7_aggressive", "soxl", "trend", "daily", "v2"],
    ["us_soxl_trend_v2", "soxl", "trend", "daily", "v2"],
    ["us_tqqq_trend_daily_extra", "tqqq", "trend", "daily", "v2"],
    ["us_u12345_trend_daily", "u12345", "trend", "daily", "v1"],
    ["us_du987654_trend_daily", "du987654", "trend", "daily", "v1"],
    ["us_123456_trend_daily", "123456", "trend", "daily", "v1"],
    ["us_123_456_daily", "123", "456", "daily", "v1"],
    ["us_tqqq_trend_daily", "tqqq", "trend", "daily", "v123456"],
    ["us_tqqq_trend_daily", "tqqq", "trend", "daily", "v12.34.56"],
  ]) {
    const badReg = cloneRegistry();
    badReg.strategies.push({
      strategy_id: badStrategyId,
      market: "us",
      asset,
      family,
      horizon,
      version,
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "archived",
      label_zh: "非法策略",
      label_en: "Invalid Strategy",
    });
    assert.equal(validateSchema(badReg), false, `schema must reject strategy ${badStrategyId}/${asset}/${version}`);
    assert.equal(validateNamingRegistry(badReg).ok, false, `validator must reject strategy ${badStrategyId}/${asset}/${version}`);
  }
}

// 6. Plugin IDs & capability boundaries (obs_* vs risk_*, max_scalar <= 1.0, can_bypass_fuse: false).
for (const obsId of ["obs_advisor_scorecard", "obs_event_radar"]) {
  assert.equal(isValidPluginId(obsId), true);
  assert.equal(pluginCapabilityClass(obsId), "observer");
}
for (const riskId of ["risk_macro_governor", "risk_regime_control"]) {
  assert.equal(isValidPluginId(riskId), true);
  assert.equal(pluginCapabilityClass(riskId), "risk_reduction");
}
for (const badPlugin of [
  "macro_risk_governor",
  "market_regime_control",
  "signal_v2",
  "obs_u12345",
  "risk_du987654",
  "obs_123456",
  "obs_12_34_56",
  "risk_123_456",
  "obs_",
  "risk_",
  "OBS_test",
  "",
]) {
  assert.equal(isValidPluginId(badPlugin), false, `expected rejected plugin ${String(badPlugin)}`);
  assert.equal(pluginCapabilityClass(badPlugin), null);
}

{
  for (const rawPluginId of ["obs_u12345", "risk_du987654", "obs_123456", "obs_12_34_56", "risk_123_456"]) {
    const isRisk = rawPluginId.startsWith("risk_");
    const badReg = cloneRegistry();
    badReg.plugins.push({
      plugin_id: rawPluginId,
      capability_class: isRisk ? "risk_reduction" : "observer",
      read_only: !isRisk,
      can_adjust_risk: isRisk,
      max_scalar: isRisk ? 1.0 : null,
      can_bypass_fuse: false,
      status: "deferred",
      label_zh: "非法插件",
      label_en: "Invalid Plugin",
    });
    assert.equal(validateSchema(badReg), false, `schema must reject plugin ${rawPluginId}`);
    assert.equal(validateNamingRegistry(badReg).ok, false, `validator must reject plugin ${rawPluginId}`);
  }
}

{
  // risk_* with max_scalar > 1.0 rejected
  const badScalar = cloneRegistry();
  badScalar.plugins[2].max_scalar = 1.25;
  assert.equal(validateSchema(badScalar), false);
  assert.equal(validateNamingRegistry(badScalar).ok, false);

  // can_bypass_fuse: true rejected on both obs_* and risk_*
  const badFuseRisk = cloneRegistry();
  badFuseRisk.plugins[2].can_bypass_fuse = true;
  assert.equal(validateSchema(badFuseRisk), false);
  assert.equal(validateNamingRegistry(badFuseRisk).ok, false);

  const badFuseObs = cloneRegistry();
  badFuseObs.plugins[0].can_bypass_fuse = true;
  assert.equal(validateSchema(badFuseObs), false);
  assert.equal(validateNamingRegistry(badFuseObs).ok, false);

  // obs_* cannot emit > 1.0, risk reduction < 1.0, can_adjust_risk: true, or read_only: false
  const badObsHighScalar = cloneRegistry();
  badObsHighScalar.plugins[0].max_scalar = 1.5;
  assert.equal(validateSchema(badObsHighScalar), false);
  assert.equal(validateNamingRegistry(badObsHighScalar).ok, false);

  const badObsReduceScalar = cloneRegistry();
  badObsReduceScalar.plugins[0].max_scalar = 0.8;
  assert.equal(validateSchema(badObsReduceScalar), false);
  assert.equal(validateNamingRegistry(badObsReduceScalar).ok, false);

  const badObsRiskFlag = cloneRegistry();
  badObsRiskFlag.plugins[0].can_adjust_risk = true;
  assert.equal(validateSchema(badObsRiskFlag), false);
  assert.equal(validateNamingRegistry(badObsRiskFlag).ok, false);

  const badObsReadOnly = cloneRegistry();
  badObsReadOnly.plugins[0].read_only = false;
  assert.equal(validateSchema(badObsReadOnly), false);
  assert.equal(validateNamingRegistry(badObsReadOnly).ok, false);
}

// 7. 1:1 Risk tier bidirectional map.
assert.equal(consoleTierToEngineTier("CAPITAL_PRESERVATION"), "conservative");
assert.equal(consoleTierToEngineTier("BALANCED_COMPOUNDING"), "balanced");
assert.equal(consoleTierToEngineTier("GROWTH_COMPOUNDING"), "aggressive");
assert.equal(consoleTierToEngineTier("unknown"), null);
assert.equal(consoleTierToEngineTier("capital_preservation"), null);

assert.equal(engineTierToConsoleTier("conservative"), "CAPITAL_PRESERVATION");
assert.equal(engineTierToConsoleTier("balanced"), "BALANCED_COMPOUNDING");
assert.equal(engineTierToConsoleTier("aggressive"), "GROWTH_COMPOUNDING");
assert.equal(engineTierToConsoleTier("unknown"), null);
assert.equal(engineTierToConsoleTier("CONSERVATIVE"), null);

{
  const brokenTierReg = cloneRegistry();
  brokenTierReg.risk_tiers.GROWTH_COMPOUNDING.engine_tier = "balanced";
  assert.equal(validateSchema(brokenTierReg), false);
  assert.equal(validateNamingRegistry(brokenTierReg).ok, false);
}

// 8. Legacy alias resolution preserving immutable legacy IDs & rejecting unknown/ambiguous aliases.
const aliasCases = [
  ["platforms", "interactive-brokers", "ibkr", true],
  ["platforms", "longport", "longbridge", true],
  ["platforms", "charles-schwab", "schwab", true],
  ["platforms", "ibkr", "ibkr", false],
  ["accounts", "ibkr:tqqq", "ibkr:live:a1", true],
  ["accounts", "longbridge:paper", "longbridge:paper:pilot", true],
  ["accounts", "binance:live", "binance:live:dormant", true],
  ["accounts", "binance:research:legacy", "binance:research:archive", true],
  ["accounts", "binance:crypto_combo", "binance:research:archive", true],
  ["accounts", "ibkr:live:a1", "ibkr:live:a1", false],
  ["strategies", "tqqq_growth_income", "us_tqqq_trend_daily", true],
  ["strategies", "soxl_soxx_trend_income", "us_soxl_trend_daily", true],
  [
    "strategies",
    "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve",
    "us_soxx_core_daily",
    true,
  ],
  ["strategies", "us_tqqq_trend_daily", "us_tqqq_trend_daily", false],
  ["plugins", "macro_risk_governor", "risk_macro_governor", true],
  ["plugins", "market_regime_control", "risk_regime_control", true],
  ["plugins", "risk_macro_governor", "risk_macro_governor", false],
];
for (const [kind, input, expectedCanonical, expectedAliased] of aliasCases) {
  const res = resolveCanonicalAlias(kind, input);
  assert.equal(res.ok, true, `expected alias ${kind}:${input} to resolve`);
  assert.equal(res.input, input, "legacy input string must remain unmodified");
  assert.equal(res.canonical, expectedCanonical);
  assert.equal(res.aliased, expectedAliased);
}

// Unknown, bare-ambiguous, raw-account, and private-locator alias rejections.
assert.equal(resolveCanonicalAlias("platforms", "alpaca").ok, false);
assert.equal(resolveCanonicalAlias("strategies", "cn_industry_etf_rotation").ok, false);
assert.equal(resolveCanonicalAlias("strategies", "unknown_strategy").ok, false);
assert.equal(resolveCanonicalAlias("plugins", "unknown_plugin").ok, false);
assert.equal(resolveCanonicalAlias("invalid_kind", "ibkr").ok, false);

const ambiguousLive = resolveCanonicalAlias("accounts", "live");
assert.equal(ambiguousLive.ok, false);
assert.equal(ambiguousLive.reason, "ambiguous_alias");

const rawAcctAlias = resolveCanonicalAlias("accounts", "ibkr:live:U1234567");
assert.equal(rawAcctAlias.ok, false);
assert.equal(rawAcctAlias.reason, "raw_account_id_prohibited");

const unsafeAlias = resolveCanonicalAlias("accounts", unsafeUserPath);
assert.equal(unsafeAlias.ok, false);
assert.equal(unsafeAlias.reason, "unsafe_private_locator");

{
  // Ambiguous duplicate aliases in custom registry must fail both validation and resolution.
  const ambiguousReg = cloneRegistry();
  ambiguousReg.legacy_aliases.platforms.push({ legacy_id: "LongPort", canonical_id: "ibkr" });
  assert.equal(validateNamingRegistry(ambiguousReg).ok, false);
  const res = resolveCanonicalAlias("platforms", "longport", ambiguousReg);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "ambiguous_alias");

  // Unknown target in legacy_aliases must fail validation.
  const badTargetReg = cloneRegistry();
  badTargetReg.legacy_aliases.strategies.push({
    legacy_id: "phantom_legacy",
    canonical_id: "us_phantom_trend_daily",
  });
  assert.equal(validateNamingRegistry(badTargetReg).ok, false);

  // Case-normalized canonical ID collision must fail both validateNamingRegistry and resolveCanonicalAlias
  // regardless of whether queried via canonical ID ("schwab") or exact alias ("Schwab").
  const caseShadowReg = cloneRegistry();
  caseShadowReg.legacy_aliases.platforms.push({ legacy_id: "Schwab", canonical_id: "ibkr" });
  const caseShadowValidation = validateNamingRegistry(caseShadowReg);
  assert.equal(caseShadowValidation.ok, false);
  assert.ok(caseShadowValidation.errors.some((err) => err.endsWith(":shadows_canonical_id")));
  const caseShadowResolveLower = resolveCanonicalAlias("platforms", "schwab", caseShadowReg);
  assert.equal(caseShadowResolveLower.ok, false);
  assert.equal(caseShadowResolveLower.reason, "ambiguous_alias");
  const caseShadowResolveExact = resolveCanonicalAlias("platforms", "Schwab", caseShadowReg);
  assert.equal(caseShadowResolveExact.ok, false);
  assert.equal(caseShadowResolveExact.reason, "ambiguous_alias");

  // Case-normalized alias pointing to the SAME canonical ID remains valid and non-destructive.
  const sameTargetCasingReg = cloneRegistry();
  sameTargetCasingReg.legacy_aliases.platforms.push({ legacy_id: "Schwab", canonical_id: "schwab" });
  assert.deepEqual(validateNamingRegistry(sameTargetCasingReg), { ok: true, errors: [] });
  assert.deepEqual(resolveCanonicalAlias("platforms", "Schwab", sameTargetCasingReg), {
    ok: true,
    kind: "platforms",
    input: "Schwab",
    canonical: "schwab",
    aliased: true,
  });
  assert.deepEqual(resolveCanonicalAlias("platforms", "schwab", sameTargetCasingReg), {
    ok: true,
    kind: "platforms",
    input: "schwab",
    canonical: "schwab",
    aliased: false,
  });
}

// 9. Human label decoupling: changing label_zh / label_en never alters machine IDs or tier mapping.
{
  const relabeled = cloneRegistry();
  relabeled.platforms.ibkr.label_zh = "IBKR 自定义中文标签";
  relabeled.platforms.ibkr.label_en = "IBKR Custom Label";
  relabeled.account_slots[0].label_zh = "自定义槽位标签";
  relabeled.account_slots[0].label_en = "Custom Slot Label";
  relabeled.strategies[0].label_zh = "自定义策略中文名";
  relabeled.strategies[0].label_en = "Custom Strategy Name";
  relabeled.plugins[0].label_zh = "自定义插件中文名";
  relabeled.plugins[0].label_en = "Custom Plugin Name";
  relabeled.risk_tiers.CAPITAL_PRESERVATION.label_zh = "自定义保守";
  relabeled.risk_tiers.CAPITAL_PRESERVATION.label_en = "Custom Conservative";

  assert.equal(
    validateSchema(relabeled),
    true,
    `Relabeled registry failed schema: ${ajv.errorsText(validateSchema.errors)}`,
  );
  assert.deepEqual(validateNamingRegistry(relabeled), { ok: true, errors: [] });
  assert.equal(relabeled.strategies[0].strategy_id, CANONICAL_NAMING_REGISTRY.strategies[0].strategy_id);
  assert.equal(relabeled.strategies[0].risk_tier, CANONICAL_NAMING_REGISTRY.strategies[0].risk_tier);
  assert.equal(relabeled.plugins[0].plugin_id, CANONICAL_NAMING_REGISTRY.plugins[0].plugin_id);
  assert.equal(relabeled.risk_tiers.CAPITAL_PRESERVATION.engine_tier, "conservative");

  // Empty or oversized (>128) human labels must fail.
  const emptyLabel = cloneRegistry();
  emptyLabel.strategies[0].label_zh = "   ";
  assert.equal(validateSchema(emptyLabel), false);
  assert.equal(validateNamingRegistry(emptyLabel).ok, false);

  const longLabel = cloneRegistry();
  longLabel.strategies[0].label_en = "a".repeat(129);
  assert.equal(validateSchema(longLabel), false);
  assert.equal(validateNamingRegistry(longLabel).ok, false);

  // Raw account IDs and workstation paths inside human labels must fail BOTH Ajv schema and validator
  // with safety errors only (no spurious labels_required).
  const fullWidthAcctLabel = cloneRegistry();
  fullWidthAcctLabel.account_slots[0].label_zh = "账户（U12345）";
  assert.equal(validateSchema(fullWidthAcctLabel), false, "schema must reject 账户（U12345）");
  assert.deepEqual(
    validateNamingRegistry(fullWidthAcctLabel),
    { ok: false, errors: ["registry.account_slots[0].label_zh:raw_account_id_prohibited"] },
  );

  const rawAcctLabelEn = cloneRegistry();
  rawAcctLabelEn.account_slots[0].label_en = "U1234567";
  assert.equal(validateSchema(rawAcctLabelEn), false, "schema must reject U1234567 in label_en");
  assert.deepEqual(
    validateNamingRegistry(rawAcctLabelEn),
    { ok: false, errors: ["registry.account_slots[0].label_en:raw_account_id_prohibited"] },
  );

  const groupedDigitsLabel = cloneRegistry();
  groupedDigitsLabel.account_slots[0].label_en = "Acct 0000-0099";
  assert.equal(validateSchema(groupedDigitsLabel), false, "schema must reject grouped account digits in label_en");
  assert.equal(validateNamingRegistry(groupedDigitsLabel).ok, false, "validator must reject grouped account digits");

  for (const splitLabel of ["账号 12-34-56", "Account 12 34 56", "Account 12.34.56", "Acct 1-2-3-4-5-6"]) {
    const splitDigitReg = cloneRegistry();
    splitDigitReg.account_slots[0].label_zh = splitLabel;
    assert.equal(validateSchema(splitDigitReg), false, `schema must reject split digits in label: ${splitLabel}`);
    assert.deepEqual(
      validateNamingRegistry(splitDigitReg),
      { ok: false, errors: ["registry.account_slots[0].label_zh:raw_account_id_prohibited"] },
    );
  }

  for (const legacySplit of ["ibkr:12-34-56", "12.34.56"]) {
    const splitLegacyReg = cloneRegistry();
    splitLegacyReg.legacy_aliases.accounts.push({ legacy_id: legacySplit, canonical_id: "ibkr:live:a1" });
    assert.equal(validateSchema(splitLegacyReg), false, `schema must reject legacy split account: ${legacySplit}`);
    assert.equal(validateNamingRegistry(splitLegacyReg).ok, false, `validator must reject legacy split: ${legacySplit}`);
    assert.equal(resolveCanonicalAlias("accounts", legacySplit).reason, "raw_account_id_prohibited");
  }

  for (const [kind, canonicalTarget] of [
    ["platforms", "ibkr"],
    ["strategies", "us_tqqq_trend_daily"],
    ["plugins", "risk_macro_governor"],
  ]) {
    for (const rawLegacyId of ["u12345", "du987654", "123456", "12-34-56", "12.34.56", "legacy_u12345", "broker-u12345"]) {
      const badLegacyReg = cloneRegistry();
      badLegacyReg.legacy_aliases[kind].push({ legacy_id: rawLegacyId, canonical_id: canonicalTarget });
      assert.equal(validateSchema(badLegacyReg), false, `schema must reject raw legacy alias ${kind}:${rawLegacyId}`);
      assert.equal(validateNamingRegistry(badLegacyReg).ok, false, `validator must reject raw legacy alias ${kind}:${rawLegacyId}`);
      assert.equal(resolveCanonicalAlias(kind, rawLegacyId).reason, "raw_account_id_prohibited");
    }
  }

  const workstationPathLabel = cloneRegistry();
  workstationPathLabel.account_slots[0].label_en = unsafeEmbeddedUserPath;
  assert.equal(validateSchema(workstationPathLabel), false, "schema must reject embedded workstation path in label_en");
  assert.deepEqual(
    validateNamingRegistry(workstationPathLabel),
    { ok: false, errors: ["registry.account_slots[0].label_en:unsafe_private_locator"] },
  );
}

// 10. Raw account & unsafe private locator detector sanity check.
assert.equal(isRawAccountIdentifier("U1234567"), true);
assert.equal(isRawAccountIdentifier("DU987654"), true);
assert.equal(isRawAccountIdentifier("12345678"), true);
assert.equal(isRawAccountIdentifier("0000-0099"), true);
assert.equal(isRawAccountIdentifier("0000 0099"), true);
assert.equal(isRawAccountIdentifier("12-34-56"), true);
assert.equal(isRawAccountIdentifier("1-2-3-4-5-6"), true);
assert.equal(isRawAccountIdentifier("12_34_56"), true);
assert.equal(isRawAccountIdentifier("12.34.56"), true);
assert.equal(isRawAccountIdentifier("acct123456"), true);
assert.equal(isRawAccountIdentifier("账户（U12345）"), true);
assert.equal(isRawAccountIdentifier("a1"), false);
assert.equal(isRawAccountIdentifier("us_russell50_rot_weekly"), false);
assert.equal(isUnsafePrivateLocator("https://example.com"), true);
assert.equal(isUnsafePrivateLocator(unsafeEmbeddedUserPath), true);
assert.equal(isUnsafePrivateLocator("ibkr:live:a1"), false);
assert.equal(isUnsafePrivateLocator("SOXL/SOXX Core Compounding (Cash Reserve)"), false);

// Assert ADR 0002 R3 environment isolation for binance:live vs binance:research:archive.
const binanceLiveAlias = resolveCanonicalAlias("accounts", "binance:live");
assert.equal(binanceLiveAlias.ok, true);
assert.equal(binanceLiveAlias.canonical, "binance:live:dormant");
assert.notEqual(binanceLiveAlias.canonical, "binance:research:archive");

console.log("naming_canonical_validation: PASS");
