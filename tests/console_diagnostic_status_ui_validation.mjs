import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

// SSR-render the production StatusBadge/Badge/Money/Percent with production
// translations. Data-availability and operational states must remain visible
// in both locales, with exact status and reason available for diagnosis.
// Unknown amounts stay an em dash and never become zero.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "console-diagnostic-status-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({
    stdin: {
      contents: `import { createElement as h } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { I18nProvider, translate } from './src/i18n';
        import { Badge, Money, Percent, StatusBadge } from './src/components/primitives';
        const render = (language, component) => renderToStaticMarkup(h(I18nProvider, { language }, component));
        export const status = (language, value, reason) => render(language, h(StatusBadge, { status: value, reason }));
        export const pendingBadge = language =>
          render(language, h(Badge, { tone: 'warn' }, translate(language, 'decisions.status.pending')));
        export const money = (language, value, currency) => render(language, h(Money, { value, currency }));
        export const percent = (language, value) => render(language, h(Percent, { value }));
        export const label = (language, key) => translate(language, key);`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" },
  });
  const ui = createRequire(import.meta.url)(outfile);

  // Missing or stale data is material user information, just like run outcomes.
  const DIAGNOSTIC = ["partial", "stale", "no_data", "not_connected", "unavailable", "unknown", "read_failed", "read_incomplete", "insufficient"];
  const OPERATIONAL = ["failed", "blocked", "critical", "watch", "review", "healthy", "previewed"];
  const REASON = "runtime_daily_not_connected";
  const LABEL = {
    zh: { partial: "部分数据", failed: "运行失败", blocked: "运行受阻", pending: "待处理" },
    en: { partial: "Partial", failed: "Failed", blocked: "Blocked", pending: "Pending" },
  };

  let checks = 0;
  const ok = (...args) => { assert.ok(...args); checks += 1; };
  const visibleText = html => html.replace(/<[^>]*>/g, "").trim();

  for (const language of ["zh", "en"]) {
    const s = LABEL[language];

    // 1. Data availability stays visible and retains exact metadata.
    for (const value of DIAGNOSTIC) {
      const html = ui.status(language, value, REASON);
      ok(visibleText(html).includes(ui.label(language, `state.${value}`)), `${language}/${value}: availability is visible`);
      ok(html.includes('badge'), `${language}/${value}: status has a short badge`);
      ok(!/<[^>]+(?:^|\s)hidden(?:[=\s>])/.test(html), `${language}/${value}: status is not hidden`);
      ok(html.includes(`data-status="${value}"`), `${language}/${value}: exact status stays in metadata`);
      ok(html.includes(`data-reason="${REASON}"`), `${language}/${value}: reason stays in metadata`);
      ok(html.includes('title='), `${language}/${value}: reason remains available`);
      ok(!html.includes('state.'), `${language}/${value}: no raw message key leaks`);
    }
    ok(ui.status(language, 'partial', REASON).includes(s.partial), 'partial coverage is visible in both locales');

    // 2. A missing status is visible unknown; no reason is invented.
    for (const value of [null, undefined, '']) {
      const html = ui.status(language, value, null);
      ok(html.includes('data-status="unknown"') && visibleText(html).length > 0,
        'a missing status remains a visible unknown state');
      ok(!html.includes('data-reason'), 'an absent reason adds no data-reason attribute');
    }

    // 3. Real run/business outcomes keep icon plus text.
    for (const value of OPERATIONAL) {
      const html = ui.status(language, value, REASON);
      ok(html.includes(ui.label(language, `state.${value}`)), `${language}/${value}: operational state stays visible`);
      ok(html.includes("<svg") && html.includes("badge"), `${language}/${value}: keeps its badge and icon`);
      ok(!/<[^>]+(?:^|\s)hidden(?:[=\s>])/.test(html), `${language}/${value}: operational state is never hidden`);
    }
    ok(ui.status(language, "failed", null).includes(s.failed), "a failed run stays visible");
    ok(ui.status(language, "blocked", null).includes(s.blocked), "a blocked run stays visible");

    // 4. The business Badge (pending to-do) is untouched.
    const pending = ui.pendingBadge(language);
    ok(pending.includes(s.pending) && pending.includes("badge-warn") && !/<[^>]+(?:^|\s)hidden(?:[=\s>])/.test(pending),
      "a pending to-do keeps its visible business badge");

    // 5. Values: unknown stays an em dash, a reported zero stays zero.
    ok(visibleText(ui.money(language, null, "USD")) === "—", "a missing amount is an em dash");
    ok(!ui.money(language, undefined, "USD").includes("0"), "an unknown amount is never rendered as 0");
    ok(ui.money(language, 0, "USD").includes("0.00"), "a reported zero is still a real zero");
    ok(ui.money(language, 1234.56, "USD").includes("1,234.56"), "a known amount keeps its value");
    ok(visibleText(ui.percent(language, null)) === "—", "a missing percent is an em dash");
    ok(ui.percent(language, 0).includes("0.00%"), "a zero percent is still zero");
    ok(ui.percent(language, 1.25).includes("+1.25%"), "a known percent keeps its sign and value");

    // 6. A visible status never replaces a value next to it.
    const value = ui.money(language, 42.5, "USD");
    ok(value.includes("42.50") && visibleText(ui.status(language, "partial", REASON)).includes(s.partial),
      "a visible partial status leaves the adjacent amount intact");
  }

  console.log(`console_diagnostic_status_ui_validation: PASS (${checks} assertions, zh/en × data-availability/operational/badge/amounts; synthetic fixtures only)`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
