import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

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
            h(SummaryCards, { scope: 'all', platform: undefined, range: 'ALL', epoch: 0 })));
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
  const ASSET_BALANCE = { zh: "资产余额 · 未与基准比较", en: "Asset balance · no benchmark comparison" };
  const STALE = { zh: "数据偏旧", en: "Stale" };
  const UNKNOWN = { zh: "收益口径未知", en: "Return method unknown" };

  const renderCards = (language, data) => {
    globalThis.__dietzState = { phase: "ready", data, reload() {} };
    return ui.cards(language, data);
  };
  const renderReturns = (language, data, scope) => {
    globalThis.__dietzState = { phase: "ready", data, reload() {} };
    return ui.returns(language, data, scope);
  };
  const kindLabel = html => html.match(/<span class="perf-kind">([\s\S]*?)<\/span>/)?.[1] ?? null;
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
    ok(dietzReturns.includes(language === "zh" ? "使用 Modified Dietz 近似法" : "the Modified Dietz approximation is used"),
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
    ok(!twrReturns.includes(language === "zh" ? "使用 Modified Dietz 近似法" : "the Modified Dietz approximation is used"),
      "method note stays the original TWR explanation");

    // 3. Legacy response without any optional fields keeps working unchanged.
    const old = fixture("old-api");
    const oldCards = renderCards(language, old.summary);
    ok(!oldCards.includes(DIETZ[language]));
    ok(oldCards.includes("—"), "missing TWR stays an honest blank");
    ok(!oldCards.includes("+0.00%"), "unknown TWR is never shown as zero");
    ok(oldCards.includes(language === "zh" ? "缺少完整出入金记录，暂不展示 TWR；金额按资产变动展示。"
      : "Complete cash-flow records are missing; TWR is unavailable and amounts are shown as asset change."), "TWR-unavailable reason kept");
    const oldReturns = renderReturns(language, old.returns);
    assert.equal(kindLabel(oldReturns), ASSET_BALANCE[language], "unadjusted ratio is labelled as asset balance, not a return");
    checks += 1;

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
    ok(twoCards.includes(language === "zh" ? "按原币种分别展示，不换汇" : "Shown separately in native currencies"),
      "mixed-currency note shown");
    ok(twoCards.indexOf("HKD") < twoCards.indexOf("USD"), "both currency rows rendered separately");
    ok(twoCards.indexOf(DIETZ[language]) > twoCards.indexOf("USD")
      && (twoCards.match(/Modified Dietz/g) || []).length === 1,
      "only the USD row carries the approximate tag");
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
    assert.equal(kindLabel(hkdReturns), ASSET_BALANCE[language], "HKD entry keeps its own unadjusted asset-balance label");
    checks += 1;
    ok(!hkdReturns.includes(DIETZ[language]), "HKD entry not overwritten by the USD method");

    // 6. Stale data keeps its freshness signal; a missing method flag is not treated as qualified Dietz.
    const stale = fixture("stale-core");
    const staleCards = renderCards(language, stale.summary);
    ok(staleCards.includes("+10.00%"));
    ok(staleCards.includes(STALE[language]), "stale badge still visible on the card");
    ok(!staleCards.includes(DIETZ[language]), "no method metadata means no approximate label");
    const staleReturns = renderReturns(language, stale.returns);
    assert.equal(kindLabel(staleReturns), TWR_KIND[language]);
    checks += 1;
    ok(staleReturns.includes(STALE[language]), "stale badge still visible on the curve card");

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
    ok(umReturns.includes(language === "zh" ? "暂无法确认这段收益的计算口径" : "cannot be confirmed"),
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

  console.log(`console_cashflow_method_presentation_validation: PASS (${checks} assertions, zh/en × dietz/twr/legacy/unknown/two-currency/stale + in-memory absent/unknown/inconsistent method variants; synthetic fixtures only)`);
} finally {
  delete globalThis.__dietzState;
  await rm(directory, { recursive: true, force: true });
}
