import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

const frontend = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "page-load-boundary-"));
try {
  const outfile = join(directory, "boundary.cjs");
  await build({ entryPoints: [join(frontend, "src/components/PageLoadBoundary.tsx")],
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", logLevel: "silent" });
  const { PageLoadErrorBoundary } = createRequire(import.meta.url)(outfile);
  const child = { synthetic: true };
  const boundary = new PageLoadErrorBoundary({ title: "Cannot load", action: "Reload page", children: child });
  assert.equal(boundary.render(), child);
  boundary.state = PageLoadErrorBoundary.getDerivedStateFromError(new Error("synthetic chunk failure"));
  const alert = boundary.render();
  assert.equal(alert.props.role, "alert");
  assert.equal(alert.props.children[0].props.children, "Cannot load");
  let reloads = 0;
  globalThis.location = { reload() { reloads += 1; } };
  alert.props.children[1].props.onClick();
  assert.equal(reloads, 1);
  const app = await readFile(join(frontend, "src/app/App.tsx"), "utf8");
  assert.match(app, /<PageLoadBoundary key=\{route\.page\}>\s*<Suspense/);
  console.log("console_page_load_boundary_validation: PASS");
} finally {
  delete globalThis.location;
  await rm(directory, { recursive: true, force: true });
}
