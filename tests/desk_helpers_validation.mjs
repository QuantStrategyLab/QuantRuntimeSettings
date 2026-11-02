import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { ACCOUNT_FACTS_STALE_MS } from "../web/strategy-switch-console/account_facts.js";
import { known, stale, unknown, classifyAge, readSource } from "../web/strategy-switch-console/application/desk/read.js";
import { DeskError, deskErrorResponse, deskResponse } from "../web/strategy-switch-console/application/desk/http.js";
import { withIdempotency } from "../web/strategy-switch-console/application/desk/idempotency.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require("miniflare");
const Ajv = require("ajv/dist/2020").default;
const ajv = new Ajv({ strict: false });
require("ajv-formats")(ajv);
for (const name of ["common", "session", "error"]) ajv.addSchema(JSON.parse(readFileSync(new URL(`../schemas/desk/${name}.json`, import.meta.url))));
const conforms = (name, value) => {
  const check = ajv.getSchema(`https://schemas.example.invalid/qsl/desk/${name}.json`);
  assert.ok(check(value), ajv.errorsText(check.errors));
};
const readSchema = ajv.compile({ $ref: "https://schemas.example.invalid/qsl/desk/common.json#/$defs/Read" });
const now = Date.parse("2020-01-02T12:00:00Z");
const iso = (offset) => new Date(now + offset).toISOString();
assert.deepEqual(classifyAge(iso(-60_000), 60, now), { status: "known" });
assert.deepEqual(classifyAge(iso(-61_000), 60, now), { status: "stale" });
assert.deepEqual(classifyAge(iso(300_000), 60, now), { status: "known" });
assert.deepEqual(classifyAge(iso(301_000), 60, now), unknown("read_failed"));
assert.deepEqual(classifyAge(iso(-ACCOUNT_FACTS_STALE_MS), undefined, now), { status: "known" });
assert.deepEqual(classifyAge(iso(-ACCOUNT_FACTS_STALE_MS - 1000), undefined, now), { status: "stale" });
for (const observed of [null, undefined, "invalid"]) assert.deepEqual(classifyAge(observed, 60, now), unknown("read_failed"));
for (const ttl of [-1, NaN, Infinity]) assert.deepEqual(classifyAge(iso(0), ttl, now), unknown("read_failed"));
assert.deepEqual(classifyAge(iso(0), 60, NaN), unknown("read_failed"));
assert.deepEqual(stale("1.20", iso(-61_999), now), { status: "stale", value: "1.20", observed_at: iso(-61_999), age_seconds: 61 });
for (const value of [false, 0, [], null, "stopped"]) {
  const result = await readSource(() => ({ value, observed_at: iso(0) }), { now });
  assert.deepEqual(result, known(value, iso(0)), "verified falsy/empty values stay known");
  assert.ok(readSchema(result));
}
const composed = await Promise.all([
  readSource(() => { throw new Error("private synthetic failure"); }, { now }),
  readSource(async () => { throw new Error("private synthetic failure"); }, { now }),
  readSource(() => ({ value: false, observed_at: iso(0) }), { now }),
]);
assert.deepEqual(composed, [unknown("read_failed"), unknown("read_failed"), known(false, iso(0))]);
assert.deepEqual(await readSource(() => null, { now }), unknown("read_failed"));
assert.deepEqual(await readSource(() => unknown("source_unavailable"), { now }), unknown("source_unavailable"));
assert.deepEqual(await readSource(() => ({ value: "2.00", observed_at: iso(-ACCOUNT_FACTS_STALE_MS - 1000) }), { now }), stale("2.00", iso(-ACCOUNT_FACTS_STALE_MS - 1000), now));
for (const result of [known("2", iso(0)), stale("2", iso(-1000), now), unknown("never_read")]) assert.ok(readSchema(result));

const response = deskResponse("overview", { ok: false, generated_at: "invalid", schema_version: "invalid" }, { now, headers: { "Cache-Control": "public" } });
assert.equal(response.headers.get("cache-control"), "no-store");
assert.deepEqual(await response.json(), { ok: true, generated_at: iso(0), schema_version: "qsl.desk.overview.v1" });
for (const status of [400, 401, 403, 404, 409, 422, 429, 502, 503]) {
  const errorResponse = deskErrorResponse(new DeskError("synthetic_failure", status));
  assert.equal(errorResponse.status, status);
  assert.equal(errorResponse.headers.get("cache-control"), "no-store");
  conforms("error", await errorResponse.json());
}
assert.deepEqual(await deskErrorResponse(Object.assign(new Error("private synthetic details"), { status: 400, reason: "private" })).json(), { ok: false, error: "read_failed", reason_code: "read_failed" });

const originalNow = Date.now;
// Session uses new Date(), so replace the clock only around the session call.
const OriginalDate = Date;
try {
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const anonymous = await worker.fetch(new Request("https://synthetic.example/api/session"), {});
  assert.equal(anonymous.headers.get("cache-control"), "no-store");
  const payload = await anonymous.json();
  assert.deepEqual(payload, JSON.parse(readFileSync(new URL("./fixtures/desk/session.anonymous.json", import.meta.url))));
  conforms("session", payload);
} finally { globalThis.Date = OriginalDate; }
assert.equal(Date.now, originalNow);
const env = { SESSION_SECRET: "synthetic-session-only", ALLOWED_GITHUB_LOGINS: "synthetic-reader", STRATEGY_SWITCH_ADMIN_LOGINS: "synthetic-admin" };
const requestFor = async (login, origin) => new Request("https://synthetic.example/api/desk/readbacks", {
  method: "POST", headers: { ...(login ? { Cookie: `qsl_switch_session=${await __test.makeSession(login, [], env)}` } : {}), ...(origin ? { Origin: origin } : {}) },
});
for (const login of [null, "synthetic-denied"]) {
  const req = await requestFor(login);
  await assert.rejects(__test.deskAuth(req, env), (error) => error.status === 401);
}
const reader = await requestFor("synthetic-reader");
assert.equal((await __test.deskAuth(reader, env)).allowed, true);
const authenticatedPayload = await (await worker.fetch(new Request("https://synthetic.example/api/session", { headers: reader.headers }), env)).json();
conforms("session", authenticatedPayload);
assert.equal(authenticatedPayload.authenticated, true);
assert.equal(authenticatedPayload.login, "synthetic-reader");
assert.equal(authenticatedPayload.allowed, true);
assert.equal(authenticatedPayload.admin, false);
await assert.rejects(__test.deskAuth(reader, env, { admin: true }), (error) => error.status === 403);
await assert.rejects(__test.deskAuth(reader, env, { write: true }), (error) => error.status === 403);
await assert.rejects(__test.deskAuth(await requestFor("synthetic-reader", "https://other.invalid"), env, { write: true }), (error) => error.status === 403);
assert.equal((await __test.deskAuth(await requestFor("synthetic-admin", "https://synthetic.example"), env, { admin: true, write: true })).admin, true);

const mf = new Miniflare({
  modules: true, compatibilityDate: "2026-01-01",
  modulesRoot: fileURLToPath(new URL("../", import.meta.url)),
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("./helpers/desk_idempotency_worker.mjs", import.meta.url)),
  durableObjects: { STORE: { className: "SyntheticDeskStore", useSQLite: true } },
});
try {
  const send = async (body, extra = {}) => {
    const response = await mf.dispatchFetch("https://synthetic.example/", { method: "POST", body: JSON.stringify({ scope: "synthetic-reader:POST:/api/desk/readbacks", body, ...extra }) });
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: await response.json() };
  };
  const body = { idempotency_key: "synthetic-1", targets: ["synthetic/demo"], options: { a: true, b: 2 } };
  const first = await send(body);
  assert.equal(first.status, 202);
  const replay = await send({ options: { b: 2, a: true }, targets: body.targets, idempotency_key: body.idempotency_key });
  assert.deepEqual(replay, { ...first, body: { ...first.body, reused: true } });
  assert.equal((await send({ ...body, targets: [] })).body.error, "idempotency_key_conflict");
  assert.equal((await send({ ...body, targets: [] })).status, 409);
  assert.equal((await send(body, { scope: "synthetic-other:POST:/api/desk/readbacks" })).body.creates, 2);
  for (const idempotency_key of ["", "bad key", "a".repeat(129), null, 1]) assert.equal((await send({ idempotency_key })).status, 400);
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => send({ ...body, idempotency_key: "concurrent" }, { delay: true })));
  assert.equal(concurrent.filter((item) => item.status === 202 && !item.body.reused).length, 1);
  assert.ok(concurrent.every((item) => item.status === 202 || item.body.error === "request_in_progress"));
  const uncertain = { ...body, idempotency_key: "uncertain" };
  assert.equal((await send(uncertain, { fail: true })).status, 502);
  assert.equal((await send(uncertain)).body.error, "request_in_progress");
} finally { await mf.dispose(); }
await assert.rejects(withIdempotency(null, { scope: "synthetic", body: { idempotency_key: "valid" } }, () => {}), (error) => error.status === 503);
console.log("desk_helpers_validation: PASS (Read, errors, real session/auth, durable replay and concurrency)");
