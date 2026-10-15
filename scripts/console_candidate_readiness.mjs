import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { V2_ASSETS, V2_PAGE_HTML, V2_BUILD_ID } from "../web/strategy-switch-console/v2_asset_map.js";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const manifest = {
  build: V2_BUILD_ID,
  resources: [{ path: "/", sha256: sha(V2_PAGE_HTML) },
    ...Object.entries(V2_ASSETS).map(([path, asset]) => ({ path, sha256: sha(Buffer.from(asset.base64, "base64")) }))],
};

// A deployment API acknowledgement does not mean every request router is ready.
// Probe HEAD only until consecutive complete rounds identify the expected build.
// GET byte verification and browser acceptance then start without asset retries.
export async function waitForCandidate({ origin, worker, version, fetcher = fetch,
  expected = manifest, timeoutMs = 60000, pollMs = 1000, stableRounds = 3,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onRound = () => {} }) {
  const url = new URL(origin);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw Error("invalid_candidate_origin");
  if (!/^[a-zA-Z0-9_-]+$/.test(worker) || !/^[a-f0-9-]{36}$/.test(version)) throw Error("invalid_candidate_selector");
  if (![timeoutMs, pollMs, stableRounds].every(Number.isFinite) || timeoutMs <= 0 || pollMs < 0 || stableRounds < 1)
    throw Error("invalid_candidate_wait");
  const headers = { "Cloudflare-Workers-Version-Overrides": `${worker}="${version}"`, "Cache-Control": "no-cache" };
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  while (Date.now() < deadline) {
    const rows = await Promise.all(expected.resources.map(async resource => {
      try {
        const response = await fetcher(new URL(resource.path, url), { method: "HEAD", headers,
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
        return { path: resource.path, status: response.status, build: response.headers.get("x-console-build"),
          ray: response.headers.get("cf-ray") };
      } catch { return { path: resource.path, status: 0, build: null, ray: null }; }
    }));
    const ready = rows.every(row => row.status === 200 && row.build === expected.build);
    stable = ready ? stable + 1 : 0;
    await onRound({ at: new Date().toISOString(), ready, stable, rows });
    if (stable >= stableRounds) return { ready: true, build: expected.build, resources: rows.length };
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  throw Error("candidate_routing_not_ready");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [origin, worker, version] = process.argv.slice(2);
  try {
    console.log(JSON.stringify(await waitForCandidate({ origin, worker, version,
      onRound: round => console.log(JSON.stringify(round)) })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
