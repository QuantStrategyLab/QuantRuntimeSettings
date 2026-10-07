import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildSync } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { candidateDisplayName, listDailyDecisions, strategyIdentityView, strategySelectionName } from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { __test as serverContract } from "../web/strategy-switch-console/worker.js";
import { translate } from "../web/strategy-switch-console/frontend/src/locales.ts";
import { createAccountSettingsController } from "../web/strategy-switch-console/frontend/src/accountSettingsState.ts";

const profiles = JSON.parse(readFileSync(new URL("../web/strategy-switch-console/strategy-profiles.example.json", import.meta.url), "utf8"));
const v7 = profiles.find(row => row.profile === "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve");
const configHash = "843ab4e93e81985c2b3becc61a2f0b971508ccf25afa59acf402e75f574514d1";
const ready = value => ({ value: { data_status: "ready", ...value } });
const freeze = value => { for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); return Object.freeze(value); };
freeze(profiles);
assert.equal(profiles.length, 27);
for (const language of ["zh", "en"]) {
  const key = language === "zh" ? "label_zh" : "label_en";
  for (const profile of profiles) assert.equal(strategySelectionName(profile, profiles, language), profile[key]);
  assert.equal(new Set(profiles.map(profile => strategySelectionName(profile, profiles, language))).size, 27);
  assert.equal(strategySelectionName(null, [], language), language === "zh" ? "未命名策略" : "Unnamed strategy");
  const duplicates = [{ profile: "a", label_zh: "同名", label_en: "Same" }, { profile: "b", label_zh: "同名", label_en: "Same" }];
  assert.equal(strategySelectionName(duplicates[0], duplicates, language), `${duplicates[0][key]} · a`);
  assert.equal(strategySelectionName(duplicates[1], duplicates, language), `${duplicates[1][key]} · b`);
  assert.equal(strategySelectionName(duplicates[0], [duplicates[0], duplicates[0]], language), duplicates[0][key], "duplicate rows with the same identity do not create a false collision");
}
assert.equal(strategySelectionName(v7, profiles, "zh"), "SOXL/SOXX 核心复利（现金保留）");
assert.equal(strategySelectionName(v7, profiles, "en"), "SOXL/SOXX Core Compounding (Cash Reserve)");
assert.equal(candidateDisplayName(v7.profile, "zh"), v7.label_zh);
assert.equal(candidateDisplayName(v7.profile, "en"), v7.label_en);
assert.equal(candidateDisplayName("invented_champion_live_v77", "en"), "Unnamed strategy");
for (const id of [v7.profile, "us_equity_combo", "us_equity_combo_core", "crypto_live_pool_rotation"]) {
  const canonical = profiles.find(row => row.profile === id);
  const stalePrivate = freeze({ profile: id, label_zh: "旧私有展示名", label_en: "Old private display name", runtime_enabled: true, source_revision: "private-source" });
  for (const language of ["zh", "en"]) assert.equal(strategySelectionName(stalePrivate, [stalePrivate], language), canonical[language === "zh" ? "label_zh" : "label_en"]);
  const identity = strategyIdentityView({ profile: stalePrivate, basis: "策略目录" });
  assert.equal(identity.configHash, null); assert.equal(identity.sourceRevision, null); assert.equal(identity.role, null); assert.equal(identity.lane, null);
}
for (const profile of [
  { profile: "private_unknown_champion_live", label_zh: "自定义名字", label_en: "Custom name" },
  { profile: "tqqq_growth_income", label_zh: "我的TQQQ名称", label_en: "My TQQQ name" },
]) for (const language of ["zh", "en"]) assert.equal(strategySelectionName(profile, [profile], language), profile[language === "zh" ? "label_zh" : "label_en"], "unreviewed IDs and other private labels stay untouched");
assert.equal(candidateDisplayName("toString", "en"), "Unnamed strategy");
assert.equal(candidateDisplayName("tqqq_core_only_p2_v9_benchmark_drawdown_guard", "en"), "TQQQ Benchmark Drawdown Guard");

const catalog = strategyIdentityView({ profile: v7, basis: "策略目录" });
assert.equal(catalog.profileId, v7.profile);
assert.equal(strategyIdentityView({ profile: v7, profileId: "different_profile", basis: "策略目录" }).candidateId, null, "a mismatched profile cannot donate its candidate identity");
assert.equal(catalog.candidateId, v7.profile);
assert.equal(catalog.candidateVersion, "V7");
assert.equal(catalog.configHash, configHash);
assert.equal(catalog.sourceRevision, null, "frozen source never fills an absent current source field");
assert.equal(catalog.role, null);
assert.equal(catalog.lane, null);
assert.equal(catalog.studyId, null);
assert.equal(catalog.evidenceAt, null);
assert.equal(catalog.frozenResearch.sourceRevision, "07b164d95f2ab4d4c54fd993f6f2040bd207d664");
assert.equal(catalog.frozenResearch.runtimeRevision, "f30e7b1910df8da22fdcedc347ab847df5adcd76");
assert.equal(catalog.frozenResearch.configHash, configHash);
assert.match(catalog.frozenResearch.noteZh, /3%/);
assert.match(catalog.frozenResearch.noteEn, /source-correctness/);
assert.equal(strategyIdentityView({ profile: v7, basis: "研究票据", record: {} }).configHash, null, "catalog identity cannot repair a missing historical record identity");
assert.equal(strategyIdentityView({ profile: v7, basis: "研究票据", record: {} }).candidateId, null);

const study = freeze({ candidateId: v7.profile, configHash, studyId: "soxl_v7_twelve_basic_split_close_development_v1", role: "candidate", lane: "research", evidenceAt: "2026-09-26T12:00:00Z" });
const r6 = strategyIdentityView({ profile: v7, basis: "候选材料", record: study });
assert.equal(r6.candidateVersion, "V7");
assert.equal(r6.studyId, study.studyId);
assert.equal(r6.studyLabel, "R6");
assert.equal(r6.role, "candidate");
assert.equal(r6.lane, "research");
assert.equal(r6.evidenceAt, study.evidenceAt);
assert.equal(r6.sourceRevision, null);
assert.equal(strategyIdentityView({ basis: "候选材料", record: { studyId: study.studyId } }).candidateId, null, "study ID does not invent a signal binding");
for (const profile of profiles) {
  const view = strategyIdentityView({ profile, basis: "策略目录" });
  assert.equal(view.role, null);
  assert.equal(view.lane, null, "catalog modes/lifecycle never establish an observed execution lane");
  assert.equal(view.sourceRevision, null);
  if (profile !== v7) { assert.equal(view.configHash, null); assert.equal(view.frozenResearch, null); }
}
for (const record of [
  { candidateId: "champion_live_v99", role: "live_candidate", lane: "runtime_enabled" },
  { candidateId: v7.profile, configHash: "b".repeat(64), sourceRevision: null },
  { candidateId: v7.profile, configHash: 42, evidenceAt: "not-a-date" },
]) {
  const view = strategyIdentityView({ basis: "候选材料", record });
  assert.equal(view.role, null); assert.equal(view.lane, null); assert.equal(view.frozenResearch, null);
}
assert.equal(strategyIdentityView({ basis: "候选材料", record: { candidateId: "champion_live_v99" } }).candidateVersion, null);
assert.equal(strategyIdentityView({ basis: "候选材料", record: { candidateId: v7.profile, configHash: `sha256:${configHash}` } }).configHash, `sha256:${configHash}`, "existing digest text stays intact");
assert.equal(strategyIdentityView({ basis: "候选材料", record: { sourceRevision: "source-observed", role: "champion", lane: "live" } }).sourceRevision, "source-observed");

const unboundTicket = freeze({ ticket_id: "historical-ticket-id", strategy_profile: v7.profile, state: "awaiting_human", proposed_params: { candidate_id: v7.profile, config_sha256: configHash }, created_at: "2026-09-26T12:00:00Z", research_summary: { comparison: null, limitations: [] } });
const normalizedTicket = serverContract.normalizeResearchPromotionTicket({ ...unboundTicket, domain: v7.domain });
const ticket = freeze({ ...normalizedTicket, decision_binding: {
  kind: "promotion", subject_id: unboundTicket.ticket_id,
  material_sha256: await serverContract.researchPromotionMaterialKey(normalizedTicket), review_binding: null,
} });
for (const language of ["zh", "en"]) {
  const result = listDailyDecisions({ language, profiles, promotions: ready({ tickets: [ticket] }), owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [] });
  const decision = result.items[0];
  assert.equal(decision.title, strategySelectionName(v7, profiles, language));
  assert.equal(decision.proposedName, decision.title);
  assert.equal(decision.reference, ticket.ticket_id);
  assert.equal(decision.identity.candidateId, v7.profile);
  assert.equal(decision.identity.configHash, configHash);
  assert.equal(decision.identity.sourceRevision, null);
  assert.equal(decision.identity.evidenceAt, null, "ticket creation time is not evidence observation time");
  assert.deepEqual(JSON.parse(decision.technical).proposed_params, ticket.proposed_params);
  assert.equal(decision.canReject, true);
  assert.equal(decision.canAdopt, false);
  const unbound = listDailyDecisions({ language, profiles, promotions: ready({ tickets: [unboundTicket] }), owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [] }).items[0];
  assert.deepEqual(unbound.identity, decision.identity, "unbound historical material retains its displayed identity");
  assert.equal(unbound.title, decision.title);
  assert.equal(unbound.canReject, false, "missing exact material binding is not actionable");
  assert.equal(unbound.canAdopt, false);
}
const controller = createAccountSettingsController();
const selection = controller.select({ platform: "longbridge", key: "synthetic" });
controller.applyRead(selection, { platform: "longbridge", key: "synthetic", identity: { platform: "longbridge", key: "synthetic" }, draft: { status: "current", revision: 2, overrides: {} }, risk: { revision: 1 }, effective: {}, operations: { save_draft: true } });
controller.edit({ strategy: v7.profile, strategyTouched: true, clearStrategy: false });
const body = controller.requestBody(controller.startSave("strategy"));
assert.equal(body.overrides.strategy_profile, v7.profile, "submitted strategy ID never becomes a label");
assert.equal(body.expected_draft_revision, 2);

for (const key of ["策略身份与版本", "身份来源", "策略目录", "研究票据", "候选材料", "应用记录", "候选版本", "研究 study", "来源 revision（资料字段）", "配置摘要（资料字段）", "研究角色（资料字段）", "运行通道（资料字段）", "证据时间", "冻结研究版本", "冻结研究索引不证明实际部署、采用或运行状态。", "未知"]) assert.notEqual(translate(key, "en"), key);
const accounts = readFileSync(new URL("../web/strategy-switch-console/frontend/src/AccountsPage.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
const decisionsPage = readFileSync(new URL("../web/strategy-switch-console/frontend/src/DecisionsPage.tsx", import.meta.url), "utf8");
assert.match(accounts, /strategySelectionName\(choice, strategyOptions, language\)/);
assert.match(accounts, /<StrategyIdentity/);
assert.match(decisionsPage, /<StrategyIdentity/);
assert.match(app, /strategySelectionName/);
assert.match(app, /<StrategyIdentity/);
assert.match(app, /expected_strategy_profile: ticket.strategy_profile/);
assert.match(accounts, /key=\{item.profile\} value=\{item.profile\}/);
// Render the actual React components offline. This is SSR proof, not browser interaction QA.
const temporary = mkdtempSync(join(tmpdir(), "qsl-strategy-ssr-"));
try {
  const frontend = fileURLToPath(new URL("../web/strategy-switch-console/frontend", import.meta.url));
  const appSource = readFileSync(join(frontend, "src/App.tsx"), "utf8");
  const facade = join(temporary, "App.tsx");
  writeFileSync(facade, appSource.replaceAll('from "./', `from "${frontend}/src/`) + "\nexport { ApplicationCard };\n");
  const bundle = buildSync({ stdin: { contents: `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { LocaleContext } from "./src/locales";
    import { StrategyIdentity } from "./src/StrategyIdentity";
    import { DecisionsPage } from "./src/DecisionsPage";
    import { ApplicationCard } from "${facade}";
    export const identity = (value, language) => renderToStaticMarkup(<LocaleContext.Provider value={language}><StrategyIdentity value={value}/></LocaleContext.Provider>);
    export const application = (application, profiles, language) => renderToStaticMarkup(<LocaleContext.Provider value={language}><ApplicationCard application={application} profiles={profiles} language={language} busy={false} onDeploy={()=>{}}/></LocaleContext.Provider>);
    export const decisions = (items, language) => renderToStaticMarkup(<LocaleContext.Provider value={language}><DecisionsPage blocked={false} items={items} admin={false} busy={false} selectedAccountId="" onSelectAccount={()=>{}} onDecide={()=>{}}/></LocaleContext.Provider>);
  `, resolveDir: frontend, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false, nodePaths: [join(frontend, "node_modules")] });
  const path = join(temporary, "render.cjs");
  writeFileSync(path, bundle.outputFiles[0].text);
  const render = createRequire(import.meta.url)(path);
  for (const language of ["zh", "en"]) {
    const html = render.identity(catalog, language);
    assert.match(html, /<details class="decision-fold strategy-identity">/);
    assert.equal(html.includes("Information unavailable"), false, "every rendered detail label has English copy");
    assert.equal(html.includes("<details open"), false, "long identity metadata is collapsed initially");
    assert.match(html, /843ab4e93e81985c2b3becc61a2f0b971508ccf25afa59acf402e75f574514d1/);
    assert.equal(html.includes(translate("冻结研究索引不证明实际部署、采用或运行状态。", language)), true);
    assert.equal(html.includes(translate("未知", language)), true);
    const studyHtml = render.identity(r6, language);
    assert.match(studyHtml, /<details class="decision-fold strategy-identity">/);
    const result = listDailyDecisions({ language, profiles, promotions: ready({ tickets: [ticket] }), owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [] });
    const decisionHtml = render.decisions(result.items, language);
    assert.equal(decisionHtml.includes(strategySelectionName(v7, profiles, language)), true);
    assert.equal(decisionHtml.includes(ticket.ticket_id), true);
    assert.equal(decisionHtml.includes(translate("策略身份与版本", language)), true);
    assert.match(decisionHtml, /disabled=""/, "synthetic non-admin cannot decide");
    const application = { ...ticket, application_preparation: { account_options: [] }, application: { strategy_profile: v7.profile, candidate_id: v7.profile, config_sha256: configHash, status: "unknown", dispatch_state: "unknown" } };
    const applicationHtml = render.application(application, profiles, language);
    assert.equal(applicationHtml.includes(strategySelectionName(v7, profiles, language)), true);
    assert.equal(applicationHtml.includes(configHash), true);
    assert.match(applicationHtml, /disabled=""/);
    const historicalGap = render.application({ ...application, application: { status: "unknown", dispatch_state: "unknown" } }, profiles, language);
    assert.equal(historicalGap.includes(configHash), false, "a prior application with missing identity is not repaired from its ticket");
    assert.equal(historicalGap.includes(strategySelectionName(v7, profiles, language)), false);
  }
  assert.equal(render.identity(strategyIdentityView({ basis: "候选材料", record: { candidateId: "<script>unsafe</script>" } }), "en").includes("<script>unsafe</script>"), false, "React escapes supplied identity text");
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log("Strategy display identity validation passed (including actual React SSR)");
