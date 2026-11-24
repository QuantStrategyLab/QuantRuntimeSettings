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
} from "../web/strategy-switch-console/application/naming_canonical/registry.js";

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

// Verify pure leaf invariant (no external imports, no Worker/DO/storage/network access).
const registrySource = readFileSync(
  new URL("../web/strategy-switch-console/application/naming_canonical/registry.js", import.meta.url),
  "utf8",
);
assert.equal(/\bimport\s+/.test(registrySource), false, "registry.js must remain a zero-import leaf module");
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
  "binance:research:archive",
]) {
  const parsed = parseAccountSlotKey(validSlot);
  assert.equal(parsed.ok, true, `expected valid slot ${validSlot}`);
  assert.equal(formatAccountSlotKey(parsed.platform, parsed.env, parsed.slot), validSlot);
}

const unsafeUserPath = "/" + "Users/alice/account";
const unsafeHomePath = "/" + "home/alice/account";
const invalidSlots = [
  "ibkr:live:U1234567",
  "ibkr:live:DU987654",
  "ibkr:live:u1234567",
  "ibkr:live:du987654",
  "schwab:live:12345678",
  "ibkr:live:acct_123456",
  "ibkr:live:acct123456",
  "https://broker.example/ibkr:live:a1",
  "kv://ibkr/live/a1",
  "do://ibkr/live/a1",
  unsafeUserPath,
  unsafeHomePath,
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
assert.equal(formatAccountSlotKey("alpaca", "live", "a1"), null);
assert.equal(formatAccountSlotKey("ibkr", "prod", "a1"), null);
assert.equal(formatAccountSlotKey("ibkr", "live", unsafeUserPath), null);

{
  for (const rawKey of ["ibkr:live:U1234567", "ibkr:live:DU987654", "schwab:live:12345678"]) {
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
  for (const badStrategyId of ["tqqq_growth_income_v7_aggressive", "us_soxl_trend_v2", "us_tqqq_trend_daily_extra"]) {
    const badReg = cloneRegistry();
    badReg.strategies.push({
      strategy_id: badStrategyId,
      market: "us",
      asset: "soxl",
      family: "trend",
      horizon: "daily",
      version: "v2",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "archived",
      label_zh: "非法策略",
      label_en: "Invalid Strategy",
    });
    assert.equal(validateSchema(badReg), false, `schema must reject ${badStrategyId}`);
    assert.equal(validateNamingRegistry(badReg).ok, false, `validator must reject ${badStrategyId}`);
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
for (const badPlugin of ["macro_risk_governor", "market_regime_control", "signal_v2", "obs_", "risk_", "OBS_test", ""]) {
  assert.equal(isValidPluginId(badPlugin), false, `expected rejected plugin ${String(badPlugin)}`);
  assert.equal(pluginCapabilityClass(badPlugin), null);
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

  // Empty human labels must fail.
  const emptyLabel = cloneRegistry();
  emptyLabel.strategies[0].label_zh = "   ";
  assert.equal(validateSchema(emptyLabel), false);
  assert.equal(validateNamingRegistry(emptyLabel).ok, false);
}

// 10. Raw account detector sanity check.
assert.equal(isRawAccountIdentifier("U1234567"), true);
assert.equal(isRawAccountIdentifier("DU987654"), true);
assert.equal(isRawAccountIdentifier("12345678"), true);
assert.equal(isRawAccountIdentifier("a1"), false);
assert.equal(isUnsafePrivateLocator("https://example.com"), true);
assert.equal(isUnsafePrivateLocator("ibkr:live:a1"), false);

console.log("naming_canonical_validation: PASS");
