import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { runStatus, runStateCounts } from "../web/strategy-switch-console/application/console_api/run_status.js";
import { todaySummary } from "../web/strategy-switch-console/application/console_api/operations.js";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";

const now = Date.parse("2026-10-16T18:00:00Z");
const accounts = Array.from({ length: 10 }, (_, i) => ({ platform: i < 2 ? "longbridge" : "ibkr", key: `synthetic-${i}` }));
const bindings = accounts.slice(0, 2).map(account => ({ platform: account.platform, account_key: account.key, target_key: account.key, status: "bound" }));
const summary = await todaySummary(new Request("https://console.example/api/runtime/today"), {}, {
  dailyBindings: async () => bindings,
  daily: async request => { const url = new URL(request.url); return Response.json({ platform: url.searchParams.get("platform"), account_key: url.searchParams.get("account_key"), date: url.searchParams.get("date"), record: null }); },
}, accounts, now);
assert.equal(summary.counts.by_state.not_connected, 8); assert.equal(summary.counts.by_state.no_data, 2);
assert.equal(summary.counts.by_state.failed, 0); assert.equal(summary.counts.runs, null);
assert.equal(summary.counts.by_state.succeeded, 0);
const success = { status: "ok", activity: "filled", completeness: "complete", runs: [{ activity: "filled", errors_present: false }] };
for (const [account, expected] of [
  [success, "succeeded"], [{ ...success, activity: "blocked", runs: [{ activity: "blocked", errors_present: true }] }, "blocked"],
  [{ ...success, activity: "failed" }, "failed"], [{ ...success, status: "no_data" }, "no_data"],
  [{ ...success, status: "not_connected" }, "not_connected"], [{ ...success, status: "read_failed" }, "read_failed"],
  [{ ...success, completeness: "incomplete" }, "unknown"], [{ ...success, activity: "not_due", runs: [] }, "not_run"],
  [{ ...success, runs: [{ activity: "filled", errors_present: true }] }, "failed"],
  [{ ...success, runs: [{ activity: "blocked", errors_present: true }] }, "blocked"],
]) assert.equal(runStatus(account), expected);
assert.equal(Object.values(runStateCounts(summary.accounts)).reduce((a, b) => a + b), 10);
for (const reason of [null, "market_closed"]) {
  const blocked = await todaySummary(new Request("https://console.example/api/runtime/today"), {}, {
    dailyBindings: async () => [bindings[0]], daily: async () => Response.json({ platform: "longbridge", account_key: accounts[0].key,
      date: summary.date, data_status: "fresh", record: { business_date: summary.date, target_key: bindings[0].target_key,
        status: "blocked", block_reason_code: reason, completeness: "incomplete", runs: [{ activity: "blocked", errors_present: true }] } }),
  }, [accounts[0]], now);
  assert.equal(blocked.accounts[0].run_status, "blocked"); assert.equal(blocked.accounts[0].run_status_reason, reason);
  assert.equal(blocked.counts.by_state.failed, 0); assert.equal(blocked.counts.by_state.blocked, 1);
}
const trades = performanceBlocks({ accounts: [], histories: [], today: "2026-10-16", year: 2026, month: 10 }).trades;
assert.equal(trades.status, "not_connected"); assert.equal(trades.unavailable_reason, "fills_not_connected");
assert.equal(trades.as_of, null); assert.equal(trades.count, undefined);

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "grouping-runs-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({ stdin: { contents: `import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { AccountDirectoryContext } from './src/app/context';
    import { FreshnessTable, StatStrip, NotificationsCard } from './src/pages/health/HealthPage';
    import { coverageNote, TradesTab } from './src/pages/performance/PerformanceTabs';
    import { cellKind, todayFailures } from './src/pages/health/status';
    import { DayDetail } from './src/pages/health/RunGrid';
    const render = (language, component, props, config = null) => renderToStaticMarkup(h(I18nProvider, { language }, h(AccountDirectoryContext.Provider, { value: config }, h(component, props))));
    export { coverageNote, cellKind, todayFailures };
    export const freshness = (language, data, config) => render(language, FreshnessTable, { summary: { phase:'ready', data, reload() {} } }, config);
    export const stats = (language, data) => render(language, StatStrip, { summary: { phase:'ready', data, reload() {} }, credential: { phase:'loading' } });
    export const notifications = language => render(language, NotificationsCard, { epoch: 0 });
    export const trades = language => render(language, TradesTab, { scope:'all', range:'ALL', epoch:0 });
    export const detail = (language, snapshot) => render(language, DayDetail, { selection: { date:'2026-10-16', account: { platform:'schwab', account_alias:'live' } }, cell: { phase:'ready', snapshot } });`, resolveDir: root },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
    plugins: [{ name: "local-read-only-fixtures", setup(b) {
      b.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents: "export const useApi = () => globalThis.__groupingState;", loader: "js" }));
      for (const [file, exports] of [["HealthPage", "FreshnessTable, StatStrip, NotificationsCard"], ["PerformanceTabs", "coverageNote, TradesTab"], ["RunGrid", "DayDetail"]])
        b.onLoad({ filter: new RegExp(`/${file}\\.tsx$`) }, async ({ path }) => ({ contents: await readFile(path, "utf8") + `\nexport { ${exports} };`, loader: "tsx" }));
    } }],
  });
  const ui = createRequire(import.meta.url)(outfile);
  const config = { platformMeta: { ibkr: { label:"IBKR" }, binance: { label:"Binance" }, schwab: { label:"Schwab" } },
    accountOptions: { ibkr: [{ key:"synthetic-z", label:"Alpha" }, { key:"synthetic-a", label:"Zulu" }], binance:[{ key:"live", label:"live" }], schwab:[{ key:"live", label:"live" }] } };
  const rows = [
    { ...success, account_alias:"synthetic-a", platform:"ibkr", as_of:"2026-10-16T17:00:00Z", fresh:true },
    { ...success, account_alias:"live", platform:"schwab", as_of:null },
    { ...success, account_alias:"synthetic-z", platform:"ibkr", as_of:"2026-10-01T17:00:00Z", stale:true },
    { ...success, account_alias:"live", platform:"binance", as_of:null },
  ];
  const snapshot = { data_status:"historical", record: { kind:"run", status:"blocked", completeness:"incomplete", runs:[{ activity:"blocked", errors_present:true }] } };
  assert.equal(ui.cellKind(snapshot), "blocked"); assert.equal(ui.todayFailures({ ...summary, accounts:[{ ...success, activity:"blocked" }] }).count, 0);
  for (const language of ["zh", "en"]) {
    const html = ui.freshness(language, { ...summary, accounts:rows }, config);
    assert.ok(html.indexOf("<h3>Binance</h3>") < html.indexOf("<h3>IBKR</h3>"));
    assert.ok(html.indexOf("<h3>IBKR</h3>") < html.indexOf("<h3>Schwab</h3>"));
    assert.ok(html.indexOf(">Alpha<") < html.indexOf(">Zulu<"), "sort within platform by shared display names, not raw alias");
    assert.doesNotMatch(html, /synthetic-z|synthetic-a/);
    assert.equal((html.match(new RegExp(language === "zh" ? "数据偏旧" : ">Stale<", "g")) || []).length, 1, "one stale account cannot mark every row stale");
    const stats = ui.stats(language, summary);
    assert.ok(stats.includes(language === "zh" ? "未接入: <span class=\"num\">8" : "Not connected: <span class=\"num\">8"));
    assert.ok(stats.includes(language === "zh" ? "暂无数据: <span class=\"num\">2" : "No data: <span class=\"num\">2"));
    const detail = ui.detail(language, snapshot);
    assert.ok(detail.includes(language === "zh" ? "被拦截" : "Blocked"));
    assert.ok(detail.includes(language === "zh" ? "原因未知" : "Unknown reason"));
    assert.ok(!detail.includes(language === "zh" ? ">失败<" : ">Failed<"));
    globalThis.__groupingState = { phase:"ready", data:trades };
    const tradeHtml = ui.trades(language);
    assert.ok(tradeHtml.includes(language === "zh" ? "未接入" : "Not connected"));
    assert.doesNotMatch(tradeHtml, /0%|>0<|state\.|reason\./);
    for (const [status, expected] of [["not_connected", language === "zh" ? "未接入" : "not connected"], ["ok", language === "zh" ? "暂无通知回执" : "No notification receipts"], ["read_failed", language === "zh" ? "读取失败" : "Read failed"]]) {
      globalThis.__groupingState = { phase:"ready", data:{ status, items:[] } };
      assert.ok(ui.notifications(language).includes(expected));
    }
    globalThis.__groupingState = { phase:"ready", data:{ status:"ok", items:[{ id:"1:1", source_run_id:1, source_run_attempt:1, source_url:"https://github.com/example/console/actions/runs/1", workflow_updated_at:"2026-10-16T23:00:00Z", sent_at:null, status:"blocked_resend_guard", delivered:false, dry_run:false, test_message:false, reason_code:"HISTORY_UNAVAILABLE", business_day:"2026-10-16" }] } };
    const notifications = ui.notifications(language);
    assert.doesNotMatch(notifications, /health\.|common\.|state\./); assert.match(notifications, /2026-10-16/);
    assert.ok(notifications.includes(language === "zh" ? "无法读取发送历史" : "Send history unavailable"));
  }
  const calls = [];
  const coverage = ui.coverageNote({ coverage:[{ platform:"binance", account_alias:"live" }, { platform:"schwab", account_alias:"live" }, { platform:"ibkr", account_alias:"synthetic-z" }] }, {
    platform: platform => config.platformMeta[platform].label,
    account: (alias, platform) => { calls.push([alias,platform]); return platform === "ibkr" ? "Alpha" : "live"; },
  });
  assert.equal(coverage, "Binance: live; IBKR: Alpha; Schwab: live");
  assert.ok(calls.every(([, platform]) => platform));
} finally { delete globalThis.__groupingState; await rm(directory, { recursive:true, force:true }); }
console.log("console_grouping_runs_validation: PASS (8 unconnected + 2 missing, separate block/failure, unknown reasons, platform/account ordering, per-row flags, coverage identity, honest fills, notification states zh/en)");
