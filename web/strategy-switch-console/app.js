

    let platformMeta = {
      binance: { label: "Binance", code: "BN", accent: "var(--bn)" },
      firstrade: { label: "Firstrade", code: "FT", accent: "var(--ft)" },
      ibkr: { label: "IBKR", code: "IB", accent: "var(--ib)" },
      longbridge: { label: "LongBridge", code: "LB", accent: "var(--lb)" },
      qmt: { label: "QMT", code: "QM", accent: "var(--qmt)" },
      schwab: { label: "Schwab", code: "SW", accent: "var(--sw)" },
    };

    const platformRepositories = {
      binance: "QuantStrategyLab/BinancePlatform",
      firstrade: "QuantStrategyLab/FirstradePlatform",
      ibkr: "QuantStrategyLab/InteractiveBrokersPlatform",
      longbridge: "QuantStrategyLab/LongBridgePlatform",
      qmt: "QuantStrategyLab/QmtPlatform",
      schwab: "QuantStrategyLab/CharlesSchwabPlatform",
    };
    // Alias for backward compatibility
    const defaultRepositories = platformRepositories;

    const defaultAccountOptions = window.__DEFAULT_ACCOUNT_OPTIONS__ || {
      binance: [{"key": "default", "label": "Binance", "target_name": "default", "cash_currency": "USD", "supported_domains": ["crypto"]}],
      firstrade: [{"key": "preview", "label": "Firstrade", "target_name": "preview", "supported_domains": ["us_equity"], "cash_currency": "USD", "default_execution_mode": "live", "service_name": "firstrade-quant-service"}],
      ibkr: [{"key": "preview", "label": "IBKR", "target_name": "preview", "supported_domains": ["us_equity", "hk_equity"], "cash_currency": "USD", "default_execution_mode": "live"}],
      longbridge: [{"key": "preview", "label": "LongBridge", "target_name": "preview", "supported_domains": ["us_equity", "hk_equity"], "cash_currency": "USD", "default_execution_mode": "live"}],
      qmt: [{"key": "default", "label": "QMT", "target_name": "default", "cash_currency": "CNY", "supported_domains": ["cn_equity"], "service_name": "qmt-quant-service"}],
      schwab: [{"key": "preview", "label": "Schwab", "target_name": "preview", "supported_domains": ["us_equity"], "cash_currency": "USD", "default_execution_mode": "live", "service_name": "charles-schwab-quant-service"}],
    };

    const domainLabels = window.__DOMAIN_LABELS__ || {
      cn_equity: { zh: "A股", en: "CN A-share" },
      crypto: { zh: "加密", en: "Crypto" },
      hk_equity: { zh: "港股", en: "HK Equity" },
      us_equity: { zh: "美股", en: "US Equity" },
    };

    const platformConfig = window.__PLATFORM_CONFIG__ || {
      binance: {
        dry_run_only: false,
        margin_policy: false,
        reserved_cash: false,
        income_layer: false,
        option_overlay: false,
        dca: false,
        execution_mode: "live",
        service_name: "",
        default_execution_mode: "live"
      },
      firstrade: {
        dry_run_only: false,
        margin_policy: true,
        reserved_cash: true,
        income_layer: true,
        option_overlay: true,
        dca: true,
        execution_mode: "live",
        service_name: "firstrade-quant-service",
        default_execution_mode: "live"
      },
      ibkr: {
        dry_run_only: false,
        margin_policy: true,
        reserved_cash: true,
        income_layer: true,
        option_overlay: true,
        dca: true,
        execution_mode: "live",
        service_name: "",
        default_execution_mode: "live"
      },
      longbridge: {
        dry_run_only: false,
        margin_policy: true,
        reserved_cash: true,
        income_layer: true,
        option_overlay: true,
        dca: true,
        execution_mode: "live",
        service_name: "",
        default_execution_mode: "live"
      },
      qmt: {
        dry_run_only: true,
        margin_policy: false,
        reserved_cash: false,
        income_layer: false,
        option_overlay: false,
        dca: false,
        execution_mode: "paper",
        service_name: "qmt-quant-service",
        default_execution_mode: "paper"
      },
      schwab: {
        dry_run_only: false,
        margin_policy: true,
        reserved_cash: true,
        income_layer: true,
        option_overlay: true,
        dca: true,
        execution_mode: "live",
        service_name: "charles-schwab-quant-service",
        default_execution_mode: "live"
      },
    };


































    const reservePolicyModes = ["none", "ratio", "floor", "max"];
    const incomeLayerModes = ["enabled", "disabled"];
    const optionOverlayModes = ["enabled", "disabled"];
    const cashOnlyExecutionModes = ["enabled", "disabled"];
    const runtimeTargetModes = ["enabled", "disabled"];
    const pluginModes = ["auto", "none"];
    const dcaModes = ["fixed", "smart"];
    const runtimeTargetEnabledVariable = "RUNTIME_TARGET_ENABLED";
    const incomeLayerEnabledVariable = "INCOME_LAYER_ENABLED";
    const incomeLayerStartUsdVariable = "INCOME_LAYER_START_USD";
    const incomeLayerMaxRatioVariable = "INCOME_LAYER_MAX_RATIO";
    const dcaProfileDefaults = window.__DCA_PROFILE_DEFAULTS__ || {
      nasdaq_sp500_smart_dca: { defaultMode: "fixed", defaultBaseInvestmentUsd: "1000" },
      ibit_smart_dca: { defaultMode: "fixed", defaultBaseInvestmentUsd: "1000" },
    };
    const APP_BOOT_TIMEOUT_MS = 15000;
    const platformMinReservedCashVariables = {
      longbridge: "LONGBRIDGE_MIN_RESERVED_CASH_USD",
      ibkr: "IBKR_MIN_RESERVED_CASH_USD",
      schwab: "SCHWAB_MIN_RESERVED_CASH_USD",
      firstrade: "FIRSTRADE_MIN_RESERVED_CASH_USD",
    };
    const platformReservedCashRatioVariables = {
      longbridge: "LONGBRIDGE_RESERVED_CASH_RATIO",
      ibkr: "IBKR_RESERVED_CASH_RATIO",
      schwab: "SCHWAB_RESERVED_CASH_RATIO",
      firstrade: "FIRSTRADE_RESERVED_CASH_RATIO",
    };

    const defaultStrategyProfiles = window.__DEFAULT_STRATEGY_PROFILES__ || [
      {
        "profile": "tqqq_growth_income",
        "label": "纳斯达克增长收益",
        "label_en": "NASDAQ Growth Income",
        "label_zh": "纳斯达克增长收益",
        "domain": "us_equity",
        "runtime_enabled": true,
        "income_layer_enabled": true,
        "option_overlay_enabled": true,
        "combo_enabled": false,
        "lifecycle_stage": "runtime_enabled",
        "can_switch_live": true,
        "allowed_execution_modes": [
          "live",
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "",
        "income_layer_start_usd": "250000",
        "income_layer_max_ratio": "0.55",
        "income_layer_allocations": {
          "SCHD": 0.3,
          "DGRO": 0.2,
          "SGOV": 0.4,
          "SPYI": 0.08,
          "QQQI": 0.02
        },
        "option_overlay_live_gate": "promotion_required",
        "option_overlay_live_status": "research_only",
        "option_growth_overlay_enabled": true,
        "option_growth_overlay_recipe": "tqqq_leaps_growth_v1",
        "option_growth_overlay_start_usd": "250000",
        "option_growth_overlay_nav_budget_ratio": "0.03"
      },
      {
        "profile": "soxl_soxx_trend_income",
        "label": "半导体趋势收益",
        "label_en": "Semiconductor Trend Income",
        "label_zh": "半导体趋势收益",
        "domain": "us_equity",
        "runtime_enabled": true,
        "income_layer_enabled": true,
        "option_overlay_enabled": true,
        "combo_enabled": false,
        "lifecycle_stage": "runtime_enabled",
        "can_switch_live": true,
        "allowed_execution_modes": [
          "live",
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "",
        "income_layer_start_usd": "150000",
        "income_layer_max_ratio": "0.95",
        "income_layer_allocations": {
          "SCHD": 0.15,
          "DGRO": 0.1,
          "SGOV": 0.7,
          "SPYI": 0.04,
          "QQQI": 0.01
        },
        "option_overlay_live_gate": "promotion_required",
        "option_overlay_live_status": "research_only",
        "option_income_overlay_enabled": true,
        "option_income_overlay_recipe": "soxx_put_credit_spread_income_v1",
        "option_income_overlay_start_usd": "150000",
        "option_income_overlay_nav_risk_ratio": "0.01"
      },
      {
        "profile": "nasdaq_sp500_smart_dca",
        "label": "纳指标普定投",
        "label_en": "NASDAQ/S&P 500 DCA",
        "label_zh": "纳指标普定投",
        "domain": "us_equity",
        "runtime_enabled": true,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "runtime_enabled",
        "can_switch_live": true,
        "allowed_execution_modes": [
          "live",
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "",
        "dca_enabled": true,
        "dca_default_mode": "fixed",
        "dca_default_base_investment_usd": "1000"
      },
      {
        "profile": "ibit_smart_dca",
        "label": "IBIT比特币定投",
        "label_en": "IBIT Bitcoin DCA",
        "label_zh": "IBIT比特币定投",
        "domain": "us_equity",
        "runtime_enabled": true,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "runtime_enabled",
        "can_switch_live": true,
        "allowed_execution_modes": [
          "live",
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "",
        "dca_enabled": true,
        "dca_default_mode": "fixed",
        "dca_default_base_investment_usd": "1000"
      },
      {
        "profile": "global_etf_rotation",
        "label": "全球ETF轮动",
        "label_en": "Global ETF Rotation",
        "label_zh": "全球ETF轮动",
        "domain": "us_equity",
        "runtime_enabled": true,
        "income_layer_enabled": true,
        "option_overlay_enabled": true,
        "combo_enabled": false,
        "lifecycle_stage": "runtime_enabled",
        "can_switch_live": true,
        "allowed_execution_modes": [
          "live",
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "",
        "income_layer_start_usd": "500000",
        "income_layer_max_ratio": "0.15",
        "income_layer_allocations": {
          "SCHD": 0.4,
          "DGRO": 0.25,
          "SGOV": 0.3,
          "SPYI": 0.05
        },
        "option_overlay_live_gate": "promotion_required",
        "option_overlay_live_status": "research_only",
        "option_growth_overlay_enabled": true,
        "option_growth_overlay_recipe": "spy_leaps_growth_v1",
        "option_growth_overlay_start_usd": "500000",
        "option_growth_overlay_nav_budget_ratio": "0.015"
      },
      {
        "profile": "russell_top50_leader_rotation",
        "label": "罗素Top50领涨",
        "label_en": "Russell Top50 Leaders",
        "label_zh": "罗素Top50领涨",
        "domain": "us_equity",
        "runtime_enabled": true,
        "income_layer_enabled": true,
        "option_overlay_enabled": true,
        "combo_enabled": false,
        "lifecycle_stage": "runtime_enabled",
        "can_switch_live": true,
        "allowed_execution_modes": [
          "live",
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "",
        "income_layer_start_usd": "300000",
        "income_layer_max_ratio": "0.25",
        "income_layer_allocations": {
          "SCHD": 0.45,
          "DGRO": 0.3,
          "SGOV": 0.25
        },
        "option_overlay_live_gate": "promotion_required",
        "option_overlay_live_status": "research_only",
        "option_growth_overlay_enabled": true,
        "option_growth_overlay_recipe": "spy_leaps_growth_v1",
        "option_growth_overlay_start_usd": "300000",
        "option_growth_overlay_nav_budget_ratio": "0.015"
      },
      {
        "profile": "tecl_xlk_trend_income",
        "label": "TECL/XLK趋势收益",
        "label_en": "TECL/XLK Trend Income",
        "label_zh": "TECL/XLK趋势收益",
        "domain": "us_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "failed_promotion_vs_live_profiles"
      },
      {
        "profile": "us_equity_combo",
        "label": "美股核心组合",
        "label_en": "US Core Combo",
        "label_zh": "美股核心组合",
        "domain": "us_equity",
        "runtime_enabled": false,
        "income_layer_enabled": true,
        "option_overlay_enabled": true,
        "combo_enabled": true,
        "lifecycle_stage": "shadow_candidate",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "shadow_candidate_requires_evidence_package",
        "combo_mode": "dynamic",
        "income_layer_start_usd": "300000",
        "income_layer_max_ratio": "0.25",
        "income_layer_allocations": {
          "SCHD": 0.25,
          "DGRO": 0.25,
          "SGOV": 0.2,
          "SPYI": 0.15,
          "QQQI": 0.15
        },
        "option_overlay_live_gate": "promotion_required",
        "option_overlay_live_status": "research_only",
        "option_growth_overlay_enabled": true,
        "option_growth_overlay_recipe": "spy_leaps_growth_v1",
        "option_growth_overlay_start_usd": "300000",
        "option_growth_overlay_nav_budget_ratio": "0.015"
      },
      {
        "profile": "us_equity_combo_core",
        "label": "美股核心组合影子",
        "label_en": "US Core Combo Shadow",
        "label_zh": "美股核心组合影子",
        "domain": "us_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": true,
        "lifecycle_stage": "shadow_candidate",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "shadow_candidate_requires_evidence_package",
        "combo_mode": "dynamic"
      },
      {
        "profile": "us_equity_combo_leveraged",
        "label": "美股加速组合",
        "label_en": "US Alpha Combo",
        "label_zh": "美股加速组合",
        "domain": "us_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": true,
        "lifecycle_stage": "shadow_candidate",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "shadow_candidate_requires_evidence_package",
        "combo_mode": "dynamic"
      },
      {
        "profile": "hk_global_etf_tactical_rotation",
        "label": "港股ETF战术轮动",
        "label_en": "HK ETF Tactical Rotation",
        "label_zh": "港股ETF战术轮动",
        "domain": "hk_equity",
        "runtime_enabled": true,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "runtime_enabled",
        "can_switch_live": true,
        "allowed_execution_modes": [
          "live",
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": ""
      },
      {
        "profile": "hk_low_vol_dividend_quality_snapshot",
        "label": "港股红利质量",
        "label_en": "HK Dividend Quality",
        "label_zh": "港股红利质量",
        "domain": "hk_equity",
        "runtime_enabled": true,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "runtime_enabled",
        "can_switch_live": true,
        "allowed_execution_modes": [
          "live",
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": ""
      },
      {
        "profile": "hk_equity_combo",
        "label": "港股恒生组合",
        "label_en": "HK Core Combo",
        "label_zh": "港股恒生组合",
        "domain": "hk_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": true,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package",
        "combo_mode": "dynamic"
      },
      {
        "profile": "cn_industry_etf_rotation",
        "label": "A股行业ETF轮动",
        "label_en": "CN Industry ETF Rotation",
        "label_zh": "A股行业ETF轮动",
        "domain": "cn_equity",
        "runtime_enabled": true,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "runtime_enabled",
        "can_switch_live": true,
        "allowed_execution_modes": [
          "live",
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": ""
      },
      {
        "profile": "cn_industry_etf_rotation_aggressive",
        "label": "A股ETF轮动",
        "label_en": "CN ETF Rotation",
        "label_zh": "A股ETF轮动",
        "domain": "cn_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "live_candidate",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "live_candidate_requires_evidence_package"
      },
      {
        "profile": "cn_index_etf_tactical_rotation",
        "label": "A股宽基ETF战术轮动",
        "label_en": "CN Index ETF Tactical Rotation",
        "label_zh": "A股宽基ETF战术轮动",
        "domain": "cn_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package"
      },
      {
        "profile": "cn_chinext_tactical_rotation",
        "label": "创业板战术轮动",
        "label_en": "CN ChiNext Tactical Rotation",
        "label_zh": "创业板战术轮动",
        "domain": "cn_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package"
      },
      {
        "profile": "cn_chinext_growth_momentum_quality",
        "label": "创业板成长动量质量",
        "label_en": "CN ChiNext Growth Momentum Quality",
        "label_zh": "创业板成长动量质量",
        "domain": "cn_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package"
      },
      {
        "profile": "cn_dividend_quality_snapshot",
        "label": "A股红利质量",
        "label_en": "CN Dividend Quality",
        "label_zh": "A股红利质量",
        "domain": "cn_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package"
      },
      {
        "profile": "cn_chinext_growth_momentum_quality_snapshot",
        "label": "创业板成长质量快照",
        "label_en": "CN ChiNext Growth Quality Snapshot",
        "label_zh": "创业板成长质量快照",
        "domain": "cn_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package"
      },
      {
        "profile": "cn_star_growth_momentum_quality",
        "label": "科创板成长动量质量",
        "label_en": "CN STAR Growth Momentum Quality",
        "label_zh": "科创板成长动量质量",
        "domain": "cn_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package"
      },
      {
        "profile": "cn_equity_combo",
        "label": "A股进取组合",
        "label_en": "CN Alpha Combo",
        "label_zh": "A股进取组合",
        "domain": "cn_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": true,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package",
        "combo_mode": "dynamic"
      },
      {
        "profile": "crypto_live_pool_rotation",
        "label": "加密实时池轮动",
        "label_en": "Crypto Live Pool Rotation",
        "label_zh": "加密实时池轮动",
        "domain": "crypto",
        "runtime_enabled": true,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "runtime_enabled",
        "can_switch_live": true,
        "allowed_execution_modes": [
          "live",
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": ""
      },
      {
        "profile": "crypto_btc_dca",
        "label": "BTC定投",
        "label_en": "BTC DCA",
        "label_zh": "BTC定投",
        "domain": "crypto",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "shadow_candidate",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "shadow_candidate_requires_evidence_package"
      },
      {
        "profile": "crypto_trend_rotation",
        "label": "山寨趋势轮动",
        "label_en": "Altcoin Trend",
        "label_zh": "山寨趋势轮动",
        "domain": "crypto",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package"
      },
      {
        "profile": "crypto_equity_combo",
        "label": "加密动量组合",
        "label_en": "Crypto Core Combo",
        "label_zh": "加密动量组合",
        "domain": "crypto",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": true,
        "lifecycle_stage": "research_backtest_only",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package",
        "combo_mode": "dynamic"
      }
    ];

    const localStrategyLabels = {
      tqqq_growth_income: { zh: "纳斯达克增长收益", en: "NASDAQ Growth Income" },
      soxl_soxx_trend_income: { zh: "半导体趋势收益", en: "Semiconductor Trend Income" },
      nasdaq_sp500_smart_dca: { zh: "纳指标普定投", en: "NASDAQ/S&P 500 DCA" },
      ibit_smart_dca: { zh: "IBIT比特币定投", en: "IBIT Bitcoin DCA" },
      global_etf_rotation: { zh: "全球ETF轮动", en: "Global ETF Rotation" },
      russell_top50_leader_rotation: { zh: "罗素Top50领涨", en: "Russell Top50 Leaders" },
      hk_global_etf_tactical_rotation: { zh: "港股ETF战术轮动", en: "HK ETF Tactical Rotation" },
      hk_low_vol_dividend_quality_snapshot: { zh: "港股红利质量", en: "HK Dividend Quality" },
      cn_industry_etf_rotation: { zh: "A股行业ETF轮动", en: "CN Industry ETF Rotation" },
      cn_dividend_quality_snapshot: { zh: "A股红利质量", en: "CN Dividend Quality" },
      us_equity_combo: { zh: "美股核心组合", en: "US Core Combo" },
      us_equity_combo_leveraged: { zh: "美股加速组合", en: "US Alpha Combo" },
      hk_equity_combo: { zh: "港股恒生组合", en: "HK Core Combo" },
      cn_industry_etf_rotation_aggressive: { zh: "A股ETF轮动", en: "CN ETF Rotation" },
      cn_stock_momentum_rotation: { zh: "A股个股动量", en: "CN Stock Momentum" },
      cn_equity_combo: { zh: "A股进取组合", en: "CN Alpha Combo" },
      crypto_btc_dca: { zh: "BTC定投", en: "BTC DCA" },
      crypto_trend_rotation: { zh: "山寨趋势轮动", en: "Altcoin Trend" },
      crypto_equity_combo: { zh: "加密动量组合", en: "Crypto Core Combo" },
    };

    const fallbackIncomeLayerDefaults = window.__INCOME_LAYER_DEFAULTS__ || {
      tqqq_growth_income: {
        startUsd: 250000,
        maxRatio: "0.55",
        allocations: { SCHD: 0.30, DGRO: 0.20, SGOV: 0.40, SPYI: 0.08, QQQI: 0.02 },
      },
      soxl_soxx_trend_income: {
        startUsd: 150000,
        maxRatio: "0.95",
        allocations: { SCHD: 0.15, DGRO: 0.10, SGOV: 0.70, SPYI: 0.04, QQQI: 0.01 },
      },
      global_etf_rotation: {
        startUsd: 500000,
        maxRatio: "0.15",
        allocations: { SCHD: 0.40, DGRO: 0.25, SGOV: 0.30, SPYI: 0.05 },
      },
      russell_top50_leader_rotation: {
        startUsd: 300000,
        maxRatio: "0.25",
        allocations: { SCHD: 0.45, DGRO: 0.30, SGOV: 0.25 },
      },
      us_equity_combo: {
        startUsd: 300000,
        maxRatio: "0.25",
        allocations: { SCHD: 0.25, DGRO: 0.25, SGOV: 0.20, SPYI: 0.15, QQQI: 0.15 },
      }};
    let incomeLayerDefaults = {};
    const fallbackOptionOverlayDefaults = window.__OPTION_OVERLAY_DEFAULTS__ || {
      tqqq_growth_income: {
        liveGate: "promotion_required",
        liveStatus: "research_only",
        families: [
          { family: "growth", recipe: "tqqq_leaps_growth_v1", startUsd: "250000", ratio: "0.03", ratioKind: "budget" },
        ],
      },
      soxl_soxx_trend_income: {
        liveGate: "promotion_required",
        liveStatus: "research_only",
        families: [
          { family: "income", recipe: "soxx_put_credit_spread_income_v1", startUsd: "150000", ratio: "0.01", ratioKind: "risk" },
        ],
      },
      global_etf_rotation: {
        liveGate: "promotion_required",
        liveStatus: "research_only",
        families: [
          { family: "growth", recipe: "spy_leaps_growth_v1", startUsd: "500000", ratio: "0.015", ratioKind: "budget" },
        ],
      },
      russell_top50_leader_rotation: {
        liveGate: "promotion_required",
        liveStatus: "research_only",
        families: [
          { family: "growth", recipe: "spy_leaps_growth_v1", startUsd: "300000", ratio: "0.015", ratioKind: "budget" },
        ],
      },
      us_equity_combo: {
        liveGate: "promotion_required",
        liveStatus: "research_only",
        families: [
          { family: "growth", recipe: "spy_leaps_growth_v1", startUsd: "300000", ratio: "0.015", ratioKind: "budget" },
        ],
      },
      us_equity_combo_leveraged: {
        liveGate: "promotion_required",
        liveStatus: "research_only",
        families: [],
      }};
    let optionOverlayDefaults = {};

    const strategyDomains = ["us_equity", "hk_equity", "cn_equity", "crypto"];
    let strategyOptions = [];
    let strategyLabels = {};
    let strategyCatalog = {};


    const copy = {
      zh: {
        appTitle: "策略切换",
        appSubtitle: "选平台、目标账号和策略，一次执行完成切换。",
        healthView: "策略健康",
        switchView: "实盘切换",
        healthEyebrow: "策略健康 / 只读",
        healthTitle: "先看机器结论，再决定动作。",
        healthSubtitle: "健康不等于已批准 live；正常实盘、资金和杠杆变更仍需人工确认。",
        healthTotal: "策略总数",
        healthHealthy: "健康",
        healthWatch: "观察",
        healthReview: "需要复核",
        healthBoard: "策略状态",
        bootKicker: "初始化控制台",
        bootTitle: "读取策略配置",
        bootMessage: "正在读取登录状态、账号配置和当前状态。",
        bootStrategy: "正在读取策略目录。",
        bootSession: "正在验证登录状态。",
        bootConfig: "正在读取账号配置和当前状态。",
        bootTimeout: "加载超时，已切换到公开预览（登录后可重试）。",
        bootPublic: "公开预览已就绪。",
        login: "登录",
        logout: "退出",
        signedInAs: "已登录 {login}",
        activePlatform: "当前平台",
        account: "目标账号",
        strategy: "策略",
        mode: "模式",
        live: "实盘",
        paper: "模拟",
        runtimeTargetMode: "账号运行状态",
        runtimeSectionTitle: "运行与插件",
        runtimeTargetCurrent: "沿用当前状态",
        runtimeTargetEnabled: "启用",
        runtimeTargetDisabled: "禁用",
        runtimeTargetModeMeta: "停用后正式运行会跳过，模拟运行和健康检查仍可用。",
        pluginMode: "插件启用范围",
        pluginModeAuto: "启用插件",
        pluginModeNone: "禁用插件",
        pluginModeMeta: "选择是否启用该策略的插件。",
        incomeLayerMode: "收入层状态",
        incomeLayerSectionTitle: "收入层",
        incomeLayerCurrent: "沿用当前配置",
        incomeLayerEnabled: "开启收入层",
        incomeLayerDisabled: "关闭收入层",
        incomeLayerNotSupported: "该策略未定义收入层",
        incomeLayerStartUsd: "收入层起始金额",
        incomeLayerMaxRatio: "收入层最高比例",
        incomeLayerModeMeta: "仅对已定义收入层的美股策略生效。",
        incomeLayerDefaultMeta: "策略默认：起始 {start}，最高 {ratio}。",
        incomeLayerAllocationMeta: "默认分配：{allocations}。",
        incomeLayerStartMeta: "总资产达到该金额后启用收入层。",
        incomeLayerRatioMeta: "例如 0.55 表示最高 55%。",
        optionOverlayMode: "期权层状态",
        optionOverlaySectionTitle: "期权层",
        optionOverlayCurrent: "沿用当前配置",
        optionOverlayEnabled: "启用期权层",
        optionOverlayDisabled: "关闭期权层",
        optionOverlayNotSupported: "该策略未定义期权层",
        optionOverlayModeMeta: "启用时使用策略默认的最佳 recipe 和预算，不在这里手动调比例。",
        optionOverlayDefaultMeta: "{defaults}",
        optionOverlayFamilyGrowth: "增长",
        optionOverlayFamilyIncome: "收入",
        optionOverlayBudgetRatio: "预算 {ratio}",
        optionOverlayRiskRatio: "风险 {ratio}",
        cashOnlyExecutionMode: "允许融资",
        cashOnlyExecutionCurrent: "沿用当前配置",
        cashOnlyExecutionYes: "是",
        cashOnlyExecutionNo: "否",
        cashOnlyExecutionModeMeta: "选「否」时只按真实现金下单，不会动用 margin 购买力。",
        cashOnlyExecutionValueYes: "是",
        cashOnlyExecutionValueNo: "否",
        currentCashOnlyExecution: "当前允许融资",
        pendingCashOnlyExecution: "待提交允许融资",
        executionCashPolicyTitle: "现金与融资",
        executionCashPolicyNote: "允许融资与预留现金覆盖不能同时生效；选「是」会清空预留覆盖，设预留覆盖会强制「否」。",
        executionCashMarginBlocksReserve: "已选允许融资；提交时会清空预留现金覆盖。",
        executionCashReserveBlocksMargin: "已设预留现金覆盖；提交时会强制不允许融资。",
        qmtPlatformCashNote: "A 股 QMT 不使用 margin / 平台预留现金；现金约束在策略参数 execution_cash_reserve_ratio 内配置。",
        qmtDryRunOnlyNote: "QMT 当前仅支持 dry-run（模拟），尚无 live 券商账号。",
        binancePlatformNote: "Binance 平台不使用券商级收入层与期权层；相关功能由策略内部实现。",
        invalidExecutionCashPolicyNote: "允许融资与预留现金覆盖冲突，请只保留一种约束。",
        dcaMode: "定投模式",
        dcaSectionTitle: "定投",
        dcaModeFixed: "定额定投",
        dcaModeSmart: "智能定投",
        dcaBaseInvestmentUsd: "定投基准金额",
        dcaModeMeta: "仅定投策略可配置。",
        dcaDefaultMeta: "默认：{mode}，基准金额 {amount}。",
        dcaNotSupported: "该策略不是定投策略",
        dcaPlatformNotSupported: "当前平台不支持定投策略",
        currentDca: "当前定投设置",
        pendingDca: "待提交定投设置",
        dcaText: "{mode}，基准金额 {amount}",
        minReservedCash: "最小预留现金 ({currency})",
        reservedCashRatio: "预留现金比例",
        reservedCashMode: "预留现金策略",
        reservePolicyCurrent: "沿用当前配置",
        reservePolicyNone: "不设置平台预留现金",
        reservePolicyRatio: "仅按比例",
        reservePolicyFloor: "仅按固定金额",
        reservePolicyMax: "固定金额和比例取较大值",
        reservedCashModeMeta: "选择是否沿用、清空或覆盖平台预留现金。",
        reservedCashNone: "不设置",
        reservedCashDefault: "未配置（平台默认：0 {currency} / 0%）",
        reservedCashMeta: "固定金额下限，可单独设置或与比例取较大值。",
        reservedCashRatioMeta: "例如 0.03 表示 3%。",
        summary: "当前 / 待提交",
        copySummary: "复制状态",
        loginToRun: "登录后切换",
        loadingConfig: "读取配置中",
        configureAccounts: "配置账号后切换",
        runSwitch: "一键切换",
        noChanges: "无变更",
        readonlyNote: "登录后才可执行切换。",
        publicReadonly: "登录后查看账号配置。",
        loadingConfigNote: "正在读取账号配置和当前状态。",
        missingConfigNote: "账号配置未加载，暂时不能执行。",
        readyNote: "点击后会触发工作流，并同步目标平台服务。",
        invalidStrategyNote: "当前账号没有可执行策略，暂时不能切换。",
        invalidReservePolicyNote: "请为当前预留现金策略填写有效金额或比例。",
        invalidIncomeLayerNote: "请填写有效的收入层起始金额和最高比例。",
        invalidOptionOverlayNote: "当前策略未定义可启用的期权层。",
        invalidDcaNote: "请填写有效的定投模式和基准金额。",
        publicOauthTitle: "GitHub OAuth 保护",
        publicOauthText: "只允许白名单账号进入私有配置。",
        publicWorkerTitle: "Worker 端触发",
        publicWorkerText: "令牌保留在服务端，浏览器只提交切换意图。",
        publicAuditTitle: "变更可回溯",
        publicAuditText: "切换由 GitHub Actions 执行，便于审计和回滚。",
        noAccount: "没有账号选项",
        noStrategy: "没有支持的策略",
        repository: "平台仓库",
        selectedAccount: "账号",
        selectedMarket: "市场",
        currentRuntimeTarget: "当前账号状态",
        pendingRuntimeTarget: "待提交账号状态",
        reservedCashPolicy: "当前预留现金",
        currentIncomeLayer: "当前收入层",
        pendingIncomeLayer: "待提交收入层",
        currentOptionOverlay: "当前期权层",
        pendingOptionOverlay: "待提交期权层",
        pendingReservedCashPolicy: "待提交预留现金",
        pendingMode: "待提交模式",
        currentPluginMode: "当前插件范围",
        pendingPluginMode: "待提交插件范围",
        unchanged: "不变",
        copied: "已复制状态",
        dispatching: "正在触发工作流...",
        dispatched: "已触发工作流",
        dispatchFailed: "触发失败",
        targetMeta: "目标 {target} · 服务 {service} · 市场 {domains}",
        strategyMeta: "支持市场：{domains}",
        strategyLifecycleMeta: "当前门槛 {stage}",
        strategyBlockedCountMeta: "{count} 个策略未达 live 门槛",
        strategyDefaultBlockedMeta: "默认策略 {profile} 已阻断：{reason}",
        usEquity: "美股",
        hkEquity: "港股",
        cnEquity: "A股",
        cryptoEquity: "加密",
        currentStrategy: "当前策略",
        nextStrategy: "切换策略",
        notRead: "读取失败",
        runtimeTargetOn: "启用",
        runtimeTargetOff: "禁用",
        incomeLayerDefault: "开启，{start}起 {ratio}",
        incomeLayerOff: "关闭",
        incomeLayerOn: "开启，起始 {start}，最高 {ratio}",
        optionOverlayOff: "关闭",
        optionOverlayOn: "开启",
        optionOverlayDefaultSimple: "开启",
        optionOverlayDefault: "开启，{detail}",
        cashOnlyExecutionDefault: "仅用现金",
      },
      en: {
        appTitle: "Strategy Switch",
        appSubtitle: "Pick platform, target account, and strategy. One action switches everything.",
        healthView: "Strategy Health",
        switchView: "Live Switch",
        healthEyebrow: "Strategy health / read only",
        healthTitle: "Read the machine conclusion before choosing an action.",
        healthSubtitle: "Health does not approve live; normal live, funding, and leverage changes still need a human.",
        healthTotal: "Strategies",
        healthHealthy: "Healthy",
        healthWatch: "Watch",
        healthReview: "Review",
        healthBoard: "Strategy status",
        bootKicker: "Starting console",
        bootTitle: "Loading strategy config",
        bootMessage: "Reading session, account config, and current state.",
        bootStrategy: "Reading strategy catalog.",
        bootSession: "Checking sign-in status.",
        bootConfig: "Reading account config and current state.",
        bootTimeout: "Loading timed out; switched to public preview. Retry after signing in.",
        bootPublic: "Public preview is ready.",
        login: "Sign in",
        logout: "Sign out",
        signedInAs: "Signed in as {login}",
        activePlatform: "Active Platform",
        account: "Target account",
        strategy: "Strategy",
        mode: "Mode",
        live: "Live",
        paper: "Dry run",
        runtimeTargetMode: "Account status",
        runtimeSectionTitle: "Runtime and plugins",
        runtimeTargetCurrent: "Keep current status",
        runtimeTargetEnabled: "Enabled",
        runtimeTargetDisabled: "Disabled",
        runtimeTargetModeMeta: "Disabled accounts skip live runs; dry runs and health checks still work.",
        pluginMode: "Plugin scope",
        pluginModeAuto: "Enabled",
        pluginModeNone: "Disabled",
        pluginModeMeta: "Choose whether to enable this strategy's plugins.",
        incomeLayerMode: "Income layer",
        incomeLayerSectionTitle: "Income layer",
        incomeLayerCurrent: "Keep current config",
        incomeLayerEnabled: "Enable income layer",
        incomeLayerDisabled: "Disable income layer",
        incomeLayerNotSupported: "No income layer for this strategy",
        incomeLayerStartUsd: "Income layer start amount",
        incomeLayerMaxRatio: "Income layer max ratio",
        incomeLayerModeMeta: "Only applies to US equity strategies with an income layer.",
        incomeLayerDefaultMeta: "Strategy default: starts at {start}, max {ratio}.",
        incomeLayerAllocationMeta: "Default allocation: {allocations}.",
        incomeLayerStartMeta: "Income layer activates after total assets reach this amount.",
        incomeLayerRatioMeta: "Use 0.55 for a 55% cap.",
        optionOverlayMode: "Option layer",
        optionOverlaySectionTitle: "Option layer",
        optionOverlayCurrent: "Keep current config",
        optionOverlayEnabled: "Enable option layer",
        optionOverlayDisabled: "Disable option layer",
        optionOverlayNotSupported: "No option layer for this strategy",
        optionOverlayModeMeta: "Enabled mode uses the strategy's default recipe and budget; ratios are not edited here.",
        optionOverlayDefaultMeta: "{defaults}",
        optionOverlayFamilyGrowth: "Growth",
        optionOverlayFamilyIncome: "Income",
        optionOverlayBudgetRatio: "budget {ratio}",
        optionOverlayRiskRatio: "risk {ratio}",
        cashOnlyExecutionMode: "Allow margin",
        cashOnlyExecutionCurrent: "Keep current config",
        cashOnlyExecutionYes: "Yes",
        cashOnlyExecutionNo: "No",
        cashOnlyExecutionModeMeta: "Choose No to use available cash only and avoid margin buying power.",
        cashOnlyExecutionValueYes: "Yes",
        cashOnlyExecutionValueNo: "No",
        currentCashOnlyExecution: "Current allow margin",
        pendingCashOnlyExecution: "Pending allow margin",
        executionCashPolicyTitle: "Cash and margin",
        executionCashPolicyNote: "Allow margin and reserve-cash overrides cannot both apply. Yes clears reserve overrides; reserve overrides force No.",
        executionCashMarginBlocksReserve: "Allow margin is selected; submitting will clear reserve-cash overrides.",
        executionCashReserveBlocksMargin: "Reserve-cash override is active; submitting will force allow margin to No.",
        qmtPlatformCashNote: "QMT A-share does not use margin or platform reserve cash; cash constraints live in strategy execution_cash_reserve_ratio.",
        qmtDryRunOnlyNote: "QMT is dry-run only for now; no live broker accounts are configured.",
        binancePlatformNote: "Binance does not use broker-level income/option layers; features are implemented inside strategies.",
        invalidExecutionCashPolicyNote: "Allow margin and reserve-cash overrides conflict. Keep only one constraint.",
        dcaMode: "DCA mode",
        dcaSectionTitle: "DCA",
        dcaModeFixed: "Fixed DCA",
        dcaModeSmart: "Smart DCA",
        dcaBaseInvestmentUsd: "Base DCA amount",
        dcaModeMeta: "Only DCA strategies can use this.",
        dcaDefaultMeta: "Default: {mode}, base amount {amount}.",
        dcaNotSupported: "This is not a DCA strategy",
        dcaPlatformNotSupported: "DCA not supported on this platform",
        currentDca: "Current DCA settings",
        pendingDca: "Pending DCA settings",
        dcaText: "{mode}, base amount {amount}",
        minReservedCash: "Minimum reserved cash ({currency})",
        reservedCashRatio: "Reserved cash ratio",
        reservedCashMode: "Reserved cash policy",
        reservePolicyCurrent: "Keep current config",
        reservePolicyNone: "No platform reserve",
        reservePolicyRatio: "Ratio only",
        reservePolicyFloor: "Fixed amount only",
        reservePolicyMax: "Max of amount and ratio",
        reservedCashModeMeta: "Choose whether to keep, clear, or override platform reserved cash.",
        reservedCashNone: "None",
        reservedCashDefault: "Not configured (platform default: 0 {currency} / 0%)",
        reservedCashMeta: "Fixed cash floor. Use alone or with a ratio.",
        reservedCashRatioMeta: "Use 0.03 for 3%.",
        summary: "Current / Pending",
        copySummary: "Copy state",
        loginToRun: "Sign in to switch",
        loadingConfig: "Loading config",
        configureAccounts: "Configure accounts",
        runSwitch: "Switch now",
        noChanges: "No changes",
        readonlyNote: "Sign in to switch.",
        publicReadonly: "Sign in to view account config.",
        loadingConfigNote: "Reading account config and current state.",
        missingConfigNote: "Account config is not loaded, so switching is disabled.",
        readyNote: "This dispatches the workflow and syncs the target platform service.",
        invalidStrategyNote: "This account has no runnable strategy, so switching is disabled.",
        invalidReservePolicyNote: "Enter a valid amount or ratio for the selected reserved-cash policy.",
        invalidIncomeLayerNote: "Enter a valid income layer start amount and max ratio.",
        invalidOptionOverlayNote: "This strategy does not define an option layer to enable.",
        invalidDcaNote: "Enter a valid DCA mode and base amount.",
        publicOauthTitle: "Protected by GitHub OAuth",
        publicOauthText: "Only allowlisted accounts can open private config.",
        publicWorkerTitle: "Worker-side dispatch",
        publicWorkerText: "Tokens stay server-side; the browser submits intent only.",
        publicAuditTitle: "Traceable changes",
        publicAuditText: "Switches run through GitHub Actions for audit and rollback.",
        noAccount: "No accounts",
        noStrategy: "No supported strategies",
        repository: "Repository",
        selectedAccount: "Account",
        selectedMarket: "Market",
        currentRuntimeTarget: "Current account status",
        pendingRuntimeTarget: "Pending account status",
        reservedCashPolicy: "Current reserved cash",
        currentIncomeLayer: "Current income layer",
        pendingIncomeLayer: "Pending income layer",
        currentOptionOverlay: "Current option layer",
        pendingOptionOverlay: "Pending option layer",
        pendingReservedCashPolicy: "Pending reserved cash",
        pendingMode: "Pending mode",
        currentPluginMode: "Current plugin scope",
        pendingPluginMode: "Pending plugin scope",
        unchanged: "Unchanged",
        copied: "State copied",
        dispatching: "Dispatching workflow...",
        dispatched: "Workflow dispatched",
        dispatchFailed: "Dispatch failed",
        targetMeta: "target {target} · service {service} · market {domains}",
        strategyMeta: "Markets: {domains}",
        strategyLifecycleMeta: "current gate {stage}",
        strategyBlockedCountMeta: "{count} strategies are blocked from live",
        strategyDefaultBlockedMeta: "Default strategy {profile} is blocked: {reason}",
        usEquity: "US equity",
        hkEquity: "HK equity",
        cnEquity: "CN A-share",
        cryptoEquity: "Crypto",
        currentStrategy: "Current strategy",
        nextStrategy: "Switch strategy",
        notRead: "Not read",
        runtimeTargetOn: "Enabled",
        runtimeTargetOff: "Disabled",
        incomeLayerDefault: "Enabled, {start} start, {ratio} max",
        incomeLayerOff: "Disabled",
        incomeLayerOn: "Enabled, starts at {start}, max {ratio}",
        optionOverlayOff: "Disabled",
        optionOverlayOn: "Enabled",
        optionOverlayDefaultSimple: "Strategy default: enabled",
        optionOverlayDefault: "Enabled, {detail}",
        cashOnlyExecutionDefault: "Cash only",
      },
    };

    const storedLang = localStorage.getItem("qsl-switch-lang");
    const initialLang = storedLang === "zh" || storedLang === "en"
      ? storedLang
      : ((navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en");
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const defaultReserveForm = () => ({
      reservePolicyMode: "current",
      minReservedCashUsd: "",
      reservedCashRatio: "",
      reservedCashTouched: false,
      incomeLayerMode: "current",
      incomeLayerStartUsd: "",
      incomeLayerMaxRatio: "",
      incomeLayerTouched: false,
      optionOverlayMode: "current",
      optionOverlayTouched: false,
      cashOnlyExecutionMode: "current",
      cashOnlyExecutionTouched: false,
      runtimeTargetMode: "current",
      runtimeTargetTouched: false,
      dcaMode: "fixed",
      dcaBaseInvestmentUsd: "",
      dcaTouched: false,
      strategyTouched: false,
    });

    const state = {
      selected: "longbridge",
      lang: initialLang,
      view: "health",
      appReady: false,
      bootMessageKey: "bootMessage",
      auth: { available: false, allowed: false, admin: false, login: null },
      accountOptions: clone(defaultAccountOptions),
      currentStrategies: {},
      health: {
        payload: {
          data_status: "unavailable",
          computed_at: null,
          summary: { strategy_count: 0, healthy: 0, watch: 0, review: 0, critical: 0 },
          strategies: [],
        },
        filter: "all",
      },
      configSource: "default",
      repositories: clone(defaultRepositories),
      forms: {
        longbridge: { accountKey: "preview", strategy: "", executionMode: "live", pluginMode: "auto", ...defaultReserveForm() },
        ibkr: { accountKey: "preview", strategy: "", executionMode: "live", pluginMode: "auto", ...defaultReserveForm() },
        schwab: { accountKey: "preview", strategy: "", executionMode: "live", pluginMode: "auto", ...defaultReserveForm() },
        firstrade: { accountKey: "preview", strategy: "", executionMode: "live", pluginMode: "auto", ...defaultReserveForm() },
        qmt: { accountKey: "preview", strategy: "", executionMode: "paper", pluginMode: "auto", ...defaultReserveForm() },
        binance: { accountKey: "preview", strategy: "", executionMode: "live", pluginMode: "auto" },
      },
    };

    const el = (id) => document.getElementById(id);
    const t = (key) => copy[state.lang][key] || copy.en[key] || key;
    let toastTimer = null;

    function showToast(message, { duration = 4000 } = {}) {
      const node = el("toast");
      if (toastTimer) {
        window.clearTimeout(toastTimer);
        toastTimer = null;
      }
      node.textContent = message || "";
      if (message && duration > 0) {
        toastTimer = window.setTimeout(() => {
          node.textContent = "";
          toastTimer = null;
        }, duration);
      }
    }

    async function fetchWithTimeout(url, init = {}, timeoutMs = APP_BOOT_TIMEOUT_MS) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { ...init, signal: controller.signal });
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new Error("request timeout");
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    async function requestJson(url, init = {}, timeoutMs = APP_BOOT_TIMEOUT_MS) {
      const response = await fetchWithTimeout(url, { ...init, cache: "no-store" }, timeoutMs);
      if (!response.ok) throw new Error("request failed");
      return response.json();
    }

    function isRequestTimeoutError(error) {
      return String(error?.message || "").toLowerCase() === "request timeout";
    }

    function optionsFor(platform) {
      return state.accountOptions[platform] && state.accountOptions[platform].length
        ? state.accountOptions[platform]
        : defaultAccountOptions[platform];
    }

    function selectedAccount(platform = state.selected) {
      const options = optionsFor(platform);
      const form = state.forms[platform];
      return options.find((option) => option.key === form.accountKey) || options[0];
    }

    function hasPrivateConfig() {
      return Boolean(state.auth.allowed && state.configSource === "private");
    }

    function cleanStrategyProfile(value) {
      const profile = String(value || "").trim();
      return /^[a-z0-9._=-]{1,120}$/.test(profile) ? profile : "";
    }

    function cleanStrategyDomain(value) {
      const domain = String(value || "").trim();
      return strategyDomains.includes(domain) ? domain : "";
    }

    function domainLabel(domain) {
      const entry = domainLabels[domain];
      if (entry) return state.lang === "zh" ? entry.zh : entry.en;
      return domain;
    }

    function platformSupportsMarginPolicy(platform = state.selected) {
      return platformConfig[platform]?.margin_policy ?? true;
    }

    function platformSupportsReservedCashPolicy(platform = state.selected) {
      return platformConfig[platform]?.reserved_cash ?? true;
    }

    function platformDryRunOnly(platform = state.selected) {
      return platformConfig[platform]?.dry_run_only ?? false;
    }

    function allowMarginExplicitlySelected(form) {
      return normalizeCashOnlyExecutionMode(form?.cashOnlyExecutionMode) === "disabled";
    }

    function reserveCashOverrideActive(form) {
      const mode = normalizeReservePolicyMode(form?.reservePolicyMode);
      return mode === "ratio" || mode === "floor" || mode === "max";
    }

    function executionCashPolicyConflict(form) {
      return allowMarginExplicitlySelected(form) && reserveCashOverrideActive(form);
    }

    function reconcileExecutionCashPolicy(form, changed) {
      if (!form) return;
      if (changed === "margin" && allowMarginExplicitlySelected(form)) {
        if (form.reservePolicyMode !== "none" && (form.minReservedCashUsd || form.reservedCashRatio)) {
          form._prevReserve = {
            mode: form.reservePolicyMode,
            floor: form.minReservedCashUsd,
            ratio: form.reservedCashRatio,
          };
        }
        form.reservePolicyMode = "none";
        form.reservedCashTouched = true;
      } else if (changed === "reserve" && reserveCashOverrideActive(form)) {
        form.cashOnlyExecutionMode = "enabled";
        form.cashOnlyExecutionTouched = true;
      }
    }

    function restoreReserveAfterMarginDisabled(form) {
      if (!form || allowMarginExplicitlySelected(form) || !form._prevReserve) return;
      form.reservePolicyMode = form._prevReserve.mode;
      form.minReservedCashUsd = form._prevReserve.floor;
      form.reservedCashRatio = form._prevReserve.ratio;
      form.reservedCashTouched = true;
      delete form._prevReserve;
    }

    function strategyDomain(profile) {
      return strategyCatalog[profile]?.domain || "";
    }

    function selectedCashCurrency(platform = state.selected, account = selectedAccount(platform)) {
      const configured = String(account?.cash_currency || "").trim().toUpperCase();
      if (configured === "USD" || configured === "HKD" || configured === "CNY") return configured;
      const domain = strategyDomain(state.forms[platform]?.strategy);
      if (domain === "hk_equity") return "HKD";
      if (domain === "cn_equity") return "CNY";
      return "USD";
    }

    function applyStrategyProfiles(rawProfiles) {
      const profiles = Array.isArray(rawProfiles) && rawProfiles.length
        ? rawProfiles
        : defaultStrategyProfiles;
      const nextOptions = [];
      const nextLabels = {};
      const nextCatalog = {};
      const nextIncomeLayerDefaults = {};
      const nextOptionOverlayDefaults = {};
      for (const item of profiles) {
        const profile = cleanStrategyProfile(item?.profile || item?.strategy_profile);
        if (!profile || nextOptions.includes(profile)) continue;
        const domain = cleanStrategyDomain(item?.domain || "us_equity");
        if (!domain) continue;
        nextOptions.push(profile);
        nextLabels[profile] = strategyLabelSet(profile, item);
        nextCatalog[profile] = {
          profile,
          label: nextLabels[profile].en || nextLabels[profile].zh || profile,
          label_en: nextLabels[profile].en || "",
          label_zh: nextLabels[profile].zh || "",
          domain,
          runtime_enabled: cleanOptionalBoolean(item?.runtime_enabled ?? item?.live_enabled ?? true) !== false,
        };
        const lifecycleStage = normalizeLifecycleStage(item?.lifecycle_stage ?? item?.lifecycleStage);
        if (lifecycleStage) nextCatalog[profile].lifecycle_stage = lifecycleStage;
        const allowedExecutionModes = normalizeAllowedExecutionModes(item?.allowed_execution_modes);
        if (allowedExecutionModes.length) nextCatalog[profile].allowed_execution_modes = allowedExecutionModes;
        const canSwitchLive = cleanOptionalBoolean(item?.can_switch_live);
        if (canSwitchLive !== null) nextCatalog[profile].can_switch_live = canSwitchLive;
        const blockedLiveReason = cleanDisplayText(item?.blocked_live_reason);
        if (blockedLiveReason) nextCatalog[profile].blocked_live_reason = blockedLiveReason;
        const latestEvidenceStatus = cleanDisplayText(item?.latest_evidence_status);
        if (latestEvidenceStatus) nextCatalog[profile].latest_evidence_status = latestEvidenceStatus;
        const pluginGateStatus = cleanDisplayText(item?.plugin_gate_status);
        if (pluginGateStatus) nextCatalog[profile].plugin_gate_status = pluginGateStatus;
        const dcaDefaults = dcaProfileDefaults[profile] || null;
        if (dcaDefaults || item?.dca_enabled === true) {
          nextCatalog[profile].dca_enabled = true;
          nextCatalog[profile].dca_default_mode = normalizeDcaMode(
            item?.dca_default_mode || item?.default_dca_mode || dcaDefaults?.defaultMode || "fixed",
          );
          nextCatalog[profile].dca_default_base_investment_usd = cleanDisplayPositiveNumber(
            item?.dca_default_base_investment_usd ||
              item?.default_dca_base_investment_usd ||
              dcaDefaults?.defaultBaseInvestmentUsd ||
              "1000",
            ) || "1000";
        }
        const profileIncomeDefaults = incomeLayerDefaultsFromProfileItem(item);
        const incomeDefaults = profileIncomeDefaults === false
          ? null
          : (profileIncomeDefaults || fallbackIncomeLayerDefaults[profile] || null);
        if (incomeDefaults) {
          nextIncomeLayerDefaults[profile] = incomeDefaults;
          nextCatalog[profile].income_layer_enabled = true;
          nextCatalog[profile].income_layer_start_usd = String(incomeDefaults.startUsd);
          nextCatalog[profile].income_layer_max_ratio = incomeDefaults.maxRatio;
          nextCatalog[profile].income_layer_allocations = incomeDefaults.allocations;
        }
        const profileOptionDefaults = optionOverlayDefaultsFromProfileItem(item);
        const optionDefaults = profileOptionDefaults === false
          ? null
          : (profileOptionDefaults || fallbackOptionOverlayDefaults[profile] || null);
        if (optionDefaults) {
          nextOptionOverlayDefaults[profile] = optionDefaults;
          nextCatalog[profile].option_overlay_enabled = true;
          nextCatalog[profile].option_overlay_live_gate = optionDefaults.liveGate || "";
          nextCatalog[profile].option_overlay_live_status = optionDefaults.liveStatus || "";
        }
      }
      if (!nextOptions.length && profiles !== defaultStrategyProfiles) return applyStrategyProfiles(defaultStrategyProfiles);
      strategyOptions = nextOptions;
      strategyLabels = nextLabels;
      strategyCatalog = nextCatalog;
      incomeLayerDefaults = nextIncomeLayerDefaults;
      optionOverlayDefaults = nextOptionOverlayDefaults;
    }

    function incomeLayerDefaultsFromProfileItem(item) {
      const enabled = cleanOptionalBoolean(item?.income_layer_enabled);
      const hasConfig = enabled !== null ||
        item?.income_layer_start_usd !== undefined ||
        item?.income_layer_max_ratio !== undefined ||
        item?.income_layer_allocations !== undefined;
      if (!hasConfig) return null;
      if (enabled === false) return false;
      const startUsd = cleanDisplayNumber(item?.income_layer_start_usd);
      const maxRatio = cleanDisplayRatio(item?.income_layer_max_ratio);
      const allocations = cleanIncomeLayerAllocations(item?.income_layer_allocations);
      if (!startUsd || !maxRatio || !allocations) return null;
      return { startUsd, maxRatio, allocations };
    }

    function cleanIncomeLayerAllocations(value) {
      if (!value || Array.isArray(value) || typeof value !== "object") return null;
      const allocations = {};
      let total = 0;
      for (const [rawSymbol, rawRatio] of Object.entries(value)) {
        const symbol = String(rawSymbol || "").trim().toUpperCase();
        const ratio = cleanDisplayPositiveNumber(rawRatio);
        if (!/^[A-Z0-9.-]{1,12}$/.test(symbol) || !ratio) continue;
        allocations[symbol] = Number(ratio);
        total += Number(ratio);
      }
      return total > 0 && Object.keys(allocations).length ? allocations : null;
    }

    function optionOverlayDefaultsFromProfileItem(item) {
      const enabled = cleanOptionalBoolean(item?.option_overlay_enabled);
      const hasConfig = enabled !== null ||
        item?.option_growth_overlay_enabled !== undefined ||
        item?.option_income_overlay_enabled !== undefined ||
        item?.option_overlay_live_gate !== undefined ||
        item?.option_overlay_live_status !== undefined;
      if (!hasConfig) return null;
      if (enabled === false) return false;
      const families = [
        optionOverlayFamilyDefaultsFromProfileItem(item, "growth"),
        optionOverlayFamilyDefaultsFromProfileItem(item, "income"),
      ].filter(Boolean);
      if (!families.length) return null;
      return {
        liveGate: String(item?.option_overlay_live_gate || "promotion_required"),
        liveStatus: String(item?.option_overlay_live_status || "research_only"),
        families,
      };
    }

    function optionOverlayFamilyDefaultsFromProfileItem(item, family) {
      const prefix = `option_${family}_overlay`;
      const enabled = cleanOptionalBoolean(item?.[`${prefix}_enabled`]);
      if (enabled !== true) return null;
      const recipe = cleanStrategyProfile(item?.[`${prefix}_recipe`]);
      const startUsd = cleanDisplayNumber(item?.[`${prefix}_start_usd`]);
      const ratioField = family === "growth"
        ? "option_growth_overlay_nav_budget_ratio"
        : "option_income_overlay_nav_risk_ratio";
      const ratio = cleanDisplayRatio(item?.[ratioField]);
      if (!recipe || !startUsd || !ratio) return null;
      return {
        family,
        recipe,
        startUsd,
        ratio,
        ratioKind: family === "growth" ? "budget" : "risk",
      };
    }

    function supportedDomainsForAccount(platform, account) {
      if (Array.isArray(account?.supported_domains) && account.supported_domains.length) {
        const cleaned = account.supported_domains.map(cleanStrategyDomain).filter(Boolean);
        if (cleaned.length) return [...new Set(cleaned)];
      }
      return inferSupportedDomains(platform, account);
    }

    function inferSupportedDomains(platform, account) {
      void account;
      if (platform === "qmt") return ["cn_equity"];
      if (platform === "longbridge" || platform === "ibkr") return ["us_equity", "hk_equity"];
      return ["us_equity"];
    }

    function supportedDomainLabel(platform, account) {
      return supportedDomainsForAccount(platform, account).map(domainLabel).join(" / ");
    }

    function platformSupportsDca(platform = state.selected) {
      return platformConfig[platform]?.dca ?? false;
    }

    function strategyCatalogEntry(profile) {
      return strategyCatalog[cleanStrategyProfile(profile)] || {};
    }

    function normalizeLifecycleStage(value) {
      const text = String(value || "").trim().toLowerCase();
      if (!text || text.length > 40 || !/^[a-z0-9._-]+$/.test(text)) return "";
      return text;
    }

    function normalizeAllowedExecutionModes(value) {
      const items = Array.isArray(value)
        ? value
        : String(value || "").split(/[,\s/|]+/);
      const modes = [];
      for (const item of items) {
        const mode = String(item || "").trim().toLowerCase();
        if (!mode || mode.length > 32 || !/^[a-z0-9._-]+$/.test(mode)) continue;
        if (!modes.includes(mode)) modes.push(mode);
      }
      return modes;
    }

    function cleanDisplayText(value) {
      const text = String(value ?? "").trim();
      if (!text || text.length > 120 || /[<>]/.test(text)) return "";
      return text;
    }

    function strategyCanSwitchLive(entry) {
      if (!entry || typeof entry !== "object") return false;
      if (entry.runtime_enabled === false) return false;
      const allowedModes = normalizeAllowedExecutionModes(entry.allowed_execution_modes);
      if (allowedModes.length && !allowedModes.includes("live")) return false;
      if (cleanOptionalBoolean(entry.can_switch_live) === false) return false;
      const lifecycleStage = normalizeLifecycleStage(entry.lifecycle_stage);
      if (lifecycleStage && ["research", "draft", "blocked", "archived", "disabled"].includes(lifecycleStage)) return false;
      const blockedReason = cleanDisplayText(entry.blocked_live_reason);
      if (blockedReason) return false;
      const evidenceStatus = cleanDisplayText(entry.latest_evidence_status);
      if (evidenceStatus && ["research_only", "blocked", "pending"].includes(evidenceStatus.toLowerCase())) return false;
      const pluginGateStatus = cleanDisplayText(entry.plugin_gate_status);
      if (pluginGateStatus && ["blocked", "locked", "disabled"].includes(pluginGateStatus.toLowerCase())) return false;
      return true;
    }

    function strategyDisplayMetaText(platform, account, profile) {
      void profile;
      return t("strategyMeta").replace("{domains}", supportedDomainLabel(platform, account));
    }

    function strategyActionNoteText(platform = state.selected, account = selectedAccount(platform)) {
      const profile = state.forms[platform]?.strategy || "";
      const meta = strategyDisplayMetaText(platform, account, profile);
      return meta ? `${t("invalidStrategyNote")}\n${meta}` : t("invalidStrategyNote");
    }

    function strategyChoiceLabel(profile, platform = state.selected, account = selectedAccount(platform), executionMode = state.forms[platform]?.executionMode) {
      const label = strategyLabel(profile);
      const entry = strategyCatalogEntry(profile);
      const domain = entry.domain ? domainLabel(entry.domain) : "";
      if (!entry.profile) return label;
      if (normalizeExecutionMode(executionMode, false) === "live" && !strategyCanSwitchLive(entry)) {
        return domain ? `${label}（${domain}）` : label;
      }
      if (entry.runtime_enabled === false) {
        return domain ? `${label}（${domain}）` : label;
      }
      return label;
    }

    function strategyAllowedForAccount(platform, account, profile, executionMode = state.forms[platform]?.executionMode) {
      const cleanProfile = cleanStrategyProfile(profile);
      const catalogEntry = strategyCatalogEntry(cleanProfile);
      if (!catalogEntry.profile) return false;
      if (catalogEntry.runtime_enabled !== true) return false;
      if (dcaConfigForStrategy(cleanProfile) && !platformSupportsDca(platform)) return false;
      if (!supportedDomainsForAccount(platform, account).includes(catalogEntry.domain)) return false;
      const mode = normalizeExecutionMode(executionMode, false);
      if (mode === "live") return strategyCanSwitchLive(catalogEntry);
      const allowedModes = normalizeAllowedExecutionModes(catalogEntry.allowed_execution_modes);
      if (allowedModes.length && !allowedModes.includes(mode)) return false;
      return true;
    }

    function strategyChoicesForAccount(platform = state.selected, account = selectedAccount(platform), executionMode = state.forms[platform]?.executionMode) {
      const choices = strategyOptions.filter((profile) => strategyAllowedForAccount(platform, account, profile, executionMode));
      const addChoice = (value) => {
        const profile = cleanStrategyProfile(value);
        if (profile && !choices.includes(profile) && strategyAllowedForAccount(platform, account, profile, executionMode)) {
          choices.push(profile);
        }
      };
      return choices;
    }

    function strategyLabel(profile) {
      const labels = strategyLabels[profile] || localStrategyLabels[profile];
      if (!labels) return profile;
      return state.lang === "zh"
        ? (labels.zh || labels.en || profile)
        : (labels.en || labels.zh || profile);
    }

    function strategyLabelSet(profile, item) {
      const local = localStrategyLabels[profile] || {};
      const label = String(item?.label || item?.display_name || "").trim();
      const labelEn = String(item?.label_en || item?.display_name_en || "").trim();
      const labelZh = String(item?.label_zh || item?.display_name_zh || "").trim();
      return {
        zh: labelZh || local.zh || label || local.en || profile,
        en: labelEn || label || local.en || labelZh || local.zh || profile,
      };
    }

    function modeLabel(mode) {
      return mode === "paper" ? t("paper") : t("live");
    }

    function normalizePluginMode(value) {
      return pluginModes.includes(value) ? value : "auto";
    }

    function pluginModeLabel(mode) {
      return mode === "none" ? t("pluginModeNone") : t("pluginModeAuto");
    }

    function dcaConfigForStrategy(profile) {
      const cleanProfile = cleanStrategyProfile(profile);
      const catalog = strategyCatalog[cleanProfile] || {};
      if (catalog.dca_enabled === true) {
        return {
          defaultMode: normalizeDcaMode(catalog.dca_default_mode || "fixed"),
          defaultBaseInvestmentUsd: cleanDisplayPositiveNumber(catalog.dca_default_base_investment_usd) || "1000",
        };
      }
      return dcaProfileDefaults[cleanProfile] || null;
    }

    function dcaSupported(profile) {
      return Boolean(dcaConfigForStrategy(profile));
    }

    function normalizeDcaMode(value) {
      const mode = String(value || "").trim().toLowerCase();
      if (mode === "smart_dca") return "smart";
      if (mode === "fixed_dca" || mode === "ordinary" || mode === "ordinary_dca") return "fixed";
      return dcaModes.includes(mode) ? mode : "fixed";
    }

    function dcaModeLabel(mode) {
      return normalizeDcaMode(mode) === "smart" ? t("dcaModeSmart") : t("dcaModeFixed");
    }

    function normalizeRuntimeTargetMode(value) {
      return runtimeTargetModes.includes(value) ? value : "current";
    }

    function runtimeTargetModeLabel(mode) {
      if (mode === "enabled") return t("runtimeTargetEnabled");
      if (mode === "disabled") return t("runtimeTargetDisabled");
      return t("runtimeTargetCurrent");
    }

    function runtimeTargetEnabledForAccount(platform, account) {
      return cleanOptionalBoolean(currentEntryForAccount(platform, account)?.runtime_target_enabled);
    }

    function runtimeTargetStateForAccount(platform = state.selected, account = selectedAccount(platform)) {
      const entry = currentEntryForAccount(platform, account);
      if (!entry) return { known: false, enabled: null };
      const configured = cleanOptionalBoolean(entry.runtime_target_enabled);
      return { known: true, enabled: configured ?? true };
    }

    function runtimeTargetText(enabled) {
      return enabled ? t("runtimeTargetOn") : t("runtimeTargetOff");
    }

    function runtimeTargetTone(enabled) {
      return enabled ? "enabled" : "disabled";
    }

    function currentRuntimeTargetText(platform = state.selected, account = selectedAccount(platform)) {
      const target = runtimeTargetStateForAccount(platform, account);
      if (!target.known) return t("notRead");
      return runtimeTargetText(target.enabled);
    }

    function currentRuntimeTargetTone(platform = state.selected, account = selectedAccount(platform)) {
      const target = runtimeTargetStateForAccount(platform, account);
      if (!target.known) return "neutral";
      return runtimeTargetTone(target.enabled);
    }

    function incomeLayerDefaultForStrategy(profile) {
      return incomeLayerDefaults[cleanStrategyProfile(profile)] || null;
    }

    function incomeLayerSupported(profile) {
      return Boolean(incomeLayerDefaultForStrategy(profile));
    }

    function normalizeIncomeLayerMode(value) {
      return incomeLayerModes.includes(value) ? value : "current";
    }

    function incomeLayerModeLabel(mode) {
      if (mode === "enabled") return t("incomeLayerEnabled");
      if (mode === "disabled") return t("incomeLayerDisabled");
      return t("incomeLayerCurrent");
    }

    function optionOverlayDefaultForStrategy(profile) {
      return optionOverlayDefaults[cleanStrategyProfile(profile)] || null;
    }

    function optionOverlaySupported(profile) {
      return Boolean(optionOverlayDefaultForStrategy(profile));
    }

    function normalizeOptionOverlayMode(value) {
      return optionOverlayModes.includes(value) ? value : "current";
    }

    function optionOverlayModeLabel(mode) {
      if (mode === "enabled") return t("optionOverlayEnabled");
      if (mode === "disabled") return t("optionOverlayDisabled");
      return t("optionOverlayCurrent");
    }

    function optionOverlayText(enabled) {
      return enabled ? t("optionOverlayOn") : t("optionOverlayOff");
    }

    function normalizeCashOnlyExecutionMode(value) {
      return cashOnlyExecutionModes.includes(value) ? value : "current";
    }

    function cashOnlyExecutionModeLabel(mode) {
      if (mode === "enabled") return t("cashOnlyExecutionNo");
      if (mode === "disabled") return t("cashOnlyExecutionYes");
      return t("cashOnlyExecutionCurrent");
    }

    function cashOnlyExecutionText(enabled) {
      if (enabled === null) return t("notRead");
      return enabled ? t("cashOnlyExecutionValueNo") : t("cashOnlyExecutionValueYes");
    }

    function platformCashOnlyExecutionDefault() {
      return true;
    }

    function effectiveCashOnlyExecutionForAccount(platform, account) {
      const configured = currentCashOnlyExecutionForAccount(platform, account);
      if (configured !== null) return configured;
      if (!platformSupportsMarginPolicy(platform)) return null;
      return platformCashOnlyExecutionDefault();
    }

    function currentCashOnlyExecutionForAccount(platform, account) {
      const entry = currentEntryForAccount(platform, account);
      if (entry) {
        const val = cleanOptionalBoolean(entry.cash_only_execution);
        if (val !== null) return val;
      }
      return platformCashOnlyExecutionDefault();
    }

    function currentCashOnlyExecutionText(platform = state.selected, account = selectedAccount(platform)) {
      if (!platformSupportsMarginPolicy(platform)) return t("notRead");
      const entry = currentEntryForAccount(platform, account);
      if (!entry) return t("notRead");
      const configured = cleanOptionalBoolean(entry.cash_only_execution);
      if (configured === null) return t("cashOnlyExecutionDefault");
      return cashOnlyExecutionText(configured);
    }

    function currentOptionOverlayForAccount(platform, account) {
      return cleanOptionalBoolean(currentEntryForAccount(platform, account)?.option_overlay_enabled);
    }

    function effectiveOptionOverlayForAccount(platform, account, profile = state.forms[platform]?.strategy) {
      const configured = currentOptionOverlayForAccount(platform, account);
      if (configured !== null) return configured;
      if (!optionOverlaySupported(profile)) return null;
      return true;
    }

    function optionOverlayDefaultSummaryDetail(defaults) {
      if (!defaults?.families?.length) return "";
      return defaults.families.map((item) => {
        const family = item.family === "income" ? t("optionOverlayFamilyIncome") : t("optionOverlayFamilyGrowth");
        const ratioText = item.ratioKind === "risk"
          ? t("optionOverlayRiskRatio").replace("{ratio}", formatRatioPercent(item.ratio))
          : t("optionOverlayBudgetRatio").replace("{ratio}", formatRatioPercent(item.ratio));
        return `${family} ${ratioText}`;
      }).join(" / ");
    }

    function optionOverlayDefaultText(profile) {
      const defaults = optionOverlayDefaultForStrategy(profile);
      if (!defaults) return t("optionOverlayNotSupported");
      const detail = optionOverlayDefaultSummaryDetail(defaults);
      return detail ? t("optionOverlayDefault").replace("{detail}", detail) : t("optionOverlayDefaultSimple");
    }

    function currentOptionOverlayText(platform = state.selected, account = selectedAccount(platform), profile = state.forms[platform]?.strategy) {
      const entry = currentEntryForAccount(platform, account);
      if (!entry) return t("notRead");
      const configured = cleanOptionalBoolean(entry.option_overlay_enabled);
      if (!optionOverlaySupported(profile)) {
        return configured === null ? t("optionOverlayNotSupported") : optionOverlayText(configured);
      }
      if (configured === null) return optionOverlayDefaultText(profile);
      return optionOverlayText(configured);
    }

    function currentIncomeLayerForAccount(platform, account) {
      return incomeLayerFromEntry(currentEntryForAccount(platform, account));
    }

    function incomeLayerFromEntry(entry) {
      return {
        enabled: cleanOptionalBoolean(entry?.income_layer_enabled),
        startUsd: cleanDisplayNumber(entry?.income_layer_start_usd),
        maxRatio: cleanDisplayRatio(entry?.income_layer_max_ratio),
      };
    }

    function incomeLayerFieldsConfigured(entry) {
      const current = incomeLayerFromEntry(entry);
      return current.enabled !== null || Boolean(current.startUsd || current.maxRatio);
    }

    function effectiveIncomeLayerForAccount(platform, account, profile = state.forms[platform]?.strategy) {
      const defaults = incomeLayerDefaultForStrategy(profile);
      if (!defaults) return null;
      const entry = currentEntryForAccount(platform, account);
      if (!entry) return null;
      const current = incomeLayerFromEntry(entry);
      if (!incomeLayerFieldsConfigured(entry)) {
        return {
          enabled: true,
          startUsd: String(defaults.startUsd),
          maxRatio: defaults.maxRatio,
        };
      }
      return {
        enabled: current.enabled ?? true,
        startUsd: current.startUsd || String(defaults.startUsd),
        maxRatio: current.maxRatio || defaults.maxRatio,
      };
    }

    function currentDcaForAccount(platform, account, profile = state.forms[platform]?.strategy) {
      const defaults = dcaConfigForStrategy(profile);
      if (!defaults) return { supported: false, mode: "", baseInvestmentUsd: "" };
      const entry = currentEntryForAccount(platform, account);
      return {
        supported: true,
        mode: normalizeDcaMode(entry?.dca_mode || account?.dca_mode || defaults.defaultMode),
        baseInvestmentUsd: cleanDisplayPositiveNumber(entry?.dca_base_investment_usd) ||
          cleanDisplayPositiveNumber(account?.dca_base_investment_usd) ||
          defaults.defaultBaseInvestmentUsd,
      };
    }

    function normalizeAccountLookupKey(value) {
      return String(value || "").trim().toLowerCase();
    }

    function collectAccountLookupCandidates(keys) {
      const candidates = new Set();
      for (const rawKey of keys) {
        const key = normalizeAccountLookupKey(rawKey);
        if (!key) continue;

        candidates.add(key);

        const compact = key.replace(/[^a-z0-9]+/g, "");
        if (compact) candidates.add(compact);

        const parts = key.split(/[^a-z0-9]+/).filter(Boolean);
        if (parts.length > 1) candidates.add(parts[parts.length - 1]);
      }
      return [...candidates];
    }

    function resolveCurrentEntryByKey(byPlatform, keys) {
      const candidates = new Set(collectAccountLookupCandidates(keys));
      if (!candidates.size) return null;

      for (const key of keys) {
        const entry = byPlatform[key];
        if (currentEntryHasState(entry)) return entry;
      }

      for (const [rawKey, entry] of Object.entries(byPlatform)) {
        if (!currentEntryHasState(entry)) continue;
        const rawCandidates = collectAccountLookupCandidates([rawKey]);
        const hasMatch = rawCandidates.some((candidate) => candidates.has(candidate));
        if (hasMatch) return entry;
      }

      return null;
    }

    function currentEntryForAccount(platform, account) {
      const byPlatform = state.currentStrategies[platform] || {};
      const keys = [account?.key, account?.target_name, account?.label]
        .filter(Boolean)
        .map((value) => String(value));
      const entry = resolveCurrentEntryByKey(byPlatform, keys);
      if (entry) return entry;
      const globalDefaults = window.__DEFAULT_ACCOUNT_OPTIONS__?.[platform]?.[0] || {};
      const merged = { ...globalDefaults, ...(account || {}) };
      const synth = {
        strategy_profile: "",
        source: "account_defaults",
      };
      const cashMode = merged.cash_only_execution_mode;
      if (cashMode === "enabled") synth.cash_only_execution = true;
      else if (cashMode === "disabled") synth.cash_only_execution = false;
      else if (platformSupportsMarginPolicy(platform)) synth.cash_only_execution = true;
      if (merged.min_reserved_cash_usd) synth.min_reserved_cash_usd = merged.min_reserved_cash_usd;
      if (merged.reserved_cash_ratio) synth.reserved_cash_ratio = merged.reserved_cash_ratio;
      synth.runtime_target_enabled = merged.runtime_target_enabled !== false;
      const execMode = merged.default_execution_mode || platformConfig[platform]?.default_execution_mode || "live";
      synth.execution_mode = execMode;
      synth.dry_run_only = execMode === "paper";
      return synth;
    }

    function currentEntryHasState(entry) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      return Boolean(
        cleanStrategyProfile(entry.strategy_profile) ||
          cleanDisplayNumber(entry.min_reserved_cash_usd ?? entry.reserved_cash_floor_usd) ||
          cleanDisplayRatio(entry.reserved_cash_ratio) ||
          cleanOptionalBoolean(entry.income_layer_enabled) !== null ||
          cleanDisplayNumber(entry.income_layer_start_usd) ||
          cleanDisplayRatio(entry.income_layer_max_ratio) ||
          cleanOptionalBoolean(entry.option_overlay_enabled) !== null ||
          cleanOptionalBoolean(entry.cash_only_execution) !== null ||
          cleanOptionalBoolean(entry.runtime_target_enabled) !== null ||
          normalizeDcaMode(entry.dca_mode || "") !== "fixed" ||
          cleanDisplayPositiveNumber(entry.dca_base_investment_usd) ||
          normalizeExecutionMode(entry.execution_mode, entry.dry_run_only),
      );
    }

    function currentStrategyForAccount(platform, account) {
      const entry = currentEntryForAccount(platform, account);
      return cleanStrategyProfile(entry?.strategy_profile) || "";
    }

    function currentReservePolicyForAccount(platform, account) {
      const entry = currentEntryForAccount(platform, account);
      return reservePolicyFromEntry(entry);
    }

    function currentPluginModeForAccount(platform, account) {
      void platform;
      return normalizePluginMode(account?.plugin_mode);
    }

    function reservePolicyFromEntry(entry) {
      return {
        minReservedCashUsd: cleanDisplayNumber(entry?.min_reserved_cash_usd ?? entry?.reserved_cash_floor_usd),
        reservedCashRatio: cleanDisplayRatio(entry?.reserved_cash_ratio),
      };
    }

    function cleanDisplayNumber(value) {
      const text = String(value ?? "").trim();
      if (!text || text.length > 32 || !/^(?:\d+|\d*\.\d+)$/.test(text)) return "";
      const numeric = Number(text);
      if (!Number.isFinite(numeric) || numeric < 0) return "";
      return text;
    }

    function cleanDisplayRatio(value) {
      const text = cleanDisplayNumber(value);
      if (!text) return "";
      const numeric = Number(text);
      return numeric >= 0 && numeric <= 1 ? text : "";
    }

    function cleanDisplayPositiveNumber(value) {
      const text = cleanDisplayNumber(value);
      return text && Number(text) > 0 ? text : "";
    }

    function normalizeExecutionMode(value, dryRunOnly) {
      const mode = String(value || "").trim().toLowerCase();
      if (mode === "live" || mode === "paper") return mode;
      if (dryRunOnly === true || dryRunOnly === "true" || dryRunOnly === "1" || dryRunOnly === 1) return "paper";
      if (dryRunOnly === false || dryRunOnly === "false" || dryRunOnly === "0" || dryRunOnly === 0) return "live";
      return "";
    }

    function cleanOptionalBoolean(value) {
      if (value === true || value === 1) return true;
      if (value === false || value === 0) return false;
      if (typeof value === "string") {
        const text = value.trim().toLowerCase();
        if (text === "true" || text === "1") return true;
        if (text === "false" || text === "0") return false;
      }
      return null;
    }

    function defaultExecutionModeForAccount(platform, account, fallback = "live") {
      if (platformDryRunOnly(platform)) return "paper";
      const currentMode = normalizeExecutionMode(
        currentEntryForAccount(platform, account)?.execution_mode,
        currentEntryForAccount(platform, account)?.dry_run_only,
      );
      if (currentMode) return currentMode;
      const hint = [
        account?.key,
        account?.label,
        account?.target_name,
        account?.deployment_selector,
        account?.account_scope,
        account?.service_name,
      ].join(" ").toLowerCase();
      if (hint.split(/\s+/).includes("paper") || hint.includes("-paper") || hint.includes("_paper") || hint.includes("dry_run") || hint.includes("dry-run")) {
        return "paper";
      }
      return fallback;
    }

    function defaultStrategyForAccount(platform, account) {
      const currentProfile = currentStrategyForAccount(platform, account);
      if (currentProfile) return currentProfile;
      return "";
    }

    function syncStrategyForAccount(platform) {
      const account = selectedAccount(platform);
      if (!account) return;
      state.forms[platform].strategy = defaultStrategyForAccount(platform, account);
      state.forms[platform].executionMode = defaultExecutionModeForAccount(
        platform,
        account,
      );
      state.forms[platform].pluginMode = currentPluginModeForAccount(platform, account);
      syncRuntimeTargetForAccount(platform);
      syncReservePolicyForAccount(platform);
      syncIncomeLayerForAccount(platform);
      syncOptionOverlayForAccount(platform);
      syncCashOnlyExecutionForAccount(platform);
      reconcileExecutionCashPolicy(state.forms[platform], "margin");
      syncDcaForAccount(platform);
    }

    function syncRuntimeTargetForAccount(platform) {
      const form = state.forms[platform];
      if (!form || form.runtimeTargetTouched) return;
      const current = runtimeTargetEnabledForAccount(platform, selectedAccount(platform));
      form.runtimeTargetMode = current === false ? "disabled" : "enabled";
    }

    function syncReservePolicyForAccount(platform) {
      const form = state.forms[platform];
      if (!form || form.reservedCashTouched) return;
      const policy = currentReservePolicyForAccount(platform, selectedAccount(platform));
      const hasFloor = Boolean(policy.minReservedCashUsd);
      const hasRatio = Boolean(policy.reservedCashRatio);
      if (hasFloor && hasRatio) form.reservePolicyMode = "max";
      else if (hasFloor) form.reservePolicyMode = "floor";
      else if (hasRatio) form.reservePolicyMode = "ratio";
      else form.reservePolicyMode = "none";
      form.minReservedCashUsd = policy.minReservedCashUsd;
      form.reservedCashRatio = policy.reservedCashRatio;
    }

    function syncIncomeLayerForAccount(platform) {
      const form = state.forms[platform];
      if (!form || form.incomeLayerTouched) return;
      const defaults = incomeLayerDefaultForStrategy(form.strategy);
      const current = currentIncomeLayerForAccount(platform, selectedAccount(platform));
      const entry = currentEntryForAccount(platform, selectedAccount(platform));
      if (entry && incomeLayerFieldsConfigured(entry)) {
        form.incomeLayerMode = current.enabled === false ? "disabled" : "enabled";
      } else {
        form.incomeLayerMode = incomeLayerSupported(form.strategy) ? "enabled" : "disabled";
      }
      form.incomeLayerStartUsd = current.startUsd || String(defaults?.startUsd || "");
      form.incomeLayerMaxRatio = current.maxRatio || defaults?.maxRatio || "";
    }

    function syncOptionOverlayForAccount(platform) {
      const form = state.forms[platform];
      if (!form || form.optionOverlayTouched) return;
      const configured = normalizeOptionOverlayMode(selectedAccount(platform)?.option_overlay_mode);
      if (configured !== "current") {
        form.optionOverlayMode = configured;
        return;
      }
      const entry = currentEntryForAccount(platform, selectedAccount(platform));
      const rawValue = cleanOptionalBoolean(entry?.option_overlay_enabled);
      if (rawValue !== null) {
        form.optionOverlayMode = rawValue ? "enabled" : "disabled";
        return;
      }
      form.optionOverlayMode = optionOverlaySupported(form.strategy) ? "enabled" : "disabled";
    }

    function syncCashOnlyExecutionForAccount(platform) {
      const form = state.forms[platform];
      if (!form || form.cashOnlyExecutionTouched) return;
      const configured = normalizeCashOnlyExecutionMode(selectedAccount(platform)?.cash_only_execution_mode);
      if (configured !== "current") {
        form.cashOnlyExecutionMode = configured;
        return;
      }
      const entry = currentEntryForAccount(platform, selectedAccount(platform));
      const rawValue = cleanOptionalBoolean(entry?.cash_only_execution);
      if (rawValue !== null) {
        form.cashOnlyExecutionMode = rawValue ? "enabled" : "disabled";
        return;
      }
      // No explicit config — use platform default (cash-only for margin-capable platforms)
      form.cashOnlyExecutionMode = platformSupportsMarginPolicy(platform) ? "enabled" : "disabled";
    }

    function syncDcaForAccount(platform) {
      const form = state.forms[platform];
      if (!form || form.dcaTouched) return;
      const current = currentDcaForAccount(platform, selectedAccount(platform), form.strategy);
      form.dcaMode = current.supported ? current.mode : "fixed";
      form.dcaBaseInvestmentUsd = current.supported ? current.baseInvestmentUsd : "";
    }

    function ensureAccountSelection(platform) {
      const options = optionsFor(platform);
      if (!options.length) return;
      if (!options.some((option) => option.key === state.forms[platform].accountKey)) {
        state.forms[platform].accountKey = options[0].key;
        state.forms[platform].runtimeTargetTouched = false;
        state.forms[platform].reservedCashTouched = false;
        state.forms[platform].incomeLayerTouched = false;
        state.forms[platform].optionOverlayTouched = false;
        state.forms[platform].cashOnlyExecutionTouched = false;
        state.forms[platform].dcaTouched = false;
        state.forms[platform].strategy = defaultStrategyForAccount(platform, options[0]);
        state.forms[platform].pluginMode = currentPluginModeForAccount(platform, options[0]);
        syncRuntimeTargetForAccount(platform);
        syncReservePolicyForAccount(platform);
        syncIncomeLayerForAccount(platform);
        syncOptionOverlayForAccount(platform);
        syncCashOnlyExecutionForAccount(platform);
        syncDcaForAccount(platform);
      }
    }

    function derivedService(platform, targetName) {
      if (platform === "longbridge") return `longbridge-quant-${targetName.toLowerCase()}-service`;
      if (platform === "ibkr") return `interactive-brokers-${targetName.toLowerCase()}-service`;
      if (platform === "schwab") return "charles-schwab-quant-service";
      if (platform === "firstrade") return "firstrade-quant-service";
      if (platform === "qmt") return "qmt-quant-service";
      return "";
    }

    function accountMetaText(platform = state.selected) {
      const account = selectedAccount(platform);
      const targetName = account.target_name || account.key;
      const raw = account.service_name || derivedService(platform, targetName);
      const service = raw || (state.lang === "zh" ? "无" : "-");
      return t("targetMeta")
        .replace("{target}", targetName)
        .replace("{service}", service)
        .replace("{domains}", supportedDomainLabel(platform, account));
    }

    function hasRunnableStrategySelection(platform = state.selected) {
      const form = state.forms[platform];
      const account = selectedAccount(platform);
      return Boolean(form?.strategy && account && strategyAllowedForAccount(platform, account, form.strategy, form.executionMode));
    }

    function hasValidReservePolicy(platform = state.selected) {
      if (!platformSupportsReservedCashPolicy(platform)) return true;
      const form = state.forms[platform];
      const mode = normalizeReservePolicyMode(form?.reservePolicyMode);
      if (mode === "current" || mode === "none") return true;
      return Boolean(reservePolicyOverrideForForm(form, platform));
    }

    function hasValidExecutionCashPolicy(platform = state.selected) {
      if (!platformSupportsMarginPolicy(platform) && !platformSupportsReservedCashPolicy(platform)) return true;
      const form = state.forms[platform];
      return !executionCashPolicyConflict(form) && hasValidReservePolicy(platform);
    }

    function hasValidIncomeLayerPolicy(platform = state.selected) {
      const form = state.forms[platform];
      if (!incomeLayerSupported(form?.strategy)) return true;
      const mode = normalizeIncomeLayerMode(form?.incomeLayerMode);
      if (mode === "current" || mode === "disabled") return true;
      const defaults = incomeLayerDefaultForStrategy(form?.strategy);
      const startUsd = cleanDisplayNumber(form?.incomeLayerStartUsd || defaults?.startUsd);
      const maxRatio = cleanDisplayRatio(form?.incomeLayerMaxRatio || defaults?.maxRatio);
      return Boolean(startUsd && maxRatio);
    }

    function hasValidOptionOverlayPolicy(platform = state.selected) {
      const form = state.forms[platform];
      const mode = normalizeOptionOverlayMode(form?.optionOverlayMode);
      return mode !== "enabled" || optionOverlaySupported(form?.strategy);
    }

    function hasValidDcaPolicy(platform = state.selected) {
      const form = state.forms[platform];
      if (!dcaSupported(form?.strategy) || !platformSupportsDca(platform)) return true;
      return Boolean(dcaModes.includes(normalizeDcaMode(form?.dcaMode)) && cleanDisplayPositiveNumber(form?.dcaBaseInvestmentUsd));
    }

    function hasValidStrategySelection(platform = state.selected) {
      return hasRunnableStrategySelection(platform) &&
        hasValidExecutionCashPolicy(platform) &&
        hasValidIncomeLayerPolicy(platform) &&
        hasValidOptionOverlayPolicy(platform) &&
        hasValidDcaPolicy(platform);
    }

    function normalizeReservePolicyMode(value) {
      return reservePolicyModes.includes(value) ? value : "current";
    }

    function reservePolicyOverrideForForm(form, platform = state.selected) {
      if (!platformSupportsReservedCashPolicy(platform)) return null;
      const mode = normalizeReservePolicyMode(form?.reservePolicyMode);
      const floor = cleanDisplayNumber(form?.minReservedCashUsd);
      const ratio = cleanDisplayRatio(form?.reservedCashRatio);
      const extraVariables = {};
      if (mode === "current") return null;
      if (mode === "none") {
        extraVariables[platformMinReservedCashVariables[platform]] = "";
        extraVariables[platformReservedCashRatioVariables[platform]] = "";
        return { inputs: {}, extraVariables };
      }
      if (mode === "ratio") {
        if (!ratio) return null;
        extraVariables[platformMinReservedCashVariables[platform]] = "";
        return { inputs: { reserved_cash_ratio: ratio }, extraVariables };
      }
      if (mode === "floor") {
        if (!floor) return null;
        extraVariables[platformReservedCashRatioVariables[platform]] = "";
        return { inputs: { min_reserved_cash_usd: floor }, extraVariables };
      }
      if (mode === "max") {
        if (!floor || !ratio) return null;
        return { inputs: { min_reserved_cash_usd: floor, reserved_cash_ratio: ratio }, extraVariables };
      }
      return null;
    }

    function runtimeTargetOverrideForForm(form) {
      const mode = normalizeRuntimeTargetMode(form?.runtimeTargetMode);
      if (mode === "current") return null;
      return {
        inputs: { runtime_target_enabled_mode: mode },
        extraVariables: { [runtimeTargetEnabledVariable]: mode === "enabled" ? "true" : "false" },
      };
    }

    function incomeLayerOverrideForForm(form) {
      const defaults = incomeLayerDefaultForStrategy(form?.strategy);
      if (!defaults) return null;
      const mode = normalizeIncomeLayerMode(form?.incomeLayerMode);
      if (mode === "current") return null;
      const extraVariables = {};
      if (mode === "disabled") {
        extraVariables[incomeLayerEnabledVariable] = "false";
        extraVariables[incomeLayerStartUsdVariable] = "";
        extraVariables[incomeLayerMaxRatioVariable] = "";
        return { inputs: { income_layer_mode: mode }, extraVariables };
      }
      const startUsd = cleanDisplayNumber(form?.incomeLayerStartUsd || defaults.startUsd);
      const maxRatio = cleanDisplayRatio(form?.incomeLayerMaxRatio || defaults.maxRatio);
      if (!startUsd || !maxRatio) return null;
      extraVariables[incomeLayerEnabledVariable] = "true";
      extraVariables[incomeLayerStartUsdVariable] = startUsd;
      extraVariables[incomeLayerMaxRatioVariable] = maxRatio;
      return { inputs: { income_layer_mode: mode, income_layer_start_usd: startUsd, income_layer_max_ratio: maxRatio }, extraVariables };
    }

    function optionOverlayOverrideForForm(form) {
      const mode = normalizeOptionOverlayMode(form?.optionOverlayMode);
      if (mode === "current") return null;
      if (mode === "enabled" && !optionOverlaySupported(form?.strategy)) return null;
      return { inputs: { option_overlay_mode: mode } };
    }

    function cashOnlyExecutionOverrideForForm(form, platform = state.selected) {
      if (!platformSupportsMarginPolicy(platform)) return null;
      const mode = normalizeCashOnlyExecutionMode(form?.cashOnlyExecutionMode);
      if (mode === "current") return null;
      return { inputs: { cash_only_execution_mode: mode } };
    }

    function dcaOverrideForForm(form) {
      if (!dcaSupported(form?.strategy) || !platformSupportsDca(state.selected)) return null;
      const mode = normalizeDcaMode(form?.dcaMode);
      const baseInvestmentUsd = cleanDisplayPositiveNumber(form?.dcaBaseInvestmentUsd);
      if (!baseInvestmentUsd) return null;
      return { inputs: { dca_mode: mode, dca_base_investment_usd: baseInvestmentUsd } };
    }

    function mergeExtraVariables(inputs, extraVariables) {
      if (!extraVariables || !Object.keys(extraVariables).length) return;
      const merged = inputs.extra_variables_json ? JSON.parse(inputs.extra_variables_json) : {};
      Object.assign(merged, extraVariables);
      inputs.extra_variables_json = JSON.stringify(merged);
    }

    function buildInputs(platform = state.selected) {
      const form = state.forms[platform];
      const account = selectedAccount(platform);
      const targetName = account.target_name || account.key;
      const inputs = {
        platform,
        target_name: targetName,
        strategy_profile: form.strategy,
        execution_mode: form.executionMode,
        variable_scope: account.variable_scope || "default",
        plugin_mode: normalizePluginMode(form.pluginMode),
        service_targets_mode: "auto",
        apply: "true",
        trigger_platform_sync: "true",
        confirm_apply: "APPLY_AND_SYNC",
        platform_sync_workflow: "sync-cloud-run-env.yml",
      };
      for (const field of [
        "github_environment",
        "deployment_selector",
        "account_selector",
        "account_scope",
        "service_name",
      ]) {
        if (account[field]) inputs[field] = account[field];
      }
      const reserveOverride = platformSupportsReservedCashPolicy(platform)
        ? reservePolicyOverrideForForm(form, platform)
        : null;
      if (platformSupportsReservedCashPolicy(platform)) {
        inputs.reserved_cash_policy_mode = normalizeReservePolicyMode(form.reservePolicyMode);
        if (reserveOverride) {
          Object.assign(inputs, reserveOverride.inputs);
          mergeExtraVariables(inputs, reserveOverride.extraVariables);
        }
      }
      const runtimeTargetOverride = runtimeTargetOverrideForForm(form);
      inputs.runtime_target_enabled_mode = normalizeRuntimeTargetMode(form.runtimeTargetMode);
      if (runtimeTargetOverride) {
        Object.assign(inputs, runtimeTargetOverride.inputs);
        mergeExtraVariables(inputs, runtimeTargetOverride.extraVariables);
      }
      const incomeOverride = incomeLayerOverrideForForm(form);
      inputs.income_layer_mode = normalizeIncomeLayerMode(form.incomeLayerMode);
      if (incomeOverride) {
        Object.assign(inputs, incomeOverride.inputs);
        mergeExtraVariables(inputs, incomeOverride.extraVariables);
      }
      const optionOverlayOverride = optionOverlayOverrideForForm(form);
      inputs.option_overlay_mode = normalizeOptionOverlayMode(form.optionOverlayMode);
      if (optionOverlayOverride) {
        Object.assign(inputs, optionOverlayOverride.inputs);
      }
      const cashOnlyOverride = cashOnlyExecutionOverrideForForm(form, platform);
      if (platformSupportsMarginPolicy(platform)) {
        inputs.cash_only_execution_mode = normalizeCashOnlyExecutionMode(form.cashOnlyExecutionMode);
        if (cashOnlyOverride) {
          Object.assign(inputs, cashOnlyOverride.inputs);
        }
      }
      const dcaOverride = dcaOverrideForForm(form);
      if (dcaOverride) {
        Object.assign(inputs, dcaOverride.inputs);
      }
      return inputs;
    }

    function reservedCashPolicyText(inputs, platform = state.selected, account = selectedAccount(platform), fallback = t("unchanged")) {
      if (inputs?.reserved_cash_policy_mode === "none") return t("reservedCashNone");
      const floor = cleanDisplayNumber(inputs?.min_reserved_cash_usd);
      const ratio = cleanDisplayRatio(inputs?.reserved_cash_ratio);
      const currency = selectedCashCurrency(platform, account);
      const hasEffectiveFloor = Boolean(floor && !(ratio && Number(floor) === 0));
      if (!hasEffectiveFloor && !ratio) return fallback;
      if (hasEffectiveFloor && ratio) return `max(${floor} ${currency}, ${formatRatioPercent(ratio)})`;
      if (hasEffectiveFloor) return `${floor} ${currency}`;
      return formatRatioPercent(ratio);
    }

    function platformReservedCashDefaultText(platform = state.selected, account = selectedAccount(platform)) {
      return t("reservedCashDefault").replace("{currency}", selectedCashCurrency(platform, account));
    }

    function currentReservedCashPolicyText(platform = state.selected, account = selectedAccount(platform)) {
      const entry = currentEntryForAccount(platform, account);
      const policy = currentReservePolicyForAccount(platform, account);
      return reservedCashPolicyText(
        {
          min_reserved_cash_usd: policy.minReservedCashUsd,
          reserved_cash_ratio: policy.reservedCashRatio,
        },
        platform,
        account,
        entry ? platformReservedCashDefaultText(platform, account) : t("notRead"),
      );
    }

    function pendingReservedCashPolicyText(inputs, platform = state.selected, account = selectedAccount(platform)) {
      return reservedCashPolicyText(pendingReservePolicy(inputs, platform, account).inputs, platform, account, t("unchanged"));
    }

    function pendingReservePolicy(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const current = currentReservePolicyForAccount(platform, account);
      const currentFloor = cleanDisplayNumber(current.minReservedCashUsd);
      const currentRatio = cleanDisplayRatio(current.reservedCashRatio);
      const mode = normalizeReservePolicyMode(inputs.reserved_cash_policy_mode);
      const next = {
        min_reserved_cash_usd: cleanDisplayNumber(inputs.min_reserved_cash_usd),
        reserved_cash_ratio: cleanDisplayRatio(inputs.reserved_cash_ratio),
      };
      if (mode === "none") {
        next.reserved_cash_policy_mode = "none";
      }
      const entry = currentEntryForAccount(platform, account);
      const changed = Boolean(entry && (
        next.min_reserved_cash_usd !== currentFloor ||
          next.reserved_cash_ratio !== currentRatio ||
          (mode === "none" && (currentFloor || currentRatio))
      ));
      return { changed, inputs: next };
    }

    function currentIncomeLayerText(platform = state.selected, account = selectedAccount(platform), profile = state.forms[platform]?.strategy) {
      const defaults = incomeLayerDefaultForStrategy(profile);
      if (!defaults) return t("incomeLayerNotSupported");
      const entry = currentEntryForAccount(platform, account);
      if (!entry) return t("notRead");
      const current = incomeLayerFromEntry(entry);
      if (!incomeLayerFieldsConfigured(entry)) {
        return t("incomeLayerDefault")
          .replace("{start}", formatUsd(defaults.startUsd))
          .replace("{ratio}", formatRatioPercent(defaults.maxRatio));
      }
      const enabled = current.enabled ?? true;
      const startUsd = current.startUsd || String(defaults.startUsd);
      const ratio = current.maxRatio || defaults.maxRatio;
      return enabled
        ? t("incomeLayerOn")
          .replace("{start}", formatUsd(startUsd))
          .replace("{ratio}", formatRatioPercent(ratio))
        : t("incomeLayerOff");
    }

    function pendingIncomeLayerText(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const pending = pendingIncomeLayer(inputs, platform, account);
      if (!pending.supported) return t("incomeLayerNotSupported");
      if (!pending.changed) return t("unchanged");
      if (pending.inputs.income_layer_enabled === false) return t("incomeLayerOff");
      return t("incomeLayerOn")
        .replace("{start}", formatUsd(pending.inputs.income_layer_start_usd))
        .replace("{ratio}", formatRatioPercent(pending.inputs.income_layer_max_ratio));
    }

    function pendingOptionOverlayText(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const pending = pendingOptionOverlay(inputs, platform, account);
      if (!pending.supported && pending.inputs.option_overlay_enabled !== false) return t("optionOverlayNotSupported");
      if (!pending.changed) return t("unchanged");
      return optionOverlayText(pending.inputs.option_overlay_enabled);
    }

    function pendingCashOnlyExecutionText(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const pending = pendingCashOnlyExecution(inputs, platform, account);
      if (!pending.changed) return t("unchanged");
      return cashOnlyExecutionText(pending.inputs.cash_only_execution);
    }

    function pendingRuntimeTargetText(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const pending = pendingRuntimeTarget(inputs, platform, account);
      if (!pending.changed) return t("unchanged");
      return runtimeTargetText(pending.inputs.runtime_target_enabled);
    }

    function pendingRuntimeTargetTone(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const pending = pendingRuntimeTarget(inputs, platform, account);
      if (!pending.changed) return "neutral";
      return runtimeTargetTone(pending.inputs.runtime_target_enabled);
    }

    function currentDcaText(platform = state.selected, account = selectedAccount(platform), profile = state.forms[platform]?.strategy) {
      const current = currentDcaForAccount(platform, account, profile);
      if (!current.supported) return t("dcaNotSupported");
      return t("dcaText")
        .replace("{mode}", dcaModeLabel(current.mode))
        .replace("{amount}", formatUsd(current.baseInvestmentUsd));
    }

    function pendingDcaText(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const pending = pendingDca(inputs, platform, account);
      if (!pending.supported) return t("dcaNotSupported");
      if (!pending.changed) return t("unchanged");
      return t("dcaText")
        .replace("{mode}", dcaModeLabel(pending.inputs.dca_mode))
        .replace("{amount}", formatUsd(pending.inputs.dca_base_investment_usd));
    }

    function pendingRuntimeTarget(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const mode = normalizeRuntimeTargetMode(inputs.runtime_target_enabled_mode);
      if (mode === "current") {
        return {
          changed: false,
          inputs: { runtime_target_enabled: runtimeTargetEnabledForAccount(platform, account) ?? true },
        };
      }
      const current = runtimeTargetEnabledForAccount(platform, account);
      const currentEnabled = current ?? true;
      const nextEnabled = mode === "enabled";
      const entry = currentEntryForAccount(platform, account);
      return {
        changed: Boolean(entry && current !== null && currentEnabled !== nextEnabled),
        inputs: { runtime_target_enabled: nextEnabled },
      };
    }

    function pendingIncomeLayer(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const profile = cleanStrategyProfile(inputs.strategy_profile || state.forms[platform]?.strategy);
      const defaults = incomeLayerDefaultForStrategy(profile);
      if (!defaults) return { supported: false, changed: false, inputs: {} };
      const mode = normalizeIncomeLayerMode(inputs.income_layer_mode);
      const entry = currentEntryForAccount(platform, account);
      const rawCurrent = currentIncomeLayerForAccount(platform, account);
      const effective = effectiveIncomeLayerForAccount(platform, account, profile);
      const currentEnabled = effective?.enabled ?? true;
      const currentStartUsd = effective?.startUsd ?? String(defaults.startUsd);
      const currentRatio = effective?.maxRatio ?? defaults.maxRatio;
      if (mode === "current") {
        return {
          supported: true,
          changed: false,
          inputs: {
            income_layer_enabled: rawCurrent.enabled,
            income_layer_start_usd: rawCurrent.startUsd,
            income_layer_max_ratio: rawCurrent.maxRatio,
          },
        };
      }
      if (mode === "disabled") {
        if (!entry) {
          return {
            supported: true,
            changed: false,
            inputs: {
              income_layer_enabled: false,
              income_layer_start_usd: "",
              income_layer_max_ratio: "",
            },
          };
        }
        return {
          supported: true,
          changed: currentEnabled !== false || Boolean(rawCurrent.startUsd || rawCurrent.maxRatio),
          inputs: {
            income_layer_enabled: false,
            income_layer_start_usd: "",
            income_layer_max_ratio: "",
          },
        };
      }
      const nextStartUsd = cleanDisplayNumber(inputs.income_layer_start_usd || defaults.startUsd);
      const nextRatio = cleanDisplayRatio(inputs.income_layer_max_ratio || defaults.maxRatio);
      return {
        supported: true,
        changed: Boolean(entry && (currentEnabled !== true || nextStartUsd !== currentStartUsd || nextRatio !== currentRatio)),
        inputs: {
          income_layer_enabled: true,
          income_layer_start_usd: nextStartUsd,
          income_layer_max_ratio: nextRatio,
        },
      };
    }

    function pendingOptionOverlay(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const profile = cleanStrategyProfile(inputs.strategy_profile || state.forms[platform]?.strategy);
      const supported = optionOverlaySupported(profile);
      const mode = normalizeOptionOverlayMode(inputs.option_overlay_mode);
      const current = effectiveOptionOverlayForAccount(platform, account, profile);
      if (mode === "current") {
        return {
          supported,
          changed: false,
          inputs: { option_overlay_enabled: currentOptionOverlayForAccount(platform, account) },
        };
      }
      if (mode === "enabled") {
        return {
          supported,
          changed: supported && current !== null && current !== true,
          inputs: { option_overlay_enabled: true },
        };
      }
      return {
        supported,
        changed: current === true,
        inputs: { option_overlay_enabled: false },
      };
    }

    function pendingCashOnlyExecution(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const mode = normalizeCashOnlyExecutionMode(inputs.cash_only_execution_mode);
      if (!platformSupportsMarginPolicy(platform) || mode === "current") {
        return { changed: false, inputs: {} };
      }
      const current = effectiveCashOnlyExecutionForAccount(platform, account);
      const nextEnabled = mode === "enabled";
      const entry = currentEntryForAccount(platform, account);
      return {
        changed: Boolean(entry && current !== null && current !== nextEnabled),
        inputs: { cash_only_execution: nextEnabled },
      };
    }

    function pendingDca(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const profile = cleanStrategyProfile(inputs.strategy_profile || state.forms[platform]?.strategy);
      const defaults = dcaConfigForStrategy(profile);
      if (!defaults) return { supported: false, changed: false, inputs: {} };
      const current = currentDcaForAccount(platform, account, profile);
      const nextMode = normalizeDcaMode(inputs.dca_mode || defaults.defaultMode);
      const nextBase = cleanDisplayPositiveNumber(inputs.dca_base_investment_usd || defaults.defaultBaseInvestmentUsd);
      return {
        supported: true,
        changed: Boolean(current.mode !== nextMode || current.baseInvestmentUsd !== nextBase),
        inputs: {
          dca_mode: nextMode,
          dca_base_investment_usd: nextBase,
        },
      };
    }

    function pendingChangeState(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const currentProfile = currentStrategyForAccount(platform, account);
      const nextProfile = cleanStrategyProfile(inputs.strategy_profile);
      const currentEntry = currentEntryForAccount(platform, account);
      const currentMode = normalizeExecutionMode(currentEntry?.execution_mode, currentEntry?.dry_run_only);
      const currentPluginMode = currentPluginModeForAccount(platform, account);
      const nextPluginMode = normalizePluginMode(inputs.plugin_mode);
      const runtimeTarget = pendingRuntimeTarget(inputs, platform, account);
      const reserve = pendingReservePolicy(inputs, platform, account);
      const income = pendingIncomeLayer(inputs, platform, account);
      const optionOverlay = pendingOptionOverlay(inputs, platform, account);
      const cashOnly = pendingCashOnlyExecution(inputs, platform, account);
      const dca = pendingDca(inputs, platform, account);
      return {
        currentProfile,
        nextProfile,
        currentMode,
        currentPluginMode,
        nextPluginMode,
        strategyChanged: Boolean(nextProfile && ((state.forms[platform]?.strategyTouched) || (currentProfile && currentProfile !== nextProfile))),
        modeChanged: Boolean(inputs.execution_mode && currentMode && currentMode !== inputs.execution_mode),
        pluginModeChanged: Boolean(nextPluginMode && currentPluginMode && currentPluginMode !== nextPluginMode),
        runtimeTargetChanged: runtimeTarget.changed,
        reserveCashChanged: reserve.changed,
        incomeLayerChanged: income.changed,
        optionOverlayChanged: optionOverlay.changed,
        cashOnlyChanged: cashOnly.changed,
        dcaChanged: dca.changed,
        runtimeTarget,
        reserve,
        income,
        optionOverlay,
        cashOnly,
        dca,
      };
    }

    function hasPendingChanges(inputs, platform = state.selected, account = selectedAccount(platform)) {
      const changes = pendingChangeState(inputs, platform, account);
      return Boolean(
        changes.strategyChanged ||
          changes.modeChanged ||
          changes.pluginModeChanged ||
          changes.runtimeTargetChanged ||
          changes.reserveCashChanged ||
          changes.incomeLayerChanged ||
          changes.optionOverlayChanged ||
          changes.cashOnlyChanged ||
          changes.dcaChanged
      );
    }

    function formatRatioPercent(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return String(value);
      return `${(numeric * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
    }

    function formatUsd(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return String(value);
      return `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    }

    function incomeLayerAllocationText(defaults) {
      if (!defaults?.allocations) return "";
      return Object.entries(defaults.allocations)
        .map(([symbol, ratio]) => `${symbol} ${formatRatioPercent(ratio)}`)
        .join(" / ");
    }

    function incomeLayerDefaultMetaText(defaults) {
      if (!defaults) return t("incomeLayerModeMeta");
      return t("incomeLayerDefaultMeta")
        .replace("{start}", formatUsd(defaults.startUsd))
        .replace("{ratio}", formatRatioPercent(defaults.maxRatio));
    }

    function optionOverlayDefaultMetaText(defaults) {
      if (!defaults?.families?.length) return t("optionOverlayModeMeta");
      const familyText = defaults.families.map((item) => {
        const family = item.family === "income" ? t("optionOverlayFamilyIncome") : t("optionOverlayFamilyGrowth");
        const ratioText = item.ratioKind === "risk"
          ? t("optionOverlayRiskRatio").replace("{ratio}", formatRatioPercent(item.ratio))
          : t("optionOverlayBudgetRatio").replace("{ratio}", formatRatioPercent(item.ratio));
        return `${family}: ${item.recipe}, ${formatUsd(item.startUsd)}, ${ratioText}`;
      }).join(" / ");
      return t("optionOverlayDefaultMeta").replace("{defaults}", familyText);
    }

    function summaryRows(inputs) {
      const account = selectedAccount();
      const changes = pendingChangeState(inputs, state.selected, account);
      const currentStrategyText = changes.currentProfile ? strategyLabel(changes.currentProfile) : t("notRead");
      const rows = [
        [t("repository"), state.repositories[state.selected] || defaultRepositories[state.selected]],
        [t("selectedAccount"), account.label],
        [t("currentStrategy"), currentStrategyText],
        [t("selectedMarket"), supportedDomainLabel(state.selected, account)],
        [
          t("currentRuntimeTarget"),
          currentRuntimeTargetText(state.selected, account),
          "",
          currentRuntimeTargetTone(state.selected, account),
        ],
        [t("currentPluginMode"), pluginModeLabel(changes.currentPluginMode)],
        [t("reservedCashPolicy"), currentReservedCashPolicyText(state.selected, account)],
      ];
      if (platformSupportsMarginPolicy(state.selected)) {
        rows.push([t("currentCashOnlyExecution"), currentCashOnlyExecutionText(state.selected, account)]);
      }
      if (incomeLayerSupported(inputs.strategy_profile)) {
        rows.push([t("currentIncomeLayer"), currentIncomeLayerText(state.selected, account, inputs.strategy_profile)]);
      }
      if (optionOverlaySupported(inputs.strategy_profile) || changes.optionOverlayChanged) {
        rows.push([t("currentOptionOverlay"), currentOptionOverlayText(state.selected, account, inputs.strategy_profile)]);
      }
      if (dcaSupported(inputs.strategy_profile)) {
        rows.push([t("currentDca"), currentDcaText(state.selected, account, inputs.strategy_profile)]);
      }
      if (changes.reserveCashChanged) {
        rows.push([t("pendingReservedCashPolicy"), pendingReservedCashPolicyText(inputs, state.selected, account), "pending"]);
      }
      if (changes.incomeLayerChanged) {
        rows.push([t("pendingIncomeLayer"), pendingIncomeLayerText(inputs, state.selected, account), "pending"]);
      }
      if (changes.optionOverlayChanged) {
        rows.push([t("pendingOptionOverlay"), pendingOptionOverlayText(inputs, state.selected, account), "pending"]);
      }
      if (changes.cashOnlyChanged) {
        rows.push([t("pendingCashOnlyExecution"), pendingCashOnlyExecutionText(inputs, state.selected, account), "pending"]);
      }
      if (changes.dcaChanged) {
        rows.push([t("pendingDca"), pendingDcaText(inputs, state.selected, account), "pending"]);
      }
      if (changes.modeChanged) {
        rows.push([t("pendingMode"), modeLabel(inputs.execution_mode), "pending"]);
      }
      if (changes.pluginModeChanged) {
        rows.push([t("pendingPluginMode"), pluginModeLabel(changes.nextPluginMode), "pending"]);
      }
      if (changes.runtimeTargetChanged) {
        rows.push([
          t("pendingRuntimeTarget"),
          pendingRuntimeTargetText(inputs, state.selected, account),
          "pending",
          pendingRuntimeTargetTone(inputs, state.selected, account),
        ]);
      }
      if (changes.strategyChanged && changes.nextProfile) {
        rows.push([t("nextStrategy"), strategyLabel(changes.nextProfile), "pending"]);
      }
      return rows;
    }

    function applyLanguage() {
      document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
      document.querySelectorAll("[data-i18n]").forEach((node) => {
        node.textContent = t(node.dataset.i18n);
      });
      el("lang-button").textContent = state.lang === "zh" ? "EN" : "中";
    }

    function renderPlatforms() {
      const strip = el("platform-strip");
      strip.replaceChildren();
      const showPrivateConfig = hasPrivateConfig();
      for (const platform of Object.keys(platformMeta)) {
        ensureAccountSelection(platform);
        const meta = platformMeta[platform];
        const form = state.forms[platform];
        const account = selectedAccount(platform);
        const button = document.createElement("button");
        button.className = "platform-button";
        button.type = "button";
        button.dataset.platform = platform;
        button.classList.toggle("active", platform === state.selected);
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = meta.code;
        const copyNode = document.createElement("span");
        copyNode.className = "platform-copy";
        const labelNode = document.createElement("strong");
        labelNode.textContent = meta.label;
        copyNode.append(labelNode);
        if (showPrivateConfig) {
          const accountNode = document.createElement("span");
          accountNode.textContent = account.label;
          const strategyNode = document.createElement("small");
          strategyNode.textContent = strategyLabel(form.strategy);
          copyNode.append(accountNode, strategyNode);
        }
        button.append(mark, copyNode);
        strip.appendChild(button);
      }
    }

    function renderControls() {
      const platform = state.selected;
      const meta = platformMeta[platform];
      const form = state.forms[platform];
      const accounts = optionsFor(platform);
      const account = selectedAccount(platform);
      const choices = strategyChoicesForAccount(platform, account, form.executionMode);
      const currentStrategy = currentStrategyForAccount(platform, account);
      const currentStrategyBlocked = Boolean(
        currentStrategy &&
          !strategyAllowedForAccount(platform, account, currentStrategy, form.executionMode),
      );
      const accountSelect = el("account-select");
      const strategySelect = el("strategy-select");
      const runtimeTargetEnabledSelect = el("runtime-target-enabled-select");
      const pluginModeSelect = el("plugin-mode-select");
      const incomeLayerModeSelect = el("income-layer-mode-select");
      const incomeLayerStartUsdInput = el("income-layer-start-usd-input");
      const incomeLayerMaxRatioInput = el("income-layer-max-ratio-input");
      const optionOverlayModeSelect = el("option-overlay-mode-select");
      const cashOnlyExecutionModeSelect = el("cash-only-execution-mode-select");
      const dcaModeSelect = el("dca-mode-select");
      const dcaBaseInvestmentUsdInput = el("dca-base-investment-usd-input");
      const reservePolicyModeSelect = el("reserve-policy-mode-select");
      const minReservedCashInput = el("min-reserved-cash-input");
      const reservedCashRatioInput = el("reserved-cash-ratio-input");
      const showPrivateControls = hasPrivateConfig();

      el("switch-panel").style.setProperty("--platform-color", meta.accent);
      el("platform-title").textContent = meta.label;
      el("quick-form").hidden = !showPrivateControls;
      el("run-area").hidden = !showPrivateControls;
      el("public-note").hidden = showPrivateControls;
      el("public-preview").hidden = showPrivateControls;
      el("public-note").textContent = state.auth.allowed ? t("missingConfigNote") : t("publicReadonly");

      if (!showPrivateControls) {
        accountSelect.replaceChildren();
        strategySelect.replaceChildren();
        runtimeTargetEnabledSelect.replaceChildren();
        pluginModeSelect.replaceChildren();
        incomeLayerModeSelect.replaceChildren();
        optionOverlayModeSelect.replaceChildren();
        cashOnlyExecutionModeSelect.replaceChildren();
        dcaModeSelect.replaceChildren();
        reservePolicyModeSelect.replaceChildren();
        incomeLayerStartUsdInput.value = "";
        incomeLayerMaxRatioInput.value = "";
        dcaBaseInvestmentUsdInput.value = "";
        minReservedCashInput.value = "";
        reservedCashRatioInput.value = "";
        el("account-meta").textContent = "";
        el("strategy-meta").textContent = "";
        el("income-layer-mode-meta").textContent = "";
        el("income-layer-start-meta").textContent = "";
        el("income-layer-ratio-meta").textContent = "";
        el("option-overlay-mode-meta").textContent = "";
        el("cash-only-execution-mode-meta").textContent = "";
        el("dca-mode-meta").textContent = "";
        el("dca-base-meta").textContent = "";
        return;
      }

      accountSelect.replaceChildren();
      if (accounts.length) {
        for (const account of accounts) {
          accountSelect.append(new Option(account.label, account.key, false, account.key === form.accountKey));
        }
      } else {
        accountSelect.append(new Option(t("noAccount"), ""));
      }
      el("account-meta").textContent = accounts.length ? accountMetaText(platform) : "";

      if (choices.length && !choices.includes(form.strategy) && !currentStrategyBlocked) {
        form.strategy = choices[0];
      }
      strategySelect.disabled = !choices.length;
      strategySelect.replaceChildren();
      if (currentStrategyBlocked) {
        const blockedOption = new Option(
          strategyChoiceLabel(currentStrategy, platform, account, form.executionMode),
          currentStrategy,
          true,
          currentStrategy === form.strategy,
        );
        blockedOption.disabled = true;
        strategySelect.append(blockedOption);
      }
      if (choices.length) {
        for (const strategy of choices) {
          strategySelect.append(
            new Option(strategyChoiceLabel(strategy, platform, account, form.executionMode), strategy, false, strategy === form.strategy),
          );
        }
      } else {
        strategySelect.append(new Option(t("noStrategy"), ""));
      }
      el("strategy-meta").textContent = account
        ? strategyDisplayMetaText(platform, account, form.strategy)
        : "";
      runtimeTargetEnabledSelect.replaceChildren();
      for (const mode of runtimeTargetModes) {
        runtimeTargetEnabledSelect.append(
          new Option(runtimeTargetModeLabel(mode), mode, false, mode === normalizeRuntimeTargetMode(form.runtimeTargetMode)),
        );
      }
      pluginModeSelect.replaceChildren();
      for (const mode of pluginModes) {
        pluginModeSelect.append(new Option(pluginModeLabel(mode), mode, false, mode === normalizePluginMode(form.pluginMode)));
      }
      const incomeDefaults = incomeLayerDefaultForStrategy(form.strategy);
      el("income-layer-section").hidden = false;
      el("option-overlay-section").hidden = false;
      incomeLayerModeSelect.replaceChildren();
      if (incomeDefaults) {
        incomeLayerModeSelect.disabled = false;
        for (const mode of incomeLayerModes) {
          incomeLayerModeSelect.append(new Option(incomeLayerModeLabel(mode), mode, false, mode === normalizeIncomeLayerMode(form.incomeLayerMode)));
        }
        el("income-layer-mode-meta").textContent = incomeLayerDefaultMetaText(incomeDefaults);
        el("income-layer-start-meta").textContent = t("incomeLayerStartMeta");
        el("income-layer-ratio-meta").textContent = t("incomeLayerAllocationMeta").replace(
          "{allocations}",
          incomeLayerAllocationText(incomeDefaults),
        );
      } else {
        incomeLayerModeSelect.disabled = true;
        incomeLayerModeSelect.append(new Option(t("incomeLayerNotSupported"), "current"));
        el("income-layer-mode-meta").textContent = t("incomeLayerModeMeta");
        el("income-layer-start-meta").textContent = t("incomeLayerStartMeta");
        el("income-layer-ratio-meta").textContent = t("incomeLayerRatioMeta");
      }
      const supportsMargin = platformSupportsMarginPolicy(platform);
      const supportsReserve = platformSupportsReservedCashPolicy(platform);
      if (supportsMargin) syncCashOnlyExecutionForAccount(platform);
      reconcileExecutionCashPolicy(form, "margin");
      const executionCashPolicyGrid = el("execution-cash-policy-grid");
      const qmtPlatformCashNote = el("qmt-platform-cash-note");
      const executionCashPolicyNote = el("execution-cash-policy-note");
      executionCashPolicyGrid.hidden = !supportsMargin && !supportsReserve;
      qmtPlatformCashNote.hidden = supportsMargin || supportsReserve || platform !== "qmt";
      executionCashPolicyNote.hidden = !supportsMargin || !supportsReserve;

      const marginBlocksReserve = supportsMargin && supportsReserve && allowMarginExplicitlySelected(form);
      const reserveBlocksMargin = supportsMargin && supportsReserve && reserveCashOverrideActive(form);

      if (supportsReserve) {
        reservePolicyModeSelect.replaceChildren();
        for (const mode of reservePolicyModes) {
          reservePolicyModeSelect.append(new Option(t(`reservePolicy${mode[0].toUpperCase()}${mode.slice(1)}`), mode, false, mode === normalizeReservePolicyMode(form.reservePolicyMode)));
        }
        const reserveMode = normalizeReservePolicyMode(form.reservePolicyMode);
        el("min-reserved-cash-label").textContent = t("minReservedCash").replace(
          "{currency}",
          selectedCashCurrency(platform, account),
        );
        reservePolicyModeSelect.disabled = false;
        minReservedCashInput.disabled = reserveMode === "current" || reserveMode === "none" || reserveMode === "ratio";
        reservedCashRatioInput.disabled = reserveMode === "current" || reserveMode === "none" || reserveMode === "floor";
        minReservedCashInput.value = reserveMode === "ratio" || reserveMode === "none" ? "" : form.minReservedCashUsd;
        reservedCashRatioInput.value = reserveMode === "floor" || reserveMode === "none" ? "" : form.reservedCashRatio;
        el("reserve-policy-block").classList.toggle("policy-block-muted", marginBlocksReserve);
        el("min-reserve-block").classList.toggle("policy-block-muted", marginBlocksReserve);
        el("reserve-ratio-block").classList.toggle("policy-block-muted", marginBlocksReserve);
        el("reserve-policy-mode-meta").textContent = marginBlocksReserve
          ? t("executionCashMarginBlocksReserve")
          : t("reservedCashModeMeta");
      } else {
        reservePolicyModeSelect.replaceChildren();
        minReservedCashInput.value = "";
        reservedCashRatioInput.value = "";
      }
      const incomeMode = normalizeIncomeLayerMode(form.incomeLayerMode);
      const incomeLayerInputsDisabled = !incomeDefaults || incomeMode === "disabled";
      incomeLayerStartUsdInput.disabled = incomeLayerInputsDisabled;
      incomeLayerMaxRatioInput.disabled = incomeLayerInputsDisabled;
      if (incomeDefaults && incomeMode !== "disabled" && !cleanDisplayNumber(form.incomeLayerStartUsd)) {
        form.incomeLayerStartUsd = String(incomeDefaults.startUsd);
      }
      if (incomeDefaults && incomeMode !== "disabled" && !cleanDisplayRatio(form.incomeLayerMaxRatio)) {
        form.incomeLayerMaxRatio = incomeDefaults.maxRatio;
      }
      incomeLayerStartUsdInput.value = incomeDefaults && incomeMode !== "disabled" ? form.incomeLayerStartUsd : "";
      incomeLayerMaxRatioInput.value = incomeDefaults && incomeMode !== "disabled" ? form.incomeLayerMaxRatio : "";

      const optionDefaults = optionOverlayDefaultForStrategy(form.strategy);
      optionOverlayModeSelect.replaceChildren();
      if (optionDefaults) {
        optionOverlayModeSelect.disabled = false;
        for (const mode of optionOverlayModes) {
          optionOverlayModeSelect.append(
            new Option(optionOverlayModeLabel(mode), mode, false, mode === normalizeOptionOverlayMode(form.optionOverlayMode)),
          );
        }
        el("option-overlay-mode-meta").textContent = optionOverlayDefaultMetaText(optionDefaults);
      } else {
        optionOverlayModeSelect.disabled = true;
        optionOverlayModeSelect.append(new Option(t("optionOverlayNotSupported"), "current"));
        el("option-overlay-mode-meta").textContent = t("optionOverlayModeMeta");
      }

      if (supportsMargin) {
        cashOnlyExecutionModeSelect.replaceChildren();
        for (const mode of cashOnlyExecutionModes) {
          const option = new Option(
            mode === "enabled" ? t("cashOnlyExecutionNo") : t("cashOnlyExecutionYes"),
            mode,
            false,
            mode === normalizeCashOnlyExecutionMode(form.cashOnlyExecutionMode),
          );
          cashOnlyExecutionModeSelect.append(option);
        }
        el("cash-only-policy-block").classList.toggle("policy-block-muted", reserveBlocksMargin);
        el("cash-only-execution-mode-meta").textContent = reserveBlocksMargin
          ? t("executionCashReserveBlocksMargin")
          : t("cashOnlyExecutionModeMeta");
      } else {
        cashOnlyExecutionModeSelect.replaceChildren();
        el("cash-only-execution-mode-meta").textContent = "";
      }

      const dcaDefaults = dcaConfigForStrategy(form.strategy);
      dcaModeSelect.replaceChildren();
      const dcaAllowed = Boolean(dcaDefaults) && platformSupportsDca(platform);
      if (dcaAllowed) {
        dcaModeSelect.disabled = false;
        for (const mode of dcaModes) {
          dcaModeSelect.append(new Option(dcaModeLabel(mode), mode, false, mode === normalizeDcaMode(form.dcaMode)));
        }
        if (!cleanDisplayPositiveNumber(form.dcaBaseInvestmentUsd)) {
          form.dcaBaseInvestmentUsd = dcaDefaults.defaultBaseInvestmentUsd;
        }
        dcaBaseInvestmentUsdInput.disabled = false;
        dcaBaseInvestmentUsdInput.value = form.dcaBaseInvestmentUsd;
        el("dca-mode-meta").textContent = t("dcaDefaultMeta")
          .replace("{mode}", dcaModeLabel(dcaDefaults.defaultMode))
          .replace("{amount}", formatUsd(dcaDefaults.defaultBaseInvestmentUsd));
        el("dca-base-meta").textContent = t("dcaModeMeta");
      } else {
        dcaModeSelect.disabled = true;
        dcaModeSelect.append(new Option(
          dcaDefaults && !platformSupportsDca(platform) ? t("dcaPlatformNotSupported") : t("dcaNotSupported"),
          "fixed",
        ));
        dcaBaseInvestmentUsdInput.disabled = true;
        dcaBaseInvestmentUsdInput.value = "";
        el("dca-mode-meta").textContent = t("dcaModeMeta");
        el("dca-base-meta").textContent = t("dcaModeMeta");
      }

      if (platformDryRunOnly(platform)) {
        form.executionMode = "paper";
      }
      document.querySelectorAll("#mode-control [data-mode]").forEach((button) => {
        const dryRunOnly = platformDryRunOnly(platform);
        button.disabled = dryRunOnly && button.dataset.mode === "live";
        button.classList.toggle("active", button.dataset.mode === form.executionMode);
      });
      el("mode-meta").textContent = platformDryRunOnly(platform) ? t("qmtDryRunOnlyNote") : "";
    }

    function renderSummary() {
      const showSummary = hasPrivateConfig();
      const summaryPanel = document.querySelector(".summary-panel");
      const switchSurface = document.querySelector(".switch-surface");
      summaryPanel.hidden = !showSummary;
      switchSurface.classList.toggle("summary-hidden", !showSummary);
      if (!showSummary) return;

      const inputs = buildInputs();
      const list = el("summary-list");
      list.replaceChildren();
      document.querySelector(".summary-head h2").textContent = t("summary");
      for (const [label, value, rowClass, valueTone] of summaryRows(inputs)) {
        const row = document.createElement("div");
        row.className = "summary-row";
        row.setAttribute("role", "listitem");
        if (rowClass) row.classList.add(rowClass);
        const labelNode = document.createElement("div");
        labelNode.className = "summary-label";
        labelNode.textContent = label;
        const valueNode = document.createElement("div");
        valueNode.className = "summary-value";
        if (valueTone) {
          const badge = document.createElement("span");
          badge.className = `summary-status ${valueTone}`;
          badge.textContent = value;
          valueNode.appendChild(badge);
        } else {
          valueNode.textContent = value;
        }
        row.append(labelNode, valueNode);
        list.appendChild(row);
      }

      const account = selectedAccount();
      const currentEntry = currentEntryForAccount(state.selected, account);
      const currentMode = normalizeExecutionMode(currentEntry?.execution_mode, currentEntry?.dry_run_only);
      el("mode-pill").textContent = currentMode ? modeLabel(currentMode) : t("notRead");
    }

    function renderAuth() {
      const status = el("auth-status");
      const loginLink = el("login-link");
      const logoutButton = el("logout-button");
      const signedIn = Boolean(state.auth.allowed && state.auth.login);

      status.hidden = !signedIn;
      status.textContent = signedIn ? t("signedInAs").replace("{login}", state.auth.login) : "";
      loginLink.hidden = signedIn;
      loginLink.href = "/login";
      loginLink.textContent = t("login");
      logoutButton.hidden = !signedIn;
      logoutButton.textContent = t("logout");

      const dispatch = el("dispatch-button");
      const hasPrivateAccounts = state.configSource === "private";
      const loadingConfig = state.configSource === "loading";
      const hasRunnableStrategy = hasRunnableStrategySelection();
      const hasValidReserve = hasValidExecutionCashPolicy();
      const hasValidIncomeLayer = hasValidIncomeLayerPolicy();
      const hasValidOptionOverlay = hasValidOptionOverlayPolicy();
      const hasValidDca = hasValidDcaPolicy();
      const hasValidStrategy = hasRunnableStrategy &&
        hasValidReserve &&
        hasValidIncomeLayer &&
        hasValidOptionOverlay &&
        hasValidDca;
      const hasPendingChange = hasPrivateAccounts && hasValidStrategy && hasPendingChanges(buildInputs());
      dispatch.disabled = !state.auth.allowed || loadingConfig || !hasPrivateAccounts || !hasValidStrategy || !hasPendingChange;
      dispatch.textContent = state.auth.allowed
        ? (loadingConfig
          ? t("loadingConfig")
          : (hasPrivateAccounts ? (hasValidStrategy ? (hasPendingChange ? t("runSwitch") : t("noChanges")) : t("configureAccounts")) : t("configureAccounts")))
        : t("loginToRun");
      const note = el("action-note");
      note.textContent = state.auth.allowed
        ? (loadingConfig
          ? t("loadingConfigNote")
          : (hasPrivateAccounts
            ? (hasRunnableStrategy
              ? (hasValidReserve
                ? (hasValidIncomeLayer
                  ? (hasValidOptionOverlay
                    ? (hasValidDca ? (hasPendingChange ? t("readyNote") : "") : t("invalidDcaNote"))
                    : t("invalidOptionOverlayNote"))
                  : t("invalidIncomeLayerNote"))
                : (executionCashPolicyConflict(state.forms[state.selected])
                  ? t("invalidExecutionCashPolicyNote")
                  : t("invalidReservePolicyNote")))
              : strategyActionNoteText())
            : t("missingConfigNote")))
        : t("readonlyNote");
      note.classList.toggle(
        "warning",
        state.auth.allowed && !loadingConfig && (!hasPrivateAccounts || !hasValidStrategy),
      );
    }

    function renderAppVisibility() {
      document.body.classList.toggle("app-loading", !state.appReady);
      el("boot-message").textContent = t(state.bootMessageKey);
    }

    function healthStatusLabel(status) {
      return { healthy: "健康", watch: "观察", review: "复核", critical: "严重" }[status] || "未知";
    }

    function normalizeHealthPayload(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid health payload");
      const strategies = Array.isArray(payload.strategies) ? payload.strategies : [];
      return {
        data_status: ["ready", "stale", "unavailable"].includes(payload.data_status) ? payload.data_status : "unavailable",
        computed_at: payload.computed_at || null,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        strategies: strategies.filter((item) => item && typeof item === "object" && ["healthy", "watch", "review", "critical"].includes(item.status)),
        errors: Array.isArray(payload.errors) ? payload.errors : [],
      };
    }

    function renderHealth() {
      const payload = state.health.payload;
      const summary = payload.summary || {};
      const statusText = payload.data_status === "ready"
        ? "快照已加载"
        : (payload.data_status === "stale" ? "快照已过期" : "等待可用快照");
      el("health-status").textContent = statusText;
      el("health-computed-at").textContent = payload.computed_at
        ? `最近计算：${new Date(payload.computed_at).toLocaleString()}`
        : "最近计算：—";
      el("health-count-total").textContent = String(Number(summary.strategy_count) || 0);
      el("health-count-healthy").textContent = String(Number(summary.healthy) || 0);
      el("health-count-watch").textContent = String(Number(summary.watch) || 0);
      el("health-count-review").textContent = String((Number(summary.review) || 0) + (Number(summary.critical) || 0));

      const notice = el("health-notice");
      if (!state.auth.allowed) {
        notice.textContent = "登录后读取私有策略健康快照；没有快照时不会展示虚构指标。";
      } else if (payload.data_status === "stale") {
        notice.textContent = "健康快照已超过允许的新鲜度窗口；页面保留原始状态，但不会把它当作当前健康结论。";
      } else if (payload.data_status !== "ready") {
        notice.textContent = "还没有可用的策略健康快照；当前页面保持 fail-closed 空状态。";
      } else if (payload.errors?.length) {
        notice.textContent = `快照已加载，但有 ${payload.errors.length} 个上游提示；缺失数据不会被替换成虚构指标。`;
      } else {
        notice.textContent = "健康不等于已批准 live；正常实盘、资金和杠杆变更仍需人工确认。";
      }

      const list = el("health-list");
      list.replaceChildren();
      const strategies = payload.strategies.filter((item) => state.health.filter === "all" || item.status === state.health.filter);
      if (!strategies.length) {
        const empty = document.createElement("div");
        empty.className = "health-card__empty";
        empty.textContent = "暂无可展示的策略健康快照。";
        list.appendChild(empty);
        return;
      }
      for (const item of strategies) {
        const card = document.createElement("article");
        card.className = "health-card";
        const main = document.createElement("div");
        main.className = "health-card__main";
        const meta = document.createElement("div");
        meta.className = "health-card__meta";
        meta.textContent = `${healthStatusLabel(item.status)} · ${item.domain || "unknown"}`;
        const title = document.createElement("h4");
        title.className = "health-card__title";
        title.textContent = String(item.profile || "unknown");
        const reason = document.createElement("p");
        reason.className = "health-card__reason";
        reason.textContent = `${item.decision?.label || "证据不足，保持研究态"}。${item.decision?.reason || "没有可用的机器检查结果。"}`;
        const detail = document.createElement("div");
        detail.className = "health-card__meta";
        detail.textContent = `阶段：${item.review?.requested_stage || "未标记"} · 截至：${item.as_of || "—"}`;
        main.append(meta, title, reason, detail);
        const scoreBlock = document.createElement("div");
        scoreBlock.className = "health-card__score";
        const scoreLabel = document.createElement("small");
        scoreLabel.textContent = "HEALTH";
        const score = document.createElement("strong");
        score.textContent = typeof item.score === "number" ? item.score.toFixed(1) : "—";
        const decision = document.createElement("small");
        decision.textContent = item.decision?.code || "evidence_missing";
        scoreBlock.append(scoreLabel, score, decision);
        card.append(main, scoreBlock);
        list.appendChild(card);
      }
    }

    function renderConsoleView() {
      const healthButton = el("health-view-button");
      const switchButton = el("switch-view-button");
      const healthVisible = state.view === "health";
      el("health-view").hidden = !healthVisible;
      el("switch-view").hidden = healthVisible;
      healthButton.classList.toggle("active", healthVisible);
      switchButton.classList.toggle("active", !healthVisible);
    }

    function render() {
      applyLanguage();
      renderConsoleView();
      renderHealth();
      renderPlatforms();
      renderControls();
      renderSummary();
      renderAuth();
      renderAppVisibility();
    }

    async function refreshSession() {
      state.bootMessageKey = "bootSession";
      render();
      try {
        const session = await requestJson("/api/session");
        state.auth = {
          available: true,
          allowed: Boolean(session.allowed),
          admin: Boolean(session.admin),
          login: session.login || null,
        };
      } catch {
        state.auth = { available: false, allowed: false, admin: false, login: null };
      }
      if (state.auth.allowed) {
        await refreshHealth();
        await refreshConfig();
      } else {
        state.bootMessageKey = "bootPublic";
        state.appReady = true;
        render();
      }
    }

    async function refreshHealth() {
      if (!state.auth.allowed) {
        renderHealth();
        return;
      }
      try {
        state.health.payload = normalizeHealthPayload(await requestJson("/api/strategy-health"));
      } catch {
        state.health.payload = {
          data_status: "unavailable",
          computed_at: null,
          summary: { strategy_count: 0, healthy: 0, watch: 0, review: 0, critical: 0 },
          strategies: [],
          errors: ["health_request_failed"],
        };
      }
      renderHealth();
    }

    async function refreshStrategyProfiles() {
      state.bootMessageKey = "bootStrategy";
      render();
      try {
        const payload = await requestJson("/api/strategy-profiles");
        applyStrategyProfiles(payload.strategyProfiles || []);
        if (payload.platformMeta) platformMeta = payload.platformMeta;
        for (const platform of Object.keys(platformMeta)) syncStrategyForAccount(platform);
        render();
      } catch {
        applyStrategyProfiles(defaultStrategyProfiles);
        for (const platform of Object.keys(platformMeta)) syncStrategyForAccount(platform);
      }
    }

    async function refreshConfig() {
      if (!state.auth.available || !state.auth.allowed) return;
      state.configSource = "loading";
      state.bootMessageKey = "bootConfig";
      render();
      try {
        const payload = await requestJson("/api/config");
        if (payload.accountOptions) {
          applyStrategyProfiles(payload.strategyProfiles || defaultStrategyProfiles);
          state.accountOptions = normalizeAccountOptions(payload.accountOptions);
          if (payload.platformMeta) platformMeta = payload.platformMeta;
          state.repositories = normalizePlatformRepositories(payload.platformRepositories || {});
          state.currentStrategies = normalizeCurrentStrategies(payload.currentStrategies || {});
          state.configSource = "private";
          for (const platform of Object.keys(platformMeta)) {
            ensureAccountSelection(platform);
            syncStrategyForAccount(platform);
          }
        } else {
          state.configSource = "default";
          state.currentStrategies = {};
        }
      } catch (error) {
        state.configSource = "default";
        state.currentStrategies = {};
        if (isRequestTimeoutError(error)) {
          state.bootMessageKey = "bootTimeout";
        } else {
          state.bootMessageKey = "bootPublic";
        }
      } finally {
        state.appReady = true;
        render();
      }
    }

    function normalizeAccountOptions(raw) {
      const normalized = clone(defaultAccountOptions);
      for (const platform of Object.keys(platformMeta)) {
        if (!Array.isArray(raw[platform]) || !raw[platform].length) continue;
        normalized[platform] = raw[platform].map((item, index) => ({
          key: String(item.key || item.target_name || index),
          label: String(item.label || item.target_name || item.key || platform),
          target_name: String(item.target_name || item.key || ""),
          account_selector: item.account_selector ? String(item.account_selector) : "",
          deployment_selector: item.deployment_selector ? String(item.deployment_selector) : "",
          account_scope: item.account_scope ? String(item.account_scope) : "",
          service_name: item.service_name ? String(item.service_name) : "",
          cash_currency: item.cash_currency || item.market_currency || item.trading_currency
            ? String(item.cash_currency || item.market_currency || item.trading_currency).trim().toUpperCase()
            : "",
          supported_domains: normalizeSupportedDomains(platform, item),
          github_environment: item.github_environment ? String(item.github_environment) : "",
          variable_scope: item.variable_scope ? String(item.variable_scope) : "",
          plugin_mode: item.plugin_mode ? String(item.plugin_mode) : "",
          option_overlay_mode: item.option_overlay_mode ? normalizeOptionOverlayMode(item.option_overlay_mode) : "",
          cash_only_execution_mode: item.cash_only_execution_mode
            ? normalizeCashOnlyExecutionMode(item.cash_only_execution_mode)
            : "",
          dca_mode: item.dca_mode ? normalizeDcaMode(item.dca_mode) : "",
          dca_base_investment_usd: cleanDisplayPositiveNumber(item.dca_base_investment_usd),
        }));
      }
      return normalized;
    }

    function normalizeSupportedDomains(platform, item) {
      const raw = Array.isArray(item?.supported_domains)
        ? item.supported_domains
        : String(item?.supported_domains || "").split(/[\s,;]+/);
      const cleaned = raw.map(cleanStrategyDomain).filter(Boolean);
      if (cleaned.length) return [...new Set(cleaned)];
      return inferSupportedDomains(platform, item || {});
    }

    function normalizeCurrentStrategies(raw) {
      const normalized = {};
      for (const platform of Object.keys(platformMeta)) {
        if (!raw[platform] || typeof raw[platform] !== "object" || Array.isArray(raw[platform])) continue;
        normalized[platform] = {};
        for (const [key, entry] of Object.entries(raw[platform])) {
          const profile = cleanStrategyProfile(entry?.strategy_profile);
          const minReservedCashUsd = cleanDisplayNumber(entry?.min_reserved_cash_usd ?? entry?.reserved_cash_floor_usd);
          const reservedCashRatio = cleanDisplayRatio(entry?.reserved_cash_ratio);
          const incomeLayerEnabled = cleanOptionalBoolean(entry?.income_layer_enabled);
          const incomeLayerStartUsd = cleanDisplayNumber(entry?.income_layer_start_usd);
          const incomeLayerMaxRatio = cleanDisplayRatio(entry?.income_layer_max_ratio);
          const optionOverlayEnabled = cleanOptionalBoolean(entry?.option_overlay_enabled);
          const cashOnlyExecution = cleanOptionalBoolean(entry?.cash_only_execution);
          const runtimeTargetEnabled = cleanOptionalBoolean(entry?.runtime_target_enabled);
          const dcaMode = entry?.dca_mode ? normalizeDcaMode(entry.dca_mode) : "";
          const dcaBaseInvestmentUsd = cleanDisplayPositiveNumber(entry?.dca_base_investment_usd);
          const executionMode = normalizeExecutionMode(entry?.execution_mode, entry?.dry_run_only);
          if (
            !profile &&
            !minReservedCashUsd &&
            !reservedCashRatio &&
            incomeLayerEnabled === null &&
            !incomeLayerStartUsd &&
            !incomeLayerMaxRatio &&
            optionOverlayEnabled === null &&
            cashOnlyExecution === null &&
            runtimeTargetEnabled === null &&
            !dcaMode &&
            !dcaBaseInvestmentUsd &&
            !executionMode
          ) continue;
          normalized[platform][String(key)] = {
            strategy_profile: profile,
            execution_mode: executionMode,
            dry_run_only: entry?.dry_run_only === true || entry?.dry_run_only === "true" || entry?.dry_run_only === "1",
            min_reserved_cash_usd: minReservedCashUsd,
            reserved_cash_ratio: reservedCashRatio,
            income_layer_enabled: incomeLayerEnabled,
            income_layer_start_usd: incomeLayerStartUsd,
            income_layer_max_ratio: incomeLayerMaxRatio,
            option_overlay_enabled: optionOverlayEnabled,
            cash_only_execution: cashOnlyExecution,
            runtime_target_enabled: runtimeTargetEnabled,
            dca_mode: dcaMode,
            dca_base_investment_usd: dcaBaseInvestmentUsd,
            source: entry?.source ? String(entry.source) : "",
          };
        }
        if (!Object.keys(normalized[platform]).length) delete normalized[platform];
      }
      return normalized;
    }

    function normalizePlatformRepositories(raw) {
      const normalized = clone(defaultRepositories);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;
      for (const platform of Object.keys(platformMeta)) {
        const repository = String(raw[platform] || "").trim();
        if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
          normalized[platform] = repository;
        }
      }
      return normalized;
    }

    async function dispatchSwitch() {
      if (!state.auth.allowed) return;
      showToast(t("dispatching"), { duration: 0 });
      try {
        const response = await fetch("/api/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildInputs()),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || t("dispatchFailed"));
        showToast(t("dispatched"), { duration: 4000 });
        if (payload.actions_url) window.open(payload.actions_url, "_blank", "noopener,noreferrer");
        await refreshConfig();
      } catch (error) {
        showToast(`${t("dispatchFailed")}: ${error.message}`, { duration: 12000 });
      }
    }

    async function handleLogout() {
      await fetch("/api/logout", { method: "POST" });
      window.location.reload();
    }

    function summaryText() {
      const inputs = buildInputs();
      return summaryRows(inputs).map(([label, value]) => `${label}: ${value}`).join("\
");
    }

    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
      state.view = button.dataset.view === "switch" ? "switch" : "health";
      renderConsoleView();
      if (state.view === "health") refreshHealth();
    }));

    document.querySelectorAll("[data-health-filter]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-health-filter]").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      state.health.filter = button.dataset.healthFilter;
      renderHealth();
    }));

    el("platform-strip").addEventListener("click", (event) => {
      const button = event.target.closest("[data-platform]");
      if (!button) return;
      state.selected = button.dataset.platform;
      state.forms[state.selected].strategyTouched = false;
      render();
    });

    el("account-select").addEventListener("change", () => {
      state.forms[state.selected].accountKey = el("account-select").value;
      state.forms[state.selected].runtimeTargetTouched = false;
      state.forms[state.selected].reservedCashTouched = false;
      state.forms[state.selected].incomeLayerTouched = false;
      state.forms[state.selected].optionOverlayTouched = false;
      state.forms[state.selected].cashOnlyExecutionTouched = false;
      state.forms[state.selected].dcaTouched = false;
      state.forms[state.selected].strategyTouched = false;
      syncStrategyForAccount(state.selected);
      render();
    });

    el("strategy-select").addEventListener("change", () => {
      state.forms[state.selected].strategy = el("strategy-select").value;
      state.forms[state.selected].strategyTouched = true;
      state.forms[state.selected].incomeLayerTouched = false;
      state.forms[state.selected].optionOverlayTouched = false;
      state.forms[state.selected].dcaTouched = false;
      syncIncomeLayerForAccount(state.selected);
      syncOptionOverlayForAccount(state.selected);
      syncDcaForAccount(state.selected);
      render();
    });

    el("mode-control").addEventListener("click", (event) => {
      const button = event.target.closest("[data-mode]");
      if (!button || button.disabled) return;
      if (platformDryRunOnly(state.selected) && button.dataset.mode === "live") return;
      state.forms[state.selected].executionMode = button.dataset.mode;
      render();
    });

    el("plugin-mode-select").addEventListener("change", () => {
      const form = state.forms[state.selected];
      form.pluginMode = normalizePluginMode(el("plugin-mode-select").value);
      render();
    });

    el("runtime-target-enabled-select").addEventListener("change", () => {
      const form = state.forms[state.selected];
      form.runtimeTargetMode = normalizeRuntimeTargetMode(el("runtime-target-enabled-select").value);
      form.runtimeTargetTouched = form.runtimeTargetMode !== "current";
      render();
    });

    el("income-layer-mode-select").addEventListener("change", () => {
      const form = state.forms[state.selected];
      form.incomeLayerMode = normalizeIncomeLayerMode(el("income-layer-mode-select").value);
      form.incomeLayerTouched = form.incomeLayerMode !== "current";
      if (form.incomeLayerMode === "current") {
        form.incomeLayerTouched = false;
        syncIncomeLayerForAccount(state.selected);
      }
      render();
    });

    el("income-layer-start-usd-input").addEventListener("input", () => {
      const form = state.forms[state.selected];
      form.incomeLayerTouched = true;
      form.incomeLayerMode = "enabled";
      form.incomeLayerStartUsd = el("income-layer-start-usd-input").value.trim();
      render();
    });

    el("income-layer-max-ratio-input").addEventListener("input", () => {
      const form = state.forms[state.selected];
      form.incomeLayerTouched = true;
      form.incomeLayerMode = "enabled";
      form.incomeLayerMaxRatio = el("income-layer-max-ratio-input").value.trim();
      render();
    });

    el("option-overlay-mode-select").addEventListener("change", () => {
      const form = state.forms[state.selected];
      form.optionOverlayMode = normalizeOptionOverlayMode(el("option-overlay-mode-select").value);
      form.optionOverlayTouched = form.optionOverlayMode !== "current";
      render();
    });

    el("cash-only-execution-mode-select").addEventListener("change", () => {
      const form = state.forms[state.selected];
      form.cashOnlyExecutionMode = normalizeCashOnlyExecutionMode(el("cash-only-execution-mode-select").value);
      form.cashOnlyExecutionTouched = form.cashOnlyExecutionMode !== "current";
      if (allowMarginExplicitlySelected(form)) reconcileExecutionCashPolicy(form, "margin");
      else restoreReserveAfterMarginDisabled(form);
      render();
    });

    el("dca-mode-select").addEventListener("change", () => {
      const form = state.forms[state.selected];
      form.dcaTouched = true;
      form.dcaMode = normalizeDcaMode(el("dca-mode-select").value);
      render();
    });

    el("dca-base-investment-usd-input").addEventListener("input", () => {
      const form = state.forms[state.selected];
      form.dcaTouched = true;
      form.dcaBaseInvestmentUsd = el("dca-base-investment-usd-input").value.trim();
      render();
    });

    el("reserve-policy-mode-select").addEventListener("change", () => {
      const form = state.forms[state.selected];
      form.reservePolicyMode = normalizeReservePolicyMode(el("reserve-policy-mode-select").value);
      form.reservedCashTouched = form.reservePolicyMode !== "current";
      if (form.reservePolicyMode === "current") syncReservePolicyForAccount(state.selected);
      reconcileExecutionCashPolicy(form, "reserve");
      render();
    });

    el("min-reserved-cash-input").addEventListener("input", () => {
      state.forms[state.selected].reservedCashTouched = true;
      state.forms[state.selected].minReservedCashUsd = el("min-reserved-cash-input").value.trim();
      render();
    });

    el("reserved-cash-ratio-input").addEventListener("input", () => {
      state.forms[state.selected].reservedCashTouched = true;
      state.forms[state.selected].reservedCashRatio = el("reserved-cash-ratio-input").value.trim();
      render();
    });

    el("copy-button").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(summaryText());
        showToast(t("copied"), { duration: 3000 });
      } catch {
        showToast(summaryText(), { duration: 0 });
      }
    });

    el("dispatch-button").addEventListener("click", dispatchSwitch);
    el("logout-button").addEventListener("click", handleLogout);
    el("lang-button").addEventListener("click", () => {
      state.lang = state.lang === "zh" ? "en" : "zh";
      localStorage.setItem("qsl-switch-lang", state.lang);
      render();
    });

    applyStrategyProfiles(defaultStrategyProfiles);
    for (const platform of Object.keys(platformMeta)) syncStrategyForAccount(platform);
    render();
    boot();

    async function boot() {
      try {
        await refreshStrategyProfiles();
        await refreshSession();
      } catch {
        state.auth = { available: false, allowed: false, admin: false, login: null };
        state.configSource = "default";
        state.currentStrategies = {};
        state.bootMessageKey = "bootTimeout";
        state.appReady = true;
        render();
      }
    }
