// Desk (Meridian) P1 acceptance: the F1–F4 findings, checked against rendered markup and the pure
// models behind it — urgency ordering, summary chips, legend and disabled explanations (F1); the
// switch-not-wired banner, its entries and the inert read-back actions (F2); the locked 401/403
// shell (F3); one Flex status feeding both the card and the embedded panel (F4).
// Synthetic fixtures only: every identifier below is invented (fake-broker, cred_fake_*).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  credentialAction, credentialSummary, flexCredential, sortCredentials, urgencyKey,
} from "../web/strategy-switch-console/frontend/src/desk/credentials/table.ts";
import { flexPanelRead, maintenancePhase } from "../web/strategy-switch-console/frontend/src/desk/credentials/rotation.ts";
import { DESK_MESSAGES, deskTranslate } from "../web/strategy-switch-console/frontend/src/desk/i18n/index.ts";
import { formatDateTime } from "../web/strategy-switch-console/frontend/src/lib/format.ts";

const src = path => readFileSync(new URL(`../web/strategy-switch-console/frontend/src/desk/${path}`, import.meta.url), "utf8");
const copy = (language, key, params) => deskTranslate(language, key, params);
const esc = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const values = (html, name) => [...html.matchAll(new RegExp(`${name}="([^"]*)"[^>]*`, "g"))].map(match => match[1]);

// ------------------------------------------------------------------ F1: the ordering model
const READ_AT = "2026-11-03T12:00:00Z";
const DAY = 86_400_000;
const at = days => new Date(Date.parse(READ_AT) + days * DAY).toISOString();

const credential = (id, over = {}) => ({
  id,
  platform: "fake-broker",
  label: `Credential ${id}`,
  kind: "api_key",
  expiry: { status: "known", at: at(60), source: "platform" },
  limit_days: 90,
  phase: "not_due",
  requires_action: false,
  rotation: { supported: true, route: "#/desk/accounts?tab=credentials" },
  runbook: null,
  last_rotated_at: "2026-08-01T12:00:00Z",
  ...over,
});

const FLEX = credential("cred_fake_flex", {
  platform: "fake-flex",
  kind: "flex_token",
  phase: "7",
  requires_action: true,
  expiry: { status: "known", at: at(5), source: "flex_metadata" },
});
const UNREADABLE = credential("cred_fake_unreadable", {
  phase: "unknown",
  rotation: { supported: false, route: null },
  expiry: { status: "unknown", reason: "read_failed" },
});
const NEVER = credential("cred_fake_never", {
  kind: "password",
  rotation: { supported: false, route: null },
  expiry: { status: "none" },
});
const UNREADABLE_FLEX = credential("cred_fake_flex_unreadable", {
  platform: "fake-flex",
  kind: "flex_token",
  phase: "unknown",
  rotation: { supported: false, route: null },
  expiry: { status: "unknown", reason: "read_failed" },
});
// Deliberately not in urgency order, so a render that follows the fixture order fails.
const ITEMS = [
  credential("cred_fake_far", { expiry: { status: "known", at: at(90), source: "platform" } }),
  UNREADABLE,
  credential("cred_fake_expired", { phase: "expired", requires_action: true, expiry: { status: "known", at: at(-4), source: "platform" } }),
  NEVER,
  credential("cred_fake_tomorrow", { kind: "oauth_refresh", phase: "1", requires_action: true, expiry: { status: "known", at: at(1), source: "platform" } }),
  FLEX,
];

assert.deepEqual(sortCredentials(ITEMS).map(item => item.id), [
  "cred_fake_expired", "cred_fake_tomorrow", "cred_fake_flex", "cred_fake_far", "cred_fake_unreadable", "cred_fake_never",
], "most urgent first, and never fixture order");
assert.equal(sortCredentials(ITEMS).length, ITEMS.length, "ordering never hides a credential");
assert.deepEqual(ITEMS.map(item => item.id)[0], "cred_fake_far", "the input array is not mutated");

assert.deepEqual(urgencyKey(credential("x", { expiry: { status: "known", at: "not-a-time", source: "platform" } })),
  { group: "unreadable", at: null }, "a known expiry with no usable instant is unreadable, not distant");
assert.deepEqual(urgencyKey(credential("x", { expiry: { status: "none" } })), { group: "none", at: null });
assert.deepEqual(urgencyKey(credential("x", { expiry: { status: "unknown", reason: "never_read" } })), { group: "unreadable", at: null });
assert.deepEqual(urgencyKey(FLEX), { group: "known", at: Date.parse(at(5)) });
// Equal instants keep the backend's order.
assert.deepEqual(sortCredentials([credential("a", { phase: "30" }), credential("b", { phase: "30" })]).map(item => item.id), ["a", "b"]);

assert.deepEqual(credentialSummary(ITEMS), { brokers: 2, total: 6, due: 3, known: 4, none: 1, unknown: 1 });
assert.deepEqual(credentialSummary([]), { brokers: 0, total: 0, due: 0, known: 0, none: 0, unknown: 0 });
assert.equal(credentialSummary([credential("a", { phase: "30" }), UNREADABLE, credential("b", { phase: "not_due" })]).due, 0,
  "30 days, unknown and not-due are not due");
assert.equal(credentialSummary([credential("a", { phase: "14" })]).due, 0, "the legacy 14 bucket is not a reminder");

assert.deepEqual(credentialAction(FLEX), { kind: "rotate", label: "credentials.action.rotate" });
assert.deepEqual(credentialAction(credential("x", { rotation: { supported: true, route: null } })), { kind: "blocked", reason: "no_route" });
assert.deepEqual(credentialAction(credential("x", { rotation: { supported: false, route: "#/desk/health" } })), { kind: "blocked", reason: "no_route" });
assert.deepEqual(credentialAction(NEVER), { kind: "blocked", reason: "nothing_to_rotate" });
assert.equal(flexCredential(ITEMS).id, FLEX.id);
assert.equal(flexCredential([credential("x")]), null);

// ------------------------------------------------------------------ F4: one status, two renderings
assert.equal(maintenancePhase("1"), "7", "the panel has no 1-day bucket");
for (const phase of ["not_due", "30", "7", "expired", "unknown"]) assert.equal(maintenancePhase(phase), phase);

assert.deepEqual(flexPanelRead([credential("x")], READ_AT), { kind: "absent" });
assert.deepEqual(flexPanelRead([], READ_AT), { kind: "absent" });

const unreadableRead = flexPanelRead([UNREADABLE, UNREADABLE_FLEX], READ_AT);
assert.equal(unreadableRead.kind, "unreadable");
assert.equal(unreadableRead.item.kind, "flex_token", "the Flex credential is the one reported unreadable");
assert.equal("envelope" in unreadableRead, false, "an unreadable credential gets no fabricated envelope");
assert.equal("maintenance" in unreadableRead, false);

const ready = flexPanelRead(ITEMS, READ_AT);
assert.equal(ready.kind, "ready");
assert.equal(ready.envelope.metadata.name, FLEX.id);
assert.equal(ready.envelope.metadata.last_rotated_at, FLEX.last_rotated_at);
assert.equal(ready.envelope.metadata.expires_at, FLEX.expiry.at);
assert.equal(ready.envelope.server_time, READ_AT, "the panel clock is the read's own instant");
assert.equal(ready.maintenance.id, FLEX.id);
assert.equal(ready.maintenance.expires_at, FLEX.expiry.at);
assert.equal(ready.maintenance.phase, "7", "the desk phase reaches the panel unchanged");
assert.equal(ready.maintenance.requires_action, FLEX.requires_action);
assert.equal(ready.maintenance.delivery, "unknown", "the credentials read has no delivery dimension");
assert.equal(ready.envelope.operation, null, "the desk offers no rotation write");
assert.deepEqual(ready.envelope.allowed_actions, []);
// Fail-before: the panel used to carry its own invented 30-day state.
assert.equal(flexPanelRead([credential("cred_fake_flex", { kind: "flex_token", phase: "not_due" })], READ_AT).maintenance.phase, "not_due");
assert.equal(flexPanelRead([credential("cred_fake_flex", { kind: "flex_token", expiry: { status: "none" } })], READ_AT).envelope.metadata.expires_at, null,
  "an explicit no-expiry stays a fact, not an unknown");

// ------------------------------------------------------------------ bundle the desk once
const frontend = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const require = createRequire(join(frontend, "package.json"));
const h = require("react").createElement;
const renderToStaticMarkup = require("react-dom/server").renderToStaticMarkup;
const compiled = require("esbuild").buildSync({
  stdin: {
    resolveDir: join(frontend, "src"),
    loader: "tsx",
    contents: `
      export { CredentialsBody } from "./desk/pages/CredentialsTab";
      export { CredentialTable, CredentialLegend, CredentialSummaryChips, daysLeft } from "./desk/credentials/CredentialTable";
      export { FlexRotationCard } from "./desk/components/FlexRotationCard";
      export { StrategiesPage, TargetRow } from "./desk/pages/StrategiesPage";
      export { TopBar } from "./desk/shell/TopBar";
      export { Dock } from "./desk/shell/Dock";
      export { AuthPage } from "./desk/pages/AuthPage";
      export { I18nProvider } from "./i18n";
      export { default as RotationPanel } from "./pages/health/CredentialRotationPanel";
    `,
  },
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  write: false,
}).outputFiles[0].text;
const desk = { exports: {} };
new Function("require", "module", "exports", compiled)(require, desk, desk.exports);
const {
  CredentialsBody, FlexRotationCard, StrategiesPage, TargetRow, TopBar, Dock, AuthPage, I18nProvider, RotationPanel,
} = desk.exports;

const render = element => renderToStaticMarkup(element);
/** The markup of the element carrying `attribute`, so nesting is asserted rather than guessed. */
function region(html, attribute) {
  const marker = html.indexOf(attribute);
  assert.ok(marker >= 0, `no ${attribute} region`);
  const open = html.lastIndexOf("<", marker);
  const voids = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  let depth = 0;
  for (const match of html.slice(open).matchAll(/<\/?([a-zA-Z][\w-]*)[^>]*?>/g)) {
    if (match[0].startsWith("</")) depth -= 1;
    else if (!voids.has(match[1].toLowerCase()) && !match[0].endsWith("/>")) depth += 1;
    if (depth === 0) return html.slice(open, open + match.index + match[0].length);
    assert.ok(depth >= 0, `unbalanced markup before ${attribute}`);
  }
  throw new Error(`unbalanced ${attribute}`);
}

// Day counts come from the read instant, never from the machine clock.
const { daysLeft } = desk.exports;
assert.equal(daysLeft(at(2), READ_AT), 2);
assert.equal(daysLeft(at(0.5), READ_AT), null, "a part day is not shown as a full day");
assert.equal(daysLeft(at(-1), READ_AT), null, "days left are never negative");
assert.equal(daysLeft("not-a-time", READ_AT), null);
assert.equal(daysLeft(at(3), "not-a-time"), null);

// ------------------------------------------------------------------ F1 + F4: the credentials page
for (const language of ["zh", "en"]) {
  const t = (key, params) => copy(language, key, params);
  const data = { ok: true, schema_version: "qsl.desk.credentials.v1", generated_at: READ_AT, items: ITEMS };
  const html = render(h(CredentialsBody, { data, mock: false, t, language, reload: () => {} }));

  // Title and summary: the count is stated, not implied by a colour.
  assert.match(html, /<h1 class="mrd-serif"/);
  assert.match(html, /<em>[^<]*3[^<]*<\/em>/, "the headline states the due count");
  assert.deepEqual(values(html, "data-summary"), ["due", "known", "none", "unknown"]);
  for (const [key, count] of [["due", 3], ["known", 4], ["none", 1], ["unknown", 1]]) {
    assert.match(html, new RegExp(`data-summary="${key}"[^>]*>[^<]*${esc(copy(language, `credentials.chip.${key}`, { count }))}`));
  }
  assert.match(html, new RegExp(esc(copy(language, "credentials.summary.meta", { brokers: 2, total: 6 }))));

  // The table itself: sorted rows, urgency carried as data, the legend explaining all three states.
  assert.deepEqual(values(html, "data-credential-id"), [
    "cred_fake_expired", "cred_fake_tomorrow", "cred_fake_flex", "cred_fake_far", "cred_fake_unreadable", "cred_fake_never",
  ], "rendered rows follow urgency order in both languages");
  assert.deepEqual(values(html, "data-urgency"), ["expired", "due", "due", "calm", "unknown", "calm"]);
  assert.deepEqual(values(html, "data-legend-state"), ["known", "none", "unknown"]);
  assert.ok(html.includes(copy(language, "credentials.legend.unknown.body")), "the unknown legend is rendered");
  assert.match(html, new RegExp(`class="mrd-why">${esc("rotation.supported=false")}</span>`));
  assert.match(html, new RegExp(`class="mrd-why">${esc("expiry.status=none")}</span>`));
  assert.deepEqual(values(html, "data-credential-action"), ["rotate", "rotate", "rotate", "rotate", "no_route", "nothing_to_rotate"]);
  const cells = [...html.matchAll(/<t[dh][^>]*data-credential-action[^>]*>/g)];
  assert.equal(cells.length, 0, "the action marker sits on the control itself");
  const blocked = [...html.matchAll(/<button[^>]*data-credential-action="(no_route|nothing_to_rotate)"[^>]*>/g)].map(match => match[0]);
  assert.equal(blocked.length, 2);
  for (const tag of blocked) {
    assert.match(tag, / disabled=""/, "a blocked action is genuinely disabled, not styled only");
    assert.match(tag, /title="(rotation\.supported=false|expiry\.status=none)"/, "and names the field behind it");
  }
  assert.equal((html.match(/data-credential-action="rotate"/g) || []).length, 4);
  // The unreadable row shows ? and its reason: never 0 days, never "stopped".
  const unknownRow = html.slice(html.indexOf('data-credential-id="cred_fake_unreadable"'), html.indexOf('data-credential-id="cred_fake_never"'));
  assert.doesNotMatch(unknownRow, new RegExp(esc(copy(language, "credentials.days_left", { days: 0 }))));
  assert.ok(unknownRow.includes("?"), "an unreadable expiry keeps its unknown mark");

  // Rotation sits beside the table, not under it.
  const split = region(html, 'class="mrd-split"');
  assert.ok(split.includes('class="mrd-table"'), "the table is inside the split");
  assert.ok(split.includes('data-flex-credential="cred_fake_flex"'), "the rotation card is inside the same split");
  assert.ok(split.indexOf('class="mrd-table"') < split.indexOf("data-flex-credential"), "the panel is the second column");
  const css = src("styles/desk.css");
  assert.match(css, /\.mrd-split \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 420px;/, "two real columns");
  assert.match(css, /\.mrd-split \{ grid-template-columns: minmax\(0, 1fr\); \}/, "which stack on narrow screens");

  // F4: the card and the embedded panel are fed by the same read.
  const card = render(h(FlexRotationCard, { t, language, items: ITEMS, generatedAt: READ_AT }));
  assert.match(card, /data-flex-credential="cred_fake_flex"/);
  assert.match(card, /class="mrd-embed-label"/, "the frame labels the embedded component");
  assert.ok(card.includes(copy(language, "credentials.panel.credential", { platform: FLEX.platform, kind: copy(language, `credential.kind.${FLEX.kind}`) })));
  const panel = render(h(I18nProvider, { language },
    h(RotationPanel, {
      rotation: { phase: "ready", data: ready.envelope, error: null, reload: () => {} },
      reminder: { phase: "ready", data: ready.maintenance, error: null, reload: () => {} },
      confirm: async () => false,
      onRotated: () => {},
    })));
  assert.ok(panel.includes(`<dd>${esc(FLEX.id)}</dd>`), "the panel names the same credential");
  for (const value of [FLEX.last_rotated_at, FLEX.expiry.at]) {
    assert.match(panel, new RegExp(`class="rotation-stamp">[^<]*${esc(formatDateTime(value, language, true).text)}`),
      "the panel prints the very date the card reads");
  }
  assert.equal(panel.includes('data-empty="true"'), false, "a known value is never rendered as absent");

  const unreadableCard = render(h(FlexRotationCard, { t, language, items: [UNREADABLE_FLEX], generatedAt: READ_AT }));
  assert.match(unreadableCard, /role="status"/);
  assert.equal(unreadableCard.includes("rotation-stamp"), false, "no dates without a readable credential");
  assert.equal(unreadableCard.includes("mrd-rotation"), false, "no write entry without a readable credential");
  assert.ok(unreadableCard.includes(copy(language, "read.reason.read_failed")));
  const absentCard = render(h(FlexRotationCard, { t, language, items: [credential("cred_fake_oauth", { kind: "oauth_refresh" })], generatedAt: READ_AT }));
  assert.ok(absentCard.includes(copy(language, "credentials.panel.absent")));
  assert.equal(absentCard.includes(copy(language, "credentials.panel.unreadable")), false, "absent and unreadable stay distinct");
}

// ------------------------------------------------------------------ F2: the switch entries
const target = (over = {}) => ({
  target_id: "fake-broker/core",
  platform: "fake-broker",
  platform_label: "Fake Broker",
  account_ref: "acct-0001",
  account_suffix: "01",
  mode: { status: "known", value: "paper" },
  domains: ["trend"],
  current_strategy: { status: "known", value: { profile: "trend_break", label: "Trend Break" } },
  execution_modes: ["paper"],
  switchable: { allowed: true, reason_code: null },
  pending_request_id: null,
  stop: { supported: false, resume_supported: false },
  ...over,
});

for (const language of ["zh", "en"]) {
  const t = (key, params) => copy(language, key, params);
  const open = render(h(TargetRow, { target: target(), selected: false, onSelect: () => {}, t, language }));
  assert.match(open, /data-switchable="true"/);
  assert.match(open, /<a class="mrd-button" href="#\/desk\/switch\?target=fake-broker%2Fcore" data-action="open-switch"/, "the entry is a real link");
  assert.equal(open.includes("disabled"), false, "a switchable target is not dead-ended");
  assert.ok(open.includes(copy(language, "strategies.target.switchable")));

  const blockedRow = render(h(TargetRow, { target: target({ switchable: { allowed: false, reason_code: "switch_not_connected" } }), selected: false, onSelect: () => {}, t, language }));
  assert.match(blockedRow, /data-switchable="false"/);
  assert.equal(blockedRow.includes('data-action="open-switch"'), false, "a target that cannot switch offers no live entry");
  const deadSwitch = blockedRow.match(/<button[^>]*data-action="switch-disabled"[^>]*>/g);
  assert.equal(deadSwitch.length, 1);
  assert.match(deadSwitch[0], / disabled=""/, "the disabled state is the control's, not a paint job");
  assert.match(deadSwitch[0], /title="switch_not_connected"/);
  assert.ok(blockedRow.includes(copy(language, "strategies.reason.switch_not_connected")), "the reason is translated");
  // Browsing and previewing stay available; only the write is inert.
  assert.ok(/aria-pressed="false"/.test(blockedRow));

  // An unknown reason code from a newer backend still explains itself rather than blanking out.
  const novel = render(h(TargetRow, { target: target({ switchable: { allowed: false, reason_code: "brand_new_reason" } }), selected: false, onSelect: () => {}, t, language }));
  assert.equal(novel.includes('data-action="open-switch"'), false, "fail closed on an unknown reason");
  assert.match(novel, /brand_new_reason/);
  assert.equal(novel.includes(copy(language, "strategies.target.switchable")), false);

  // The page itself: banner, inert read-back actions and the switch-flow entry.
  const never = () => new Promise(() => {});
  const page = render(h(StrategiesPage, { api: { switchTargets: never, switchStrategies: never }, t, language, admin: true, initialTarget: null }));
  const banner = region(page, 'data-banner="switch-not-connected"');
  assert.ok(banner.includes("<code>switch_not_connected</code>"), "the banner names the reason code");
  assert.ok(banner.includes(copy(language, "strategies.banner.title")));
  assert.ok(banner.includes(copy(language, "strategies.banner.body")));
  assert.ok(page.indexOf('data-banner="switch-not-connected"') < page.indexOf('id="mrd-running-title"'), "the policy is stated before the targets");
  for (const action of ["reapply-saved", "adopt-platform"]) {
    const tag = page.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`));
    assert.ok(tag, `the read-back action ${action} is offered`);
    assert.match(tag[0], / disabled=""/, `${action} cannot be clicked`);
    assert.match(tag[0], /title="not_enabled"/);
  }
  assert.equal(/data-action="(reapply-saved|adopt-platform)"[^>]*aria-disabled="false"/.test(page), false);
  const flow = page.match(/<button[^>]*data-action="open-switch-flow"[^>]*>/);
  assert.ok(flow && !/ disabled=""/.test(flow[0]), "the switch flow stays reachable");
  assert.ok(page.includes('id="mrd-switch-flow"'), "and there is a flow for it to reach");
  assert.match(page.match(/<button[^>]*data-action="confirm-entry"[^>]*>/)[0], / disabled=""/, "confirming is not an entry point");
}

// ------------------------------------------------------------------ F3: the locked shell
const gateway = { kind: "read", read: { status: "known", value: "all_reachable", observed_at: "2026-11-03T12:00:00Z" } };
for (const language of ["zh", "en"]) {
  const t = (key, params) => copy(language, key, params);
  const base = {
    page: "overview", t, language, theme: "light", gateway,
    nowIso: "2026-11-03T12:00:00Z", serverClock: true, mock: "ok",
    freshness: { kind: "read", data_status: "ready", age_seconds: 60 },
    onLanguage: () => {}, onTheme: () => {},
  };
  const open = render(h(TopBar, base));
  assert.ok(open.includes(copy(language, "gateway.all_reachable")), "the unlocked bar does carry gateway data");
  assert.match(open, /data-freshness="ready"/);
  assert.match(open, /class="mrd-chip mrd-clock"/);

  for (const [kind, lock] of [
    ["login", { crumb: "access.title", chip: "access.chip.login" }],
    ["denied", { crumb: "access.denied_title", chip: "access.chip.denied" }],
    ["error", { crumb: "access.error_title", chip: "access.chip.error" }],
  ]) {
    const locked = render(h(TopBar, { ...base, lock }));
    assert.match(locked, new RegExp(`data-locked="${lock.chip}"`));
    assert.ok(locked.includes(copy(language, lock.chip)));
    assert.ok(locked.includes(copy(language, lock.crumb)), "the crumb names the state, not the page");
    assert.equal(locked.includes(copy(language, "gateway.all_reachable")), false, `${kind}: no gateway claim`);
    assert.equal(locked.includes("data-freshness"), false, `${kind}: no freshness claim`);
    assert.equal(locked.includes("mrd-clock"), false, `${kind}: no clock data`);
    assert.equal(locked.includes("mrd-chip-mock"), false, `${kind}: no mock badge`);
    assert.equal(locked.match(/role="status"/g).length, 1, `${kind}: exactly one status, and it is the lock`);
    // The shell still works: language and theme stay available.
    assert.match(locked, /class="mrd-seg"/);
    assert.match(locked, /class="mrd-chip mrd-icon-button"/);
  }

  const dock = render(h(Dock, { page: "overview", t, alertCount: 7, onNavigate: () => {} }));
  assert.equal((dock.match(/<a /g) || []).length, 6);
  assert.match(dock, /class="mrd-badge"/);
  const lockedDock = render(h(Dock, { page: "overview", t, alertCount: 7, locked: true, onNavigate: () => {} }));
  assert.equal(lockedDock.includes("<a "), false, "the dock is locked: nothing navigates");
  assert.match(lockedDock, /class="mrd-dock mrd-dock-locked"/);
  assert.equal((lockedDock.match(/aria-disabled="true"/g) || []).length, 6);
  assert.equal(lockedDock.includes("mrd-badge"), false, "no alert count behind the lock");
  assert.equal(lockedDock.includes("aria-keyshortcuts"), false, "and no hotkey hints");
  assert.ok(lockedDock.includes(copy(language, "access.nav_locked")));

  const denied = render(h(AuthPage, { kind: "forbidden", t, onRetry: () => {}, onSignOut: () => {} }));
  assert.match(denied, /<button type="button" class="mrd-button" data-action="sign-out"/, "a 403 can be left");
  assert.ok(denied.includes(copy(language, "access.forbidden.list").split("|")[0]));
  assert.equal(denied.includes('href="/login"'), false);
  const login = render(h(AuthPage, { kind: "unauthorized", t, onRetry: () => {}, onSignOut: () => {} }));
  assert.match(login, /href="\/login"/);
  assert.equal(login.includes("data-action=\"sign-out\""), false, "nothing to sign out of");
  assert.ok(login.includes("<li>"), "the 401 lists what to check");
  assert.equal(render(h(AuthPage, { kind: "error", t, onRetry: () => {}, onSignOut: () => {} })).includes("<li>"), false);
}

const app = src("DeskApp.tsx");
assert.match(app, /const lock: ShellLock \| null = access === "login"/);
assert.match(app, /freshness=\{lock \? null : freshness\}/);
assert.match(app, /lock=\{lock\}/);
assert.match(app, /if \(lock\) return;/, "hotkeys are inert behind the lock");
assert.match(app, /access === "open" \? pageContent/, "a locked session never reaches a page");
const shell = src("shell/DeskShell.tsx");
assert.match(shell, /alertCount=\{lock \? null : alertCount\}/);
assert.match(shell, /locked=\{Boolean\(lock\)\}/);
assert.match(shell, /data-access=\{lock \? "locked" : "open"\}/);

// Everything the acceptance screens added is present in both languages.
for (const key of [
  "credentials.summary.meta", "credentials.headline.due", "credentials.chip.unknown", "credentials.table.title",
  "credentials.legend.unknown.body", "credentials.action.no_route", "credentials.action.nothing", "credentials.foot",
  "credentials.panel.absent", "credentials.panel.unreadable", "credentials.panel.embed",
  "strategies.banner.title", "strategies.banner.body", "strategies.target.switch", "strategies.s5.reapply",
  "strategies.s5.adopt", "strategies.flow.open", "strategies.catalog.pick_target", "strategies.summary.meta",
  "access.chip.denied", "access.chip.error", "access.nav_locked", "access.signout", "access.login.list", "access.forbidden.list",
]) {
  for (const language of ["zh", "en"]) assert.ok(DESK_MESSAGES[language][key], `missing ${language} ${key}`);
}
assert.match(src("credentials/rotation.ts"), /generatedAt/, "the panel feed is driven by the read");
assert.doesNotMatch(src("components/FlexRotationCard.tsx"), /expires_at: "|phase: "30"/, "the card invents no status");

console.log("console_desk_p1_acceptance_validation: PASS (F1 table + right column, F2 switch entries, F3 locked shell, F4 one Flex status; synthetic only)");
