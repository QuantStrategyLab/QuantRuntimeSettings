# Runtime report to execution-evidence projection

`python/scripts/execution_evidence_projection.py` builds the input contract for
the Strategy Switch Console's read-only execution-evidence board. It is shared
across all platform runtimes; it has no broker adapter, trading API, account,
order, position, capital, credential, or network-publishing capability.

Only an eligible `runtime_report.v1` record is projected. Eligibility requires:

- an allowed platform and strategy domain;
- a self-attested `runtime_release_receipt` with a 40-character strategy
  revision;
- an internally consistent target lane (`paper` or `live`) and `dry_run`
  value; and
- a valid report timestamp.

The projection deliberately copies none of `summary`, `diagnostics`,
`artifacts`, or runtime error text. Its deployment identifier is a stable
digest, so service and account-like labels are not exposed in the console.

An eligible report proves only that this runtime loaded the displayed strategy
revision for the configured lane. It does **not** prove market-data quality,
broker acceptance, submitted orders, fills, positions, or capital usage. For
that reason every projected record sets `target_data` and `target_execution` to
`pending` and uses `parked` with
`target_execution_evidence_missing`. The projection never emits an autonomous
paper/shadow recommendation or a live approval.

## 可选执行回执

新 runtime 可以在原始 `runtime_report.v1` 中附带
`qsl_execution_receipt.v1`。它只允许九个固定结果：未到期、无订单、风控拦截、
已提交、券商确认、部分成交、成交、需对账或失败；同时只保留最小的券商确认状态和
时间。它没有账户、订单号、标的、价格、数量、持仓、资金、错误原文或凭证。

投影器只接受与 runtime report 的平台、策略、40 位 revision、执行通道完全一致，且
内容摘要和时间窗口都有效的回执。缺失、旧格式、篡改或不一致的回执不会被推断为成功：
缺失时仍为 `pending`；失败/需对账时为 `unavailable`；其余有效回执只把“该次结果
已被记录”标为 `verified`。无论哪种情况，推荐仍是 `parked`，不会产生 paper、canary
或实盘授权。

Reports older than its bounded freshness window (36 hours by default), or more
than five minutes in the future, are discarded. The output's `generated_at`
retains the oldest accepted report timestamp rather than the collector time, so
collection cannot make old evidence appear current.

The script writes a local JSON file only. The reusable composite Action at
`actions/publish-runtime-execution-evidence` performs the optional publishing
step. Its caller must first authenticate with its existing GitHub OIDC
workload identity, and must provide a distinct
`EXECUTION_EVIDENCE_SYNC_TOKEN` through the protected Actions secret store.
The Action lists at most 100 recent report objects, reads no report outside the
configured platform prefix, and POSTs only the generated snapshot to
`/api/internal/sync-execution-evidence-source`. It does not need or create a
long-lived GCP key. Credentials and runtime-report object URLs must never be
added to this repository or emitted to logs.

## 生产端接入边界

执行回执是一个通用接口，但不允许平台为了“看起来完整”而猜测成交。当前接入的
运行时只把已有的、可验证的字段转换为回执；所有策略和插件沿用同一平台适配器，
不需要为每个策略复制一套规则。

| 平台运行时 | 可发布的最高事实 | 不会推断的事实 |
| --- | --- | --- |
| IBKR | 显式 reconciliation 中的部分/完整成交；其余为已提交或待对账 | 本地执行标记、网关连通性不等于成交 |
| LongBridge | 已提交或待对账 | `action_done` 不等于券商确认或成交 |
| Charles Schwab | 已受理订单仍为待对账 | 受理订单不等于成交 |
| Firstrade | 已提交、风控/资金拦截或待对账 | 策略运行阶段不等于成交 |
| Binance | API 返回的明确状态（确认、部分成交或成交） | 意图、通知、状态写入或网络超时不等于成交 |

任何网络异常、超时或部分结果都优先保守为 `reconciliation_required` 或
`failed/not_observed`，而不是“没有下单”。若运行时目标没有完整的
`strategy_release` 自证，生产端可以继续运行原有策略，但不得附加回执；控制台会把它
显示为证据缺失，不能借此获得恢复、扩容、canary 或实盘权限。

QMT 的当前目标是禁用/dry-run，Alpaca 当前只承担研究或数据职责，因此两者不是活跃的
执行回执生产者。这不是故障：在它们具备受控的 broker execution lane、40 位 release
自证和只读报告发布前，控制台必须继续显示为不可执行或不适用。

新平台、策略或插件接入时必须同时满足以下条件：

1. 使用 QuantPlatformKit 的 `resolve_execution_receipt_fact` 与
   `attach_runtime_execution_receipt`，并仅传入平台实际观察到的事实；
2. 运行报告必须含有与 `RUNTIME_TARGET_JSON` 匹配的 self-attested release；
3. 在不改变订单、仓位、权限或环境配置的情况下，为适配器写入正向和拒绝性单元测试；
4. 使用本仓库固定版本的 `publish-runtime-execution-evidence` Action 发布只读快照；
5. 先确认控制台显示的回执和原始报告一致，再单独走既有的 paper/canary/live 准入流程。
