# Read-only holdings: staged rollout and rollback

This runbook describes the release gates for the optional account-facts holdings
pair. It does not authorize a merge, deployment, publisher change, live write,
forced broker run, or trade. The work is not a release authorization: the
original console holdings panel (#617) has merged, and any publisher or display
change still needs separate owner approval. The console deploys only through a
manual `deploy-strategy-switch-console.yml` `workflow_dispatch` run; merging
console changes to `main` does not deploy, so release still requires separate
owner approval.

## Release order

1. **Receiver first.** Review and release the compatible receiver/frontend while
   both publishers keep stripping the two archive-only fields. Existing payloads
   remain valid; a missing pair displays “No holdings data yet”. Do not block this
   receiver stage on publishers sending holdings: the old exact-key receiver
   rejects the extended payload. Record the deployed receiver revision and verify
   ordinary read-only account-facts health before enabling any publisher change.
2. **Runtime evidence second.** Verify the approved IBKR/Schwab runtime revisions
   and a normally produced run report in restricted evidence storage. Require
   `broker_reported_positions` and `broker_reported_positions_scope` together,
   with IBKR `stocks_only` or Schwab `strategy_symbols_only`. Verify valid decimal
   strings, unique uppercase symbols, the supported row fields and 1–64 rows.
   A runtime release or synthetic test alone does not prove an actual report has
   this contract. Missing, empty, invalid or unscoped data is not zero holdings.
   Keep publisher stripping enabled while evidence is incomplete.
3. **Publisher last, separately approved.** Only after both receiver adoption and
   runtime evidence are verified, review a separate change to IBKR
   `publish_account_facts_from_report.py` and Schwab
   `publish_account_facts_from_reports.py`. Preserve paired-field validation and
   existing authentication/source bindings. Verify normal publish acceptance and
   authorized read-only readback, including the displayed scope and freshness.
   Never broaden partial coverage into a full-account inventory claim.

Keep actual reports, holdings, balances, native account identifiers and credentials
out of public PRs, fixtures and CI logs. Publish only synthetic examples and
non-sensitive revision/check outcomes. These release gates are not live evidence.

## Retention and rollback

- Holdings are part of the persisted latest **and daily** history payloads. The
  current history policy retains at most 366 UTC observation days; UI staleness
  only hides holdings and does not delete those stored payloads.
- First restore publisher stripping (both fields together) if publication needs
  to roll back. A newer ordinary payload without positions replaces the latest
  holdings instead of carrying them forward. It does not erase older daily rows.
- Do not simply redeploy the pre-holdings receiver after accepting extended
  payloads. Its exact-key validation rejects them on ingress and when projecting
  persisted history, potentially making balances/history unavailable as well.
  Prefer retaining the compatible receiver and disabling publication/display.
  Any downgrade needs a separately reviewed compatibility or data-migration plan;
  stopping publishers or waiting for UI staleness is not such a plan. Do not
  delete retained evidence to force compatibility without explicit approval.
- If another console PR lands first, reconcile this branch with the new base and
  regenerate `v2_asset_map.js`; do not hand-merge the generated payload.

## Reproducible checks (synthetic/offline)

```sh
npm ci --prefix web/strategy-switch-console
npm ci --prefix web/strategy-switch-console/frontend
npm run build --prefix web/strategy-switch-console/frontend
npm run sync:v2-assets --prefix web/strategy-switch-console/frontend
git diff --exit-code -- web/strategy-switch-console/v2_asset_map.js
CLOUDFLARE_CF_FETCH_ENABLED=false node tests/account_facts_validation.mjs
node --experimental-strip-types tests/account_history_presentation_validation.mjs
git diff --check
```

The receiver suite covers legacy payloads, paired scope validation, row bounds,
stale suppression, durable readback/idempotency, rejected-write preservation,
newer position-less snapshots and retained previous-day holdings. The existing
repository CI remains required; synthetic checks do not prove production adoption.

## 中文：发布与回退边界

本说明不授权合并、部署、修改发布器、生产写入、强制券商运行或交易。持仓改动不构成发布
授权：原控制台持仓面板（#617）已合并，发布器或展示的任何改动仍需所有者单独批准。控制台
仅通过手动触发 `deploy-strategy-switch-console.yml`（`workflow_dispatch`）部署；控制台改动
合入 `main` 不会自动部署，发布仍需单独批准。

1. 先发布兼容接收端与前端，两个发布器继续剥离持仓字段。旧载荷仍可接收，缺少
   持仓时显示“暂无持仓数据”。旧接收端拒绝扩展字段，不能把发布器先发送持仓
   作为接收端发布的前置条件。记录接收端版本并核验普通只读健康状态。
2. 再核验获批的运行时版本及正常运行产生的受限报告：持仓与范围必须成对，IBKR
   为 `stocks_only`，Schwab 为 `strategy_symbols_only`，且满足字段、十进制字符串、
   大写唯一标的及 1–64 行限制。版本发布或合成测试不等于真实报告证据；缺失、空值
   或格式错误不代表零持仓。证据未齐前继续剥离。
3. 最后在另行批准的 PR 中修改两个发布器，核验正常发送及授权只读回读的范围与
   新鲜度。不得把部分覆盖解释为账户全部持仓。实际报告、持仓、余额、账户标识与
   凭据不得进入公开 PR、测试夹具或 CI 日志。

持仓会进入最新快照和每日历史；历史最多保留 366 个 UTC 观察日。界面过期隐藏
不等于删除。回退应先恢复发布器成对剥离；更新的无持仓快照会清除最新展示，但
不会清除旧日期的持仓。旧接收端也会拒绝读取已持久化的扩展载荷，影响余额及历史
可用性，因此不能直接降级。优先保留兼容接收端并停用持仓发送/展示；降级需另行
审阅兼容或迁移方案，不能靠等待过期或未经批准删除证据解决。若其他控制台 PR
先合入，先协调基线，再按上述构建脚本重新生成资产文件，不手工合并生成内容。
上述测试覆盖兼容、范围、边界、持久化、拒写保护及历史保留，不证明生产已采用。

## LongBridge native cost compatibility

An explicitly complete LongBridge stock inventory may include the optional pair
`broker_cost_price` (signed decimal text, up to 30 integer and 28 fractional
digits) and `broker_cost_method: "broker_configured"` on each position. The value
comes directly from native `cost_price` and follows the account's average-buy or
diluted-cost setting. Negative and zero costs and trailing precision are retained.
Missing or invalid optional native costs are omitted by acquisition; malformed
extended wire records are rejected. Legacy records remain readable.

The authenticated account-facts and performance holdings APIs retain this pair.
It is separate from `avg_cost`, quotes and unrealized P/L; no cost basis, current
price or profit is derived from it. Existing frontend consumers may ignore the
new optional fields. Release the compatible receiver before extended publishers.
Keep that receiver during rollback after extended records have been persisted;
stop sending the pair before considering a receiver downgrade.

Native source contract: https://open.longbridge.com/docs/trade/asset/stock .
