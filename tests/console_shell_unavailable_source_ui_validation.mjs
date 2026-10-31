import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

// An unreadable auxiliary source must never look like a clean empty state.
const root = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "shell-unavailable-source-"));
try {
  const outfile = join(directory, "shell.cjs");
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { AccountDirectoryContext, ScopeContext } from './src/app/context';
    import { AppShell } from './src/app/AppShell';
    import { ScopeMetaNotice } from './src/components/ScopeSwitcher';
    import { benchmarkPolicy } from './src/pages/performance/benchmarkPolicy';
    import { loadInbox, onInboxRead } from './src/api/endpoints';
    export { benchmarkPolicy, loadInbox, onInboxRead };
    const scope = (overrides) => ({ scope: 'all', options: [], setScope: () => {}, status: 'ready', metaStatus: 'ready', retry: () => {}, ...overrides });
    export const shell = (language, todoCount, todoStatus) => renderToStaticMarkup(h(I18nProvider, { language },
      h(AccountDirectoryContext.Provider, { value: null },
        h(ScopeContext.Provider, { value: scope({}) },
          h(AppShell, { page: 'overview', todoCount, todoStatus, synthetic: false, login: null, updatedAt: null, onLogout: () => {}, children: 'x' })))));
    export const metaNotice = (language) => renderToStaticMarkup(h(I18nProvider, { language },
      h(ScopeMetaNotice, { onRetry: () => {} })));
  ` }, bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, logLevel: "silent" });
  const ui = createRequire(import.meta.url)(outfile);

  // --- To-do badge ----------------------------------------------------------
  const unknownEn = ui.shell("en", null, "read_failed");
  assert.match(unknownEn, /nav-badge-unknown/, "an unreadable inbox marks the to-do item");
  assert.match(unknownEn, /aria-label="To-dos · To-do count unavailable"/,
    "the unknown marker is announced, because the button label replaces its contents");
  assert.match(ui.shell("zh", null, "read_failed"), /待办数量不可读/, "zh: the unknown marker is localized");
  assert.doesNotMatch(ui.shell("en", null, "ok"), /nav-badge/, "a readable inbox with nothing pending stays blank");
  assert.doesNotMatch(ui.shell("en", null, "loading"), /nav-badge-unknown/, "a count still in flight is not called unreadable");
  const counted = ui.shell("en", 3, "read_failed");
  assert.match(counted, /class="nav-badge">3/, "a known count outranks the unknown marker");
  assert.doesNotMatch(counted, /nav-badge-unknown/, "both markers never render at once");

  // --- Scope metadata notice ------------------------------------------------
  assert.match(ui.metaNotice("en"), /Account names and paper\/live labels are unavailable/);
  assert.match(ui.metaNotice("zh"), /无法读取账户名称与模拟\/实盘标记/);
  assert.match(ui.metaNotice("en"), /role="status"/, "the notice is announced once, not per account");
  assert.match(ui.metaNotice("zh"), /Retry|重试/, "the notice offers the existing retry");

  // --- Benchmark basis ------------------------------------------------------
  // A directory read failure leaves every environment unknown; that is not a licence
  // to treat paper accounts as live, so only declared live accounts form the basis.
  const unknownEnvironment = ui.benchmarkPolicy("all", undefined, [
    { alias: "tqqq", platform: "ibkr", paper: null },
    { alias: "live", platform: "binance", paper: false },
  ]);
  assert.equal(unknownEnvironment.reason, "crypto", "an unknown environment was counted as live");
  assert.equal(ui.benchmarkPolicy("all", undefined, [{ alias: "tqqq", platform: "ibkr", paper: null }]).enabled, true,
    "with no known live account the whole cohort still forms the basis");

  // --- One inbox read, every reader ---------------------------------------
  const notified = [];
  const unsubscribe = ui.onInboxRead(() => notified.push("read"));
  const inbox = (status) => new Response(JSON.stringify({ status, items: status === "read_failed" ? [] : [{ status: "pending" }] }),
    { status: 200, headers: { "Content-Type": "application/json" } });
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; return inbox("ok"); };
  await ui.loadInbox();
  assert.equal(fetches, 1);
  assert.deepEqual(notified, ["read"], "a fresh inbox read is announced to the shell");
  await ui.loadInbox();
  assert.equal(fetches, 1, "a successful read stays cached");
  assert.equal(notified.length, 1, "a cache hit never re-announces, so the shell cannot loop into a new request");
  await ui.loadInbox(true);
  assert.equal(fetches, 2, "an explicit refresh still reads");
  assert.equal(notified.length, 2);
  globalThis.fetch = async () => { fetches += 1; return inbox("read_failed"); };
  const failed = await ui.loadInbox(true);
  assert.equal(failed.status, "read_failed");
  assert.equal(notified.length, 3, "a failed read is announced too, so the badge can say unknown");
  unsubscribe();
  await ui.loadInbox(true);
  assert.equal(notified.length, 3, "an unmounted shell stops hearing reads");

  // --- Boot wiring ----------------------------------------------------------
  const app = await readFile(join(root, "src/app/App.tsx"), "utf8");
  assert.match(app, /const unsubscribe = onInboxRead\(sync\)/,
    "the shell badge follows every inbox read, not only the boot one");
  assert.match(app, /setTodoStatus\("read_failed"\);/, "an inbox read that rejects is recorded as unreadable");
  assert.match(app, /setMetaStatus\(config \? "ready" : "error"\)/, "a failed /api/config read is recorded");
  assert.match(app, /paper: config[\s\S]{0,220}: null,/, "an account with no directory has an unknown environment");
  const switcher = await readFile(join(root, "src/components/ScopeSwitcher.tsx"), "utf8");
  assert.match(switcher, /metaStatus === "error" && <ScopeMetaNotice/, "the scope panel states that metadata is unavailable");
  assert.match(switcher, /option\.paper === true/, "only a declared paper account gets the paper badge");
  console.log("console_shell_unavailable_source_ui_validation: PASS");
} finally {
  delete globalThis.fetch;
  await rm(directory, { recursive: true, force: true });
}
