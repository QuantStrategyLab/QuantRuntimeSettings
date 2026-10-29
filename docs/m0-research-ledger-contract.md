# M0 研究台账 v1

`qsl_m0_research_source_snapshot.v1` 和 `qsl_m0_research_ledger.v1` 是
`QuantAdvisorResearch` 与运行时设置之间的只读边界。

它们只接收已由顾投系统产生且已闭合校验的
`qsl.m0_research_hypothesis.v1`。这不是策略选择、仓位分配、运行时目标、
平台路由或订单合约；实现不依赖 QPK selector，也不调用调度、券商或
执行组件。

## 输入快照

一个 source snapshot 对应一个来源报告摘要：

```text
schema_version: qsl_m0_research_source_snapshot.v1
source_id: 稳定的传输来源标识
source_report_digest: 顾投报告 SHA-256
generated_at / computed_at / data_status
hypotheses: [qsl.m0_research_hypothesis.v1, ...]
errors: [安全错误码, ...]
```

快照中的每条 hypothesis 必须：

- 精确匹配 M0 的字段闭包，并具有 `authority=research_only`、
  `no_order=true` 和 `permitted_next_step=research_validation_only`；
- 具有有效的 7 天有效期、`as_of` 与生成时间关系，以及来源报告/来源条目
  SHA-256；
- 与快照的 `source_report_digest` 完全一致；
- 不含账户、仓位、权重、订单、路由、平台、运行时、密钥或执行语义。

快照不得把失效研究线索重新标为新信号。`ready` 来源必须提供时间与来源
digest，且 `errors` 必须为空；`unavailable` 来源不得携带 hypothesis。来源、
subject、theme 与 hypothesis 标识采用与 `QuantAdvisorResearch` 完全相同的
字符集，不接受 `=`。M0 v5/v6 的 provenance 也是闭合配对：

- v5 必须为 `model_recommendations.v5` 且 `source_input_digest=null`；
- v6 必须为 `model_recommendations.v6` 且 `source_input_digest` 为 SHA-256。

## 聚合行为

`aggregate_m0_research_sources(snapshots, now=...)` 是确定性的纯函数：

1. 校验每个来源；无效来源只产生安全错误码，不能污染有效台账。
2. 以 `(subject.kind, subject.identifier, source_report_digest)` 合并完全相同
   的观测，并保留所有 `source_ids`。
3. 同一 subject + source digest 出现不同内容时，作为
   `m0_source_subject_collision` 故障闭合剔除。
4. 同一 subject 的不同报告保留为独立观测；若 `primary_horizon` 不同，
   仅当**当前 fresh**观测不同才标记 `horizon_conflict.status=conflict`。
   已失效观测被独立投影为 `historical_stale_horizon_drift`：只有存在当前
   fresh 基准且历史 horizon 不同时才标记 `drift`；完全 stale 的 subject
   只标记 `unavailable`，不会伪造当前冲突。这两者都是研究队列的人工/后续
   验证信息，不是交易信号。
5. 依据 `now` 与 `expires_at` 产生 `fresh`、`stale` 或 `unknown`；来源自身
   为 `stale` 时不会被提升为 fresh。
6. source 的 `generated_at` 或 `computed_at` 晚于聚合传入的 `now` 时，整个
   source 以 `m0_source_future_timestamp` 故障闭合剔除；不会以 `unknown`
   继续展示或参与去重。

输出台账始终固定：

```text
authority: research_only
no_order: true
permitted_next_step: research_validation_only
```

因此控制台可安全显示 subject、来源证据、有效期和短/中/长期冲突，而不能从
该对象获得任何策略切换、平台控制或执行动作。未来若要把其中一条线索转成
研究任务，必须由独立的 P1--P3 入场流程重新绑定数据、回测与审计证据。
