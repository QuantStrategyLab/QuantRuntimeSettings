import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

test("runtime KPI renders real observed coverage and explicit empty/error states without changing the API total", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fe8a-runtime-ui-"));
  const outfile = join(directory, "render.cjs");
  const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
  try {
    await build({
      stdin: { resolveDir: root, contents: `import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { RunsKpi } from './src/pages/overview/OverviewPage';
        import { I18nProvider } from './src/i18n';
        export const render = (language, state) => renderToStaticMarkup(
          createElement(I18nProvider, { language }, createElement(RunsKpi, { state })));` },
      bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic",
      loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
      plugins: [{ name: "test-runtime-card", setup(builder) {
        builder.onLoad({ filter: /\/pages\/overview\/OverviewPage\.tsx$/ }, async args => ({
          contents: `${await readFile(args.path, "utf8")}\nexport { RunsKpi };`, loader: "tsx",
        }));
      } }],
    });
    const ui = createRequire(import.meta.url)(outfile);
    const data = { status: "partial", date: "2026-10-22", counts: { configured: 8, observed: 2, runs: null } };
    for (const language of ["zh", "en"]) {
      const html = ui.render(language, { phase: "ready", data });
      assert.ok(html.includes("2/8"));
      assert.ok(!html.includes("—"));
      assert.equal(data.counts.runs, null);
      const empty = ui.render(language, { phase: "ready", data: { ...data, counts: { ...data.counts, observed: 0 } } });
      assert.ok(empty.includes(language === "zh" ? "暂无数据" : "No data"));
      assert.ok(!empty.includes("0/8"));
      assert.ok(!empty.includes("—"));
      const failed = ui.render(language, { phase: "error", error: Error("synthetic_read_failed") });
      assert.ok(failed.includes(language === "zh" ? "读取失败" : "Read failed"));
      assert.ok(!failed.includes("0/8"));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
