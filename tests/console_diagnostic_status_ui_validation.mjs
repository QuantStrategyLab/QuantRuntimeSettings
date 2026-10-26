import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

// SSR-render the production StatusBadge/Badge/Money/Percent with production
// translations. Data-availability states must leave only a hidden, zero-space
// diagnostic marker (status + reason) in both locales; real operational
// outcomes keep their visible icon and text, and the business Badge is
// untouched. Unknown amounts stay an em dash and never become zero.
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

  // Only data availability is quieted; operational outcomes stay loud.
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

    // 1. Data availability: no text, icon, badge box or layout space, but the
    //    exact state and reason remain machine-readable in both locales.
    for (const value of DIAGNOSTIC) {
      const html = ui.status(language, value, REASON);
      const stateLabel = ui.label(language, `state.${value}`);
      ok(visibleText(html) === "", `${language}/${value}: data-availability state shows no visible text`);
      ok(!html.includes("<svg") && !html.includes("badge"), `${language}/${value}: no icon or badge box is rendered`);
      ok(html.startsWith("<span hidden"), `${language}/${value}: the marker is hidden, so it takes no space`);
      ok(html.includes(`data-status="${value}"`), `${language}/${value}: exact status stays in metadata`);
      ok(html.includes(`data-reason="${REASON}"`), `${language}/${value}: reason stays in metadata`);
      ok(!html.includes(stateLabel), `${language}/${value}: the state label is not printed`);
      ok(!html.includes("state."), `${language}/${value}: no raw message key leaks`);
    }
    ok(!ui.status(language, "partial", REASON).includes(s.partial), "the partial label is gone in both locales");

    // 2. A missing status is the same unknown data-availability state; a missing
    //    reason adds no attribute instead of inventing one.
    for (const value of [null, undefined, ""]) {
      const html = ui.status(language, value, null);
      ok(html.startsWith("<span hidden") && html.includes('data-status="unknown"'),
        "a missing status stays a hidden unknown marker");
      ok(!html.includes("data-reason"), "an absent reason adds no data-reason attribute");
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

    // 6. The hidden marker never replaces a value next to it.
    const value = ui.money(language, 42.5, "USD");
    ok(value.includes("42.50") && visibleText(ui.status(language, "partial", REASON)) === "",
      "a hidden partial marker leaves the adjacent amount intact");
  }

  console.log(`console_diagnostic_status_ui_validation: PASS (${checks} assertions, zh/en × data-availability/operational/badge/amounts; synthetic fixtures only)`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
