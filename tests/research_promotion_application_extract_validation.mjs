import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  researchPromotionApplicationResponse,
  researchPromotionApplicationInternalResponse,
} from "../web/strategy-switch-console/application/research_promotion/applications.js";

const workerSource = await readFile(
  new URL("../web/strategy-switch-console/worker.js", import.meta.url),
  "utf8",
);
const moduleSource = await readFile(
  new URL("../web/strategy-switch-console/application/research_promotion/applications.js", import.meta.url),
  "utf8",
);

assert.equal(
  workerSource.includes('from "./application/research_promotion/applications.js"'),
  true,
  "Worker imports the B10-d research-promotion applications module",
);
assert.match(workerSource, /\/api\/research-promotion-applications"/);
assert.match(workerSource, /\/api\/internal\/research-promotion-application\//);
assert.match(workerSource, /researchPromotionApplicationResponseImpl/);
assert.match(workerSource, /researchPromotionApplicationInternalResponseImpl/);
assert.match(workerSource, /async function researchPromotionApplicationResponse/);
assert.match(workerSource, /async function researchPromotionApplicationInternalResponse/);
assert.match(workerSource, /function applicationIdFromPath/);
assert.match(workerSource, /function validateV7PaperApplicationReadback/);
assert.match(workerSource, /CREATE TABLE IF NOT EXISTS research_promotion_applications/);

const moduleNoComments = moduleSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
assert.equal(
  /transactionSync/.test(moduleNoComments),
  false,
  "applications module must not open Durable Object transactions",
);
assert.equal(
  /class RuntimeInstances|RUNTIME_INSTANCE|DURABLE_OBJECT|CREATE TABLE|research_promotion_applications/.test(moduleSource),
  false,
  "applications module must not own DO identity or research_promotion_applications table",
);
assert.equal(
  moduleSource.includes('from "./worker.js"')
    || moduleSource.includes("from '../worker.js'")
    || moduleSource.includes('from "../../worker.js"')
    || moduleSource.includes("from '../../worker.js'"),
  false,
  "application module must not import worker.js",
);
assert.equal(
  moduleSource.includes("admin required") && moduleSource.includes("login required"),
  true,
  "permission rejects stay in the extracted handlers",
);
assert.equal(
  moduleSource.includes("requireSameOrigin") && moduleSource.includes("requireDedicatedExecutionEvidenceSyncToken"),
  true,
  "same-origin and dedicated sync-token gates stay wired via DI",
);
assert.equal(
  moduleSource.includes("promotion_material_key") && moduleSource.includes("qualifyV7PaperApplication"),
  true,
  "create path still binds promotion material fingerprint via qualify",
);
assert.equal(
  moduleSource.includes("claim_token") && moduleSource.includes("readback_mismatch"),
  true,
  "claim-token and readback mismatch → uncertain semantics stay",
);
assert.equal(
  /recordResearchPromotionDecisionResponse|syncResearchPromotionTicketResponse|researchPromotionTicketsResponse/.test(moduleSource),
  false,
  "B10-d smallest slice: ticket sync/decision queue stays outside applications.js",
);
assert.equal(
  /FIRSTRADE|LB-HK|LONGPORT_HK|longbridge.?hk/i.test(moduleSource),
  false,
  "B10-d must not touch LB-HK / Firstrade env",
);

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function publicDeps(overrides = {}) {
  return {
    json,
    readSession: async () => ({ allowed: true, login: "app-admin", admin: true }),
    requireSameOrigin: () => {},
    readBoundedJson: async () => ({
      expected_revision: 1,
      selected_account: { platform: "longbridge", key: "paper" },
      ticket_id: `rpt_${"a".repeat(64)}`,
    }),
    runtimeInstanceCommand: async () => {
      throw new Error("runtimeInstanceCommand should not run in this case");
    },
    assertExactFields: (value) => value,
    randomToken: () => "token-fixture-abcdefghijklmnopqrstuvwxyz",
    qualifyV7PaperApplication: async () => {
      throw new Error("qualify should not run in this case");
    },
    dispatchV7PaperApplication: async () => {
      throw new Error("dispatch should not run in this case");
    },
    publicResearchPromotionApplication: (application) => application,
    isUnsupportedApplicationActionError: (error) => (
      error?.message === "unsupported_research_promotion_application_action"
    ),
    V7_PAPER_APPLICATION_MAX_BODY_BYTES: 16 * 1024,
    V7_PAPER_APPLICATION_SOURCE_COMMIT: "d".repeat(40),
    V7_PAPER_APPLICATION_UES_REVISION: "e".repeat(40),
    ...overrides,
  };
}

function internalDeps(overrides = {}) {
  return {
    json,
    requireDedicatedExecutionEvidenceSyncToken: () => {},
    hasRuntimeInstanceStore: () => true,
    applicationIdFromPath: () => "11111111-1111-4111-8111-111111111111",
    readBoundedJson: async () => ({}),
    runtimeInstanceCommand: async () => {
      throw new Error("runtimeInstanceCommand should not run in this case");
    },
    assertExactFields: (value) => value,
    qualifyV7PaperApplication: async () => ({}),
    validateV7PaperApplicationReadback: () => true,
    V7_PAPER_APPLICATION_MAX_BODY_BYTES: 16 * 1024,
    V7_PAPER_APPLICATION_WORKFLOW_REPOSITORY: "QuantStrategyLab/LongBridgePlatform",
    V7_PAPER_APPLICATION_WORKFLOW: "apply-paper-candidate.yml",
    ...overrides,
  };
}

{
  const unauthorized = await researchPromotionApplicationResponse(
    new Request("https://console.example/api/research-promotion-applications?ticket_id=rpt_x"),
    {},
    new URL("https://console.example/api/research-promotion-applications?ticket_id=rpt_x"),
    publicDeps({ readSession: async () => null }),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error, "login required");
}

{
  const forbidden = await researchPromotionApplicationResponse(
    new Request("https://console.example/api/research-promotion-applications", { method: "POST" }),
    {},
    new URL("https://console.example/api/research-promotion-applications"),
    publicDeps({
      readSession: async () => ({ allowed: true, login: "reader", admin: false }),
    }),
  );
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, "admin required");
}

{
  const originReject = await researchPromotionApplicationResponse(
    new Request("https://console.example/api/research-promotion-applications", { method: "POST" }),
    {},
    new URL("https://console.example/api/research-promotion-applications"),
    publicDeps({
      requireSameOrigin: () => {
        throw Object.assign(new Error("origin required"), { status: 403 });
      },
    }),
  );
  assert.equal(originReject.status, 403);
  assert.equal((await originReject.json()).error, "origin required");
}

{
  const unsupported = await researchPromotionApplicationResponse(
    new Request("https://console.example/api/research-promotion-applications?ticket_id=rpt_x"),
    {},
    new URL("https://console.example/api/research-promotion-applications?ticket_id=rpt_x"),
    publicDeps({
      runtimeInstanceCommand: async () => {
        throw Object.assign(new Error("unsupported_research_promotion_application_action"), { status: 400 });
      },
    }),
  );
  assert.equal(unsupported.status, 200);
  assert.deepEqual(await unsupported.json(), { ok: true, application: null });
}

{
  const tokenReject = await researchPromotionApplicationInternalResponse(
    new Request("https://console.example/api/internal/research-promotion-application/11111111-1111-4111-8111-111111111111"),
    {},
    new URL("https://console.example/api/internal/research-promotion-application/11111111-1111-4111-8111-111111111111"),
    internalDeps({
      requireDedicatedExecutionEvidenceSyncToken: () => {
        throw Object.assign(new Error("execution evidence sync token is invalid"), { status: 401 });
      },
    }),
  );
  assert.equal(tokenReject.status, 401);
  assert.equal((await tokenReject.json()).error, "execution evidence sync token is invalid");
}

{
  let claimedCommand = null;
  const claimTokenReject = await researchPromotionApplicationInternalResponse(
    new Request("https://console.example/api/internal/research-promotion-application/11111111-1111-4111-8111-111111111111", {
      method: "POST",
    }),
    {},
    new URL("https://console.example/api/internal/research-promotion-application/11111111-1111-4111-8111-111111111111"),
    internalDeps({
      readBoundedJson: async () => ({
        application_id: "11111111-1111-4111-8111-111111111111",
        status: "claimed",
        claim: {
          token: "token-fixture-abcdefghijklmnopqrstuvwxyz",
          workflow_run_id: "123",
          workflow_run_attempt: "1",
        },
      }),
      runtimeInstanceCommand: async (_env, command) => {
        if (command?.action === "application_read") {
          return {
            application: {
              application_id: "11111111-1111-4111-8111-111111111111",
              ticket_id: `rpt_${"a".repeat(64)}`,
              platform_id: "longbridge",
              account_key: "paper",
              expected_revision: 1,
              claim_token: "other-token-abcdefghijklmnopqrstuvwxyz",
            },
          };
        }
        claimedCommand = command;
        return { claimed: true, reason: "" };
      },
    }),
  );
  assert.equal(claimTokenReject.status, 409);
  assert.equal((await claimTokenReject.json()).error, "invalid paper application claim token");
  assert.equal(claimedCommand, null);
}

{
  let resultCommand = null;
  const readbackMismatch = await researchPromotionApplicationInternalResponse(
    new Request("https://console.example/api/internal/research-promotion-application/11111111-1111-4111-8111-111111111111", {
      method: "POST",
    }),
    {},
    new URL("https://console.example/api/internal/research-promotion-application/11111111-1111-4111-8111-111111111111"),
    internalDeps({
      readBoundedJson: async () => ({
        application_id: "11111111-1111-4111-8111-111111111111",
        status: "applied_paused",
        claim: {
          token: "token-fixture-abcdefghijklmnopqrstuvwxyz",
          workflow_run_id: "123",
          workflow_run_attempt: "1",
        },
        readback: { application_id: "mismatch" },
      }),
      validateV7PaperApplicationReadback: () => false,
      runtimeInstanceCommand: async (_env, command) => {
        if (command?.action === "application_read") {
          return {
            application: {
              application_id: "11111111-1111-4111-8111-111111111111",
              claim_token: "token-fixture-abcdefghijklmnopqrstuvwxyz",
            },
          };
        }
        resultCommand = command;
        return { changed: true, application: { status: "uncertain" } };
      },
    }),
  );
  assert.equal(readbackMismatch.status, 200);
  const body = await readbackMismatch.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "uncertain");
  assert.equal(resultCommand.status, "uncertain");
  assert.equal(resultCommand.reason_code, "readback_mismatch");
}

console.log("research_promotion_application_extract_validation: ok");
