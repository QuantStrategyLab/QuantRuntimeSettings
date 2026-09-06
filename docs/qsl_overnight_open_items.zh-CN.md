# QSL 隔夜残留清单（只读盘点）

> 盘点日：2026-09-07。不部署、不授 live、不自动合并有争议 PR。

## 1. qsl-20260906 代码修复是否仍全合（抽样）

| 仓 | PR | 标题 | main 状态 |
| --- | --- | --- | --- |
| QuantRuntimeSettings | #371 | fix(ci): pass workflow_run branch via env for Dependabot merge | **已合** |
| QuantRuntimeSettings | #370 | fix: clarify dependency snapshot comparison semantics | **已合** |
| QuantPlatformKit | #553 | fix(ci): keep immutable workflow refs independent of package pins | **已合** |
| LongBridgePlatform | #437 | fix(risk): keep REJECT/no_execute from cash-substitution sells | **已合** |

结论：抽样 2–3 仓关键修复均在 `main`，未见回退。

## 2. 打开 pin / 治理 PR（建议）

### QuantRuntimeSettings

| PR | 标题 | 建议 |
| --- | --- | --- |
| [#357](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/357) | feat(control): add immutable promotion manifest verifier | **review → merge**（治理增强；合前人工过 manifest 绑定语义） |

### QuantPlatformKit

| PR | 标题 | 建议 |
| --- | --- | --- |
| [#561](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/561) | chore(deps): reconcile coherent QSL pin bundle | **merge**（pin 收敛；待全下游 CI 绿） |
| [#551](https://github.com/QuantStrategyLab/QuantPlatformKit/pull/551) | feat(cloud): add optional atomic document ownership operations | **review → merge**（可选 cloud 能力；CI 已绿，非资金路径） |

### LongBridgePlatform

| PR | 标题 | 建议 |
| --- | --- | --- |
| [#440](https://github.com/QuantStrategyLab/LongBridgePlatform/pull/440) | chore(deps): align QPK pin to c812ed70f83d | **merge**（例行 pin 同步；待 CI 绿） |

未合并、进行中的平台接线：`feat/account-new-risk-gate-w1`（W1，本地 worktree，尚无 open PR）。

## 3. Schwab 纸面验收

| 项 | 状态 |
| --- | --- |
| CharlesSchwabPlatform paper admission / reconcile CI | 代码已合（#305、#369 等） |
| 本环境真账户纸面读回验收 | **PARK**（无 Schwab 凭据；不调用 provider） |

下一动作：有人类授权与隔离凭据后，在 `CharlesSchwabPlatform` 纸账户做一次只读 reconcile + admission 回归；在此之前不得宣称 Schwab 信封/W2 探针已验收。

## 4. AI 研究晋级自动化（2026-09-07 冻结）

| 项 | 原设想 | 现口径 |
| --- | --- | --- |
| 参数/策略再优化 | ~~定时优化~~（日历 cron 盲跑 reopt） | **偏离触发**：低频 health 只评估 drift；未达 `REVIEW`/`CRITICAL` → `PARK`，不优化 |
| 达标后链路 | — | 有界 reopt → WFA/OOS/回测门 → shadow → **人工**；AI 不授 live、不改实盘参数 |
| 新策略/插件 | — | 独立晋级线；禁止自动改写已在跑版本 |

冻结文档：[偏离触发研究晋级与人工门 V1](qsl_drift_triggered_research_hitl_v1.zh-CN.md)。代码侧 QPK `research_promotion_cycle` 已接 drift→reopt；待补生产监测门槛与严回测门绑定，**不**新增定时优化 cron。
