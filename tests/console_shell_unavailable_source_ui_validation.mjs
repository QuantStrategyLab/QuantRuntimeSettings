import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

// An unreadable auxiliary source must never look like a clean empty state.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "shell-unavailable-source-"));
try {
  const outfile = join(directory, "shell.cjs");
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { AccountDirectoryContext, ScopeContext } from './src/app/context';
    import { AppShell } from './src/app/AppShell';
    import { benchmarkPolicy } from './src/pages/performance/benchmarkPolicy';
    export { benchmarkPolicy };
    const scope = (overrides) => ({ scope: 'all', options: [], setScope: () => {}, status: 'ready', metaStatus: 'ready', retry: () => {}, ...overrides });
    export const shell = (language, todoCount, todoStatus) => renderToStaticMarkup(h(I18nProvider, { language },
      h(AccountDirectoryContext.Provider, { value: null },
        h(ScopeContext.Provider, { value: scope({}) },
          h(AppShell, { page: 'overview', todoCount, todoStatus, synthetic: false, login: null, updatedAt: null, onLogout: () => {}, children: 'x' })))));
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

  // --- Boot reads -----------------------------------------------------------
  const app = await readFile(join(root, "src/app/App.tsx"), "utf8");
  assert.match(app, /catch \{\s*if \(cancelled\) return;\s*setTodoStatus\("read_failed"\);/,
    "a thrown inbox read is recorded as unreadable, not swallowed");
  assert.match(app, /setMetaStatus\(config \? "ready" : "error"\)/, "a failed /api/config read is recorded");
  assert.match(app, /paper: config[\s\S]{0,220}: null,/, "an account with no directory has an unknown environment");
  const switcher = await readFile(join(root, "src/components/ScopeSwitcher.tsx"), "utf8");
  assert.match(switcher, /metaStatus === "error"/, "the scope panel states that metadata is unavailable");
  assert.match(switcher, /t\("shell\.scope_meta_error"\)/, "the unavailable metadata copy is localized");
  assert.match(switcher, /option\.paper === true/, "only a declared paper account gets the paper badge");
  console.log("console_shell_unavailable_source_ui_validation: PASS");
} finally {
  await rm(directory, { recursive: true, force: true });
}
