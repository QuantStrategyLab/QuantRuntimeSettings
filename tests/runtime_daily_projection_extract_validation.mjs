import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as constants from "../web/strategy-switch-console/application/runtime_daily_projection/constants.js";
import * as helpers from "../web/strategy-switch-console/application/runtime_daily_projection/helpers.js";
import * as http from "../web/strategy-switch-console/application/runtime_daily_projection/http.js";
import * as runtimeSupport from "../web/strategy-switch-console/application/worker/runtime_support.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const surface = await loadWorkerSurface();
for (const layer of ["constants.js", "helpers.js", "http.js"]) {
  assert.equal(
    surfaceImportsModule(surface, `runtime_daily_projection/${layer}`),
    true,
    `Worker stack imports runtime_daily_projection/${layer}`,
  );
  const src = stripComments(
    await readFile(new URL(`../web/strategy-switch-console/application/runtime_daily_projection/${layer}`, import.meta.url), "utf8"),
  );
  assert.doesNotMatch(src, /from\s+["'][^"']*(?:runtime_support|worker|application\/worker\/)[^"']*["']/, `${layer} must not import worker modules`);
}

for (const key of [
  "RUNTIME_DAILY_KEY_PREFIX",
  "RUNTIME_DAILY_MAX_BODY_BYTES",
  "RUNTIME_DAILY_MAX_RUNS",
  "RUNTIME_DAILY_MAX_LIST",
  "RUNTIME_DAILY_HISTORY_PAGE",
  "RUNTIME_DAILY_HISTORY_MAX_PAGES",
  "RUNTIME_DAILY_STALE_MS",
  "RUNTIME_DAILY_FUTURE_SKEW_MS",
  "RUNTIME_DAILY_SCHEDULE_ONLY",
  "RUNTIME_DAILY_LANES",
  "RUNTIME_DAILY_SCHEDULE_STATES",
  "RUNTIME_DAILY_KINDS",
]) {
  assert.equal(runtimeSupport[key], constants[key], `runtime_support re-exports ${key}`);
}
for (const key of Object.keys(helpers)) {
  assert.equal(runtimeSupport[key], helpers[key], `runtime_support re-exports ${key}`);
}
for (const key of Object.keys(http)) {
  assert.equal(runtimeSupport[key], http[key], `runtime_support re-exports ${key}`);
}

assert.equal((await http.runtimeDailyDisabledResponse()).status, 404);
assert.equal((await http.runtimeDailyUnattributedResponse()).status, 409);

const history = await http.runtimeDailyHistory({}, { target_key: "schwab:live" }, {
  directoryList: async () => ({
    keys: [
      { name: `${constants.RUNTIME_DAILY_KEY_PREFIX}schwab:live:2026-11-17` },
      { name: `${constants.RUNTIME_DAILY_KEY_PREFIX}schwab:live:2026-11-18` },
    ],
  }),
});
assert.deepEqual(history, {
  available_from: "2026-11-17",
  available_through: "2026-11-18",
  stored_days: 2,
  truncated: false,
});
assert.equal(
  await http.runtimeDailyHistory({}, { target_key: "schwab:live" }, {
    directoryList: async () => { throw new Error("kv down"); },
  }),
  null,
);
assert.throws(() => helpers.runtimeDailyReject("invalid_runtime_daily_projection"), /invalid_runtime_daily_projection/);
