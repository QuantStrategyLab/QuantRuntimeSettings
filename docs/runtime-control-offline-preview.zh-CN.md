# RuntimeControl 离线预演

渲染器默认关闭。只有传入 `--preview-enabled` 才读取明确指定的本地公开 JSON，并向 stdout 输出预演结果；
不写文件，不连接云端、券商、部署工作流或控制台。

```bash
# 默认关闭：不打开输入文件，不输出内容。
python3 python/scripts/render_runtime_control_preview.py

# 显式预演：仅使用公开的合成参考配置。
python3 python/scripts/render_runtime_control_preview.py \
  --preview-enabled \
  --control-file examples/runtime_controls/example-paper.example.json \
  --risk-policy-file examples/risk_policies/soxl_soxx_trend_income/soxl-runtime-risk-20260917.example.json
```

API `render_preview(control, policy, preview_enabled=False)` 默认直接返回 `None`，不检查输入。
这个开关只控制本次预演，不启用 Option D 或任何运行目标。

候选必须 enabled=false、mode=dry_run、options_enabled=false；live、券商 paper 和已启用候选均拒绝。
target_id 的平台前缀须与 platform_id 一致。引用 policy 时必须显式提供文件，并匹配 policy ID 和策略 profile。
实现复用现有参考配置校验，拒绝重复 JSON 字段、非有限数值、格式错误和类似券商账号的内容。

预留比例和 USD 下限取目标与 policy 的较大值；cash-only 冲突或有效预留比例加名义上限超过 1 时拒绝。
这只是配置预演，没有净值估算、策略默认值查找、资金分配、订单计算或回测结果。
其他风险上限仍属于所引用的 policy，本工具不执行这些交易保护。

结果包含 `runtime_control_json` 及其 SHA-256、规范化 policy 的 SHA-256（无引用时为 null），以及
`preview_only=true`、`no_order=true`、`execution_authorized=false`、`live_ready=false`。
hash 对应按键排序、紧凑 UTF-8 JSON 的字节，不含尾随换行。输出省略 description，补齐 options=false 与现金下限 0；
不自动改写 enable/mode。hash 只标识内容，不代表批准。

仅使用无秘密、目标 ID 为占位符的公开输入。类似账号的检测不能代替完整脱敏；不要输入私人账号、域名、部署映射或凭据。
CLI 失败时 stdout 为空，stderr 仅报告错误类型，不输出原始输入。

部署渲染与逐平台采用仍需后续独立 PR，核对身份和版本绑定、旧配置一致性、policy 校验和平台测试，并附 trading-diff。
本工具不授予这些操作权限。

验证：`python3 -m unittest discover -s python/tests -p 'test_render_runtime_control_preview.py' -v`。

[English](runtime-control-offline-preview.md)
