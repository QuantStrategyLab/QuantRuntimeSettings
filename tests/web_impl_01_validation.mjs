import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { catalogue, definitionSha256, recommended, requested, comparison } from "../web/strategy-switch-console/application/risk_settings/domain.js";
import { riskSettingsResponse, readRiskSettings } from "../web/strategy-switch-console/application/risk_settings/routes.js";
import { RuntimeInstances } from "../web/strategy-switch-console/worker.js";

const time = "2026-10-23T00:00:00.000Z";
const raw = (level = "balanced", overrides = {}) => ({ definition_version: catalogue.definition_version,
  request_id: "synthetic-risk-01", scope_ref: "longbridge:synthetic", mode: Object.keys(overrides).length ? "advanced" : "simple",
  level, overrides, restore_system_recommendation: false, research_only: true, execution_authorized: false });
const directory = await mkdtemp(join(tmpdir(), "web-impl-01-"));
try {
  const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
  const outfile = join(directory, "ui.cjs");
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import * as model from './src/pages/accounts/risk/model';
    import { RiskSettingsView, ParameterRow, RiskAudit } from './src/pages/accounts/risk/RiskSettings';
    import { ConfirmationDialog } from './src/components/Dialog';
    import { AccountDetail } from './src/pages/accounts/AccountDetail';
    import { zh, en } from './src/i18n/pages/risk';
    export { model, zh, en };
    const components = { view: RiskSettingsView, row: ParameterRow, audit: RiskAudit, confirm: ConfirmationDialog, account: AccountDetail };
    export const render = (lang, name, props) => renderToStaticMarkup(h(I18nProvider, { language: lang }, h(components[name], props)));
    export const renderWithReads = (lang, props) => { globalThis.__webImplReadEnables = []; const html = render(lang, "account", props); return { html, reads: globalThis.__webImplReadEnables }; };
  ` }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", outfile, loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, plugins: [{ name: "observe-read-enables", setup(builder) {
    builder.onLoad({ filter: /\/lib\/hooks\.ts$/ }, async args => ({ loader: "ts", contents: (await readFile(args.path, "utf8")).replace("  const [state, setState] = useState", "  (globalThis as any).__webImplReadEnables?.push(enabled);\n  const [state, setState] = useState") }));
  } }] });
  const ui = createRequire(import.meta.url)(outfile);
  const view = readRiskSettings({ preference: "GROWTH_COMPOUNDING", revision: 7 }, time);
  const response = async (path, { session = { allowed: true, admin: true }, method = "GET", body, origin = "https://console.example", command } = {}) => {
    const request = new Request(`https://console.example${path}`, { method, headers: { Origin: origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await riskSettingsResponse(request, {}, { now: () => Date.parse(time), readSession: async () => session,
      json: (data, status = 200) => Response.json(data, { status }), command: command ?? (async () => ({ preference: "GROWTH_COMPOUNDING", revision: 7 })) });
    return { status: result.status, data: await result.json() };
  };

  test("pinned research bytes and generated catalogue match without changing defaults", async () => {
    const file = await readFile(new URL("../web/strategy-switch-console/application/risk_settings/parameters.json", import.meta.url));
    assert.equal(createHash("sha256").update(file).digest("hex"), definitionSha256);
    assert.deepEqual(JSON.parse(file), catalogue);
    const schema = JSON.parse(await readFile(new URL("../web/strategy-switch-console/application/risk_settings/risk-settings.schema.json", import.meta.url)));
    const { settingsSchema } = await import("../web/strategy-switch-console/application/risk_settings/definitions.js");
    assert.deepEqual(schema, settingsSchema);
  });
  test("all three level requests remain research-only and have thirty comparison rows", () => {
    assert.equal(Object.keys(catalogue.parameters).length, 30);
    for (const level of catalogue.levels) {
      assert.deepEqual(requested(raw(level)), recommended(level));
      const diff = comparison(raw(level), { effective: null });
      assert.equal(Object.keys(diff.rows).length, 30);
      assert.ok(Object.values(diff.rows).every(row => row.effective_value === null));
      assert.equal(diff.direction, "UNKNOWN_OR_MIXED");
    }
    assert.notDeepEqual(recommended("conservative"), recommended("growth"));
  });
  test("every editable numeric bound rejects out-of-range; fixed parameters reject overrides", () => {
    for (const [name, p] of Object.entries(catalogue.parameters)) {
      if (!p.user_override_allowed) { assert.throws(() => requested(raw("balanced", { [name]: p.defaults_by_level.balanced })), /OVERRIDE_NOT_ALLOWED/); continue; }
      if (p.hard_limits.minimum !== undefined) for (const value of [p.hard_limits.minimum - 1, p.hard_limits.maximum + 1]) {
        assert.throws(() => requested(raw("balanced", { [name]: value })), /RISK_PARAM_OUT_OF_RANGE|ENUM_VIOLATION/);
      }
    }
    assert.throws(() => requested(raw("balanced", { kelly_fraction: .2 })), /ENUM_VIOLATION/);
    assert.throws(() => requested(raw("conservative", { breaker_drawdown: .1 })), /RISK_PARAM_OUT_OF_RANGE/);
    assert.throws(() => requested({ ...raw(), execution_authorized: true }), /ENUM_VIOLATION/);
  });
  test("display mapping covers exactly thirty keys and preserves valid non-step values", () => {
    assert.deepEqual(Object.keys(ui.model.displaySteps).sort(), Object.keys(catalogue.parameters).sort());
    const p = catalogue.parameters.target_annual_volatility;
    const value = ui.model.parseOverride("6.123", p);
    assert.equal(value, .06123);
    assert.deepEqual(ui.model.validateOverrides(catalogue, "balanced", { target_annual_volatility: value }), {});
    for (const input of ["", " ", "NaN", "1,2", "0x10", "Infinity"]) assert.throws(() => ui.model.parseOverride(input, p));
    assert.equal(ui.model.validateOverrides(catalogue, "balanced", { target_annual_volatility: .19 }).target_annual_volatility, "RISK_PARAM_OUT_OF_RANGE");
    assert.equal(ui.model.validateOverrides(catalogue, "balanced", { kelly_fraction: .2 }).kelly_fraction, "ENUM_VIOLATION");
  });
  test("48h plus 72h display is based on server time and exact deadline is expired", () => {
    const t0 = Date.parse(time), h = 3600000;
    const request = { status: "COOLDOWN", cooldown_until_utc: new Date(t0 + 48 * h).toISOString(), final_confirmation_deadline_utc: new Date(t0 + 120 * h).toISOString() };
    for (const inputStatus of ["COOLDOWN", "AWAITING_FINAL"]) {
      const active = { ...request, status: inputStatus };
      for (const [delta, expected] of [[48 * h - 1, "COOLDOWN"], [48 * h, "AWAITING_FINAL"], [120 * h - 1, "AWAITING_FINAL"], [120 * h, "REQUEST_EXPIRED"], [120 * h + 1, "REQUEST_EXPIRED"]]) {
        assert.equal(ui.model.requestPhase(active, new Date(t0 + delta).toISOString()), expected);
      }
      assert.equal(ui.model.requestPhase(active, time, 120 * h), "REQUEST_EXPIRED");
      for (const lang of ["zh", "en"]) {
        const html = ui.render(lang, "view", { catalog: catalogue, settings: { ...view, server_time: active.final_confirmation_deadline_utc, request: active }, reload() {} });
        assert.ok(html.includes((lang === "zh" ? ui.zh : ui.en)["risk.phase.REQUEST_EXPIRED"]));
        assert.ok(!html.includes((lang === "zh" ? ui.zh : ui.en)["risk.phase.AWAITING_FINAL"]));
      }
    }
    assert.equal(ui.model.requestPhase(request, "bad"), "UNKNOWN");
    assert.equal(ui.model.requestPhase({ ...request, status: "REQUEST_EXPIRED" }, time), "REQUEST_EXPIRED");
    const token = { ...request, token_expiry_utc: new Date(t0 + 49 * h).toISOString() };
    assert.equal(ui.model.confirmationTokenState(token, new Date(t0 + 49 * h - 1).toISOString()), "VALID");
    assert.equal(ui.model.confirmationTokenState(token, new Date(t0 + 49 * h).toISOString()), "CONFIRMATION_TOKEN_EXPIRED");
    assert.equal(ui.model.confirmationTokenState(token, new Date(t0 + 120 * h).toISOString()), "CONFIRMATION_WINDOW_EXPIRED");
  });
  test("catalog authentication and exact account read preserve unknown effective state", async () => {
    assert.equal((await response("/api/risk-levels/catalog", { session: null })).status, 401);
    const catalog = await response("/api/risk-levels/catalog");
    assert.equal(catalog.status, 200);
    assert.equal(catalog.data.execution_authorized, false);
    assert.equal(catalog.data.server_time, time);
    const read = await response("/api/accounts/longbridge/synthetic/risk-settings", { command: async (_env, cmd) => {
      assert.deepEqual(cmd, { action: "risk_settings_read", platform: "longbridge", key: "synthetic" }); return { preference: "GROWTH_COMPOUNDING", revision: 7 };
    } });
    assert.equal(read.data.legacy_preference.mapped_level, "growth");
    assert.equal(read.data.effective, null); assert.equal(read.data.record, null); assert.equal(read.data.readonly, true);
    assert.equal(read.data.audit.gaps_discovery, "partial"); assert.equal(read.data.audit.event_status, "UNKNOWN");
  });
  test("write requests never dispatch or issue tokens; admin and Origin remain mandatory", async () => {
    let calls = 0;
    for (const suffix of ["preview", "confirm", "synthetic/cancel"]) {
      const path = `/api/risk-settings/${suffix}`;
      const result = await response(path, { method: "POST", body: raw(), command: async () => { calls++; throw Error("unexpected"); } });
      assert.equal(result.status, 503); assert.equal(result.data.processing_status, "NOT_STARTED");
      assert.equal(result.data.confirmation_token, undefined); assert.equal(result.data.persisted, undefined);
      assert.equal((await response(path, { method: "POST", session: { allowed: true, admin: false } })).status, 403);
      assert.equal((await response(path, { method: "POST", origin: "https://other.example" })).status, 403);
    }
    assert.equal(calls, 0);
    const invalid = await response("/api/risk-settings/preview", { method: "POST", body: raw("balanced", { target_annual_volatility: .19 }) });
    assert.equal(invalid.status, 400); assert.equal(invalid.data.details.parameter, "/overrides/target_annual_volatility");
  });
  test("account audit is admin-only and dependency details are never echoed", async () => {
    assert.equal((await response("/api/accounts/longbridge/synthetic/risk-settings/audit", { session: { allowed: true, admin: false } })).status, 403);
    const result = await response("/api/accounts/longbridge/synthetic/risk-settings", { command: async () => { throw Error("synthetic-private-detail"); } });
    assert.equal(result.status, 503); assert.ok(!JSON.stringify(result.data).includes("synthetic-private-detail"));
  });
  test("actual Durable Object read branch only SELECTs, never initializes risk authority", async () => {
    let reads = 0;
    const instance = Object.create(RuntimeInstances.prototype);
    instance.existingAccountInstance = (platform, key) => {
      assert.equal(platform, "longbridge"); assert.equal(key, "synthetic");
      return { item: { platform, key }, identity: { target_name: "synthetic-target" } };
    };
    instance.sql = { exec: sql => { assert.match(sql, /^SELECT /); reads++; return { toArray: () => [] }; } };
    const result = await instance.fetch(new Request("https://runtime-instances/", { method: "POST", body: JSON.stringify({ action: "risk_settings_read", platform: "longbridge", key: "synthetic" }) }));
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { preference: null, revision: null }); assert.equal(reads, 1);
  });
  test("bilingual SSR distinguishes research levels, legacy record and unknown effective values", () => {
    assert.deepEqual(Object.keys(ui.zh).sort(), Object.keys(ui.en).sort());
    for (const lang of ["zh", "en"]) {
      const html = ui.render(lang, "view", { catalog: catalogue, settings: view, reload() {} });
      assert.equal((html.match(/class="risk-level"/g) || []).length, 3);
      assert.ok(html.includes(lang === "zh" ? "建议/未生效" : "Suggestion / not effective"));
      assert.ok(html.includes(lang === "zh" ? "占位、未定稿" : "placeholder, not final"));
      assert.ok(html.includes(lang === "zh" ? "旧偏好记录" : "Legacy preference"));
      assert.ok(html.includes(lang === "zh" ? "无法确认" : "Cannot confirm"));
      assert.ok(!html.includes('aria-pressed="true"'), "legacy mapping must not select a research level");
      assert.ok(!/>已保存<|>已生效<|>Saved<|>Applied</.test(html));
      assert.ok(!/risk\.(?:title|choose|phase\.|error\.)/.test(html));
    }
  });
  test("all advanced fields render readonly, Kelly has exactly three choices, invalid drafts show inline", () => {
    for (const lang of ["zh", "en"]) for (const level of catalogue.levels) for (const [name, parameter] of Object.entries(catalogue.parameters)) {
      const html = ui.render(lang, "row", { name, parameter, level, effective: null, readonly: true, onEdit() {}, onReset() {} });
      if (!Array.isArray(parameter.defaults_by_level[level]) && name !== "strategy_weights") assert.ok(html.includes("disabled=\"\""));
      assert.ok(html.includes(lang === "zh" ? "建议/未生效" : "Suggestion / not effective"));
      if (name === "kelly_fraction") assert.equal((html.match(/<option /g) || []).length, 3);
    }
    const html = ui.render("zh", "row", { name: "target_annual_volatility", parameter: catalogue.parameters.target_annual_volatility, level: "balanced", effective: null, draft: "19", error: "RISK_PARAM_OUT_OF_RANGE", readonly: true, onEdit() {}, onReset() {} });
    assert.ok(html.includes('aria-invalid="true"')); assert.ok(html.includes('role="alert"')); assert.ok(html.includes("自定义草稿（未保存）"));
  });
  test("confirmation disclosure is unchecked and unavailable operation remains disabled", () => {
    for (const lang of ["zh", "en"]) {
      const table = lang === "zh" ? ui.zh : ui.en;
      const html = ui.render(lang, "confirm", { request: { title: table["risk.confirm_title"], summary: table["risk.confirm_note"], ackLabel: table["risk.ack"], confirmDisabled: true }, onResolve() {} });
      assert.ok(html.includes('type="checkbox"')); assert.ok(!html.includes('checked=""')); assert.ok(html.includes('disabled=""'));
      assert.ok(html.includes(lang === "zh" ? "占位、未定稿" : "placeholder, not final"));
    }
  });
  test("COMPENSATED, pending and timeout gaps retain their blocking reasons across new renders", () => {
    for (const status of ["COMPENSATED", "PENDING_BACKFILL", "MISSING_TIMEOUT"]) for (const reason of ["PAYLOAD_FIELD_MISSING", "PAYLOAD_HASH_MISMATCH", "PAYLOAD_SOURCE_MISSING"]) {
      const audit = { event_status: "UNKNOWN", gaps_discovery: "partial", outstanding_gaps: [{ event_id: "synthetic-gap", event_status: status, backfill_blocked: reason }], events: [] };
      for (const lang of ["zh", "en"]) {
        const html = ui.render(lang, "audit", { audit: structuredClone(audit) });
        assert.ok(html.includes((lang === "zh" ? ui.zh : ui.en)[`risk.blocked.${reason}`]));
        assert.ok(html.includes((lang === "zh" ? ui.zh : ui.en)[`risk.audit.${status}`]));
        assert.ok(!html.includes(lang === "zh" ? "该事件审计已记录" : "This event audit is recorded"));
      }
    }
  });
  test("risk tab disables the parent legacy diff effect; other tabs retain it", () => {
    const props = { account: { platform: "longbridge", account_alias: "synthetic", status: "unknown" }, config: null, todayFailed: false, facts: { rows: [], phase: "ready" }, onBack() {} };
    const risk = ui.renderWithReads("zh", { ...props, tab: "risk" });
    assert.equal(risk.reads[0], false, "the legacy diff loader can initialize risk authority and must be disabled on this tab");
    assert.equal(risk.reads[1], true, "the new SELECT-only risk loader remains enabled");
    for (const tab of ["overview", "strategy", "controls", "history"]) assert.equal(ui.renderWithReads("zh", { ...props, tab }).reads[0], true);
  });
  test("account risk tab is reachable by qualified account route with bilingual SSR", () => {
    const account = { platform: "longbridge", account_alias: "synthetic", status: "unknown" };
    for (const lang of ["zh", "en"]) {
      const html = ui.render(lang, "account", { account, tab: "risk", config: null, todayFailed: false, facts: { rows: [], phase: "ready" }, onBack() {} });
      assert.ok(html.includes('id="account-detail-tab-risk"')); assert.ok(html.includes('aria-labelledby="account-detail-tab-risk"'));
      assert.ok(html.includes(lang === "zh" ? "风险偏好" : "Risk preference"));
    }
  });
} finally { await rm(directory, { recursive: true, force: true }); }
