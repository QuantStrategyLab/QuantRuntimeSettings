# 规范命名注册表

[English](canonical-naming-registry.md)

状态：提议中。本文规定 QuantStrategyLab 的规范命名注册表、Draft 2020-12
Schema（[`qsl-canonical-naming-registry.v1.schema.json`](../schemas/qsl-canonical-naming-registry.v1.schema.json)）
以及纯叶子校验模块（[`naming_canonical/registry.js`](../web/strategy-switch-console/application/naming_canonical/registry.js)），
对应 Roadmap v2.0 第 14、16（`NAMING-CANONICAL`）与 17 项。本文仅定义命名规范与非破坏性别名映射，不授权任何改名、迁移、删除、部署、运行时行为修改或交易/下单权限。

文中示例均为合成值。既有历史账本哈希、Durable Object 键、KV 目录键与已签名回执通过
`legacy_aliases` 保持完全不变（`immutable_legacy_hashes: true`）。真实券商账号、凭证与私有存储定位符只保存在受保护配置中，不进入公开仓库。

相关规范：

- [GCP 资源命名规范](gcp-resource-naming-convention.zh-CN.md)（云资源名称与标签使用连字符，应用层机器 ID 按下文注册表格式执行）
- [ADR 0002：观测与身份边界](adr/0002-observation-and-identity-boundaries.md)（规则 R3：账号、实例、目标与展示名称严格分离）
- [策略插件契约 V2](qsl-strategy-plugin-contract-v2.zh-CN.md)（仅信号插件边界与 `P1`/`P2`/`P3` 摘要绑定）

## 通则

- 人类可读标签（`label_zh`、`label_en`）与不可变机器 ID 严格解耦；修改展示文案不会改变任何机器 ID、哈希或风险档位映射。
- 禁止在机器 ID、标签或别名中出现原始券商账号（如 `^U\d{5,}$`、`^DU\d{5,}$` 或 6 位及以上纯数字账号）以及不安全的私有存储定位符（`kv://`、`do://`、`https://`、本地路径、查询参数）。
- 通过非破坏性的 `legacy_aliases`（`resolveCanonicalAlias`）保留既有目录 ID 与历史哈希，不做就地改名。

## 1. 封闭平台短码

规范 Schema 仅允许以下五个注册平台短码：

| 短码 | 状态 | 展示名称（ZH / EN） | 遗留别名 |
| --- | --- | --- | --- |
| `schwab` | `active` | 嘉信理财 / Schwab | `charles-schwab`, `charles_schwab` |
| `firstrade` | `active` | 第一证券 / Firstrade | — |
| `ibkr` | `active` | 盈透证券 / IBKR | `interactive-brokers`, `interactive_brokers` |
| `longbridge` | `active` | 长桥证券 / LongBridge | `longport`, `lb` |
| `binance` | `dormant` | 币安 / Binance | — |

说明：

- 按 Item 17，`binance` 标记为 `dormant`（`HORIZON` 之后再评估）。
- 不包含任何活跃 A 股交易渠道（`cn_a_share`、`qmt` 不在封闭平台枚举内）。

## 2. 账号槽位元组

规范账号槽位采用三段元组 `{platform}:{env}:{slot}`：

- 格式约束：
  `^(schwab|firstrade|ibkr|longbridge|binance):(live|paper|research):[a-z0-9][a-z0-9_-]{0,31}$`
- 环境取值：`live`、`paper`、`research`。
- 合成示例：`ibkr:live:a1`~`ibkr:live:a4`、`longbridge:paper:pilot`、
  `longbridge:live:sg`、`longbridge:live:hk`、`schwab:live:main`、
  `firstrade:live:main`、`binance:live:dormant`、`binance:research:archive`。
- 拒绝原始券商账号以及缺少平台前缀且存在多平台歧义的裸键（如单独的 `live`）。

## 3. 策略画像 ID

规范策略 ID 采用四段小写字母数字 `{market}_{asset}_{family}_{horizon}`：

- 格式约束：`^(us|hk|global|crypto)_[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$`
- `version`（如 `v5`、`v7`）与 `risk_tier` 必须作为独立元数据字段存放，严禁拼接到 `strategy_id` 中（如 `us_soxl_trend_v2`、`tqqq_growth_income_v7_aggressive` 均会被拒绝）。
- 处置状态 `disposition`：`active_pilot`、`phase8_review`、`archived`。

核心与待评审策略映射示例（遗留 ID 在既有配置与账本中保持不变）：

| 规范 ID | 处置状态 | 遗留别名 |
| --- | --- | --- |
| `us_tqqq_trend_daily` | `active_pilot` | `tqqq_growth_income` |
| `us_soxl_trend_daily` | `active_pilot` | `soxl_soxx_trend_income` |
| `us_soxx_core_daily` | `active_pilot` | `soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve` |
| `global_etf_rot_weekly` | `phase8_review` | `global_etf_rotation` |
| `us_russell50_rot_weekly` | `phase8_review` | `russell_top50_leader_rotation` |
| `hk_etf_rot_weekly` | `phase8_review` | `hk_global_etf_tactical_rotation` |
| `hk_div_qual_daily` | `phase8_review` | `hk_low_vol_dividend_quality_snapshot` |
| `us_ibit_dca_weekly` | `phase8_review` | `ibit_smart_dca` |
| `crypto_btc_dca_weekly` | `phase8_review` | `crypto_btc_dca` |

遗留 `cn_equity` A 股策略已永久放弃/归档，不分配 `us|hk|global|crypto` 规范 ID。

## 4. 插件 ID 与能力分类

规范插件 ID 强制按能力前缀隔离：

- 格式约束：`^(obs|risk)_[a-z0-9]+(?:_[a-z0-9]+)*$`
- `obs_*`（只读观测器）：必须满足 `read_only: true`、`can_adjust_risk: false`、
  `can_bypass_fuse: false`，不得输出风险调节或 `> 1.0` 缩放因子。示例：
  `obs_advisor_scorecard`、`obs_event_radar`。
- `risk_*`（单向降险缩放）：仅允许单向降险缩放（`0 <= max_scalar <= 1.0`、
  `can_adjust_risk: true`、`can_bypass_fuse: false`）。示例：
  `risk_macro_governor`（对应遗留 `macro_risk_governor`）、
  `risk_regime_control`（对应遗留 `market_regime_control`）。
- 裸插件名（如无前缀的 `macro_risk_governor`）及 `can_bypass_fuse: true` 均会被 Schema 与校验器拒绝。

## 5. 1:1 风险档位双向映射

控制台风险档位与引擎风险档位严格 1:1 对应：

| 控制台档位 | 引擎档位 |
| --- | --- |
| `CAPITAL_PRESERVATION` | `conservative` |
| `BALANCED_COMPOUNDING` | `balanced` |
| `GROWTH_COMPOUNDING` | `aggressive` |

未知档位统一返回 `null`，不回退到任何默认数值策略。

## 6. 非破坏性演进原则

1. **新增契约（`SA-2..4`、`FUSE-3`、`BREADTH`）**自启用起即强制使用符合 [`qsl-canonical-naming-registry.v1.schema.json`](../schemas/qsl-canonical-naming-registry.v1.schema.json) 的规范命名。
2. **既有记录与历史哈希**保持原标识不变，消费方通过 `legacy_aliases` 衔接，不改写历史。
3. **旧名称退场与迁移**仅在独立的负责人批准计划（如 Phase 8.5）下执行。
