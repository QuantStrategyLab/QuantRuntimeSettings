import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { zhCN } from "../web/strategy-switch-console/frontend/src/i18n/zh-CN.ts";
import { en as coreEn } from "../web/strategy-switch-console/frontend/src/i18n/en.ts";
import { zh as perfZh, en as perfEn } from "../web/strategy-switch-console/frontend/src/i18n/pages/performance.ts";

// Render the production SummaryCards/ReturnsCard with production translations,
// replacing only the data hook. Fixtures are captured PR #712 synthetic responses
// (see tests/fixtures/cashflow_method/PROVENANCE.md); the frontend never recomputes them.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const fixture = name => require(`./fixtures/cashflow_method/${name}.json`);

const directory = await mkdtemp(join(tmpdir(), "console-dietz-"));
const outfile = join(directory, "render.cjs");
try {
  await build({
    stdin: {
      contents: `import { createElement as h } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { SummaryCards } from './src/pages/performance/SummaryCards';
        import { ReturnsCard } from './src/pages/performance/ReturnsCard';
        import { I18nProvider } from './src/i18n';
        export const cards = (language, data) =>
          renderToStaticMarkup(h(I18nProvider, { language },
            h(SummaryCards, { scope: 'all', platform: undefined, state: globalThis.__dietzState })));
        export const returns = (language, data, scope = 'all') =>
          renderToStaticMarkup(h(I18nProvider, { language },
            h(ReturnsCard, { scope, platform: undefined, range: 'ALL', epoch: 0 })));`,
      resolveDir: root,
    },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" },
    plugins: [{ name: "controlled-read", setup(b) {
      b.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents:
        "export const useApi = () => globalThis.__dietzState;", loader: "js" }));
    } }],
  });
  const ui = require(outfile);
  const DIETZ = { zh: "Modified Dietz（近似）", en: "Modified Dietz (approximate)" };
  const TWR_KIND = { zh: "时间加权收益率（TWR）", en: "Time-weighted return (TWR)" };
  const ASSET_CHANGE = { zh: "资产变化 · 含出入金影响", en: "Asset change · includes cash flows" };
  const ASSET_CHANGE_TITLE = { zh: "资产变化", en: "Asset change" };
  const ASSET_CHANGE_NOTE = {
    zh: "暂时无法计算收益，以下展示资产变化（%）。该变化包含出入金影响，不代表时间加权收益，也不与基准比较。",
    en: "Returns are unavailable; the chart shows asset change (%), including the effect of cash flows. It is not a time-weighted return and is not compared with benchmarks.",
  };
  const RETURNS_TITLE = { zh: "收益率", en: "Returns" };
  const RETURNS_ARIA = { zh: "收益率 vs 基准", en: "Returns vs benchmarks" };

  // Balance wording outside the unadjusted ReturnsCard curve must stay untouched.
  assert.equal(zhCN["perf.assets_title"], "总资产");
  assert.equal(coreEn["perf.assets_title"], "Total assets");
  assert.equal(perfZh["perf.calendar_asset_balance"], "资产余额");
  assert.equal(perfEn["perf.calendar_asset_balance"], "Asset balance");
  assert.equal(perfZh["perf.native_totals_note"], "按币种分别展示，不换汇。");
  assert.equal(perfEn["perf.native_totals_note"], "Shown by currency without FX conversion.");
  const STALE = { zh: "数据偏旧", en: "Stale" };
  const AS_OF = { zh: "数据截至", en: "Data as of" };
  const UNKNOWN = { zh: "收益计算方式未知", en: "Return method unknown" };
  const UNAVAILABLE = { zh: "暂不可计算", en: "Unavailable" };
  const NO_DATA = { zh: "暂无数据", en: "No data" };

  const renderCards = (language, data) => {
    globalThis.__dietzState = { phase: "ready", data, reload() {} };
    return ui.cards(language, data);
  };
  const renderReturns = (language, data, scope) => {
    globalThis.__dietzState = { phase: "ready", data, reload() {} };
    return ui.returns(language, data, scope);
  };
  const kindLabel = html => html.match(/<span class="perf-kind">([\s\S]*?)<\/span>/)?.[1] ?? null;
  const cardTitle = html => html.match(/<h2 class="card-title">([\s\S]*?)<\/h2>/)?.[1] ?? null;
  const chartAria = html => html.match(/<svg[^>]*aria-label="([^"]*)"/)?.[1] ?? null;
  // Collapsed <details> content stays in SSR but is not part of the default view.
  const outsideDetails = html => html.replace(/<details[\s\S]*?<\/details>/g, "");
  const detailsText = html => [...html.matchAll(/<details[\s\S]*?<\/details>/g)].map(match => match[0]).join("");
  const visibleText = html => outsideDetails(html).replace(/<[^>]*>/g, " ");
  const visibleWarnBadges = html => [...outsideDetails(html).matchAll(/<span class="badge badge-warn"[^>]*>([\s\S]*?)<\/span>/g)]
    .map(match => match[1].replace(/<[^>]*>/g, ""));
  let checks = 0;
  const ok = (...args) => { assert.ok(...args); checks += 1; };

  for (const language of ["zh", "en"]) {
    // 1. Real captured API response: explicit Modified Dietz + approximate metadata.
    const dietz = fixture("dietz-api");
    const dietzCards = renderCards(language, dietz.summary);
    ok(dietzCards.includes("+10.00%"), "backend value rendered as-is");
    ok(dietzCards.includes(DIETZ[language]), "summary card carries the approximate label");
    ok(dietzCards.includes(language === "zh" ? "累计收益（TWR）" : "Cumulative return (TWR)"), "card title unchanged");
    const dietzReturns = renderReturns(language, dietz.returns);
    assert.equal(kindLabel(dietzReturns), DIETZ[language], "curve kind label matches the card label");
    checks += 1;
    assert.equal(chartAria(dietzReturns), RETURNS_ARIA[language], "Modified Dietz keeps the return aria-label");
    checks += 1;
    ok(!cardTitle(dietzReturns)?.includes(ASSET_CHANGE_TITLE[language]), "Modified Dietz is not titled as an asset change");
    ok(dietzReturns.includes(language === "zh" ? "采用 Modified Dietz 近似法" : "Modified Dietz is used and labeled as approximate"),
      "method note explains the approximation instead of contradicting it");

    // 2. Qualified TWR without method metadata keeps the plain TWR label.
    const twr = fixture("twr-core");
    assert.ok(!("cashflow_method" in twr.summary) && !("approximate" in twr.summary)
      && !("cashflow_method" in twr.returns) && !("approximate" in twr.returns),
      "twr-core carries no method keys at all (legacy/absent, not explicit null)");
    checks += 1;
    const twrCards = renderCards(language, twr.summary);
    ok(twrCards.includes("+10.00%"));
    ok(!twrCards.includes(DIETZ[language]), "qualified TWR is not relabeled");
    const twrReturns = renderReturns(language, twr.returns);
    assert.equal(kindLabel(twrReturns), TWR_KIND[language]);
    checks += 1;
    assert.equal(cardTitle(twrReturns), RETURNS_TITLE[language], "qualified TWR keeps the returns title");
    checks += 1;
    assert.equal(chartAria(twrReturns), RETURNS_ARIA[language], "qualified TWR keeps the return aria-label");
    checks += 1;
    ok(!twrReturns.includes(ASSET_CHANGE[language]), "qualified TWR is never labelled as an asset change");
    ok(!twrReturns.includes(language === "zh" ? "采用 Modified Dietz 近似法" : "Modified Dietz is used and labeled as approximate"),
      "method note stays the original TWR explanation");

    // 3. Legacy response without any optional fields keeps working unchanged.
    const old = fixture("old-api");
    const oldCards = renderCards(language, old.summary);
    ok(!oldCards.includes(DIETZ[language]));
    ok(oldCards.includes("—"), "missing TWR stays an honest blank");
    ok(!oldCards.includes("+0.00%"), "unknown TWR is never shown as zero");
    const missingCashflowReason = language === "zh" ? "缺少完整出入金记录，无法计算 TWR 及其回撤。"
      : "Complete cash-flow records are missing; TWR and its drawdown cannot be calculated.";
    ok(oldCards.includes('data-reason="no_cashflow_data"'), "TWR-unavailable reason remains diagnostic");
    ok(!visibleText(oldCards).includes(missingCashflowReason), "the shared reason does not occupy each metric card");
    checks += 1;
    ok(!oldCards.includes("<details"), "summary metrics keep no audit details block");
    ok(visibleText(oldCards).includes(UNAVAILABLE[language]), "the missing TWR keeps a short visible state");
    const oldReturns = renderReturns(language, old.returns);
    assert.equal(kindLabel(oldReturns), ASSET_CHANGE[language], "unadjusted ratio is labelled as asset change, not a return or balance");
    checks += 1;
    assert.equal(cardTitle(oldReturns), ASSET_CHANGE_TITLE[language], "unadjusted ratio title matches the percent-change curve");
    checks += 1;
    assert.equal(chartAria(oldReturns), ASSET_CHANGE_TITLE[language], "unadjusted ratio aria-label names asset change");
    checks += 1;
    ok(detailsText(oldReturns).includes(language === "zh" ? "包含出入金影响，不代表时间加权收益，也不与基准比较" : "including the effect of cash flows; it is not a time-weighted return and is not compared with benchmarks"), "method help preserves cash-flow, non-TWR and benchmark qualifications");
    ok(!visibleText(oldReturns).includes(ASSET_CHANGE_NOTE[language]), "asset-change explanation stays collapsed");
    ok(!oldReturns.includes(language === "zh" ? "资产余额" : "Asset balance"),
      "unadjusted ReturnsCard no longer calls the percent-change curve a balance");
    ok(detailsText(oldReturns).includes(language === "zh" ? "图中仅展示资产变化" : "The chart shows asset change"),
      "method note uses the asset-change wording");

    // Metric-specific reasons are not re-explained per card; values stay honest blanks.
    const specific = structuredClone(twr.summary);
    specific.excess_returns = [{ benchmark: "纳斯达克100", start: "2026-10-01", end: null,
      percentage_points: null, unavailable_reason: "benchmark_history_missing" }];
    specific.best_day = { date: "2026-10-16", amount: null, return_percent: null, value_kind: "pnl",
      status: "unavailable", unavailable_reason: "no_snapshot" };
    specific.worst_day = { ...specific.best_day, unavailable_reason: "no_cashflow_data" };
    const specificCards = renderCards(language, specific);
    ok(!specificCards.includes("<details"), "no per-metric audit details");
    ok(!specificCards.includes("+0.00%"), "unavailable metrics never become zero");
    ok(visibleText(specificCards).includes(UNAVAILABLE[language]), "unavailable metric keeps a short visible state");
    ok(visibleText(specificCards).includes(NO_DATA[language]), "missing day keeps a short visible state");

    // 4. Unknown/incomplete source stays unknown, never a fake zero or a hidden Dietz.
    const unknown = fixture("unknown-core");
    const unknownCards = renderCards(language, unknown.summary);
    ok(unknownCards.includes("—"));
    ok(!unknownCards.includes("+0.00%"));
    ok(!unknownCards.includes(DIETZ[language]));
    const unknownReturns = renderReturns(language, unknown.returns);
    ok(!unknownReturns.includes(DIETZ[language]));

    // 5. Two currencies: each entry keeps its own method metadata; nothing is merged.
    const two = fixture("two-currency-core");
    const twoCards = renderCards(language, two.summary);
    ok(twoCards.includes('data-reason="mixed_currency"'), "mixed-currency state remains diagnostic without merging values");
    ok(!twoCards.includes(language === "zh" ? "按原币种分别展示，不换汇" : "Shown separately in native currencies"),
      "native-currency internal note stays out of the default view");
    ok(twoCards.indexOf("HKD") < twoCards.indexOf("USD"), "both currency rows rendered separately");
    ok(twoCards.indexOf(DIETZ[language]) > twoCards.indexOf("USD")
      && (twoCards.match(/Modified Dietz/g) || []).length === 1,
      "only the USD row carries the approximate tag");
    const drawdownReasons = structuredClone(two.summary);
    drawdownReasons.per_currency[0].max_drawdown.unavailable_reason = "no_snapshot";
    drawdownReasons.per_currency[1].max_drawdown.percent = null;
    drawdownReasons.per_currency[1].max_drawdown.unavailable_reason = "no_cashflow_data";
    const drawdownCards = renderCards(language, drawdownReasons);
    const drawdownTexts = language === "zh"
      ? ["暂无可用估值。", "缺少完整出入金记录，无法计算 TWR 及其回撤。"]
      : ["No valuation is available.", "Complete cash-flow records are missing; TWR and its drawdown cannot be calculated."];
    ok(drawdownCards.includes('data-state="no_snapshot"') && drawdownCards.includes('data-state="no_cashflow_data"'),
      "each missing drawdown retains its distinct diagnostic state");
    for (const reason of drawdownTexts) ok(!visibleText(drawdownCards).includes(reason), "drawdown reasons do not stretch the metric grid");
    ok(!drawdownCards.includes("<details"), "per-currency drawdown keeps no audit details");
    ok(visibleText(drawdownCards).includes("HKD") && visibleText(drawdownCards).includes("USD"),
      "currency labels remain visible next to their drawdowns");
    ok(visibleText(drawdownCards).includes(DIETZ[language]), "the real approximate method tag remains visible");
    ok(visibleText(drawdownCards).includes("—"), "missing drawdowns keep an honest blank");
    const twoReturns = renderReturns(language, two.returns, "all");
    ok(twoReturns.includes(">USD</button>") && twoReturns.includes(">HKD</button>"), "currency switch offers each entry");
    assert.equal((twoReturns.match(/class="perf-kind"/g) || []).length, 1, "only the selected currency curve is rendered");
    checks += 1;
    assert.equal(kindLabel(twoReturns), DIETZ[language], "default USD curve labeled Modified Dietz approximate");
    checks += 1;
    assert.doesNotMatch(twoReturns, /perf-currency-block/, "curves are switched, never stacked or merged");
    const hkdOnly = structuredClone(two);
    const usdEmpty = hkdOnly.returns.per_currency.find(e => e.currency === "USD");
    usdEmpty.status = "no_data"; usdEmpty.points = []; usdEmpty.unavailable_reason = "snapshot_history_missing";
    const hkdReturns = renderReturns(language, hkdOnly.returns, "all");
    assert.equal(kindLabel(hkdReturns), ASSET_CHANGE[language], "HKD entry keeps its own unadjusted asset-change label");
    checks += 1;
    assert.equal(cardTitle(hkdReturns), ASSET_CHANGE_TITLE[language], "multi-currency asset-change title is consistent");
    checks += 1;
    assert.equal(chartAria(hkdReturns), `${ASSET_CHANGE_TITLE[language]} HKD`,
      "multi-currency aria-label names asset change with its currency");
    checks += 1;
    ok(!hkdReturns.includes(DIETZ[language]), "HKD entry not overwritten by the USD method");

    // 6. Stale data keeps its freshness signal; a missing method flag is not treated as qualified Dietz.
    const stale = fixture("stale-core");
    const staleCards = renderCards(language, stale.summary);
    ok(staleCards.includes("+10.00%"));
    ok(staleCards.includes('data-status="stale"'),
      "summary retains stale status as a visible status");
    const asOfLabels = [...staleCards.matchAll(/class="asof"[^>]*>([\s\S]*?)<\/span>/g)];
    assert.equal(asOfLabels.length, 1, "stale summary shows exactly one as-of caption");
    ok(asOfLabels[0][1].includes(AS_OF[language]) && asOfLabels[0][1].includes("2026-10-16"),
      "stale summary preserves its business date without inventing a clock time");
    ok(!staleCards.includes(DIETZ[language]), "no method metadata means no approximate label");
    // A real stale reason must stay reachable too, without becoming default body copy.
    const staleWithReason = structuredClone(stale.summary);
    staleWithReason.unavailable_reason = "snapshot_history_missing";
    const staleReasonCards = renderCards(language, staleWithReason);
    const staleReason = language === "zh" ? "缺少历史资产快照" : "Historical asset snapshots are missing";
    ok(staleReasonCards.includes('data-status="stale"'),
      "stale reason variant stays a visible status");
    ok(staleReasonCards.includes('data-reason="snapshot_history_missing"'), "the stale reason remains diagnostic");
    ok(!visibleText(staleReasonCards).includes(staleReason), "the stale reason does not repeat below the short state");
    checks += 1;
    const staleReturns = renderReturns(language, stale.returns);
    assert.equal(kindLabel(staleReturns), TWR_KIND[language]);
    checks += 1;
    ok(staleReturns.includes('data-status="stale"'), "curve keeps the exact stale diagnostic with a short badge");

    // 7. In-memory contract variants (synthetic, derived from the fixed samples; golden fixtures untouched).
    // 7a. Legacy response with the method fields entirely absent keeps the old TWR behavior.
    const absent = structuredClone(twr);
    delete absent.summary.cashflow_method; delete absent.summary.approximate;
    delete absent.returns.cashflow_method; delete absent.returns.approximate;
    const absentCards = renderCards(language, absent.summary);
    ok(absentCards.includes(language === "zh" ? "累计收益（TWR）" : "Cumulative return (TWR)"), "absent metadata keeps the TWR title");
    ok(!absentCards.includes(DIETZ[language]) && !absentCards.includes(UNKNOWN[language]));
    assert.equal(kindLabel(renderReturns(language, absent.returns)), TWR_KIND[language]);
    checks += 1;

    // 7b. Explicit null method fields (keys actually present, values null): undecidable, never labeled TWR.
    const explicitNull = structuredClone(twr);
    explicitNull.summary.cashflow_method = null; explicitNull.summary.approximate = null;
    explicitNull.returns.cashflow_method = null; explicitNull.returns.approximate = null;
    assert.ok("cashflow_method" in explicitNull.summary && "approximate" in explicitNull.summary
      && "cashflow_method" in explicitNull.returns && "approximate" in explicitNull.returns,
      "variant really carries explicit null keys on both blocks");
    checks += 1;
    const enCards = renderCards(language, explicitNull.summary);
    ok(enCards.includes("+10.00%"), "backend value still rendered as-is");
    ok(!enCards.includes("TWR"), "explicit null leaves no unqualified TWR title");
    ok(enCards.includes(UNKNOWN[language]), "explicit null shows the unknown-method label");
    ok(!enCards.includes(DIETZ[language]), "explicit null is not mislabeled as Dietz");
    assert.equal(kindLabel(renderReturns(language, explicitNull.returns)), UNKNOWN[language],
      "curve labeled unknown for explicit null metadata");
    checks += 1;

    // 7c. Explicit unsupported method string: shown as unknown, never as unqualified TWR, value unchanged.
    const unknownMethod = structuredClone(twr);
    unknownMethod.summary.cashflow_method = "future_method"; unknownMethod.summary.approximate = true;
    unknownMethod.returns.cashflow_method = "future_method"; unknownMethod.returns.approximate = true;
    const umCards = renderCards(language, unknownMethod.summary);
    ok(umCards.includes("+10.00%"), "backend value still rendered as-is");
    ok(!umCards.includes("TWR"), "unknown method leaves no unqualified TWR title anywhere on the cards");
    ok(umCards.includes(UNKNOWN[language]), "unknown method label shown on the card");
    ok(!umCards.includes(DIETZ[language]), "unknown method is not mislabeled as Dietz");
    const umReturns = renderReturns(language, unknownMethod.returns);
    assert.equal(kindLabel(umReturns), UNKNOWN[language], "curve labeled unknown, not TWR");
    checks += 1;
    ok(umReturns.includes(language === "zh" ? "收益计算方式尚未确认" : "The return method is unconfirmed"),
      "method note explains the unknown method instead of the exact-TWR text");

    // 7d. Inconsistent metadata (modified_dietz without approximate:true) is also unknown.
    const inconsistent = structuredClone(twr);
    inconsistent.summary.cashflow_method = "modified_dietz"; inconsistent.summary.approximate = false;
    inconsistent.returns.cashflow_method = "modified_dietz"; inconsistent.returns.approximate = false;
    const icCards = renderCards(language, inconsistent.summary);
    ok(icCards.includes(UNKNOWN[language]) && !icCards.includes(DIETZ[language]) && !icCards.includes("TWR"));
    assert.equal(kindLabel(renderReturns(language, inconsistent.returns)), UNKNOWN[language]);
    checks += 1;

    // 7e. Per-currency unknown method stays on its own entry.
    const twoUnknown = structuredClone(two);
    const hkdEntry = twoUnknown.returns.per_currency.find(e => e.currency === "HKD");
    hkdEntry.cashflow_method = "future_method"; hkdEntry.approximate = true; hkdEntry.return_kind = "twr";
    const usdNoData = twoUnknown.returns.per_currency.find(e => e.currency === "USD");
    usdNoData.status = "no_data"; usdNoData.points = []; usdNoData.unavailable_reason = "snapshot_history_missing";
    const tuReturns = renderReturns(language, twoUnknown.returns, "all");
    assert.equal(kindLabel(tuReturns), UNKNOWN[language], "HKD unknown method not overwritten by USD or top level");
    checks += 1;
    ok(!tuReturns.includes(DIETZ[language]), "the USD Dietz label does not leak onto the HKD entry");
  }

  console.log(`console_cashflow_method_presentation_validation: PASS (${checks} assertions, zh/en × dietz/twr/legacy/unknown/two-currency/stale + in-memory absent/unknown/inconsistent method variants; unadjusted ratio titled/aria/details as asset change; synthetic fixtures only)`);
} finally {
  delete globalThis.__dietzState;
  await rm(directory, { recursive: true, force: true });
}
