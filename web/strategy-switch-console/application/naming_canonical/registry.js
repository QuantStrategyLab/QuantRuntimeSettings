/**
 * NAMING-CANONICAL (Roadmap v2.0 Item 16): Non-breaking canonical naming registry.
 *
 * Pure leaf module under application/naming_canonical/:
 * - Never imports legacy Worker/DO modules, never accesses storage or network.
 * - Adds zero HTTP routes, Durable Object actions, or runtime authority.
 * - Preserves immutable legacy hashes/keys via non-destructive legacy_aliases.
 * - Rejects raw brokerage account IDs and unsafe private storage locators.
 */

export const NAMING_REGISTRY_SCHEMA = "qsl.canonical_naming_registry.v1";

export const CANONICAL_PLATFORM_SLUGS = Object.freeze([
  "schwab",
  "firstrade",
  "ibkr",
  "longbridge",
  "binance",
]);

export const CANONICAL_ENVIRONMENTS = Object.freeze([
  "live",
  "paper",
  "research",
]);

export const CANONICAL_MARKETS = Object.freeze([
  "us",
  "hk",
  "global",
  "crypto",
]);

export const CANONICAL_STRATEGY_DISPOSITIONS = Object.freeze([
  "active_pilot",
  "phase8_review",
  "archived",
]);

export const CANONICAL_RISK_TIER_MAP = Object.freeze({
  CAPITAL_PRESERVATION: "conservative",
  BALANCED_COMPOUNDING: "balanced",
  GROWTH_COMPOUNDING: "aggressive",
});

const REVERSE_RISK_TIER_MAP = Object.freeze(
  Object.fromEntries(
    Object.entries(CANONICAL_RISK_TIER_MAP).map(([consoleTier, engineTier]) => [engineTier, consoleTier]),
  ),
);

const PLATFORM_SLUG_SET = new Set(CANONICAL_PLATFORM_SLUGS);
const ENVIRONMENT_SET = new Set(CANONICAL_ENVIRONMENTS);
const DISPOSITION_SET = new Set(CANONICAL_STRATEGY_DISPOSITIONS);
const ALIAS_KINDS = new Set(["platforms", "accounts", "strategies", "plugins"]);

const ACCOUNT_SLOT_TUPLE_RE = /^(schwab|firstrade|ibkr|longbridge|binance):(live|paper|research):([a-z0-9][a-z0-9_-]{0,31})$/;
const STRATEGY_PROFILE_ID_RE = /^(us|hk|global|crypto)_([a-z0-9]+)_([a-z0-9]+)_([a-z0-9]+)$/;
const STRATEGY_VERSION_FIELD_RE = /^v[0-9]+(?:\.[0-9]+)*$/;
const STRATEGY_FORBIDDEN_SEGMENT_RE = /^(?:v\d+|conservative|balanced|aggressive)$/;
const STRATEGY_FORBIDDEN_EMBEDDED_RE = /(?:_v\d+(?:_|$)|_(?:conservative|balanced|aggressive|capital_preservation|balanced_compounding|growth_compounding)(?:_|$))/;
const PLUGIN_ID_RE = /^(obs|risk)_[a-z0-9]+(?:_[a-z0-9]+)*$/;

const PRIVATE_LOCATOR_KEYS = new Set([
  "source_ref",
  "kv_key",
  "do_key",
  "storage_key",
  "storage_path",
  "internal_locator",
  "broker_account_hash",
  "broker_account_id",
  "source_binding_id",
  "raw_path",
]);

const URI_SCHEME_PREFIX_RE = /^(?:https?|ftp|file|kv|do|gs|s3|r2|blob|data):/i;
const EMBEDDED_PRIVATE_PATH_RE = new RegExp(
  "(?:^|[\\s:(\\[\"'（])(?:/(?:tmp|var|etc|opt|mnt|" + "Users|" + "home)/|[A-Za-z]:\\\\|~/)" ,
  "i",
);
const PRIVATE_VALUE_RE = new RegExp(
  "(?:://|^[a-z][a-z0-9+.-]*:/|^~[/\\\\]|\\.\\.[/\\\\]|[?#]|&(?:X-Goog-|Signature|Expires|AWSAccessKeyId|token|sig|auth)=)",
  "i",
);

const RAW_U_DU_ACCOUNT_RE = /(?:^|[^A-Za-z0-9])d?u\d{5,}(?:$|[^A-Za-z0-9])/i;
const RAW_GROUPED_DIGITS_RE = /\d{3,}[-\s_]\d{3,}/;
const RAW_GROUPED_CANDIDATE_RE = /\d+(?:[-\s_]\d+)+/g;

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

export function isUnsafePrivateLocator(value) {
  if (typeof value !== "string") return false;
  return (
    URI_SCHEME_PREFIX_RE.test(value)
    || EMBEDDED_PRIVATE_PATH_RE.test(value)
    || PRIVATE_VALUE_RE.test(value)
  );
}

export function isRawAccountIdentifier(value) {
  if (typeof value !== "string") return false;
  if (
    RAW_U_DU_ACCOUNT_RE.test(value)
    || /\d{6,}/.test(value)
    || RAW_GROUPED_DIGITS_RE.test(value)
  ) {
    return true;
  }
  const matches = value.match(RAW_GROUPED_CANDIDATE_RE);
  if (matches) {
    for (const group of matches) {
      if (group.replace(/[-\s_]/g, "").length >= 6) return true;
    }
  }
  return false;
}

export function isValidPlatformSlug(slug) {
  return typeof slug === "string" && PLATFORM_SLUG_SET.has(slug);
}

export function parseAccountSlotKey(key) {
  if (typeof key !== "string" || !key.length) {
    return { ok: false, reason: "invalid_account_slot_type" };
  }
  if (isUnsafePrivateLocator(key)) {
    return { ok: false, reason: "unsafe_private_locator" };
  }
  const match = ACCOUNT_SLOT_TUPLE_RE.exec(key);
  if (!match) {
    if (isRawAccountIdentifier(key)) {
      return { ok: false, reason: "raw_account_id_prohibited" };
    }
    return { ok: false, reason: "invalid_account_slot_format" };
  }
  const [, platform, env, slot] = match;
  if (isRawAccountIdentifier(slot) || /\d{6,}/.test(slot)) {
    return { ok: false, reason: "raw_account_id_prohibited" };
  }
  return { ok: true, key, platform, env, slot };
}

export function formatAccountSlotKey(platform, env, slot) {
  if (!isValidPlatformSlug(platform) || typeof env !== "string" || !ENVIRONMENT_SET.has(env) || typeof slot !== "string") {
    return null;
  }
  const key = `${platform}:${env}:${slot}`;
  const parsed = parseAccountSlotKey(key);
  return parsed.ok ? parsed.key : null;
}

export function isValidStrategyProfileId(id) {
  if (typeof id !== "string" || !id.length) return false;
  if (isUnsafePrivateLocator(id) || isRawAccountIdentifier(id)) return false;
  if (STRATEGY_FORBIDDEN_EMBEDDED_RE.test(id)) return false;
  const match = STRATEGY_PROFILE_ID_RE.exec(id);
  if (!match) return false;
  const [, , asset, family, horizon] = match;
  return (
    !STRATEGY_FORBIDDEN_SEGMENT_RE.test(asset)
    && !STRATEGY_FORBIDDEN_SEGMENT_RE.test(family)
    && !STRATEGY_FORBIDDEN_SEGMENT_RE.test(horizon)
  );
}

export function isValidPluginId(id) {
  if (typeof id !== "string" || !id.length) return false;
  if (isUnsafePrivateLocator(id) || isRawAccountIdentifier(id)) return false;
  return PLUGIN_ID_RE.test(id);
}

export function pluginCapabilityClass(id) {
  if (!isValidPluginId(id)) return null;
  if (id.startsWith("obs_")) return "observer";
  if (id.startsWith("risk_")) return "risk_reduction";
  return null;
}

export function consoleTierToEngineTier(consoleTier) {
  if (typeof consoleTier !== "string") return null;
  return Object.hasOwn(CANONICAL_RISK_TIER_MAP, consoleTier)
    ? CANONICAL_RISK_TIER_MAP[consoleTier]
    : null;
}

export function engineTierToConsoleTier(engineTier) {
  if (typeof engineTier !== "string") return null;
  return Object.hasOwn(REVERSE_RISK_TIER_MAP, engineTier)
    ? REVERSE_RISK_TIER_MAP[engineTier]
    : null;
}

export const CANONICAL_NAMING_REGISTRY = deepFreeze({
  schema_version: NAMING_REGISTRY_SCHEMA,
  immutable_legacy_hashes: true,
  authority: {
    convention_only: true,
    authorizes_rename_or_migration: false,
    authorizes_deployment_or_trading: false,
  },
  platforms: {
    schwab: {
      slug: "schwab",
      status: "active",
      label_zh: "嘉信理财",
      label_en: "Schwab",
    },
    firstrade: {
      slug: "firstrade",
      status: "active",
      label_zh: "第一证券",
      label_en: "Firstrade",
    },
    ibkr: {
      slug: "ibkr",
      status: "active",
      label_zh: "盈透证券",
      label_en: "IBKR",
    },
    longbridge: {
      slug: "longbridge",
      status: "active",
      label_zh: "长桥证券",
      label_en: "LongBridge",
    },
    binance: {
      slug: "binance",
      status: "dormant",
      label_zh: "币安",
      label_en: "Binance",
    },
  },
  account_slots: [
    {
      slot_key: "ibkr:live:a1",
      platform: "ibkr",
      env: "live",
      slot: "a1",
      synthetic: true,
      label_zh: "盈透实盘槽位 a1",
      label_en: "IBKR Live Slot a1",
    },
    {
      slot_key: "ibkr:live:a2",
      platform: "ibkr",
      env: "live",
      slot: "a2",
      synthetic: true,
      label_zh: "盈透实盘槽位 a2",
      label_en: "IBKR Live Slot a2",
    },
    {
      slot_key: "ibkr:live:a3",
      platform: "ibkr",
      env: "live",
      slot: "a3",
      synthetic: true,
      label_zh: "盈透实盘槽位 a3",
      label_en: "IBKR Live Slot a3",
    },
    {
      slot_key: "ibkr:live:a4",
      platform: "ibkr",
      env: "live",
      slot: "a4",
      synthetic: true,
      label_zh: "盈透实盘槽位 a4",
      label_en: "IBKR Live Slot a4",
    },
    {
      slot_key: "longbridge:paper:pilot",
      platform: "longbridge",
      env: "paper",
      slot: "pilot",
      synthetic: true,
      label_zh: "长桥模拟试点槽位",
      label_en: "LongBridge Paper Pilot Slot",
    },
    {
      slot_key: "longbridge:live:sg",
      platform: "longbridge",
      env: "live",
      slot: "sg",
      synthetic: true,
      label_zh: "长桥新加坡实盘槽位",
      label_en: "LongBridge Live SG Slot",
    },
    {
      slot_key: "longbridge:live:hk",
      platform: "longbridge",
      env: "live",
      slot: "hk",
      synthetic: true,
      label_zh: "长桥香港实盘槽位",
      label_en: "LongBridge Live HK Slot",
    },
    {
      slot_key: "schwab:live:main",
      platform: "schwab",
      env: "live",
      slot: "main",
      synthetic: true,
      label_zh: "嘉信实盘主槽位",
      label_en: "Schwab Live Main Slot",
    },
    {
      slot_key: "firstrade:live:main",
      platform: "firstrade",
      env: "live",
      slot: "main",
      synthetic: true,
      label_zh: "第一证券实盘主槽位",
      label_en: "Firstrade Live Main Slot",
    },
    {
      slot_key: "binance:live:dormant",
      platform: "binance",
      env: "live",
      slot: "dormant",
      synthetic: true,
      label_zh: "币安实盘休眠槽位",
      label_en: "Binance Live Dormant Slot",
    },
    {
      slot_key: "binance:research:archive",
      platform: "binance",
      env: "research",
      slot: "archive",
      synthetic: true,
      label_zh: "币安研究存档槽位",
      label_en: "Binance Research Archive Slot",
    },
  ],
  strategies: [
    {
      strategy_id: "us_tqqq_trend_daily",
      market: "us",
      asset: "tqqq",
      family: "trend",
      horizon: "daily",
      version: "v5",
      risk_tier: "GROWTH_COMPOUNDING",
      disposition: "active_pilot",
      label_zh: "纳斯达克增长收益",
      label_en: "NASDAQ Growth Income",
    },
    {
      strategy_id: "us_soxl_trend_daily",
      market: "us",
      asset: "soxl",
      family: "trend",
      horizon: "daily",
      version: "v3",
      risk_tier: "GROWTH_COMPOUNDING",
      disposition: "active_pilot",
      label_zh: "半导体趋势收益",
      label_en: "Semiconductor Trend Income",
    },
    {
      strategy_id: "us_soxx_core_daily",
      market: "us",
      asset: "soxx",
      family: "core",
      horizon: "daily",
      version: "v7",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "active_pilot",
      label_zh: "SOXL/SOXX 核心复利（现金保留）",
      label_en: "SOXL/SOXX Core Compounding (Cash Reserve)",
    },
    {
      strategy_id: "global_etf_rot_weekly",
      market: "global",
      asset: "etf",
      family: "rot",
      horizon: "weekly",
      version: "v1",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "phase8_review",
      label_zh: "全球ETF轮动",
      label_en: "Global ETF Rotation",
    },
    {
      strategy_id: "us_russell50_rot_weekly",
      market: "us",
      asset: "russell50",
      family: "rot",
      horizon: "weekly",
      version: "v1",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "phase8_review",
      label_zh: "罗素Top50领涨",
      label_en: "Russell Top50 Leaders",
    },
    {
      strategy_id: "hk_etf_rot_weekly",
      market: "hk",
      asset: "etf",
      family: "rot",
      horizon: "weekly",
      version: "v1",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "phase8_review",
      label_zh: "港股ETF战术轮动",
      label_en: "HK ETF Tactical Rotation",
    },
    {
      strategy_id: "hk_div_qual_daily",
      market: "hk",
      asset: "div",
      family: "qual",
      horizon: "daily",
      version: "v1",
      risk_tier: "CAPITAL_PRESERVATION",
      disposition: "phase8_review",
      label_zh: "港股红利质量",
      label_en: "HK Dividend Quality",
    },
    {
      strategy_id: "us_ibit_dca_weekly",
      market: "us",
      asset: "ibit",
      family: "dca",
      horizon: "weekly",
      version: "v1",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "phase8_review",
      label_zh: "IBIT比特币定投",
      label_en: "IBIT Bitcoin DCA",
    },
    {
      strategy_id: "crypto_btc_dca_weekly",
      market: "crypto",
      asset: "btc",
      family: "dca",
      horizon: "weekly",
      version: "v1",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "phase8_review",
      label_zh: "BTC定投",
      label_en: "BTC DCA",
    },
    {
      strategy_id: "us_tecl_trend_daily",
      market: "us",
      asset: "tecl",
      family: "trend",
      horizon: "daily",
      version: "v1",
      risk_tier: "GROWTH_COMPOUNDING",
      disposition: "archived",
      label_zh: "TECL/XLK趋势收益",
      label_en: "TECL/XLK Trend Income",
    },
    {
      strategy_id: "us_ndx_dca_weekly",
      market: "us",
      asset: "ndx",
      family: "dca",
      horizon: "weekly",
      version: "v1",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "archived",
      label_zh: "纳指标普定投",
      label_en: "NASDAQ/S&P 500 DCA",
    },
    {
      strategy_id: "us_income_combo_daily",
      market: "us",
      asset: "income",
      family: "combo",
      horizon: "daily",
      version: "v1",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "archived",
      label_zh: "美股核心收益组合",
      label_en: "US Core Income Combo",
    },
    {
      strategy_id: "us_core_combo_daily",
      market: "us",
      asset: "core",
      family: "combo",
      horizon: "daily",
      version: "v1",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "archived",
      label_zh: "美股核心组合",
      label_en: "US Core Combo",
    },
    {
      strategy_id: "us_alpha_combo_daily",
      market: "us",
      asset: "alpha",
      family: "combo",
      horizon: "daily",
      version: "v1",
      risk_tier: "GROWTH_COMPOUNDING",
      disposition: "archived",
      label_zh: "美股加速组合",
      label_en: "US Alpha Combo",
    },
    {
      strategy_id: "hk_hsi_combo_daily",
      market: "hk",
      asset: "hsi",
      family: "combo",
      horizon: "daily",
      version: "v1",
      risk_tier: "BALANCED_COMPOUNDING",
      disposition: "archived",
      label_zh: "港股恒生组合",
      label_en: "HK Core Combo",
    },
    {
      strategy_id: "crypto_pool_rot_daily",
      market: "crypto",
      asset: "pool",
      family: "rot",
      horizon: "daily",
      version: "v1",
      risk_tier: "GROWTH_COMPOUNDING",
      disposition: "archived",
      label_zh: "加密池轮动",
      label_en: "Crypto Pool Rotation",
    },
    {
      strategy_id: "crypto_alt_trend_daily",
      market: "crypto",
      asset: "alt",
      family: "trend",
      horizon: "daily",
      version: "v1",
      risk_tier: "GROWTH_COMPOUNDING",
      disposition: "archived",
      label_zh: "山寨趋势轮动",
      label_en: "Altcoin Trend",
    },
    {
      strategy_id: "crypto_mom_combo_daily",
      market: "crypto",
      asset: "mom",
      family: "combo",
      horizon: "daily",
      version: "v1",
      risk_tier: "GROWTH_COMPOUNDING",
      disposition: "archived",
      label_zh: "加密动量组合",
      label_en: "Crypto Core Combo",
    },
  ],
  plugins: [
    {
      plugin_id: "obs_advisor_scorecard",
      capability_class: "observer",
      read_only: true,
      can_adjust_risk: false,
      max_scalar: null,
      can_bypass_fuse: false,
      status: "shadow_only",
      label_zh: "AI 投顾前瞻评分卡",
      label_en: "AI Advisory Scorecard",
    },
    {
      plugin_id: "obs_event_radar",
      capability_class: "observer",
      read_only: true,
      can_adjust_risk: false,
      max_scalar: null,
      can_bypass_fuse: false,
      status: "shadow_only",
      label_zh: "事件与情绪雷达",
      label_en: "Research & Event Radar",
    },
    {
      plugin_id: "risk_macro_governor",
      capability_class: "risk_reduction",
      read_only: false,
      can_adjust_risk: true,
      max_scalar: 1.0,
      can_bypass_fuse: false,
      status: "deferred",
      label_zh: "宏观风险调节器",
      label_en: "Macro Risk Governor",
    },
    {
      plugin_id: "risk_regime_control",
      capability_class: "risk_reduction",
      read_only: false,
      can_adjust_risk: true,
      max_scalar: 1.0,
      can_bypass_fuse: false,
      status: "deferred",
      label_zh: "市场状态风控",
      label_en: "Market Regime Control",
    },
  ],
  risk_tiers: {
    CAPITAL_PRESERVATION: {
      console_tier: "CAPITAL_PRESERVATION",
      engine_tier: "conservative",
      label_zh: "稳健保本",
      label_en: "Capital Preservation",
    },
    BALANCED_COMPOUNDING: {
      console_tier: "BALANCED_COMPOUNDING",
      engine_tier: "balanced",
      label_zh: "均衡复利",
      label_en: "Balanced Compounding",
    },
    GROWTH_COMPOUNDING: {
      console_tier: "GROWTH_COMPOUNDING",
      engine_tier: "aggressive",
      label_zh: "进取增长",
      label_en: "Growth Compounding",
    },
  },
  legacy_aliases: {
    platforms: [
      { legacy_id: "interactive-brokers", canonical_id: "ibkr" },
      { legacy_id: "interactive_brokers", canonical_id: "ibkr" },
      { legacy_id: "charles-schwab", canonical_id: "schwab" },
      { legacy_id: "charles_schwab", canonical_id: "schwab" },
      { legacy_id: "longport", canonical_id: "longbridge" },
      { legacy_id: "lb", canonical_id: "longbridge" },
    ],
    accounts: [
      { legacy_id: "ibkr:tqqq", canonical_id: "ibkr:live:a1" },
      { legacy_id: "ibkr:soxl", canonical_id: "ibkr:live:a2" },
      { legacy_id: "longbridge:paper", canonical_id: "longbridge:paper:pilot" },
      { legacy_id: "longbridge:sg", canonical_id: "longbridge:live:sg" },
      { legacy_id: "longbridge:hk", canonical_id: "longbridge:live:hk" },
      { legacy_id: "schwab:live", canonical_id: "schwab:live:main" },
      { legacy_id: "firstrade:live", canonical_id: "firstrade:live:main" },
      { legacy_id: "binance:live", canonical_id: "binance:live:dormant" },
      { legacy_id: "binance:research:legacy", canonical_id: "binance:research:archive" },
      { legacy_id: "binance:crypto_combo", canonical_id: "binance:research:archive" },
    ],
    strategies: [
      { legacy_id: "tqqq_growth_income", canonical_id: "us_tqqq_trend_daily" },
      { legacy_id: "soxl_soxx_trend_income", canonical_id: "us_soxl_trend_daily" },
      {
        legacy_id: "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve",
        canonical_id: "us_soxx_core_daily",
      },
      { legacy_id: "global_etf_rotation", canonical_id: "global_etf_rot_weekly" },
      { legacy_id: "global_etf_confidence_vol_gate", canonical_id: "global_etf_rot_weekly" },
      { legacy_id: "global_macro_etf_rotation", canonical_id: "global_etf_rot_weekly" },
      { legacy_id: "russell_top50_leader_rotation", canonical_id: "us_russell50_rot_weekly" },
      { legacy_id: "hk_global_etf_tactical_rotation", canonical_id: "hk_etf_rot_weekly" },
      { legacy_id: "hk_low_vol_dividend_quality_snapshot", canonical_id: "hk_div_qual_daily" },
      { legacy_id: "ibit_smart_dca", canonical_id: "us_ibit_dca_weekly" },
      { legacy_id: "bitcoin_etf_smart_dca", canonical_id: "us_ibit_dca_weekly" },
      { legacy_id: "crypto_btc_dca", canonical_id: "crypto_btc_dca_weekly" },
      { legacy_id: "tecl_xlk_trend_income", canonical_id: "us_tecl_trend_daily" },
      { legacy_id: "nasdaq_sp500_smart_dca", canonical_id: "us_ndx_dca_weekly" },
      { legacy_id: "us_equity_combo", canonical_id: "us_income_combo_daily" },
      { legacy_id: "us_equity_combo_core", canonical_id: "us_core_combo_daily" },
      { legacy_id: "us_equity_combo_leveraged", canonical_id: "us_alpha_combo_daily" },
      { legacy_id: "hk_equity_combo", canonical_id: "hk_hsi_combo_daily" },
      { legacy_id: "crypto_live_pool_rotation", canonical_id: "crypto_pool_rot_daily" },
      { legacy_id: "crypto_trend_rotation", canonical_id: "crypto_alt_trend_daily" },
      { legacy_id: "crypto_equity_combo", canonical_id: "crypto_mom_combo_daily" },
    ],
    plugins: [
      { legacy_id: "macro_risk_governor", canonical_id: "risk_macro_governor" },
      { legacy_id: "market_regime_control", canonical_id: "risk_regime_control" },
      { legacy_id: "advisor_scorecard", canonical_id: "obs_advisor_scorecard" },
      { legacy_id: "event_radar", canonical_id: "obs_event_radar" },
    ],
  },
});

function hasNonEmptyHumanLabel(value) {
  return typeof value === "string" && value.trim().length > 0 && !isUnsafePrivateLocator(value) && !isRawAccountIdentifier(value);
}

function scanSafetyViolations(value, path, errors) {
  if (typeof value === "string") {
    if (isUnsafePrivateLocator(value)) {
      errors.push(`${path}:unsafe_private_locator`);
    }
    if (isRawAccountIdentifier(value)) {
      errors.push(`${path}:raw_account_id_prohibited`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanSafetyViolations(value[i], `${path}[${i}]`, errors);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (PRIVATE_LOCATOR_KEYS.has(k)) {
        errors.push(`${path}.${k}:private_locator_key_prohibited`);
      }
      scanSafetyViolations(v, `${path}.${k}`, errors);
    }
  }
}

function canonicalIdSetForKind(registry, kind) {
  if (!registry || typeof registry !== "object") return new Set();
  if (kind === "platforms") {
    return new Set(Object.keys(registry.platforms || {}));
  }
  if (kind === "accounts") {
    return new Set(
      Array.isArray(registry.account_slots)
        ? registry.account_slots.map((item) => item?.slot_key).filter((v) => typeof v === "string")
        : [],
    );
  }
  if (kind === "strategies") {
    return new Set(
      Array.isArray(registry.strategies)
        ? registry.strategies.map((item) => item?.strategy_id).filter((v) => typeof v === "string")
        : [],
    );
  }
  if (kind === "plugins") {
    return new Set(
      Array.isArray(registry.plugins)
        ? registry.plugins.map((item) => item?.plugin_id).filter((v) => typeof v === "string")
        : [],
    );
  }
  return new Set();
}

function isValidCanonicalTargetForKind(kind, id) {
  if (kind === "platforms") return isValidPlatformSlug(id);
  if (kind === "accounts") return parseAccountSlotKey(id).ok;
  if (kind === "strategies") return isValidStrategyProfileId(id);
  if (kind === "plugins") return isValidPluginId(id);
  return false;
}

export function resolveCanonicalAlias(kind, name, registry = CANONICAL_NAMING_REGISTRY) {
  if (!ALIAS_KINDS.has(kind)) {
    return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "invalid_alias_kind" };
  }
  if (typeof name !== "string" || name.length === 0 || name.trim() !== name) {
    return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "invalid_input" };
  }
  if (isUnsafePrivateLocator(name)) {
    return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "unsafe_private_locator" };
  }
  if (isRawAccountIdentifier(name)) {
    return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "raw_account_id_prohibited" };
  }

  const canonicalSet = canonicalIdSetForKind(registry, kind);
  const entries = Array.isArray(registry?.legacy_aliases?.[kind]) ? registry.legacy_aliases[kind] : [];
  const exactTargets = new Map();
  const normalizedTargets = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry.legacy_id !== "string" || typeof entry.canonical_id !== "string") continue;
    const legacy = entry.legacy_id;
    const canonical = entry.canonical_id;
    if (!exactTargets.has(legacy)) exactTargets.set(legacy, new Set());
    exactTargets.get(legacy).add(canonical);
    const norm = legacy.trim().toLowerCase();
    if (!normalizedTargets.has(norm)) normalizedTargets.set(norm, new Set());
    normalizedTargets.get(norm).add(canonical);
  }

  const normInput = name.toLowerCase();
  const normConflictSet = normalizedTargets.get(normInput);

  if (canonicalSet.has(name)) {
    const selfExact = exactTargets.get(name);
    if ((selfExact && ([...selfExact].some((target) => target !== name) || selfExact.size > 1))
      || (normConflictSet && [...normConflictSet].some((target) => target !== name))) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "ambiguous_alias" };
    }
    if (!isValidCanonicalTargetForKind(kind, name)) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "invalid_canonical_id" };
    }
    return { ok: true, kind, input: name, canonical: name, aliased: false };
  }

  const exactMatchSet = exactTargets.get(name);
  if (exactMatchSet) {
    if (exactMatchSet.size > 1 || (normConflictSet && normConflictSet.size > 1)) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "ambiguous_alias" };
    }
    const target = [...exactMatchSet][0];
    if (!canonicalSet.has(target) || !isValidCanonicalTargetForKind(kind, target)) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "invalid_alias_target" };
    }
    return { ok: true, kind, input: name, canonical: target, aliased: true };
  }

  if (normConflictSet && normConflictSet.size > 1) {
    return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "ambiguous_alias" };
  }

  if (kind === "accounts" && !name.includes(":")) {
    const suffixMatches = new Set();
    for (const entry of entries) {
      if (typeof entry?.legacy_id !== "string" || typeof entry?.canonical_id !== "string") continue;
      const idx = entry.legacy_id.indexOf(":");
      if (idx > 0 && entry.legacy_id.slice(idx + 1) === name) {
        suffixMatches.add(entry.canonical_id);
      }
    }
    if (Array.isArray(registry?.account_slots)) {
      for (const slotItem of registry.account_slots) {
        if (slotItem?.slot === name && typeof slotItem?.slot_key === "string") {
          suffixMatches.add(slotItem.slot_key);
        }
      }
    }
    if (suffixMatches.size > 1) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "ambiguous_alias" };
    }
  }

  return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "unknown_alias" };
}

export function validateNamingRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    return { ok: false, errors: ["registry:must_be_object"] };
  }

  if (registry.schema_version !== NAMING_REGISTRY_SCHEMA) {
    errors.push("schema_version:invalid");
  }
  if (registry.immutable_legacy_hashes !== true) {
    errors.push("immutable_legacy_hashes:must_be_true");
  }
  if (
    registry.authority?.convention_only !== true
    || registry.authority?.authorizes_rename_or_migration !== false
    || registry.authority?.authorizes_deployment_or_trading !== false
  ) {
    errors.push("authority:invalid_boundary_flags");
  }

  scanSafetyViolations(registry, "registry", errors);

  // Platforms: closed 5-slug set, binance dormant, zero A-share venue.
  const platforms = registry.platforms;
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) {
    errors.push("platforms:must_be_object");
  } else {
    const keys = Object.keys(platforms);
    if (keys.length !== CANONICAL_PLATFORM_SLUGS.length || CANONICAL_PLATFORM_SLUGS.some((slug) => !Object.hasOwn(platforms, slug))) {
      errors.push("platforms:must_match_closed_slug_set");
    }
    for (const key of keys) {
      if (!isValidPlatformSlug(key)) {
        errors.push(`platforms.${key}:disallowed_platform_slug`);
        continue;
      }
      const entry = platforms[key];
      if (!entry || typeof entry !== "object") {
        errors.push(`platforms.${key}:invalid_entry`);
        continue;
      }
      if (entry.slug !== key) {
        errors.push(`platforms.${key}:slug_mismatch`);
      }
      if (entry.status !== "active" && entry.status !== "dormant") {
        errors.push(`platforms.${key}:invalid_status`);
      }
      if (key === "binance" && entry.status !== "dormant") {
        errors.push("platforms.binance:must_be_dormant");
      }
      if (!hasNonEmptyHumanLabel(entry.label_zh) || !hasNonEmptyHumanLabel(entry.label_en)) {
        errors.push(`platforms.${key}:labels_required`);
      }
    }
  }

  // Account slots: {platform}:{env}:{slot}, unique, zero raw account numbers.
  const accountSlotKeys = new Set();
  if (!Array.isArray(registry.account_slots) || registry.account_slots.length === 0) {
    errors.push("account_slots:must_be_non_empty_array");
  } else {
    for (let i = 0; i < registry.account_slots.length; i++) {
      const entry = registry.account_slots[i];
      const prefix = `account_slots[${i}]`;
      if (!entry || typeof entry !== "object") {
        errors.push(`${prefix}:invalid_entry`);
        continue;
      }
      const parsed = parseAccountSlotKey(entry.slot_key);
      if (!parsed.ok) {
        errors.push(`${prefix}:${parsed.reason}`);
      } else {
        if (entry.platform !== parsed.platform || entry.env !== parsed.env || entry.slot !== parsed.slot) {
          errors.push(`${prefix}:tuple_field_mismatch`);
        }
        if (accountSlotKeys.has(entry.slot_key)) {
          errors.push(`${prefix}:duplicate_slot_key`);
        }
        accountSlotKeys.add(entry.slot_key);
      }
      if (entry.synthetic !== true) {
        errors.push(`${prefix}:must_be_synthetic`);
      }
      if (!hasNonEmptyHumanLabel(entry.label_zh) || !hasNonEmptyHumanLabel(entry.label_en)) {
        errors.push(`${prefix}:labels_required`);
      }
    }
  }

  // Strategies: {market}_{asset}_{family}_{horizon}, separate version & risk_tier, unique IDs.
  const strategyIds = new Set();
  if (!Array.isArray(registry.strategies) || registry.strategies.length === 0) {
    errors.push("strategies:must_be_non_empty_array");
  } else {
    for (let i = 0; i < registry.strategies.length; i++) {
      const entry = registry.strategies[i];
      const prefix = `strategies[${i}]`;
      if (!entry || typeof entry !== "object") {
        errors.push(`${prefix}:invalid_entry`);
        continue;
      }
      if (!isValidStrategyProfileId(entry.strategy_id)) {
        errors.push(`${prefix}:invalid_strategy_id`);
      } else {
        if (strategyIds.has(entry.strategy_id)) {
          errors.push(`${prefix}:duplicate_strategy_id`);
        }
        strategyIds.add(entry.strategy_id);
        const expectedId = `${entry.market}_${entry.asset}_${entry.family}_${entry.horizon}`;
        if (entry.strategy_id !== expectedId) {
          errors.push(`${prefix}:tuple_field_mismatch`);
        }
      }
      if (typeof entry.version !== "string" || !STRATEGY_VERSION_FIELD_RE.test(entry.version)) {
        errors.push(`${prefix}:invalid_version_metadata`);
      }
      if (!Object.hasOwn(CANONICAL_RISK_TIER_MAP, entry.risk_tier)) {
        errors.push(`${prefix}:invalid_risk_tier`);
      }
      if (!DISPOSITION_SET.has(entry.disposition)) {
        errors.push(`${prefix}:invalid_disposition`);
      }
      if (!hasNonEmptyHumanLabel(entry.label_zh) || !hasNonEmptyHumanLabel(entry.label_en)) {
        errors.push(`${prefix}:labels_required`);
      }
    }
  }

  // Plugins: obs_* (read_only, no risk adjustment) vs risk_* (scalar <= 1.0); zero fuse bypass.
  const pluginIds = new Set();
  if (!Array.isArray(registry.plugins) || registry.plugins.length === 0) {
    errors.push("plugins:must_be_non_empty_array");
  } else {
    for (let i = 0; i < registry.plugins.length; i++) {
      const entry = registry.plugins[i];
      const prefix = `plugins[${i}]`;
      if (!entry || typeof entry !== "object") {
        errors.push(`${prefix}:invalid_entry`);
        continue;
      }
      const capClass = pluginCapabilityClass(entry.plugin_id);
      if (!capClass) {
        errors.push(`${prefix}:invalid_plugin_id`);
      } else {
        if (pluginIds.has(entry.plugin_id)) {
          errors.push(`${prefix}:duplicate_plugin_id`);
        }
        pluginIds.add(entry.plugin_id);
        if (entry.capability_class !== capClass) {
          errors.push(`${prefix}:capability_class_mismatch`);
        }
      }
      if (entry.can_bypass_fuse !== false) {
        errors.push(`${prefix}:fuse_bypass_prohibited`);
      }
      if (capClass === "observer") {
        if (entry.read_only !== true) {
          errors.push(`${prefix}:observer_must_be_read_only`);
        }
        if (entry.can_adjust_risk !== false) {
          errors.push(`${prefix}:observer_cannot_adjust_risk`);
        }
        if (entry.max_scalar !== null && entry.max_scalar !== 1.0) {
          errors.push(`${prefix}:observer_invalid_max_scalar`);
        }
      } else if (capClass === "risk_reduction") {
        if (entry.read_only !== false) {
          errors.push(`${prefix}:risk_plugin_read_only_mismatch`);
        }
        if (entry.can_adjust_risk !== true) {
          errors.push(`${prefix}:risk_plugin_must_declare_risk_adjustment`);
        }
        if (typeof entry.max_scalar !== "number" || !Number.isFinite(entry.max_scalar) || entry.max_scalar < 0 || entry.max_scalar > 1.0) {
          errors.push(`${prefix}:risk_plugin_max_scalar_out_of_bounds`);
        }
      }
      if (!hasNonEmptyHumanLabel(entry.label_zh) || !hasNonEmptyHumanLabel(entry.label_en)) {
        errors.push(`${prefix}:labels_required`);
      }
    }
  }

  // Risk tiers: strict 1:1 bijection.
  const riskTiers = registry.risk_tiers;
  const expectedConsoleTiers = Object.keys(CANONICAL_RISK_TIER_MAP);
  if (!riskTiers || typeof riskTiers !== "object" || Array.isArray(riskTiers)) {
    errors.push("risk_tiers:must_be_object");
  } else {
    const keys = Object.keys(riskTiers);
    if (keys.length !== expectedConsoleTiers.length || expectedConsoleTiers.some((t) => !Object.hasOwn(riskTiers, t))) {
      errors.push("risk_tiers:must_match_canonical_keys");
    }
    const seenEngine = new Set();
    for (const key of keys) {
      const entry = riskTiers[key];
      if (!entry || typeof entry !== "object") {
        errors.push(`risk_tiers.${key}:invalid_entry`);
        continue;
      }
      if (entry.console_tier !== key) {
        errors.push(`risk_tiers.${key}:console_tier_mismatch`);
      }
      if (entry.engine_tier !== CANONICAL_RISK_TIER_MAP[key]) {
        errors.push(`risk_tiers.${key}:engine_tier_mismatch`);
      }
      if (seenEngine.has(entry.engine_tier)) {
        errors.push(`risk_tiers.${key}:duplicate_engine_tier`);
      }
      seenEngine.add(entry.engine_tier);
      if (!hasNonEmptyHumanLabel(entry.label_zh) || !hasNonEmptyHumanLabel(entry.label_en)) {
        errors.push(`risk_tiers.${key}:labels_required`);
      }
    }
    if (seenEngine.size !== expectedConsoleTiers.length) {
      errors.push("risk_tiers:bijection_broken");
    }
  }

  // Legacy aliases: valid targets, no duplicates, no ambiguous collisions, no canonical shadowing.
  const aliases = registry.legacy_aliases;
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
    errors.push("legacy_aliases:must_be_object");
  } else {
    const aliasKeys = Object.keys(aliases);
    if (aliasKeys.length !== ALIAS_KINDS.size || [...ALIAS_KINDS].some((k) => !Object.hasOwn(aliases, k))) {
      errors.push("legacy_aliases:invalid_categories");
    }
    const targetSets = {
      platforms: new Set(Object.keys(platforms || {})),
      accounts: accountSlotKeys,
      strategies: strategyIds,
      plugins: pluginIds,
    };
    for (const kind of ALIAS_KINDS) {
      const list = aliases[kind];
      if (!Array.isArray(list)) {
        errors.push(`legacy_aliases.${kind}:must_be_array`);
        continue;
      }
      const seenExact = new Set();
      const seenNormTarget = new Map();
      const targets = targetSets[kind];
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const prefix = `legacy_aliases.${kind}[${i}]`;
        if (!item || typeof item !== "object") {
          errors.push(`${prefix}:invalid_entry`);
          continue;
        }
        if (typeof item.legacy_id !== "string" || item.legacy_id.trim() !== item.legacy_id || item.legacy_id.length === 0) {
          errors.push(`${prefix}:invalid_legacy_id`);
          continue;
        }
        if (typeof item.canonical_id !== "string" || !targets.has(item.canonical_id) || !isValidCanonicalTargetForKind(kind, item.canonical_id)) {
          errors.push(`${prefix}:invalid_canonical_target`);
        }
        if (targets.has(item.legacy_id) && item.canonical_id !== item.legacy_id) {
          errors.push(`${prefix}:shadows_canonical_id`);
        }
        if (seenExact.has(item.legacy_id)) {
          errors.push(`${prefix}:duplicate_legacy_id`);
        }
        seenExact.add(item.legacy_id);
        const norm = item.legacy_id.toLowerCase();
        if (seenNormTarget.has(norm) && seenNormTarget.get(norm) !== item.canonical_id) {
          errors.push(`${prefix}:ambiguous_normalized_alias`);
        }
        seenNormTarget.set(norm, item.canonical_id);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
