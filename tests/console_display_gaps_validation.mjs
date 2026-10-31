import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { m0Subjects, healthStates, controlReasons, runtimeRecords } from "./fixtures/console-gaps.ts";
import { formatDateTime } from "../web/strategy-switch-console/frontend/src/lib/format.ts";

// Render production components and dictionaries. Only network/hooks are replaced.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "console-display-"));
const outfile = join(directory, "render.cjs");
try {
  await build({ stdin: { contents: `import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { CatalogTab, ResearchTab, parseResearchLeads, loadResearchLeads } from './src/pages/strategies/StrategiesPage';
    import { AccountDirectoryContext } from './src/app/context';
    import { StatStrip, CredentialsCard } from './src/pages/health/HealthPage';
    import { SummaryCards } from './src/pages/performance/SummaryCards';
    import { Tabs } from './src/components/Tabs';
    import { DayDetail } from './src/pages/health/RunGrid';
    import { I18nProvider, translate } from './src/i18n';
    import { StatusBadge } from './src/components/primitives';
    const render = (language, component, props) => renderToStaticMarkup(h(I18nProvider, { language }, h(component, props)));
    export { parseResearchLeads, loadResearchLeads, translate };
    export const research = language => render(language, ResearchTab, { refreshEpoch: 0 });
    export const catalog = (language, config) => render(language, AccountDirectoryContext.Provider, {
      value: config, children: h(CatalogTab, { refreshEpoch: 0 }) });
    export const badge = (language, status, reason) => render(language, StatusBadge, { status, reason });
    export const stats = (language, data) => render(language, StatStrip, {
      summary: { phase: 'ready', data, reload() {} }, credential: { phase: 'loading', reload() {} } });
    export const credentials = (language, data) => render(language, CredentialsCard, {
      credential: { phase: 'ready', data, reload() {} } });
    export const summary = language => render(language, SummaryCards, { scope: 'all', state: globalThis.__displayState });
    export const tabs = language => render(language, Tabs, {
      id: 'test-tabs', items: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }], active: 'second', onChange() {} });
    export const detail = (language, snapshot) => render(language, DayDetail, {
      selection: { date: snapshot.date, account: { platform: snapshot.platform, account_alias: snapshot.account_key } },
      cell: { phase: 'ready', snapshot } });
    export const detailState = (language, selection, cell) => render(language, DayDetail, { selection, cell });`, resolveDir: root },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" }, plugins: [{ name: "controlled-read", setup(b) {
      b.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents:
        "export const useApi = () => globalThis.__displayState;", loader: "js" }));
      b.onLoad({ filter: /\/api\/client\.ts$/ }, () => ({ contents:
        "export async function getJson() { if (globalThis.__displayError) throw Error('synthetic_read_failure'); return globalThis.__displayPayload; } export const readRevision = () => 0; export const postJson = () => { throw Error('writes_forbidden'); };", loader: "js" }));
      for (const [file, exports] of [["StrategiesPage", "CatalogTab, ResearchTab, parseResearchLeads, loadResearchLeads"],
        ["HealthPage", "StatStrip, CredentialsCard"], ["RunGrid", "DayDetail"]]) {
        b.onLoad({ filter: new RegExp(`/${file}\\.tsx$`) }, async ({ path }) => ({
          contents: await readFile(path, "utf8") + `\nexport { ${exports} };`, loader: "tsx" }));
      }
    } }],
  });
  const ui = createRequire(import.meta.url)(outfile);
  const ready = payload => { globalThis.__displayState = { phase: "ready", data: ui.parseResearchLeads(payload), reload() {} }; };
  const noCodes = html => assert.doesNotMatch(html, /state\.|reason\.|research\.state\./);
  for (const language of ["zh", "en"]) {
    const expiry = "2027-09-14T19:24:00Z";
    const { text, zone } = formatDateTime(expiry, language, true);
    assert.ok(text.includes("2027"));
    assert.ok(zone.includes("GMT"));
    const credential = { id: "ibkr_flex", phase: "not_due", expires_at: expiry };
    const label = language === "zh" ? "IBKR 报表凭证" : "IBKR report credential";
    const renderedCredential = ui.credentials(language, credential);
    assert.ok(renderedCredential.includes(label));
    assert.ok(renderedCredential.includes(text));
    assert.ok(renderedCredential.includes(`(${zone})`));
    assert.doesNotMatch(renderedCredential, /ibkr_flex/);
    assert.doesNotMatch(ui.credentials(language, { ...credential, id: "future_private_id", expires_at: null }), /future_private_id|2027/);
    assert.deepEqual(formatDateTime("invalid", language, true), { text: "—", zone: "" });
    assert.deepEqual(formatDateTime(null, language, true), { text: "—", zone: "" });
    globalThis.__displayState = { phase: "ready", data: { status: "unavailable", unavailable_reason: "mixed_currency", as_of: null } };
    const metrics = ui.summary(language);
    const mainValues = [...metrics.matchAll(/<div class="kpi-value num">([\s\S]*?)<\/div>/g)];
    assert.equal(mainValues.length, 6);
    for (const [, value] of mainValues) assert.doesNotMatch(value.replace(/<[^>]*>/g, ""), /多币种|currenc/i, "reason must not become a main metric");
    assert.equal((metrics.match(/class="metric-note(?:\s[^"]*)?"/g) || []).length, 1, "one shared metric explanation");
    assert.doesNotMatch(metrics, /USD [0-9]|USDT [0-9]/, "mixed currencies never produce a combined amount");
    const tabs = ui.tabs(language);
    assert.match(tabs, /id="test-tabs-tab-first"[^>]*aria-controls="test-tabs-panel"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    assert.match(tabs, /id="test-tabs-tab-second"[^>]*aria-controls="test-tabs-panel"[^>]*aria-selected="true"[^>]*tabindex="0"/);
    ready(m0Subjects);
    const html = ui.research(language);
    assert.equal((html.match(/class="card research-item"/g) || []).length, 12, "ready M0 subjects must render all 12 cards");
    assert.equal((html.match(/synthetic-source/g) || []).length, 12, "preserve each observation's source");
    assert.ok(html.includes(language === "zh" ? "仅作背景" : "Context only"));
    assert.ok(html.includes(ui.translate(language, "state.fresh")));
    assert.ok(html.includes(language === "zh" ? "仅研究，不下单" : "Research only; no orders"));
    assert.doesNotMatch(html, /context_only|未接入|not connected/i);
    noCodes(html);
    ready({ ...m0Subjects, data_status: "ready", subjects: [] });
    assert.ok(ui.research(language).includes(language === "zh" ? "暂无研究资料。" : "No research data yet."));
    ready({ ...m0Subjects, data_status: "unavailable", subjects: [], errors: ["m0_research_ledger_unavailable"] });
    assert.ok(ui.research(language).includes(language === "zh" ? "研究资料暂时不可用。" : "Research data is temporarily unavailable."));
    for (const payload of [null, { items: [] }, { ...m0Subjects, subjects: [{}] },
      { ...m0Subjects, data_status: "unavailable", errors: ["stored_records_unreadable"] }]) {
      ready(payload);
      const failed = ui.research(language);
      assert.ok(failed.includes(language === "zh" ? "暂时无法加载" : "Unable to load"), "invalid/failed reads are not empty or disconnected");
      assert.ok(failed.includes('data-state="read_failed"'));
      assert.ok(failed.includes('role="alert"'));
    }
    globalThis.__displayState = { phase: "error", reload() {} };
    assert.ok(ui.research(language).includes(language === "zh" ? "暂时无法加载" : "Unable to load"));
    assert.ok(ui.research(language).includes('data-state="read_failed"'));
    const stale = structuredClone(m0Subjects);
    stale.data_status = "stale";
    stale.subjects[0].observations[0].freshness.status = "stale";
    ready(stale);
    assert.equal((ui.research(language).match(/class="card research-item"/g) || []).length, 12);
    assert.ok(ui.research(language).includes(ui.translate(language, "state.stale")));
    for (const strategy of healthStates.strategies) {
      const rendered = ui.badge(language, strategy.health_status);
      noCodes(rendered);
      assert.ok(!rendered.includes(language === "zh" ? "未知" : "Unknown"));
    }
    // The summary owns assignments; a separately fetched config can be older or incomplete.
    const accounts = [{ platform: "schwab", account_alias: "live", account_ref: "schwab:live" },
      { platform: "firstrade", account_alias: "live", account_ref: "firstrade:live" }];
    globalThis.__displayState = { phase: "ready", reload() {}, data: {
      ...healthStates, configured_accounts_source: "currentStrategies", account_assignment_status: "complete",
      strategies: [{ ...healthStates.strategies[1], configured_accounts: accounts }],
    } };
    const config = { platformMeta: { schwab: { label: "Schwab" }, firstrade: { label: "Firstrade" } },
      strategyProfiles: [{ profile: healthStates.strategies[1].profile, label_zh: "研究策略", label_en: "Research strategy" }] };
    for (const currentStrategies of [undefined, {}, { schwab: { live: { strategy_profile: "old-profile" } } },
      { schwab: { live: { strategy_profile: healthStates.strategies[1].profile } } }]) {
      const catalog = ui.catalog(language, { ...config, currentStrategies });
      const catalogText = catalog.replace(/<!-- -->/g, "");
      for (const account of accounts) assert.ok(!catalog.includes(`title="${account.account_ref}"`), "identities are not hidden in internal-key tooltips");
      assert.match(catalogText, /Schwab\s*·\s*(?:live|Live|实盘)/, "the Schwab identity stays visibly platform-qualified");
      assert.match(catalogText, /Firstrade\s*·\s*(?:live|Live|实盘)/, "the Firstrade identity stays visibly platform-qualified");
      assert.equal((catalog.match(/class="strategy-account-link"/g) || []).length, 2, "same live aliases must remain distinct");
      assert.ok(catalog.includes(language === "zh" ? "研究策略" : "Research strategy"));
      assert.doesNotMatch(catalog, /<h3[^>]*>synthetic-profile/);
      assert.doesNotMatch(catalog, /state\.|reason\./);
      assert.doesNotMatch(catalog, />review<|>watch</);
    }
    globalThis.__displayState.data.strategies[0].configured_accounts = [];
    const unassigned = ui.catalog(language, { ...config, currentStrategies: {
      schwab: { live: { strategy_profile: healthStates.strategies[1].profile } },
    } });
    assert.doesNotMatch(unassigned, /class="strategy-account-link"/, "config must not invent an assignment missing from the summary");
    for (const reason of controlReasons) noCodes(ui.badge(language, "blocked", reason));
    const recovery = ui.translate(language, "reason.existing_recovery_not_available");
    assert.match(recovery, language === "zh" ? /没有可用/ : /No existing recovery/);
    const unknown = ui.badge(language, "future_state", "future_reason");
    noCodes(unknown);
    assert.ok(unknown.includes(language === "zh" ? "未知状态" : "Unknown status"));
    for (const snapshot of runtimeRecords) {
      const detail = ui.detail(language, snapshot);
      noCodes(detail);
      assert.doesNotMatch(detail, />blocked<|>insufficient<|>read_incomplete</);
    }
    for (const activity of ["previewed", "blocked", "insufficient", "future_activity"]) {
      const snapshot = structuredClone(runtimeRecords[0]);
      snapshot.record.runs[0].activity = activity;
      noCodes(ui.detail(language, snapshot));
      assert.ok(!ui.detail(language, snapshot).includes(`>${activity}<`));
    }
    // A binding rotation withholds a stored day; that is not an unreadable date.
    const selection = { date: "2026-10-23", account: { platform: "longbridge", account_alias: "synthetic-paper" } };
    const rotated = ui.detailState(language, selection, { phase: "binding-changed" });
    noCodes(rotated);
    assert.ok(rotated.includes(ui.translate(language, "health.grid.binding_changed_detail")));
    assert.ok(!rotated.includes(ui.translate(language, "state.read_failed")), "a rotated binding is not a read failure");
    assert.ok(ui.detailState(language, selection, { phase: "error" })
      .includes(ui.translate(language, "state.read_failed")), "an unreadable date keeps its own explanation");
    const account = { account_alias: "synthetic-paper", platform: "longbridge", status: "ok", unavailable_reason: null,
      completeness: "complete", run_count: 1, activity: "filled", runs: [{ activity: "filled", errors_present: false }] };
    const summary = { status: "ok", date: "2026-10-16", timezone: "America/New_York", as_of: null,
      counts: { configured: 1, observed: 1, runs: 1 }, accounts: [account] };
    const statValue = data => ui.stats(language, data).match(/<div class="kpi-value[^"]*">([\s\S]*?)<\/div>/g)?.at(2) || ui.stats(language, data);
    assert.ok(ui.stats(language, summary).replaceAll("&#x27;", "'").includes(language === "zh" ? "今日失败账户" : "Today's failed accounts"));
    assert.ok(ui.stats(language, summary).includes("2026-10-16"));
    assert.ok(ui.stats(language, summary).includes(language === "zh" ? "纽约时间" : "New York time"));
    assert.ok(!ui.stats(language, summary).includes("America/New_York"), "raw IANA timezone id must not be shown to users");
    assert.match(statValue(summary), /0/);
    for (const activity of ["failed"]) {
      const failed = { ...account, activity };
      assert.match(statValue({ ...summary, accounts: [failed] }), /1/);
    }
    const errored = { ...account, runs: [{ activity: "filled", errors_present: true }] };
    assert.match(statValue({ ...summary, accounts: [errored] }), /1/);
    for (const incomplete of [
      { ...summary, status: "partial", counts: { configured: 10, observed: 0, runs: null }, accounts: [] },
      { ...summary, status: "partial", accounts: [{ ...account, completeness: "incomplete" }] },
      { ...summary, status: "partial", accounts: [{ ...account, activity: "insufficient", runs: [] }] },
      { ...summary, accounts: [{ ...account, runs: [{ activity: "previewed", errors_present: false }] }] },
    ]) {
      assert.ok(statValue(incomplete).includes(language === "zh" ? "未知" : "Unknown"), "incomplete coverage cannot certify zero failures");
    }
    const partialFailed = { ...summary, status: "partial", counts: { configured: 10, observed: 1, runs: null }, accounts: [{ ...account, activity: "failed" }] };
    assert.ok(statValue(partialFailed).includes(language === "zh" ? "至少 1" : "At least 1"));
    // A weekend with nothing scheduled is a non-trading day, not a failed or unknown day.
    const weekend = { ...summary, market_session: "weekend", date: "2026-10-31",
      counts: { configured: 1, observed: 0, runs: null },
      accounts: [{ ...account, status: "no_data", unavailable_reason: "non_trading_weekend",
        activity: null, completeness: null, run_count: 0, runs: [] }] };
    assert.ok(ui.stats(language, weekend).includes(ui.translate(language, "health.non_trading_day_short")));
    assert.match(statValue(weekend), /—/, "a non-trading weekend certifies neither failures nor zero");
  }
  globalThis.__displayPayload = m0Subjects;
  assert.deepEqual(await ui.loadResearchLeads(), ui.parseResearchLeads(m0Subjects));
  globalThis.__displayError = true;
  await assert.rejects(ui.loadResearchLeads(), /synthetic_read_failure/);
} finally {
  for (const key of ["__displayState", "__displayPayload", "__displayError"]) delete globalThis[key];
  await rm(directory, { recursive: true, force: true });
}
console.log("console_display_gaps_validation: PASS (zh/en credentials/year/zone, compact metrics, tab associations, M0, failure windows, health/control/detail states)");
