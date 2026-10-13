import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { __test } from "../web/strategy-switch-console/worker.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require("miniflare");
const bindings = {
  SESSION_SECRET: "synthetic-maintenance-session",
  STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin",
  ALLOWED_GITHUB_LOGINS: "fixture-reader",
  STRATEGY_SWITCH_SYNC_TOKEN: "synthetic-maintenance-sync",
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-distinct-dispatch",
  IBKR_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-distinct-broker",
};
const admin = `qsl_switch_session=${await __test.makeSession("fixture-admin", [], bindings)}`;
const reader = `qsl_switch_session=${await __test.makeSession("fixture-reader", [], bindings)}`;
const persist = await mkdtemp(join(tmpdir(), "qsl-credential-maintenance-"));
let outbound = 0;
const options = {
  modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08", bindings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist,
  outboundService: () => { outbound += 1; return new Response("offline only", { status: 503 }); },
};
let mf = new Miniflare(options);
async function call(path = "/api/credential-maintenance", body, cookie = admin, token = null, origin = "https://console.example") {
  const response = await mf.dispatchFetch(`https://console.example${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => ({}));
  return { status: response.status, value };
}
const machine = (suffix = "", body, token = bindings.STRATEGY_SWITCH_SYNC_TOKEN) =>
  call(`/api/internal/credential-maintenance${suffix}`, body, "", token);
try {
  const missing = await call();
  assert.equal(missing.status, 200, "the existing console must expose a maintenance projection");
  assert.equal(missing.value.phase, "unknown");
  assert.equal(missing.value.expires_at, null);
  assert.equal(missing.value.requires_action, true);
  assert.equal(missing.value.id, "ibkr_flex");
  assert.equal((await call(undefined, undefined, "")).status, 401);
  assert.equal((await call(undefined, { metadata_revision: 0, expires_at: null }, reader)).status, 403);
  assert.equal((await call(undefined, { metadata_revision: 0, expires_at: null }, admin, null, "https://other.example")).status, 403);
  assert.equal((await machine("", undefined, bindings.RUNTIME_SETTINGS_DISPATCH_TOKEN)).status, 401);
  assert.equal((await machine("", undefined, bindings.IBKR_ACCOUNT_FACTS_SYNC_TOKEN)).status, 401);
  for (const expires_at of ["2035-02-30T00:00:00Z", "2035-01-01", "2035-01-01T00:00:00", "synthetic-token-sentinel"]) {
    const invalid = await call(undefined, { metadata_revision: 0, expires_at });
    assert.equal(invalid.status, 400);
    assert.equal(JSON.stringify(invalid.value).includes(expires_at), false);
  }
  assert.equal((await call(undefined, { metadata_revision: 0, expires_at: null, token: "synthetic-token" })).status, 400);
  const expires = new Date(Date.now() + 20 * 86400000).toISOString();
  const saved = await call(undefined, { metadata_revision: 0, expires_at: expires });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.phase, "30");
  assert.equal(saved.value.metadata_revision, 1);
  const proposal = { metadata_revision: 1, expires_at: expires, phase: "30" };
  const concurrent = await Promise.all([machine("/claim", proposal), machine("/claim", proposal)]);
  assert.deepEqual(concurrent.map(x => x.value.granted).sort(), [false, true]);
  const granted = concurrent.find(x => x.value.granted).value;
  assert.equal(typeof granted.claim_id, "string");
  assert.equal((await call()).value.claim_id, undefined, "browser read must never expose a claim reference");
  assert.equal((await call()).value.delivery, "reserved");
  const unchanged = await call(undefined, { metadata_revision: 1, expires_at: expires });
  assert.equal(unchanged.value.metadata_revision, 1);
  assert.equal((await machine("/claim", proposal)).value.granted, false);
  assert.equal((await machine("/ack", { ...proposal, claim_id: granted.claim_id, outcome: "unknown" })).value.delivery, "unknown");
  assert.equal((await machine("/claim", proposal)).value.granted, false, "uncertain delivery is never lease-released");
  await mf.dispose();
  mf = new Miniflare(options);
  assert.equal((await call()).value.delivery, "unknown", "reserve/delivery state must survive restart");
  assert.equal((await machine("/claim", proposal)).value.granted, false);
  const renewed = new Date(Date.now() + 100 * 86400000).toISOString();
  assert.equal((await call(undefined, { metadata_revision: 1, expires_at: renewed })).value.metadata_revision, 2);
  assert.equal((await machine("/ack", { ...proposal, claim_id: granted.claim_id, outcome: "delivered" })).status, 409);
  const current = (await call()).value;
  assert.equal(current.expires_at, renewed);
  assert.equal(current.phase, "not_due");
  assert.equal(current.delivery, "not_reserved");
  assert.equal((await machine("/claim", { metadata_revision: 2, expires_at: renewed, phase: "30" })).status, 409);
  const returned = await call(undefined, { metadata_revision: 2, expires_at: expires });
  assert.equal(returned.value.metadata_revision, 3);
  assert.equal(returned.value.delivery, "unknown", "A to B to A preserves canonical expiry delivery history");
  assert.equal((await machine("/claim", { metadata_revision: 3, expires_at: expires, phase: "30" })).value.granted, false);
  assert.equal((await machine("/ack", { metadata_revision: 3, expires_at: expires, phase: "30", claim_id: granted.claim_id, outcome: "delivered" })).status, 409);
  // A new, unrelated expiry allows a strict success ACK, never wrong-claim ACK.
  const finalExpiry = new Date(Date.now() + 5 * 86400000).toISOString();
  await call(undefined, { metadata_revision: 3, expires_at: finalExpiry });
  const finalProposal = { metadata_revision: 4, expires_at: finalExpiry, phase: "7" };
  const finalClaim = (await machine("/claim", finalProposal)).value;
  assert.equal((await machine("/ack", { ...finalProposal, claim_id: "synthetic-wrong", outcome: "delivered" })).status, 409);
  for (let i = 0; i < 2; i++) assert.equal((await machine("/ack", { ...finalProposal, claim_id: finalClaim.claim_id, outcome: "delivered" })).value.delivery, "delivered");
  assert.equal((await machine("/claim", finalProposal)).value.granted, false);
  const { credentialPhase, normalizeExpiryInstant } = await import("../web/strategy-switch-console/credentialMaintenance.js");
  const now = Date.parse("2035-01-01T00:00:00Z");
  for (const [days, expected] of [[40, "not_due"], [20, "30"], [5, "7"], [0.5, "1"], [-1, "expired"]]) {
    assert.equal(credentialPhase(new Date(now + days * 86400000).toISOString(), now), expected);
  }
  for (const [days, expected] of [[30, "30"], [7, "7"], [1, "1"], [0, "expired"]]) assert.equal(credentialPhase(new Date(now + days * 86400000).toISOString(), now), expected);
  assert.equal(credentialPhase(null, now), "unknown");
  assert.equal(credentialPhase("2035-02-30T00:00:00Z", now), "unknown");
  for (const alias of ["RUNTIME_SETTINGS_DISPATCH_TOKEN", "IBKR_ACCOUNT_FACTS_SYNC_TOKEN", "CONTROL_PLANE_SYNC_TOKEN"]) {
    const colliding = new Miniflare({ ...options, durableObjectsPersist: false, bindings: { ...bindings, [alias]: bindings.STRATEGY_SWITCH_SYNC_TOKEN } });
    try {
      const response = await colliding.dispatchFetch("https://console.example/api/internal/credential-maintenance", { headers: { Authorization: `Bearer ${bindings.STRATEGY_SWITCH_SYNC_TOKEN}` } });
      assert.equal(response.status, 503);
    } finally { await colliding.dispose(); }
  }
  const noSync = new Miniflare({ ...options, durableObjectsPersist: false, bindings: { ...bindings, STRATEGY_SWITCH_SYNC_TOKEN: "" } });
  try { assert.equal((await noSync.dispatchFetch("https://console.example/api/internal/credential-maintenance", { headers: { Authorization: `Bearer ${bindings.RUNTIME_SETTINGS_DISPATCH_TOKEN}` } })).status, 503); } finally { await noSync.dispose(); }

  assert.equal(normalizeExpiryInstant("2035-01-01T08:00:00+08:00"), "2035-01-01T00:00:00.000Z");
  assert.equal(outbound, 0);
  console.log("credential maintenance worker validation passed");
} finally {
  await mf.dispose();
  await rm(persist, { recursive: true, force: true });
}
