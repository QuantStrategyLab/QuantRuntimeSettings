/**
 * NAMING-CANONICAL (Roadmap v2.0 Item 16): Canonical naming domain constants.
 *
 * Pure zero-import constant table under application/naming_canonical/:
 * - Never imports helpers, Worker/DO modules, storage, or network.
 * - Preserves immutable legacy hashes/keys via non-destructive legacy_aliases.
 */

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

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

export const REVERSE_RISK_TIER_MAP = Object.freeze(
  Object.fromEntries(
    Object.entries(CANONICAL_RISK_TIER_MAP).map(([consoleTier, engineTier]) => [engineTier, consoleTier]),
  ),
);

export const PLATFORM_SLUG_SET = new Set(CANONICAL_PLATFORM_SLUGS);
export const ENVIRONMENT_SET = new Set(CANONICAL_ENVIRONMENTS);
export const DISPOSITION_SET = new Set(CANONICAL_STRATEGY_DISPOSITIONS);
export const ALIAS_KINDS = Object.freeze(["platforms", "accounts", "strategies", "plugins"]);
export const ALIAS_KIND_SET = new Set(ALIAS_KINDS);

export const ACCOUNT_SLOT_TUPLE_RE = /^(schwab|firstrade|ibkr|longbridge|binance):(live|paper|research):([a-z0-9][a-z0-9_-]{0,31})$/;
export const STRATEGY_PROFILE_ID_RE = /^(us|hk|global|crypto)_([a-z0-9]+)_([a-z0-9]+)_([a-z0-9]+)$/;
export const STRATEGY_VERSION_FIELD_RE = /^v[0-9]+(?:\.[0-9]+)*$/;
export const STRATEGY_FORBIDDEN_SEGMENT_RE = /^(?:v\d+|conservative|balanced|aggressive)$/;
export const STRATEGY_FORBIDDEN_EMBEDDED_RE = /(?:_v\d+(?:_|$)|_(?:conservative|balanced|aggressive|capital_preservation|balanced_compounding|growth_compounding)(?:_|$))/;
export const PLUGIN_ID_RE = /^(obs|risk)_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const PRIVATE_LOCATOR_KEYS = new Set([
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

export const URI_SCHEME_PREFIX_RE = /^(?:https?|ftp|file|kv|do|gs|s3|r2|blob|data):/i;
export const EMBEDDED_PRIVATE_PATH_RE = new RegExp(
  "(?:^|[\\s:(\\[\"'（])(?:/(?:tmp|var|etc|opt|mnt|" + "Users|" + "home)/|[A-Za-z]:\\\\|~/)" ,
  "i",
);
export const PRIVATE_VALUE_RE = new RegExp(
  "(?:://|^[a-z][a-z0-9+.-]*:/|^~[/\\\\]|\\.\\.[/\\\\]|[?#]|&(?:X-Goog-|Signature|Expires|AWSAccessKeyId|token|sig|auth)=)",
  "i",
);

export const RAW_U_DU_ACCOUNT_RE = /(?:^|[^A-Za-z0-9])d?u\d{5,}(?:$|[^A-Za-z0-9])/i;
export const RAW_SPLIT_DIGITS_RE = /[0-9](?:[-_. ]*[0-9]){5}/;
export const RAW_GROUPED_CANDIDATE_RE = /\d+(?:[-_.\s]+\d+)+/g;

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
