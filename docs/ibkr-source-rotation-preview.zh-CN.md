# IBKR source 轮换只读预览 / Read-only rotation preview

`Sync account-facts binding` 现在提供默认关闭的 `preview_ibkr_source_rotation`。
Only a manual main run for IBKR can enable this preview; it never writes a remote binding.
现有正常操作、inspection 和初始化入口保留。预览不能与 inspection、lifecycle、
初始化或 apply 同时开启；非法组合在读取私有配置前拒绝。

```bash
gh workflow run sync-schwab-account-facts-binding.yml \
  --repo QuantStrategyLab/QuantRuntimeSettings --ref main \
  -f platform=ibkr -f preview_ibkr_source_rotation=true \
  -f inspect_ibkr_bindings=false -f inspect_ibkr_lifecycle=false \
  -f initialize_ibkr_bindings=false -f apply_initial_ibkr_bindings=false
```

预览使用现有 Environment 的 Cloudflare/Wrangler 只读配置通道和
`IBKR_ACCOUNT_FACTS_SOURCE_ROTATION_JSON`，不增改生产变量、秘密、IAM 或目标。
该受保护请求的三项字段仍为 `target_id`、`previous_source_binding_id`、
`next_source_binding_id`；原值留在 runner，不能贴到 issue、日志或公共 artifact。
Existing protected credentials and the existing rotation request are reused; no new secret is required.

当前 options 与 bindings 通过两次 KV get 在私有临时目录读取。原有请求格式、
单目标、物理账户身份、完整最终 bindings 校验均执行；预览另要求 previous ID
准确匹配当前绑定，即使拟议 next ID 与当前值相同也不能跳过 predecessor 检查。
准备结果只存在本次 runner 临时目录，并在退出时清理；KV put/readback 和其他平台
配置准备均不执行。公开最终结果仅 `status=preview reason=none` 或固定 blocked reason，
原有 validation status 仍可出现。缺失/无效请求会失败，不切换到实际 rotation 重试。

The preview validates the existing request against current configuration. It does not prove release approval,
compute a new broker canonical ID, update a secret, or recover natural candidate publication.
IBKR canonical source ID 包含 runtime revision；受控维护前仍需批准的 serving image/source/
安装/config/risk 事实及 broker 与中央两侧身份接续。不能仅把可读的当前修订填成批准值。
原发布 guard 的完整快照检查、single-writer 维护、未知写结果先对账以及自然周期验收继续保留。

验证：`node tests/account_facts_binding_workflow_validation.mjs` 执行实际 setup/sync
workflow body，使用合成配置和 fake Wrangler，覆盖有效/不变预览、非法平台/模式/上下文、
错误 previous ID 和物理身份；所有预览均断言无 KV put。原 rotation/初始化回归继续运行。
