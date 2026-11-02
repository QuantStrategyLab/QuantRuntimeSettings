// Credential rotation entry (Health page): SSR copy, write-only guarantees, request
// identity, response allowlists and the #1034 flat-design rules. Synthetic values only.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "credential-rotation-ui-"));

/** Anything resembling a real secret, version or provider payload is a sentinel. */
const SENTINELS = [
  "synthetic-token-sentinel-0123456789abcdef",
  "synthetic-totp-sentinel-31337",
  "synthetic-recovery-sentinel-445566",
  "synthetic-version-sentinel-777",
  "synthetic-fingerprint-sentinel-999",
  "synthetic-provider-sentinel-body",
];

const envelope = (overrides = {}) => ({
  schema_version: "qsl.credential_rotation.v1",
  ok: true,
  server_time: "2026-11-02T10:00:00Z",
  metadata: {
    name: "IBKR Flex token",
    last_rotated_at: "2026-08-01T09:00:00Z",
    expires_at: "2026-11-25T09:00:00Z",
  },
  operation: null,
  allowed_actions: ["stage"],
  ...overrides,
});

const operation = (state, allowed_actions = [], reason_code = null) => ({
  operation_id: "op-synthetic-1",
  state,
  requested_expires_at: "2027-02-01T00:00:00+08:00",
  created_at: "2026-11-02T09:55:00Z",
  updated_at: "2026-11-02T09:56:00Z",
  allowed_actions,
  reason_code,
});

const reminder = (phase = "30") => ({
  phase: "ready",
  data: { id: "ibkr_flex", expires_at: "2026-11-25T09:00:00Z", phase, requires_action: true, delivery: "telegram" },
  error: null,
  reload: () => {},
});

try {
  const outfile = join(directory, "rotation.cjs");
  await build({
    stdin: {
      resolveDir: root,
      contents: `
        import { createElement as h } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { I18nProvider, translate } from './src/i18n';
        import Panel, {
          createRotationRequestIds, emptyStageForm, outcomeErrorKey, rotationActions,
          stageFormIncomplete, stepUpIncomplete, submitCancel, submitFinalize, submitStage,
        } from './src/pages/health/CredentialRotationPanel';
        import {
          cancelCredentialRotation, finalizeCredentialRotation, isRotationTimestamp, loadCredentialRotation,
          loadCredentialRotationOperation, rotationErrorCode, stageCredentialRotation,
        } from './src/api/endpoints';
        import { readRevision } from './src/api/client';
        import { loadAuditEvents } from './src/api/cockpit';
        export {
          createRotationRequestIds, emptyStageForm, outcomeErrorKey, rotationActions, stageFormIncomplete,
          stepUpIncomplete, submitCancel, submitFinalize, submitStage, cancelCredentialRotation,
          finalizeCredentialRotation, isRotationTimestamp, loadCredentialRotation,
          loadCredentialRotationOperation, rotationErrorCode, stageCredentialRotation, readRevision, translate,
          loadAuditEvents,
        };
        export const render = (language, props) =>
          renderToStaticMarkup(h(I18nProvider, { language }, h(Panel, props)));
      `,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" },
    logLevel: "silent",
  });
  const ui = createRequire(import.meta.url)(outfile);

  /* ---------- 1. SSR copy in both languages ---------- */

  const visible = html => html.replace(/ data-[a-z-]+="[^"]*"/g, "").replace(/ aria-[a-z-]+="[^"]*"/g, "");
  const ready = data => ({ phase: "ready", data, error: null, reload: () => {} });
  const panelProps = (rotation, overrides = {}) => ({
    rotation,
    reminder: reminder(),
    confirm: async () => true,
    onRotated: () => {},
    ...overrides,
  });

  const CASES = [
    ["empty metadata", envelope({
      metadata: { name: "IBKR Flex token", last_rotated_at: null, expires_at: null },
    })],
    ["stage available", envelope()],
    ["staged", envelope({ operation: operation("staged", ["finalize", "cancel"]), allowed_actions: [] })],
    ["adding_version", envelope({ operation: operation("adding_version"), allowed_actions: [] })],
    ["finalizing", envelope({ operation: operation("finalizing"), allowed_actions: [] })],
    ["canceling", envelope({ operation: operation("canceling"), allowed_actions: [] })],
    ["add_unknown", envelope({ operation: operation("add_unknown"), allowed_actions: [] })],
    ["finalize_unknown", envelope({
      operation: operation("finalize_unknown", ["finalize", "cancel"]), allowed_actions: [],
    })],
    ["cancel_unknown", envelope({
      operation: operation("cancel_unknown", ["cancel"]), allowed_actions: [],
    })],
    ["finalized", envelope({ operation: operation("finalized"), allowed_actions: ["stage"] })],
    ["canceled", envelope({ operation: operation("canceled"), allowed_actions: [] })],
    ["staged with unconfirmed provider", envelope({
      operation: operation("staged", ["finalize", "cancel"], "proxy_unconfirmed"), allowed_actions: [],
    })],
    ["finalize_unknown with revision conflict", envelope({
      operation: operation("finalize_unknown", [], "maintenance_revision_conflict"), allowed_actions: [],
    })],
    ["failed with provider failure", envelope({
      operation: operation("failed", [], "provider_failed"), allowed_actions: [],
    })],
    ["read only", envelope({ allowed_actions: [] })],
  ];

  const COPY = {
    zh: {
      title: "凭证轮换",
      credential: "凭证",
      last: "上次完成轮换",
      expiry: "到期时间",
      never: "尚无完成记录",
      none: "未登记",
      open: "更新 IBKR Flex token",
      stage: "暂存新 token",
      finalize: "确认完成轮换",
      cancel: "取消并禁用暂存版本",
      unknown: "结果未确认，不要重复提交；请重新读取并对账。",
      refresh: "重新读取状态",
      writeOnly: "提交后不会显示或重新读取 token。",
      stageNote: "暂存不会禁用旧版本；完成下游更新和验证后再确认。",
      notFound: "未找到",
    },
    en: {
      title: "Credential rotation",
      credential: "Credential",
      last: "Last rotated",
      expiry: "Expiry",
      never: "No completed rotation",
      none: "Not recorded",
      open: "Update IBKR Flex token",
      stage: "Stage new token",
      finalize: "Finalize rotation",
      cancel: "Cancel staged version",
      unknown: "The outcome is unconfirmed. Do not resubmit; refresh and reconcile.",
      refresh: "Refresh status",
      writeOnly: "The token is never displayed or read back after submission.",
      stageNote: "Staging keeps the old version enabled; finalize only after downstream update and verification.",
      notFound: "Not found",
    },
  };

  for (const [name, fixture] of CASES) {
    for (const language of ["zh", "en"]) {
      const html = visible(ui.render(language, panelProps(ready(fixture))));
      const copy = COPY[language];
      // No key or reason code reaches visible text.
      assert.doesNotMatch(html, /health\.rotation\.|credential_rotation_|reason\./, `${name}/${language}: raw key leaked`);
      assert.ok(html.includes(copy.title), `${name}/${language}: card title`);
      assert.ok(html.includes("IBKR Flex token"), `${name}/${language}: credential name`);
      assert.ok(html.includes(copy.credential), `${name}/${language}: name label`);
      assert.ok(html.includes(copy.last), `${name}/${language}: last rotated label`);
      assert.ok(html.includes(copy.expiry), `${name}/${language}: expiry label`);
      assert.ok(html.includes(copy.writeOnly), `${name}/${language}: write-only prose`);

      const state = fixture.operation?.state ?? null;
      const unknownState = ["add_unknown", "finalize_unknown", "cancel_unknown"].includes(state);
      const markup = ui.render(language, panelProps(ready(fixture)));
      if (unknownState) {
        // An unconfirmed outcome offers reconciliation, never another write.
        assert.ok(markup.includes(copy.unknown), `${name}/${language}: unknown prose`);
        assert.ok(markup.includes(`>${copy.refresh}<`), `${name}/${language}: refresh action`);
        for (const label of [copy.stage, copy.finalize, copy.cancel]) {
          assert.ok(!markup.includes(`>${label}<`), `${name}/${language}: ${label} must not be offered`);
        }
      }
    }
  }

  // A recorded operation reason renders as its own localized phrase, never the code.
  const REASON_COPY = {
    zh: {
      proxy_unconfirmed: "上游未确认结果",
      maintenance_revision_conflict: "维护信息版本冲突",
      provider_failed: "上游操作失败",
    },
    en: {
      proxy_unconfirmed: "Provider outcome unconfirmed",
      maintenance_revision_conflict: "Maintenance revision conflict",
      provider_failed: "Provider operation failed",
    },
  };
  for (const reason of Object.keys(REASON_COPY.en)) {
    for (const language of ["zh", "en"]) {
      const rendered = visible(ui.render(language, panelProps(ready(envelope({
        operation: operation("finalize_unknown", [], reason), allowed_actions: [],
      })))));
      assert.ok(rendered.includes(REASON_COPY[language][reason]), `${reason}/${language}: recorded reason is localized`);
    }
  }

  const emptyZh = visible(ui.render("zh", panelProps(ready(envelope({
    metadata: { name: "IBKR Flex token", last_rotated_at: null, expires_at: null },
  })))));
  assert.ok(emptyZh.includes(COPY.zh.never) && emptyZh.includes(COPY.zh.none), "missing metadata stays honest");
  assert.ok(/<dd data-empty="true">/.test(ui.render("zh", panelProps(ready(envelope({
    metadata: { name: "IBKR Flex token", last_rotated_at: null, expires_at: null },
  }))))), "missing metadata is marked empty, not zeroed");
  const stagedEn = ui.render("en", panelProps(ready(envelope({
    operation: operation("staged", ["finalize", "cancel"]), allowed_actions: [],
  }))));
  assert.ok(stagedEn.includes(">Finalize rotation<") && stagedEn.includes(">Cancel staged version<"), "staged offers finalize and cancel");
  assert.ok(stagedEn.includes(">Staged; downstream verification required<"), "staged state copy");
  assert.ok(/autocomplete="one-time-code"/i.test(stagedEn), "TOTP field opts into one-time-code autofill");
  const readOnlyEn = ui.render("en", panelProps(ready(envelope({ allowed_actions: [] }))));
  assert.ok(!readOnlyEn.includes(">Update IBKR Flex token<"), "a reader with no stage action gets no mutation entry");
  const failedHtml = ui.render("en", panelProps(
    { phase: "error", data: null, error: new Error("request_failed"), reload: () => {} },
    { reminder: reminder("unknown") },
  ));
  const failed = visible(failedHtml);
  assert.ok(failed.includes("Unable to load"), "read failure is its own state");
  assert.ok(/data-state="read_failed"/.test(failedHtml), "read failure carries its own state marker");
  assert.ok(!failed.includes("IBKR Flex token"), "a read failure is not rendered as an empty healthy panel");
  const reminderFailed = visible(ui.render("en", panelProps(ready(envelope()), {
    reminder: { phase: "error", data: null, error: new Error("request_failed"), reload: () => {} },
  })));
  assert.ok(reminderFailed.includes("Retry"), "a failed reminder read keeps its retry");

  /* ---------- 2. Nothing secret is ever rendered or retained ---------- */

  const formHtml = ui.render("en", panelProps(ready(envelope())));
  const opened = formHtml.match(/<input[^>]*type="password"[^>]*>/)?.[0] ?? "";
  assert.ok(opened.length > 0, "the new token uses a password input");
  assert.doesNotMatch(opened, /placeholder=/, "the token field carries no example value");
  assert.ok(/value=""/.test(opened), "the token field starts and stays empty in markup");
  assert.doesNotMatch(formHtml, /show|reveal|copy|strength/i, "no reveal, copy or strength affordance");
  for (const sentinel of SENTINELS) {
    assert.ok(!formHtml.includes(sentinel), `sentinel ${sentinel} reached the markup`);
  }
  const sources = await Promise.all([
    readFile(join(root, "src/pages/health/CredentialRotationPanel.tsx"), "utf8"),
    readFile(join(root, "src/api/endpoints.ts"), "utf8"),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|console\./, "secrets never reach storage or the log");
  }

  /* ---------- 3. Real adapters against a mocked fetch ---------- */

  const jsonResponse = (payload, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  });
  const realFetch = globalThis.fetch;
  let calls = [];
  // The shared client broadcasts session loss through window; SSR has no DOM.
  const sessionEvents = [];
  globalThis.window = { dispatchEvent: event => { sessionEvents.push(event); return true; } };
  const route = handlers => async (path, init) => {
    calls.push({ path: String(path), init });
    for (const [match, response] of handlers) {
      if (String(path).includes(match)) return typeof response === "function" ? response(path, init) : response;
    }
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  };

  try {
    calls = [];
    globalThis.fetch = route([["/api/credential-rotation/ibkr_flex", jsonResponse(envelope())]]);
    const read = await ui.loadCredentialRotation();
    assert.equal(read.metadata.name, "IBKR Flex token");
    assert.equal(calls[0].path, "/api/credential-rotation/ibkr_flex");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.cache, "no-store", "reads never come from a cache");
    assert.equal(calls[0].init.credentials, "same-origin");

    // The operation read reconciles by id, and never mutates.
    calls = [];
    globalThis.fetch = route([["/operations/op-synthetic-1", jsonResponse(envelope({
      operation: operation("staged", ["finalize", "cancel"]),
    }))]]);
    const reconciled = await ui.loadCredentialRotationOperation("op-synthetic-1");
    assert.equal(reconciled.operation.state, "staged");
    assert.equal(calls[0].path, "/api/credential-rotation/ibkr_flex/operations/op-synthetic-1");
    assert.equal(calls[0].init.method, "GET");

    /* stage: exact path, exact body, secrets cleared before the request */
    calls = [];
    let clearedBeforeRequest = false;
    globalThis.fetch = route([["/stage", (path, init) => {
      clearedBeforeRequest = clearedFlag;
      return jsonResponse(envelope({ operation: operation("staged", ["finalize", "cancel"]), allowed_actions: [] }));
    }]]);
    let clearedFlag = false;
    const stageRequests = ui.createRotationRequestIds();
    const stageForm = {
      new_value: SENTINELS[0],
      expires_at: "2027-02-01T00:00:00+08:00",
      method: "totp",
      code: SENTINELS[1],
    };
    const staged = await ui.submitStage({
      form: stageForm,
      slot: "stage",
      requests: stageRequests,
      isCurrent: () => true,
      clearSecrets: () => { clearedFlag = true; },
    });
    assert.equal(staged.kind, "envelope");
    assert.ok(clearedBeforeRequest, "the token and code are dropped before the first await");
    assert.equal(calls[0].path, "/api/credential-rotation/ibkr_flex/stage");
    const stageBody = JSON.parse(calls[0].init.body);
    assert.deepEqual(Object.keys(stageBody).sort(), ["expires_at", "new_value", "request_id", "step_up"],
      "the stage body carries only the whitelisted keys");
    assert.deepEqual(Object.keys(stageBody.step_up).sort(), ["code", "method"]);
    assert.equal(stageBody.new_value, SENTINELS[0], "the value is sent, never stored");
    assert.equal(typeof stageBody.request_id, "string");

    /* a rejected second factor writes nothing, and the current login stays valid */
    calls = [];
    const eventsBeforeStepUp = sessionEvents.length;
    const revisionBeforeStepUp = ui.readRevision();
    globalThis.fetch = route([["/stage", jsonResponse({ ok: false, error: "step_up_invalid" }, 403)]]);
    const replayRequests = ui.createRotationRequestIds();
    const heldId = replayRequests.acquire("stage");
    assert.equal(replayRequests.acquire("stage"), heldId, "one request id per logical write");
    const firstDenial = await ui.submitStage({
      form: stageForm, slot: "stage", requests: replayRequests, isCurrent: () => true, clearSecrets: () => {},
    });
    assert.equal(firstDenial.kind, "unavailable", "a fixed denial reads as not allowed");
    assert.equal(firstDenial.code, "step_up_invalid", "the fixed code survives the shared client");
    assert.equal(ui.outcomeErrorKey(firstDenial), "reason.step_up_invalid", "a rejected code has its own copy");
    assert.equal(sessionEvents.length, eventsBeforeStepUp, "a rejected code never invalidates the session");
    assert.equal(ui.readRevision(), revisionBeforeStepUp, "a rejected code records no write");
    assert.equal(JSON.parse(calls[0].init.body).request_id, heldId);
    assert.equal(replayRequests.isBlocked("stage"), false, "a denial that wrote nothing is replayable");
    const secondDenial = await ui.submitStage({
      form: stageForm, slot: "stage", requests: replayRequests, isCurrent: () => true, clearSecrets: () => {},
    });
    assert.equal(secondDenial.kind, "unavailable");
    assert.equal(sessionEvents.length, eventsBeforeStepUp, "still no session loss on the retry");
    assert.equal(calls.length, 2);
    assert.notEqual(JSON.parse(calls[1].init.body).request_id, heldId,
      "a retry after a confirmed no-write is a new logical write, so the server never sees a reused id");
    assert.equal(replayRequests.peek("stage"), null, "the released slot mints a fresh id next time");

    /* the remaining 403 codes each get their own message, and still invalidate the session */
    const FORBIDDEN_CODES = ["origin_required", "cross_origin_rejected", "rotation_owner_required", "step_up_invalid"];
    const deniedKeys = [];
    for (const code of FORBIDDEN_CODES.filter(entry => entry !== "step_up_invalid")) {
      calls = [];
      const eventsBefore = sessionEvents.length;
      globalThis.fetch = route([["/stage", jsonResponse({ ok: false, error: code }, 403)]]);
      const refused = await ui.submitStage({
        form: stageForm, slot: "stage", requests: ui.createRotationRequestIds(),
        isCurrent: () => true, clearSecrets: () => {},
      });
      assert.equal(refused.kind, "unavailable", `${code}: a refusal is never an unknown outcome`);
      assert.equal(refused.code, code, `${code}: the code is preserved`);
      assert.equal(ui.outcomeErrorKey(refused), `reason.${code}`, `${code}: its own copy`);
      assert.equal(sessionEvents.length, eventsBefore + 1, `${code}: other 403 still invalidates the session`);
      deniedKeys.push(ui.outcomeErrorKey(refused));
    }
    assert.equal(new Set([...deniedKeys, "reason.step_up_invalid"]).size, 4,
      "each distinct 403 code maps to a different message key");

    // Each of the four codes resolves to vetted copy in both languages, never a fallback.
    for (const language of ["zh", "en"]) {
      const texts = FORBIDDEN_CODES.map(code => ui.translate(language, `reason.${code}`));
      texts.forEach((text, index) => {
        assert.ok(text.length > 8, `${FORBIDDEN_CODES[index]}/${language}: message is written out`);
        assert.notEqual(text, ui.translate(language, "reason.unknown"),
          `${FORBIDDEN_CODES[index]}/${language}: not left on the unknown fallback`);
      });
      assert.equal(new Set(texts).size, 4, `${language}: the four 403 messages are distinct`);
    }

    /* a refusal payload that is not the exact two-field JSON never escapes the session rule */
    calls = [];
    const eventsBeforeShape = sessionEvents.length;
    globalThis.fetch = route([["/stage", jsonResponse({ ok: false, error: "step_up_invalid", detail: "synthetic" }, 403)]]);
    const malformedDenial = await ui.submitStage({
      form: stageForm, slot: "stage", requests: ui.createRotationRequestIds(), isCurrent: () => true, clearSecrets: () => {},
    });
    assert.equal(malformedDenial.kind, "unavailable", "an unexpected payload is still a refusal");
    assert.equal(malformedDenial.code, undefined, "no code is read from a payload outside the contract");
    assert.equal(ui.outcomeErrorKey(malformedDenial), "health.rotation.unavailable");
    assert.equal(sessionEvents.length, eventsBeforeShape + 1, "only the exact error JSON keeps the session");

    /* a fixed 400 keeps the field error, a fixed 409 reads as not allowed */
    calls = [];
    globalThis.fetch = route([["/stage", jsonResponse({ ok: false, error: "invalid_credential_expiry" }, 400)]]);
    const badExpiry = await ui.submitStage({
      form: stageForm, slot: "stage", requests: ui.createRotationRequestIds(),
      isCurrent: () => true, clearSecrets: () => {},
    });
    assert.equal(badExpiry.kind, "invalid", "a fixed 400 is a field problem, not an unknown outcome");
    calls = [];
    globalThis.fetch = route([["/stage", jsonResponse({ ok: false, error: "credential_rotation_state_conflict" }, 409)]]);
    const conflict = await ui.submitStage({
      form: stageForm, slot: "stage", requests: ui.createRotationRequestIds(),
      isCurrent: () => true, clearSecrets: () => {},
    });
    assert.equal(conflict.kind, "unavailable", "a fixed 409 is a refusal, never a success");

    /* an unconfirmed outcome blocks any further write; refresh is the only path */
    calls = [];
    globalThis.fetch = route([["/stage", () => { throw new TypeError("synthetic network loss"); }]]);
    const lostRequests = ui.createRotationRequestIds();
    const lost = await ui.submitStage({
      form: stageForm, slot: "stage", requests: lostRequests, isCurrent: () => true, clearSecrets: () => {},
    });
    assert.equal(lost.kind, "unconfirmed", "a transport failure is an unknown outcome, not a failure");
    assert.equal(lostRequests.isBlocked("stage"), true);
    assert.equal(ui.outcomeErrorKey(lost), "health.rotation.request_failed");
    const retry = await ui.submitStage({
      form: stageForm, slot: "stage", requests: lostRequests, isCurrent: () => true, clearSecrets: () => {},
    });
    assert.equal(calls.length, 1, "nothing is resubmitted after an unconfirmed outcome");
    assert.equal(retry.kind, "unconfirmed");
    lostRequests.releaseAll();
    assert.equal(lostRequests.isBlocked("stage"), false, "reconciling clears the lock");

    /* a late response cannot overwrite newer state */
    calls = [];
    globalThis.fetch = route([["/stage", jsonResponse(envelope({ operation: operation("staged"), allowed_actions: [] }))]]);
    const superseded = await ui.submitStage({
      form: stageForm, slot: "stage", requests: ui.createRotationRequestIds(),
      isCurrent: () => false, clearSecrets: () => {},
    });
    assert.equal(superseded.kind, "superseded");

    /* finalize: acknowledgement and a fresh code are both required */
    calls = [];
    globalThis.fetch = route([["/finalize", jsonResponse(envelope({ operation: operation("finalized"), allowed_actions: [] }))]]);
    const noAck = await ui.submitFinalize({
      stepUp: { method: "totp", code: SENTINELS[1] },
      operationId: "op-synthetic-1",
      downstreamVerified: false,
      slot: "finalize",
      requests: ui.createRotationRequestIds(),
      isCurrent: () => true,
      clearSecrets: () => {},
    });
    assert.equal(noAck.kind, "invalid");
    assert.equal(calls.length, 0, "finalize without the attestation is never sent");
    const noCode = await ui.submitFinalize({
      stepUp: { method: "totp", code: "" },
      operationId: "op-synthetic-1",
      downstreamVerified: true,
      slot: "finalize",
      requests: ui.createRotationRequestIds(),
      isCurrent: () => true,
      clearSecrets: () => {},
    });
    assert.equal(noCode.kind, "invalid");
    assert.equal(calls.length, 0, "finalize without a code is never sent");
    let finalizeCleared = false;
    globalThis.fetch = route([["/finalize", (path, init) => {
      finalizeCleared = clearedDuringFlight;
      return jsonResponse(envelope({ operation: operation("finalized"), allowed_actions: [] }));
    }]]);
    let clearedDuringFlight = false;
    const finalized = await ui.submitFinalize({
      stepUp: { method: "recovery", code: SENTINELS[2] },
      operationId: "op-synthetic-1",
      downstreamVerified: true,
      slot: "finalize",
      requests: ui.createRotationRequestIds(),
      isCurrent: () => true,
      clearSecrets: () => { clearedDuringFlight = true; },
    });
    assert.equal(finalized.kind, "envelope");
    assert.ok(finalizeCleared, "the code is dropped before the finalize request");
    assert.equal(calls[0].path, "/api/credential-rotation/ibkr_flex/operations/op-synthetic-1/finalize");
    const finalizeBody = JSON.parse(calls[0].init.body);
    assert.deepEqual(Object.keys(finalizeBody).sort(), ["downstream_verified", "request_id", "step_up"]);
    assert.equal(finalizeBody.downstream_verified, true);

    /* cancel needs a fresh code and sends nothing else */
    calls = [];
    globalThis.fetch = route([["/cancel", jsonResponse(envelope({ operation: operation("canceled"), allowed_actions: [] }))]]);
    const canceled = await ui.submitCancel({
      stepUp: { method: "totp", code: SENTINELS[1] },
      operationId: "op-synthetic-1",
      slot: "cancel",
      requests: ui.createRotationRequestIds(),
      isCurrent: () => true,
      clearSecrets: () => {},
    });
    assert.equal(canceled.kind, "envelope");
    assert.equal(calls[0].path, "/api/credential-rotation/ibkr_flex/operations/op-synthetic-1/cancel");
    assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)).sort(), ["request_id", "step_up"]);

    /* session invalidation is honored: the private read revision moves */
    calls = [];
    const revisionBefore = ui.readRevision();
    const eventsBefore = sessionEvents.length;
    globalThis.fetch = route([["/stage", jsonResponse({ ok: false, error: "unauthorized" }, 401)]]);
    const signedOut = await ui.submitStage({
      form: stageForm, slot: "stage", requests: ui.createRotationRequestIds(), isCurrent: () => true, clearSecrets: () => {},
    });
    assert.equal(signedOut.kind, "unconfirmed", "a lost session is never reported as success");
    assert.ok(ui.readRevision() > revisionBefore, "the invalidated session moves the read revision");
    assert.equal(sessionEvents.length, eventsBefore + 1, "the invalidation event is broadcast once");
    assert.equal(calls.length, 1, "a lost session is not retried");
    assert.equal(ui.rotationErrorCode(null), null);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.window;
  }

  /* ---------- 5. Response allowlists ---------- */

  const reject = async (payload, label) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse(payload);
    try {
      await assert.rejects(() => ui.loadCredentialRotation(), /invalid_credential_rotation_response/, label);
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  await reject(envelope({ metadata: { ...envelope().metadata, value: SENTINELS[0] } }), "an echoed value is rejected");
  await reject(envelope({ metadata: { ...envelope().metadata, masked_value: SENTINELS[0] } }), "a masked value is rejected");
  await reject(envelope({ metadata: { ...envelope().metadata, token: SENTINELS[3] } }), "an echoed token field is rejected");
  await reject(envelope({ operation: { ...operation("staged"), version: SENTINELS[3] } }), "a version field is rejected");
  await reject(envelope({ operation: { ...operation("staged"), resource_name: SENTINELS[3] } }), "a resource name is rejected");
  await reject(envelope({ operation: { ...operation("staged"), fingerprint: SENTINELS[4] } }), "a fingerprint is rejected");
  await reject(envelope({ provider_response: SENTINELS[5] }), "a provider response is rejected");
  await reject(envelope({ metadata: { ...envelope().metadata, expires_at: "2026-11-25 09:00" } }), "a naive expiry is rejected");
  await reject(envelope({ operation: operation("staged", ["stage"]) }), "an unexpected action is rejected");
  await reject(envelope({ operation: operation("staged", ["finalize", "cancel"], "step_up_invalid") }),
    "an HTTP error code is never a recorded operation reason");
  await reject(envelope({ operation: { ...operation("staged"), allowed_actions: undefined } }),
    "an operation without allowed_actions is rejected");
  await reject(envelope({ operation: { ...operation("staged"), created_at: null } }),
    "a required operation timestamp is never read as empty");
  await reject(envelope({ operation: { ...operation("staged"), operation_id: "short" } }), "a too-short operation id is rejected");
  await reject(envelope({ operation: { ...operation("mystery_state") } }), "an unknown state is rejected");
  await reject({ ...envelope(), server_time: undefined }, "an envelope without server_time is rejected");
  await reject({ ...envelope(), metadata: { name: "IBKR Flex token", expires_at: null } }, "a metadata key cannot go missing");
  await reject(envelope({ metadata: { ...envelope().metadata, expires_at: "2026-11-25T09:00:00.1234Z" } }),
    "more than three fractional digits is not a contract instant");
  await reject(envelope({ metadata: { ...envelope().metadata, expires_at: "2026-02-30T09:00:00Z" } }), "a nonexistent day is rejected");
  await reject(envelope({ metadata: { ...envelope().metadata, expires_at: "1969-01-01T00:00:00Z" } }), "a year below 1970 is rejected");
  await reject(envelope({ metadata: { ...envelope().metadata, expires_at: "2026-11-25T09:00:00+24:00" } }), "an impossible offset is rejected");
  await reject({ ...envelope(), schema_version: "qsl.credential_rotation.v2" }, "a foreign schema is rejected");
  await reject({ ...envelope(), ok: false }, "a non-ok envelope is rejected");

  // The recorded-reason vocabulary round-trips, and the bounded id shape is enforced.
  const reasonRead = async (reason_code) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse(envelope({
      operation: { ...operation("finalize_unknown"), reason_code },
    }));
    try {
      return (await ui.loadCredentialRotation()).operation.reason_code;
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  for (const reason of ["proxy_unconfirmed", "maintenance_revision_conflict", "provider_failed", null]) {
    assert.equal(await reasonRead(reason), reason, `${reason}: a recorded reason is kept`);
  }
  for (const badId of ["short", "-leading-hyphen", "has.dots.inside", "with space inside", "a".repeat(129)]) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse(envelope());
    try {
      await assert.rejects(() => ui.loadCredentialRotationOperation(badId), /invalid_credential_rotation_response/,
        `${badId}: outside the bounded id shape`);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
  assert.equal(ui.rotationErrorCode(new Error("operation_id_invalid")), "operation_id_invalid");
  assert.equal(ui.rotationErrorCode(new Error("downstream_verification_required")), "downstream_verification_required");

  assert.equal(ui.isRotationTimestamp("2027-02-01T00:00:00+08:00"), true);
  assert.equal(ui.isRotationTimestamp("2027-02-01T00:00:00Z"), true);
  assert.equal(ui.isRotationTimestamp("2027-02-01T00:00:00"), false, "an offset-less expiry is not accepted");
  assert.equal(ui.stageFormIncomplete({ ...ui.emptyStageForm(), expires_at: "2027-02-01T00:00:00+08:00" }), true);
  assert.equal(ui.stepUpIncomplete({ method: "totp", code: "" }), true);
  // Each fixed code maps to its own localized label; the code itself is never rendered.
  const refusalKeys = new Set();
  for (const code of ["rotation_owner_required", "step_up_invalid", "origin_required", "cross_origin_rejected",
    "step_up_rate_limited", "credential_rotation_state_conflict", "credential_rotation_unavailable",
    "credential_rotation_request_conflict", "credential_maintenance_revision_conflict",
    "credential_rotation_operation_not_found"]) {
    assert.equal(ui.rotationErrorCode(new Error(code)), code, `${code} is a fixed code`);
    assert.equal(ui.outcomeErrorKey({ kind: "unavailable", code }), `reason.${code}`, `${code} maps to its own label`);
    refusalKeys.add(ui.outcomeErrorKey({ kind: "unavailable", code }));
  }
  assert.equal(refusalKeys.size, 10, "no two fixed codes share a label");
  for (const language of ["zh", "en"]) {
    for (const key of refusalKeys) {
      assert.notEqual(ui.translate(language, key), ui.translate(language, "reason.unknown"),
        `${key}/${language}: carries its own copy`);
    }
  }
  for (const message of ["provider said no", "Internal Server Error", "", null, undefined]) {
    assert.equal(ui.rotationErrorCode(message ? new Error(message) : message), null, `${message} is not a fixed code`);
  }

  /* only the documented metadata reaches the panel */
  const actions = ui.rotationActions(envelope({ operation: operation("staged", ["finalize", "cancel"]), allowed_actions: [] }), false);
  assert.deepEqual(actions, {
    stage: false, finalize: true, cancel: true, unknown: false, showStageForm: false, showStepUp: true,
  });
  assert.equal(ui.rotationActions(envelope({ allowed_actions: [] }), false).stage, false, "a reader sees no stage form");
  for (const state of ["add_unknown", "finalize_unknown", "cancel_unknown"]) {
    const gated = ui.rotationActions(envelope({ operation: operation(state, ["finalize", "cancel"]), allowed_actions: ["stage"] }), false);
    assert.equal(gated.unknown, true);
    assert.equal(gated.stage || gated.finalize || gated.cancel, false, `${state} offers no write`);
  }

  /* ---------- 5b. Audit keeps rotation ids beside the legacy id/ref branch ---------- */

  const auditPayload = events => ({
    schema_version: "qsl.audit_events.v1",
    server_time: "2026-11-02T10:00:00Z",
    data_status: "ready",
    events,
    next_cursor: null,
    coverage: "durable_human_decisions_and_application_records_and_bounded_audit_log",
    policy: {
      no_order: true, execution_authority_granted: false, current_evidence_required: true,
      human_confirmation_required: true, notice: "只记录人工决定意图；不会下单、变更资金或启用实盘。",
    },
    errors: [],
  });
  const realFetchAudit = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(auditPayload([
    {
      event_id: "rotation-event-synthetic-1", occurred_at: "2026-11-02T09:56:00Z", actor_alias: "owner",
      action: "credential_rotation_stage", subject: { kind: "credential", id: "ibkr_flex" },
      operation_id: "op-synthetic-1", outcome: "staged",
    },
    {
      event_id: "rotation-event-synthetic-2", occurred_at: "2026-11-02T09:57:00Z", actor_alias: null,
      action: "credential_rotation_denied", subject: { kind: "credential", id: "ibkr_flex" },
      operation_id: null, outcome: "denied",
    },
    {
      id: "legacy-event-1", source: "bounded_audit_log", occurred_at: "2026-11-02T09:58:00Z",
      action: "switch_applied", actor_alias: "owner", subject: { kind: "runtime_target", id: "t-1" },
      revision: null, outcome: null, ref: "/api/operations/op-synthetic-2",
    },
  ]));
  let audited;
  try {
    audited = (await ui.loadAuditEvents()).data;
  } finally {
    globalThis.fetch = realFetchAudit;
  }
  assert.equal(audited[0].event_id, "rotation-event-synthetic-1", "a rotation event keeps its own opaque id");
  assert.equal(audited[0].operation_id, "op-synthetic-1", "a rotation event keeps its operation id");
  assert.equal(audited[0].subject.kind, "credential", "the credential subject kind survives");
  assert.equal(audited[1].operation_id, null, "a denial may carry no operation id");
  assert.equal(audited[2].event_id, "legacy-event-1", "the legacy id branch still resolves");
  assert.equal(audited[2].operation_id, "op-synthetic-2", "the legacy ref branch still resolves");
  for (const language of ["zh", "en"]) {
    for (const action of ["credential_rotation_stage", "credential_rotation_finalize",
      "credential_rotation_cancel", "credential_rotation_denied"]) {
      assert.notEqual(ui.translate(language, `cockpit.change_log.action.${action}`),
        ui.translate(language, "cockpit.change_log.action.other"), `${action}/${language}: carries its own label`);
    }
    for (const outcome of ["staged", "finalized", "canceled", "add_unknown", "finalize_unknown", "cancel_unknown", "denied"]) {
      assert.notEqual(ui.translate(language, `cockpit.change_log.outcome.${outcome}`),
        ui.translate(language, "cockpit.change_log.outcome.unknown"), `outcome ${outcome}/${language}: carries its own label`);
    }
    assert.notEqual(ui.translate(language, "cockpit.change_log.subject_kind.credential"),
      ui.translate(language, "cockpit.change_log.subject_kind.other"), `credential subject/${language}: carries its own label`);
  }

  /* ---------- 6. Flat-design rules ---------- */

  const appCss = await readFile(join(root, "src/app/app.css"), "utf8");
  const tokensCss = await readFile(join(root, "src/app/tokens.css"), "utf8");
  const healthCss = await readFile(join(root, "src/pages/health/health.css"), "utf8");
  const darkAt = tokensCss.indexOf(':root[data-theme="dark"]');
  const light = tokensCss.slice(0, darkAt);
  const dark = tokensCss.slice(darkAt, tokensCss.indexOf("/* Up/down"));
  const tokens = ["--surface-0", "--surface-1", "--surface-2", "--text-primary", "--text-secondary", "--text-muted",
    "--border:", "--border-strong", "--border-stronger", "--danger", "--danger-tint", "--success", "--success-tint",
    "--warning", "--warning-tint", "--accent"];
  for (const token of tokens) {
    assert.ok(light.includes(token), `light theme declares ${token}`);
    assert.ok(dark.includes(token), `dark theme declares ${token}`);
  }
  assert.match(tokensCss, /--radius: 8px;/, "--radius is 8px");
  assert.match(tokensCss, /--radius-card: 12px;/, "--radius-card is 12px");
  assert.match(tokensCss, /--pad-card: 1rem 1\.25rem;/, "the card padding token resolves to 1rem 1.25rem");
  assert.match(tokensCss, /--font-sans:/, "the sans stack is a token");
  assert.match(tokensCss, /--font-mono:/, "the mono stack is a token");
  assert.match(appCss, /font-family: var\(--font-sans\)/, "the base type uses the token");

  const inputRule = appCss.slice(appCss.indexOf(".input, select.input, textarea.input {"), appCss.indexOf("}", appCss.indexOf(".input, select.input, textarea.input {")));
  assert.match(inputRule, /min-height: 36px;/, "the shared input base is 36px");
  assert.match(inputRule, /border: 0\.5px solid var\(--border-strong\)/, "the shared input base uses a hairline border token");
  assert.match(appCss, /\.input:disabled/, "the shared input base has a disabled state");
  assert.match(appCss, /\.input:focus \{ outline: 2px solid var\(--focus-ring\)/, "focus uses the focus-ring token");
  assert.doesNotMatch(inputRule, /#(?:[0-9a-fA-F]{3,8})/, "the input base carries no literal colour");

  const rotationBlock = healthCss.slice(healthCss.indexOf("/* ---------- Credential rotation panel"));
  assert.ok(rotationBlock.length > 200, "the rotation styles exist");
  // Comments name the rules they follow; only declarations are scanned for violations.
  const rotationRules = rotationBlock.slice(rotationBlock.indexOf("*/") + 2).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(rotationRules, /grid-template-columns: repeat\(auto-fit, minmax\(160px, 1fr\)\)/, "the metadata grid is the mandated auto-fit grid");
  assert.match(rotationRules, /0\.5px solid var\(--border\)/, "the panel uses hairline border tokens");
  assert.match(rotationRules, /var\(--radius\)|var\(--radius-card\)/, "the panel uses radius tokens");
  assert.match(rotationRules, /min-height: 44px/, "the panel touch targets stay at 44px");
  assert.doesNotMatch(rotationRules, /#(?:[0-9a-fA-F]{3,8})|\brgba?\(/, "the panel uses no literal colour");
  assert.doesNotMatch(rotationRules, /box-shadow|gradient|filter:|text-shadow/, "the panel is flat");
  assert.doesNotMatch(rotationRules, /border: 1px|border-width: 1px/, "the panel keeps hairline borders");
  assert.match(rotationRules, /@media \(max-width: 600px\)[\s\S]*grid-template-columns: 1fr/, "narrow screens collapse to one column");

  // The prose that explains stage, cancel and unknown outcomes stays outside the
  // metadata and form blocks, as sibling card notes.
  const panelSource = await readFile(join(root, "src/pages/health/CredentialRotationPanel.tsx"), "utf8");
  const noteKeys = ["health.rotation.stage_note", "health.rotation.cancel_note", "health.rotation.unknown_note", "health.rotation.write_only_note"];
  for (const key of noteKeys) {
    const line = panelSource.split("\n")
      .find(entry => entry.includes(`"${key}"`) && entry.includes("card-note")) ?? "";
    assert.ok(line.length > 0, `${key} renders as prose outside the visual panel`);
    assert.doesNotMatch(line, /Badge|rotation-state/, `${key} does not sit inside a visual component`);
  }

  console.log("console_credential_rotation_ui_validation: PASS");
} finally {
  await rm(directory, { recursive: true, force: true });
}
