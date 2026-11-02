# Account overview audit implementation / 账户总览审计实施

This change follows page 7 of the user-provided **前端 UI 重构方案** and the accompanying Claude notes: horizontal navigation, open asset summary with freshness, broker cards, pending-decision preview, 14-day runtime history, local SVG brand/theme icons, and a login background covering the viewport. Existing page components already split the App; this change extracts only presentation icons and the new preview/history panels, leaving operation handlers in place.

本改动依据用户提供的《前端 UI 重构方案》第 7 页及 Claude 对应备注：横向导航、资产与资料新鲜度、券商卡片、待办预览、14 天运行网格、本地 SVG 品牌与主题图标，以及覆盖完整视口的登录背景。页面组件已存在，本次进一步拆出展示图标与两个总览面板，保留原操作处理器。

Engineering references are limited to React's official [component extraction](https://react.dev/learn/importing-and-exporting-components) and [Effect cleanup for fetched data](https://react.dev/learn/synchronizing-with-effects#fetching-data). They guide the implementation; the approved PDF remains the visual reference. 技术资料仅参考 React 官方组件拆分与读取响应清理说明；视觉仍以已批准 PDF 为准。

## Read-only history / 只读历史

- Use the existing [runtime-daily API](../web/strategy-switch-console/frontend/src/api.ts) with `date`, `platform`, and `account_key`. The [Worker](../web/strategy-switch-console/worker.js) checks the authenticated session and trusted target binding before reading stored KV projections. No new endpoint or producer is introduced.
- Fourteen **calendar dates** end on the current New York business date; they are not fourteen trading days. Today reuses the existing overview read. The thirteen prior dates are fetched only for eligible bound selections, with at most four historical reads in flight; a changed target/date, explicit read-model refresh, or unmount invalidates stale responses. This panel installs no polling or focus-triggered reads.
- An account/target/business-date mismatch, stale/unavailable data, future/invalid observation time, unbound source, or absent record stays grey. Missing records do not prove that an account did not run. Complete cycle records require the existing [run-evidence contract](../web/strategy-switch-console/runtime_daily_contract.js); a no-submission cycle remains “no trading,” not a fill or return. Source errors/incomplete evidence are partial; verified run failures are errors. Scheduled non-run states remain grey with their actual status in the accessible label/title.
- No account is enabled and no order, approval, promotion, strategy write, or budget change is issued by the overview.

使用现有 API 的 `date`、`platform`、`account_key` 读取已存储投影，沿用会话与可信目标绑定检查。网格为最近 14 个纽约日历日期，当日复用已有读取，其余 13 日只读取已绑定来源；历史并发上限为 4，绑定、日期或刷新版本变化后不接纳旧响应。没有新增轮询、焦点刷新、接口或生产器。

身份或日期不匹配、过期资料、未来时间、未绑定与缺记录均为灰色；缺记录不能证明没有运行。绿色只表示契约可验证的完整周期，`no_submission` 仍显示无交易，不代表成交或收益。部分来源错误与未完整证据为黄色，可验证的失败为红色。原有计划未到期等状态保持灰色，并保留准确的可访问文字。

## Preserved financial and workflow meaning / 保留财务与流程语义

The asset/cash calculations, decimal arithmetic, USD/USDT reporting rule, unavailable FX omissions, negative-cash indication, native strategy names, account identity checks, lifecycle monitoring, activation labels, and all settings/decision controls remain unchanged. Broker cards are a presentation of the existing account table. Paper accounts continue to be excluded from the existing asset summary/card selection; configured paper accounts may have an honest runtime-history row. Example broker names and numbers in the PDF are not installed as production data.

The preview uses the same `humanDecisionQueue` as the existing navigation/decision screen; failed or incomplete sources remain explicit. It only navigates to that screen. Existing application-approval items remain available through that screen's application section; this preview does not claim to be a combined approval queue.

资产、现金、十进制换算、USD/USDT 口径、缺汇率省略、负现金、策略名、账户身份检查、监测与启停双状态，以及所有设置和决策操作保持原有语义。卡片仅调整现有账户表的展示；模拟资金与账户继续不纳入原有汇总/卡片选择，已配置模拟账户可以显示真实运行记录行。PDF 示例名称和数字没有写入生产数据。

待办预览沿用现有 `humanDecisionQueue`，明确说明读取失败或来源不完整，只导航到已有决策页。原有应用审批项仍在该页的应用区，本预览不声称已经合并审批队列。

## Validation / 验证

Run from repository root:

```sh
npm ci --prefix web/strategy-switch-console/frontend
npm run build --prefix web/strategy-switch-console/frontend
npm run sync:v2-assets --prefix web/strategy-switch-console/frontend
node --experimental-strip-types tests/runtime_history_validation.mjs
node tests/console_v2_i18n_validation.mjs
node --experimental-strip-types tests/console_presentation_validation.mjs
node --experimental-strip-types tests/overview_account_metadata_validation.mjs
node --experimental-strip-types tests/account_status_layers_validation.mjs
node tests/runtime_daily_worker_validation.mjs
git diff --check
```

Rendered QA used the production build with local Playwright because the Browser plugin was unavailable. Desktop 1440×1000 and mobile 375×900 used exclusively mocked same-origin GET responses; no production data or external API was fetched. Checks covered four-column/stacked cards, no horizontal overflow, header/main separation, actual pending-preview navigation, theme/language, accessible user-menu controls, and the denied-login SVG/background. A synthetic six-account fixture produced 84 calendar cells; its sole eligible daily binding requested fourteen unique dates, with today's read occurring once. Complete, partial, failure and unknown cases were distinct. These fixtures prove client presentation and read scheduling, not real deployment/provider integration.

浏览器验证使用生产构建和本地 Playwright（本次无 Browser 插件），在 1440×1000 桌面与 375×900 手机视口，仅模拟同源 GET，未读取生产或外部数据。检查四列/单列卡片、无横向溢出、导航不覆盖正文、待办跳转、主题/语言、用户菜单及未登录页图标和背景。合成 6 账户形成 84 个格子，仅一项已绑定来源读取 14 个不同日期，当日只读取一次；完整、部分、失败、未知分别呈现。这些证据验证客户端，不证明实际部署或生产器接通。

The source-dev server has a pre-existing Vite import-order failure around the bottom React import in `locales.ts`; the unchanged production build was used for QA. The legacy returns area retains its “no qualified return” state and existing index legend. Dual monitoring/activation labels remain separate rather than collapsing them into the PDF's illustrative single status. No deployment, promotion or runtime-success claim is made by this document.

源文件开发服务器的 `locales.ts` 底部 React 导入存在既有 Vite 导入顺序问题，本次使用生产构建验证，未顺带改动。收益区保留原有“暂无合格收益”和指数图例；监测与启停仍分别显示，没有压缩成 PDF 示意单状态。本文不声称已部署、晋级或真实运行成功。

The existing asset generator checks a POSIX path suffix. On Windows, an external local harness normalized `node:path` separators before running the unchanged generator; no guard or assertion was removed. Linux CI runs the original command above. 既有资源生成器检查 POSIX 路径后缀，本地 Windows 使用外部兼容脚本规范化路径分隔符后运行原生成器，没有删除检查或断言；Linux CI 使用上列原命令。
