import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDeskAuth, DeskError } from "../web/strategy-switch-console/application/desk/http.js";
import {
  createDeskTargetReadback,
  buildReadback,
  READBACK_KEYS,
} from "../web/strategy-switch-console/application/desk/readback.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const deskModules = [
  "application/desk/http.js",
  "application/desk/readback.js",
];

const surface = await loadWorkerSurface({
  includeDurableObject: true,
  applicationModules: deskModules,
});
const { supportSource, durableSource } = surface;

const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/desk/http.js", import.meta.url),
  "utf8",
);
const readbackSource = await readFile(
  new URL("../web/strategy-switch-console/application/desk/readback.js", import.meta.url),
  "utf8",
);

assert.equal(
  surfaceImportsModule(surface, "desk/http.js"),
  true,
  "Worker stack imports desk/http.js",
);
assert.equal(
  surfaceImportsModule(surface, "desk/readback.js"),
  true,
  "Worker stack imports desk/readback.js",
);

assert.match(supportSource, /export const deskAuth = createDeskAuth/);
assert.match(supportSource, /createDeskTargetReadback/);
assert.match(supportSource, /deskTargetReadbackImpl/);
assert.match(supportSource, /async function deskTargetReadback/);
assert.match(durableSource, /deskTargetReadback/);

assert.match(httpSource, /export function createDeskAuth/);
assert.match(readbackSource, /export function createDeskTargetReadback/);
assert.match(readbackSource, /Desk reads deliberately bypass/);

for (const source of [httpSource, readbackSource]) {
  const noComments = stripComments(source);
  assert.equal(
    /transactionSync/.test(noComments),
    false,
    "desk leftover modules must not open Durable Object transactions",
  );
  assert.equal(
    source.includes('from "../worker/runtime_support.js"')
      || source.includes("from '../worker/runtime_support.js'")
      || source.includes('from "./worker.js"')
      || source.includes("from '../worker.js'")
      || source.includes('from "../../worker.js"'),
    false,
    "desk leftover modules must not import runtime_support.js or worker.js",
  );
}

assert.equal(
  /RUNTIME_SETTINGS_DISPATCH_TOKEN/.test(supportSource)
    && /export async function deskTargetReadback/.test(supportSource)
    && /platformReason = "source_unavailable"/.test(supportSource),
  false,
  "deskTargetReadback projection body must not remain inline in runtime_support",
);
assert.equal(
  /platformReason = "source_unavailable"/.test(supportSource),
  false,
  "deskTargetReadback platformReason logic must live in desk/readback.js",
);

{
  const auth = createDeskAuth({
    readSession: async () => ({ allowed: true, admin: true, login: "synthetic" }),
    requireSameOrigin: () => {},
  });
  assert.equal((await auth(new Request("https://synthetic.example/"), {})).login, "synthetic");
  await assert.rejects(
    createDeskAuth({
      readSession: async () => null,
      requireSameOrigin: () => {},
    })(new Request("https://synthetic.example/"), {}),
    (error) => error instanceof DeskError && error.status === 401,
  );
}

{
  const now = Date.parse("2030-01-02T12:00:00Z");
  const ratio = (text) => (Number(text) >= 0 && Number(text) <= 1 ? text : "");
  const config = {
    key: "demo",
    label: "Synthetic",
    target_name: "demo",
    default_strategy_profile: "demo_profile",
    broker_environment: "paper",
    account_selector: "FAKE0001",
  };
  const target = { id: "longbridge/demo", platform: "longbridge", key: "demo", config, revision: 3 };
  const observed = {
    config,
    instance_revision: 3,
    enabled: true,
    draft: { status: "empty" },
    account_options: { longbridge: [config] },
  };
  const nativeNow = Date.now;
  Date.now = () => now;
  try {
    const deskTargetReadback = createDeskTargetReadback({
      runtimeInstanceCommand: async () => {
        throw new Error("should not call when observed supplied");
      },
      readRiskProfileLegacy: async () => null,
      platformRepositories: () => ({}),
      fetchGithubVariables: async () => new Map(),
      resolveCurrentStrategyForAccount: async () => {
        throw new Error("unreachable");
      },
      resolveVariableScope: () => "repository",
      resolveGithubEnvironment: () => "",
      runtimeTargetFromServiceTargets: () => null,
      parseJsonObject: () => null,
      runtimeTargetMatchesAccount: () => false,
      cleanCurrentRatio: ratio,
      splitSelectorValues: (value) => String(value || "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean),
    });
    const rb = await deskTargetReadback({}, target, "synthetic-reader", observed);
    assert.equal(rb.fields.every((row) => row.platform.reason === "source_unavailable"), true);
    assert.equal(rb.saved_revision, 3);
    assert.deepEqual(rb.fields.map((row) => row.key), [...READBACK_KEYS]);
    assert.equal(typeof buildReadback, "function");
  } finally {
    Date.now = nativeNow;
  }
}

console.log("desk_leftovers_extract_validation: ok");
