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
  // `percent` is the server-computed unrealized P/L percentage. It is deliberately
  // NOT pnl / (avg_cost * quantity) * 100, so any browser-side re-derivation shows up.
  const row = (account, symbol, currency, pnl, percent) => ({ platform: "synthetic", account_alias: account, symbol,
    currency, quantity: 1, avg_cost: 100, unrealized_pnl: pnl, unrealized_pnl_percent: percent, status: "ok" });
  const rows = [row("alpha", "ABC", "USD", 10, 12.5), row("beta", "ABC", "USD", 20, 25),
    row("gamma", "ABC", "JPY", 1000, 40), row("delta", "XYZ", "USD", -5, -3.75), row("none", "MISSING", "", 10000, 5)];
  const result = ui.rankHoldingsByCurrency(rows, item => item.account_alias);
  assert.deepEqual(result.groups.map(group => group.currency), ["JPY", "USD"]);
  const usd = result.groups.find(group => group.currency === "USD");
  // Membership and order still follow the native unrealized amount.
  assert.deepEqual(usd.winners.map(item => item.label), ["ABC · beta", "ABC · alpha"]);
  assert.deepEqual(usd.losers.map(item => item.label), ["XYZ · delta"]);
  // The bar value is the server percentage, not the amount and not a division.
  assert.deepEqual(usd.winners.map(item => item.value), [25, 12.5]);
  assert.deepEqual(usd.losers.map(item => item.value), [-3.75]);
  assert.equal(result.missingCurrencyCount, 1);
  for (const language of ["zh", "en"]) {
    const html = ui.render(language, { status: "ok", rows });
    assert.match(html, /data-currency="USD"/);
    assert.match(html, /data-currency="JPY"/);
    assert.doesNotMatch(html, /MISSING/);
    assert.ok(html.includes(language === "zh" ? "未提供币种" : "without a currency"));
    // Visible percentages come from the server field.
    assert.ok(html.includes("25.00%"), "the server percentage is shown");
    assert.ok(html.includes("12.50%"), "the server percentage is shown for the runner-up");
    assert.ok(html.includes("-3.75%"), "a negative server percentage is shown");
    assert.ok(!html.includes("20.00%") && !html.includes("10.00%"),
      "the old pnl / cost-basis division is not used as the bar value");
    const noMovement = ui.render(language, { status: "ok", rows: [row("a", "ZERO", "USD", 0, 0), row("b", "MISSING", "", 1, 1)] });
    assert.ok(noMovement.includes(language === "zh" ? "未提供币种" : "without a currency"));

    // An explicit 0% is a real value, not a missing one.
    const zero = ui.render(language, { status: "ok", rows: [row("a", "FLAT", "USD", 5, 0)] });
    assert.ok(zero.includes("FLAT"), "a 0% holding is still ranked");
    assert.ok(zero.includes("0.00%"), "0 is a valid percentage");

    // A missing or null server field is unavailable: no zero, no fallback maths.
    for (const legacyRows of [
      [{ ...row("alpha", "ABC", "USD", 10, 12.5), unrealized_pnl_percent: undefined }],
      [{ ...row("alpha", "ABC", "USD", 10, 12.5), unrealized_pnl_percent: null }],
      [{ ...row("alpha", "ABC", "USD", 10, 12.5), unrealized_pnl_percent: Number.NaN }],
      [{ ...row("alpha", "ABC", "USD", 10, 12.5), unrealized_pnl_percent: "12.5" }],
    ]) {
      assert.deepEqual(ui.rankHoldingsByCurrency(legacyRows, item => item.account_alias).groups, [],
        "a row without a usable server percentage is not ranked");
      const legacyHtml = ui.render(language, { status: "ok", rows: legacyRows });
      assert.ok(!legacyHtml.includes("0.00%"), "a missing percentage never becomes zero");
      assert.ok(!legacyHtml.includes("10.00%"), "a missing percentage is never re-derived from the amount");
      assert.ok(legacyHtml.includes(language === "zh" ? "暂无可排名的持仓" : "No holdings are eligible for ranking"));
      assert.ok(legacyHtml.includes(language === "zh"
        ? "缺少可用于排行的持仓收益数据" : "Eligible holding return data is unavailable"),
      "the empty state names unavailable return data");
      assert.ok(!legacyHtml.includes("服务端提供未实现盈亏比例")
        && !legacyHtml.includes("server-computed unrealized P/L percentage"),
      "the empty state carries no backend-contract wording");
    }
  }
  console.log("website_currency_ranking_validation: PASS (separate currencies, native ordering, server percentages, distinct accounts and missing currency/percentage; synthetic only)");
} finally { await rm(directory, { recursive: true, force: true }); }
