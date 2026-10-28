// Exercise the released frontend against the candidate backend, not two copies
// of the same maintenance checkout. The release workflow fetches this commit.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { __test } from "../web/strategy-switch-console/worker.js";
import { strategySummary } from "../web/strategy-switch-console/application/console_api/operations.js";

const workflow = await readFile(".github/workflows/deploy-strategy-switch-console.yml", "utf8");
const pins = [...workflow.matchAll(/^\s*(?:frontend_sha|frontend)="([0-9a-f]{40})"\s*$/gm)].map(match => match[1]);
// The serving-backend checkout predates the current release workflow. Once
// integrated, always use that workflow's actual frontend pin and reject drift.
if (pins.length && (pins.length !== 2 || pins[0] !== pins[1])) throw new Error("frontend_release_pin_mismatch");
const frontendCommit = pins[0] ?? "256ae373bdb7c1d08c4455c7268490275f923346";
const directory = await mkdtemp(join(tmpdir(), "qsl-release-combination-"));
const originalFetch = globalThis.fetch;
try {
  let root = process.env.QSL_FRONTEND_SOURCE_DIR;
  if (!root) {
    const path = "web/strategy-switch-console/frontend/src";
    const archive = execFileSync("git", ["archive", "--format=tar", frontendCommit, path,
      "web/strategy-switch-console/display_names.js", "web/strategy-switch-console/display_names_data.js"],
    { maxBuffer: 16 * 1024 * 1024 });
    execFileSync("tar", ["-xf", "-", "-C", directory], { input: archive });
    root = join(directory, "web/strategy-switch-console/frontend");
    await symlink(resolve("web/strategy-switch-console/frontend/node_modules"), join(root, "node_modules"));
  }
  const outfile = join(directory, "render.cjs");
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { AccountExecution } from './src/pages/strategies/StrategiesPage';
    export const render = accounts => renderToStaticMarkup(h(I18nProvider, { language: 'zh' }, h(AccountExecution, { accounts })));
  ` }, bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" }, plugins: [{ name: "expose-test-component", setup(builder) {
      builder.onLoad({ filter: /\/StrategiesPage\.tsx$/ }, async ({ path }) => ({
        contents: await readFile(path, "utf8") + "\nexport { AccountExecution };", loader: "tsx",
      }));
    } }], logLevel: "silent" });

  globalThis.fetch = async () => Response.json({ variables: [{ name: "RUNTIME_TARGET_JSON", value: JSON.stringify({
    target_name: "synthetic", strategy_profile: "synthetic_profile", execution_mode: "paper", dry_run_only: false,
  }) }] });
  const current = await __test.loadCurrentStrategies({ longbridge: [{ key: "synthetic", target_name: "synthetic", broker_environment: "paper" }] },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-token" });
  const data = await strategySummary(new Request("https://console.example"), {}, {
    profiles: async () => [{ profile: "synthetic_profile", domain: "us_equity" }],
    health: async () => Response.json({ data_status: "ready", strategies: [] }),
  }, [{ platform: "longbridge", key: "synthetic" }], current);
  const accounts = data.strategies[0].configured_accounts;
  assert.equal(accounts[0].execution_evidence.value, "paper");
  assert.equal(accounts[0].execution_evidence.runtime_observation_status, "unknown");
  const html = createRequire(import.meta.url)(outfile).render(accounts);
  assert.ok(html.includes("execution-evidence-status"), "released frontend renders the backend evidence");
  assert.equal(data.execution_authority_granted, false);
  console.log(`website_release_combination_validation: PASS (candidate backend and ${process.env.QSL_FRONTEND_SOURCE_DIR ? "local frontend" : "fixed frontend"}; synthetic only)`);
} finally {
  globalThis.fetch = originalFetch;
  await rm(directory, { recursive: true, force: true });
}
