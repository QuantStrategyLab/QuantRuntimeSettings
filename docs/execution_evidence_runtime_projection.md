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
