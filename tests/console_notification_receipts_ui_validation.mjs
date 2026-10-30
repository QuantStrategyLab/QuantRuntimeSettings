import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { createNotificationLogReader } from "../web/strategy-switch-console/application/console_api/notification_receipts.js";

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "notification-receipts-ui-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({
    stdin: { resolveDir: root, contents: `import { createElement as h } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { I18nProvider } from './src/i18n';
      import { NotificationsCard } from './src/pages/health/HealthPage';
      export const render = (language, state) => {
        // The page lifts notification state so the KPI and card share one read;
        // this SSR harness injects that state directly.
        return renderToStaticMarkup(h(I18nProvider, { language }, h(NotificationsCard, { state: { reload: () => {}, ...state } })));
      };` },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic",
    loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
    plugins: [{ name: "controlled-notification-read", setup(builder) {
      builder.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({
        contents: "export const useApi = () => ({ ...globalThis.__notificationState, reload: () => {} });", loader: "js",
      }));
      // Expose the actual private card only inside the SSR test bundle.
      builder.onLoad({ filter: /\/pages\/health\/HealthPage\.tsx$/ }, async ({ path }) => ({
        contents: `${await readFile(path, "utf8")}\nexport { NotificationsCard };`, loader: "tsx",
      }));
    } }],
  });
  const { render } = createRequire(import.meta.url)(outfile);
  const ready = data => ({ phase: "ready", data, error: null });
  const options = { repository: "synthetic/receipts", token: "synthetic-token" };
  const read = async response => createNotificationLogReader(async () => response, () => 0)(options);
  const empty = await read(Response.json({ total_count: 0, workflow_runs: [] }));
  const partial = await read(Response.json({ total_count: 2, workflow_runs: [] }));
  const unknown = await read(Response.json({ workflow_runs: [] }));
  const failed = await read(new Response(null, { status: 403 }));
  const disconnected = await createNotificationLogReader()();
  const item = { id: "1:1", source_run_id: 1, source_run_attempt: 1, source_sha: "a".repeat(40),
    source_url: "https://github.com/synthetic/receipts/actions/runs/1/attempts/1", workflow_updated_at: null,
    sent_at: null, channel: "telegram", status: "receipt_missing", receipt_status: null,
    business_day: null, report_date: null, delivered: null, dry_run: null, test_message: null, reason_code: null };

  for (const language of ["zh", "en"]) {
    const copy = language === "zh" ? {
      incomplete: "部分通知记录可能缺失。", emptyPartial: "当前没有可展示的回执，不能据此确认没有通知。",
      empty: "暂无通知记录", failed: "暂时无法加载", retry: "重试", disconnected: "通知发送记录未接入。",
      scope: "以下来自旧 GitHub 回执，仅表示旧流程记录；不能验证当前 Cloud Run/GCS 通知是否被接受或送达。",
      scheduleScope: "现行设计为 07:00 生成并发送、07:30 只读查看同日期和同范围回执；不表示当天已经发送或检查。accepted 只表示 Telegram 接受请求，不表示用户已读。",
      unverified: "当前通知：未验证", legacyStatus: "旧回执状态", legacyDelivered: "旧记录标记送达",
      legacyTitle: "旧 GitHub 日报回执", retiredClaim: "日报通知送达", unknown: "未知",
      missing: "未找到发送记录",
    } : {
      incomplete: "Some notification records may be missing.",
      emptyPartial: "No receipts are available to display; this does not confirm that no notifications exist.",
      empty: "No notification records", failed: "Unable to load", retry: "Retry", disconnected: "The notification log is not connected.",
      scope: "These are legacy GitHub receipts for an earlier workflow. They cannot verify whether the current Cloud Run/GCS notification was accepted or delivered.",
      scheduleScope: "The current design generates and sends at 07:00, then performs a read-only receipt check for the same date and scope at 07:30. This does not claim either step ran today. Accepted means Telegram accepted the request, not that the user has read it.",
      unverified: "Current notification: Unverified", legacyStatus: "Legacy receipt status",
      legacyDelivered: "Marked delivered in legacy record", legacyTitle: "Legacy GitHub digest receipts",
      retiredClaim: "Digest notifications delivered", unknown: "Unknown",
      missing: "Notification record missing",
    };

    test(`${language}: empty partial/unknown/truncated reads retain the coverage warning in SSR`, () => {
      for (const data of [partial, unknown, { ...empty, status: "partial" },
        { ...empty, read_status: "partial" }, { ...empty, read_status: "unknown" },
        { ...empty, truncated: true }, { ...empty, read_status: undefined, status: "partial" }]) {
        const before = structuredClone(data);
        const html = render(language, ready(data));
        assert.ok(html.includes(copy.incomplete), `missing coverage warning: ${JSON.stringify(data)}`);
        assert.ok(html.includes('role="alert"'));
        assert.ok(html.includes(copy.emptyPartial));
        assert.ok(html.includes(copy.scope));
        // The source limit is stated in the open, not only inside a disclosure.
        assert.ok(html.includes(copy.unverified), "the static unverified statement is always rendered");
        assert.ok(html.includes(copy.scheduleScope), "the 07:00/07:30 scope is stated in the open");
        assert.ok(!html.includes(copy.retiredClaim), "the retired unqualified delivery claim is gone");
        assert.ok(!html.includes(copy.empty));
        assert.ok(!html.includes("<table"));
        assert.deepEqual(data, before, "rendering must not fill or mutate missing records");
        assert.equal(data.items.length, 0);
      }
    });

    test(`${language}: legacy receipts are labelled as legacy and never as current delivery`, () => {
      for (const data of [{ ...partial, items: [item] }, { ...empty, read_status: "complete", items: [item] }]) {
        const html = render(language, ready(data));
        assert.ok(html.includes("<table"));
        assert.ok(html.includes(copy.legacyTitle), "the table caption names the legacy source");
        assert.ok(html.includes(copy.legacyStatus), "the status column is qualified as legacy");
        assert.ok(html.includes(copy.legacyDelivered), "the delivered flag is qualified as a legacy record");
        assert.ok(html.includes(copy.unverified));
        assert.ok(html.includes(copy.scope));
        assert.ok(html.includes(copy.scheduleScope));
        assert.ok(!html.includes(copy.retiredClaim));
        // delivered: null stays unknown; it is never upgraded to a current "yes".
        assert.ok(html.includes(copy.unknown));
      }
    });

    test(`${language}: confirmed empty, failed, disconnected and loading states stay distinct`, () => {
      const html = render(language, ready(empty));
      assert.ok(html.includes(copy.empty));
      assert.ok(!html.includes(copy.incomplete));
      assert.ok(!html.includes('role="alert"'));
      for (const state of [ready(failed), ready({ ...empty, read_status: "read_failed" }),
        { phase: "error", data: null, error: new Error("synthetic transport failure") }]) {
        const errorHtml = render(language, state);
        assert.ok(errorHtml.includes(copy.failed));
        assert.ok(errorHtml.includes('data-state="read_failed"'));
        assert.ok(errorHtml.includes('role="alert"'));
        assert.ok(errorHtml.includes(copy.retry));
        assert.ok(!errorHtml.includes(copy.empty));
        assert.ok(!errorHtml.includes(copy.emptyPartial));
      }
      for (const data of [disconnected, { ...empty, read_status: "not_connected" }]) {
        const disconnectedHtml = render(language, ready(data));
        assert.ok(disconnectedHtml.includes(copy.disconnected));
        assert.ok(!disconnectedHtml.includes(copy.empty));
      }
      const loading = render(language, { phase: "loading", data: null, error: null });
      assert.ok(loading.includes("skeleton"));
      assert.ok(!loading.includes(copy.empty));
    });

    test(`${language}: nonempty partial retains real rows and unknown source fields`, () => {
      for (const data of [{ ...partial, items: [item] }, { ...empty, read_status: "partial", items: [item] },
        { ...empty, read_status: "complete", items: [item] }]) {
        const before = structuredClone(data);
        const html = render(language, ready(data));
        assert.ok(html.includes("<table"));
        assert.ok(html.includes(copy.missing));
        assert.ok(html.includes(item.source_url));
        assert.ok(html.includes("—"));
        assert.equal(html.includes(copy.incomplete), data.read_status !== "complete");
        assert.ok(!html.includes(copy.emptyPartial));
        assert.deepEqual(data, before);
        assert.equal(data.items[0].sent_at, null);
        assert.equal(data.items[0].delivered, null);
      }
    });
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
