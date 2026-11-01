// Frontend text-leak regression: M01/M02/M05/M06 translate fallbacks and P01/P02/P04 rendering.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

const root = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "frontend-i18n-"));
const visible = (html) => html.replace(/ data-[a-z-]+="[^"]*"/g, "");
try {
  const outfile = join(directory, "i18n.cjs");
  await build({
    stdin: {
      resolveDir: root,
      contents: `
        import { createElement as h } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { I18nProvider, translate, useT } from './src/i18n';
        import { AuditTimeline, regimeLabel } from './src/components/cockpit';
        import { loadAuditEvents } from './src/api/cockpit';
        export { translate, loadAuditEvents };
        export const tr = (language, key, fallback) => translate(language, key, {}, fallback);
        export const trp = (language, key, count) => translate(language, key, { count });
        const RegimeText = ({ value }) => { const t = useT(); return h('p', { className: 'regime-text' }, regimeLabel(value, t)); };
        export const regime = (language, value) => renderToStaticMarkup(h(I18nProvider, { language }, h(RegimeText, { value })));
        const events = [
          { event_id: 'e1', occurred_at: '2026-11-01T10:00:00Z', actor: 'owner', action: 'record_owner_decision',
            subject: { kind: 'owner_decision', id: 'demo' }, revision: 7, decision_id: 'd-1', operation_id: null, outcome: 'decided' },
          { event_id: 'e2', occurred_at: '2026-11-01T10:00:01Z', actor: null, action: 'some_new_action',
            subject: { kind: 'mystery_kind', id: 'x-1' }, revision: null, decision_id: null, operation_id: null, outcome: 'weird_outcome' },
        ];
        export const audit = (language) => renderToStaticMarkup(h(I18nProvider, { language },
          h(AuditTimeline, { events, status: 'ready' })));
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
  const ui = createRequire(import.meta.url)(outfile);

  // M05/M01/M02/M04/M06/M07: dynamic keys fall back to localized copy, never the raw key.
  assert.equal(ui.tr("zh", "decisions.action.some_action"), "未知操作");
  assert.equal(ui.tr("en", "decisions.action.some_action"), "Unknown action");
  assert.equal(ui.tr("zh", "some.label.key"), "未知");
  assert.equal(ui.tr("en", "some.label.key"), "Unknown");
  assert.equal(ui.tr("zh", "constructor"), "未知", "prototype keys never resolve as functions");
  assert.equal(ui.tr("zh", "reason.mystery_code"), "原因未知");
  assert.equal(ui.tr("en", "reason.mystery_code"), "Unknown reason");
  assert.equal(ui.tr("zh", "state.mystery_status"), "未知状态");
  assert.equal(ui.tr("zh", "research.state.mystery"), "未知状态");
  assert.equal(ui.tr("zh", "research.source.synthetic-source"), "其他研究来源");
  assert.equal(ui.tr("en", "research.source.synthetic-source"), "Other research source");
  assert.equal(ui.tr("en", "research.source.research-mirror"), "Research mirror");
  assert.equal(ui.tr("zh", "research.source.quant-advisor-research"), "量化研究信号");
  // M02/M06: known machine values keep their vetted copy; unknown modes never render the raw enum.
  assert.equal(ui.tr("zh", "strategies.execution.paper"), "模拟");
  assert.equal(ui.tr("zh", "strategies.execution.live"), "实盘");
  assert.equal(ui.tr("zh", "strategies.execution.legacy_live"), "实盘");
  assert.equal(ui.tr("en", "strategies.execution.dry_run"), "Dry run");
  assert.equal(ui.tr("zh", "strategies.execution.mystery_mode"), "执行模式未知");
  assert.equal(ui.tr("en", "strategies.execution.mystery_mode"), "Execution mode unknown");
  assert.equal(ui.tr("en", "reason.runtime_control_pending"), "The previous action is awaiting confirmation");
  assert.equal(ui.tr("zh", "accounts.field.mystery_field"), "其他参数");
  assert.equal(ui.tr("en", "accounts.field.mystery_field"), "Other parameter");
  assert.equal(ui.tr("zh", "initial_enrollment.fact.some_field"), "其他字段");
  assert.equal(ui.tr("zh", "initial_enrollment.scope_kind.mystery"), "未知");

  // IBKR Flex reminder: the exact requested titles and severity labels resolve through
  // copy; a phase/severity enum is never surfaced as a raw i18n key.
  assert.equal(ui.tr("zh", "decisions.credential_expiry.title"), "IBKR Flex token 到期续期");
  assert.equal(ui.tr("en", "decisions.credential_expiry.title"), "Renew IBKR Flex token");
  for (const [key, zh, en] of [
    ["none", "未到期", "Not due yet"],
    ["unknown", "到期时间未知", "Expiry unknown"],
    ["notice", "提前提醒", "Early reminder"],
    ["warning", "尽快续期", "Renew soon"],
    ["urgent", "立即续期", "Renew now"],
    ["expired", "已过期", "Expired"],
  ]) {
    assert.equal(ui.tr("zh", `decisions.credential_expiry.severity.${key}`), zh);
    assert.equal(ui.tr("en", `decisions.credential_expiry.severity.${key}`), en);
  }
  assert.equal(ui.tr("en", "decisions.credential_expiry.manual_notice"),
    "IBKR Flex tokens cannot auto-renew. Sign in to IBKR to regenerate the token, then register the new expiry through the existing maintenance flow.");
  assert.match(ui.tr("zh", "decisions.credential_expiry.manual_notice"), /无法自动续期/);
  // An unenumerated severity key falls back to localized copy, never the dotted key.
  assert.equal(ui.tr("en", "decisions.credential_expiry.severity.not_due"), "Unknown");
  assert.equal(ui.tr("zh", "decisions.credential_expiry.severity.not_due"), "未知");
  // Count plurals resolve through `.one`/`.other` siblings before the base key.
  assert.equal(ui.trp("en", "decisions.credential_expiry.days", 1), "Expires in 1 day");
  assert.equal(ui.trp("en", "decisions.credential_expiry.days", 14), "Expires in 14 days");
  assert.equal(ui.trp("zh", "decisions.credential_expiry.days", 1), "1 天后到期");
  assert.equal(ui.trp("zh", "decisions.credential_expiry.days", 14), "14 天后到期");

  // P04: regime effects render through copy only.
  const regimeZhKnown = visible(ui.regime("zh", "risk_reduction_only"));
  assert.match(regimeZhKnown, /仅允许降低风险/);
  assert.match(visible(ui.regime("en", "risk_reduction_only")), /Risk reduction only/);
  const regimeUnknown = visible(ui.regime("zh", "mystery_effect"));
  assert.match(regimeUnknown, /市场状态影响未知/);
  assert.match(visible(ui.regime("en", "mystery_effect")), /Regime effect unknown/);
  assert.doesNotMatch(regimeUnknown, /mystery effect|mystery_effect/, "unknown regimes are never humanized or raw");

  // P01/P02: audit actions, outcomes and structured subjects are labeled, not machine text.
  const auditZh = visible(ui.audit("zh"));
  assert.match(auditZh, /记录负责人决定/);
  assert.match(auditZh, /对象：负责人决定 · demo/);
  assert.match(auditZh, /结果 已决定/);
  assert.match(auditZh, /记录修订 7/);
  assert.match(auditZh, /其他操作/);
  assert.match(auditZh, /其他对象/);
  assert.match(auditZh, /结果 未知/, "unknown outcomes render the exact localized value");
  assert.doesNotMatch(auditZh, /结果未知|weird_outcome/);
  const auditEn = visible(ui.audit("en"));
  assert.match(auditEn, /Owner decision recorded/);
  assert.match(auditEn, /Subject: Owner decision · demo/);
  assert.match(auditEn, /Outcome Decided/);
  assert.match(auditEn, /Record revision 7/);
  assert.match(auditEn, /Other action/);
  assert.match(auditEn, /Other subject/);
  assert.match(auditEn, /Outcome Unknown/, "unknown outcomes render the exact localized value");
  assert.doesNotMatch(auditEn, /Outcome unknown/);
  assert.doesNotMatch(auditEn, /record owner decision|owner_decision:|some new action|mystery kind|weird outcome/,
    "raw action, kind and outcome codes never reach visible text");

  // P02 adapter: subjects stay structured; a legacy "kind: id" string splits instead of concatenating.
  const realFetch = globalThis.fetch;
  try {
    const jsonResponse = (payload) => ({ status: 200, ok: true, json: async () => payload });
    globalThis.fetch = async () => jsonResponse({ events: [
      { event_id: "e1", occurred_at: "2026-11-01T10:00:00Z", action: "approval_recorded", subject: { kind: "strategy_promotion", id: "p-1" }, outcome: "applied", revision: 2 },
      { event_id: "e2", occurred_at: "2026-11-01T10:00:01Z", action: "approval_recorded", subject: "owner_decision: d-9", outcome: null, revision: null },
      { event_id: "e3", occurred_at: "2026-11-01T10:00:02Z", action: "approval_recorded", subject: "plain-id", outcome: null, revision: null },
    ] });
    const read = await ui.loadAuditEvents();
    assert.equal(read.status, "ready");
    assert.deepEqual(read.data[0].subject, { kind: "strategy_promotion", id: "p-1" });
    assert.deepEqual(read.data[1].subject, { kind: "owner_decision", id: "d-9" });
    assert.deepEqual(read.data[2].subject, { kind: "unknown", id: "plain-id" });
    assert.equal(read.data[0].action, "approval_recorded");
  } finally {
    globalThis.fetch = realFetch;
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log("console_frontend_i18n_validation: ok");
