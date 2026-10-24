import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

// SSR-render the production AccountFactsAmounts/PlatformFactsSummary/
// AccountGroups (and the overview ReturnKpi method tag) with production
// translations. All fixtures are synthetic in-memory rows in the read-only
// /api/account-facts projection shape, including the real per-platform
// producer wire shapes (LongBridge total_cash, IBKR nullable net_assets,
// Schwab owner-confirmed USD) and the authoritative aggregation_status.
// Amounts stay decimal strings exactly as a broker projection returns them.
// Negative cases prove unknown enums, missing values, conflicts, unverified
// identities, missing valuation days and float-precision traps never turn
// into amounts, zeros, or a fake platform total.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "console-account-facts-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({ stdin: { contents: `import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { PrefsContext } from './src/app/context';
    import { DEFAULT_PREFERENCES } from './src/lib/prefs';
    import { AccountFactsAmounts, PlatformFactsSummary } from './src/components/AccountFactsAmounts';
    import { AccountGroups } from './src/components/AccountGroups';
    import { ReturnKpi } from './src/pages/overview/OverviewPage';
    import { pickIdentityFact, platformCurrencyTotals, formatMoneyText, cashTextFor } from './src/lib/accountFacts';
    const render = (language, component, props, prefs) => renderToStaticMarkup(
      h(I18nProvider, { language },
        h(PrefsContext.Provider, { value: { prefs: { ...DEFAULT_PREFERENCES, ...(prefs || {}) }, resolvedTheme: 'light', setPrefs: () => {} } },
          h(component, props))));
    export const card = (language, fact, phase, extra, prefs) =>
      render(language, AccountFactsAmounts, { fact, phase, conflict: Boolean(extra && extra.conflict), ambiguous: Boolean(extra && extra.ambiguous) }, prefs);
    export const platform = (language, rows, expected, phase) =>
      render(language, PlatformFactsSummary, { rows, expected, phase });
    export const groups = (language, accounts, config, facts) =>
      render(language, AccountGroups, { accounts, config, facts, onSelect: () => {} });
    export const returnKpi = language =>
      render(language, ReturnKpi, { state: globalThis.__factsKpiState });
    export const lib = { pickIdentityFact, platformCurrencyTotals, formatMoneyText, cashTextFor };`, resolveDir: root },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
    plugins: [{ name: "controlled-read", setup(b) {
      b.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents: "export const useApi = () => globalThis.__factsKpiState;", loader: "js" }));
      b.onLoad({ filter: /\/pages\/overview\/OverviewPage\.tsx$/ }, async ({ path }) => ({ contents: await readFile(path, "utf8") + "\nexport { ReturnKpi };", loader: "tsx" }));
    } }],
  });
  const ui = createRequire(import.meta.url)(outfile);

  const TEXT = {
    zh: {
      assets: "资产", cash: "现金", cashSemantics: "不代表购买力",
      notConnected: "未接入", noData: "暂无数据", readFailed: "读取失败", unknown: "未知状态",
      identity: "账户身份未核验", platformIdentity: "平台合计不可用：有账户身份未核验", conflict: "数据不一致",
      total: "平台合计", subtotal: "部分合计", subtotalNote: "仅合计已核验且估值日期一致的账户。",
      partial: "部分合计", stale: "待更新", coverage: (c, e) => `已计入 ${c}/${e} 个账户`,
      dietz: "Modified Dietz（近似）", methodUnknown: "收益计算方式未知",
    },
    en: {
      assets: "Assets", cash: "Cash", cashSemantics: "not buying power",
      notConnected: "Not connected", noData: "No data", readFailed: "Read failed", unknown: "Unknown status",
      identity: "identity unverified", platformIdentity: "Platform total unavailable: some account identities are unverified", conflict: "Data conflicts",
      total: "Platform total", subtotal: "Subtotal", subtotalNote: "Only verified accounts with the same valuation date are included.",
      partial: "Subtotal", stale: "update pending", coverage: (c, e) => `Includes ${c} of ${e} accounts`,
      dietz: "Modified Dietz (approximate)", methodUnknown: "Return method unknown",
    },
  };

  // Real producer wire shapes. IBKR-style verified row: cash_balance in the
  // cash rows, net_assets nullable, aggregation_status "included" because the
  // backend proved a unique physical account.
  const baseFact = () => ({
    platform: "ibkr", account_key: "ibkr-main",
    binding_status: "bound", identity_status: "partial_identity", identity_mismatch: false,
    data_status: "fresh", broker_environment: "live", account_scope: "LIVE",
    observation_date: "2026-10-20",
    observed_started_at: "2026-10-20T02:00:00Z", observed_finished_at: "2026-10-20T02:00:05Z",
    aggregation_status: "included",
    balances: [{ currency: "USD", net_assets: "1234.56" }, { currency: "HKD", net_assets: "0" }],
    cash: [{ currency: "USD", cash_balance: "100.25" }],
  });
  const otherFact = () => ({ ...baseFact(), account_key: "ibkr-second",
    balances: [{ currency: "USD", net_assets: "200.00" }, { currency: "HKD", net_assets: "0" }],
    cash: [{ currency: "USD", cash_balance: "50.00" }] });
  // Real LongBridge wire: total_cash on the balance row, cash rows carry
  // available/frozen/settling only, and the channel identity never proves a
  // physical account, so aggregation_status is "unverified".
  const longbridgeFact = () => ({
    platform: "longbridge", account_key: "synthetic-alpha",
    binding_status: "bound", identity_status: "partial_identity", identity_mismatch: false,
    data_status: "fresh", broker_environment: "paper", account_scope: "PAPER",
    observation_date: "2026-10-20",
    observed_started_at: "2026-10-20T02:00:00Z", observed_finished_at: "2026-10-20T02:00:05Z",
    aggregation_status: "unverified",
    balances: [{ currency: "USD", net_assets: "1234.56", total_cash: "100.25" }, { currency: "HKD", net_assets: "0", total_cash: "0" }],
    cash: [{ currency: "USD", available_cash: "100.25", frozen_cash: "0", settling_cash: "0" }],
  });

  let checks = 0;
  const ok = (...args) => { assert.ok(...args); checks += 1; };
  // A complete rollup no longer prints an internal covered/expected count.
  const hasCoverage = html => /(?:其中 \d+ 个账户有数据|\d+ accounts with data)/.test(html);

  for (const language of ["zh", "en"]) {
    const s = TEXT[language];

    // 1. Ready account: per-currency rows, cash labeled as cash, never summed across currencies.
    const ready = ui.card(language, baseFact(), "ready");
    ok(ready.includes("USD 1,234.56"), "USD net assets rendered as-is");
    ok(ready.includes("HKD 0.00"), "a reported zero is a real zero");
    ok(ready.includes("USD 100.25"), "cash rendered as-is");
    ok(ready.includes(`${s.cash} · USD`), "cash row labeled cash only");
    ok(ready.includes(s.cashSemantics), "cash tooltip rules out buying-power semantics");
    ok(!ready.includes("1,334.81"), "currencies are never combined on one account");
    ok(!ready.includes(s.stale), "fresh data carries no stale badge");
    ok(!/facts\.|state\.|common\./.test(ready), "no untranslated keys leak");

    // 2. Stale data keeps its freshness signal next to the amounts.
    const staleFact = { ...baseFact(), data_status: "stale" };
    ok(ui.card(language, staleFact, "ready").includes(s.stale), "stale date remains visibly marked as update pending");

    // 3. Missing and invalid values degrade to an em dash, never zero, never a crash.
    const missingNet = { ...baseFact(), balances: [{ currency: "USD", net_assets: null }], cash: [] };
    const missingHtml = ui.card(language, missingNet, "ready");
    ok(missingHtml.includes("—"), "null net_assets renders as unknown");
    ok(!missingHtml.includes("0.00"), "missing is never shown as zero");
    const invalidNet = { ...baseFact(), balances: [{ currency: "USD", net_assets: "not-a-decimal" }], cash: [] };
    const invalidHtml = ui.card(language, invalidNet, "ready");
    ok(invalidHtml.includes("—") && !invalidHtml.includes("0.00"), "invalid decimal string degrades to unknown");

    // 4. Cash reported without net assets still shows honestly.
    const cashOnly = { ...baseFact(), balances: [], cash: [{ currency: "USD", cash_balance: "5.00" }] };
    const cashOnlyHtml = ui.card(language, cashOnly, "ready");
    ok(cashOnlyHtml.includes("USD 5.00"), "cash shows even when net assets are absent");

    // 4b. Real LongBridge wire: cash comes from total_cash, and available_cash
    // is never relabeled as cash when no cash field exists.
    const lbHtml = ui.card(language, longbridgeFact(), "ready");
    ok(lbHtml.includes("USD 100.25"), "LongBridge cash is read from balances.total_cash");
    const lbNoCashField = { ...longbridgeFact(), balances: [{ currency: "USD", net_assets: "10.00" }] };
    const lbNoCashHtml = ui.card(language, lbNoCashField, "ready");
    ok(!lbNoCashHtml.includes("USD 4.00") && !lbNoCashHtml.includes("100.25"), "available_cash is never shown as cash");
    ok(lbNoCashHtml.includes("—"), "a LongBridge row without total_cash shows unknown cash");

    // 4c. Schwab-style wire (owner-confirmed single USD row) renders normally.
    const schwab = { ...baseFact(), platform: "schwab", account_key: "schwab-main",
      balances: [{ currency: "USD", net_assets: "88.10", source_tag: "liquidationValue", currency_source: "owner_confirmed" }],
      cash: [{ currency: "USD", cash_balance: "3.21", source_tag: "cashBalance", currency_source: "owner_confirmed" }] };
    const schwabHtml = ui.card(language, schwab, "ready");
    ok(schwabHtml.includes("USD 88.10") && schwabHtml.includes("USD 3.21"), "Schwab wire shape renders assets and cash");

    // 4d. Exact decimal rendering never re-rounds a legal amount through a float.
    const big = { ...baseFact(), balances: [{ currency: "USD", net_assets: "100000000000000.01" }], cash: [] };
    ok(ui.card(language, big, "ready").includes("USD 100,000,000,000,000.01"), "15-digit/8-scale amounts render digit-exact");
    assert.equal(ui.lib.formatMoneyText("100000000000000.01", "USD"), "USD 100,000,000,000,000.01", "formatter is exact");
    assert.equal(ui.lib.formatMoneyText("5", null), "5.00", "integer amounts pad to two places");
    assert.equal(ui.lib.formatMoneyText("1234.567", null), "1,234.567", "longer fractions are preserved");
    assert.equal(ui.lib.formatMoneyText("1e3", null), "—", "non-decimal text never formats");
    checks += 4;

    // 5. Binding/identity/status states are honest and distinct.
    ok(ui.card(language, { ...baseFact(), binding_status: "missing" }, "ready").includes(s.notConnected), "missing binding is not-connected");
    ok(ui.card(language, null, "ready").includes(s.notConnected), "no matching row is not-connected");
    ok(ui.card(language, { ...baseFact(), binding_status: "duplicate" }, "ready").includes(s.identity), "duplicate binding hides amounts");
    ok(ui.card(language, { ...baseFact(), identity_mismatch: true }, "ready").includes(s.identity), "identity mismatch hides amounts");
    ok(ui.card(language, { ...baseFact(), data_status: "unavailable" }, "ready").includes(s.noData), "unavailable snapshot is no-data");
    const readFailed = ui.card(language, baseFact(), "error");
    ok(readFailed.includes(s.readFailed) && !readFailed.includes(s.noData), "read failure is never rendered as missing data");
    ok(ui.card(language, baseFact(), "ready", { conflict: true }).includes(s.conflict), "identity conflict hides amounts");
    ok(ui.card(language, baseFact(), "ready", { ambiguous: true }).includes(s.identity), "an ambiguous display group hides amounts");

    // 6. Unknown enums or missing fields can never be asserted into amounts.
    for (const bad of [
      { ...baseFact(), binding_status: "pending" },
      { ...baseFact(), data_status: "unknown_future_status" },
      (() => { const f = baseFact(); delete f.binding_status; return f; })(),
    ]) {
      const html = ui.card(language, bad, "ready");
      ok(html.includes(s.unknown), "unrecognized enum or missing field falls back to unknown");
      ok(!html.includes("1,234.56"), "unknown state never leaks amounts");
    }

    // 7. Amount hiding preference masks every row.
    const hidden = ui.card(language, baseFact(), "ready", null, { hideAmounts: true });
    ok(hidden.includes("•••") && !hidden.includes("1,234.56"), "hideAmounts masks amounts");

    // 8. Platform rollup: verified accounts with full same-day coverage are a real platform total.
    const complete = ui.platform(language, [baseFact(), otherFact()], 2, "ready");
    ok(complete.includes(`${s.total} · USD`), "full same-day verified coverage is a platform total");
    ok(complete.includes("USD 1,434.56"), "same-currency same-day accounts sum exactly (1234.56 + 200.00)");
    ok(complete.includes("USD 150.25"), "cash sums independently (100.25 + 50.00)");
    ok(!hasCoverage(complete), "full coverage omits the partial-coverage count");
    ok(!complete.includes(s.partial), "complete coverage is not downgraded to a partial total");

    // 8b. Exact platform sums survive large magnitudes without float drift.
    const bigSum = ui.platform(language, [
      { ...baseFact(), balances: [{ currency: "USD", net_assets: "100000000000000.01" }], cash: [] },
      { ...otherFact(), balances: [{ currency: "USD", net_assets: "0.01" }], cash: [] },
    ], 2, "ready");
    ok(bigSum.includes("USD 100,000,000,000,000.02"), "platform subtotal is digit-exact at producer limits");

    // 9. Distinct physical accounts with identical values are both kept.
    const twinA = { ...otherFact(), account_key: "ibkr-twin-a" };
    const twinB = { ...otherFact(), account_key: "ibkr-twin-b" };
    const twins = ui.platform(language, [twinA, twinB], 2, "ready");
    ok(twins.includes("USD 400.00"), "same-valued distinct accounts are both summed");
    ok(!hasCoverage(twins) && twins.includes(`${s.total} · USD`), "identical content never merges distinct identities");

    // 10. The same facts row reached through two directory aliases counts once;
    // dedupe is by row reference, never by content.
    const shared = baseFact();
    const deduped = ui.platform(language, [shared, shared], 1, "ready");
    ok(deduped.includes("USD 1,234.56") && !deduped.includes("2,469.12"), "one physical account is summed once");
    ok(!hasCoverage(deduped) && deduped.includes(`${s.total} · USD`), "aliases of one identity count once");

    // 11. Partial coverage stays an observed subtotal and only counts summed accounts.
    const partial = ui.platform(language, [baseFact()], 2, "ready");
    ok(partial.includes(`${s.subtotal} · USD`), "uncovered accounts downgrade to observed subtotal");
    ok(partial.includes(s.subtotalNote), "subtotal note rules out a complete total");
    ok(partial.includes(s.partial), "partial subtotal remains explicitly labeled");
    ok(partial.includes(s.coverage(1, 2)), "only actually summed accounts count as covered");

    // 12. Cross-valuation-day accounts are excluded from the sum but shrink coverage.
    const older = { ...otherFact(), observation_date: "2026-10-19" };
    const crossDay = ui.platform(language, [baseFact(), older], 2, "ready");
    ok(crossDay.includes(`${s.subtotal} · USD`), "mixed valuation days cannot be a platform total");
    ok(crossDay.includes("USD 1,234.56") && !crossDay.includes("1,434.56"), "the older valuation day is not added in");
    ok(crossDay.includes(s.coverage(1, 2)), "excluded cross-day account is not counted as covered");

    // 12b. Missing valuation days can never be summed or called complete.
    const noDateA = { ...baseFact(), observation_date: null };
    const noDateB = { ...otherFact(), observation_date: null };
    const noDates = ui.platform(language, [noDateA, noDateB], 2, "ready");
    ok(noDates.includes(`${s.subtotal} · USD`), "missing valuation days are never a platform total");
    ok(noDates.includes(s.coverage(0, 2)), "accounts without a valuation day contribute nothing");
    ok(!noDates.includes("1,434.56") && !noDates.includes("USD 200.00"), "dateless amounts are never added together");
    const mixedDates = ui.platform(language, [baseFact(), { ...otherFact(), observation_date: null }], 2, "ready");
    ok(mixedDates.includes(s.coverage(1, 2)) && mixedDates.includes(`${s.subtotal} · USD`),
      "a dateless account is excluded from an otherwise dated sum");

    // 12c. Paper accounts never join the live platform total, in either coverage count.
    const paperFact = { ...otherFact(), broker_environment: "paper", account_scope: "paper" };
    const livePaper = ui.platform(language, [baseFact(), paperFact], 2, "ready");
    ok(livePaper.includes("USD 1,234.56") && !livePaper.includes("1,434.56"),
      "paper amounts are never added into the live platform total");
    ok(!hasCoverage(livePaper), "paper accounts leave both the numerator and the denominator");
    ok(livePaper.includes(`${s.total} · USD`), "a fully covered live scope is still a complete total");
    const paperOnly = ui.platform(language, [paperFact], 1, "ready");
    ok(!paperOnly.includes('class="account-facts-currency"'), "a paper-only platform has no live total block");
    ok(paperOnly.includes(s.noData), "a paper-only scope reads as no live data, not a zero total");
    ok(ui.card(language, paperFact, "ready").includes("USD 200.00"), "a paper account keeps its own card amounts");

    // 12d. Unknown scope is never guessed into the live total.
    const unknownScope = { ...otherFact(), broker_environment: null, account_scope: null };
    const unknownScopeHtml = ui.platform(language, [baseFact(), unknownScope], 2, "ready");
    ok(unknownScopeHtml.includes(`${s.subtotal} · USD`), "an unknown scope can never be a complete total");
    ok(unknownScopeHtml.includes(s.coverage(1, 2)), "unknown scope stays in the denominator but out of the sum");
    ok(!unknownScopeHtml.includes("1,434.56"), "unknown-scope amounts are never summed");

    // 12e. A producer-known duplicate alias leaves both coverage counts.
    const dupAlias = { ...baseFact(), account_key: "ibkr-alias", aggregation_status: "duplicate" };
    const aliasPair = ui.platform(language, [baseFact(), dupAlias], 2, "ready");
    ok(aliasPair.includes("USD 1,234.56") && !aliasPair.includes("2,469.12"), "a known duplicate is never summed twice");
    ok(!hasCoverage(aliasPair), "a known duplicate leaves both coverage counts");
    ok(aliasPair.includes(`${s.total} · USD`), "full coverage of deduplicated accounts is a complete total");

    // 12f. Paper and duplicate overlap: the excluded set is a union — a row
    // that is both paper and a known duplicate leaves the scope exactly once.
    const paperOld = { ...otherFact(), account_key: "ibkr-paper-old",
      broker_environment: "paper", account_scope: "paper", aggregation_status: "duplicate" };
    const paperNew = { ...otherFact(), account_key: "ibkr-paper-new",
      broker_environment: "paper", account_scope: "paper", aggregation_status: "included" };
    const overlap = ui.platform(language, [baseFact(), paperOld, paperNew], 3, "ready");
    ok(!hasCoverage(overlap), "a paper duplicate leaves the scope once, not twice");
    ok(overlap.includes(`${s.total} · USD`), "the single live account fully covers its own scope");
    // A live directory account with no facts row must keep the subtotal partial.
    const overlapMissing = ui.platform(language, [baseFact(), paperOld, paperNew], 4, "ready");
    ok(overlapMissing.includes(s.coverage(1, 2)), "a missing live account stays uncovered in the denominator");
    ok(overlapMissing.includes(`${s.subtotal} · USD`) && !overlapMissing.includes(`${s.total} · USD`),
      "a missing live account can never be a complete total");

    // 12g. Conflicts between excluded paper rows keep their own card state but
    // never degrade the live total; a real live conflict still blocks it.
    const paperConflictA = { ...otherFact(), account_key: "ibkr-paper-a",
      broker_environment: "paper", account_scope: "paper", aggregation_status: "conflict" };
    const paperConflictB = { ...otherFact(), account_key: "ibkr-paper-b",
      broker_environment: "paper", account_scope: "paper", aggregation_status: "conflict",
      balances: [{ currency: "USD", net_assets: "201.00" }] };
    const paperConflict = ui.platform(language, [baseFact(), paperConflictA, paperConflictB], 3, "ready");
    ok(!hasCoverage(paperConflict) && paperConflict.includes(`${s.total} · USD`),
      "conflicting paper rows never degrade the live total");
    const liveConflictRow = { ...otherFact(), account_key: "ibkr-live-conflict", aggregation_status: "conflict" };
    const liveConflict = ui.platform(language, [baseFact(), liveConflictRow], 2, "ready");
    ok(liveConflict.includes(`${s.subtotal} · USD`) && liveConflict.includes(s.coverage(1, 2)),
      "a live-scope conflict still blocks a complete total");

    // 13. Currency union: a cash-only currency still appears; blocks stay independent.
    const hkdCashOnly = { ...otherFact(), balances: [], cash: [{ currency: "HKD", cash_balance: "7.00" }] };
    const union = ui.platform(language, [baseFact(), hkdCashOnly], 2, "ready");
    ok(union.includes(`${s.subtotal} · USD`), "USD block partial (HKD-only account not summed into USD)");
    assert.equal((union.match(/account-facts-currency/g) || []).length, 2, "one block per currency, never merged");
    checks += 1;
    const hkdBlock = union.split('class="account-facts-currency"').find(part => part.includes("HKD")) || "";
    ok(hkdBlock.includes(`${s.subtotal} · HKD`), "a member without HKD net assets keeps the block a subtotal");
    ok(!hkdBlock.includes("HKD 7.00") && !hkdBlock.includes("HKD 0.00"),
      "a member without an HKD cash row keeps the HKD sums unknown instead of fabricating zeros");
    ok((hkdBlock.match(/—/g) || []).length >= 2, "unknown platform sums render as em dashes");
    ok(hkdBlock.includes(s.coverage(0, 2)), "no displayed HKD sum means zero accounts covered");

    // 13b. A platform whose only observation is cash shows that cash but stays a subtotal.
    const cashOnlyPlatform = ui.platform(language, [cashOnly], 1, "ready");
    ok(cashOnlyPlatform.includes("USD 5.00"), "platform cash shows even when net assets are missing");
    ok(cashOnlyPlatform.includes(`${s.subtotal} · USD`), "unknown assets can never be a complete total");

    // 14. Platform staleness survives the rollup.
    const stalePlatform = ui.platform(language, [staleFact], 1, "ready");
    ok(stalePlatform.includes(s.stale), "a stale member keeps the platform update-pending signal");

    // 15. A backend-marked identity conflict is excluded and blocks completeness.
    const conflictRow = { ...baseFact(), account_key: "ibkr-conflict", aggregation_status: "conflict" };
    const conflicted = ui.platform(language, [conflictRow, otherFact()], 2, "ready");
    ok(conflicted.includes(`${s.subtotal} · USD`), "an identity conflict can never be a complete total");
    ok(conflicted.includes(s.coverage(1, 2)), "the conflicted identity is not summed");
    ok(!conflicted.includes("1,434.56"), "conflicting amounts are never picked");

    // 15b. Unverified identities (LongBridge live rows) never join a platform sum.
    const lbLive = { ...longbridgeFact(), broker_environment: "live", account_scope: "LIVE" };
    const unverifiedOnly = ui.platform(language, [lbLive], 1, "ready");
    ok(unverifiedOnly.includes(s.platformIdentity), "an unverified-only platform shows the honest identity state");
    ok(!unverifiedOnly.includes("1,234.56") && !unverifiedOnly.includes('class="account-facts-currency"'),
      "unverified rows never produce a platform total block");
    const mixedTrust = ui.platform(language, [baseFact(), lbLive], 2, "ready");
    ok(mixedTrust.includes(`${s.subtotal} · USD`), "a platform with unverified members stays a subtotal");
    ok(mixedTrust.includes("USD 1,234.56") && mixedTrust.includes(s.coverage(1, 2)), "only the verified member is summed");
    const noStatus = (() => { const f = otherFact(); delete f.aggregation_status; return f; })();
    const missingStatus = ui.platform(language, [baseFact(), noStatus], 2, "ready");
    ok(missingStatus.includes(s.coverage(1, 2)) && !missingStatus.includes(`${s.total} · USD`),
      "a missing aggregation_status is treated as unverified, never as included");

    // 16. Invalid decimal in any included account drops the platform sum, not the page.
    const invalidMember = { ...otherFact(), balances: [{ currency: "USD", net_assets: "NaN-ish" }] };
    const invalidSum = ui.platform(language, [baseFact(), invalidMember], 2, "ready");
    const usdBlock = invalidSum.split('class="account-facts-currency"').find(part => part.includes("USD")) || "";
    ok(usdBlock.includes("—"), "one invalid member amount drops the currency sum to unknown");
    ok(usdBlock.includes("USD 150.25"), "cash sum still computes when only net assets are invalid");
    ok(usdBlock.includes(`${s.subtotal}`), "an unknown net sum is never a complete total");

    // 16b. All-unknown amounts mean zero coverage, never covered-and-complete.
    const nullNet = { ...baseFact(), balances: [{ currency: "USD", net_assets: null }], cash: [] };
    const allUnknown = ui.platform(language, [nullNet], 1, "ready");
    ok(allUnknown.includes(s.coverage(0, 1)), "no valid amount means no account is covered");
    ok(!allUnknown.includes(`${s.total}`), "an all-unknown block is never a platform total");

    // 17. Empty platform read is honest; read failure stays distinct.
    ok(ui.platform(language, [], 0, "ready").includes(s.notConnected), "no accounts means not-connected");
    ok(ui.platform(language, [baseFact()], 1, "error").includes(s.readFailed), "platform read failure is not missing data");

    // 17b. Bound accounts with unavailable snapshots are no-data, never not-connected,
    // and never join any subtotal.
    const unavailable = { ...baseFact(), data_status: "unavailable", balances: [], cash: [] };
    const noDataPlatform = ui.platform(language, [unavailable], 1, "ready");
    ok(noDataPlatform.includes(s.noData) && !noDataPlatform.includes(s.notConnected),
      "unavailable snapshots read as no-data, not not-connected");
    ok(!noDataPlatform.includes("1,234.56"), "unavailable snapshots never leak amounts");
    const duplicateOnly = ui.platform(language, [{ ...baseFact(), binding_status: "duplicate" }], 1, "ready");
    ok(duplicateOnly.includes(s.noData) && !duplicateOnly.includes("1,234.56"),
      "unverified identities stay out of every subtotal");

    // 18. Observation times compare as real instants, not strings.
    const offsetEarlier = { ...baseFact(), account_key: "ibkr-offset",
      observed_finished_at: "2026-10-20T10:00:00+08:00",
      balances: [{ currency: "USD", net_assets: "100.00" }] };
    const zuluLater = { ...otherFact(), observed_finished_at: "2026-10-20T03:00:00Z" };
    const picked = ui.lib.pickIdentityFact([offsetEarlier, zuluLater]);
    ok(!picked.conflict && picked.fact === zuluLater, "03:00Z beats 10:00+08:00 (=02:00Z) as the later instant");
    const zuluSame = { ...otherFact(), observed_finished_at: "2026-10-20T02:00:00Z" };
    const sameInstant = ui.lib.pickIdentityFact([offsetEarlier, zuluSame]);
    ok(sameInstant.conflict && sameInstant.fact === null, "offset and Z forms of one instant conflict on disagreement");
    const unparseable = { ...otherFact(), observed_finished_at: "10/20/2026 2:00 AM" };
    ok(ui.lib.pickIdentityFact([baseFact(), unparseable]).conflict, "an unparseable time never picks an arbitrary amount");

    // 18b. AccountGroups never treats a display alias group as a verified identity.
    const dirRow = alias => ({ platform: "ibkr", account_alias: alias, pending_draft_count: 0, pending_decision_count: 0, last_change_at: null });
    const sharedSelector = { accountOptions: { ibkr: [
      { key: "ibkr-twin-a", account_selector: "U123" },
      { key: "ibkr-twin-b", account_selector: "U123" },
    ] } };
    const groupHtml = ui.groups(language, [dirRow("ibkr-twin-a"), dirRow("ibkr-twin-b")], sharedSelector,
      { rows: [twinA, twinB], phase: "ready" });
    ok(groupHtml.includes(s.identity), "one display card holding two distinct accounts hides card amounts");
    ok(groupHtml.includes("USD 400.00"), "the platform rollup still sums both verified accounts");
    const multiStrategy = ui.groups(language, [dirRow("ibkr-main"), dirRow("ibkr-main")], null,
      { rows: [baseFact()], phase: "ready" });
    ok(multiStrategy.includes("USD 1,234.56") && !multiStrategy.includes("2,469.12"),
      "multi-strategy rows of one account keep one card amount and one sum");
    // 18c. AccountGroups reuses the producer dedup conclusion: one physical
    // account under two aliases (included + duplicate) counts once in both
    // coverage counts, and one shared-selector card shows its amounts once.
    const aliasConfig = { accountOptions: { ibkr: [
      { key: "ibkr-main", account_selector: "U123" },
      { key: "ibkr-alias", account_selector: "U123" },
    ] } };
    const aliasGroup = ui.groups(language, [dirRow("ibkr-main"), dirRow("ibkr-alias")], aliasConfig,
      { rows: [baseFact(), dupAlias], phase: "ready" });
    ok(!hasCoverage(aliasGroup) && aliasGroup.includes(`${s.total} · USD`), "producer-known duplicate aliases count once in coverage");
    ok(!aliasGroup.includes(s.identity), "a canonical included row keeps the shared card amounts");
    ok((aliasGroup.match(/USD 1,234\.56/g) || []).length === 2, "the amount appears once on the card and once in the total");

    // 19. English output contains no Chinese; both languages leak no raw keys.
    if (language === "en") {
      for (const html of [ready, complete, partial, crossDay]) assert.doesNotMatch(html, /[一-鿿]/);
    }
    for (const html of [ready, complete, partial, crossDay, conflicted, readFailed]) {
      assert.doesNotMatch(html, />(?:facts|state|common|reason)\.[a-z_.]+</, "no untranslated message keys");
    }
    checks += 1;

    // 20. Overview range-return KPI method tag matches the performance-page rule.
    const kpi = (extra) => {
      globalThis.__factsKpiState = { phase: "ready", reload() {}, data: {
        status: "ok", unavailable_reason: null, currency: "USD", as_of: "2026-10-20T02:00:05Z",
        twr_return_percent: 1.25, ...extra } };
      return ui.returnKpi(language);
    };
    ok(kpi({ cashflow_method: "modified_dietz", approximate: true }).includes(s.dietz), "explicit Dietz is labeled approximate");
    const nullKpi = kpi({ cashflow_method: null, approximate: null });
    ok(nullKpi.includes(s.methodUnknown) && !nullKpi.includes(s.dietz), "explicit null metadata is unknown, never bare TWR");
    const absentKpi = kpi({});
    ok(absentKpi.includes(language === "zh" ? ">时间加权收益<" : ">Time-weighted return<"), "absent metadata keeps the plain TWR tag");
    ok(!absentKpi.includes(s.methodUnknown) && !absentKpi.includes(s.dietz));
    ok(kpi({ cashflow_method: "future_method", approximate: true }).includes(s.methodUnknown), "unsupported method is unknown");
  }

  console.log(`console_account_facts_ui_validation: PASS (${checks} assertions, zh/en × ready/stale/missing/invalid/identity/conflict/coverage/cross-day/missing-day/union/unverified/live-paper-scope/alias-dedup/paper-duplicate-union/paper-conflict-scope/precision/longbridge/schwab/offset-time/hideAmounts + AccountGroups alias-grouping + ReturnKpi method tags; synthetic in-memory fixtures only)`);
} finally {
  delete globalThis.__factsKpiState;
  await rm(directory, { recursive: true, force: true });
}
