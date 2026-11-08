// M09 decision-inbox gaps: server blocker codes, approved/rejected outcome and
// the ?page=decisions&decision=<id> deep link. Synthetic fixtures only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const pagePath = new URL("../web/strategy-switch-console/frontend/src/pages/decisions/DecisionsPage.tsx", import.meta.url);
const dir = await mkdtemp(join(tmpdir(), "decision-gaps-"));
let ui;
try {
  const outfile = join(dir, "render.cjs");
  await build({
    stdin: {
      resolveDir: root,
      contents: `import {createElement as h} from 'react';
        import {renderToStaticMarkup} from 'react-dom/server'; import {I18nProvider} from './src/i18n';
        import DecisionsPage from './src/pages/decisions/DecisionsPage';
        export * as helpers from './src/pages/decisions/helpers';
        export {parseRoute, routeToSearch} from './src/app/router';
        export function render(item, language) {
          globalThis.__gapItem = item; globalThis.__gapUseApi = 0;
          return renderToStaticMarkup(h(I18nProvider, {language}, h(DecisionsPage, {decision: null})));
        }`,
    },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic",
    loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, logLevel: "silent",
    plugins: [{ name: "mock", setup(b) {
      b.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ loader: "js", contents: `export function useApi() {
        const n = globalThis.__gapUseApi++;
        return { phase: 'ready', data: n === 0 ? { status: 'ok', items: [globalThis.__gapItem], sources: [] } : n === 1 ? { admin: true } : {}, reload() {} };
      } export const createRequestGate = () => ({ begin: () => 1, isCurrent: () => true });` }));
      b.onLoad({ filter: /\/pages\/decisions\/DecisionsPage\.tsx$/ }, async ({ path }) => ({ loader: "tsx",
        contents: (await readFile(path, "utf8")).replace("useState<string | null>(null);\n  const [busy", "useState<string | null>(globalThis.__gapItem.id);\n  const [busy") }));
    } }],
  });
  ui = createRequire(import.meta.url)(outfile);
} finally {
  await rm(dir, { recursive: true, force: true });
}

const base = {
  id: "owner_decision:synthetic-ticket", short_id: "IN-GAP", category: "owner_decision", priority: "normal",
  created_at: null, expires_at: null, evidence_freshness: { status: "ready", as_of: null }, status: "pending",
  affects_live: false, diff: [], title_key: "decisions.owner_decision", account_alias: "synthetic", platform: "ibkr",
  decision_binding: { kind: "owner", subject_id: "synthetic-ticket", material_sha256: "a".repeat(64) },
  allowed_actions: ["approve_limited_live_canary", "keep_parked"],
};
const COPY = {
  zh: { stale: "支持资料已过时，当前无法批准。", notAllowed: "服务端当前不允许审批。", other: "当前不可审批。",
    otherCode: "当前不可审批，原因代码：", blocked: "暂不可审批", approved: "已批准", rejected: "已拒绝", decided: "已处理", pending: "待处理" },
  en: { stale: "Supporting data is stale; approval is unavailable.", notAllowed: "The server does not allow approval right now.",
    other: "Approval is unavailable.", otherCode: "Approval is unavailable. Reason code: ", blocked: "Approval unavailable",
    approved: "Approved", rejected: "Rejected", decided: "Decided", pending: "Pending" },
};
const blockerList = html => {
  const at = html.indexOf('class="cockpit-blockers"');
  return at < 0 ? null : html.slice(at, html.indexOf("</ul>", at));
};
const approveDisabled = html => /<button type="button" class="button button-primary" disabled="">/.test(html);
const approveEnabled = html => /<button type="button" class="button button-primary">/.test(html);
const rowBadge = html => {
  const start = html.indexOf('class="inbox-item');
  const row = html.slice(start, html.indexOf("</button>", start));
  return row.slice(row.lastIndexOf('<span class="badge'));
};
const detailHead = html => {
  const at = html.indexOf('class="decision-badges"');
  return html.slice(at, html.indexOf("</div>", at));
};

test("gap 1: inbox blocking_reason_codes render as bilingual blocker copy", () => {
  for (const language of ["zh", "en"]) {
    const c = COPY[language];
    const html = ui.render({ ...base, actionable: false,
      blocking_reason_codes: ["decision_evidence_stale", "decision_future_code", 42, "<script>x</script>", "decision_evidence_stale"] }, language);
    const list = blockerList(html);
    assert.ok(list, `${language}: blocker list renders`);
    assert.ok(list.includes(`aria-label="${c.blocked}"`), `${language}: list is labelled`);
    assert.equal((list.match(/<li>/g) || []).length, 3, `${language}: duplicates collapse; malformed entries become one generic line`);
    assert.ok(list.includes(c.stale), `${language}: known code maps to cockpit.blocker copy`);
    assert.ok(list.includes(`${c.otherCode}<code>decision_future_code</code>`), `${language}: unknown well-formed code shows raw code in <code>`);
    assert.ok(list.includes(`<li>${c.other}</li>`), `${language}: malformed codes fall back to generic copy`);
    assert.ok(!html.includes("script"), `${language}: malformed code text never reaches markup`);
    assert.ok(!html.includes(c.notAllowed), `${language}: specific codes replace the generic server note`);
    assert.ok(approveDisabled(html), `${language}: server-blocked item keeps approve disabled even if allowed_actions lists it`);
  }
});

test("gap 1: fail-closed actionable handling", () => {
  for (const language of ["zh", "en"]) {
    const c = COPY[language];
    const falseNoCodes = ui.render({ ...base, actionable: false, blocking_reason_codes: [] }, language);
    assert.ok(blockerList(falseNoCodes)?.includes(c.notAllowed), `${language}: actionable=false without codes says not allowed`);
    assert.ok(approveDisabled(falseNoCodes));
    const trueWithCodes = ui.render({ ...base, actionable: true, blocking_reason_codes: ["decision_expired"] }, language);
    assert.ok(blockerList(trueWithCodes), `${language}: codes win over actionable=true`);
    assert.ok(approveDisabled(trueWithCodes));
    const malformedList = ui.render({ ...base, actionable: true, blocking_reason_codes: "decision_expired" }, language);
    assert.ok(blockerList(malformedList)?.includes(`<li>${c.other}</li>`), `${language}: non-array codes are blocked`);
    assert.ok(approveDisabled(malformedList));
    const malformedFlag = ui.render({ ...base, actionable: "yes", blocking_reason_codes: [] }, language);
    assert.ok(blockerList(malformedFlag), `${language}: a non-boolean actionable never implies actionable`);
    assert.ok(approveDisabled(malformedFlag));
    const clean = ui.render({ ...base, actionable: true, blocking_reason_codes: [] }, language);
    assert.equal(blockerList(clean), null, `${language}: actionable item shows no blocker list`);
    assert.ok(approveEnabled(clean), `${language}: actionable item keeps approve enabled`);
  }
});

test("gap 1: legacy items without the fields keep current behaviour", () => {
  for (const language of ["zh", "en"]) {
    const c = COPY[language];
    const open = ui.render(base, language);
    assert.equal(blockerList(open), null);
    assert.ok(approveEnabled(open), `${language}: legacy allowed item stays enabled`);
    const closed = ui.render({ ...base, allowed_actions: [] }, language);
    assert.equal(blockerList(closed), null);
    assert.ok(closed.includes(`<p class="decision-note">${c.notAllowed}</p>`), `${language}: generic note stays for legacy items`);
  }
  const { inboxBlockers } = ui.helpers;
  assert.equal(inboxBlockers({}), null);
  assert.equal(inboxBlockers(null), null);
  assert.deepEqual(inboxBlockers({ actionable: true, blocking_reason_codes: [] }), { blocked: false, blockers: [] });
});

test("gap 2: decided items show approved or rejected from decision_state.action", () => {
  const cases = [
    [{ status: "decided", action: "approve_limited_live_canary" }, "approved"],
    [{ status: "decided", action: "approve" }, "approved"],
    [{ status: "decided", action: "accept" }, "approved"],
    [{ status: "decided", action: "keep_parked" }, "rejected"],
    [{ status: "decided", action: "reject" }, "rejected"],
    [{ status: "decided", action: null }, "decided"],
    [{ status: "decided", action: "something_new" }, "decided"],
  ];
  for (const language of ["zh", "en"]) {
    const c = COPY[language];
    for (const [state, key] of cases) {
      const html = ui.render({ ...base, actionable: false, blocking_reason_codes: ["decision_already_decided"], decision_state: state }, language);
      assert.ok(rowBadge(html).includes(`>${c[key]}</span>`), `${language}: list badge for ${JSON.stringify(state)} is ${key}`);
      assert.ok(detailHead(html).includes(`>${c[key]}</span>`), `${language}: detail badge for ${JSON.stringify(state)} is ${key}`);
      assert.ok(!html.includes('class="inbox-actions"'), `${language}: a decided item offers no actions`);
    }
    const pending = ui.render({ ...base, decision_state: { status: "pending", action: null, decided_at: null } }, language);
    assert.ok(rowBadge(pending).includes(`>${c.pending}</span>`), `${language}: pending stays pending`);
    const absent = ui.render(base, language);
    assert.ok(rowBadge(absent).includes(`>${c.pending}</span>`), `${language}: absent decision_state keeps item.status`);
  }
  const { decisionStatusKey } = ui.helpers;
  assert.equal(decisionStatusKey({ status: "decided" }, false), "decided");
  assert.equal(decisionStatusKey({ status: "decided", decision_state: { status: "decided", action: "reject" } }, false), "rejected");
  assert.equal(decisionStatusKey({ status: "pending", decision_state: "garbage" }, false), "pending");
  assert.equal(decisionStatusKey({ status: "pending" }, true), "expired");
  assert.equal(decisionStatusKey({ status: "expired", decision_state: { status: "decided", action: "accept" } }, true), "approved");
});

test("deep link: ?page=decisions&decision=<id> is parsed, consumed once and restores the queue", async () => {
  const route = ui.parseRoute("?page=decisions&decision=owner_decision%3Asynthetic");
  assert.equal(route.page, "decisions");
  assert.equal(route.decision, "owner_decision:synthetic");
  assert.equal(ui.routeToSearch(route), "?page=decisions&decision=owner_decision%3Asynthetic");
  assert.equal(ui.routeToSearch({ ...route, page: "overview" }), "", "the decision param only belongs to the decisions page");

  const { deepLinkTarget } = ui.helpers;
  const items = [{ id: "a:1" }, { id: "b:2" }];
  assert.equal(deepLinkTarget(null, null, true, items), null, "no deep link, nothing to restore");
  assert.equal(deepLinkTarget("b:2", null, false, items), null, "waits until the inbox is ready");
  assert.equal(deepLinkTarget("c:3", null, true, items), null, "an unknown id is not consumed or selected");
  assert.equal(deepLinkTarget("b:2", null, true, items), "b:2", "a known id is restored once the inbox arrives");
  assert.equal(deepLinkTarget("b:2", "b:2", true, items), null, "an applied link is not re-applied");
  assert.equal(deepLinkTarget("a:1", "b:2", true, items), "a:1", "a new link is applied");

  // The page effect uses the helper and restores the tab and filter that could hide the target.
  const source = await readFile(pagePath, "utf8");
  const effect = source.slice(source.indexOf("const target = deepLinkTarget("), source.indexOf("}, [decision, inbox.phase, items]);"));
  assert.match(effect, /deepLinkTarget\(decision, consumedDeepLink\.current, inbox\.phase === "ready", items\)/);
  for (const step of ["consumedDeepLink.current = target;", 'setView("pending");', 'setCategory("all");', "setSelectedId(target);"])
    assert.ok(effect.includes(step), `deep-link effect performs ${step}`);
});
