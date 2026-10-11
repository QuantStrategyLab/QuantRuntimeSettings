# Offline producer → receiver contracts

This offline gate executes the **real upstream projection and strip functions**,
then sends their unchanged synthetic output through QRS's authenticated sync
handler, local Miniflare SQLite persistence, read model and balance history.
It does not run either publisher CLI, use credentials, contact a broker/cloud,
change publisher stripping, deploy, merge, or establish runtime adoption.

## Pinned evidence and current result

- [IBKR bd5c1a12d9cd0df8dbd88c1eb8b058b7b849990f](https://github.com/QuantStrategyLab/InteractiveBrokersPlatform/blob/bd5c1a12d9cd0df8dbd88c1eb8b058b7b849990f/scripts/publish_account_facts_from_report.py):
  `project_ibkr_account_facts_history` plus `strip_archive_only_keys`.
  The stripped contract is accepted. The pre-strip archive contract is accepted
  with `stocks_only`; this is **future publication compatibility**, not enabled
  publication. A newer real stripped projection clears latest holdings while
  previous-day holdings remain in durable history. Null net assets remain gaps.
- [Schwab 5b563ad3609eefd9cf431ead82d0f30c586645db](https://github.com/QuantStrategyLab/CharlesSchwabPlatform/blob/5b563ad3609eefd9cf431ead82d0f30c586645db/scripts/publish_account_facts_from_reports.py):
  `project_schwab_account_facts_history` plus `strip_archive_only_keys`.
  The stripped contract is accepted, balances/history remain readable, and absent
  cash stays absent. The unchanged archive contract is now accepted: each
  projected holding carries `currency_source: "owner_confirmed"`, explicitly
  validated and preserved by QRS in latest readback and durable daily history.
  Unknown keys and malformed provenance are rejected without changing accepted
  data. A newer stripped payload clears latest holdings and retains older evidence.
  This is **future publication compatibility**, not enabled publication.

The receiver baseline is QRS
[6070efb73cde35fd5ffafd5d3da196e04b462e42](https://github.com/QuantStrategyLab/QuantRuntimeSettings/commit/6070efb73cde35fd5ffafd5d3da196e04b462e42).
It is exercised from the current checkout so future receiver changes remain
visible against these pinned producer contracts. This complements the existing
`account_facts_validation.mjs` malformed-payload and rollback coverage, rather
than replacing it or duplicating the full validator matrix.

### Schwab provenance compatibility decision

QRS accepts the optional holding field `currency_source` only for Schwab, only
with the exact value `owner_confirmed`, and only alongside an explicit `USD`
currency. It does not infer a currency or add provenance to legacy rows lacking
this field. All other unknown row keys remain invalid, and IBKR's contract is
unchanged. Optional `avg_cost` remains independently decimal-validated.

The pinned producer's `_project_positions` accepts runtime currency `None` or
`USD` and explicitly marks the resulting USD as owner-confirmed. A boundary
projection that drops this field would discard that distinction. Preserving it
requires only a narrow receiver normalization/type extension, no producer edits,
new dependencies, storage migration or changes to broker execution. Existing
Schwab holdings without provenance remain readable for backward compatibility.

Keep current publisher stripping enabled. Receiver release needs separate
approval (merging console runtime changes to `main` triggers automatic deploy),
followed by deployed-revision/read-only health evidence and actual restricted
runtime-report evidence, before any separately approved publisher enablement.
See [holdings rollout and rollback](account-facts-holdings-rollout.md). After new
rows have been stored, a receiver downgrade that rejects `currency_source` can
also reject retained history; retain this compatibility unless a separate
migration/downgrade plan is approved. This suite does not establish production
adoption or execute an actual receiver downgrade.

## Reproduce

The two report templates under `tests/fixtures/producer_contract/` contain only
invented account identifiers, balances and holdings. Service/profile strings that
upstream treats as constants are contract identifiers, not evidence of access.
The source manifests record repository, exact Git revision, path and SHA-256 of
the imported file. No production source is vendored and no runtime dependency or
runtime configuration is added. Regeneration fails on a different checkout HEAD
or changed projection bytes. Deliberate pin updates require reviewing both source
and digest changes, then rerunning this test; `main` is never used in CI.

After obtaining these two repositories and checking out the exact revisions
above (network setup only), run from QRS:

```sh
npm ci --prefix web/strategy-switch-console
python3 tests/generate_producer_contract.py --ibkr ../InteractiveBrokersPlatform --schwab ../CharlesSchwabPlatform > /tmp/contract-a.json
python3 tests/generate_producer_contract.py --ibkr ../InteractiveBrokersPlatform --schwab ../CharlesSchwabPlatform > /tmp/contract-b.json
cmp /tmp/contract-a.json /tmp/contract-b.json
CLOUDFLARE_CF_FETCH_ENABLED=false node tests/producer_receiver_contract_validation.mjs ../InteractiveBrokersPlatform ../CharlesSchwabPlatform
node tests/account_facts_validation.mjs
python3 python/scripts/runtime_settings.py validate
python3 -m unittest discover -s python/tests -v
git diff --check
```

The generator's default `--now` is fixed for reproducibility. The roundtrip test
passes the current UTC time **into synthetic report generation before projection**
to exercise production freshness gates without rewriting projected output.
All report times and report-path provenance are generated consistently. Previous
observations are within the receiver's 36-hour window and on older UTC days.

Both imported scripts have stdlib-only imports and a guarded CLI entry point.
Before importing them, the generator clears the environment and installs
fail-on-call guards for sockets, HTTP and subprocess creation. It checks that no
guard was called, even if upstream catches a raised error. Receiver outbound
fetches are likewise blocked and counted. Only Miniflare's local transport is
used. CI fetch/install steps require network; projection and roundtrip assertions
are offline. Source checkout failures fail CI; they are never reported as skipped
or successful coverage. No generated account payload is uploaded as an artifact.

## 中文说明

这项测试仅使用合成报表，执行固定 SHA 的真实投影函数和字段剥离函数，再经过
接收端鉴权、本地 SQLite、读模型和历史查询。不会运行发布器 CLI、访问实盘、
使用凭据、改变发布开关、合并或部署。

- IBKR：当前剥离载荷可接收；归档扩展载荷的 `stocks_only` 也可接收，但这只是
  未来发布契约兼容性。更新的剥离载荷清除最新持仓，旧日期证据保留，未知资产
  仍为历史缺口而不是零。
- Schwab：当前剥离载荷与未修改的扩展归档载荷均可接收；每行显式
  `currency_source: owner_confirmed` 会保留在最新读模型及每日历史。未知字段、
  非法来源或来源搭配非 USD 货币均拒绝，且不覆盖已接收的数据。新的剥离载荷
  清除最新持仓，但保留旧日期证据。CI 通过不代表已开启持仓发送。

采用接收端窄范围兼容：该可选字段仅允许 Schwab 的显式 USD 与
`owner_confirmed`，不补货币、不推断来源；无来源的旧行仍可读，IBKR 不变。
发布器将运行时未知货币投影为所有者确认的 USD，删除字段会丢失这一区别，
因此显式校验并保留；不改发布器、固定版本、存储结构或部署流程。
继续保持剥离。接收端合并会自动部署，需另行批准；再核验已部署版本、只读健康
和受限真实运行报告，最后单独批准发布器启用。写入带来源的历史后，直接降级到
拒绝该字段的接收端会影响历史读取，需独立兼容或迁移方案。合成测试不证明生产
采用，也未执行真实降级。

源清单记录仓库、完整 SHA、文件路径和内容摘要；生成器检查版本及字节一致，
不会复制生产代码或增加运行依赖。默认固定时间用于重复生成比对，集成测试在
投影前生成当前时间的合成报表以验证时效。导入前阻断网络和子进程并清空环境，
接收端外部请求同样阻断；CI 仅检出与依赖安装需要网络。源码取不到就失败，
不会把未执行说成通过，也不上传生成的账户载荷。
