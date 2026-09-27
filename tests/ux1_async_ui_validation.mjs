import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const page = await readFile(new URL("../web/strategy-switch-console/index.html", import.meta.url), "utf8");
assert.match(page, /id="ux1-job-status"/);
assert.match(page, /id="ux1-preview-button"/);
assert.equal(page.includes('id="ux1-preview-button" disabled'), false);
assert.match(page, /no_order/);
assert.equal(page.includes("fonts.googleapis.com"), false);
assert.ok(page.indexOf('aria-label="全局显示模式"') < page.indexOf('id="overview-view"'));
assert.ok(page.indexOf('<section id="research-view"') < page.indexOf('id="ux1-research"'));
assert.ok(page.indexOf('id="ux1-research"') < page.indexOf('class="research-candidate-content"'));
assert.ok(page.indexOf('id="ux1-selection"') < page.indexOf('id="ux1-guided"'));
assert.ok(page.indexOf('id="ux1-selection"') < page.indexOf('id="ux1-advanced"'));
assert.match(page, /id="ux1-metric-annualized">—<\/strong>/);
assert.match(page, /id="ux1-metric-drawdown">—<\/strong>/);
assert.match(page, /id="ux1-metric-risk">待评估<\/strong>/);
assert.match(page, /id="ux1-automation"/);
const stylePreview = page.match(/<div class="ux1-style-preview"[\s\S]*?<\/div>/)?.[0] || "";
assert.ok(stylePreview.includes("保守") && stylePreview.includes("均衡") && stylePreview.includes("增长") && stylePreview.includes("投机"));
assert.match(page, /id="ux1-guided-heading">了解研究风格<\/h3>/);
assert.doesNotMatch(stylePreview, /<(?:button|select|input)\b|aria-pressed|selected/);

const source = await readFile(new URL("../web/strategy-switch-console/app.js", import.meta.url), "utf8");
const temptingPreview = {
  status: "computed",
  stale: false,
  no_order: true,
  decision_preview: {
    decision_date: "2023-03-29",
    scenario_count: 60,
    selected_action: "B1",
    no_advantage: false,
  },
  historical_execution_check: { trade_date: "2023-03-30", total_fees_usd: 1.5 },
};

function bootUi(initialJob, initialMode = null) {
  const nodes = new Map();
  const lists = new Map();
  const intervals = [];
  const fetches = [];
  let draft = {
    ok: true,
    revision: 4,
    fingerprint: "fixture-fingerprint",
    draft: {
      objective: "one_step_net_log_score",
      research_case_id: "r8_first_dynamic_2023_03_29",
      advanced_settings: {
        plugin_mode: null,
        income_layer_mode: null,
        income_layer_start_usd: null,
        income_layer_max_ratio: null,
        option_overlay_mode: null,
        reserve_policy_mode: null,
        min_reserved_cash_usd: null,
        reserved_cash_ratio: null,
        cash_only_execution_mode: null,
        dca_mode: null,
        dca_base_investment_usd: null,
      },
    },
    preview: temptingPreview,
    intent: null,
    job: initialJob,
    workflow_dispatched: false,
    no_order: true,
    execution_authority_granted: false,
  };
  function makeNode(id = "") {
    const classes = new Set();
    const classList = {
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      },
      add(name) { this.toggle(name, true); },
      remove(name) { this.toggle(name, false); },
      contains(name) { return classes.has(name); },
    };
    const store = {
      id,
      hidden: false,
      textContent: "",
      innerHTML: "",
      value: "",
      disabled: false,
      className: "",
      open: false,
      checked: false,
      dataset: {},
      style: { setProperty() {}, getPropertyValue() { return ""; }, removeProperty() {} },
      options: [],
      children: [],
      childNodes: [],
      selectedIndex: 0,
      listeners: {},
      classList,
    };
    const node = new Proxy(store, {
      get(target, prop) {
        if (prop === "dispatch") return (type) => { for (const fn of target.listeners[type] || []) fn({ target: node, preventDefault() {} }); };
        if (prop === "click") return () => node.dispatch("click");
        if (prop === "addEventListener") return (type, fn) => { (target.listeners[type] ||= []).push(fn); };
        if (prop === "after") return (child) => { if (child?.id) nodes.set(child.id, child); };
        if (prop === "querySelector" || prop === "closest") return () => makeNode();
        if (prop === "querySelectorAll") return () => [];
        if (prop in target) return target[prop];
        if (prop === "nextElementSibling" || prop === "previousElementSibling" || prop === "parentElement" || prop === "firstElementChild" || prop === "lastElementChild") {
          target[prop] = makeNode(`${id}:${String(prop)}`);
          return target[prop];
        }
        if (typeof prop === "symbol" || prop === "then") return undefined;
        return () => undefined;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    });
    if (id) nodes.set(id, node);
    return node;
  }
  function node(id) {
    return nodes.get(id) || makeNode(id);
  }
  function buttons(selector, names, field) {
    if (!lists.has(selector)) {
      lists.set(selector, names.map((name) => {
        const button = makeNode(`${selector}-${name}`);
        button.dataset[field] = name;
        return button;
      }));
    }
    return lists.get(selector);
  }
  const document = {
    documentElement: makeNode("document-element"),
    body: makeNode("body"),
    head: makeNode("head"),
    activeElement: null,
    title: "",
    getElementById: (id) => node(id),
    createElement: () => makeNode(),
    querySelector(selector) {
      if (selector === ".workspace-nav") return node("workspace-nav");
      return node(`query:${selector}`);
    },
    querySelectorAll(selector) {
      if (selector === "[data-workspace]" || selector === ".workspace-nav [data-workspace]") {
        return buttons(selector, ["overview", "accounts", "research"], "workspace");
      }
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const storage = new Map();
  if (initialMode) storage.set("qsl-ux1-view-mode", initialMode);
  const localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  async function fetch(url) {
    const path = String(url);
    fetches.push(path);
    const payload = path.includes("/api/session")
      ? { allowed: true, admin: false, login: "fixture-reader" }
      : path.includes("/api/ux1/draft")
        ? draft
        : {};
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  }
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval(fn, ms) {
      const id = intervals.length + 1;
      intervals.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearInterval(id) {
      const item = intervals.find((entry) => entry.id === id);
      if (item) item.cleared = true;
    },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    JSON,
    Object,
    Array,
    Promise,
    Error,
    Date,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    Map,
    Set,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    structuredClone,
    document,
    localStorage,
    navigator: { language: "zh-CN", clipboard: { writeText: async () => {} } },
    fetch,
    location: { href: "https://console.example/", reload() {} },
  };
  class Option {
    constructor(text, value, defaultSelected, selected) {
      this.textContent = text;
      this.value = value ?? "";
      this.defaultSelected = Boolean(defaultSelected);
      this.selected = Boolean(selected);
    }
  }
  sandbox.Option = Option;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const fixtureAccount = { key: "fixture", label: "Fixture", target_name: "fixture", account_selector: "U1", deployment_selector: "dep", service_name: "svc", supported_domains: ["us_equity"] };
  sandbox.__PLATFORM_META__ = { ibkr: { label: "IBKR" } };
  sandbox.__DEFAULT_ACCOUNT_OPTIONS__ = { ibkr: [fixtureAccount] };
  sandbox.__PLATFORM_CONFIG__ = { ibkr: {} };
  sandbox.__DCA_PROFILE_DEFAULTS__ = {};
  sandbox.__PLATFORM_MIN_RESERVED_CASH_VARIABLES__ = {};
  sandbox.__PLATFORM_RESERVED_CASH_RATIO_VARIABLES__ = {};
  sandbox.__DEFAULT_STRATEGY_PROFILES__ = [];
  sandbox.__INCOME_LAYER_DEFAULTS__ = {};
  sandbox.__OPTION_OVERLAY_DEFAULTS__ = {};
  sandbox.window.scrollTo = () => {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "app.js" });
  return { node, intervals, fetches, document, setDraft(next) { draft = { ...draft, ...next }; } };
}

async function settle(ui) {
  const started = Date.now();
  while (!ui.fetches.some((path) => path.includes("/api/ux1/draft")) && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const professionalStartup = bootUi(null, "advanced");
await settle(professionalStartup);
assert.equal(professionalStartup.node("decision-background").open, true);
assert.equal(professionalStartup.node("account-runtime-details").open, true);
assert.equal(professionalStartup.node("strategy-settings").open, true);
assert.equal(professionalStartup.document.querySelector(".plan-advanced").open, true);
assert.equal(professionalStartup.document.body.classList.contains("display-professional"), true);

const queued = bootUi({
  request_id: "11111111-1111-4111-8111-111111111111",
  status: "queued",
  dispatch_state: "dispatched",
  created_at: "2026-09-27T00:00:00.000Z",
  updated_at: "2026-09-27T00:00:00.000Z",
  reason: null,
});
await settle(queued);
assert.equal(queued.fetches.some((path) => path.includes("/api/switch")), false);
assert.equal(queued.node("ux1-preview-button").disabled, true);
assert.equal(queued.node("ux1-intent-button").disabled, true);
assert.match(queued.node("ux1-job-status").textContent, /排队/);
assert.equal(queued.node("ux1-guided-result").textContent, "");
assert.equal(queued.intervals.filter((item) => item.ms === 5000 && !item.cleared).length, 0);
assert.equal(queued.node("decision-background").open, false);
assert.equal(queued.node("strategy-settings").open, false);
assert.equal(queued.document.querySelector(".plan-advanced").open, false);
queued.document.querySelectorAll("[data-workspace]")[2].dispatch("click");
assert.equal(queued.intervals.filter((item) => item.ms === 5000 && !item.cleared).length, 1);
queued.document.querySelectorAll("[data-workspace]")[0].dispatch("click");
assert.equal(queued.intervals.filter((item) => item.ms === 5000 && !item.cleared).length, 0);
queued.document.querySelectorAll("[data-workspace]")[2].dispatch("click");
assert.equal(queued.intervals.filter((item) => item.ms === 5000 && !item.cleared).length, 1);
queued.setDraft({
  job: {
    request_id: "11111111-1111-4111-8111-111111111111",
    status: "succeeded",
    dispatch_state: "dispatched",
    created_at: "2026-09-27T00:00:00.000Z",
    updated_at: "2026-09-27T00:01:00.000Z",
    reason: null,
  },
  preview: temptingPreview,
});
queued.intervals.find((item) => item.ms === 5000 && !item.cleared).fn();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.match(queued.node("ux1-guided-result").textContent, /2023-03-29/);
assert.equal(queued.node("ux1-preview-button").disabled, false);
assert.equal(queued.intervals.filter((item) => item.ms === 5000 && !item.cleared).length, 0);

const editing = bootUi({
  request_id: "22222222-2222-4222-8222-222222222222",
  status: "unknown",
  dispatch_state: "unknown",
  created_at: "2026-09-27T00:00:00.000Z",
  updated_at: "2026-09-27T00:00:00.000Z",
  reason: "check_required",
});
await settle(editing);
assert.match(editing.node("ux1-job-status").textContent, /尚未确认/);
assert.equal(editing.node("ux1-guided-result").textContent, "");
assert.equal(editing.node("ux1-preview-button").disabled, true);
assert.equal(editing.node("ux1-intent-button").disabled, true);
editing.document.querySelectorAll("[data-workspace]")[2].dispatch("click");
assert.equal(editing.intervals.filter((item) => item.ms === 5000 && !item.cleared).length, 1);
editing.node("ux1-result-evidence").open = true;
editing.node("ux1-income-layer-mode").value = "enabled";
editing.node("ux1-income-layer-mode").dispatch("input");
editing.node("income-layer-start-usd-input").value = "12500";
const fetchCountBeforeModeChanges = editing.fetches.length;
assert.equal(editing.node("ux1-result-evidence").open, true);
editing.node("ux1-mode-advanced").click();
assert.equal(editing.node("ux1-result-evidence").open, true);
assert.equal(editing.node("account-runtime-details").open, true);
assert.equal(editing.node("decision-background").open, true);
assert.equal(editing.node("strategy-settings").open, true);
assert.equal(editing.document.querySelector(".plan-advanced").open, true);
assert.equal(editing.document.body.classList.contains("display-professional"), true);
assert.equal(editing.node("ux1-income-layer-mode").value, "enabled");
assert.equal(editing.node("income-layer-start-usd-input").value, "12500");
assert.equal(editing.fetches.length, fetchCountBeforeModeChanges);
editing.node("decision-background").open = false;
editing.node("strategy-settings").open = false;
editing.document.querySelector(".plan-advanced").open = false;
editing.document.querySelectorAll("[data-workspace]")[1].dispatch("click");
assert.equal(editing.node("decision-background").open, false);
assert.equal(editing.node("strategy-settings").open, false);
assert.equal(editing.document.querySelector(".plan-advanced").open, false);
editing.document.querySelectorAll("[data-workspace]")[2].dispatch("click");
assert.equal(editing.intervals.filter((item) => item.ms === 5000 && !item.cleared).length, 1);
const fetchCountBeforeGuided = editing.fetches.length;
editing.node("ux1-mode-guided").click();
assert.equal(editing.node("ux1-result-evidence").open, false);
assert.equal(editing.node("account-runtime-details").open, false);
assert.equal(editing.document.body.classList.contains("display-guided"), true);
assert.equal(editing.node("ux1-income-layer-mode").value, "enabled");
assert.equal(editing.fetches.length, fetchCountBeforeGuided);
editing.node("decision-background").open = true;
editing.node("strategy-settings").open = true;
editing.document.querySelector(".plan-advanced").open = true;
editing.document.querySelectorAll("[data-workspace]")[1].dispatch("click");
editing.document.querySelectorAll("[data-workspace]")[2].dispatch("click");
assert.equal(editing.node("decision-background").open, true);
assert.equal(editing.node("strategy-settings").open, true);
assert.equal(editing.document.querySelector(".plan-advanced").open, true);
editing.node("ux1-evidence-button").click();
assert.equal(editing.node("ux1-result-evidence").open, true);
assert.equal(editing.node("ux1-evidence").open, true);
assert.equal(editing.fetches.some((path) => path.includes("/api/ux1/preview")), false);
editing.node("ux1-objective").value = "global_optimum";
editing.node("ux1-objective").dispatch("input");
assert.equal(editing.node("ux1-objective").value, "global_optimum");
editing.setDraft({
  draft: {
    objective: "one_step_net_log_score",
    research_case_id: "r8_first_dynamic_2023_03_29",
    advanced_settings: {},
  },
});
editing.intervals.find((item) => item.ms === 5000 && !item.cleared).fn();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(editing.node("ux1-objective").value, "global_optimum");
assert.equal(editing.node("ux1-guided-result").textContent, "");
const fetchesBeforeLogout = editing.fetches.length;
editing.node("logout-button").dispatch("click");
assert.equal(editing.node("ux1-job-status").textContent, "");
assert.equal(editing.intervals.filter((item) => item.ms === 5000 && !item.cleared).length, 0);
assert.equal(editing.fetches.slice(fetchesBeforeLogout).some((path) => path.includes("/api/switch")), false);
assert.equal(queued.fetches.concat(editing.fetches).some((path) => path.includes("/api/switch")), false);
console.log("ux1 async ui validation: PASS");
