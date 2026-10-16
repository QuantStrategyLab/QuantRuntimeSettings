import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { mixedReturns } from "./fixtures/console-gaps.ts";

// Render the actual component and locale dictionaries; substitute only its I/O hook and chart sink.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "console-returns-"));
const outfile = join(directory, "render.cjs");
try {
  await build({ stdin: { contents: `import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { ReturnsCard } from './src/pages/performance/ReturnsCard';
    import { I18nProvider } from './src/i18n';
    export const render = language => renderToStaticMarkup(createElement(I18nProvider, { language },
      createElement(ReturnsCard, { scope: 'all', range: 'ALL', epoch: 0 })));`,
    resolveDir: root }, bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", define: { "import.meta.env": "{}" },
    plugins: [{ name: "controlled-read", setup(b) {
      b.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents:
        "export const useApi = () => ({ phase: 'ready', data: globalThis.__gapReturns, reload() {} });", loader: "js" }));
      b.onLoad({ filter: /\/charts\/LineChart\.tsx$/ }, () => ({ contents:
        "export function LineChart(props) { globalThis.__gapCharts.push(props); return null; }", loader: "js" }));
      if (process.env.CONSOLE_RETURNS_BASELINE) b.onLoad({ filter: /\/ReturnsCard\.tsx$/ }, async () => ({
        contents: await readFile(process.env.CONSOLE_RETURNS_BASELINE, "utf8"), loader: "tsx" }));
    } }],
  });
  const { render } = createRequire(import.meta.url)(outfile);
  for (const language of ["zh", "en"]) {
    globalThis.__gapReturns = mixedReturns;
    globalThis.__gapCharts = [];
    const html = render(language);
    assert.equal(globalThis.__gapCharts.length, 1, "a mixed-currency aggregate must not hide the valid USDT group");
    assert.equal(globalThis.__gapCharts[0].series[0].points.length, 7);
    assert.match(html, /USD<\/h3>/);
    assert.match(html, /USDT<\/h3>/);
    assert.ok(html.includes(language === "zh" ? "非 TWR" : "not TWR"));
    assert.ok(!html.includes(language === "zh" ? "时间加权收益率（TWR）" : "Time-weighted return (TWR)"));
    assert.doesNotMatch(html, /state\.|reason\.|perf\./);
    globalThis.__gapReturns = { ...mixedReturns, status: "unavailable", unavailable_reason: "stored_records_unreadable" };
    globalThis.__gapCharts = [];
    render(language);
    assert.equal(globalThis.__gapCharts.length, 0, "a store failure cannot be bypassed by retained groups");
    globalThis.__gapReturns = { ...mixedReturns, per_currency: [] };
    assert.doesNotMatch(render(language), /perf-currency-block/);
  }
} finally {
  delete globalThis.__gapReturns;
  delete globalThis.__gapCharts;
  await rm(directory, { recursive: true, force: true });
}
console.log("console_returns_adapter_validation: PASS (zh/en, 7 USDT points, no TWR, failed/empty groups)");
