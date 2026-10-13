# 日报 GitHub workflow allowlist 校准（P0-04）

审计基准：2026-10-09 公开仓 raw/API 取证。

## 语义边界（必读）

- **workflow success ≠ 成交/订单事实。** allowlist 命中只贡献“当日可能有过一次运行投影/发布”的存在性辅助证据；`fill_count` / `order_count` 仍为 unknown，除非 `DIGEST_CANDIDATES` 提供已知计数。
- **PAPER once ≠ live。** LongBridge `publish-runtime-daily-once.yml` 绑定 `longbridge-paper` Environment，是手动一次性 PAPER 投影，不得解读为 live 运行或正式成交。
- **heartbeat-only 永不进入 allowlist。** `execution-report-heartbeat.yml` / `runtime-heartbeat.yml` 是监控心跳，不是业务日投影入口。
- **业务证据优先候选管道。** 正式权益/持仓/信号/调仓应走 `DIGEST_CANDIDATES_*`；workflow 文件名仅作运维定位。

## 2026-10-09 路径核对

| platform_id | 原 allowlist | 公开仓结果 | 校准后 |
| --- | --- | --- | --- |
| longbridge | `publish-runtime-daily-once.yml` | 存在；name=`Publish PAPER Daily Runtime Once`；`workflow_dispatch`；PAPER | 保留；`evidence_role=paper_projection_once` |
| schwab | `publish-runtime-daily-once.yml` | **404**；正式手动入口为 `runtime-daily-sync.yml`（`Schwab Runtime Daily Manual`） | 改为 `runtime-daily-sync.yml`；`evidence_role=manual_daily_projection` |
| ibkr | `publish-runtime-daily-once.yml` | **404**；无 `runtime-daily-sync.yml` | 移入 omitted（`missing`） |
| binance | `publish-runtime-daily-once.yml` | **404**；另有 facts/heartbeat，非 daily projection | 移入 omitted（`missing`） |
| firstrade | （未列入） | 无 daily projection workflow；仅 heartbeat 等 | omitted（`no_daily_projection_workflow`）；不加入 allowlist |

配置真源：`platform-config.json` → `notifications.quant_sentinel.daily_digest.aggregator.github_workflow_allowlist` 与 `github_workflow_allowlist_omitted`。

查询分别使用 GitHub 支持的单一 `event=workflow_dispatch` 与 `event=schedule`，逐页读取后才能认定未命中；逗号拼接不是 OR，会漏掉真实运行。API/分页失败或达到结果限制时覆盖保持降级，不能据此认定无运行。只修复取证，不新增 allowlist 平台，也不将 workflow 成功换算为成交数。

Query dispatch and schedule as separate single-event filters and paginate before declaring no match. A comma-separated event is not an OR filter. API or pagination failures and result limits keep coverage degraded; the allowlist and unknown fill/order semantics remain unchanged.

## 验收

```bash
python3 -m unittest \
  python.tests.test_daily_digest_aggregator.DailyDigestAggregatorTests.test_allowlist_loaded_from_platform_config \
  python.tests.test_daily_digest_aggregator.DailyDigestAggregatorTests.test_allowlist_calibrated_paths_and_roles \
  python.tests.test_runtime_settings.RuntimeSettingsTest.test_notification_route_is_runtime_reference_only -v
```

重新取证时冻结 SHA，不要把当时的 main 自动等同线上生产。
