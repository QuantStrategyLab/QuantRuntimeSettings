# 中央日报 DIGEST_CANDIDATES 接线（无密钥）

本文说明如何把**某一平台**的日报候选证据接到 `QuantRuntimeSettings` 中央日报，不写密钥、不写真实账户号、不写资产金额。

## 目标

平台 producer 产出结构化候选 → 中央 `daily_digest_aggregator` 消费 → `daily_digest_notify` 渲染 → QuantSentinel 发送。

GitHub workflow 成功结论只是**存在性**辅助证据；成交/订单数未知时必须显示「未知」，不得写成 0。

## JSON Schema 归档

正式合同文件：[`schemas/qsl-digest-candidates.v1.schema.json`](../schemas/qsl-digest-candidates.v1.schema.json)（`schema_version` = `qsl.digest_candidates.v1`）。本文件示例与平台 producer 文档必须与该 schema 对齐；未知成交数保持 `null` + `field_status.counts_unknown`。

## 候选 JSON 形状（最小）

```json
{
  "runs": [
    {
      "platform_id": "schwab",
      "strategy_profile": "soxl_soxx_trend_income",
      "opaque_account_uid": "acct_opaque_example",
      "target_id": "schwab/example-target",
      "actually_ran": true,
      "fill_count": 0,
      "order_count": 0,
      "cycle_count": 1,
      "field_status": {
        "fill_count": "known",
        "order_count": "known",
        "cycle_count": "known"
      },
      "evidence_provenance": "candidates",
      "strategy_label": "半导体趋势收益"
    }
  ]
}
```

约束：

- 聚合键为 `(platform_id, strategy_profile, opaque_account_uid|unknown, target_id|unknown)`；同策略多账户必须带身份，禁止仅用平台+策略合并。
- `actually_ran` 必须显式布尔；缺省不再默认 `true`。
- 新 stub / 存在性证据：`fill_count`/`order_count` 用 `null` + `field_status.counts_unknown` 或 `reason_code=github_workflow_existence_only`。
- 旧生产者若仍给 `int 0` 且无 `field_status`，按「已验证零成交」兼容。
- 权益/持仓/信号/调仓字段可选；有则渲染，无则省略；中央不编造。
- `holdings_scope`（可选）：标注持仓覆盖范围，`strategy_symbols_only`（嘉信：仅策略标的）/ `stocks_only`（盈透：仅股票）；渲染为「💼 持仓（仅策略标的）」/「💼 持仓（仅股票）」。未知值忽略；无持仓时不渲染。

## 中央 workflow 接线点

文件：`.github/workflows/daily-digest-notify.yml`（文稿同步 `docs/workflows/`）。

Environment：`runtime-strategy-switch`。

可选输入（二选一，优先 secret JSON）：

| 来源 | 名称 | 说明 |
| --- | --- | --- |
| Environment secret | `DIGEST_CANDIDATES_JSON` | 整份候选 JSON；workflow 落盘到 `data/input/daily-digest/candidates.json`，再注入 `DIGEST_CANDIDATES_PATH` |
| Environment variable | `DIGEST_CANDIDATES_PATH` | 指向 runner 上已有文件（例如私有前置步骤写出）；文件必须存在 |

脚本侧已支持：

- env `DIGEST_CANDIDATES_PATH` / `DIGEST_CANDIDATES_JSON`
- CLI `--candidates <path>`（workflow 在物化后会传入）

**不要**把含账户资产的候选默认上传为公开 artifact。receipt.json 可上传（含 coverage / failures / identity 占位与 field provenance，不含 token）。

## 推荐对接顺序（文档化路径，本仓只读说明）

优先对接已有稳定 facts / 日报投影的平台之一（以各平台仓文档为准，revision 勿编造）：

1. **CharlesSchwabPlatform** — 见下方「平台生产者」与 [PR #488](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/488)；候选由平台侧从已验证 facts 投影，经受保护通道写入中央 Environment secret，或私有 job 写出文件后由 `DIGEST_CANDIDATES_PATH` 消费。
2. **InteractiveBrokersPlatform** — 见 [PR #583](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/pull/583) 与仓内 `docs/digest_candidates_producer.zh-CN.md`；证据源为 `runtime_report.v1` + snapshot history（无 Schwab 式 `runtime-daily-sync`）；注意 `target_id` / account scope 与控制台绑定一致。
3. **LongBridgePlatform（SG）** — 与 HK 隔离；本任务不改 HK ingress / scheduler。SG 候选同样经受保护通道注入中央。

本仓无法直接拉取平台私有产物时：先用合成候选 dry-run 验收聚合与渲染，再由平台维护者配置 Environment secret。

## 平台生产者

中央仓只消费候选；**投影生产者在各平台仓**。当前已开的生产者 draft：

| 平台仓 | PR / 文档 | 说明 |
| --- | --- | --- |
| CharlesSchwabPlatform | [PR #488](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/488)；仓内 `docs/digest_candidates_producer.zh-CN.md` | 从已验证 runtime daily / facts（`runtime-daily-sync`）投影 `schema_version=qsl.digest_candidates.v1`；默认不上传公开 artifact；fills 未知保持 `null`，不写成 0 |
| InteractiveBrokersPlatform | [PR #583](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/pull/583)；仓内 `docs/digest_candidates_producer.zh-CN.md` | 证据源为 **`runtime_report.v1` + snapshot history**（**无** Schwab 式 `runtime-daily-sync`）；投影同 schema；默认不上传公开 artifact；fills 未知保持 `null`，不写成 0 |

对接约定：`platform_id` 用控制台/聚合器已识别的短名（Schwab 为 **`schwab`**，IBKR 为 **`ibkr`**）。生产者输出经受保护通道进入本仓 Environment，**不**由本仓直接改平台私有产物。

### 本机联调（已验证，2026-10-09）

合成候选（Schwab 形状，`fill_count`/`order_count` = `null`）→ 中央 aggregator：

```bash
python3 python/scripts/send_daily_digest_telegram.py \
  --dry-run --no-github \
  --business-day 2026-10-08 \
  --candidates /path/to/synthetic-candidates.json \
  --write-receipt /tmp/digest-receipt.json
```

验收结果（本机已跑通）：

- receipt：`source_coverage.candidates_loaded=true`
- receipt：`total_fills=null`（`total_fills_status=unknown`），非 0
- 渲染文案含「成交数未知」/「成交 未知」；**不**出现「无成交」「链路正常」

### 生产注入（人闸）

写入 Environment `runtime-strategy-switch` 的 secret `DIGEST_CANDIDATES_JSON`（或由私有前置步骤写出文件后设 `DIGEST_CANDIDATES_PATH`），再对 `daily-digest-notify.yml` 做 **dry-run** `workflow_dispatch`。改生产 Environment / 关 dry-run 需人工确认；本任务与自动化**不得**直接改生产 Environment。

## Dry-run 验收

```bash
# 合成候选（无真实账户）
python3 python/scripts/send_daily_digest_telegram.py \
  --dry-run --no-github \
  --business-day 2026-10-08 \
  --candidates /path/to/synthetic-candidates.json \
  --write-receipt /tmp/digest-receipt.json
```

检查 receipt：

- `source_coverage.candidates_loaded=true`
- 同 `platform_id+strategy_profile`、不同 `opaque_account_uid` → `run_count>=2` 且未合并
- `fill_count` 缺省 / unknown → 文案含「未知」，不是「无成交」
- 模拟 GitHub 失败时 `evidence_status=evidence_unknown`，文案不含「链路正常」

workflow_dispatch：默认 `dry_run=true`；确认 Environment 已接线后再关 dry-run。

## 与 GitHub stub 的关系

未注入候选时，中央仍可查 allowlisted workflow 成功结论，但：

- `actually_ran=true` 仅表示存在性
- `fill_count`/`order_count` = unknown
- API 错误进入 `failures` / `source_coverage`，空列表不得渲染为「已验证无运行且链路正常」

## 相关文件

- `python/scripts/daily_digest_aggregator.py`
- `python/scripts/daily_digest_notify.py`
- `python/scripts/send_daily_digest_telegram.py`
- `docs/notifications-quant-sentinel.zh-CN.md`
- `docs/private-target-wiring-baseline.zh-CN.md`
- 平台生产者（Schwab）：https://github.com/QuantStrategyLab/CharlesSchwabPlatform/pull/488 ；`CharlesSchwabPlatform/docs/digest_candidates_producer.zh-CN.md`
- 平台生产者（IBKR）：https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/pull/583 ；`InteractiveBrokersPlatform/docs/digest_candidates_producer.zh-CN.md`（`runtime_report.v1` + snapshot history，无 `runtime-daily-sync`）
