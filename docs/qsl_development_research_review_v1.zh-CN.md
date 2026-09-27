# `qsl.development_research_review.v1`

这是已完成 development 研究的只读审阅消息。它和 `qsl.research_task.v1`
是不同合同，不代表原生 P3 观察，也不能转换为 P3 任务、实验授权、策略采用或
生产配置。AIAuditBridge 负责从固定 A 汇总生成消息；QRS 在
`python/scripts/development_research_review_consumer.py` 中独立校验并投影审阅状态，
不导入 AIAuditBridge 运行时代码。

## 输入和校验

消息绑定 A 汇总原始字节 SHA-256
`7c4a2dcf03c2becb19c012e015f86c5a1f5b6f845afd7d88516a2c515462da91`、规范化结果摘要、
25 项上游输入索引、候选/runner/策略引擎/政策/结算/费用身份、session 数、资本规模、
路径指标和带符号的比较结果。输入索引含 source manifest、R6/R7/R8 输入、future
manifest、页面与许可记录、政策、runner 和 TQQQ 合同；不含输出账本。
生产端和 QRS 都固定校验该索引整体摘要、规范化结果摘要，以及 R8 strategy、runner、
capital policy、settlement 身份，并核对这些身份与索引对应项。保留固定 source 摘要、
但重算消息摘要/key 不能使被篡改的投影通过。
`producer_revision_sha256` 是 AIAuditBridge producer 模块源码字节的 SHA-256，表示源码身份，
不是签名或经过认证的构建证明。QRS 校验其格式，并将其计入 duplicate key 与 state identity。

QRS 独立检查新 schema、固定来源与候选、所有输入索引项、摘要、窗口、完成状态、来源
保证、PIT 状态、authority 和结果数值。缺失输入、摘要冲突、来源或 PIT 升级、权限提升、
路径/凭据/账户等字段、旧任务或 P3 schema 冒用都会拒绝。负的收益差异是合法的结果，
consumer 不会因符号或大小改变它。

权力字段固定为 `review_disposition=advisory`、`mode=read_only`、`no_order=true`，且
`adoption`、`codegen`、`experiment`、`notification`、`trade` 均为 `false`。消费者不调用
AI、实验、通知、配置写入或交易接口。重复读回返回同一规范化 state identity；同一经济
key 由研究、候选/组合、生产者/runner、上游输入、政策/结算/费用和消息版本构成；
`result_digest` 单独比较，以便同一经济身份出现不同结果时能拒绝冲突。`created_at` 不参与
key 或 state identity。

运行真实本地消息。普通安装 `python/` 之后，可以从两个仓库之外的目录调用
`qsl-development-research-review`，不必把多个源码树放进 `PYTHONPATH`。未安装时仍可直接运行脚本：

```sh
python3 python/scripts/development_research_review_consumer.py \
  --input <message.json> \
  --state <receipt.json> \
  --expected-producer-revision <producer-sha256>
```

`--integration-manifest <manifest.json>` 可以代替显式修订参数。清单是 JSON，`producer_revision_sha256`
位于顶层，或位于 `aab` / `producer` 对象中。两个来源同时给出时必须相同。这条 D1 路径会拒绝
生产者修订与绑定值不一致的消息，即使调用方重算了 duplicate key 和 message seal。

`--state` 保存本地收据。同一 duplicate key 且同一 `result_digest` 在新进程里返回已经保存的
reviewable state，不追加第二条。`created_at` 不进入经济身份；只改变它并重算 message seal 时，
key、结果和 state identity 保持不变。同一 key 的 `result_digest` 不同则拒绝，并且不覆盖原文件。
写入先落到同目录临时文件，再 `os.replace`；收据和锁文件模式都是 `0600`。锁文件只锁这一份收据。
此入口不调用 AI、实验、通知或发布。

可执行 JSON Schema 位于 `schemas/qsl-development-research-review.v1.schema.json`。
SHA-256 是完整性校验，不是签名，也不证明消息由可信身份签发。A 的来源只达到单一数据源
结构证据；corporate-action `process_date` 是事后代理日期，所以 `strict_point_in_time_certified`
保持 `false`。本地双端消费验证不代表自动 AI 分析、Watcher 接通、控制台发布、实盘或策略晋级。
