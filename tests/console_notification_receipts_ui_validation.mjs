import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { createNotificationLogReader } from "../web/strategy-switch-console/application/console_api/notification_receipts.js";

/*
 * The health page no longer presents a notification module: there is no
 * trustworthy source for "what is the current notification state", and the old
 * GitHub receipts are transport diagnostics, not run status. This file therefore
 * keeps two jobs:
 *
 * 1. Prove the read-only receipt API still exists and still classifies reads.
 *    Removing the UI is not retiring the API.
 * 2. Prove the health page renders no legacy/current notification module and
 *    issues no notification request, while keeping its other real states.
 */

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const options = { repository: "synthetic/receipts", token: "synthetic-token" };
const read = async response => createNotificationLogReader(async () => response, () => 0)(options);

test("read-only receipt API still classifies empty, partial, unknown, failed and disconnected reads", async () => {
  const empty = await read(Response.json({ total_count: 0, workflow_runs: [] }));
  const partial = await read(Response.json({ total_count: 2, workflow_runs: [] }));
  const unknown = await read(Response.json({ workflow_runs: [] }));
  const failed = await read(new Response(null, { status: 403 }));
  const disconnected = await createNotificationLogReader()();
  assert.equal(empty.items.length, 0);
  assert.equal(empty.read_status, "no_data");
  assert.deepEqual(empty.read_reason_codes, ["no_completed_workflow_runs"]);
  assert.equal(partial.read_status, "partial");
  assert.ok(partial.read_reason_codes.includes("run_listing_incomplete"));
  assert.equal(unknown.read_status, "unknown");
  assert.ok(unknown.read_reason_codes.includes("run_listing_coverage_unknown"));
  assert.equal(failed.status, "read_failed");
  assert.equal(disconnected.status, "not_connected");
  // A receipt read reports read coverage only; it never claims current delivery.
  for (const result of [empty, partial, unknown]) assert.ok(!("delivered" in result));
});

const directory = await mkdtemp(join(tmpdir(), "notification-receipts-ui-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({
    stdin: { resolveDir: root, contents: `import { createElement as h } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { I18nProvider } from './src/i18n';
      import HealthPage from './src/pages/health/HealthPage';
      export const render = language => renderToStaticMarkup(h(I18nProvider, { language }, h(HealthPage)));` },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic",
    loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
    plugins: [{ name: "recorded-health-loaders", setup(builder) {
      // Every loader the page calls is recorded, so a stray notification read
      // shows up as a counter rather than passing silently.
      builder.onLoad({ filter: /\/api\/endpoints\.ts$/ }, () => ({
        contents: `const named = (name, fn) => { fn.loaderName = name; return fn; };
          const LOADING = { __loading: true };
          const deferred = name => (globalThis.__loading || []).includes(name) ? LOADING : null;
          export const loadTodayRuns = named('loadTodayRuns', () => {
            globalThis.__calls.push('loadTodayRuns');
            if (globalThis.__throw === 'loadTodayRuns') throw new Error('synthetic read failure');
            return deferred('loadTodayRuns') || globalThis.__fx.todayRuns; });
          export const loadCredentialMaintenance = named('loadCredentialMaintenance', () => {
            globalThis.__calls.push('loadCredentialMaintenance');
            if (globalThis.__throw === 'loadCredentialMaintenance') throw new Error('synthetic read failure');
            return deferred('loadCredentialMaintenance') || globalThis.__fx.credential; });
          export const loadAccounts = named('loadAccounts', () => {
            globalThis.__calls.push('loadAccounts'); return globalThis.__fx.accounts; });
          export const loadRuntimeDailyBindings = named('loadRuntimeDailyBindings', () => {
            globalThis.__calls.push('loadRuntimeDailyBindings'); return globalThis.__fx.bindings; });
          export const loadRuntimeDaily = named('loadRuntimeDaily', () => {
            globalThis.__calls.push('loadRuntimeDaily'); return globalThis.__fx.daily; });
          export const loadNotificationLog = named('loadNotificationLog', () => {
            globalThis.__notificationRequests += 1;
            throw new Error('the health page must not request the notification log'); });`,
        loader: "js",
      }));
      // Call the loader during render so the counters above observe real calls.
      builder.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({
        contents: `export function useApi(loader) {
            try {
              const data = loader();
              if (data && data.__loading) return { phase: 'loading', data: null, error: null, reload() {} };
              return { phase: 'ready', data, error: null, reload() {} };
            } catch (error) { return { phase: 'error', data: null, error, reload() {} }; }
          }
          export const createRequestGate = () => ({ start: () => 1, current: () => true, invalidate() {} });`,
        loader: "js",
      }));
    } }],
  });
  const ui = createRequire(import.meta.url)(outfile);

  const account = (alias, activity, runStatus) => ({
    account_alias: alias, platform: "ibkr", status: "ok", unavailable_reason: null,
    as_of: "2026-10-30T20:00:00Z", activity, run_status: runStatus, completeness: "complete",
    run_count: 1, runs: [{ activity, errors_present: runStatus === "failed" }],
  });
  const todayRuns = {
    status: "ok", date: "2026-10-30", timezone: "America/New_York", as_of: "2026-10-30T20:00:00Z",
    coverage: "complete", no_order: true, execution_authority_granted: false,
    counts: { configured: 2, observed: 2, runs: 2 },
    accounts: [account("alpha", "no_submission", "succeeded"), account("beta", "failed", "failed")],
  };
  const fixtures = {
    todayRuns,
    credential: { id: "ibkr_flex", phase: "not_due", expires_at: null, requires_action: false },
    accounts: { accounts: [] },
    bindings: [],
    daily: null,
  };

  const render = (language, override = {}) => {
    globalThis.__fx = { ...fixtures, ...override };
    globalThis.__calls = [];
    globalThis.__notificationRequests = 0;
    globalThis.__loading = [];
    globalThis.__throw = null;
    return ui.render(language);
  };

  // Copy that only the removed module rendered.
  const REMOVED = {
    zh: ["旧 GitHub 日报回执", "当前通知", "来源限制", "旧回执状态", "旧记录标记送达", "查看原因",
      "以下来自旧 GitHub 回执", "07:00", "07:30", "暂无通知记录", "部分通知记录可能缺失"],
    en: ["Legacy GitHub digest receipts", "Current notification", "Source limits", "Legacy receipt status",
      "Marked delivered in legacy record", "View reason", "These are legacy GitHub receipts",
      "07:00", "07:30", "No notification records", "Some notification records may be missing"],
  };
  // The four audited KPI titles, in order.
  const KPIS = {
    zh: ["完整数据账户", "今日有记录账户", "今日失败账户", "凭证"],
    en: ["Accounts with complete data", "Accounts with today's records", "Today's failed accounts", "Credentials"],
  };
  const decode = text => text
    .replaceAll("&#x27;", "'").replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const titles = html => [...html.matchAll(/class="kpi-title">([^<]*)</g)].map(match => decode(match[1]));

  for (const language of ["zh", "en"]) {
    test(`${language}: health renders no notification module and issues no notification request`, () => {
      const html = render(language);
      for (const copy of REMOVED[language]) {
        assert.ok(!html.includes(copy), `removed notification copy is still rendered: ${copy}`);
      }
      // The copy keys are gone too, so a stray t() call would surface the raw key.
      for (const key of ["health.kpi.notifications", "health.current_notification", "health.source_limits",
        "health.notifications_", "health.notification_", "health.notification."]) {
        assert.ok(!html.includes(key), `a removed notification key is still referenced: ${key}`);
      }
      // No current-status claim, no legacy receipt table, no raw run/attempt link.
      assert.ok(!html.includes("health-notifications"), "the legacy receipt table block is gone");
      assert.ok(!html.includes("health-source-note"), "the legacy source-limit block is gone");
      assert.ok(!html.includes("notification-reason"), "the legacy reason disclosure is gone");
      assert.ok(!html.includes("actions/runs"), "no raw run/attempt link is rendered");
      assert.ok(!html.includes("data-state=\"unverified\""), "no faux current-notification badge is rendered");
      assert.equal(globalThis.__notificationRequests, 0, "the page must not request the notification log");
      assert.ok(!globalThis.__calls.includes("loadNotificationLog"), "no notification loader runs");
      // Only the freshness and credential tables remain.
      assert.equal((html.match(/<table/g) || []).length, 2, "only freshness and credential tables remain");
      // The page itself is intact.
      assert.ok(html.includes(language === "zh" ? "运行状态" : "Run status"));
      assert.ok(html.includes(language === "zh" ? "近 14 个纽约业务日" : "Last 14 New York business days"));
      assert.ok(html.includes(language === "zh" ? "数据新鲜度" : "Data freshness"));
      assert.ok(html.includes(language === "zh" ? "凭证到期" : "Credential expiry"));
    });

    test(`${language}: exactly four KPIs in the audited order`, () => {
      const html = render(language);
      assert.ok(html.includes('class="stat-strip health-kpis"'), "the health strip carries its own four-column hook");
      assert.deepEqual(titles(html), KPIS[language]);
    });

    test(`${language}: real read-failure, credential-error and loading states survive the removal`, () => {
      // A read-failed summary still reports the failure in the KPIs and the table.
      const failed = render(language, { todayRuns: { ...todayRuns, status: "read_failed" } });
      assert.ok(failed.includes(language === "zh" ? "读取失败" : "Read failed"));
      assert.ok(failed.includes('role="alert"'));
      assert.deepEqual(titles(failed), KPIS[language], "the four KPIs stay even when the read failed");

      // A credential read error still offers a retry.
      globalThis.__throw = "loadCredentialMaintenance";
      globalThis.__fx = { ...fixtures };
      globalThis.__calls = [];
      const errorHtml = ui.render(language);
      assert.ok(errorHtml.includes(language === "zh" ? "重试" : "Retry"), "a failed credential read keeps its retry");
      assert.equal(globalThis.__notificationRequests, 0);

      // Loading still shows skeletons rather than an empty page.
      globalThis.__fx = { ...fixtures };
      globalThis.__loading = ["loadTodayRuns"];
      const loadingHtml = ui.render(language);
      assert.ok(loadingHtml.includes("skeleton"), "the loading state still renders skeletons");
      assert.equal(globalThis.__notificationRequests, 0);
      globalThis.__loading = [];
      globalThis.__throw = null;
    });
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
