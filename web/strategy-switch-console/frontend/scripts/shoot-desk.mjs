// Screenshots of the desk shell for PR review: every page x {light, dark} x {zh, en}, on mocks.
// Usage: node scripts/shoot-desk.mjs <outDir> [page...]. Needs google-chrome (or CHROME=path).
// Serves the built dist/ (run `npm run build` first) on 127.0.0.1 with ?mock=1, so no Worker,
// session or provider is called.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { preview } from "vite";

const [outArg, ...only] = process.argv.slice(2);
if (!outArg) throw new Error("usage: node scripts/shoot-desk.mjs <outDir> [page...]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const pages = only.length ? only : ["overview", "accounts", "switch", "performance", "alerts", "logs"];
const chrome = process.env.CHROME || "google-chrome";

const server = await preview({ root: new URL("../", import.meta.url).pathname, envDir: false, logLevel: "error", preview: { host: "127.0.0.1", port: 0, strictPort: false, open: false } });
const { port } = server.httpServer.address();
try {
  for (const page of pages) {
    for (const [width, height, suffix] of [[1440, 900, ""], ...(process.env.MOBILE ? [[390, 844, "-mobile"]] : [])]) {
      for (const theme of ["light", "dark"]) {
        for (const lang of ["zh", "en"]) {
          const url = `http://127.0.0.1:${port}/v2/?mock=1&theme=${theme}&lang=${lang}#/desk/${page}`;
          const file = `${out}/desk-${page}${suffix}-${theme}-${lang}.png`;
          // Async: a sync spawn would block the in-process server that Chrome is loading from.
          await promisify(execFile)(chrome, ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-prefers-reduced-motion", "--force-device-scale-factor=1", `--window-size=${width},${height}`, "--virtual-time-budget=8000", `--screenshot=${file}`, url], { timeout: 60_000 });
          console.log(file);
        }
      }
    }
  }
} finally {
  await server.close();
}
