import assert from "node:assert/strict";
import { waitForCandidate } from "../scripts/console_candidate_readiness.mjs";
const expected = { build: "synthetic-build", resources: [{ path: "/" }, { path: "/v2/assets/synthetic.js" }] };
const rounds = [];
let calls = 0;
const opts = { origin: "https://synthetic.invalid", worker: "synthetic-worker",
  version: "00000000-0000-0000-0000-000000000000", expected, pollMs: 0, sleep: async () => {},
  onRound: round => rounds.push(round),
  fetcher: async (url, init) => {
    assert.equal(init.method, "HEAD");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers["Cloudflare-Workers-Version-Overrides"], 'synthetic-worker="00000000-0000-0000-0000-000000000000"');
    const round = Math.floor(calls++ / 2);
    // A matching HTML alone is insufficient, and a later mismatch resets readiness.
    const wrong = round === 0 && url.pathname !== "/" || round === 2;
    return new Response(null, { status: wrong ? 404 : 200,
      headers: { "X-Console-Build": wrong ? "old-build" : expected.build } });
  } };
assert.equal((await waitForCandidate(opts)).ready, true);
assert.deepEqual(rounds.map(round => round.stable), [0, 1, 0, 1, 2, 3]);
await assert.rejects(waitForCandidate({ ...opts, timeoutMs: 10, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  pollMs: 5, fetcher: async () => new Response(null, { headers: { "X-Console-Build": "wrong-build" } }) }), /candidate_routing_not_ready/);
await assert.rejects(waitForCandidate({ ...opts, origin: "https://synthetic.invalid/private?token=x" }), /invalid_candidate_origin/);
console.log("console_candidate_readiness_validation: PASS");
