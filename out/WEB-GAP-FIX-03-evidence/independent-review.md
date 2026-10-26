# WEB-GAP-FIX-03 非作者独立审查

结果：**FAIL**。审查者为 `/root/web_gap_fix_03_independent_review`，未参与实现；只读审查产品及测试，只写本报告。比较基线 `289fec431ea14264ec028207c5c627fa39ecf231` 与工作区全部八个产品/测试/README/schema 改动。无远端写入，无部署，无生产读取。

## 必须修复

### P2：非 DCA 账户被显示成“未核实”的定投计划

定位：`web/strategy-switch-console/worker.js:16271-16274`（新返回 `dca_not_applicable` 对象）；调用者 `web/strategy-switch-console/frontend/src/presentation.ts:2186-2198` 及 `web/strategy-switch-console/frontend/src/AccountsPage.tsx:323,394`。

新 API 对已知非 DCA 策略和不支持 DCA 的平台显式返回两个 unknown 对象，原因明确为 `dca_not_applicable`。既有 `dcaSettingsReadout` 仅通过字段对象是否存在决定是否显示；因此原本不显示的非 DCA 账户现在显示“定投计划 / 当前设置 / 配置模式：未核实 / 基准金额：未核实”。这是实际调用者回归，将已确认“不适用”误示为配置无法核实。现有 presentation 测试只传入省略 DCA 字段的旧输入，未覆盖新 HTTP 形状。

独立复现命令（退出码 **1**，断言失败）：

```sh
node --experimental-strip-types --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { dcaSettingsReadout } from './web/strategy-switch-console/frontend/src/presentation.ts';
const before={strategy_profile:{status:'known',value:'russell_top50_leader_rotation'}};
const after={...before,dca_mode:{status:'unknown',reason:'dca_not_applicable'},dca_base_investment_usd:{status:'unknown',reason:'dca_not_applicable'}};
console.log(JSON.stringify({before:dcaSettingsReadout(before),after:dcaSettingsReadout(after)}));
assert.equal(dcaSettingsReadout(after),null,'Known non-DCA settings must not render an unverified DCA plan');
NODE
```

实际输出：`before=null`，`after={"label":"当前设置","mode":"未核实","amount":"未核实"}`。最小修复：展示投影识别 `dca_not_applicable` 并保持原本隐藏行为；保留真正读取失败和适用但缺失字段的“未核实”。补充新 API 形状的调用者回归测试。

## 已核验范围

- 七字段均沿原 `resolveCurrentStrategyForAccount`，账户匹配、仓库/environment 作用域、列表缓存及优先级未改；source 只命名该解析路径，README 中英均明确不代表券商或部署回读。
- reader 显式选择 `reportReadErrors`；其余四参数调用仍拿到原空 Map 回退。HTTP/network/JSON/列表形状/后续分页故障在有效设置路径丢弃所有七字段，无旧值保留、补0或插值。
- `known` 保留真实字符串0和false；unknown无value、diff current=null；理由白名单及固定source不泄露上游异常文本，源时间为null而非请求时间。
- HTTP Worker 回归实际经 Miniflare dispatchFetch 运行，不只是纯函数断言；涵盖账户隔离、HTTP故障、后续分页丢弃、脱敏、diff投影。尚有上述真实前端调用者回归，故不能PASS。

## 实际验证

均在隔离工作目录 `/Users/lisiyi/Projects/QuantRuntimeSettings/.worktrees/web-gap-fix-03`：

- `node tests/account_settings_worker_validation.mjs`：退出码0，PASS。
- `node tests/console_api_worker_validation.mjs && node tests/console_design_api_validation.mjs && node --experimental-strip-types tests/account_settings_state_validation.mjs && node --experimental-strip-types tests/console_presentation_validation.mjs && node tests/console_api_contract_validation.mjs && git diff --check`：退出码0，各项PASS；后两项diff无输出。
- 上述独立非DCA复现：退出码1，确认缺陷。

限制：仅合成上游与本地真实 Worker HTTP；未核验生产数据、实际GitHub token权限或部署，未申请新权限/凭据。Chrome不适用。

## 实际读取 Skill

- requesting-code-review：`/Users/lisiyi/.codex/skills/requesting-code-review/SKILL.md`
- verification-before-completion：`/Users/lisiyi/.codex/skills/verification-before-completion/SKILL.md`

已读取 `CHANGE_PLAN.md` 和 `CONTRIBUTING.md`。轻量记忆检索未发现相关条目，未以历史记忆作结论。

## 审阅文件 SHA256

- `b572297a80e1fde252e2c789204eca797af236120f3a7180c628619eb723c926` `tests/account_settings_worker_validation.mjs`
- `53980ca6e535bc875bb7f24e542a103934c292db0291d9a8657a8519c11a1111` `tests/console_api_worker_validation.mjs`
- `09d51b2c844c970397410c82e6a6ef312d2215c42e846921b839e78d242cafff` `tests/console_design_api_validation.mjs`
- `b5efb47b1305a7323d687d3ceaee9af967e5404289cc19ba26220e88294631e4` `web/strategy-switch-console/README.md`
- `01e31f4a2b4173f1834ce8f10d292a54a396521728bac6511a5e315a498aa8ec` `web/strategy-switch-console/README.zh-CN.md`
- `d32ac616605659ec2359581f0c45d40046792a6039e961511f4bd0150b75688b` `web/strategy-switch-console/application/console_api/presentation.js`
- `0e8f236d03e7daa9387c9dde9dd12910461f3a0e69d70fa1ea410eef947826e2` `web/strategy-switch-console/contracts/console-api.schema.json`
- `caa9e09bd1f4de800ea807cd48c35876734d13381f1eb530e9b2b820d82e3644` `web/strategy-switch-console/worker.js`
- `54642f279f74d5ea7946c68d058ed6365d7bda40e124ba56bccb2e742757051e` `web/strategy-switch-console/frontend/src/presentation.ts`
- `8d85d6ca22869fca90a5f7d65f87686947a2c1945fb273d8779dfb5256a30295` `web/strategy-switch-console/frontend/src/AccountsPage.tsx`


---

## 返修复核：最终 PASS

最终结论：**PASS**。初审 FAIL 与复现记录原样保留；上述P2已修复，无其他必须修复项。仍为同一非作者审查者，未修改产品、测试或远端。基线不变，最终审查范围为九个产品/测试/README/schema文件，并检查两个未改动前端调用者及更新后的 CHANGE_PLAN。

### 返修核验

- `effectiveAccountSettings` 现在返回 `{effective,effectiveRead}`，其两个生产调用点 `presentAccountSettings` 与 `saveAccountSettings` 均正确解包；`accountSettingsPayload` 唯一调用点明确传入 metadata。因此不会把wrapper误作旧设置对象，也未改变保存前可信策略判断。
- 旧 `effective` 值结构恢复，非DCA的两字段仍省略，旧 `dcaSettingsReadout` 得到null，不显示未核实定投；适用DCA但未解析出的字段仍显示未核实。实际后端resolver结果到未改动展示函数的回归已加入并独立执行。
- 顶层 `effective_read` 单独包含七字段status/source/reason/source_as_of，无value；schema覆盖七项及其metadata必需字段，新HTTP字段保持可选以兼容旧合成输入。diff继续从原effective判断值与known，仅从metadata获取白名单来源/原因，旧输入安全回退。
- 故障优先、分页丢弃、固定来源及空源时间、真实0/false保持、身份独立性仍成立；变更未修改resolver优先级、账户匹配、写权限或部署。

### 返修后独立执行

1. `node tests/account_settings_worker_validation.mjs`：退出码0，PASS；真实Miniflare HTTP回归含读取故障、分页、脱敏、值形状与diff。
2. `node tests/console_api_worker_validation.mjs && node tests/console_design_api_validation.mjs && node --experimental-strip-types tests/console_presentation_validation.mjs && node --experimental-strip-types tests/account_settings_state_validation.mjs && node tests/console_api_contract_validation.mjs && node --check web/strategy-switch-console/worker.js && git diff --check`：退出码0，全部PASS。
3. `node --experimental-strip-types --input-type=module` heredoc独立探针：退出码0，输出 `independent wrapper / non-DCA / DCA unknown / failed metadata compatibility: PASS`。探针调用实际 `effectiveAccountSettings`，mock三类GitHub响应：非DCA策略、DCA策略但无DCA值、403私有错误文本；断言七项metadata、非DCA旧展示为null且字段省略、适用DCA展示未核实、403七字段失败及diff current=null且无错误正文。
4. `node --experimental-default-type=module tests/strategy_switch_worker_validation.mjs`：退出码9；本机Node v26.3.0拒绝已移除的选项，未启动测试。采用等价当前入口 `node tests/strategy_switch_worker_validation.mjs`：退出码0，覆盖既有默认reader调用者；附带Binance scope、cycle-health与Worker验证PASS，无host external/loopback/worker outbound/direct outbound/legacy writes。

已检查作者提供的 `review-fix-validation.json`、`baseline-validation.json` 及 `baseline-python.log`。精确基线的失败模块运行13项、11项失败，日志均指向系统shell缺少mapfile；不将作者报告的873项Python全套称为本独审独立运行或全绿。Python与本卡JS路径无改动，保留CI最终判断。

实际读取的Skill仍为本报告上列两项；未新增Skill。验证仅本地合成来源与真实Worker HTTP；未核验生产数据或凭据权限，未部署。Chrome不适用。

### 最终审阅快照 SHA256

以下哈希取自返修后且上述验证通过的工作区；此最终快照取代初审快照用于PR对应核验。

- `0b0fd17ea742b573608d33eb9fe24b3dac5fd7004fe1d6c93911c88ed01e190d` `tests/account_settings_worker_validation.mjs`
- `53980ca6e535bc875bb7f24e542a103934c292db0291d9a8657a8519c11a1111` `tests/console_api_worker_validation.mjs`
- `a5c3d1b5465f0a4ce978ff7a9e2c5db5ee88da3cc5bdaffb51a0b5a8c4dc021e` `tests/console_design_api_validation.mjs`
- `cd154aabc9f4379923cf93f728d66774e08444043c5d9fe8ea30067da5f322fc` `tests/console_presentation_validation.mjs`
- `1418080884b6161bba9806083dfdf1aa793379e755cbbef97182a0fc9c4d37fb` `web/strategy-switch-console/README.md`
- `7f0cc9fc80db204618cce5cf8be4c82f9dcf674868214ab43cf53c224440236e` `web/strategy-switch-console/README.zh-CN.md`
- `74c6cda59400d23202d4f09264331e46a03327c277cab480d43f166046a2aaa2` `web/strategy-switch-console/application/console_api/presentation.js`
- `98463b6d93e271851572135bf845624f2a02972139e44c97ec6e9ebe137ea82f` `web/strategy-switch-console/contracts/console-api.schema.json`
- `80286d7df1870543b46e24922e589273428dfaea3de4fe8e9095c2582a0c6b3c` `web/strategy-switch-console/worker.js`
- `54642f279f74d5ea7946c68d058ed6365d7bda40e124ba56bccb2e742757051e` `web/strategy-switch-console/frontend/src/presentation.ts`
- `8d85d6ca22869fca90a5f7d65f87686947a2c1945fb273d8779dfb5256a30295` `web/strategy-switch-console/frontend/src/AccountsPage.tsx`
- `3acef2dc9309819a4329e4ff53ec1647075c354cae94e1caef0a162381b2d871` `out/WEB-GAP-FIX-03-evidence/CHANGE_PLAN.md`
