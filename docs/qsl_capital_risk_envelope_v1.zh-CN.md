# QSL 资金风险信封 V1（设计）

> 状态：`LIBRARY_READY_PLATFORM_WIRING_IN_PROGRESS`
> 范围：账户/组合层仓位与回撤政策；不授权 live、不下单、不写券商。

## 实现状态（2026-09-07）

| 层 | 内容 | 状态 |
| --- | --- | --- |
| D0 | 本文 + 控制台三件套（偏好 / 资金档 / 状态灯）+ 晋级区布局 | **已合**（QRT #383、#384、#386） |
| D1 | QPK 纯函数 `equity → envelope`（`capital_risk_envelope`）+ 单测 | **已合**（QPK #576） |
| D2 | 注入对账权益到 `account_new_risk_gate`；超限只禁新风险 | **已合**（QPK #577）；见 [QPK account_new_risk_gate](https://github.com/QuantStrategyLab/QuantPlatformKit/blob/main/docs/account_new_risk_gate.zh-CN.md) |
| D3 | 多账户汇总视图共用信封 | 未做 |
| W1 | 平台仓接线（portfolio → 快照投影 → 门评估） | **进行中**（如 LongBridge `feat/account-new-risk-gate-w1`） |
| W2 | 只读探针（控制台展示 + 注入快照，无 live 副作用） | 进行中；控制台三件套已合，真账户读回仍待各平台 |
| W3 | 实盘 enable（生产默认开闸 + 人类 live 授权） | **未做** |

组合路径 A→B 见 [多策略组合 A→B V1](qsl_multi_strategy_combo_ab_v1.zh-CN.md)；QPK 合成证据见 `QuantPlatformKit/docs/synthetic_combo_evidence.zh-CN.md`（#578 已合）。

## 1. 人机分工（产品原则）

人工决策必须**重要且简单**；复杂计算、档位映射、降级与解释由量化系统与 AI 承担。

| 角色 | 只做这些 | 明确不做 |
| --- | --- | --- |
| **人** | 选一个风险偏好名；确认「跨档降级/升档」提示；复位熔断；首次启用杠杆产品 mandate | 调系数表、算波动目标、拼组合权重、解读双口径细节 |
| **量化系统** | 按权益落入资金信封；算 `capital_scale × vol_scale × dd_scale`、产品杠杆帽、回撤刹车；裁切策略目标；相关组 haircut；fail-closed | 因净值上涨静默升到更激进档；绕过 RiskEngine |
| **AI** | 用白话说明「你在哪一档、系统为何降仓、是否该点确认」；提出研究候选 | 改信封、提杠杆、授 live、复位熔断、改 BUY/SELL |

控制台默认只展示三件事：

1. 当前风险偏好（保全 / 均衡 / 增长）
2. 当前资金档（系统判定，只读）
3. 一个状态灯：正常 / 已降档 / 禁止新增风险

进阶数字（1.50× MDD、0.75 size、`capital_scale` / `vol_scale` / `dd_scale`）折叠在「详情」，避免把人推入双口径迷宫。

## 2. 在仓位栈中的位置

```text
策略目标权重
  × 晋级仓位档 0.50 / 0.75 / 1.00     （确认路径；≠ Composer 1.50）
  × 插件 scalar（≤1）
  × capital_scale × vol_scale × dd_scale   （本信封；各因子 ≤1，只可降不可静默升）
      → 可选组合预算 + 相关组 correlation haircut
      → 账户硬门 NEW_RISK_PROHIBITED
      → RiskEngine → 执行
```

`combined_scale = clamp(capital_scale × vol_scale × dd_scale, 0, 1)`。缺省观测时对应因子取 `1`（不假冒已风控），但权益缺失时状态灯为 `unknown`，不授新风险接线。

与已有双口径并存，第三人称「资金存活约束」：

| 口径 | 含义 | 谁选 |
| --- | --- | --- |
| Composer MDD 天花板 | 相对无杠杆基准 1.00 / 1.25 / 1.50 | 人的风险偏好名 |
| 晋级 size | 策略目标的 0.50 / 0.75 / 1.00 | 随偏好名，仅新晋级/材料变更 |
| **资金信封 `combined_scale`** | 权益档 × 波动目标 × 连续回撤降仓，并限制杠杆产品与硬刹车 | **系统按表计算**；人只在跨档策略变化时点确认 |

### 2.1 三个乘数（成熟系统轻量吸收）

| 因子 | 作用 | 规则 |
| --- | --- | --- |
| `capital_scale` | 按权益美元档封顶 | 见第 3 节表；升档禁止自动 |
| `vol_scale` | 轻量波动目标 | `min(1, target_vol / realized_vol)`；缺 realized 则 `1`；不把 HRP/RL 当主路径 |
| `dd_scale` | 硬停前连续降仓 | 回撤达刹车一半 → 约 `0.5`；达刹车 → `0` 且 `new_risk_allowed=false` |

另加（仍 ≤ 信封）：

- **美元风险预算**：与 % 回撤并存，尤其小账户（绝对破产距离短时更早禁新风险）。
- **相关组 haircut**：如 TQQQ+SOXL，成员预算之和不得突破信封允许的总风险袖；V1 不做共账户 allocator。

## 3. 资金分档（默认用美元绝对档）

个人实盘对「还能亏多少美元」比「占总资产比例」更直觉，故 V1 **主轴用权益美元档**；若账户声明了 `total_net_worth_usd`，可用其做只读提示，但不自动放宽信封（防自评净资产抬杠杆）。

示意表（阈值在接线前冻结为配置版本；下表为设计草稿）：

| 权益档 | 系统默认姿态 | `capital_scale` 上限 | 杠杆产品 | 回撤刹车（相对权益高点） |
| --- | --- | --- | --- | --- |
| `< 50_000` | 允许在增长偏好下更满仓 | ≤ 1.00 | 允许策略满配 3×ETF；融资须单独 mandate | ~12–15% → 禁新风险 |
| `50_000–250_000` | 偏均衡 | ≤ 0.85 | 3×ETF 权重封顶或强制部分换无杠杆基准袖 | ~10% → 禁新风险 |
| `250_000–1_000_000` | 偏保全 | ≤ 0.65 | 默认降低 3× 袖；新增杠杆须人确认 | ~7–8% → 禁新风险 |
| `> 1_000_000` | 保全 | ≤ 0.50 | 默认禁止新增杠杆敞口 | ~5% → 禁新风险 |

规则：

- **降档（更保守）**：可自动生效，控制台通知；AI 可解释原因。
- **升档（更激进）**：**禁止自动**；仅当权益回升且人确认，或人显式改风险偏好名。
- **迟滞**：升档阈值高于降档阈值，避免净值抖动来回切换。
- 小资金可进攻 ≠ 无硬顶：3×ETF 与融资仍受产品级杠杆帽；绝对破产距离短时系统应更早 `NEW_RISK_PROHIBITED`。

## 4. 与组合层的关系

资金信封是**账户/汇总权益**上的闸，组合不能绕过：

1. 单账户：先裁成员策略目标，再过信封与硬门。
2. 多账户「组合视图」：用汇总权益落入同一张表，再按账户 mandate 分配；仍一账户一 active writer。
3. 相关组（如 TQQQ+SOXL）：组合预算之和不得突破信封允许的总风险袖（correlation haircut）。
4. 共账户多策略 allocator：本 V1 **不做**。
5. 路径选择：**A 虚拟 combo 研究 → B 多账户汇总风险**（见 [多策略组合 A→B V1](qsl_multi_strategy_combo_ab_v1.zh-CN.md)）；暂不做 C 共账户 allocator。

## 5. AI 自动化边界

允许：

- 根据注入的权益/回撤摘要，生成「建议确认降档」或「保持」的短句；
- 在研究 HITL 里解释候选是否与当前信封冲突；
- 把复杂双口径翻译成一句话（例如：「大钱模式，系统已把仓位收到六成，并禁止新增风险」）。

禁止：

- 修改档位表、风险偏好、mandate；
- 提高 `capital_scale` / `vol_scale` / `dd_scale` 或杠杆帽；
- 把 Composer 通过写成 live 授权；
- 自动复位熔断。

## 6. 接线分期

### 6.1 库与设计（D0–D3）

| 期 | 内容 | 完成定义 | 状态 |
| --- | --- | --- | --- |
| D0 | 本文 + 控制台文案三件套（偏好 / 资金档 / 状态灯） | 人能看懂，无下单副作用 | **已合** |
| D1 | QPK 纯函数 `equity → envelope`（含 vol/dd）+ 单测 | 与晋级 sizing 组合的单元证明 | **已合** |
| D2 | 注入对账权益到账户新风险门；超限只禁新风险 | 无自动平仓、无复位 | **已合**（库）；平台读回见 W1/W2 |
| D3 | 多账户汇总视图共用信封 | 仍无共账户 allocator | 未做 |

### 6.2 平台接线（W1–W3）

| 期 | 内容 | 完成定义 | 状态 |
| --- | --- | --- | --- |
| W1 | 各平台仓把 portfolio/对账读回投影为 `InjectedReconciliationSnapshot` 并调用 `evaluate_new_risk_admission` | 单测 + 平台 CI；默认 fail-closed | **进行中** |
| W2 | 只读探针：控制台与诊断可展示信封档位/状态灯；`ACCOUNT_NEW_RISK_GATE=0` 仅测试 | 无下单、无 live 授权副作用 | 进行中（控制台已合；真账户探针待平台） |
| W3 | 生产默认启用账户门 + 明确人类 live/mandate 授权后才可新增风险 | 独立验收；不得绕过 `RiskEngine` | **未做** |

QPK 注入契约与 D2 边界：[account_new_risk_gate.zh-CN.md](https://github.com/QuantStrategyLab/QuantPlatformKit/blob/main/docs/account_new_risk_gate.zh-CN.md)。

## 7. 非目标

- HRP / RL allocator、均值方差 live 优化器、凯利公式主仓位、Bridgewater 式风险平价主路径；
- AI 自动升档/提杠杆、Composer 自动写生产政策；
- 用自评净资产或 AUM 增长静默提高进攻性；
- 替换 RiskEngine 或削弱 REJECT 零提交；
- 将旧实盘目标静默重算为新信封（先只读标注差异）。

## 8. 验收（设计层）

- 人在控制台不阅读 1.50 vs 1.00 详情也能完成：选偏好、确认降档、复位熔断。
- 系统在模拟权益跨档时：降档自动、升档需确认；AI 输出含原因且无可写权限字段。
- 文档明确：资金信封是仓位/风控栈的组成部分，与多策略组合研究共用同一账户闸。
