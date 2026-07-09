# QuantStrategyLab 完善路线图

> **给 Codex CLI 执行的任务清单。** 每个任务独立、可验证、有明确的完成标准。
> 按优先级排列。每完成一个任务，提交 PR、合并、清理分支。

---

## ⚙️ 最终架构：Codex 为主，双 API 兜底

```
┌─ 日常运行层（Codex — 主力）───┐    ┌─ 兜底层（第二个 API 调用）──┐
│                                │    │                              │
│ VPS codex-quant.service 监控   │    │ Codex 置信度 < 0.8 时触发    │
│ CI Codex Review Gate 审查 PR   │    │ AIAuditBridge 发起独立调用    │
│ GitHub App connector 触发任务  │    │ 不同 prompt，互不知情         │
│ Telegram「量化哨兵」bot 通知   │    │ 一致 → 通过  分歧 → Issue @你 │
│                                │    │                              │
│ ▲ 90% 的活 Codex 自己干了      │    │ ▲ 只在关键决策时触发         │
└────────────────────────────────┘    └──────────────────────────────┘
```

**角色分工**：
- **Codex**：运行时主力——监控、审查、部署、审计、Telegram 通知
- **第二个 API 调用**：兜底——Codex 不确定时才出场，不是日常流程
- **AIAuditBridge**：调度器——Codex 置信度 < 0.8 → 调第二个 API → 比较 → 分歧才通知你
- **你**：只在 Telegram 报警响、或 GitHub Issue @你的时候看一眼。其他时间系统自己转

---

## 📡 通知体系

### Telegram「量化哨兵」bot

**名字**：`量化哨兵 QuantSentinel`

> 哨兵 = 站岗、望风、发现异常就吹号。这个 bot 干的就是这事。

**职责**：插件人工复核 + 收盘汇总 + 异常报警。三合一，一个 bot 一个 chat。

| 通知类型 | 触发时机 | 频率 | 你会做啥 |
|---|---|---|---|
| 策略交易/报错 | 下单执行 or 异常 | 仅交易或报错时 | 报错就看一眼 |
| 收盘一句话 | 交易日收盘后 | 每天一条 | 扫一眼 |
| 熔断/止损/大偏离 | 实时触发 | 很少 | 收到就看，复制给 AI 问 |
| 插件人工复核 | 插件信号需要确认 | 偶尔 | 确认或拒绝 |

```
「量化哨兵」bot — 同一个 chat 收到的消息示例：

📊 07-08 收盘：全市场正常
   cn_industry ✅  cn_dividend ✅  us_global ✅  crypto_btc ✅
   组合 +0.18%

🚨 cn_chinext_tactical 熔断：连续亏损 6 笔，已自动停单
   需要你决定：继续观察 or 手动平仓

⚠️ 插件复核：market_regime_control 建议降仓至 50%
   回复 /approve 或 /reject
```

### GitHub Issue

| 通知类型 | 触发 | 会 @ 你吗 |
|---|---|---|
| 月度 thesis 验证通过/失败 | 每月 1 号 | 失败的 @你，通过的不 @ |
| 策略上线双审查通过 | 策略 promotion | 分歧时 @你，一致通过不 @ |
| DriftDetector 偏离 > 3σ | 每日检查 | @你 |
| Codex Review Gate 失败 | 每次 PR | @提交 PR 的人 |

---

## 前置：AGENTS.md 已生效

`~/Projects/AGENTS.md` 已包含硬性风控规则。Codex 进入 Projects 目录后自动加载。
执行以下任务时，AI 助手会自动遵守回测规范、风控门、仓位限制等约束。

---

## 任务 1：所有策略入口接入风控门（预计 30 分钟）

**当前状态**：已完成（四策略仓 entrypoints 已统一走 QPK `apply_risk_gate()`）

**目标**：20 个策略入口点全部调用 `apply_risk_gate()`，风控覆盖从 5% → 100%

**背景**：QPK `risk/engine.py` 的 RiskEngine 已实现但从未被策略调用。`CnEquityStrategies/entrypoints/_common.py` 的 `apply_risk_gate()` 是轻量级风控门（检查总仓位、持仓数、可配置集中度）。目前只有 1/20 入口接入。

### 1a. CnEquityStrategies（7 个入口待接入）

**文件**：`CnEquityStrategies/src/cn_equity_strategies/entrypoints/__init__.py`

参考已完成的 `evaluate_cn_industry_etf_rotation` 的写法：
```python
# 原来：
return StrategyDecision(positions=weights_to_positions(weights), risk_flags=risk_flags, diagnostics=diagnostics)

# 改成：
decision = StrategyDecision(positions=weights_to_positions(weights), risk_flags=risk_flags, diagnostics=diagnostics)
return apply_risk_gate(decision)
```

待修改的函数（都在同一个文件里）：
- `evaluate_cn_industry_etf_rotation_aggressive`
- `evaluate_cn_index_etf_tactical_rotation`
- `evaluate_cn_chinext_tactical_rotation`
- `evaluate_cn_chinext_growth_momentum_quality`
- `evaluate_cn_chinext_growth_momentum_quality_snapshot`
- `evaluate_cn_star_growth_momentum_quality`
- `evaluate_cn_dividend_quality_snapshot`

**参数**：全部用默认参数（ETF 轮动策略不需要集中度限制）

**验收**：`pytest tests/test_entrypoints.py -q` 全部通过

### 1b. HkEquityStrategies（3 个入口待接入）

**文件**：`HkEquityStrategies/src/hk_equity_strategies/entrypoints/__init__.py`

同样模式。先检查 `_common.py` 是否有 `apply_risk_gate`，如果没有就从 CnEquity 拷贝过去。

**验收**：`pytest tests/ -q` 全部通过

### 1c. UsEquityStrategies（约 10 个入口）

**文件**：`UsEquityStrategies/src/us_equity_strategies/entrypoints/__init__.py`

对个股/杠杆 ETF 策略传 `max_single_weight=0.20`。部分入口可能已有风控门，逐个确认。

**验收**：`pytest tests/ -q` 全部通过

### 1d. CryptoStrategies（约 4 个入口）

**文件**：`CryptoStrategies/src/crypto_strategies/entrypoints/__init__.py`

BTC/ETH 策略 `max_single_weight=0.50`，轮动策略 `max_single_weight=0.30`。

**验收**：`pytest tests/ -q` 全部通过

---

## 任务 2：消灭 RegimeContext 命名冲突（预计 20 分钟）

**当前状态**：已完成（QPK [#195](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/195)：`MarketRegimeResult` + `to_risk_context()`）

**目标**：`risk/contracts.py` 和 `strategy_lifecycle/market_regime.py` 的 `RegimeContext` 统一

**文件**：`QuantPlatformKit/src/quant_platform_kit/strategy_lifecycle/market_regime.py`

方案：
1. 把 `market_regime.RegimeContext` 重命名为 `MarketRegimeResult`
2. 添加 `to_risk_context()` 方法兼容新的 `risk.contracts.RegimeContext`
3. 更新 `strategy_lifecycle/` 下所有引用

**验收**：
- `pytest tests/ -q` 全部通过
- `grep -r "from.*market_regime.*import.*RegimeContext" src/` 返回空

---

## 任务 3：构建 BacktestOrchestrator 统一回测框架（预计 1-2 小时）

**当前状态**：基本完成（四策略仓统一 `scripts/run_walk_forward_backtest.py` + orchestrator runner 已合并；复杂 `research_*` ad-hoc 脚本未迁移）

**目标**：消除 4 个仓库的 ad-hoc 回测脚本，所有策略通过同一接口回测

### 3a. 在 QPK 中创建接口

**新文件**：`QuantPlatformKit/src/quant_platform_kit/backtest/orchestrator.py`

```python
class BacktestOrchestrator:
    def run(self, entrypoint, data, *, start, end, ...) -> BacktestResult
    def walk_forward(self, entrypoint, data, *, windows, ...) -> list[BacktestResult]
    def sensitivity(self, entrypoint, data, *, param_ranges, ...) -> SensitivityReport
```

**验收**：单测覆盖 `run()` 和 `walk_forward()` 基本路径

### 3b. 试点迁移

选 `cn_index_etf_tactical_rotation` 试点，用 `BacktestOrchestrator.walk_forward()` 重写回测，确认新旧结果在 ±0.1% 以内。

### 3c. 推广

试点成功后逐个仓库迁移。

---

## 任务 4：证据包 CI 门禁（预计 30 分钟）

**当前状态**：已完成（四策略仓 `.github/workflows/evidence-gate.yml` 已进 main）

**目标**：策略 `status` 改到 `shadow_candidate` 或以上时，CI 自动检查 11 个必需文件

**新文件**：每个策略 repo 的 `.github/workflows/evidence-gate.yml`

逻辑：
1. PR 修改了 manifest 中的 `status` 字段（从 `research` → `shadow`/`live`）
2. 检查策略目录下是否存在 11 个必需文件（参考 `docs/strategy_promotion_risk_standard.zh-CN.md`）
3. 缺失则列出清单并阻塞合并

**参考**：`CnEquityStrategies/.github/workflows/codex_review_gate.yml` 的结构

---

## 任务 5：接入 DriftDetector + PerformanceMonitor（预计 1 小时）

**当前状态**：基本完成（QPK [#204](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/204) `live_return_collector` 已合并；六平台 telemetry 含 `total_equity`；四策略仓 drift-check + entrypoint 已接线）

**目标**：策略运行时有 Alpha 衰减检测，CI 每日检查性能偏离

### 5a. 各策略入口接入

在每个 entrypoint 中记录决策和结果：
```python
from quant_platform_kit.strategy_lifecycle.performance_monitor import PerformanceMonitor
monitor.record(profile_id, decision, execution_result)
```

### 5b. 每日漂移检测 CI

**新文件**：每个策略 repo 的 `.github/workflows/drift-check.yml`
- cron 每日触发
- `DriftDetector` 对比近期表现和回测基线
- 偏离 > 2σ → GitHub Issue（不 @你）
- 偏离 > 3σ → GitHub Issue（**@你**）

---

## 任务 6：Kelly 仓位计算器（预计 30 分钟）

**当前状态**：已完成（QPK [#193](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/193)：`position_sizing.py` + 单测）

**目标**：统一的仓位计算公式

**新文件**：`QuantPlatformKit/src/quant_platform_kit/position_sizing.py`

```python
@dataclass
class KellyResult:
    win_rate: float
    avg_win: float
    avg_loss: float
    kelly_fraction: float
    half_kelly: float        # 建议上限
    max_position_pct: float

def estimate_kelly(returns: list[float]) -> KellyResult: ...
```

**验收**：单测覆盖全胜、全败、盈亏相当等边界情况

---

## 任务 7：VPS 监控完善（预计 30 分钟）

**当前状态**：已完成并已二次验真（2026-07-09：qvps `AIAuditBridge` 已 sync 到 `cd7f140`，`codex-quant.timer` 每 30 分钟 OK；修复 `GLOBAL_TELEGRAM_CHAT_ID` 污染）

**目标**：VPS Codex 定时检查策略健康度，通过「量化哨兵」bot 报警

### 7a. 完善监控提示词

**文件**：VPS `~/Projects/quant-monitor/AGENTS.md`

每 30 分钟：
1. `gh` CLI 拉取各策略 repo 最新 main
2. `quant-lifecycle dashboard --format summary`
3. `strategy_health_score` < 60 → Telegram「量化哨兵」bot 报警
4. `drift_detector` > 2σ → Issue；> 3σ → Issue **@你**

### 7b. 通知集成

VPS `quant-monitor` 通过 GCP Secret Manager 加载量化哨兵凭证（**不要**手填 `.env`）：

| 变量 | 来源 |
|------|------|
| `TELEGRAM_TOKEN` | GCP `quant-sentinel-telegram-bot-token`（`load_telegram_env.sh`） |
| `GLOBAL_TELEGRAM_CHAT_ID` | `5992562050`（org repo variable） |

`systemd` 使用 `ExecStartPre=load_telegram_env.sh`；脚本调 QPK `notifications/telegram.py` 发送。

旧名 `crisis-alert-telegram-bot-token` 已弃用。真源见 `QuantRuntimeSettings/platform-config.json` → `notifications.quant_sentinel`。

---

## 任务 8：硬止损逻辑（grid-trading-skill 交叉分析发现）

**当前状态**：已完成（四策略仓已接入 `apply_risk_gate()`，并上报 `unrealized_pnl_pct` / `consecutive_losses`）

**来源**：对比 `grid-trading-skill` 的 `RiskChecker`（6 条风控规则）发现 QSL 策略严重缺失

**问题**：只有 CryptoStrategies 有 ATR 追踪止损，其余 3 个仓库零硬止损。

### 8a. 给 QPK 风控门添加止损检查

**文件**：`QuantPlatformKit/src/quant_platform_kit/risk/engine.py`

在 `apply_risk_gate()` 中新增检查：
- `unrealized_pnl / portfolio_value < -20%` → REJECT（强制平仓）
- 连续亏损 > 5 笔 → 熔断（发送「量化哨兵」报警）

### 8b. 策略入口上报 PnL

在 `StrategyDecision.diagnostics` 中新增字段：
- `unrealized_pnl_pct: float`
- `consecutive_losses: int`

**验收**：`grep -r "unrealized_pnl_pct"` 在所有策略 repo 的 entrypoints 中都能找到

---

## 任务 9：策略 Thesis Ledger（fadacai-portfolio 交叉分析发现）

**当前状态**：已完成（四策略仓 `docs/thesis-ledger.json` + `thesis-check.yml` 已进 main）

**来源**：fadacai 的 `thesis_ledger.py` + 第一性原理纪律

**目标**：每个线上策略有可追溯的 thesis、证伪条件、验证记录

### 9a. 创建 Thesis Ledger

**新文件**：每个策略 repo 的 `docs/thesis-ledger.json`

```json
{
  "strategies": {
    "cn_industry_etf_rotation": {
      "thesis": "A股行业ETF存在月度动量效应，排名前5的行业下月超额收益显著",
      "falsification_conditions": [
        "滚动12个月 IC < 0.02",
        "沪深300上涨月份策略超额为负",
        "前5行业下月平均收益 < 等权基准连续3个月"
      ],
      "created": "2025-08-01",
      "last_verified": "2026-06-30",
      "verdict": "active",
      "hit_rate": 0.68
    }
  }
}
```

**验收**：每个线上策略至少 1 条 thesis + 2 条证伪条件

### 9b. 月度 Thesis 验证 CI

**新文件**：`.github/workflows/thesis-check.yml`
- 每月 1 号自动运行
- 证伪条件触发 → GitHub Issue（@你），建议降级或下线
- hit_rate < 50% → GitHub Issue（不 @，月度审阅时看）

---

## 任务 10：每日策略报告（AI 内部消费，不通知人）

**当前状态**：已完成（VPS `daily_briefing.sh` + AIAuditBridge `consume_daily_briefing.py --dispatch` 已接线）

**来源**：fadacai 的 `briefing_runner.sh` + `send_briefing.py`

**目标**：VPS 每天收盘后生成策略报告 → AIAuditBridge 自动检查 → 只在异常时通知人

**原则**：日报是给 AI 看的，不是给人看的。人的注意力只留给需要决策的事。

### 10a. 创建报告生成脚本

**新文件**：VPS `~/Projects/quant-monitor/daily_briefing.sh`

```bash
#!/bin/bash
# 各市场收盘后执行
# 1. 跑 quant-lifecycle dashboard --domain <市场>
# 2. Codex exec 生成结构化报告（JSON）
# 3. 写入 data/daily-reports/YYYY-MM-DD/<market>.json
# 4. AIAuditBridge 自动消费检查
```

### 10b. AIAuditBridge 自动检查逻辑

```
读取日报 JSON → briefing_consumer 分级
  ├── 全部正常 → quiet（不通知人）
  ├── 偏离 ~2σ / review → github_issue（不 @人）
  └── 偏离 >3σ / 熔断 / critical → telegram（量化哨兵）

consume_daily_briefing.py --dispatch 执行派发
```

**验收**：手动放一份 critical 日报，`--dispatch` 后 Telegram 收到报警

---

## 任务 11：兜底双审查（fadacai 交叉分析发现）

**当前状态**：已完成（AIAuditBridge dual-review 调度、dispatch、orchestrator、测试与 PR 已合并到 `main`）

**来源**：fadacai 的独立第一性分析——两个独立 API 调用对比找真实共识

**目标**：关键决策有第二意见兜底

### 11a. AIAuditBridge 调度

**触发条件**（三个场景）：
1. 策略 promotion：`shadow_candidate` → `live_candidate`
2. 策略连续 3 个月 hit_rate < 60%
3. DriftDetector 偏离 > 3σ

**流程**（方案 B：三审 unanimous）：
```
Codex 主审 → 置信度 ≥ 0.8 → 直接通过
           → 置信度 < 0.8 → 并行 GPT API + Claude API（互不知情）
           → 三方 verdict 一致 → 通过/拒绝
           → 任一方分歧 → GitHub Issue @你
```

**验收**：创建测试场景，确认 AIAuditBridge 正确调度并比较

---

## 任务 12：模型分层路由（fadacai 交叉分析发现）

**当前状态**：部分完成（AIAuditBridge `service/model_router.py` 已落地并用于 dual-review/briefing；VPS `codex exec` 路径尚未统一接入）

**来源**：fadacai 按任务复杂度路由到不同模型

**目标**：省钱——不是所有 Codex 任务都需要 gpt-5.5 + xhigh effort

| 任务 | 模型 | effort |
|---|---|---|
| 数据拉取、pipeline 调度 | gpt-4.1-mini | low |
| 日度监控简报 | gpt-4.1-nano | medium |
| 参数优化建议 | gpt-5.5 | medium |
| 策略上线双审查 | gpt-5.5 | xhigh（仅此场景） |

---

## 通知总览

```
你收到通知的场景（只有需要你决策的事）：

Telegram「量化哨兵」bot：
  ├── 🚨 熔断/止损/大偏离（> 3σ）→ 看一眼，复制给 AI 问
  └── ⚠️ 插件人工复核 → 确认/拒绝

GitHub Issue：
  ├── @你：双审查分歧、证伪触发、偏离 > 3σ → 需要你拍板
  └── 不 @：月度报告、常规 Issue → 有空再看

AI 内部消费（不通知你）：
  ├── 📊 每日策略报告 → AIAuditBridge 自动检查
  ├── 偏离 1-2σ → GitHub Issue（不 @）→ AI 自动分析
  └── 策略正常运行 → 安静，什么都不发
```

> 每日策略报告是给 AI 看的，不是给你看的。AI 消费报告 → 自动检查 → 只在异常时叫你。

---

## 技能交叉分析来源

| 技能/框架 | 发现了什么 | 对应任务 |
|---|---|---|
| **grid-trading-skill** RiskChecker | 6 条硬止损规则，QSL 仅 Crypto 有 | 任务 8 |
| **fadacai-portfolio** thesis_ledger | 第一性原理纪律、证伪条件 | 任务 9 |
| **fadacai-portfolio** briefing_runner | 每日简报 + 交易日历 | 任务 10 |
| **fadacai-portfolio** 独立第一性分析 | 双 API 独立审查兜底 | 任务 11 |
| **fadacai-portfolio** 模型路由 | 按任务复杂度分层用模型 | 任务 12 |
| **MetaHarness** agent pipeline | signal → risk-checker → executor | 任务 1、3 |
| **stock-scanner-mcp** | 65 工具，简报中使用 | 任务 10 |

---

## 量化哨兵通知架构（QuantSentinel）

```
GitHub org secrets.TG_TOKEN
        ↓ (CI → Cloud Run env sync)
GCP Secret quant-sentinel-telegram-bot-token  ← 各平台 GCP 项目副本
        ↓
┌───────────────────────┬────────────────────────────┐
│ Cloud Run 策略平台     │ VPS quant-monitor           │
│ TELEGRAM_TOKEN (ref)  │ ExecStartPre load_telegram  │
│ GLOBAL_TELEGRAM_CHAT_ID│ GLOBAL_TELEGRAM_CHAT_ID    │
└───────────────────────┴────────────────────────────┘
        ↓
   同一 Telegram chat（5992562050）

插件告警：STRATEGY_PLUGIN_ALERT_TELEGRAM_BOT_TOKEN → 同一 secret 名
平台日报：各平台 *-telegram-token（独立 bot，非哨兵）
```

| 组件 | Token secret | Chat ID |
|------|--------------|---------|
| 量化哨兵（监控/简报/插件告警） | `quant-sentinel-telegram-bot-token` | `GLOBAL_TELEGRAM_CHAT_ID` |
| 平台执行日报（IBKR 等） | `{platform}-telegram-token` | `GLOBAL_TELEGRAM_CHAT_ID` |

---

## 参考：已完成的改动

| 日期 | 改动 | 状态 |
|---|---|---|
| 2026-07-08 | CnEquityStrategies: apply_risk_gate() + 可配置门限 | PR #37 已合并 |
| 2026-07-08 | IBKRGatewayManager: diagnose + capture-screen 迁多网关 | PR #88 已合并 |
| 2026-07-09 | 5 平台 repo: secret 引用改 org 级 TG_TOKEN | 已全部合并 |
| 2026-07-08 | ~/Projects/AGENTS.md + CLAUDE.md + QUANT_ROADMAP.md | 已生效 |
| 2026-07-08 | 安装 stock-scanner/crypto-quant-signal/grid-trading/vectorbt/OpenMobius | 已安装 |
| 2026-07-08 | VPS qvps 部署 codex-quant systemd 服务 | 运行中 |
| 2026-07-08 | 清理 5 个空壳仓库 | 已删除 |
| 2026-07-08 | MetaHarness / fadacai-portfolio 参考框架 | 已克隆 |
| 2026-07-09 | AIAuditBridge dual-review wiring (task 11) | [#33](https://github.com/QuantStrategyLab/AIAuditBridge/pull/33) 已合并 |
| 2026-07-09 | Telegram 实发验证 + GCP secret 同步 workflow | `quant_lsy_bot` dispatch OK；AAB sync workflow |
| 2026-07-09 | QuantRuntimeSettings `notifications.quant_sentinel` | [#176](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/176) 已合并 |
| 2026-07-09 | AIAuditBridge briefing dispatch（Telegram/GitHub） | [#31](https://github.com/QuantStrategyLab/AIAuditBridge/pull/31) 已合并 |
| 2026-07-09 | 量化哨兵 GCP secret 重命名 + VPS gcloud 接线 | `quant-sentinel-telegram-bot-token` |
| 2026-07-09 | AIAuditBridge briefing consumer | [#30](https://github.com/QuantStrategyLab/AIAuditBridge/pull/30) 已合并 |
| 2026-07-08 | Telegram「量化哨兵」bot 配置 | Org secret TG_TOKEN + GCP sentinel secret |
| 2026-07-09 | 任务 8：硬止损逻辑 | 四策略仓 PR 已合并（Cn #44 / Hk #77 / Us #216 / Crypto #70） |
| 2026-07-09 | 任务 9：Thesis Ledger | 四策略仓 + CI 已合并 |
| 2026-07-09 | 任务 10：每日策略报告 | VPS briefing pipeline + AIAuditBridge dispatch 已合并 |
| 2026-07-09 | 任务 11：兜底双审查 | AIAuditBridge wiring / dispatch / pipeline / tests 已合并 |
| 2026-07-09 | 依赖管理闭环 | QPK/QRS/四策略/四平台/Binance pin 对齐与 CI 门禁已合并 |
| 2026-07-09 | Binance pyproject/uv 迁移 | [#110](https://github.com/QuantStrategyLab/BinancePlatform/pull/110) 已合并 |
| 2026-07-09 | QPK 跨仓 pin PR 自动化 | [#203](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/203) 已合并；org secret `QSL_REPO_SYNC_TOKEN` 已配置 |
| 2026-07-09 | VPS quant-monitor 二次验真 | qvps sync `cd7f140` + timer 健康检查通过 |
| 2026-07-09 | 任务 3c：BacktestOrchestrator 推广 | 四策略仓 PR 已合并（Cn [#46](https://github.com/QuantStrategyLab/CnEquityStrategies/pull/46) / Hk [#79](https://github.com/QuantStrategyLab/HkEquityStrategies/pull/79) / Us [#218](https://github.com/QuantStrategyLab/UsEquityStrategies/pull/218) / Crypto [#72](https://github.com/QuantStrategyLab/CryptoStrategies/pull/72)） |
| 2026-07-09 | 任务 5：PerformanceMonitor 全链路 | QPK [#204](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/204) + 平台 equity telemetry（LB [#313](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/313) / Schwab [#253](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/253) / Firstrade [#214](https://github.com/QuantStrategyLab/FirstradePlatform/pull/214) / IBKR [#320](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/pull/320)）已合并 |
| 2026-07-09 | QPK_PIN 手动 bump + 下游对齐 | QPK [#205](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/205) → `53b2ca73`；九仓 pin PR 已合并（Cn [#47](https://github.com/QuantStrategyLab/CnEquityStrategies/pull/47) / Hk [#80](https://github.com/QuantStrategyLab/HkEquityStrategies/pull/80) / Us [#219](https://github.com/QuantStrategyLab/UsEquityStrategies/pull/219) / Crypto [#73](https://github.com/QuantStrategyLab/CryptoStrategies/pull/73) / IBKR [#321](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/pull/321) / LB [#314](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/314) / Schwab [#254](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/254) / Firstrade [#215](https://github.com/QuantStrategyLab/FirstradePlatform/pull/215) / Binance [#111](https://github.com/QuantStrategyLab/BinancePlatform/pull/111)） |
| 2026-07-10 | VPS `codex-daily-briefing` 验真 | timer active；手动触发成功，四域 JSON 写入 `daily-reports/2026-07-09/`，dispatch=`quiet` |
| 2026-07-10 | QPK 下游 pin 自动化 token | `QSL_REPO_SYNC_TOKEN` 存为 **QuantPlatformKit 仓库级 secret**；workflow 验真九仓 `no changes needed` |

## 当前真实待办（2026-07-10 凌晨）

| 项目 | 状态 | 说明 |
|---|---|---|
| 任务 12：模型分层路由 | 部分完成 / 暂缓 | AIAuditBridge 已路由；Codex 未恢复前不做 VPS/CI gateway 收口 |
| 任务 1–11 / 3c / 5 / Binance / pin 对齐 / VPS 验真 / briefing / sync token | 已完成 | 见上文各任务「当前状态」与已完成改动表 |
| 复杂 research 回测脚本迁移 | 可选 | combo / dividend snapshot / DCA 等仍用 ad-hoc 脚本，非阻塞 |
| `QSL_REPO_SYNC_TOKEN` 轮换 | 可选 | 当前为 bootstrap token；见 QPK `docs/qpk_repo_sync_auth.zh-CN.md` 换专用 fine-grained PAT |

---

> 🤖 本文档给 **Codex CLI** 执行。每个任务独立可验证。按 1→12 顺序，从任务 1a 开始。
> 通知统一走「量化哨兵 QuantSentinel」Telegram bot + GitHub Issue。
