# QSL 通用长期风险观察件 V2

> 状态：`CORE_AND_EXACT_INGRESS_PORT_IMPLEMENTED_NO_RUNTIME_OR_POLICY_WRITE`

`python/scripts/long_horizon_risk_composer_v2.py` 是长期风险 Composer 的并行 v2 合约。它把三件本来不应混在一起的事分开：

```text
所有者/控制面选择的风险偏好
        +
策略、组合或插件候选的冻结 P3 风险能力与基准政策
        ↓
仅在数学假设被证据支持时给出脱敏建议；否则 PARKED
```

它是纯离线函数：没有账户、券商、资金、凭据、网络、对象存储、调度、风险政策写入或交易能力。v2 不替换 `qsl.long_horizon_risk_observation.v1`，也不改变现有 v1 对象、私有读取口或任何运行时配置。

`python/scripts/long_horizon_risk_observation_ingress_v2.py` 提供对应的受限私有读取口：它只接受调用方注入的 `read_exact`，按 `long-horizon-risk-observations/v2/<candidate-id>/<p3-evidence-sha256>.json` 读取一个不超过 2 MiB 的精确对象，并核验其 candidate 与 P3 摘要。它不会列举、猜测最新、重试另一对象、写入、覆盖或删除。profile selection 由控制面单独传入，不能从存储中发现或替换。当前没有实际云存储 adapter、运行身份或调度接线。

## 一个人工选择，所有候选复用

控制面保存可移植的 `qsl.risk_profile_selection.v1`，只有下列不可随候选历史反向拟合的字段：

| 字段 | 含义 |
| --- | --- |
| `profile_id` | 与偏好一一对应且带版本，例如 `balanced_compounding_v1` |
| `risk_preference` | `CAPITAL_PRESERVATION`、`BALANCED_COMPOUNDING` 或 `GROWTH_COMPOUNDING` |
| `selection_sha256` | 防止把同一名称偷换为另一档位 |

这个工件不包含账户、平台、资金或 live 授权。控制面在账户或组合层保存“哪个范围使用哪个 selection digest”；候选的 P3 观察件只读取该 digest 对应的偏好。策略、插件、平台适配器不能创建、变更或放宽 profile。

## V2 私有观察件

`qsl.long_horizon_risk_observation.v2` 继续绑定 candidate 和 P1/P2/P3/plugin 摘要、成对净收益路径及哈希，但将 v1 的单一基准描述展开为两份冻结声明。

### `risk_capability`

| 字段 | 允许值 | 作用 |
| --- | --- | --- |
| `portfolio_scope` | `SINGLE_CANDIDATE` / `PORTFOLIO` | 区分单策略和必须组合级处理的候选 |
| `return_evaluation` | `LINEAR_NET_RETURN` / `REPLAY_REQUIRED` | 明确收益是否可以随尺度线性重放 |
| `cashflow_treatment` | `NOT_APPLICABLE` / `TIME_WEIGHTED` / `CASHFLOW_MATCHED` | 防止 DCA 充值、提款混入风险收益路径 |
| `risk_factor_coverage` | 有序、去重的风险因子集合 | 声明 P3 已覆盖的集中度、流动性、杠杆、跳空、保证金、相关性等因素 |

组合候选必须声明 `PORTFOLIO` 且覆盖 `CORRELATION`。这不会自动证明相关性计算正确；P1/P2/P3 的摘要仍是可重放证据的绑定点。

### `benchmark_policy`

基准政策绑定 `benchmark_id`、类型、交易日历、币种、收益口径、预登记定义摘要与年度 session 数。它支持以下预留类别：

- `UNLEVERED_REFERENCE`：SOXL/SOXX、TQQQ/QQQ 等方向性候选；
- `POLICY_BLEND`：轮动或多资产组合的预登记混合基准；
- `CASH_EQUIVALENT` 与 `ABSOLUTE_RETURN_HURDLE`：市场中性/绝对收益候选。

这使基准的选择可审计，不能因为某个候选回测表现更好而临时换为有利基准。

## 当前可组合范围与闭合行为

v2 复用已验证的 v1 计算器，**仅**在以下范围输出 `ADVISORY_RECOMMENDATION_READY`：

1. `SINGLE_CANDIDATE`；
2. `LINEAR_NET_RETURN`；
3. `NOT_APPLICABLE` 现金流处理；
4. `UNLEVERED_REFERENCE` 与 `TOTAL_RETURN_NET_OF_COST` 基准。

这正好适合经 P3 路径验证的单策略方向性 ETF 候选。算法仍使用配对路径回撤上限和等权 walk-forward/bootstrap/stress 证据家族。

其它类别已经能用同一 schema 表达，但在专用 Composer 实现前必须返回 `PARKED`：

| 声明的情况 | 固定原因码 | 为什么不能暂时套用线性计算 |
| --- | --- | --- |
| 非线性仓位、期权或动态波动率控制 | `RETURN_SCALE_REPLAY_REQUIRED` | 每个风险尺度必须重放 P3，而非直接缩放收益率 |
| 多策略组合 | `PORTFOLIO_COMPOSER_REQUIRED` | 必须重算相关性、边际风险贡献和组合净收益 |
| DCA 或外部现金流 | `CASHFLOW_COMPOSER_REQUIRED` | 必须使用现金流匹配、时间一致的路径 |
| 混合、现金或绝对收益基准 | `BENCHMARK_POLICY_COMPOSER_REQUIRED` | 不能伪装为权益无杠杆基准 |
| 非净成本总收益基准口径 | `BENCHMARK_RETURN_BASIS_COMPOSER_REQUIRED` | 当前回撤比较不具可比性 |

`PARKED` 没有尺度、最大回撤或前沿；它不是失败后的默认继续运行，更不能触发实盘动作。

## 插件和平台的边界

- 观察/信号插件没有独立收益路径，不能提交 v2 观察件或获得风险建议。
- 改变下单、再平衡或持仓收益的插件，必须成为“策略 + plugin bundle”的新候选，并重新完成 P1/P2/P3。
- 平台只消费已签名、已批准的下游政策；它可以因为流动性、风控或健康原因进一步降风险，但不能更改 profile、基准或扩大尺度。
- 任何平台、账户或策略迁移前都要先完成自己的 P3 生产器和私有 ingress。不得用 SOXL 结果替代 TQQQ、组合、DCA 或插件候选。

## 迁移顺序

1. 维持 v1 运行，先让单策略 P3 生产器可同时构造并验证 v2 观察件；
2. 接入方向性单策略的 v2 建议，比较其与 v1 脱敏输出，仍只做建议；
3. 实现组合、现金流和重放型专用 Composer，并以新的 P3 数据生产器逐类接入；
4. 单独实现受限私有读取、政策作者和批准链路。风险建议永远不能直接进入 P4/P5/P6。

任何扩大尺度、改变 profile、基准、风险能力声明或 P3 路径的操作都必须产生新的 candidate/P1/P2/P3 绑定和独立批准；新证据退化时系统只可降尺度或 `PARKED`。
