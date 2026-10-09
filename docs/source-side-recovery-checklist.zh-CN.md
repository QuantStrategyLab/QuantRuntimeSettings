# P0-09 源侧恢复清单（只文档，不改生产开关）

审计基准日：2026-10-09
仓库：QuantRuntimeSettings（控制面文档）
范围：LongBridge HK 采集恢复核对项、Firstrade facts sync 恢复核对项、候选生产者现状、端到端验收分层
**禁止**：改 Environment / Cloud Run ingress / 交易模式 / 生产策略；本文件不构成执行授权。

交叉链接：

- 接线基线指针：[private-target-wiring-baseline.zh-CN.md](./private-target-wiring-baseline.zh-CN.md)（本 PR 精简版；完整表见 [private-target-wiring-baseline.zh-CN.md](./private-target-wiring-baseline.zh-CN.md)（#586 已合入））
- 候选接线说明：`docs/digest-candidates-wiring.zh-CN.md`（#586 已合入）
- 审计 P0-09：对 LB-HK 与 Firstrade 明确关闭原因、既有绑定及权限；**采集恢复不改变交易配置**

证据口径：【代码】公开源码/workflow；【文档】仓库声明；【实测】所有者/quant 2026-10-09 现场；【未知】未核到则保留，禁止编造。

冻结 SHA（取证日 main tip，引用可能继续变化）：

| 仓 | SHA |
| --- | --- |
| QuantRuntimeSettings | [`26e1f705e20ff1cfdcc8ca61ca670285bcad9702`](https://github.com/QuantStrategyLab/QuantRuntimeSettings/commit/26e1f705e20ff1cfdcc8ca61ca670285bcad9702) |
| LongBridgePlatform | [`7e5e9efef87ca8ceab2a572a61525fde24b6ef3b`](https://github.com/QuantStrategyLab/LongBridgePlatform/commit/7e5e9efef87ca8ceab2a572a61525fde24b6ef3b) |
| FirstradePlatform | [`c853d908978defcdb98ff8472887ea2461c2850d`](https://github.com/QuantStrategyLab/FirstradePlatform/commit/c853d908978defcdb98ff8472887ea2461c2850d) |
| CharlesSchwabPlatform | [`dac0614a528e29b5ba373b5c2d1cde935547de3c`](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/commit/dac0614a528e29b5ba373b5c2d1cde935547de3c) |
| InteractiveBrokersPlatform | [`87333bf18811eb456b10b772dfaa40f48dd86249`](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/commit/87333bf18811eb456b10b772dfaa40f48dd86249) |

---

## 1. 问题分类（先归因再动手）

| 分类 | 含义 | 典型误修 |
| --- | --- | --- |
| **源侧未发布** | probe / scheduler / GCS / sync 未产出新鲜事实 | 把控制台空白修成「成功」 |
| **合同未接通** | producer 有数据，但 binding / token / schema / DIGEST_CANDIDATES 未接到中央 | 只改前端文案 |
| **展示问题** | 摄入与 ACK 已过，页面版本或字段映射错 | 回退采集或放宽身份检查 |

验收链（任一段缺失都不能宣称「已恢复」）：

```text
新鲜 facts / 观察对象发布
  → 摄入 ACK（stored / recorded）
  → 控制台认证读回
  → （可选）日报候选消费
```

合成测试必须与生产证据隔离，不得进入收益、日报事实或 SOXL 计数。

---

## 2. LongBridge HK

### 2.1 已确认事实（勿回退）

| 项 | 状态 | 口径 |
| --- | --- | --- |
| 观察模式 | 已回 **`scheduler_archive`**（缺省；非 `independent_get`） | 【实测】quant 2026-10-09 FYI + 【文档】[account_snapshot_history.md](https://github.com/QuantStrategyLab/LongBridgePlatform/blob/7e5e9efef87ca8ceab2a572a61525fde24b6ef3b/docs/account_snapshot_history.md) |
| Environment | `RECORDING_ENABLED` / `ACCOUNT_HISTORY_RECORDING_ENABLED=true`；**无** `OBSERVATION_MODE`（或非 independent_get）；`RUNTIME_TARGET_ENABLED=false` | 【实测】用户授权分工钉 |
| 当前阻塞 | **`observation_timeout`**：`/probe` 触发后未见新鲜 GCS 对象 | 【实测】非 ingress |
| 责任边界 | quant：与 SG 同款 **PAUSED resume**；rebuild：本清单与合同文档 | 人闸：换交易模式 / 放宽 ingress / 开启 independent_get |
| 明确禁止 | `independent_get`；改 Cloud Run **ingress**；用 ingress 绕过 scheduler_archive | 【文档】同上 |

公开文档要点（恢复路径语义）：

- HK 与 SG 统一走 `scheduler_archive`：读回 `{service}-probe-scheduler` →（PAUSED 且合同匹配时）受限 resume → run → 立即 pause → 再读 GCS 归档；不直连 internal Cloud Run，不用 `/account-snapshot` 作日常路径。
- GCS 前缀末段须为 `account_snapshots`；对象路径形如 `{prefix}/{target_id}/{source_binding_id}/{observation_date}/{HHMMSSffffffZ.json}`。
- 新鲜度：触发后约 **15 分钟**窗口内须有完整同源观察对象；否则失败（现场归因为 `observation_timeout`），不追加盲目重触发。
- HK probe 现网合同（文档）：schedule `35 9,15 * * *` / `America/New_York`；避开自然触发前后 10 分钟做受限恢复。

证据：

- [docs/account_snapshot_history.md @ 7e5e9ef](https://github.com/QuantStrategyLab/LongBridgePlatform/blob/7e5e9efef87ca8ceab2a572a61525fde24b6ef3b/docs/account_snapshot_history.md)
- [scripts/record_daily_account_snapshot.py @ 7e5e9ef](https://github.com/QuantStrategyLab/LongBridgePlatform/blob/7e5e9efef87ca8ceab2a572a61525fde24b6ef3b/scripts/record_daily_account_snapshot.py)
- [scripts/inspect_historical_hk_account_archive.py @ 7e5e9ef](https://github.com/QuantStrategyLab/LongBridgePlatform/blob/7e5e9efef87ca8ceab2a572a61525fde24b6ef3b/scripts/inspect_historical_hk_account_archive.py)（`observation_timeout` 类别）
- [docs/historical_hk_archive_inspection.md @ 7e5e9ef](https://github.com/QuantStrategyLab/LongBridgePlatform/blob/7e5e9efef87ca8ceab2a572a61525fde24b6ef3b/docs/historical_hk_archive_inspection.md)

### 2.2 恢复核对清单（每步：谁做 / 人闸 / 是否改交易模式）

| # | 核对项 | 谁做 | 人闸？ | 改交易模式？ | 通过标准（文档级） |
| --- | --- | --- | --- | --- | --- |
| HK-1 | 确认 Environment：`ACCOUNT_HISTORY_RECORDING_ENABLED=true`、无 `independent_get`、`RUNTIME_TARGET_ENABLED=false` | quant（读回） | 否（只读） | 否 | 与上文钉一致；任何偏离先停并问用户 |
| HK-2 | 读回 `{service}-probe-scheduler`：state、cron、timezone、OIDC SA/audience、`POST …/probe`、空 body、零重试 | quant | 否（只读） | 否 | 与文档 HK 合同匹配；**不**为排障改 ingress |
| HK-3 | 与 **SG** 同款 PAUSED resume 对照：权限、10 分钟守卫、resume→run→pause 读回 | quant | **是**（受限 resume 会触碰 Scheduler 状态） | **否**（`RUNTIME_TARGET_ENABLED` 须保持 false；不启用交易 `/run` 策略） | resume/run/pause 结果明确；失败不重触发、不读归档 |
| HK-4 | 核对 GCS：`ACCOUNT_HISTORY_GCS_PREFIX` 末段 `account_snapshots`；bucket/前缀与 serving 报告根隔离规则；listing 权限 | quant | 否（只读元数据） | 否 | 前缀合同正确；**不**公开 binding ID / 对象路径到聊天 |
| HK-5 | 新鲜度：受限触发后 15 分钟内出现合法对象；起点落在窗口内 | quant | 否 | 否 | 有对象且通过合同校验；仍超时则保持 `observation_timeout`，归源侧 |
| HK-6 | QRS 摄入 ACK：目标、观察日、观察结束时间匹配；`stored`/`ok` | quant + 控制面读回 | 否 | 否 | ACK ≠ 页面已展示；页面另做认证读回 |
| HK-7 | 控制台读回 HK 行（身份绑定一致） | rebuild/控制面只读核对 | 否 | 否 | 区分「源侧仍超时」与「合同未接通」 |
| HK-8 | （可选）日报候选：HK 有新鲜 facts 后再谈 DIGEST_CANDIDATES；**本清单不要求** | 平台维护者 | 是（注入受保护 secret） | 否 | 见 §4；禁止合成数据进生产日报 |

**采集恢复不改变交易配置**：上述步骤只服务观察/归档/facts 读回。禁止为「页面变绿」打开 `RUNTIME_TARGET_ENABLED`、放宽 ingress、切换 `independent_get`，或把 missing 改成成功。

---

## 3. Firstrade

### 3.1 已确认事实

| 项 | 状态 | 口径 |
| --- | --- | --- |
| facts sync | **关闭**（`FIRSTRADE_ACCOUNT_FACTS_SYNC_ENABLED` 未设或非 `true`） | 【实测】审计/用户；归 **quant 续会话** |
| 关闭原因 | **待证**（会话过期 / 故意关闭 / 绑定未核 / 部署未采用——未在公开仓证明） | 【未知】禁止编造 |
| 身份绑定 | target / source_binding / account_key / scope 须与 QRS 可信绑定及 runtime target **精确一致** | 【文档】README |
| 专用 token | `FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN`（Secret Manager）；GH variable 只存 **secret 名** | 【文档】【代码】 |
| 同步开关位置 | 见下表公开路径 | 【代码】 |
| 责任边界 | quant：续会话与是否开启 sync；rebuild：清单与合同；**不把页面修成无条件成功** | 人闸：开启 sync、改 binding |

### 3.2 公开开关与接线路径（只定位，不改）

| 角色 | 公开证据链接 |
| --- | --- |
| 入口门控 | [`main.py` `POST /account-facts-sync`](https://github.com/QuantStrategyLab/FirstradePlatform/blob/c853d908978defcdb98ff8472887ea2461c2850d/main.py)（`FIRSTRADE_ACCOUNT_FACTS_SYNC_ENABLED != true` 则拒绝） |
| 发布逻辑 | [`application/account_facts_publisher.py`](https://github.com/QuantStrategyLab/FirstradePlatform/blob/c853d908978defcdb98ff8472887ea2461c2850d/application/account_facts_publisher.py) |
| 配置同步脚本 | [`scripts/account_facts_config_sync.py`](https://github.com/QuantStrategyLab/FirstradePlatform/blob/c853d908978defcdb98ff8472887ea2461c2850d/scripts/account_facts_config_sync.py) |
| Workflow 输入 | [`.github/workflows/sync-cloud-run-env.yml`](https://github.com/QuantStrategyLab/FirstradePlatform/blob/c853d908978defcdb98ff8472887ea2461c2850d/.github/workflows/sync-cloud-run-env.yml) — `sync_account_facts_configuration`（默认关；零流量暂存） |
| 操作说明 | [README.zh-CN.md（只读账户事实）](https://github.com/QuantStrategyLab/FirstradePlatform/blob/c853d908978defcdb98ff8472887ea2461c2850d/README.zh-CN.md)、[README.md](https://github.com/QuantStrategyLab/FirstradePlatform/blob/c853d908978defcdb98ff8472887ea2461c2850d/README.md) |

必填 Environment / Secret 名（公开合同名，无值）：

- `FIRSTRADE_ACCOUNT_FACTS_SYNC_ENABLED`
- `FIRSTRADE_ACCOUNT_FACTS_SYNC_URL`（须精确为控制台 `/api/account-facts/sync`）
- `FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN` / `FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN_SECRET_NAME`
- `FIRSTRADE_ACCOUNT_FACTS_TARGET_ID`
- `FIRSTRADE_ACCOUNT_FACTS_SOURCE_BINDING_ID`
- `FIRSTRADE_ACCOUNT_FACTS_ACCOUNT_KEY`
- `FIRSTRADE_ACCOUNT_FACTS_ACCOUNT_SCOPE`

### 3.3 恢复核对清单

| # | 核对项 | 谁做 | 人闸？ | 改交易模式？ | 通过标准 |
| --- | --- | --- | --- | --- | --- |
| FT-1 | 记录关闭原因（会话 / 开关 / 绑定 / 部署未采用） | quant | 否 | 否 | 写入私有笔记；公开仓只保留「待证」或已证实类别 |
| FT-2 | 缓存会话是否仍可读（不登录、不刷新、不下单） | quant | 否 | 否 | endpoint 语义：仅缓存会话快照；会话失效则先续会话 |
| FT-3 | 身份四元组与 QRS binding 逐字一致 | quant | **是**（改 binding） | 否 | 不一致则停；禁止从页面「修好」 |
| FT-4 | 专用 sync token 与 URL 合同 | quant | **是**（轮换/挂载） | 否 | 非 Firstrade 登录凭据；IAM invoker + app bearer 分离 |
| FT-5 | `sync_account_facts_configuration` 零流量暂存 → 读回 → **另一步**流量采用 | quant | **是** | 否 | 暂存成功 ≠ serving 已采用 ≠ 余额已同步 |
| FT-6 | 显式 `ENABLED=true` 后手动 `POST /account-facts-sync` → ACK | quant | **是** | 否 | 固定 status/error code；无原生账户 ID 进日志 |
| FT-7 | 控制台读回；失败保持 blocked/empty/partial | rebuild 只读 | 否 | 否 | **禁止**无条件成功文案 |

恢复不改交易模式：不登录下单、不改策略、不把 missing 改成 0/正常。

---

## 4. 候选生产者现状（DIGEST_CANDIDATES）

只读检索（2026-10-09）：对 Schwab / IBKR / LongBridge / Firstrade 的 `notifications/*` 抽样及树内文件名检索，**未发现**字面量 `DIGEST_CANDIDATES` / `digest_candidate` 生产者路径。中央消费侧在 QRS（`DIGEST_CANDIDATES_JSON` / `PATH`，见 #586）。下表为「邻近日报/事实投影」公开证据，**不等于**已接通中央候选管道。

| 平台 | DIGEST_CANDIDATES 产出路径 | 邻近公开证据（非中央候选合同） | 结论 |
| --- | --- | --- | --- |
| CharlesSchwabPlatform | **未知**（未检出字面量） | [runtime-daily-sync.yml](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/blob/dac0614a528e29b5ba373b5c2d1cde935547de3c/.github/workflows/runtime-daily-sync.yml)；[publish_runtime_daily_from_reports.py](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/blob/dac0614a528e29b5ba373b5c2d1cde935547de3c/scripts/publish_runtime_daily_from_reports.py)；[README 只读日报 caller](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/blob/dac0614a528e29b5ba373b5c2d1cde935547de3c/README.zh-CN.md) | 有 **runtime daily 投影/可选 POST**；需另接中央 `DIGEST_CANDIDATES_*` |
| InteractiveBrokersPlatform | **未知** | [publish-ibkr-flex-period-return.yml](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/blob/87333bf18811eb456b10b772dfaa40f48dd86249/.github/workflows/publish-ibkr-flex-period-return.yml)；[scripts/daily_dry_run_digest.py](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/blob/87333bf18811eb456b10b772dfaa40f48dd86249/scripts/daily_dry_run_digest.py)（drill Telegram，非中央候选 JSON）；account_facts 脚本族 | **无** `publish-runtime-daily-once.yml`；无中央候选检出 |
| LongBridgePlatform | **未知** | [publish-runtime-daily-once.yml](https://github.com/QuantStrategyLab/LongBridgePlatform/blob/7e5e9efef87ca8ceab2a572a61525fde24b6ef3b/.github/workflows/publish-runtime-daily-once.yml)；[docs/daily_runtime_projection.md](https://github.com/QuantStrategyLab/LongBridgePlatform/blob/7e5e9efef87ca8ceab2a572a61525fde24b6ef3b/docs/daily_runtime_projection.md)（PAPER 投影；`fills` 未接通） | PAPER 日投影 ≠ HK facts；≠ DIGEST_CANDIDATES |
| FirstradePlatform | **未知** | account-facts sync 路径见 §3；树内无 runtime-daily / digest-candidate 文件名 | facts sync 关闭时无中央候选来源 |

QRS main allowlist（仍指向多处 `publish-runtime-daily-once.yml`；校准见 draft [#587](https://github.com/QuantStrategyLab/QuantRuntimeSettings/pull/587)）：[`platform-config.json` daily_digest.github_workflow_allowlist](https://github.com/QuantStrategyLab/QuantRuntimeSettings/blob/26e1f705e20ff1cfdcc8ca61ca670285bcad9702/platform-config.json)。

---

## 5. 通用验收与护栏

1. **分层报告**：源侧发布 / 摄入 ACK / 控制台读回 / 日报消费 分项勾选；禁止用 workflow success 冒充成交或账户身份。
2. **合成隔离**：dry-run 候选仅验证聚合渲染；不得写入生产 DO/KV 事实或收益。
3. **人闸**：开启 recording/sync、PAUSED resume、binding/token、流量采用、任何交易模式变更。
4. **与 quant 分工**：LB-HK scheduler / Firstrade 会话归 quant；本仓只维护清单与中央合同文档。冲突时停改 Environment，问用户。
5. **不要做**：independent_get；改 ingress；页面无条件成功；未知成交填 0；密钥进公开仓/聊天。

---

## 6. 未知项（显式保留）

| 项 | 状态 |
| --- | --- |
| LB-HK 生产 revision / 实际 GCS bucket 名（私有） | 未知（公开仓仅合同；值在受保护配置） |
| LB-HK `observation_timeout` 根因（probe 未跑 / GCS 权限 / 窗口外 / binding 不匹配） | 待 quant 读回后归类 |
| Firstrade sync 关闭的具体原因 | 待证 |
| 任一平台已向中央注入真实 `DIGEST_CANDIDATES_*` | 未知（公开检索未检出生产者） |
| 各 target 生产 Environment 全名与 opaque_account_uid | 见基线表「待填」 |

---

## 修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-10-09 | rebuild P0-09：源侧恢复清单初稿；只文档；冻结上表 SHA |
