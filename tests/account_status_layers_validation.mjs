import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { MANAGEMENT_STATUS_TEXT, MANAGEMENT_EVIDENCE_TEXT } from "../web/strategy-switch-console/application/runtime_instances/account_management_text.js";

import {
  presentActivation,
  presentHealth,
  evidenceFresh,
  evidenceMissing,
  evidenceStale,
  evidenceConflict,
  activationEvidenceFromLegacyLabel,
  healthEvidenceFromLegacyLabel,
} from "../web/strategy-switch-console/frontend/src/accountStatus.ts";
import {
  classifyAccountCashSign,
  cashSignNote,
  getPlatformAdapter,
} from "../web/strategy-switch-console/frontend/src/platformAdapters.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const bindingId = "b".repeat(64);

function lbFacts({ financing = true, negative = true, dataStatus = "fresh", binding = "bound", mismatch = false } = {}) {
  const cash = negative
    ? [{ currency: "USD", available_cash: "-12.50", frozen_cash: "0", settling_cash: "0" }]
    : [{ currency: "USD", available_cash: "12.50", frozen_cash: "0", settling_cash: "0" }];
  const row = {
    platform: "longbridge",
    account_key: "sg",
    binding_status: binding,
    identity_status: "partial_identity",
    identity_mismatch: mismatch,
    data_status: dataStatus,
    broker_environment: "live",
    target_id: "sg",
    source_binding_id: bindingId,
    account_scope: "live",
    observation_date: "2026-10-08",
    observed_started_at: "2026-10-08T12:00:00.000Z",
    observed_finished_at: "2026-10-08T12:01:00.000Z",
    balances: [{ currency: "USD", net_assets: "1000", total_cash: negative ? "-12.50" : "12.50" }],
    cash,
    return: { status: "unavailable", reason: "external_cashflow_required" },
  };
  if (financing) {
    row.financing = [{
      currency: "USD",
      max_finance_amount: "1000",
      remaining_finance_amount: "800",
      buy_power: "500",
      risk_level: "0",
    }];
  }
  return row;
}

assert.equal(presentActivation(evidenceFresh("enabled", "test", "")).label, "已启用");
assert.equal(presentActivation(evidenceFresh("disabled", "test", "")).label, "已停用");
assert.equal(presentActivation(evidenceMissing("test", "启用资料未取得")).label, "异常");
assert.equal(presentActivation(evidenceStale("test", "启用状态已过期")).label, "异常");
assert.equal(presentActivation(evidenceConflict("test", "启用状态冲突")).label, "异常");
assert.equal(presentActivation(activationEvidenceFromLegacyLabel("启用未知")).label, "异常");
assert.equal(presentActivation(activationEvidenceFromLegacyLabel("待确认")).label, "异常");
assert.equal(presentHealth(healthEvidenceFromLegacyLabel("等待周期")).label, "健康");
assert.equal(presentHealth(healthEvidenceFromLegacyLabel("健康未知")).label, "异常");

assert.equal(getPlatformAdapter("longbridge").capability().supportsMarginEvidence, true);
assert.equal(getPlatformAdapter("longbridge").capability().canEnable, false);
assert.equal(getPlatformAdapter("ibkr").capability().supportsMarginEvidence, false);
assert.equal(getPlatformAdapter("binance").capability().canResume, true);

const financed = classifyAccountCashSign("longbridge", lbFacts({ financing: true, negative: true }), true);
assert.equal(financed.kind, "financing");
assert.equal(financed.detail, "融资占用（已核实）");
assert.equal(classifyAccountCashSign("longbridge", lbFacts({ financing: false, negative: true }), true).kind, "unverified");
assert.equal(classifyAccountCashSign("longbridge", lbFacts({ financing: true, negative: true, dataStatus: "stale" }), true).kind, "unverified");
assert.equal(classifyAccountCashSign("ibkr", null, true).detail, "负现金未核实");
assert.equal(classifyAccountCashSign("longbridge", lbFacts({ negative: false }), false).kind, "non_negative");
assert.equal(cashSignNote(classifyAccountCashSign("longbridge", lbFacts({ negative: false }), false)), "");

const overview = readFileSync(join(root, "web/strategy-switch-console/frontend/src/pages/overview/OverviewPage.tsx"), "utf8");
assert.doesNotMatch(overview, /classifyAccountCashSign|cashSignNote|融资占用（已核实）|负现金未核实/);
assert.doesNotMatch(overview, /presentActivation/);
assert.doesNotMatch(overview, /可能是借的钱/);
const adapters = readFileSync(join(root, "web/strategy-switch-console/frontend/src/platformAdapters.ts"), "utf8");
assert.match(adapters, /classifyAccountCashSign/);
assert.match(adapters, /融资占用（已核实）/);
assert.doesNotMatch(overview, /function negativeCashStatusForPlatform/);
assert.doesNotMatch(overview, /启用未知/);
assert.doesNotMatch(overview, /健康未知/);

console.log("account_status_layers_validation ok");

assert.equal(getPlatformAdapter("firstrade").capability().requiresHumanSession, true);
assert.equal(getPlatformAdapter("schwab").capability().requiresHumanSession, false);
assert.equal(getPlatformAdapter("binance").capability().canEnable, false);

// B2-A13 / Q4 / Q6: SSR management UI matrix across both locales and both themes.
{
  const tokensCss = readFileSync(join(root, "web/strategy-switch-console/frontend/src/app/tokens.css"), "utf8");
  const accountsCss = readFileSync(join(root, "web/strategy-switch-console/frontend/src/pages/accounts/accounts.css"), "utf8");
  const factsCss = readFileSync(join(root, "web/strategy-switch-console/frontend/src/components/account-facts.css"), "utf8");
  const darkAt = tokensCss.indexOf(':root[data-theme="dark"]');
  const upDownAt = tokensCss.indexOf("/* Up/down");
  const lightBlock = tokensCss.slice(0, darkAt);
  const darkBlock = tokensCss.slice(darkAt, upDownAt);
  const lightVars = new Set([...lightBlock.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m => m[1]));
  const darkVars = new Set([...darkBlock.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m => m[1]));
  const rootAliases = new Map([...lightBlock.matchAll(/^\s*(--[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\);/gm)].map(m => [m[1], m[2]]));
  const resolvesToDark = name => {
    let cur = name;
    for (let i = 0; i < 6 && cur; i++) {
      if (darkVars.has(cur)) return true;
      cur = rootAliases.get(cur);
    }
    return false;
  };
  for (const cssText of [accountsCss, factsCss]) {
    for (const m of cssText.matchAll(/var\((--[a-z0-9-]+)(?:,\s*var\((--[a-z0-9-]+)\))?\)/g)) {
      const names = [m[1], m[2]].filter(Boolean);
      const allLight = names.some(name => lightVars.has(name));
      const allDark = names.some(resolvesToDark);
      assert.ok(allLight, `light theme declares token for ${names.join(" / ")}`);
      assert.ok(allDark || !names.some(name => /surface|text|border|accent|success|warning|danger|info|status|line|ink|muted|canvas|chrome/.test(name)),
        `dark theme declares colour token for ${names.join(" / ")}`);
    }
  }

  const frontendDir = join(root, "web/strategy-switch-console/frontend");
  const tmpDir = mkdtempSync(join(tmpdir(), "mgmt-ui-matrix-"));
  let ui;
  try {
    const outfile = join(tmpDir, "matrix.cjs");
    await build({
      stdin: {
        resolveDir: frontendDir,
        contents: `
          import { createElement as h } from 'react';
          import { renderToStaticMarkup } from 'react-dom/server';
          import { I18nProvider } from './src/i18n';
          import { PrefsContext } from './src/app/context';
          import { DEFAULT_PREFERENCES } from './src/lib/prefs';
          import { AccountManagementSectionView } from './src/pages/accounts/AccountManagementPanel';
          import { AccountFactsManagementCoverageBar, PlatformFactsSummary } from './src/components/AccountFactsAmounts';
          import { AccountGroups } from './src/components/AccountGroups';
          const render = (language, theme, component, props) => renderToStaticMarkup(
            h(I18nProvider, { language },
              h(PrefsContext.Provider, { value: { prefs: { ...DEFAULT_PREFERENCES, language, theme }, resolvedTheme: theme, setPrefs: () => {} } },
                h(component, props))));
          export const management = (language, theme, props) => render(language, theme, AccountManagementSectionView, props);
          export const platform = (language, theme, props) => render(language, theme, PlatformFactsSummary, props);
          export const coverage = (language, theme, props) => render(language, theme, AccountFactsManagementCoverageBar, props);
          export const groups = (language, theme, props) => render(language, theme, AccountGroups, props);
        `,
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile,
      jsx: "automatic",
      loader: { ".css": "empty" },
      define: { "import.meta.env": "{}" },
      logLevel: "silent",
    });
    ui = createRequire(import.meta.url)(outfile);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const visibleText = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const baseSection = (overrides = {}) => ({
    evidence_scope: "runtime_instances_sqlite",
    policy_revision: 2,
    instance_revision: 5,
    management_class: "eligible",
    management_status: "managed",
    evidence_state: "known",
    reasons: [],
    processing_eligible: true,
    siblings: [{ platform: "longbridge", key: "syn-sib-a" }, { platform: "longbridge", key: "syn-sib-b" }],
    applied: { management_enabled: true, revision: 1, effective_at: "2026-11-18T01:00:00.000Z" },
    draft: { management_enabled: true, revision: 1, base_applied_revision: 0, status: "consumed", consumed_applied_revision: 1 },
    ...overrides,
  });
  const baseEditor = (overrides = {}) => ({
    draftValue: "true",
    dirty: false,
    saving: "",
    uncertain: false,
    uncertainRequestKey: null,
    staleReplayIgnored: false,
    ...overrides,
  });
  const baseFact = (key, overrides = {}) => ({
    platform: "ibkr",
    account_key: key,
    binding_status: "bound",
    identity_status: "partial_identity",
    identity_mismatch: false,
    data_status: "fresh",
    broker_environment: "live",
    account_scope: "LIVE",
    observation_date: "2026-11-18",
    observed_started_at: "2026-11-18T00:00:00Z",
    observed_finished_at: "2026-11-18T00:01:00Z",
    aggregation_status: "included",
    management_status: "managed",
    evidence_state: "known",
    management_revision: 1,
    balances: [{ currency: "USD", net_assets: "500.00" }],
    cash: [{ currency: "USD", cash_balance: "100.00" }],
    ...overrides,
  });

  const cells = [];
  const rowCounts = new Map();
  const recordCell = (cellId, rowId, language, theme, outcome = "pass") => {
    cells.push({ cell_id: cellId, row_id: rowId, locale: language === "zh" ? "zh-CN" : "en", theme, outcome });
    const entry = rowCounts.get(rowId) || { status: "passed", checks: 0 };
    entry.checks += 1;
    rowCounts.set(rowId, entry);
  };

  for (const language of ["zh", "en"]) {
    const langKey = language === "zh" ? "zh-CN" : "en";
    for (const theme of ["light", "dark"]) {
      // 1. All four statuses using pinned MANAGEMENT_STATUS_TEXT
      for (const status of ["managed", "management_disabled", "not_under_management", "unknown"]) {
        const html = ui.management(language, theme, {
          section: baseSection({
            management_status: status,
            management_class: status === "not_under_management" ? "display_only" : "eligible",
            applied: status === "managed" ? baseSection().applied : status === "management_disabled" ? { ...baseSection().applied, management_enabled: false } : null,
          }),
          editor: baseEditor(),
          canAdminWrite: true,
          readState: "ready",
          feedback: null,
        });
        const text = visibleText(html);
        assert.ok(text.includes(MANAGEMENT_STATUS_TEXT[status][langKey]), `${status} status text in ${langKey}/${theme}`);
        assert.ok(text.includes(language === "zh" ? "不会下单" : "places no orders"), `non-trading copy in ${langKey}/${theme}`);
        if (language === "en") assert.doesNotMatch(text, /[\u3400-\u9fff]/u, `zero CJK in English management panel (${status}/${theme})`);
        assert.doesNotMatch(text, /\b(?:accounts|reason|facts)\.[a-z_]+\b/, "no raw i18n keys");
        recordCell(`status_${status}`, "B2-A13", language, theme);
      }

      // 2. All three non-known evidence suffixes using pinned MANAGEMENT_EVIDENCE_TEXT
      for (const evidence of ["unknown", "conflict", "stale"]) {
        const html = ui.management(language, theme, {
          section: baseSection({
            management_status: "unknown",
            evidence_state: evidence,
            reasons: evidence === "conflict" ? ["physical_identity_changed"] : ["management_status_unknown"],
          }),
          editor: baseEditor(),
          canAdminWrite: true,
          readState: "ready",
          feedback: null,
        });
        const text = visibleText(html);
        assert.ok(text.includes(MANAGEMENT_EVIDENCE_TEXT[evidence][langKey]), `${evidence} evidence text in ${langKey}/${theme}`);
        if (language === "en") assert.doesNotMatch(text, /[\u3400-\u9fff]/u, `zero CJK in English (${evidence}/${theme})`);
        recordCell(`evidence_${evidence}`, "B2-A13", language, theme);
      }

      // 3. Pending draft distinct from applied state
      const pendingHtml = ui.management(language, theme, {
        section: baseSection({
          management_status: "managed",
          applied: { management_enabled: true, revision: 1, effective_at: "2026-11-18T01:00:00.000Z" },
          draft: { management_enabled: false, revision: 2, base_applied_revision: 1, status: "pending", consumed_applied_revision: null },
        }),
        editor: baseEditor({ draftValue: "false" }),
        canAdminWrite: true,
        readState: "ready",
        feedback: null,
      });
      const pendingText = visibleText(pendingHtml);
      assert.ok(pendingText.includes(MANAGEMENT_STATUS_TEXT.managed[langKey]));
      assert.ok(pendingText.includes(MANAGEMENT_STATUS_TEXT.management_disabled[langKey]));
      assert.ok(pendingHtml.includes("management-draft-pending"));
      recordCell("pending_vs_applied", "B2-A13", language, theme);

      // 3b. B03/Q-D: unchanged pending value keeps an enabled Save (a stale draft needs a fresh save).
      const buttonDisabled = (html, label) => new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`).test(html);
      const saveLabel = language === "zh" ? "保存管理草案" : "Save management draft";
      assert.ok(pendingText.includes(saveLabel) && !buttonDisabled(pendingHtml, saveLabel), "Save stays available for an unchanged pending value");
      const noWrite = ui.management(language, theme, { section: baseSection({ draft: { management_enabled: false, revision: 2, base_applied_revision: 1, status: "pending", consumed_applied_revision: null } }),
        editor: baseEditor({ draftValue: "false", uncertain: true }), canAdminWrite: true, readState: "ready", feedback: null });
      assert.ok(buttonDisabled(noWrite, saveLabel), "the uncertain-write gate still disables Save");
      recordCell("pending_resave", "B2-A13", language, theme);

      // 3c. B03: proven commit with no readable section renders the warning and a reread in every read state.
      for (const readState of ["ready", "failed", "loading"]) {
        const html = ui.management(language, theme, { section: null, editor: baseEditor({ committedStateUnknown: true }),
          canAdminWrite: true, readState, feedback: null, onRefresh: () => {} });
        assert.ok(html.includes('data-state="management.committed_unknown"'), `committed warning renders (${readState})`);
        assert.ok(html.includes(language === "zh" ? "重新读取" : "Re-read"), `reread action renders (${readState})`);
        assert.ok(!html.includes("management-radio"), "no ordinary edit controls without a section");
      }
      const plain = ui.management(language, theme, { section: null, editor: baseEditor(), canAdminWrite: true, readState: "ready", feedback: null });
      assert.equal(plain, "", "without a proven commit an empty ready section still renders nothing");
      recordCell("committed_unknown_empty", "B2-A13", language, theme);

      // 4. Uninitialized eligible account (rev 0, applied === null, never OFF)
      const uninitHtml = ui.management(language, theme, {
        section: baseSection({
          management_status: "unknown",
          evidence_state: "unknown",
          applied: null,
          draft: null,
        }),
        editor: baseEditor({ draftValue: "" }),
        canAdminWrite: true,
        readState: "ready",
        feedback: null,
      });
      const uninitText = visibleText(uninitHtml);
      assert.ok(uninitText.includes(MANAGEMENT_STATUS_TEXT.unknown[langKey]));
      assert.ok(!uninitText.includes(MANAGEMENT_STATUS_TEXT.management_disabled[langKey]), "uninitialized is never invented as disabled");
      recordCell("uninitialized_eligible", "B2-A13", language, theme);

      // 5. Absent/invalid policy (unknown, disabled controls, never OFF)
      const noPolicyHtml = ui.management(language, theme, {
        section: baseSection({
          policy_revision: null,
          management_class: null,
          management_status: "unknown",
          evidence_state: "unknown",
          reasons: ["management_policy_unavailable"],
          processing_eligible: false,
          siblings: [],
          applied: null,
          draft: null,
        }),
        editor: baseEditor({ draftValue: "" }),
        canAdminWrite: true,
        readState: "ready",
        feedback: null,
      });
      assert.ok(noPolicyHtml.includes('data-state="management.policy_unavailable"'));
      recordCell("policy_unavailable", "B2-A16", language, theme);

      // 6. Sibling coupling notice + uncertain write lock
      const siblingHtml = ui.management(language, theme, {
        section: baseSection(),
        editor: baseEditor({ uncertain: true, uncertainRequestKey: "88888888-8888-4888-8888-888888888888" }),
        canAdminWrite: true,
        readState: "ready",
        feedback: null,
      });
      assert.ok(siblingHtml.includes("longbridge/syn-sib-a"));
      assert.ok(siblingHtml.includes("longbridge/syn-sib-b"));
      assert.ok(siblingHtml.includes('data-state="management.uncertain"'));
      recordCell("sibling_and_uncertain_lock", "B2-A10", language, theme);
      recordCell("uncertain_lock", "B2-A06", language, theme);

      // 7. Account-facts unknown cohort blocks platform total but keeps raw card balances visible
      const unknownRows = [
        baseFact("syn-a", { management_status: "managed", evidence_state: "known" }),
        baseFact("syn-b", { management_status: "unknown", evidence_state: "unknown" }),
      ];
      const unknownPlatformHtml = ui.platform(language, theme, { rows: unknownRows, expected: 2, phase: "ready" });
      assert.ok(unknownPlatformHtml.includes('data-state="facts.platform_management_unknown"'));
      assert.ok(!/USD\s*\d/.test(unknownPlatformHtml), "no summed USD total when cohort status unknown");
      const coverageHtml = ui.coverage(language, theme, {
        coverage: {
          scope: "account_facts_totals",
          source: "validated_account_facts_snapshot",
          totals_status: "unavailable",
          totals_reason: "management_status_unknown",
          management_scope: "managed_non_paper",
          management_coverage_status: "incomplete",
          management_counts: {
            display_physical: 2, display_deployments: 2, managed_non_paper: 1,
            management_disabled_non_paper: 0, not_under_management_non_paper: 0,
            unknown_non_paper: 1, paper_excluded: 0, duplicate_deployments: 0, unresolved_deployments: 0,
          },
          accounts: [],
        },
      });
      assert.ok(coverageHtml.includes('data-management-coverage="incomplete"'));
      assert.ok(coverageHtml.includes('data-state="facts.management_status_unknown"'));
      const groupsHtml = ui.groups(language, theme, {
        accounts: [
          { account_alias: "syn-a", platform: "ibkr", pending_draft_count: 0, pending_decision_count: 0, last_change_at: null },
          { account_alias: "syn-b", platform: "ibkr", pending_draft_count: 0, pending_decision_count: 0, last_change_at: null },
        ],
        config: null,
        facts: { rows: unknownRows, phase: "ready" },
        onSelect: () => {},
      });
      assert.ok(groupsHtml.includes("USD 500.00"), "raw card balances stay visible even when platform total is unavailable");
      if (language === "en") assert.doesNotMatch(visibleText(groupsHtml), /[\u3400-\u9fff]/u, "no CJK in English groups");
      recordCell("facts_cohort_unknown_preserves_raw", "B2-A17", language, theme);

      // 8. B04: disposition consistency on PlatformFactsSummary across zh-CN/en & light/dark
      const certPaperHtml = ui.platform(language, theme, {
        rows: [baseFact("syn-paper-cert", { broker_environment: null, account_scope: null, user_declaration: { source: "user_declared", environment: "live", account_type: null },
          management_status: "managed", evidence_state: "known", management_disposition: "paper" })],
        expected: 1, phase: "ready",
      });
      assert.ok(!/USD\s*\d/.test(certPaperHtml), "certified paper missing own scope never sums even with live declaration");
      assert.ok(certPaperHtml.includes('data-state="facts.platform_no_managed_accounts"'));
      const legacyPaperHtml = ui.platform(language, theme, {
        rows: [baseFact("syn-paper-legacy", {
          broker_environment: "paper", account_scope: "paper",
          management_status: undefined, evidence_state: undefined,
          management_disposition: undefined, management_scope_conflict: undefined,
        })],
        expected: 1, phase: "ready",
      });
      assert.ok(legacyPaperHtml.includes('data-state="state.no_data"'), "legacy unstamped paper retains state.no_data");
      const emptyCohortHtml = ui.platform(language, theme, { rows: [], expected: 0, phase: "ready" });
      assert.ok(emptyCohortHtml.includes('data-state="state.not_connected"'));
      const unkPaperDeclHtml = ui.platform(language, theme, {
        rows: [baseFact("syn-a", { management_status: "managed", evidence_state: "known", management_disposition: "managed" }),
          baseFact("syn-unk", { broker_environment: null, account_scope: null, user_declaration: { source: "user_declared", environment: "paper", account_type: null },
            management_status: "unknown", evidence_state: "unknown", management_disposition: "unknown" })],
        expected: 2, phase: "ready",
      });
      assert.ok(unkPaperDeclHtml.includes('data-state="facts.platform_management_unknown"'), "paper declaration never hides unknown cohort");
      const rawPaperConflictHtml = ui.platform(language, theme, {
        rows: [baseFact("syn-a", { broker_environment: "paper", account_scope: "paper", management_status: "managed", evidence_state: "known",
          management_disposition: "unknown", management_scope_conflict: true })],
        expected: 1, phase: "ready",
      });
      assert.ok(rawPaperConflictHtml.includes('data-state="facts.platform_management_unknown"'), "scope conflict surfaces unknown reason over raw paper");
      recordCell("facts_b04_disposition_consistency", "B2-A17", language, theme);
    }
  }

  const out = process.env.MANAGEMENT_UI_MATRIX_OUT;
  if (out) {
    const matrixReport = {
      format: "qsl_management_ui_matrix.v1",
      locales: ["zh-CN", "en"],
      themes: ["light", "dark"],
      checks: cells.length,
      rows: Object.fromEntries(rowCounts),
      cells,
      outbound_calls: 0,
    };
    writeFileSync(out, JSON.stringify(matrixReport, null, 2) + "\n");
  }
  console.log(`management_ui_matrix ok (${cells.length} locale/theme cells)`);
}
