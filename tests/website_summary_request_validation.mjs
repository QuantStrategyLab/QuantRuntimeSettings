import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "summary-request-"));
const originalFetch = globalThis.fetch;
try {
  const outfile = join(directory, "render.cjs");
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import PerformancePage from './src/pages/performance/PerformancePage';
    export const render = () => renderToStaticMarkup(h(I18nProvider, { language: 'zh' }, h(PerformancePage)));
  ` }, bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" }, plugins: [{ name: "exercise-read-hooks", setup(builder) {
      builder.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents: `
        export function useApi(loader) {
          Promise.resolve().then(loader).catch(() => {});
          return { phase: 'loading', data: null, error: null, reload() {} };
        }
      `, loader: "js" }));
    } }], logLevel: "silent" });
  const paths = [];
  globalThis.fetch = async path => { paths.push(String(path)); return Response.json({}); };
  createRequire(import.meta.url)(outfile).render();
  await new Promise(resolve => setTimeout(resolve, 0));
  const summaries = paths.filter(path => path.startsWith("/api/performance/summary?"));
  assert.equal(summaries.length, 1, `expected one current-range summary, got ${summaries.length}`);
  assert.ok(summaries[0].includes("range="));
  const returns = paths.filter(path => path.startsWith("/api/performance/returns?"));
  assert.equal(returns.length, 1, `expected one current-range returns request, got ${returns.length}`);
  console.log("website_summary_request_validation: PASS (one summary request for the rendered page; synthetic only)");
} finally {
  globalThis.fetch = originalFetch;
  await rm(directory, { recursive: true, force: true });
}
