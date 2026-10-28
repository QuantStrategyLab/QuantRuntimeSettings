import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "currency-ranking-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { RankingTab, rankHoldingsByCurrency } from './src/pages/performance/PerformanceTabs';
    export { rankHoldingsByCurrency };
    export const render = (language, data) => renderToStaticMarkup(h(I18nProvider, { language }, h(RankingTab, { state: { phase: 'ready', data, reload() {} } })));
  ` }, bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" }, plugins: [{ name: "ranking-test-export", setup(builder) {
      builder.onLoad({ filter: /\/PerformanceTabs\.tsx$/ }, async ({ path }) => ({
        contents: await readFile(path, "utf8") + "\nexport { RankingTab, rankHoldingsByCurrency };", loader: "tsx",
      }));
    } }], logLevel: "silent" });
  const ui = createRequire(import.meta.url)(outfile);
  const row = (account, symbol, currency, pnl) => ({ platform: "synthetic", account_alias: account, symbol,
    currency, quantity: 1, avg_cost: 100, unrealized_pnl: pnl, status: "ok" });
  const rows = [row("alpha", "ABC", "USD", 10), row("beta", "ABC", "USD", 20),
    row("gamma", "ABC", "JPY", 1000), row("delta", "XYZ", "USD", -5), row("none", "MISSING", "", 10000)];
  const result = ui.rankHoldingsByCurrency(rows, item => item.account_alias);
  assert.deepEqual(result.groups.map(group => group.currency), ["JPY", "USD"]);
  const usd = result.groups.find(group => group.currency === "USD");
  assert.deepEqual(usd.winners.map(item => item.label), ["ABC · beta", "ABC · alpha"]);
  assert.deepEqual(usd.losers.map(item => item.label), ["XYZ · delta"]);
  assert.equal(result.missingCurrencyCount, 1);
  for (const language of ["zh", "en"]) {
    const html = ui.render(language, { status: "ok", rows });
    assert.match(html, /data-currency="USD"/);
    assert.match(html, /data-currency="JPY"/);
    assert.doesNotMatch(html, /MISSING/);
    assert.ok(html.includes(language === "zh" ? "未提供币种" : "without a currency"));
    const noMovement = ui.render(language, { status: "ok", rows: [row("a", "ZERO", "USD", 0), row("b", "MISSING", "", 1)] });
    assert.ok(noMovement.includes(language === "zh" ? "未提供币种" : "without a currency"));
  }
  console.log("website_currency_ranking_validation: PASS (separate currencies, native ordering, distinct accounts and missing currency; synthetic only)");
} finally { await rm(directory, { recursive: true, force: true }); }
