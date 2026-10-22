# WEB-GAP-FIX-01 非作者独立审查

审查者：`/root/web_gap_fix_01_independent_review`，未参与实现，全程只读。

## 初审：FAIL

准确比较：`d14ac6c3d5d55f662834c7ddc54e9df06a5b5dab..fa20266bb540d8bdccb5bb6a6323ae14dbf70f26`。

P1：真实 binding 读取错误仍伪装为未配置。`application/account_facts/read.js:95` 新增 catch 捕获不到 `worker.js:10868–10875` 的 `loadAccountFactsBindings` 内部吞错。独立实际 worker.fetch + 合成 KV/DO 探针成功复现：KV account_facts_bindings get 抛错，仍返回 200、configured=false、coverage.reason=binding_missing。影响是源读取/权限故障被解释成缺绑定，与 CHANGE_PLAN/README 的 503 承诺不符。

最小修正：snapshot GET 使用可传播错误的 binding loader，其他调用保持原行为；补真实 Worker 路径的 KV throw/非法 JSON 测试，键不存在继续未配置。作者原新增测试仅注入 loader throw，未覆盖真实 loader。

其余核对：coverage 复用已验证快照和原 totals；纳入/模拟/重复/全局受阻语义一致，日期来自原投影；真实零、缺现金、未知身份符合范围；无新权限、凭据、金额或原生券商身份输出，无 UI/部署/workflow 改动。

独立命令均 exit0：`node --experimental-strip-types tests/account_facts_totals_validation.mjs`、`node tests/account_facts_readonly_extract_validation.mjs`、`node tests/console_api_worker_validation.mjs`、`git diff --check d14ac6c3d5d55f662834c7ddc54e9df06a5b5dab fa20266b`；`node --input-type=module` 实际 Worker 合成探针成功确认上述失败（探针成功不等于产品 PASS）。Skill：`requesting-code-review`，`/Users/lisiyi/.codex/skills/requesting-code-review/SKILL.md`。

## 修正后增量复审

待同一非作者审查者返回准确修正 head 的结论。
