

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
    const pluginModes = ["none"];
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
        "runtime_enabled": false,
        "income_layer_enabled": true,
        "option_overlay_enabled": true,
        "combo_enabled": false,
        "lifecycle_stage": "research_active",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "missing_current_promotion_evidence_and_preauthorized_autonomy_policy",
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
        "runtime_enabled": false,
        "income_layer_enabled": true,
        "option_overlay_enabled": true,
        "combo_enabled": false,
        "lifecycle_stage": "research_active",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "missing_current_promotion_evidence_and_preauthorized_autonomy_policy",
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
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_active",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "missing_current_promotion_evidence_and_preauthorized_autonomy_policy",
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
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_active",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "missing_current_promotion_evidence_and_preauthorized_autonomy_policy",
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
        "runtime_enabled": false,
        "income_layer_enabled": true,
        "option_overlay_enabled": true,
        "combo_enabled": false,
        "lifecycle_stage": "research_active",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package",
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
        "runtime_enabled": false,
        "income_layer_enabled": true,
        "option_overlay_enabled": true,
        "combo_enabled": false,
        "lifecycle_stage": "research_active",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "missing_current_promotion_evidence_and_preauthorized_autonomy_policy",
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
        "lifecycle_stage": "research_active",
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
        "lifecycle_stage": "shadow_active",
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
        "lifecycle_stage": "shadow_active",
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
        "lifecycle_stage": "shadow_active",
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
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_active",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "dry_run"
        ],
        "blocked_live_reason": "research_backtest_only_requires_evidence_package"
      },
      {
        "profile": "hk_low_vol_dividend_quality_snapshot",
        "label": "港股红利质量",
        "label_en": "HK Dividend Quality",
        "label_zh": "港股红利质量",
        "domain": "hk_equity",
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_active",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "missing_current_promotion_evidence_and_preauthorized_autonomy_policy"
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
        "lifecycle_stage": "research_active",
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
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_active",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "missing_current_promotion_evidence_and_preauthorized_autonomy_policy"
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
        "lifecycle_stage": "research_active",
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
        "lifecycle_stage": "research_active",
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
        "lifecycle_stage": "research_active",
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
        "lifecycle_stage": "research_active",
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
        "lifecycle_stage": "research_active",
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
        "lifecycle_stage": "research_active",
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
        "lifecycle_stage": "research_active",
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
        "runtime_enabled": false,
        "income_layer_enabled": false,
        "option_overlay_enabled": false,
        "combo_enabled": false,
        "lifecycle_stage": "research_active",
        "can_switch_live": false,
        "allowed_execution_modes": [
          "paper",
          "dry_run"
        ],
        "blocked_live_reason": "missing_current_promotion_evidence_and_preauthorized_autonomy_policy"
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
        "lifecycle_stage": "shadow_active",
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
        "lifecycle_stage": "research_active",
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
        "lifecycle_stage": "research_active",
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
        appTitle: "QuantStrategyLab",
        appSubtitle: "自动化策略的日常管理",
        languageToggle: "切换语言",
        consoleNavigation: "管理台导航",
        dataFreshness: "数据更新时间",
        decisionSummary: "待办摘要",
        healthSummary: "策略健康摘要",
        healthFilters: "筛选策略健康状态",
        controlPlaneView: "待你处理",
        healthView: "系统状态",
        switchView: "策略设置",
        controlPlaneEyebrow: "待处理事项",
        controlPlaneTitle: "待你处理",
        controlPlaneSubtitle: "这里只显示需要你亲自确认的事项。",
        controlCandidateTotal: "监控对象",
        controlDeferred: "待复核",
        controlParked: "暂停中",
        controlOwnerDecision: "待处理",
        controlQueueEyebrow: "优先处理",
        controlQueueHint: "有风险或需要确认时才出现",
        controlCandidateBoard: "需要你处理",
        controlDataReady: "已更新",
        controlDataStale: "更新延迟",
        controlDataUnavailable: "暂时无法读取",
        controlAttentionResearchOnly: "暂无待处理事项",
        controlAttentionRequired: "需要关注",
        controlAttentionUnavailable: "等待数据",
        controlComputedAt: "更新于：{time}",
        controlLoginNotice: "登录后查看待处理事项和运行状态。",
        controlStaleNotice: "数据更新延迟，暂不建议据此做新决定。",
        controlUnavailableNotice: "暂时无法读取最新状态，请稍后刷新。",
        controlUpstreamNotice: "部分数据暂不可用，请稍后重试。",
        controlAttentionNotice: "有 {deferred} 项待复核，{parked} 项已暂停。",
        controlNormalNotice: "目前没有需要你决定的事项。",
        controlNormalSummary: "系统会继续监测、优化和记录。",
        controlStaleSummary: "系统会继续监测；更新后再显示新的事项。",
        controlLoginSummary: "登录后查看你的待办和系统概览。",
        controlAttentionSummary: "请查看下方事项并选择下一步。",
        controlEmptyCandidates: "当前没有待处理事项。",
        controlNoRecommendation: "暂未给出处理建议。",
        controlItemMeta: "{kind} · {domain} · 最近更新：{freshness}",
        controlNext: "处理建议",
        controlStatus: "当前状态",
        ownerDecisionTitle: "请选择下一步",
        ownerDecisionAdminOnly: "请由管理员确认。",
        ownerDecisionReady: "相关信息已就绪，请选择下一步。",
        ownerDecisionRecorded: "已保存：{decision}",
        ownerDecisionApprove: "确认试运行",
        ownerDecisionPark: "保持暂停",
        ownerDecisionRetire: "停止跟踪",
        ownerDecisionConfirm: "确认保存此项决定？",
        ownerDecisionSubmitting: "正在保存…",
        ownerDecisionSuccess: "决定已保存。",
        ownerDecisionFailed: "无法保存决定",
        reconciliationRecoveryBoard: "恢复事项",
        reconciliationRecoveryLoginNotice: "登录后查看需要恢复或复核的事项。",
        reconciliationRecoveryStaleNotice: "恢复信息更新延迟，请等待下一次检查。",
        reconciliationRecoveryUnavailableNotice: "暂时没有可用的恢复信息。",
        reconciliationRecoveryUpstreamNotice: "部分恢复信息暂不可用，请先查看阻断原因。",
        reconciliationRecoveryEmpty: "当前没有需要恢复的事项。",
        reconciliationRecoveryMeta: "{platform} · {strategy}",
        reconciliationRecoveryDetail: "状态：{state} · 样本：{samples} · 复核：{review} · 最近更新：{lastObserved}",
        reconciliationRecoveryBlocked: "仍需处理：{blockers}",
        reconciliationRecoveryReady: "相关核对已完成，等待确认。",
        reconciliationRecoveryAdminOnly: "请由管理员确认。",
        reconciliationRecoveryConfirmed: "恢复确认已保存。",
        reconciliationRecoveryConfirm: "确认恢复",
        reconciliationRecoveryConfirmPrompt: "确认保存恢复决定？",
        reconciliationRecoverySubmitting: "正在保存…",
        reconciliationRecoverySuccess: "恢复决定已保存。",
        reconciliationRecoveryFailed: "无法保存恢复决定",
        reconciliationRecoveryNoOrder: "查看当前恢复状态。",
        executionEvidenceBoard: "执行与成交记录",
        executionEvidenceLoginNotice: "登录后查看执行和成交记录。",
        executionEvidenceStaleNotice: "执行记录更新延迟，请结合最新平台状态判断。",
        executionEvidenceUnavailableNotice: "暂时没有可用的执行记录。",
        executionEvidenceUpstreamNotice: "部分执行记录暂不可用，请稍后重试。",
        executionEvidenceEmpty: "当前没有可展示的执行记录。",
        executionEvidenceMeta: "{platform} · 当前通道：{environment} · 来源：{source}",
        executionEvidenceDetail: "策略：{strategy} · 数据：{data} · 执行：{execution} · 观察：{shadow} · 模拟：{paper}",
        executionEvidenceReceipt: "执行回执：{outcome} · 券商确认：{confirmation}",
        executionEvidenceReceiptMissing: "执行回执：未采集",
        executionEvidenceReceiptNotDue: "未到应交易窗口",
        executionEvidenceReceiptNoAction: "策略未产生订单",
        executionEvidenceReceiptRiskBlocked: "已被风控拦截",
        executionEvidenceReceiptSubmitted: "已提交，尚未确认",
        executionEvidenceReceiptAcknowledged: "券商已确认",
        executionEvidenceReceiptPartiallyFilled: "部分成交",
        executionEvidenceReceiptFilled: "已成交",
        executionEvidenceReceiptReconciliation: "需要对账",
        executionEvidenceReceiptFailed: "执行失败，需复核",
        executionEvidenceConfirmationNotApplicable: "不适用",
        executionEvidenceConfirmationNotObserved: "未观察到确认",
        executionEvidenceConfirmationAcknowledged: "已确认",
        executionEvidenceConfirmationPartiallyFilled: "部分成交",
        executionEvidenceConfirmationFilled: "已成交",
        executionEvidenceConfirmationReconciliation: "需对账",
        executionEvidenceNoOrder: "查看当前执行和成交结果。",
        executionEvidenceNext: "处理建议",
        runtimeTargetLifecycleBoard: "平台运行状态",
        runtimeTargetLifecycleLoginNotice: "登录后查看平台运行状态。",
        runtimeTargetLifecycleStaleNotice: "平台状态更新延迟，请先检查运行情况。",
        runtimeTargetLifecycleUnavailableNotice: "暂时没有可用的平台状态。",
        runtimeTargetLifecycleUpstreamNotice: "部分平台状态暂不可用，请先核对。",
        runtimeTargetLifecycleEmpty: "当前没有可展示的平台状态。",
        runtimeTargetLifecycleMeta: "{platform} · {state} · 通道：{mode}",
        runtimeTargetLifecycleDetail: "运行监测：{guard} · 执行心跳：{heartbeat}",
        runtimeTargetLifecycleObservation: "本次执行：{observation} · 成交证据：{evidence}",
        runtimeTargetLifecycleNoOrder: "查看当前平台运行情况。",
        runtimeTargetLifecycleNext: "当前建议",
        runtimeTargetLifecycleStateEnabled: "已启用",
        runtimeTargetLifecycleStateDisabled: "已停用",
        runtimeTargetLifecycleCheckPass: "通过",
        runtimeTargetLifecycleCheckAttention: "需处理",
        runtimeTargetLifecycleCheckNotDue: "未到检查时间",
        runtimeTargetLifecycleCheckNotApplicable: "不适用",
        runtimeTargetLifecycleCheckUnavailable: "不可用",
        runtimeTargetLifecycleObservationNotDue: "未到应交易窗口",
        runtimeTargetLifecycleObservationMonitoringOnly: "仅监测通过",
        runtimeTargetLifecycleObservationNotApplicable: "目标停用，不适用",
        runtimeTargetLifecycleObservationAttention: "需要复核",
        runtimeTargetLifecycleObservationUnavailable: "不可用",
        runtimeTargetLifecycleOrderEvidenceNotCollected: "未采集订单/成交回执",
        runtimeTargetLifecycleDispositionEnabled: "持续监控",
        runtimeTargetLifecycleDispositionDisabled: "无执行验证",
        runtimeTargetLifecycleDispositionParked: "已暂停",
        runtimeTargetLifecycleReasonNone: "监测正常",
        runtimeTargetLifecycleReasonDisabled: "按配置停用，仍持续验证",
        runtimeTargetLifecycleReasonRuntimeGuard: "运行监测需要复核",
        runtimeTargetLifecycleReasonHeartbeat: "执行心跳需要复核",
        runtimeTargetLifecycleReasonUnavailable: "监测数据不可用",
        m0ResearchBoard: "外部研究记录",
        m0ResearchLoginNotice: "登录后查看外部研究记录。",
        m0ResearchStaleNotice: "外部研究更新延迟，仅供历史参考。",
        m0ResearchUnavailableNotice: "暂时没有可用的外部研究记录。",
        m0ResearchUpstreamNotice: "部分外部研究暂不可用，请稍后重试。",
        m0ResearchEmpty: "当前没有可展示的外部研究记录。",
        m0ResearchMore: "显示前 {count} 条研究观察。",
        m0ResearchMeta: "{kind} · 查看于：{viewed}",
        m0ResearchStateFreshness: "状态：{state} · 新鲜度：{freshness}",
        m0ResearchHorizons: "主要观察期：{primary} · 适用观察期：{suitable}",
        m0ResearchEvidence: "置信：{confidence} · 风格：{style} · 资料摘要：{digest}",
        m0ResearchConsistency: "当前周期分歧：{conflict} · 历史失效漂移：{drift}",
        m0ResearchNoOrder: "外部研究不影响当前策略运行。",
        adaptiveSelectionBoard: "系统建议",
        adaptiveSelectionLoginNotice: "登录后查看系统建议。",
        adaptiveSelectionStaleNotice: "建议更新延迟，仅供历史参考。",
        adaptiveSelectionUnavailableNotice: "暂时没有可用的系统建议。",
        adaptiveSelectionUpstreamNotice: "部分建议暂不可用，请稍后重试。",
        adaptiveSelectionEmpty: "当前没有可展示的系统建议。",
        adaptiveSelectionMeta: "{source} · {domain} · 市场截至 {asOf}",
        adaptiveSelectionRecommended: "建议观察",
        adaptiveSelectionNoCandidate: "暂无合适建议",
        adaptiveSelectionReason: "原因：{reasons}",
        adaptiveSelectionNoOrder: "查看系统的当前建议。",
        adaptiveSelectionScoreLabel: "研究次数",
        researchTaskBoard: "自动化任务",
        researchTaskLoginNotice: "登录后查看自动化任务。",
        researchTaskStaleNotice: "任务信息更新延迟，仅供历史参考。",
        researchTaskUnavailableNotice: "暂时没有可用的自动化任务。",
        researchTaskUpstreamNotice: "部分任务信息暂不可用，请稍后重试。",
        researchTaskEmpty: "当前没有可展示的自动化任务。",
        researchTaskMeta: "{type} · {domain} · 创建于：{created}",
        researchTaskLimits: "研究预算：最多 {runs} 次 / {seconds} 秒",
        researchTaskNoOrder: "查看当前自动化任务。",
        healthEyebrow: "系统状态",
        healthTitle: "系统状态",
        healthSubtitle: "按类别查看健康度和运行情况。",
        healthTotal: "策略总数",
        healthHealthy: "健康",
        healthWatch: "观察",
        healthReview: "需要复核",
        healthCritical: "严重",
        healthBoard: "策略健康",
        healthFilterAttention: "需要关注",
        healthFilterAll: "全部策略",
        healthDataReady: "已更新",
        healthDataStale: "更新延迟",
        healthDataUnavailable: "暂时无法读取",
        healthComputedAt: "更新于：{time}",
        healthLoginNotice: "登录后查看策略健康度和运行情况。",
        healthStaleNotice: "状态更新延迟；系统会继续检查。",
        healthUnavailableNotice: "暂时无法读取策略状态，请稍后刷新。",
        healthUpstreamNotice: "部分策略状态暂不可用，请稍后重试。",
        healthNormalNotice: "当前没有需要关注的运行问题。",
        healthAttentionNotice: "有 {critical} 项严重、{review} 项需要复核、{watch} 项观察；系统正在持续监测。",
        healthEmpty: "当前分类下没有策略。",
        healthStatusHealthy: "健康",
        healthStatusWatch: "观察",
        healthStatusReview: "需要复核",
        healthStatusCritical: "严重",
        healthStatusUnknown: "未知",
        healthCardMeta: "{status} · {domain}",
        healthDecisionFallbackLabel: "系统正在继续观察。",
        healthDecisionFallbackReason: "没有需要你处理的异常。",
        healthRecommendationHealthy: "系统正在正常运行。",
        healthRecommendationWatch: "系统正在继续观察。",
        healthRecommendationReview: "请查看诊断详情，等待系统复核完成。",
        healthRecommendationCritical: "请查看诊断详情，并暂缓相关变更。",
        healthDetail: "数据截至：{date}",
        healthScoreLabel: "健康度",
        diagnosticDetails: "查看诊断详情",
        diagnosticDetailsHint: "仅在排查问题或查看研究记录时使用。",
        researchTaskNoOrderBadge: "未产生订单",
        recoveryConfirmedStatus: "已确认",
        recoveryReadyStatus: "可确认",
        recoveryBlockedStatus: "仍受阻",
        commonUnknown: "未知",
        commonNotMarked: "未标记",
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
        planEyebrow: "策略设置",
        planTitle: "修改策略设置",
        planSubtitle: "选择平台、账户、策略和运行环境；保存前核对本次改动。",
        planAdvancedSummary: "高级设置",
        planAdvancedHint: "运行状态、插件、现金、收入层和定投通常沿用当前配置；需要改动时再展开。",
        planScopeTitle: "选择范围",
        planScopeSubtitle: "平台、账号、策略与目标环境",
        planRuntimeTitle: "运行保护",
        planRuntimeSubtitle: "停用、插件和附加层都受同一计划约束",
        planOverlayTitle: "策略附加层",
        planOverlaySubtitle: "仅使用策略已定义的默认边界",
        planCashSubtitle: "现金预留优先于融资；两者不能同时覆盖",
        activePlatform: "目标平台",
        account: "目标账号",
        strategy: "策略",
        mode: "运行环境",
        live: "实盘",
        paper: "旧版非实盘",
        dryRun: "模拟运行",
        liveModeUnavailable: "该策略暂不支持实盘，请选择非实盘。",
        runtimeTargetMode: "账号运行状态",
        runtimeSectionTitle: "运行与插件",
        runtimeTargetCurrent: "沿用当前状态",
        runtimeTargetEnabled: "启用",
        runtimeTargetDisabled: "禁用",
        runtimeTargetModeMeta: "停用后正式运行会跳过，模拟运行和健康检查仍可用。",
        pluginMode: "插件状态",
        pluginModeNone: "不挂载旧插件",
        pluginModeMeta: "当前候选未绑定插件；旧插件不会自动挂载。",
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
        executionCashPolicyTitle: "资本边界",
        executionCashPolicyNote: "允许融资与预留现金覆盖不能同时生效；选「是」会清空预留覆盖，设预留覆盖会强制「否」。",
        executionCashMarginBlocksReserve: "已选允许融资；提交时会清空预留现金覆盖。",
        executionCashReserveBlocksMargin: "已设预留现金覆盖；提交时会强制不允许融资。",
        qmtPlatformCashNote: "A 股 QMT 不使用 margin / 平台预留现金；现金约束在策略参数 execution_cash_reserve_ratio 内配置。",
        qmtDryRunOnlyNote: "当前平台仅支持模拟运行。",
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
        summary: "风险与变更摘要",
        summaryCurrent: "当前边界",
        summaryPending: "待提交变更",
        planReadinessTitle: "提交前核对",
        planCheckAccount: "账号与作用范围",
        planCheckStrategy: "策略与目标环境",
        planCheckRisk: "现金与风险设置",
        planCheckAuthority: "实盘状态",
        planCheckWaiting: "等待配置",
        planCheckSelected: "已读取",
        planCheckValid: "已校验",
        planCheckFix: "需修正",
        planCheckNonLive: "非实盘",
        planCheckNoAuthority: "未就绪",
        planAuditNote: "本次修改会保存到变更记录。",
        copySummary: "复制状态",
        loginToRun: "登录后提交计划",
        loadingConfig: "读取配置中",
        configureAccounts: "配置账号后切换",
        runSwitch: "保存设置",
        noChanges: "无变更",
        readonlyNote: "登录后可保存设置。",
        publicReadonly: "登录后查看账号配置。",
        loadingConfigNote: "正在读取账号配置和当前状态。",
        missingConfigNote: "账号配置未加载，暂时不能执行。",
        readyNote: "请核对上方改动后保存。",
        invalidStrategyNote: "当前账号没有可执行策略，暂时不能切换。",
        invalidReservePolicyNote: "请为当前预留现金策略填写有效金额或比例。",
        invalidIncomeLayerNote: "请填写有效的收入层起始金额和最高比例。",
        invalidOptionOverlayNote: "当前策略未定义可启用的期权层。",
        invalidDcaNote: "请填写有效的定投模式和基准金额。",
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
        appTitle: "QuantStrategyLab",
        appSubtitle: "Daily management for automated strategies",
        languageToggle: "Change language",
        consoleNavigation: "Console navigation",
        dataFreshness: "Data freshness",
        decisionSummary: "Decision summary",
        healthSummary: "Strategy health summary",
        healthFilters: "Filter strategy health",
        controlPlaneView: "Your attention",
        healthView: "System status",
        switchView: "Strategy settings",
        controlPlaneEyebrow: "To do",
        controlPlaneTitle: "Your attention",
        controlPlaneSubtitle: "Only items that need your confirmation appear here.",
        controlCandidateTotal: "Monitored items",
        controlDeferred: "To review",
        controlParked: "Paused",
        controlOwnerDecision: "To do",
        controlQueueEyebrow: "Priority",
        controlQueueHint: "Only appears when action is needed",
        controlCandidateBoard: "Needs your attention",
        controlDataReady: "Up to date",
        controlDataStale: "Update delayed",
        controlDataUnavailable: "Unavailable",
        controlAttentionResearchOnly: "Nothing to do",
        controlAttentionRequired: "Needs attention",
        controlAttentionUnavailable: "Waiting for data",
        controlComputedAt: "Updated: {time}",
        controlLoginNotice: "Sign in to see your to-do items and runtime status.",
        controlStaleNotice: "Data is delayed. Avoid making a new decision from it for now.",
        controlUnavailableNotice: "The latest status is temporarily unavailable. Please refresh later.",
        controlUpstreamNotice: "Some data is temporarily unavailable. Please retry later.",
        controlAttentionNotice: "{deferred} item(s) need review and {parked} are paused.",
        controlNormalNotice: "There is nothing you need to decide right now.",
        controlNormalSummary: "The system will keep monitoring, improving, and recording.",
        controlStaleSummary: "Monitoring continues; new items will appear after the next update.",
        controlLoginSummary: "Sign in to see your tasks and system overview.",
        controlAttentionSummary: "Review the items below and choose the next step.",
        controlEmptyCandidates: "There is nothing to handle right now.",
        controlNoRecommendation: "No action is recommended yet.",
        controlItemMeta: "{kind} · {domain} · updated {freshness}",
        controlNext: "Recommended action",
        controlStatus: "Current status",
        ownerDecisionTitle: "Choose the next step",
        ownerDecisionAdminOnly: "An administrator needs to confirm this.",
        ownerDecisionReady: "The relevant information is ready. Choose the next step.",
        ownerDecisionRecorded: "Saved: {decision}",
        ownerDecisionApprove: "Confirm trial run",
        ownerDecisionPark: "Keep parked",
        ownerDecisionRetire: "Stop tracking",
        ownerDecisionConfirm: "Save this decision?",
        ownerDecisionSubmitting: "Saving…",
        ownerDecisionSuccess: "Decision saved.",
        ownerDecisionFailed: "Could not save the decision",
        reconciliationRecoveryBoard: "Recovery items",
        reconciliationRecoveryLoginNotice: "Sign in to see recovery and review items.",
        reconciliationRecoveryStaleNotice: "Recovery information is delayed. Wait for the next check.",
        reconciliationRecoveryUnavailableNotice: "Recovery information is temporarily unavailable.",
        reconciliationRecoveryUpstreamNotice: "Some recovery information is unavailable. Review the blockers first.",
        reconciliationRecoveryEmpty: "There are no recovery items right now.",
        reconciliationRecoveryMeta: "{platform} · {strategy}",
        reconciliationRecoveryDetail: "status: {state} · samples: {samples} · review: {review} · updated: {lastObserved}",
        reconciliationRecoveryBlocked: "Still needed: {blockers}",
        reconciliationRecoveryReady: "The relevant checks are complete and await confirmation.",
        reconciliationRecoveryAdminOnly: "An administrator needs to confirm this.",
        reconciliationRecoveryConfirmed: "Recovery confirmation saved.",
        reconciliationRecoveryConfirm: "Confirm recovery",
        reconciliationRecoveryConfirmPrompt: "Save this recovery decision?",
        reconciliationRecoverySubmitting: "Saving…",
        reconciliationRecoverySuccess: "Recovery decision saved.",
        reconciliationRecoveryFailed: "Could not save the recovery decision",
        reconciliationRecoveryNoOrder: "View the current recovery status.",
        executionEvidenceBoard: "Execution and fills",
        executionEvidenceLoginNotice: "Sign in to see execution and fill records.",
        executionEvidenceStaleNotice: "Execution records are delayed. Check the latest platform status as well.",
        executionEvidenceUnavailableNotice: "Execution records are temporarily unavailable.",
        executionEvidenceUpstreamNotice: "Some execution records are unavailable. Please retry later.",
        executionEvidenceEmpty: "There are no execution records to display.",
        executionEvidenceMeta: "{platform} · current lane: {environment} · source: {source}",
        executionEvidenceDetail: "strategy: {strategy} · data: {data} · execution: {execution} · observe: {shadow} · simulated: {paper}",
        executionEvidenceReceipt: "execution receipt: {outcome} · broker confirmation: {confirmation}",
        executionEvidenceReceiptMissing: "execution receipt: not collected",
        executionEvidenceReceiptNotDue: "not in a due window",
        executionEvidenceReceiptNoAction: "strategy produced no order",
        executionEvidenceReceiptRiskBlocked: "blocked by risk controls",
        executionEvidenceReceiptSubmitted: "submitted; not yet confirmed",
        executionEvidenceReceiptAcknowledged: "broker acknowledged",
        executionEvidenceReceiptPartiallyFilled: "partially filled",
        executionEvidenceReceiptFilled: "filled",
        executionEvidenceReceiptReconciliation: "reconciliation required",
        executionEvidenceReceiptFailed: "execution failed; review required",
        executionEvidenceConfirmationNotApplicable: "not applicable",
        executionEvidenceConfirmationNotObserved: "not observed",
        executionEvidenceConfirmationAcknowledged: "acknowledged",
        executionEvidenceConfirmationPartiallyFilled: "partially filled",
        executionEvidenceConfirmationFilled: "filled",
        executionEvidenceConfirmationReconciliation: "reconciliation required",
        executionEvidenceNoOrder: "View the current execution and fill results.",
        executionEvidenceNext: "Recommended action",
        runtimeTargetLifecycleBoard: "Platform status",
        runtimeTargetLifecycleLoginNotice: "Sign in to see platform status.",
        runtimeTargetLifecycleStaleNotice: "Platform status is delayed. Check runtime first.",
        runtimeTargetLifecycleUnavailableNotice: "Platform status is temporarily unavailable.",
        runtimeTargetLifecycleUpstreamNotice: "Some platform status is unavailable. Please review it first.",
        runtimeTargetLifecycleEmpty: "There is no platform status to display.",
        runtimeTargetLifecycleMeta: "{platform} · {state} · lane: {mode}",
        runtimeTargetLifecycleDetail: "runtime guard: {guard} · execution heartbeat: {heartbeat}",
        runtimeTargetLifecycleObservation: "execution: {observation} · order/fill evidence: {evidence}",
        runtimeTargetLifecycleNoOrder: "View the current platform runtime status.",
        runtimeTargetLifecycleNext: "Current recommendation",
        runtimeTargetLifecycleStateEnabled: "enabled",
        runtimeTargetLifecycleStateDisabled: "disabled",
        runtimeTargetLifecycleCheckPass: "pass",
        runtimeTargetLifecycleCheckAttention: "attention",
        runtimeTargetLifecycleCheckNotDue: "not due",
        runtimeTargetLifecycleCheckNotApplicable: "not applicable",
        runtimeTargetLifecycleCheckUnavailable: "unavailable",
        runtimeTargetLifecycleObservationNotDue: "not in a due window",
        runtimeTargetLifecycleObservationMonitoringOnly: "monitoring only",
        runtimeTargetLifecycleObservationNotApplicable: "target disabled; not applicable",
        runtimeTargetLifecycleObservationAttention: "needs review",
        runtimeTargetLifecycleObservationUnavailable: "unavailable",
        runtimeTargetLifecycleOrderEvidenceNotCollected: "not collected",
        runtimeTargetLifecycleDispositionEnabled: "continue monitoring",
        runtimeTargetLifecycleDispositionDisabled: "disabled validation",
        runtimeTargetLifecycleDispositionParked: "parked",
        runtimeTargetLifecycleReasonNone: "monitoring normal",
        runtimeTargetLifecycleReasonDisabled: "intentionally disabled; validation continues",
        runtimeTargetLifecycleReasonRuntimeGuard: "runtime guard needs review",
        runtimeTargetLifecycleReasonHeartbeat: "execution heartbeat needs review",
        runtimeTargetLifecycleReasonUnavailable: "monitoring data unavailable",
        m0ResearchBoard: "External research records",
        m0ResearchLoginNotice: "Sign in to see external research records.",
        m0ResearchStaleNotice: "External research is delayed and is provided for historical context only.",
        m0ResearchUnavailableNotice: "External research records are temporarily unavailable.",
        m0ResearchUpstreamNotice: "Some external research records are unavailable. Please retry later.",
        m0ResearchEmpty: "There are no external research records to display.",
        m0ResearchMore: "Showing the first {count} research observations.",
        m0ResearchMeta: "{kind} · viewed {viewed}",
        m0ResearchStateFreshness: "State: {state} · freshness: {freshness}",
        m0ResearchHorizons: "Primary horizon: {primary} · suitable horizons: {suitable}",
        m0ResearchEvidence: "Confidence: {confidence} · style: {style} · source digest: {digest}",
        m0ResearchConsistency: "Current horizon conflict: {conflict} · historical stale drift: {drift}",
        m0ResearchNoOrder: "External research does not affect current strategy operation.",
        adaptiveSelectionBoard: "System suggestions",
        adaptiveSelectionLoginNotice: "Sign in to see system suggestions.",
        adaptiveSelectionStaleNotice: "Suggestions are delayed and are provided for historical context only.",
        adaptiveSelectionUnavailableNotice: "System suggestions are temporarily unavailable.",
        adaptiveSelectionUpstreamNotice: "Some suggestions are unavailable. Please retry later.",
        adaptiveSelectionEmpty: "There are no system suggestions to display.",
        adaptiveSelectionMeta: "{source} · {domain} · market as of {asOf}",
        adaptiveSelectionRecommended: "Observe suggestion",
        adaptiveSelectionNoCandidate: "No suitable suggestion yet",
        adaptiveSelectionReason: "Reasons: {reasons}",
        adaptiveSelectionNoOrder: "View the system's current suggestions.",
        adaptiveSelectionScoreLabel: "Research runs",
        researchTaskBoard: "Automation tasks",
        researchTaskLoginNotice: "Sign in to see automation tasks.",
        researchTaskStaleNotice: "Task information is delayed and is provided for historical context only.",
        researchTaskUnavailableNotice: "Automation tasks are temporarily unavailable.",
        researchTaskUpstreamNotice: "Some task information is unavailable. Please retry later.",
        researchTaskEmpty: "There are no automation tasks to display.",
        researchTaskMeta: "{type} · {domain} · created {created}",
        researchTaskLimits: "Research budget: up to {runs} run(s) / {seconds}s",
        researchTaskNoOrder: "View the current automation tasks.",
        healthEyebrow: "System status",
        healthTitle: "System status",
        healthSubtitle: "Browse health and runtime status by category.",
        healthTotal: "Strategies",
        healthHealthy: "Healthy",
        healthWatch: "Watch",
        healthReview: "Review",
        healthCritical: "Critical",
        healthBoard: "Strategy health",
        healthFilterAttention: "Needs attention",
        healthFilterAll: "All strategies",
        healthDataReady: "Up to date",
        healthDataStale: "Update delayed",
        healthDataUnavailable: "Unavailable",
        healthComputedAt: "Updated: {time}",
        healthLoginNotice: "Sign in to see strategy health and runtime status.",
        healthStaleNotice: "Status is delayed; monitoring continues.",
        healthUnavailableNotice: "Strategy status is temporarily unavailable. Refresh later.",
        healthUpstreamNotice: "Some strategy status is unavailable. Retry later.",
        healthNormalNotice: "There are no runtime issues that need attention.",
        healthAttentionNotice: "{critical} critical, {review} to review, and {watch} under observation. Monitoring continues.",
        healthEmpty: "There are no strategies in this category.",
        healthStatusHealthy: "Healthy",
        healthStatusWatch: "Watch",
        healthStatusReview: "Review",
        healthStatusCritical: "Critical",
        healthStatusUnknown: "Unknown",
        healthCardMeta: "{status} · {domain}",
        healthDecisionFallbackLabel: "The system is continuing to monitor.",
        healthDecisionFallbackReason: "There is no exception for you to handle.",
        healthRecommendationHealthy: "The system is running normally.",
        healthRecommendationWatch: "The system is continuing to monitor.",
        healthRecommendationReview: "View diagnostic details while the system completes its review.",
        healthRecommendationCritical: "View diagnostic details and hold related changes for now.",
        healthDetail: "Data as of: {date}",
        healthScoreLabel: "Health",
        diagnosticDetails: "View diagnostic details",
        diagnosticDetailsHint: "Use this only to investigate an issue or review research records.",
        researchTaskNoOrderBadge: "NO ORDER",
        recoveryConfirmedStatus: "Confirmed",
        recoveryReadyStatus: "Ready to confirm",
        recoveryBlockedStatus: "Blocked",
        commonUnknown: "Unknown",
        commonNotMarked: "Not marked",
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
        planEyebrow: "Strategy settings",
        planTitle: "Change strategy settings",
        planSubtitle: "Choose a platform, account, strategy, and environment; review this change before saving.",
        planAdvancedSummary: "Advanced settings",
        planAdvancedHint: "Runtime, plugins, cash, overlays, and DCA normally retain their current setup. Expand only when changing one.",
        planScopeTitle: "Choose scope",
        planScopeSubtitle: "Platform, account, strategy, and target environment",
        planRuntimeTitle: "Runtime protection",
        planRuntimeSubtitle: "Disable state, plugins, and overlays share one plan boundary",
        planOverlayTitle: "Strategy overlays",
        planOverlaySubtitle: "Only strategy-defined default guardrails are available",
        planCashSubtitle: "Cash reserve takes precedence over margin; they cannot override together",
        activePlatform: "Target platform",
        account: "Target account",
        strategy: "Strategy",
        mode: "Target environment",
        live: "Live",
        paper: "Legacy non-live",
        dryRun: "Simulated run",
        liveModeUnavailable: "This strategy is not ready for Live. Choose a non-live environment.",
        runtimeTargetMode: "Account status",
        runtimeSectionTitle: "Runtime and plugins",
        runtimeTargetCurrent: "Keep current status",
        runtimeTargetEnabled: "Enabled",
        runtimeTargetDisabled: "Disabled",
        runtimeTargetModeMeta: "Disabled accounts skip live runs; dry runs and health checks still work.",
        pluginMode: "Plugin status",
        pluginModeNone: "Do not mount legacy plugins",
        pluginModeMeta: "The current candidate has no bound plugin; legacy plugins are not auto-mounted.",
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
        executionCashPolicyTitle: "Capital boundary",
        executionCashPolicyNote: "Allow margin and reserve-cash overrides cannot both apply. Yes clears reserve overrides; reserve overrides force No.",
        executionCashMarginBlocksReserve: "Allow margin is selected; submitting will clear reserve-cash overrides.",
        executionCashReserveBlocksMargin: "Reserve-cash override is active; submitting will force allow margin to No.",
        qmtPlatformCashNote: "QMT A-share does not use margin or platform reserve cash; cash constraints live in strategy execution_cash_reserve_ratio.",
        qmtDryRunOnlyNote: "This platform supports no-order dry runs only; no live execution route is configured.",
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
        summary: "Risk and change summary",
        summaryCurrent: "Current boundary",
        summaryPending: "Pending change",
        planReadinessTitle: "Before submission",
        planCheckAccount: "Account and scope",
        planCheckStrategy: "Strategy and environment",
        planCheckRisk: "Cash and risk settings",
        planCheckAuthority: "Live status",
        planCheckWaiting: "Waiting",
        planCheckSelected: "Read",
        planCheckValid: "Checked",
        planCheckFix: "Needs correction",
        planCheckNonLive: "Non-live",
        planCheckNoAuthority: "Not ready",
        planAuditNote: "This change is saved in the change history.",
        copySummary: "Copy state",
        loginToRun: "Sign in to submit a plan",
        loadingConfig: "Loading config",
        configureAccounts: "Configure accounts",
        runSwitch: "Save settings",
        noChanges: "No changes",
        readonlyNote: "Sign in to save settings.",
        publicReadonly: "Sign in to view account config.",
        loadingConfigNote: "Reading account config and current state.",
        missingConfigNote: "Account config is not loaded, so switching is disabled.",
        readyNote: "Review the changes above, then save.",
        invalidStrategyNote: "This account has no runnable strategy, so switching is disabled.",
        invalidReservePolicyNote: "Enter a valid amount or ratio for the selected reserved-cash policy.",
        invalidIncomeLayerNote: "Enter a valid income layer start amount and max ratio.",
        invalidOptionOverlayNote: "This strategy does not define an option layer to enable.",
        invalidDcaNote: "Enter a valid DCA mode and base amount.",
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
      view: "control",
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
        filter: "attention",
      },
      controlPlane: {
        payload: {
          data_status: "unavailable",
          computed_at: null,
          summary: { candidate_count: 0, deferred: 0, parked: 0, owner_decision_required: 0 },
          attention: { status: "unavailable", reason_codes: ["control_plane_source_unavailable"] },
          candidates: [],
          policy: { p4_p5_automation: "not_configured", p6_owner_decision_required: true },
          errors: [],
        },
      },
      ownerDecisions: {
        data_status: "unavailable",
        candidates: [],
        errors: [],
      },
      reconciliationRecovery: {
        payload: {
          data_status: "unavailable",
          computed_at: null,
          summary: { recovery_count: 0, awaiting_human_confirmation: 0, blocked: 0, confirmed: 0 },
          recoveries: [],
          policy: { human_confirmation_required: true, current_evidence_required: true, no_order: true, execution_authority_granted: false },
          errors: [],
        },
        submittingRecoveryId: null,
      },
      m0Research: {
        payload: {
          data_status: "unavailable",
          viewed_at: null,
          summary: {
            subject_count: 0,
            observation_count: 0,
            fresh_observation_count: 0,
            stale_observation_count: 0,
            unknown_observation_count: 0,
            horizon_conflict_count: 0,
            historical_stale_horizon_drift_count: 0,
          },
          subjects: [],
          policy: { authority: "research_only", no_order: true, permitted_next_step: "research_validation_only" },
          errors: [],
        },
      },
      adaptiveSelection: {
        payload: {
          data_status: "unavailable",
          computed_at: null,
          summary: { source_count: 0, decision_count: 0, candidate_count: 0, recommended_count: 0, rejected_candidate_count: 0 },
          selections: [],
          policy: { authority: "shadow_only", no_order: true, execution_authority_granted: false },
          errors: [],
        },
      },
      executionEvidence: {
        payload: {
          data_status: "unavailable",
          computed_at: null,
          summary: { deployment_count: 0, autonomous_shadow: 0, autonomous_paper: 0, owner_canary_decision: 0, parked: 0 },
          deployments: [],
          policy: { execution_evidence_read_only: true, p6_owner_decision_required: true, limited_live_canary_active: false },
          errors: [],
        },
      },
      runtimeTargetLifecycle: {
        payload: {
          data_status: "unavailable",
          computed_at: null,
          summary: { target_count: 0, enabled: 0, disabled: 0, attention: 0 },
          targets: [],
          policy: { lifecycle_status_read_only: true, no_order: true },
          errors: [],
        },
      },
      researchTasks: {
        payload: {
          data_status: "unavailable",
          computed_at: null,
          summary: { task_count: 0 },
          tasks: [],
          policy: { research_only: true, no_order: true, size_zero_required: true, p4_p5_p6_authorized: false },
          errors: [],
        },
      },
      configSource: "default",
      repositories: clone(defaultRepositories),
      forms: {
        longbridge: { accountKey: "preview", strategy: "", executionMode: "live", pluginMode: "none", ...defaultReserveForm() },
        ibkr: { accountKey: "preview", strategy: "", executionMode: "live", pluginMode: "none", ...defaultReserveForm() },
        schwab: { accountKey: "preview", strategy: "", executionMode: "live", pluginMode: "none", ...defaultReserveForm() },
        firstrade: { accountKey: "preview", strategy: "", executionMode: "live", pluginMode: "none", ...defaultReserveForm() },
        qmt: { accountKey: "preview", strategy: "", executionMode: "paper", pluginMode: "none", ...defaultReserveForm() },
        binance: { accountKey: "preview", strategy: "", executionMode: "live", pluginMode: "none" },
      },
    };

    const el = (id) => document.getElementById(id);
    const t = (key) => copy[state.lang][key] || copy.en[key] || key;
    const locale = () => (state.lang === "zh" ? "zh-CN" : "en-US");

    function formatDateTime(value) {
      if (!value) return "—";
      const parsed = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(parsed.getTime())) return "—";
      return new Intl.DateTimeFormat(locale(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
    }

    function formatAsOfDate(value) {
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return new Intl.DateTimeFormat(locale(), {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(parsed);
      }
      return formatDateTime(value);
    }

    function localizedExternalText(value, fallback) {
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) return fallback;
      const hasChinese = /[\u3400-\u9fff]/.test(text);
      const hasLatinWords = /[A-Za-z]{3,}/.test(text);
      if ((state.lang === "en" && hasChinese) || (state.lang === "zh" && hasLatinWords && !hasChinese)) {
        return fallback;
      }
      return text;
    }
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

    function supportedExecutionModesForPlatform(platform = state.selected) {
      const modes = platformConfig[platform]?.supported_execution_modes;
      return Array.isArray(modes) ? modes.filter((mode) => mode === "live" || mode === "dry_run") : [];
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
          runtime_enabled: cleanOptionalBoolean(item?.runtime_enabled ?? false) === true,
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
      if (["research_backtest_only", "ai_monitored_candidate"].includes(text)) return "research_active";
      if (text === "shadow_candidate") return "shadow_active";
      if (text === "runtime_enabled") return "live_candidate";
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
      if (entry.runtime_enabled !== true) return false;
      const allowedModes = normalizeAllowedExecutionModes(entry.allowed_execution_modes);
      if (!allowedModes.includes("live")) return false;
      if (cleanOptionalBoolean(entry.can_switch_live) !== true) return false;
      const lifecycleStage = normalizeLifecycleStage(entry.lifecycle_stage);
      if (!["live_enabled", "runtime_enabled"].includes(lifecycleStage)) return false;
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
      if (dcaConfigForStrategy(cleanProfile) && !platformSupportsDca(platform)) return false;
      if (!supportedDomainsForAccount(platform, account).includes(catalogEntry.domain)) return false;
      const mode = normalizeExecutionMode(executionMode, false);
      if (!supportedExecutionModesForPlatform(platform).includes(mode)) return false;
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

    function hasLiveStrategyOption(platform = state.selected, account = selectedAccount(platform)) {
      return strategyOptions.some((profile) => strategyAllowedForAccount(platform, account, profile, "live"));
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
      return mode === "dry_run" ? t("dryRun") : mode === "paper" ? t("paper") : t("live");
    }

    function normalizePluginMode(value) {
      return pluginModes.includes(value) ? value : "none";
    }

    function pluginModeLabel(mode) {
      void mode;
      return t("pluginModeNone");
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
      if (mode === "live") return "live";
      if (mode === "paper" || mode === "dry_run" || mode === "dry-run") return "dry_run";
      if (dryRunOnly === true || dryRunOnly === "true" || dryRunOnly === "1" || dryRunOnly === 1) return "dry_run";
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
      if (platformDryRunOnly(platform)) return "dry_run";
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
        return "dry_run";
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
      document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
        node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
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

      const supportedModes = supportedExecutionModesForPlatform(platform);
      const liveModeAvailable = supportedModes.includes("live") && hasLiveStrategyOption(platform, account);
      if (!supportedModes.includes(form.executionMode)) form.executionMode = "dry_run";
      document.querySelectorAll("#mode-control [data-mode]").forEach((button) => {
        button.disabled = !supportedModes.includes(button.dataset.mode) || (
          button.dataset.mode === "live" && !liveModeAvailable
        );
        button.classList.toggle("active", button.dataset.mode === form.executionMode);
      });
      el("mode-meta").textContent = !supportedModes.includes("live")
        ? t("qmtDryRunOnlyNote")
        : (!liveModeAvailable ? t("liveModeUnavailable") : "");
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
      const currentHeading = document.createElement("p");
      currentHeading.className = "summary-section-title";
      currentHeading.textContent = t("summaryCurrent");
      list.appendChild(currentHeading);
      let pendingSectionInserted = false;
      for (const [label, value, rowClass, valueTone] of summaryRows(inputs)) {
        if (!pendingSectionInserted && rowClass === "pending") {
          const pendingHeading = document.createElement("p");
          pendingHeading.className = "summary-section-title";
          pendingHeading.textContent = t("summaryPending");
          list.appendChild(pendingHeading);
          pendingSectionInserted = true;
        }
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

    function setPlanCheck(id, value, tone) {
      const node = el(id);
      if (!node) return;
      node.textContent = value;
      node.dataset.tone = tone || "neutral";
    }

    function renderPlanReadiness() {
      const platform = state.selected;
      const account = selectedAccount(platform);
      const configured = hasPrivateConfig() && Boolean(account?.key);
      const runnable = configured && hasRunnableStrategySelection(platform);
      const riskValid = configured && hasValidExecutionCashPolicy(platform) &&
        hasValidIncomeLayerPolicy(platform) && hasValidOptionOverlayPolicy(platform) && hasValidDcaPolicy(platform);
      const form = state.forms[platform];
      const isNonLive = normalizeExecutionMode(form?.executionMode, false) !== "live";
      setPlanCheck(
        "plan-check-account",
        configured ? t("planCheckSelected") : t("planCheckWaiting"),
        configured ? "ready" : "neutral",
      );
      setPlanCheck(
        "plan-check-strategy",
        runnable ? t("planCheckValid") : (configured ? t("planCheckFix") : t("planCheckWaiting")),
        runnable ? "ready" : (configured ? "warning" : "neutral"),
      );
      setPlanCheck(
        "plan-check-risk",
        riskValid ? t("planCheckValid") : (configured ? t("planCheckFix") : t("planCheckWaiting")),
        riskValid ? "ready" : (configured ? "warning" : "neutral"),
      );
      setPlanCheck(
        "plan-check-authority",
        isNonLive ? t("planCheckNonLive") : t("planCheckNoAuthority"),
        isNonLive ? "ready" : "warning",
      );
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

    function normalizeControlPlanePayload(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid control plane payload");
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      return {
        data_status: ["ready", "stale", "unavailable"].includes(payload.data_status) ? payload.data_status : "unavailable",
        computed_at: payload.computed_at || null,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        attention: payload.attention && typeof payload.attention === "object" && !Array.isArray(payload.attention)
          ? {
            status: ["research_only", "attention_required", "unavailable"].includes(payload.attention.status)
              ? payload.attention.status
              : "unavailable",
            reason_codes: Array.isArray(payload.attention.reason_codes) ? payload.attention.reason_codes : [],
          }
          : { status: "unavailable", reason_codes: ["control_plane_attention_missing"] },
        candidates: candidates.filter((item) => item && typeof item === "object" && item.lifecycle && typeof item.lifecycle === "object"),
        policy: payload.policy && typeof payload.policy === "object" ? payload.policy : {},
        errors: Array.isArray(payload.errors) ? payload.errors : [],
      };
    }

    function normalizeOwnerDecisionQueue(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid owner decision queue");
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      return {
        data_status: ["ready", "stale", "unavailable"].includes(payload.data_status) ? payload.data_status : "unavailable",
        candidates: candidates.filter((entry) => entry && typeof entry === "object"
          && entry.candidate && typeof entry.candidate === "object"
          && typeof entry.candidate_evidence_sha256 === "string"),
        errors: Array.isArray(payload.errors) ? payload.errors : [],
      };
    }

    function ownerDecisionEntry(candidateId) {
      return state.ownerDecisions.candidates.find((entry) => entry.candidate?.candidate_id === candidateId) || null;
    }

    function ownerDecisionLabel(decision) {
      return {
        approve_limited_live_canary: t("ownerDecisionApprove"),
        keep_parked: t("ownerDecisionPark"),
        retire_candidate: t("ownerDecisionRetire"),
      }[decision] || String(decision || "—");
    }

    const operatorLabels = {
      kind: {
        individual: { zh: "策略", en: "Strategy" },
        portfolio: { zh: "组合", en: "Portfolio" },
        plugin: { zh: "插件", en: "Plugin" },
      },
      status: {
        research: { zh: "观察中", en: "Monitoring" },
        evidence_pending: { zh: "待复核", en: "To review" },
        verified: { zh: "正常", en: "Normal" },
        deferred: { zh: "待复核", en: "To review" },
        parked: { zh: "已暂停", en: "Paused" },
        paper: { zh: "测试中", en: "Testing" },
        shadow: { zh: "观察中", en: "Monitoring" },
        owner_decision_required: { zh: "等待处理", en: "Needs attention" },
      },
      action: {
        keep_research: { zh: "继续观察", en: "Keep monitoring" },
        defer: { zh: "稍后复核", en: "Review later" },
        park: { zh: "保持暂停", en: "Keep paused" },
        auto_paper_evaluation: { zh: "继续测试", en: "Continue testing" },
        auto_shadow_evaluation: { zh: "继续观察", en: "Keep monitoring" },
        owner_live_decision: { zh: "需要确认", en: "Confirmation needed" },
        none: { zh: "暂无操作", en: "No action" },
      },
      freshness: {
        fresh: { zh: "最新", en: "Current" },
        stale: { zh: "更新延迟", en: "Delayed" },
        unavailable: { zh: "暂不可用", en: "Unavailable" },
        unknown: { zh: "暂不可用", en: "Unavailable" },
      },
    };

    function operatorLabel(group, value) {
      const label = operatorLabels[group]?.[value];
      return label ? (state.lang === "zh" ? label.zh : label.en) : "—";
    }

    function controlPlaneDataStatusText(status) {
      return status === "ready"
        ? t("controlDataReady")
        : (status === "stale" ? t("controlDataStale") : t("controlDataUnavailable"));
    }

    function controlPlaneAttentionText(attention) {
      const status = attention?.status || "unavailable";
      if (status === "research_only") return t("controlAttentionResearchOnly");
      if (status === "attention_required") return t("controlAttentionRequired");
      return t("controlAttentionUnavailable");
    }

    function candidateNeedsOperatorAction(item) {
      const recommendation = item?.recommendation?.code || "none";
      return Boolean(ownerDecisionEntry(item?.candidate_id))
        || item?.lifecycle?.status === "owner_decision_required"
        || recommendation === "owner_live_decision";
    }

    function renderControlPlane() {
      const payload = state.controlPlane.payload;
      const summary = payload.summary || {};
      const summaryAvailable = state.auth.allowed && payload.data_status !== "unavailable";
      const summaryCount = (value) => (summaryAvailable ? String(Number(value) || 0) : "—");
      el("control-plane-status").textContent = `${controlPlaneDataStatusText(payload.data_status)} · ${controlPlaneAttentionText(payload.attention)}`;
      el("control-plane-computed-at").textContent = payload.computed_at
        ? t("controlComputedAt").replace("{time}", formatDateTime(payload.computed_at))
        : t("controlComputedAt").replace("{time}", "—");
      el("control-count-candidates").textContent = summaryCount(summary.candidate_count);
      el("control-count-deferred").textContent = summaryCount(summary.deferred);
      el("control-count-parked").textContent = summaryCount(summary.parked);
      el("control-count-owner-decision").textContent = summaryCount(summary.owner_decision_required);

      const notice = el("control-plane-notice");
      const statePanel = notice.closest(".decision-state");
      const actionableCandidates = payload.candidates.filter(candidateNeedsOperatorAction);
      const queue = el("control-plane-queue");
      queue.hidden = !actionableCandidates.length;
      statePanel.classList.toggle("is-attention", actionableCandidates.length > 0 || payload.attention?.status === "attention_required");
      statePanel.classList.toggle("is-stale", payload.data_status === "stale");
      statePanel.classList.toggle("is-unavailable", !state.auth.allowed || payload.data_status === "unavailable");
      const stateMark = statePanel.querySelector(".decision-state__mark");
      stateMark.textContent = !state.auth.allowed || payload.data_status === "unavailable"
        ? "i"
        : ((actionableCandidates.length > 0 || payload.attention?.status === "attention_required" || payload.data_status === "stale") ? "!" : "✓");
      if (!state.auth.allowed) {
        notice.textContent = t("controlLoginNotice");
        el("control-plane-summary").textContent = t("controlLoginSummary");
      } else if (payload.data_status === "stale") {
        notice.textContent = t("controlStaleNotice");
        el("control-plane-summary").textContent = t("controlStaleSummary");
      } else if (payload.data_status !== "ready") {
        notice.textContent = t("controlUnavailableNotice");
        el("control-plane-summary").textContent = t("controlStaleSummary");
      } else if (payload.attention?.status === "attention_required") {
        notice.textContent = t("controlAttentionNotice")
          .replace("{deferred}", String(Number(summary.deferred) || 0))
          .replace("{parked}", String(Number(summary.parked) || 0))
          .replace("{signals}", String(payload.attention.reason_codes?.length || 0));
        el("control-plane-summary").textContent = t("controlAttentionSummary");
      } else if (payload.errors?.length) {
        notice.textContent = t("controlUpstreamNotice").replace("{count}", payload.errors.length);
        el("control-plane-summary").textContent = t("controlStaleSummary");
      } else {
        notice.textContent = t("controlNormalNotice");
        el("control-plane-summary").textContent = t("controlNormalSummary");
      }

      const list = el("control-plane-list");
      list.replaceChildren();
      for (const item of actionableCandidates) {
        const card = document.createElement("article");
        card.className = "health-card";
        const main = document.createElement("div");
        main.className = "health-card__main";
        const meta = document.createElement("div");
        meta.className = "health-card__meta";
        meta.textContent = `${operatorLabel("kind", item.candidate_kind)} · ${domainLabel(item.domain || "")}`;
        const title = document.createElement("h4");
        title.className = "health-card__title";
        title.textContent = String(item.candidate_id || "unknown");
        const reason = document.createElement("p");
        reason.className = "health-card__reason";
        reason.textContent = t("controlAttentionSummary");
        const detail = document.createElement("div");
        detail.className = "health-card__meta";
        detail.textContent = t("controlItemMeta")
          .replace("{kind}", operatorLabel("status", item.lifecycle?.status))
          .replace("{domain}", domainLabel(item.domain || ""))
          .replace("{freshness}", operatorLabel("freshness", item.freshness?.status || "unknown"));
        main.append(meta, title, reason, detail);
        const stateBlock = document.createElement("div");
        stateBlock.className = "health-card__score";
        const label = document.createElement("small");
        label.textContent = t("controlNext");
        const stage = document.createElement("strong");
        stage.textContent = operatorLabel("action", item.recommendation?.code || "none");
        const recommendation = document.createElement("small");
        recommendation.textContent = `${t("controlStatus")}：${operatorLabel("status", item.lifecycle?.status)}`;
        stateBlock.append(label, stage, recommendation);
        const ownerEntry = ownerDecisionEntry(item.candidate_id);
        if (ownerEntry) {
          const ownerDecision = document.createElement("div");
          ownerDecision.className = "owner-decision";
          const ownerTitle = document.createElement("strong");
          ownerTitle.textContent = t("ownerDecisionTitle");
          const ownerDetail = document.createElement("small");
          if (ownerEntry.intent) {
            ownerDetail.textContent = t("ownerDecisionRecorded")
              .replace("{decision}", ownerDecisionLabel(ownerEntry.intent.decision));
          } else if (!state.auth.admin) {
            ownerDetail.textContent = t("ownerDecisionAdminOnly");
          } else {
            ownerDetail.textContent = t("ownerDecisionReady");
          }
          ownerDecision.append(ownerTitle, ownerDetail);
          if (!ownerEntry.intent && state.auth.admin) {
            const actions = document.createElement("div");
            actions.className = "owner-decision__actions";
            const submitting = state.ownerDecisions.submittingCandidateId === item.candidate_id;
            for (const [decision, labelKey] of [
              ["approve_limited_live_canary", "ownerDecisionApprove"],
              ["keep_parked", "ownerDecisionPark"],
              ["retire_candidate", "ownerDecisionRetire"],
            ]) {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "owner-decision__button";
              button.dataset.ownerDecision = decision;
              button.dataset.candidateId = item.candidate_id;
              button.dataset.candidateEvidenceSha256 = ownerEntry.candidate_evidence_sha256;
              button.disabled = submitting;
              button.textContent = submitting ? t("ownerDecisionSubmitting") : t(labelKey);
              actions.appendChild(button);
            }
            ownerDecision.appendChild(actions);
          }
          main.appendChild(ownerDecision);
        }
        card.append(main, stateBlock);
        list.appendChild(card);
      }
    }

    function normalizeReconciliationRecoveryPayload(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("invalid reconciliation recovery payload");
      }
      const recoveries = Array.isArray(payload.recoveries) ? payload.recoveries : [];
      return {
        data_status: ["ready", "stale", "unavailable"].includes(payload.data_status) ? payload.data_status : "unavailable",
        computed_at: payload.computed_at || null,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        recoveries: recoveries.filter((entry) => entry && typeof entry === "object"
          && entry.recovery && typeof entry.recovery === "object"
          && entry.recovery.dual_review && typeof entry.recovery.dual_review === "object"),
        policy: payload.policy && typeof payload.policy === "object" ? payload.policy : {},
        errors: Array.isArray(payload.errors) ? payload.errors : [],
      };
    }

    function renderReconciliationRecovery() {
      const payload = state.reconciliationRecovery.payload;
      const notice = el("reconciliation-recovery-notice");
      if (!state.auth.allowed) {
        notice.textContent = t("reconciliationRecoveryLoginNotice");
      } else if (payload.data_status === "stale") {
        notice.textContent = t("reconciliationRecoveryStaleNotice");
      } else if (payload.data_status !== "ready") {
        notice.textContent = t("reconciliationRecoveryUnavailableNotice");
      } else if (payload.errors?.length) {
        notice.textContent = t("reconciliationRecoveryUpstreamNotice").replace("{count}", payload.errors.length);
      } else {
        notice.textContent = localizedExternalText(payload.policy?.notice, t("reconciliationRecoveryNoOrder"));
      }
      const list = el("reconciliation-recovery-list");
      list.replaceChildren();
      if (!payload.recoveries.length) {
        const empty = document.createElement("div");
        empty.className = "health-card__empty";
        empty.textContent = t("reconciliationRecoveryEmpty");
        list.appendChild(empty);
        return;
      }
      for (const entry of payload.recoveries) {
        const recovery = entry.recovery || {};
        const card = document.createElement("article");
        card.className = "health-card";
        const main = document.createElement("div");
        main.className = "health-card__main";
        const meta = document.createElement("div");
        meta.className = "health-card__meta";
        meta.textContent = t("reconciliationRecoveryMeta")
          .replace("{platform}", recovery.platform || "unknown")
          .replace("{strategy}", recovery.strategy_profile || "unknown");
        const title = document.createElement("h4");
        title.className = "health-card__title";
        title.textContent = String(recovery.recovery_id || "unknown");
        const detail = document.createElement("p");
        detail.className = "health-card__reason";
        detail.textContent = t("reconciliationRecoveryDetail")
          .replace("{state}", recovery.reconciliation_state || "unknown")
          .replace("{samples}", String(recovery.evidence_sample_count || 0))
          .replace("{review}", recovery.dual_review?.outcome || "unknown")
          .replace("{lastObserved}", recovery.last_observed_at || "—");
        const status = document.createElement("div");
        status.className = "health-card__meta";
        const ready = payload.data_status === "ready"
          && entry.freshness?.data_status === "ready"
          && recovery.readiness === "awaiting_human_confirmation"
          && recovery.blocker_codes?.length === 0
          && recovery.dual_review?.outcome === "approved"
          && recovery.dual_review?.evidence_binding_sha256 === recovery.candidate_sha256;
        if (entry.confirmation) {
          status.textContent = t("reconciliationRecoveryConfirmed");
        } else if (!ready) {
          status.textContent = t("reconciliationRecoveryBlocked")
            .replace("{blockers}", (recovery.blocker_codes || []).join(", ") || recovery.readiness || "unknown");
        } else if (!state.auth.admin) {
          status.textContent = t("reconciliationRecoveryAdminOnly");
        } else {
          status.textContent = t("reconciliationRecoveryReady");
        }
        main.append(meta, title, detail, status);
        if (ready && !entry.confirmation && state.auth.admin) {
          const actions = document.createElement("div");
          actions.className = "owner-decision__actions";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "owner-decision__button";
          button.dataset.reconciliationRecoveryConfirm = "true";
          button.dataset.recoveryId = recovery.recovery_id || "";
          button.dataset.candidateSha256 = recovery.candidate_sha256 || "";
          button.dataset.dualReviewBindingSha256 = recovery.dual_review?.evidence_binding_sha256 || "";
          const submitting = state.reconciliationRecovery.submittingRecoveryId === recovery.recovery_id;
          button.disabled = submitting;
          button.textContent = submitting ? t("reconciliationRecoverySubmitting") : t("reconciliationRecoveryConfirm");
          actions.appendChild(button);
          main.appendChild(actions);
        }
        const stateBlock = document.createElement("div");
        stateBlock.className = "health-card__score";
        const label = document.createElement("small");
        label.textContent = t("controlNext");
        const stateText = document.createElement("strong");
        stateText.textContent = entry.confirmation
          ? t("recoveryConfirmedStatus")
          : (ready ? t("recoveryReadyStatus") : t("recoveryBlockedStatus"));
        const freshness = document.createElement("small");
        freshness.textContent = entry.freshness?.data_status || "unknown";
        stateBlock.append(label, stateText, freshness);
        card.append(main, stateBlock);
        list.appendChild(card);
      }
    }

    const M0_RESEARCH_DISPLAY_LIMIT = 100;

    const m0ResearchLabels = {
      subject: {
        asset_idea: { zh: "资产观察", en: "Asset idea" },
        theme_context: { zh: "主题背景", en: "Theme context" },
        strategy_hypothesis: { zh: "研究假设", en: "Research hypothesis" },
        risk_context: { zh: "风险背景", en: "Risk context" },
      },
      state: {
        candidate: { zh: "待验证", en: "Candidate" },
        source_verification_required: { zh: "等待来源核验", en: "Source verification required" },
        deferred: { zh: "暂缓", en: "Deferred" },
        context_only: { zh: "仅作背景", en: "Context only" },
      },
      freshness: {
        fresh: { zh: "有效", en: "Fresh" },
        stale: { zh: "已过期", en: "Stale" },
        unknown: { zh: "未知", en: "Unknown" },
      },
      horizon: {
        short: { zh: "短期", en: "Short" },
        medium: { zh: "中期", en: "Medium" },
        long: { zh: "长期", en: "Long" },
        not_applicable: { zh: "不适用", en: "Not applicable" },
      },
      confidence: {
        high: { zh: "高", en: "High" },
        medium: { zh: "中", en: "Medium" },
        low: { zh: "低", en: "Low" },
        mixed: { zh: "混合", en: "Mixed" },
        no_event: { zh: "无事件", en: "No event" },
        unknown: { zh: "未知", en: "Unknown" },
      },
      style: {
        event_driven: { zh: "事件驱动", en: "Event driven" },
        long_horizon_growth: { zh: "长期成长", en: "Long-horizon growth" },
        value_quality: { zh: "价值质量", en: "Value quality" },
        macro_context: { zh: "宏观背景", en: "Macro context" },
        mixed_research: { zh: "综合研究", en: "Mixed research" },
      },
      conflict: {
        none: { zh: "无", en: "None" },
        conflict: { zh: "存在", en: "Present" },
        unavailable: { zh: "不可用", en: "Unavailable" },
      },
      drift: {
        none: { zh: "无", en: "None" },
        drift: { zh: "存在", en: "Present" },
        unavailable: { zh: "不可用", en: "Unavailable" },
      },
    };

    function m0ResearchLabel(group, value) {
      const entry = m0ResearchLabels[group]?.[value];
      return entry ? (state.lang === "zh" ? entry.zh : entry.en) : "—";
    }

    function m0ResearchTimestamp(value) {
      return formatDateTime(value);
    }

    function m0ResearchHorizons(values) {
      if (!Array.isArray(values) || !values.length) return "—";
      const labels = values.map((value) => m0ResearchLabel("horizon", value)).filter((value) => value !== "—");
      return labels.length ? labels.join(" / ") : "—";
    }

    function m0ResearchEntries(subjects) {
      if (!Array.isArray(subjects)) return [];
      const entries = [];
      for (const item of subjects) {
        if (!item || typeof item !== "object" || !item.subject || typeof item.subject !== "object") continue;
        if (!Array.isArray(item.observations)) continue;
        for (const observation of item.observations) {
          if (!observation || typeof observation !== "object" || !observation.research_context) continue;
          entries.push({
            subject: item.subject,
            observation,
            horizonConflict: item.horizon_conflict,
            historicalStaleHorizonDrift: item.historical_stale_horizon_drift,
          });
        }
      }
      return entries;
    }

    function normalizeM0ResearchPayload(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid M0 research payload");
      const subjects = Array.isArray(payload.subjects) ? payload.subjects : [];
      return {
        data_status: ["ready", "stale", "unavailable"].includes(payload.data_status) ? payload.data_status : "unavailable",
        viewed_at: typeof payload.viewed_at === "string" ? payload.viewed_at : null,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        subjects: subjects.filter((item) => item && typeof item === "object"
          && item.subject && typeof item.subject === "object" && Array.isArray(item.observations)),
        policy: payload.policy && typeof payload.policy === "object" ? payload.policy : {},
        errors: Array.isArray(payload.errors) ? payload.errors : [],
      };
    }

    function renderM0Research() {
      const payload = state.m0Research.payload;
      const entries = m0ResearchEntries(payload.subjects);
      const shownEntries = entries.slice(0, M0_RESEARCH_DISPLAY_LIMIT);
      const notice = el("m0-research-notice");
      if (!state.auth.allowed) {
        notice.textContent = t("m0ResearchLoginNotice");
      } else if (payload.data_status === "stale") {
        notice.textContent = t("m0ResearchStaleNotice");
      } else if (payload.data_status !== "ready") {
        notice.textContent = t("m0ResearchUnavailableNotice");
      } else if (payload.errors?.length) {
        notice.textContent = t("m0ResearchUpstreamNotice").replace("{count}", String(payload.errors.length));
      } else {
        const more = entries.length > M0_RESEARCH_DISPLAY_LIMIT
          ? ` ${t("m0ResearchMore").replace("{count}", String(M0_RESEARCH_DISPLAY_LIMIT))}`
          : "";
        notice.textContent = `${t("m0ResearchNoOrder")}${more}`;
      }

      const list = el("m0-research-list");
      list.replaceChildren();
      if (!shownEntries.length) {
        const empty = document.createElement("div");
        empty.className = "health-card__empty";
        empty.textContent = t("m0ResearchEmpty");
        list.appendChild(empty);
        return;
      }
      for (const entry of shownEntries) {
        const subject = entry.subject || {};
        const observation = entry.observation || {};
        const context = observation.research_context || {};
        const card = document.createElement("article");
        card.className = "health-card";
        const main = document.createElement("div");
        main.className = "health-card__main";
        const meta = document.createElement("div");
        meta.className = "health-card__meta";
        meta.textContent = t("m0ResearchMeta")
          .replace("{kind}", m0ResearchLabel("subject", subject.kind))
          .replace("{viewed}", m0ResearchTimestamp(payload.viewed_at));
        const title = document.createElement("h4");
        title.className = "health-card__title";
        title.textContent = typeof subject.identifier === "string" ? subject.identifier : "—";
        const stateFreshness = document.createElement("p");
        stateFreshness.className = "health-card__reason";
        stateFreshness.textContent = t("m0ResearchStateFreshness")
          .replace("{state}", m0ResearchLabel("state", context.state))
          .replace("{freshness}", m0ResearchLabel("freshness", observation.freshness?.status));
        const horizons = document.createElement("div");
        horizons.className = "health-card__meta";
        horizons.textContent = t("m0ResearchHorizons")
          .replace("{primary}", m0ResearchLabel("horizon", context.primary_horizon))
          .replace("{suitable}", m0ResearchHorizons(context.suitable_horizons));
        const evidence = document.createElement("div");
        evidence.className = "health-card__meta";
        evidence.textContent = t("m0ResearchEvidence")
          .replace("{confidence}", m0ResearchLabel("confidence", context.source_confidence))
          .replace("{style}", m0ResearchLabel("style", context.source_style))
          .replace("{digest}", `${shortResearchDigest(observation.source_report_digest)} / ${shortResearchDigest(observation.source_entry_digest)}`);
        const consistency = document.createElement("div");
        consistency.className = "health-card__meta";
        consistency.textContent = t("m0ResearchConsistency")
          .replace("{conflict}", m0ResearchLabel("conflict", entry.horizonConflict?.status))
          .replace("{drift}", m0ResearchLabel("drift", entry.historicalStaleHorizonDrift?.status));
        main.append(meta, title, stateFreshness, horizons, evidence, consistency);
        const status = document.createElement("div");
        status.className = "health-card__score";
        const label = document.createElement("small");
        label.textContent = state.lang === "zh" ? "研究" : "Research";
        const freshness = document.createElement("strong");
        freshness.textContent = m0ResearchLabel("freshness", observation.freshness?.status);
        const stateLabel = document.createElement("small");
        stateLabel.textContent = m0ResearchLabel("state", context.state);
        status.append(label, freshness, stateLabel);
        card.append(main, status);
        list.appendChild(card);
      }
    }

    function normalizeAdaptiveSelectionPayload(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid adaptive selection payload");
      const selections = Array.isArray(payload.selections) ? payload.selections : [];
      return {
        data_status: ["ready", "stale", "unavailable"].includes(payload.data_status) ? payload.data_status : "unavailable",
        computed_at: payload.computed_at || null,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        selections: selections.filter((item) => item && typeof item === "object"
          && typeof item.source_id === "string" && item.decision && typeof item.decision === "object"),
        policy: payload.policy && typeof payload.policy === "object" ? payload.policy : {},
        errors: Array.isArray(payload.errors) ? payload.errors : [],
      };
    }

    function renderAdaptiveSelection() {
      const payload = state.adaptiveSelection.payload;
      const notice = el("adaptive-selection-notice");
      if (!state.auth.allowed) {
        notice.textContent = t("adaptiveSelectionLoginNotice");
      } else if (payload.data_status === "stale") {
        notice.textContent = t("adaptiveSelectionStaleNotice");
      } else if (payload.data_status !== "ready") {
        notice.textContent = t("adaptiveSelectionUnavailableNotice");
      } else if (payload.errors?.length) {
        notice.textContent = t("adaptiveSelectionUpstreamNotice").replace("{count}", String(payload.errors.length));
      } else {
        notice.textContent = localizedExternalText(payload.policy?.notice, t("adaptiveSelectionNoOrder"));
      }

      const list = el("adaptive-selection-list");
      list.replaceChildren();
      if (!payload.selections.length) {
        const empty = document.createElement("div");
        empty.className = "health-card__empty";
        empty.textContent = t("adaptiveSelectionEmpty");
        list.appendChild(empty);
        return;
      }
      for (const entry of payload.selections) {
        const decision = entry.decision || {};
        const context = decision.market_context || {};
        const recommended = decision.candidates?.find((item) => item.accepted
          && item.strategy_profile === decision.recommended_strategy_profile) || null;
        const rejected = (decision.candidates || []).filter((item) => !item.accepted);
        const reasons = (recommended?.reasons?.length ? recommended.reasons : rejected.flatMap((item) => item.reasons || []))
          .slice(0, 3)
          .join(", ");

        const card = document.createElement("article");
        card.className = "health-card";
        const main = document.createElement("div");
        main.className = "health-card__main";
        const meta = document.createElement("div");
        meta.className = "health-card__meta";
        meta.textContent = t("adaptiveSelectionMeta")
          .replace("{source}", entry.source_id || "unknown")
          .replace("{domain}", domainLabel(context.domain || ""))
          .replace("{asOf}", context.as_of || "—");
        const title = document.createElement("h4");
        title.className = "health-card__title";
        title.textContent = recommended
          ? `${t("adaptiveSelectionRecommended")} · ${recommended.strategy_profile}`
          : t("adaptiveSelectionNoCandidate");
        const reason = document.createElement("p");
        reason.className = "health-card__reason";
        reason.textContent = reasons
          ? t("adaptiveSelectionReason").replace("{reasons}", localizedExternalText(reasons, t("adaptiveSelectionNoOrder")))
          : t("adaptiveSelectionNoOrder");
        main.append(meta, title, reason);
        const status = document.createElement("div");
        status.className = "health-card__score";
        const label = document.createElement("small");
        label.textContent = t("adaptiveSelectionScoreLabel");
        const score = document.createElement("strong");
        score.textContent = typeof recommended?.score === "number" ? recommended.score.toFixed(3) : "—";
        const freshness = document.createElement("small");
        freshness.textContent = controlPlaneDataStatusText(entry.freshness?.data_status);
        status.append(label, score, freshness);
        card.append(main, status);
        list.appendChild(card);
      }
    }

    function normalizeExecutionEvidencePayload(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid execution evidence payload");
      const deployments = Array.isArray(payload.deployments) ? payload.deployments : [];
      return {
        data_status: ["ready", "stale", "unavailable"].includes(payload.data_status) ? payload.data_status : "unavailable",
        computed_at: payload.computed_at || null,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        deployments: deployments.filter((item) => item && typeof item === "object" && item.deployment && typeof item.deployment === "object"),
        policy: payload.policy && typeof payload.policy === "object" ? payload.policy : {},
        errors: Array.isArray(payload.errors) ? payload.errors : [],
      };
    }

    function executionEvidenceReceiptOutcomeLabel(value) {
      return {
        not_due: t("executionEvidenceReceiptNotDue"),
        no_action: t("executionEvidenceReceiptNoAction"),
        risk_blocked: t("executionEvidenceReceiptRiskBlocked"),
        submitted: t("executionEvidenceReceiptSubmitted"),
        broker_acknowledged: t("executionEvidenceReceiptAcknowledged"),
        partially_filled: t("executionEvidenceReceiptPartiallyFilled"),
        filled: t("executionEvidenceReceiptFilled"),
        reconciliation_required: t("executionEvidenceReceiptReconciliation"),
        failed: t("executionEvidenceReceiptFailed"),
      }[value] || t("executionEvidenceReceiptMissing");
    }

    function executionEvidenceReceiptConfirmationLabel(value) {
      return {
        not_applicable: t("executionEvidenceConfirmationNotApplicable"),
        not_observed: t("executionEvidenceConfirmationNotObserved"),
        acknowledged: t("executionEvidenceConfirmationAcknowledged"),
        partially_filled: t("executionEvidenceConfirmationPartiallyFilled"),
        filled: t("executionEvidenceConfirmationFilled"),
        reconciliation_required: t("executionEvidenceConfirmationReconciliation"),
      }[value] || t("executionEvidenceConfirmationNotObserved");
    }

    function renderExecutionEvidence() {
      const payload = state.executionEvidence.payload;
      const notice = el("execution-evidence-notice");
      if (!state.auth.allowed) {
        notice.textContent = t("executionEvidenceLoginNotice");
      } else if (payload.data_status === "stale") {
        notice.textContent = t("executionEvidenceStaleNotice");
      } else if (payload.data_status !== "ready") {
        notice.textContent = t("executionEvidenceUnavailableNotice");
      } else if (payload.errors?.length) {
        notice.textContent = t("executionEvidenceUpstreamNotice").replace("{count}", payload.errors.length);
      } else {
        notice.textContent = localizedExternalText(payload.policy?.notice, t("executionEvidenceNoOrder"));
      }

      const list = el("execution-evidence-list");
      list.replaceChildren();
      if (!payload.deployments.length) {
        const empty = document.createElement("div");
        empty.className = "health-card__empty";
        empty.textContent = t("executionEvidenceEmpty");
        list.appendChild(empty);
        return;
      }
      for (const entry of payload.deployments) {
        const deployment = entry.deployment || {};
        const strategy = deployment.strategy || {};
        const target = deployment.target || {};
        const capabilities = deployment.capabilities || {};
        const evidence = deployment.evidence || {};
        const executionReceipt = deployment.execution_receipt || null;
        const card = document.createElement("article");
        card.className = "health-card";
        const main = document.createElement("div");
        main.className = "health-card__main";
        const meta = document.createElement("div");
        meta.className = "health-card__meta";
        meta.textContent = t("executionEvidenceMeta")
          .replace("{platform}", target.platform || "unknown")
          .replace("{environment}", target.environment || "unknown")
          .replace("{source}", entry.source_id || "unknown");
        const title = document.createElement("h4");
        title.className = "health-card__title";
        title.textContent = String(strategy.candidate_id || deployment.deployment_id || "unknown");
        const reason = document.createElement("p");
        reason.className = "health-card__reason";
        reason.textContent = localizedExternalText(deployment.recommendation?.reason_code, t("executionEvidenceNoOrder"));
        const detail = document.createElement("div");
        detail.className = "health-card__meta";
        detail.textContent = t("executionEvidenceDetail")
          .replace("{strategy}", evidence.strategy || "unknown")
          .replace("{data}", evidence.target_data || "unknown")
          .replace("{execution}", evidence.target_execution || "unknown")
          .replace("{shadow}", capabilities.shadow || "unknown")
          .replace("{paper}", capabilities.paper || "unknown");
        const receiptDetail = document.createElement("div");
        receiptDetail.className = "health-card__meta";
        receiptDetail.textContent = executionReceipt
          ? t("executionEvidenceReceipt")
            .replace("{outcome}", executionEvidenceReceiptOutcomeLabel(executionReceipt.outcome))
            .replace("{confirmation}", executionEvidenceReceiptConfirmationLabel(executionReceipt.broker_confirmation))
          : t("executionEvidenceReceiptMissing");
        main.append(meta, title, reason, detail, receiptDetail);
        const stateBlock = document.createElement("div");
        stateBlock.className = "health-card__score";
        const label = document.createElement("small");
        label.textContent = t("executionEvidenceNext");
        const recommendation = document.createElement("strong");
        recommendation.textContent = operatorLabel("action", deployment.recommendation?.code || "park");
        const freshness = document.createElement("small");
        freshness.textContent = controlPlaneDataStatusText(entry.freshness?.data_status);
        stateBlock.append(label, recommendation, freshness);
        card.append(main, stateBlock);
        list.appendChild(card);
      }
    }

    function normalizeRuntimeTargetLifecyclePayload(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("invalid runtime target lifecycle payload");
      }
      const targets = Array.isArray(payload.targets) ? payload.targets : [];
      return {
        data_status: ["ready", "stale", "unavailable"].includes(payload.data_status) ? payload.data_status : "unavailable",
        computed_at: payload.computed_at || null,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        targets: targets.filter((entry) => entry && typeof entry === "object"
          && entry.target && typeof entry.target === "object"
          && entry.target.target && typeof entry.target.target === "object"
          && entry.target.monitoring && typeof entry.target.monitoring === "object"
          && entry.target.disposition && typeof entry.target.disposition === "object"),
        policy: payload.policy && typeof payload.policy === "object" ? payload.policy : {},
        errors: Array.isArray(payload.errors) ? payload.errors : [],
      };
    }

    function runtimeTargetLifecycleCheckLabel(value) {
      return {
        pass: t("runtimeTargetLifecycleCheckPass"),
        attention: t("runtimeTargetLifecycleCheckAttention"),
        not_due: t("runtimeTargetLifecycleCheckNotDue"),
        not_applicable: t("runtimeTargetLifecycleCheckNotApplicable"),
        unavailable: t("runtimeTargetLifecycleCheckUnavailable"),
      }[value] || t("runtimeTargetLifecycleCheckUnavailable");
    }

    function runtimeTargetLifecycleStateLabel(value) {
      return value === "enabled"
        ? t("runtimeTargetLifecycleStateEnabled")
        : t("runtimeTargetLifecycleStateDisabled");
    }

    function runtimeTargetLifecycleObservationLabel(value) {
      return {
        not_due: t("runtimeTargetLifecycleObservationNotDue"),
        monitoring_only: t("runtimeTargetLifecycleObservationMonitoringOnly"),
        not_applicable: t("runtimeTargetLifecycleObservationNotApplicable"),
        attention: t("runtimeTargetLifecycleObservationAttention"),
        unavailable: t("runtimeTargetLifecycleObservationUnavailable"),
      }[value] || t("runtimeTargetLifecycleObservationUnavailable");
    }

    function runtimeTargetLifecycleOrderEvidenceLabel(value) {
      return {
        not_collected: t("runtimeTargetLifecycleOrderEvidenceNotCollected"),
      }[value] || t("runtimeTargetLifecycleOrderEvidenceNotCollected");
    }

    function runtimeTargetLifecycleDispositionLabel(value) {
      return {
        continue_enabled_monitoring: t("runtimeTargetLifecycleDispositionEnabled"),
        continue_disabled_validation: t("runtimeTargetLifecycleDispositionDisabled"),
        parked: t("runtimeTargetLifecycleDispositionParked"),
      }[value] || t("runtimeTargetLifecycleDispositionParked");
    }

    function runtimeTargetLifecycleReasonLabel(value) {
      return {
        none: t("runtimeTargetLifecycleReasonNone"),
        target_intentionally_disabled: t("runtimeTargetLifecycleReasonDisabled"),
        runtime_guard_attention: t("runtimeTargetLifecycleReasonRuntimeGuard"),
        execution_heartbeat_attention: t("runtimeTargetLifecycleReasonHeartbeat"),
        monitoring_unavailable: t("runtimeTargetLifecycleReasonUnavailable"),
      }[value] || t("runtimeTargetLifecycleReasonUnavailable");
    }

    function renderRuntimeTargetLifecycle() {
      const payload = state.runtimeTargetLifecycle.payload;
      const notice = el("runtime-target-lifecycle-notice");
      if (!state.auth.allowed) {
        notice.textContent = t("runtimeTargetLifecycleLoginNotice");
      } else if (payload.data_status === "stale") {
        notice.textContent = t("runtimeTargetLifecycleStaleNotice");
      } else if (payload.data_status !== "ready") {
        notice.textContent = t("runtimeTargetLifecycleUnavailableNotice");
      } else if (payload.errors?.length) {
        notice.textContent = t("runtimeTargetLifecycleUpstreamNotice").replace("{count}", String(payload.errors.length));
      } else {
        notice.textContent = localizedExternalText(payload.policy?.notice, t("runtimeTargetLifecycleNoOrder"));
      }

      const list = el("runtime-target-lifecycle-list");
      list.replaceChildren();
      if (!payload.targets.length) {
        const empty = document.createElement("div");
        empty.className = "health-card__empty";
        empty.textContent = t("runtimeTargetLifecycleEmpty");
        list.appendChild(empty);
        return;
      }

      const targets = [...payload.targets].sort((left, right) => {
        const leftParked = left.target?.disposition?.code === "parked" ? 0 : 1;
        const rightParked = right.target?.disposition?.code === "parked" ? 0 : 1;
        if (leftParked !== rightParked) return leftParked - rightParked;
        return String(left.target?.target_id || "").localeCompare(String(right.target?.target_id || ""));
      });
      for (const entry of targets) {
        const target = entry.target || {};
        const configuration = target.target || {};
        const monitoring = target.monitoring || {};
        const disposition = target.disposition || {};
        const executionObservation = entry.execution_observation || {};
        const card = document.createElement("article");
        card.className = "health-card";
        const main = document.createElement("div");
        main.className = "health-card__main";
        const meta = document.createElement("div");
        meta.className = "health-card__meta";
        meta.textContent = t("runtimeTargetLifecycleMeta")
          .replace("{platform}", configuration.platform || "unknown")
          .replace("{state}", runtimeTargetLifecycleStateLabel(configuration.configured_state))
          .replace("{mode}", configuration.execution_mode || "unknown");
        const title = document.createElement("h4");
        title.className = "health-card__title";
        title.textContent = String(target.target_id || "unknown");
        const reason = document.createElement("p");
        reason.className = "health-card__reason";
        reason.textContent = runtimeTargetLifecycleReasonLabel(disposition.reason_code);
        const detail = document.createElement("div");
        detail.className = "health-card__meta";
        detail.textContent = t("runtimeTargetLifecycleDetail")
          .replace("{guard}", runtimeTargetLifecycleCheckLabel(monitoring.runtime_guard))
          .replace("{heartbeat}", runtimeTargetLifecycleCheckLabel(monitoring.execution_heartbeat));
        const observation = document.createElement("div");
        observation.className = "health-card__meta";
        observation.textContent = t("runtimeTargetLifecycleObservation")
          .replace("{observation}", runtimeTargetLifecycleObservationLabel(executionObservation.code))
          .replace("{evidence}", runtimeTargetLifecycleOrderEvidenceLabel(executionObservation.order_or_fill_evidence));
        main.append(meta, title, reason, detail, observation);

        const stateBlock = document.createElement("div");
        stateBlock.className = "health-card__score";
        const label = document.createElement("small");
        label.textContent = t("runtimeTargetLifecycleNext");
        const current = document.createElement("strong");
        current.textContent = runtimeTargetLifecycleDispositionLabel(disposition.code);
        const freshness = document.createElement("small");
        freshness.textContent = entry.freshness?.data_status || "unknown";
        stateBlock.append(label, current, freshness);
        card.append(main, stateBlock);
        list.appendChild(card);
      }
    }

    function normalizeResearchTaskPayload(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid research task payload");
      const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      return {
        data_status: ["ready", "stale", "unavailable"].includes(payload.data_status) ? payload.data_status : "unavailable",
        computed_at: payload.computed_at || null,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        tasks: tasks.filter((item) => item && typeof item === "object" && item.task && typeof item.task === "object"),
        policy: payload.policy && typeof payload.policy === "object" ? payload.policy : {},
        errors: Array.isArray(payload.errors) ? payload.errors : [],
      };
    }

    function shortResearchDigest(value) {
      const text = String(value || "");
      return /^[0-9a-f]{64}$/.test(text) ? `${text.slice(0, 10)}…` : "—";
    }

    function renderResearchTasks() {
      const payload = state.researchTasks.payload;
      const notice = el("research-task-notice");
      if (!state.auth.allowed) {
        notice.textContent = t("researchTaskLoginNotice");
      } else if (payload.data_status === "stale") {
        notice.textContent = t("researchTaskStaleNotice");
      } else if (payload.data_status !== "ready") {
        notice.textContent = t("researchTaskUnavailableNotice");
      } else if (payload.errors?.length) {
        notice.textContent = t("researchTaskUpstreamNotice").replace("{count}", payload.errors.length);
      } else {
        notice.textContent = localizedExternalText(payload.policy?.notice, t("researchTaskNoOrder"));
      }

      const list = el("research-task-list");
      list.replaceChildren();
      if (!payload.tasks.length) {
        const empty = document.createElement("div");
        empty.className = "health-card__empty";
        empty.textContent = t("researchTaskEmpty");
        list.appendChild(empty);
        return;
      }
      for (const entry of payload.tasks) {
        const task = entry.task || {};
        const card = document.createElement("article");
        card.className = "health-card";
        const main = document.createElement("div");
        main.className = "health-card__main";
        const meta = document.createElement("div");
        meta.className = "health-card__meta";
        meta.textContent = t("researchTaskMeta")
          .replace("{type}", task.task_type || "research")
          .replace("{domain}", domainLabel(task.target?.domain || ""))
          .replace("{created}", formatDateTime(task.created_at));
        const title = document.createElement("h4");
        title.className = "health-card__title";
        title.textContent = `${task.target?.candidate_id || "unknown"} · ${task.task_id || "unknown"}`;
        const hypothesis = document.createElement("p");
        hypothesis.className = "health-card__reason";
        hypothesis.textContent = localizedExternalText(task.experiment?.hypothesis, t("researchTaskNoOrder"));
        const detail = document.createElement("div");
        detail.className = "health-card__meta";
        detail.textContent = t("researchTaskLimits")
          .replace("{runs}", String(task.experiment?.max_runs || "—"))
          .replace("{seconds}", String(task.experiment?.max_wall_seconds || "—"))
          .replace("{p1}", shortResearchDigest(task.evidence?.p1_input_digest))
          .replace("{p2}", shortResearchDigest(task.evidence?.p2_config_digest))
          .replace("{p3}", shortResearchDigest(task.evidence?.p3_evidence_id));
        main.append(meta, title, hypothesis, detail);
        const status = document.createElement("div");
        status.className = "health-card__score";
        const label = document.createElement("small");
        label.textContent = t("researchTaskNoOrderBadge");
        const count = document.createElement("strong");
        count.textContent = String(task.experiment?.max_runs || "—");
        const source = document.createElement("small");
        source.textContent = controlPlaneDataStatusText(entry.freshness?.data_status);
        status.append(label, count, source);
        card.append(main, status);
        list.appendChild(card);
      }
    }

    function healthStatusLabel(status) {
      return {
        healthy: t("healthStatusHealthy"),
        watch: t("healthStatusWatch"),
        review: t("healthStatusReview"),
        critical: t("healthStatusCritical"),
      }[status] || t("healthStatusUnknown");
    }

    function healthRecommendationText(status) {
      return {
        healthy: t("healthRecommendationHealthy"),
        watch: t("healthRecommendationWatch"),
        review: t("healthRecommendationReview"),
        critical: t("healthRecommendationCritical"),
      }[status] || t("healthDecisionFallbackReason");
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
      const healthCount = (status) => Math.max(
        Number(summary[status]) || 0,
        payload.strategies.filter((item) => item.status === status).length,
      );
      const criticalCount = healthCount("critical");
      const reviewCount = healthCount("review");
      const watchCount = healthCount("watch");
      const hasAttention = criticalCount + reviewCount + watchCount > 0;
      const summaryAvailable = state.auth.allowed && payload.data_status !== "unavailable";
      const summaryCount = (value) => (summaryAvailable ? String(Number(value) || 0) : "—");
      const statusText = payload.data_status === "ready"
        ? t("healthDataReady")
        : (payload.data_status === "stale" ? t("healthDataStale") : t("healthDataUnavailable"));
      el("health-status").textContent = statusText;
      el("health-computed-at").textContent = payload.computed_at
        ? t("healthComputedAt").replace("{time}", formatDateTime(payload.computed_at))
        : t("healthComputedAt").replace("{time}", "—");
      el("health-count-total").textContent = summaryCount(summary.strategy_count);
      el("health-count-healthy").textContent = summaryCount(summary.healthy);
      el("health-count-watch").textContent = summaryCount(summary.watch);
      el("health-count-review").textContent = summaryCount(summary.review);
      el("health-count-critical").textContent = summaryCount(summary.critical);

      const notice = el("health-notice");
      if (!state.auth.allowed) {
        notice.textContent = t("healthLoginNotice");
      } else if (payload.data_status === "stale") {
        notice.textContent = t("healthStaleNotice");
      } else if (payload.data_status !== "ready") {
        notice.textContent = t("healthUnavailableNotice");
      } else if (hasAttention) {
        notice.textContent = t("healthAttentionNotice")
          .replace("{critical}", String(criticalCount))
          .replace("{review}", String(reviewCount))
          .replace("{watch}", String(watchCount));
      } else if (payload.errors?.length) {
        notice.textContent = t("healthUpstreamNotice");
      } else {
        notice.textContent = t("healthNormalNotice");
      }

      const list = el("health-list");
      list.replaceChildren();
      const strategies = payload.strategies.filter((item) => state.health.filter === "all" || item.status !== "healthy");
      if (!strategies.length) {
        const empty = document.createElement("div");
        empty.className = "health-card__empty";
        empty.textContent = t("healthEmpty");
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
        meta.textContent = t("healthCardMeta")
          .replace("{status}", healthStatusLabel(item.status))
          .replace("{domain}", domainLabel(item.domain || ""));
        const title = document.createElement("h4");
        title.className = "health-card__title";
        title.textContent = strategyLabel(item.profile) || t("commonUnknown");
        const reason = document.createElement("p");
        reason.className = "health-card__reason";
        reason.textContent = healthRecommendationText(item.status);
        const detail = document.createElement("div");
        detail.className = "health-card__meta";
        detail.textContent = t("healthDetail")
          .replace("{date}", formatAsOfDate(item.as_of));
        main.append(meta, title, reason, detail);
        const scoreBlock = document.createElement("div");
        scoreBlock.className = "health-card__score";
        const scoreLabel = document.createElement("small");
        scoreLabel.textContent = t("healthScoreLabel");
        const score = document.createElement("strong");
        score.textContent = typeof item.score === "number" ? item.score.toFixed(1) : "—";
        const decision = document.createElement("small");
        decision.textContent = healthStatusLabel(item.status);
        scoreBlock.append(scoreLabel, score, decision);
        card.append(main, scoreBlock);
        list.appendChild(card);
      }
    }

    function renderConsoleView() {
      const controlButton = el("control-plane-view-button");
      const healthButton = el("health-view-button");
      const switchButton = el("switch-view-button");
      const controlVisible = state.view === "control";
      const healthVisible = state.view === "health";
      el("control-plane-view").hidden = !controlVisible;
      el("health-view").hidden = !healthVisible;
      el("switch-view").hidden = controlVisible || healthVisible;
      controlButton.classList.toggle("active", controlVisible);
      healthButton.classList.toggle("active", healthVisible);
      switchButton.classList.toggle("active", !controlVisible && !healthVisible);
    }

    function render() {
      applyLanguage();
      renderConsoleView();
      renderControlPlane();
      renderM0Research();
      renderAdaptiveSelection();
      renderExecutionEvidence();
      renderRuntimeTargetLifecycle();
      renderResearchTasks();
      renderHealth();
      renderPlatforms();
      renderControls();
      renderSummary();
      renderPlanReadiness();
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
        await refreshControlPlane();
        await refreshOwnerDecisions();
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

    async function refreshControlPlane() {
      if (!state.auth.allowed) {
        renderControlPlane();
        return;
      }
      try {
        state.controlPlane.payload = normalizeControlPlanePayload(await requestJson("/api/control-plane"));
      } catch {
        state.controlPlane.payload = {
          data_status: "unavailable",
          computed_at: null,
          summary: { candidate_count: 0, deferred: 0, parked: 0, owner_decision_required: 0 },
          attention: { status: "unavailable", reason_codes: ["control_plane_request_failed"] },
          candidates: [],
          policy: { p4_p5_automation: "not_configured", p6_owner_decision_required: true },
          errors: ["control_plane_request_failed"],
        };
      }
      renderControlPlane();
    }

    async function refreshOwnerDecisions() {
      if (!state.auth.allowed) {
        state.ownerDecisions = { data_status: "unavailable", candidates: [], errors: [] };
        renderControlPlane();
        return;
      }
      try {
        state.ownerDecisions = normalizeOwnerDecisionQueue(await requestJson("/api/owner-decisions"));
      } catch {
        state.ownerDecisions = {
          data_status: "unavailable",
          candidates: [],
          errors: ["owner_decision_queue_request_failed"],
        };
      }
      renderControlPlane();
    }

    async function refreshReconciliationRecovery() {
      if (!state.auth.allowed) {
        renderReconciliationRecovery();
        return;
      }
      try {
        state.reconciliationRecovery.payload = normalizeReconciliationRecoveryPayload(
          await requestJson("/api/reconciliation-recovery"),
        );
      } catch {
        state.reconciliationRecovery.payload = {
          data_status: "unavailable",
          computed_at: null,
          summary: { recovery_count: 0, awaiting_human_confirmation: 0, blocked: 0, confirmed: 0 },
          recoveries: [],
          policy: { human_confirmation_required: true, current_evidence_required: true, no_order: true, execution_authority_granted: false },
          errors: ["reconciliation_recovery_request_failed"],
        };
      }
      renderReconciliationRecovery();
    }

    async function refreshM0Research() {
      if (!state.auth.allowed) {
        renderM0Research();
        return;
      }
      try {
        state.m0Research.payload = normalizeM0ResearchPayload(await requestJson("/api/m0-research"));
      } catch {
        state.m0Research.payload = {
          data_status: "unavailable",
          viewed_at: null,
          summary: {
            subject_count: 0,
            observation_count: 0,
            fresh_observation_count: 0,
            stale_observation_count: 0,
            unknown_observation_count: 0,
            horizon_conflict_count: 0,
            historical_stale_horizon_drift_count: 0,
          },
          subjects: [],
          policy: { authority: "research_only", no_order: true, permitted_next_step: "research_validation_only" },
          errors: ["m0_research_request_failed"],
        };
      }
      renderM0Research();
    }

    async function refreshAdaptiveSelection() {
      if (!state.auth.allowed) {
        renderAdaptiveSelection();
        return;
      }
      try {
        state.adaptiveSelection.payload = normalizeAdaptiveSelectionPayload(await requestJson("/api/adaptive-selection"));
      } catch {
        state.adaptiveSelection.payload = {
          data_status: "unavailable",
          computed_at: null,
          summary: { source_count: 0, decision_count: 0, candidate_count: 0, recommended_count: 0, rejected_candidate_count: 0 },
          selections: [],
          policy: { authority: "shadow_only", no_order: true, execution_authority_granted: false },
          errors: ["adaptive_selection_request_failed"],
        };
      }
      renderAdaptiveSelection();
    }

    async function recordOwnerDecision(button) {
      if (!state.auth.admin) return;
      const candidateId = String(button.dataset.candidateId || "");
      const candidateEvidenceSha256 = String(button.dataset.candidateEvidenceSha256 || "");
      const decision = String(button.dataset.ownerDecision || "");
      if (!candidateId || !candidateEvidenceSha256 || !decision) return;
      if (!window.confirm(t("ownerDecisionConfirm"))) return;
      state.ownerDecisions.submittingCandidateId = candidateId;
      renderControlPlane();
      try {
        const response = await fetch("/api/owner-decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_id: candidateId,
            decision,
            candidate_evidence_sha256: candidateEvidenceSha256,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || t("ownerDecisionFailed"));
        showToast(t("ownerDecisionSuccess"), { duration: 7000 });
        await refreshControlPlane();
        await refreshOwnerDecisions();
      } catch (error) {
        showToast(`${t("ownerDecisionFailed")}: ${error.message}`, { duration: 12000 });
      } finally {
        delete state.ownerDecisions.submittingCandidateId;
        renderControlPlane();
      }
    }

    async function recordReconciliationRecoveryConfirmation(button) {
      if (!state.auth.admin) return;
      const recoveryId = String(button.dataset.recoveryId || "");
      const candidateSha256 = String(button.dataset.candidateSha256 || "");
      const dualReviewBindingSha256 = String(button.dataset.dualReviewBindingSha256 || "");
      if (!recoveryId || !candidateSha256 || !dualReviewBindingSha256) return;
      if (!window.confirm(t("reconciliationRecoveryConfirmPrompt"))) return;
      state.reconciliationRecovery.submittingRecoveryId = recoveryId;
      renderReconciliationRecovery();
      try {
        const response = await fetch("/api/reconciliation-recovery-confirmations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recovery_id: recoveryId,
            candidate_sha256: candidateSha256,
            dual_review_binding_sha256: dualReviewBindingSha256,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || t("reconciliationRecoveryFailed"));
        showToast(t("reconciliationRecoverySuccess"), { duration: 9000 });
        await refreshReconciliationRecovery();
      } catch (error) {
        showToast(`${t("reconciliationRecoveryFailed")}: ${error.message}`, { duration: 12000 });
      } finally {
        state.reconciliationRecovery.submittingRecoveryId = null;
        renderReconciliationRecovery();
      }
    }

    async function refreshExecutionEvidence() {
      if (!state.auth.allowed) {
        renderExecutionEvidence();
        return;
      }
      try {
        state.executionEvidence.payload = normalizeExecutionEvidencePayload(await requestJson("/api/execution-evidence"));
      } catch {
        state.executionEvidence.payload = {
          data_status: "unavailable",
          computed_at: null,
          summary: { deployment_count: 0, autonomous_shadow: 0, autonomous_paper: 0, owner_canary_decision: 0, parked: 0 },
          deployments: [],
          policy: { execution_evidence_read_only: true, p6_owner_decision_required: true, limited_live_canary_active: false },
          errors: ["execution_evidence_request_failed"],
        };
      }
      renderExecutionEvidence();
    }

    async function refreshRuntimeTargetLifecycle() {
      if (!state.auth.allowed) {
        renderRuntimeTargetLifecycle();
        return;
      }
      try {
        state.runtimeTargetLifecycle.payload = normalizeRuntimeTargetLifecyclePayload(
          await requestJson("/api/runtime-target-lifecycle"),
        );
      } catch {
        state.runtimeTargetLifecycle.payload = {
          data_status: "unavailable",
          computed_at: null,
          summary: { target_count: 0, enabled: 0, disabled: 0, attention: 0 },
          targets: [],
          policy: { lifecycle_status_read_only: true, no_order: true },
          errors: ["runtime_target_lifecycle_request_failed"],
        };
      }
      renderRuntimeTargetLifecycle();
    }

    async function refreshResearchTasks() {
      if (!state.auth.allowed) {
        renderResearchTasks();
        return;
      }
      try {
        state.researchTasks.payload = normalizeResearchTaskPayload(await requestJson("/api/research-tasks"));
      } catch {
        state.researchTasks.payload = {
          data_status: "unavailable",
          computed_at: null,
          summary: { task_count: 0 },
          tasks: [],
          policy: { research_only: true, no_order: true, size_zero_required: true, p4_p5_p6_authorized: false },
          errors: ["research_task_request_failed"],
        };
      }
      renderResearchTasks();
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
      state.view = ["control", "health", "switch"].includes(button.dataset.view) ? button.dataset.view : "control";
      renderConsoleView();
      if (state.view === "control") {
        refreshControlPlane();
        refreshOwnerDecisions();
      }
      if (state.view === "health") {
        refreshHealth();
        refreshReconciliationRecovery();
        refreshM0Research();
        refreshAdaptiveSelection();
        refreshExecutionEvidence();
        refreshRuntimeTargetLifecycle();
        refreshResearchTasks();
      }
    }));

    document.querySelectorAll("[data-health-filter]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-health-filter]").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      state.health.filter = button.dataset.healthFilter;
      renderHealth();
    }));

    el("control-plane-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-owner-decision]");
      if (!button || button.disabled) return;
      recordOwnerDecision(button);
    });

    el("reconciliation-recovery-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-reconciliation-recovery-confirm]");
      if (!button || button.disabled) return;
      recordReconciliationRecoveryConfirmation(button);
    });

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
      if (!supportedExecutionModesForPlatform(state.selected).includes(button.dataset.mode)) return;
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
