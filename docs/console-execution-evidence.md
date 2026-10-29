# Account execution configuration evidence / 账户执行配置来源

`GET /api/config` adds optional `currentStrategies[platform][accountKey].execution_evidence`.
`GET /api/strategies/summary` carries the same optional object on each configured account.
Existing configuration fields retain their meaning. An account without a resolved target may now have an evidence-only record; its strategy, execution mode and enabled flag remain absent.

The object contains `value` (`live`, `paper`, `dry_run`, `unknown`), `status` (`confirmed`, `config_missing`, `not_connected`, `read_failed`, `permission_denied`), `reason_codes`, nullable `broker_environment`, `execution_mode`, `dry_run_only`, `environment_source`, `configuration_source`, and `observed_at`. `runtime_observation_status` is always `unknown`.

Only explicit account-directory `broker_environment` and an account-matched `RUNTIME_TARGET_JSON` or `CLOUD_RUN_SERVICE_TARGETS_JSON` projection supply values. Defaults, labels, account aliases, strategy names and legacy `STRATEGY_PROFILE` paper inference never fill these fields. Live submission to a paper broker is displayed as paper. A paper execution mode conflicting with a live broker stays unknown. An explicit live mode without a boolean dry-run constraint stays unknown. Missing environment evidence also stays unknown.

`observed_at` records the reader's check time, including failed attempts, rather than deployment, source modification, run or fill time. Cached objects retain their original time. Older cached/legacy responses may lack the object or timestamp; the UI explains missing sources and never invents a time. A failed variable-list page discards all values from that scoped read. Upstream response bodies and credentials are never included.

The account and overview cards display the reason for unknown, broker environment, source and check time. The strategy cards use the same object when available. A confirmed configuration is not a claim that it is currently running or has executed an order. No endpoint or display change grants execution authority.

`/api/config` can return HTTP 200 with `accountOptions=null` for a session that is not allowed. This is unavailable account evidence, not an empty directory or a proof that no accounts exist.

## 中文

新字段均为可选，旧配置字段含义不变。未解析到目标的账户可以新增仅含 `execution_evidence` 的记录；策略、执行模式与启停字段继续缺省，不填默认值。两个接口传递同一份来源说明。

来源仅限账户目录明确的券商环境，以及按已有账户标识匹配的运行目标或服务目标配置。别名、标签、策略名、默认值和旧接口按 paper 目标名补值的逻辑都不能构成新字段的依据。向模拟券商提交订单显示模拟；模拟执行配置与实盘券商冲突时保持未知；live 缺少明确布尔演练限制或缺少券商环境时保持未知。

`observed_at` 是本次配置检查的时间，包括失败尝试；不是部署、源修改、运行或成交时间。缓存保留原时点。旧响应缺少新字段或时点时，页面说明来源缺失，不生成时点。任一变量列表分页读取失败，该次读取的所有值都会被丢弃，不把部分结果当作完整配置。上游正文、凭据和内部账户标识不进入新字段。

页面展示未知原因、券商环境、配置来源与检查时间。确认配置仅表示已读到明确配置，不能证明当前生效、真实运行或成交。此变更不授予执行权限。

未获准的会话读取 `/api/config`，可能得到 HTTP 200 和 `accountOptions=null`；这是账户资料不可见，不能当作账户目录为空。
