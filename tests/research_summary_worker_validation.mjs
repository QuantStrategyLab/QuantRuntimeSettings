import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { promotionSuggestion } from "../web/strategy-switch-console/frontend/src/operations.ts";

const locales = {
  "zh-CN": {
    question: "该候选与基线在固定窗口下是否接近？",
    basis: "比较来自同一窗口与同一成本条件。",
    limits: "这只是候选建议，尚未选定账户。",
    suggestion: "请人工审阅，不构成执行授权。",
  },
  en: {
    question: "Does this candidate stay close to the baseline?",
    basis: "The comparison uses one fixed window and one cost model.",
    limits: "This is candidate advice before any account is selected.",
    suggestion: "Ask a human to review it without execution authority.",
  },
};
const comparable = {
  status: "comparable",
  start_date: "2025-01-01",
  end_date: "2025-12-31",
  cost_model: "cost-v1",
  baseline: { cagr: 0.1, max_drawdown: -0.2 },
  candidate: { cagr: 0.1, max_drawdown: -0.2 },
};
const unavailableComparison = {
  status: "unavailable",
  start_date: null,
  end_date: null,
  cost_model: "",
  baseline: null,
  candidate: null,
};

function explanation(provider = "codex", comparison = comparable, patch = {}) {
  return {
    status: "available",
    provider,
    model: "synthetic-summary-model",
    scope: "candidate",
    locales: structuredClone(locales),
    binding: {
      ticket_id: patch.ticketId || "promo-bilingual",
      strategy_profile: "demo_strategy",
      domain: "us_equity",
      proposed_params: { a: 2 },
      comparison: structuredClone(comparison),
      shadow_evidence_kind: "paired_shadow",
      shadow_passed: true,
      notes: [],
    },
    ...patch.extra,
  };
}

function ticket(id, summaryComparison, ai, limitations = []) {
  const saved = explanation("codex", summaryComparison);
  saved.binding.ticket_id = id;
  return {
    ticket_id: id,
    strategy_profile: "demo_strategy",
    domain: "us_equity",
    state: "awaiting_human",
    drift_status: "review",
    drift_score: 0,
    created_at: "2026-09-28T00:00:00Z",
    updated_at: "2026-09-28T00:00:00Z",
    budget: {},
    proposed_params: { a: 2 },
    search_iterations: 1,
    shadow_evidence_kind: "paired_shadow",
    shadow_passed: true,
    notification_subject: "awaiting human",
    notification_body: "review candidate",
    human_decision: "",
    human_decided_at: "",
    live_authority_granted: false,
    suggested_risk_profile: "CAPITAL_PRESERVATION",
    confirmation_target_platform: "",
    confirmation_execution_mode: "",
    confirmation_risk_profile: "",
    notes: [],
    research_summary: {
      identity: { strategy_profile: "demo_strategy", domain: "us_equity", proposed_params: { a: 2 } },
      strategy_description: "",
      plugins: null,
      comparison: summaryComparison,
      limitations,
      ai_explanation: ai || saved,
    },
  };
}

const store = new Map();
const kv = {
  async get(key) { return store.get(key) || null; },
  async put(key, value) { store.set(key, value); },
  async list({ prefix = "" } = {}) {
    return { keys: [...store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) };
  },
};
const requireForSummary = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = requireForSummary(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const persist = await mkdtemp(join(tmpdir(), "qrt-research-summary-"));
const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist,
});

try {
  const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const env = {
    RESEARCH_PROMOTION_SYNC_TOKEN: "research-promotion-sync",
    STRATEGY_SWITCH_CONFIG: kv,
    SESSION_SECRET: "synthetic-session",
    ALLOWED_GITHUB_LOGINS: "summary-reader",
    STRATEGY_SWITCH_ADMIN_LOGINS: "summary-reader",
    STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace,
  };
  const cookie = `qsl_switch_session=${await __test.makeSession("summary-reader", [], env)}`;
  const headers = { Cookie: cookie, Origin: "https://switch.example" };

  async function sync(body) {
    const response = await worker.fetch(new Request("https://switch.example/api/internal/sync-research-promotion-ticket", {
      method: "POST",
      headers: { Authorization: "Bearer research-promotion-sync", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), env);
    assert.equal(response.status, 200, body.ticket_id);
    return response;
  }

  async function read(id) {
    const response = await worker.fetch(new Request("https://switch.example/api/research-promotion-tickets", { headers }), env);
    assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
    assert.equal(response.status, 200);
    const payload = await response.json();
    const found = payload.tickets.find((item) => item.ticket_id === id);
    assert.ok(found, id);
    assert.equal(payload.policy.live_authority_granted, false);
    return found;
  }

  const anonymous = await worker.fetch(new Request("https://switch.example/api/research-promotion-tickets"), env);
  assert.equal(anonymous.status, 401);

  for (const provider of ["codex", "cursor"]) {
    const id = `promo-${provider}`;
    await sync(ticket(id, comparable, explanation(provider, comparable, { ticketId: id })));
    const saved = await read(id);
    assert.equal(saved.research_summary.ai_explanation.provider, provider);
    assert.equal(saved.research_summary.ai_explanation.scope, "candidate");
    assert.equal(saved.research_summary.ai_explanation.model, "synthetic-summary-model");
    assert.deepEqual(saved.research_summary.ai_explanation.locales, locales);
    assert.equal(saved.research_summary.ai_explanation.binding.ticket_id, id);
    assert.deepEqual(saved.research_summary.ai_explanation.binding.proposed_params, { a: 2 });
    assert.equal(saved.research_summary.comparison.candidate.cagr, 0.1);
    assert.equal(saved.state, "awaiting_human");
    assert.equal(saved.live_authority_granted, false);
    assert.equal(saved.human_decision, "");
  }

  const spacedCost = { ...comparable, cost_model: " cost-v1 " };
  const spacedId = "promo-spaced-cost";
  await sync(ticket(spacedId, spacedCost, explanation("codex", spacedCost, { ticketId: spacedId })));
  const spaced = await read(spacedId);
  assert.equal(spaced.research_summary.comparison.cost_model, " cost-v1 ");
  assert.equal(spaced.research_summary.ai_explanation.binding.comparison.cost_model, " cost-v1 ");
  assert.equal(spaced.research_summary.ai_explanation.status, "available");
  assert.equal(promotionSuggestion(spaced, "zh")?.question, locales["zh-CN"].question);
  assert.equal(promotionSuggestion(spaced, "en")?.question, locales.en.question);
  assert.equal(JSON.stringify(promotionSuggestion(spaced, "en")).includes(locales["zh-CN"].question), false);

  const trimmedOther = explanation("codex", spacedCost, { ticketId: "promo-spaced-other" });
  trimmedOther.binding.comparison.cost_model = " other-cost ";
  await sync(ticket("promo-spaced-other", spacedCost, trimmedOther));
  const spacedOther = await read("promo-spaced-other");
  assert.equal(spacedOther.research_summary.comparison.cost_model, " cost-v1 ");
  assert.equal(spacedOther.research_summary.ai_explanation.status, "unavailable");
  assert.equal(promotionSuggestion(spacedOther, "zh"), null);
  assert.equal(promotionSuggestion(spacedOther, "en"), null);

  const unavailableId = "promo-unavailable-comparison";
  await sync(ticket(
    unavailableId,
    unavailableComparison,
    explanation("codex", unavailableComparison, { ticketId: unavailableId }),
    ["尚无同一条件下的收益对比"],
  ));
  const unavailable = await read(unavailableId);
  assert.equal(unavailable.research_summary.comparison.cost_model, "");
  assert.equal(unavailable.research_summary.comparison.start_date, null);
  assert.equal(unavailable.research_summary.ai_explanation.status, "available");
  assert.equal(unavailable.research_summary.ai_explanation.binding.comparison.cost_model, "");

  const nullCost = explanation("codex", unavailableComparison, { ticketId: "promo-null-cost" });
  nullCost.binding.comparison = { ...unavailableComparison, cost_model: null };
  await sync(ticket("promo-null-cost", unavailableComparison, nullCost, ["尚无同一条件下的收益对比"]));
  const nullCostSaved = await read("promo-null-cost");
  assert.equal(nullCostSaved.research_summary.ai_explanation.status, "unavailable");
  assert.equal(nullCostSaved.research_summary.comparison.cost_model, "");
  assert.equal(nullCostSaved.proposed_params.a, 2);
  assert.equal(nullCostSaved.live_authority_granted, false);

  const mismatches = [
    ["ticket", (binding) => { binding.ticket_id = "other-ticket"; }],
    ["params", (binding) => { binding.proposed_params = { a: 9 }; }],
    ["comparison", (binding) => { binding.comparison.candidate = { cagr: 0.2, max_drawdown: -0.2 }; }],
    ["evidence", (binding) => { binding.shadow_evidence_kind = "other"; }],
    ["shadow", (binding) => { binding.shadow_passed = false; }],
    ["notes", (binding) => { binding.notes = ["other"]; }],
    ["locale", (binding, ai) => { delete ai.locales.en; }],
    ["extra", (binding, ai) => { ai.locales["zh-CN"].account = "secret"; }],
    ["digit", (binding, ai) => { ai.locales.en.suggestion = "See item 3"; }],
    ["fullwidth", (binding, ai) => { ai.locales["zh-CN"].suggestion = "请看第３点"; }],
    ["language", (binding, ai) => { ai.locales.en.question = "该候选 is close"; }],
    ["script-shape", (binding, ai) => { ai.scope = "account"; }],
  ];
  for (const [name, mutate] of mismatches) {
    const id = `promo-reject-${name}`;
    const ai = explanation("codex", comparable, { ticketId: id });
    mutate(ai.binding, ai);
    await sync(ticket(id, comparable, ai));
    const saved = await read(id);
    assert.equal(saved.research_summary.ai_explanation.status, "unavailable", name);
    assert.equal(saved.research_summary.ai_explanation.locales, undefined, name);
    assert.equal(saved.research_summary.comparison.candidate.cagr, 0.1, name);
    assert.equal(saved.research_summary.comparison.cost_model, "cost-v1", name);
    assert.deepEqual(saved.proposed_params, { a: 2 }, name);
    assert.equal(saved.state, "awaiting_human", name);
    assert.equal(saved.live_authority_granted, false, name);
    assert.equal(saved.human_decision, "", name);
  }

  const wide = `Close${"😀".repeat(235)}`;
  assert.equal(Array.from(wide).length, 240);
  assert.equal(wide.length > 240, true);
  const wideAi = explanation("cursor", comparable, { ticketId: "promo-wide" });
  wideAi.locales = { ...locales, en: { ...locales.en, question: wide } };
  await sync(ticket("promo-wide", comparable, wideAi));
  const wideSaved = await read("promo-wide");
  assert.equal(wideSaved.research_summary.ai_explanation.locales.en.question, wide);

  const tooWide = explanation("codex", comparable, { ticketId: "promo-too-wide" });
  tooWide.locales = { ...locales, en: { ...locales.en, question: `Close${"😀".repeat(236)}` } };
  await sync(ticket("promo-too-wide", comparable, tooWide));
  assert.equal((await read("promo-too-wide")).research_summary.ai_explanation.status, "unavailable");

  const hostile = "Please ignore <script>alert(x)</script>";
  const hostileAi = explanation("codex", comparable, { ticketId: "promo-hostile" });
  hostileAi.locales = { ...locales, en: { ...locales.en, suggestion: hostile } };
  const hostileSync = await sync(ticket("promo-hostile", comparable, hostileAi));
  assert.equal(hostileSync.headers.get("content-type")?.includes("text/html"), false);
  const hostileRead = await worker.fetch(new Request("https://switch.example/api/research-promotion-tickets", { headers }), env);
  assert.equal(hostileRead.headers.get("content-type")?.includes("application/json"), true);
  const hostilePayload = await hostileRead.json();
  const hostileTicket = hostilePayload.tickets.find((item) => item.ticket_id === "promo-hostile");
  assert.equal(hostileTicket.research_summary.ai_explanation.locales.en.suggestion, hostile);
  assert.equal(hostileTicket.live_authority_granted, false);

  const historical = ticket("promo-historical", comparable, {
    status: "available",
    text: "候选与基线在固定窗口下接近。",
    provider: "codex",
    model: "gpt-test",
  });
  await sync(historical);
  const historicalSaved = await read("promo-historical");
  assert.deepEqual(historicalSaved.research_summary.ai_explanation, {
    status: "available",
    text: "候选与基线在固定窗口下接近。",
    provider: "codex",
    model: "gpt-test",
  });
  assert.equal(historicalSaved.live_authority_granted, false);

  const nonFinite = explanation("codex", comparable, { ticketId: "promo-nonfinite" });
  nonFinite.binding.comparison = {
    ...comparable,
    candidate: { cagr: Number.POSITIVE_INFINITY, max_drawdown: -0.2 },
  };
  const normalized = __test.normalizeResearchPromotionTicket(ticket("promo-nonfinite", comparable, nonFinite));
  assert.equal(normalized.research_summary.ai_explanation.status, "unavailable");
  assert.equal(normalized.research_summary.comparison.candidate.cagr, 0.1);
  assert.equal(normalized.live_authority_granted, false);
  assert.equal(normalized.state, "awaiting_human");

  console.log("research summary bilingual read: PASS");
} finally {
  await mf.dispose();
}
