import {
  UX1_DRAFT_SCHEMA,
  UX1_EVIDENCE_HASH_KEYS,
  UX1_STUDY,
  Ux1InputError,
  assertUx1DraftPost,
  assertUx1IntentPost,
  assertUx1PreviewPost,
  buildUx1PreviewRequest,
  canonicalJson,
  classifyUx1Draft,
  defaultUx1Draft,
  localUx1Preview,
  normalizeUx1Draft,
  projectUx1CalculatorResult,
  ux1CustomDraft,
  ux1Fingerprint,
  ux1IntentAllowed,
  ux1IntentRecord,
  ux1ReceiptId,
} from "../../ux1_research_contract.js";
import { HttpError } from "../http_error.js";
import { json } from "../http_response.js";
import { requireSameOrigin } from "../http_request.js";
import { githubHeaders } from "../auth/github.js";
import { readSession } from "../auth/session.js";
import { hasRuntimeInstanceStore, runtimeInstanceCommand } from "../runtime_instances/command.js";
import {
  UX1_CALCULATOR_DEADLINE_MS,
  UX1_CALCULATOR_MAX_BYTES,
  UX1_RESEARCH_REPOSITORY,
  UX1_RESEARCH_WORKFLOW_FILE,
  UX1_RESEARCH_WORKFLOW_PATH,
  UX1_JOB_BODY_MAX_BYTES,
  UX1_GITHUB_DEADLINE_MS,
  UX1_GITHUB_MAX_BYTES,
  UX1_JOB_UNKNOWN_AFTER_MS,
  UX1_PUBLIC_JOB_REASONS,
} from "./constants.js";

let ux1ModuleEpoch = "";

export function ux1RuntimeEpoch(env) {
  const configured = env?.UX1_RUNTIME_EPOCH;
  if (typeof configured === "string" && /^[a-f0-9]{32}$/.test(configured)) return configured;
  if (!ux1ModuleEpoch) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    ux1ModuleEpoch = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return ux1ModuleEpoch;
}

function ux1PreviewMatchesEpoch(preview, env) {
  return Boolean(preview && preview.runtime_epoch === ux1RuntimeEpoch(env));
}

function ux1ExpectedEvidenceMatches(preview, env) {
  if (!preview.evidence) return !["computed", "no_advantage", "no_action"].includes(preview.status);
  if (!env.UX1_EXPECTED_EVIDENCE_HASHES) return true;
  let expected;
  try { expected = JSON.parse(env.UX1_EXPECTED_EVIDENCE_HASHES); } catch { return false; }
  return expected && typeof expected === "object" && !Array.isArray(expected)
    && Object.keys(expected).length === UX1_EVIDENCE_HASH_KEYS.length
    && UX1_EVIDENCE_HASH_KEYS.every((key) => /^[a-f0-9]{64}$/.test(expected[key]) && preview.evidence[key] === expected[key]);
}

export function ux1PreviewBindingStale(preview, env) {
  if (!preview) return false;
  if (!ux1PreviewMatchesEpoch(preview, env)) return true;
  if (!preview.evidence || !env?.UX1_EXPECTED_EVIDENCE_HASHES) return false;
  return !ux1ExpectedEvidenceMatches(preview, env);
}

export function presentUx1Preview(preview, env) {
  if (!preview) return null;
  if (!ux1PreviewBindingStale(preview, env)) return preview;
  return {
    ...preview,
    status: "stale",
    stale: true,
    actionable: false,
    recompute_required: true,
  };
}

function ux1Flags() {
  return {
    schema_version: UX1_DRAFT_SCHEMA,
    study: UX1_STUDY,
    account_connection: "native_not_observed",
    native_observed: false,
    credential_access_unavailable: true,
    research_only: true,
    no_order: true,
    execution_authority_granted: false,
    workflow_dispatched: false,
    runtime_mutated: false,
    d1_native: "NATIVE_PENDING_EXTERNAL",
    d1_status: "PARTIAL",
  };
}

function ux1StatePayload(env, { revision, fingerprint, draft, preview, intent, job = null, duplicate = false, unchanged = false }) {
  const publicJob = projectUx1Job(job, Date.now(), revision, env);
  const waiting = Boolean(publicJob && ["queued", "running", "unknown"].includes(publicJob.status));
  let shown = waiting ? null : presentUx1Preview(preview, env);
  if (shown && ux1TerminalJobConfigStale(job, env)) {
    shown = { ...shown, status: "stale", stale: true, actionable: false, recompute_required: true };
  }
  return {
    ok: true,
    ...ux1Flags(),
    research_workflow_dispatched: job?.dispatch_state === "dispatched",
    revision,
    fingerprint,
    custom_draft: ux1CustomDraft(draft),
    draft,
    preview: shown,
    preview_stale: Boolean(shown?.stale),
    intent: waiting ? null : intent,
    job: publicJob,
    duplicate,
    unchanged,
  };
}

export async function requireUx1Session(request, env) {
  const session = await readSession(request, env);
  if (!session) throw new HttpError("login required", 401);
  if (!session.allowed) throw new HttpError("allowlist required", 403);
  return session;
}

async function readUx1Body(request) {
  const text = await request.text();
  if (text.length > 16384) throw new Ux1InputError("ux1_body_too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Ux1InputError("ux1_invalid_json");
  }
}

function parseUx1Slot(result) {
  if (!result?.found) return null;
  return {
    revision: result.revision,
    fingerprint: result.fingerprint,
    draft: JSON.parse(result.draft_json),
    preview: result.preview_json ? JSON.parse(result.preview_json) : null,
    intent: result.intent_json ? JSON.parse(result.intent_json) : null,
    job: result.job_json ? JSON.parse(result.job_json) : null,
  };
}

async function ux1ReadSlot(env, login) {
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("ux1_research_store_not_bound", 503);
  return parseUx1Slot(await runtimeInstanceCommand(env, { action: "ux1_read", login }));
}

export async function ux1DraftGet(request, env) {
  const session = await requireUx1Session(request, env);
  const slot = await ux1ReadSlot(env, session.login);
  if (!slot) {
    const draft = defaultUx1Draft();
    return json(ux1StatePayload(env, { revision: 0, fingerprint: await ux1Fingerprint(draft), draft, preview: null, intent: null }));
  }
  return json(ux1StatePayload(env, slot));
}

export async function ux1DraftPost(request, env) {
  requireSameOrigin(request, { requireOrigin: true });
  const session = await requireUx1Session(request, env);
  const parsed = assertUx1DraftPost(await readUx1Body(request));
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("ux1_research_store_not_bound", 503);
  const saved = await runtimeInstanceCommand(env, {
    action: "ux1_save",
    login: session.login,
    expected_revision: parsed.expected_revision,
    draft_json: canonicalJson(parsed.draft),
    fingerprint: await ux1Fingerprint(parsed.draft),
  });
  return json(ux1StatePayload(env, { ...parseUx1Slot({ ...saved, found: true }), unchanged: Boolean(saved.unchanged) }));
}

function ux1AbortError() {
  return new DOMException("The operation was aborted", "AbortError");
}

function abandonUx1Reader(reader) {
  if (!reader) return;
  try {
    const canceling = reader.cancel();
    if (canceling && typeof canceling.catch === "function") canceling.catch(() => {});
  } catch {
    /* cancel failed before returning a promise */
  }
}

function abandonUx1Response(response) {
  if (!response?.body) return;
  try {
    abandonUx1Reader(response.body.getReader());
  } catch {
    /* body already locked or disturbed */
  }
}

async function readLimitedUtf8Body(response, maxBytes, controller, abortPromise) {
  if (!response?.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  const stopReader = () => {
    if (!controller.signal.aborted) controller.abort();
    abandonUx1Reader(reader);
  };
  const onAbort = () => { abandonUx1Reader(reader); };
  controller.signal.addEventListener("abort", onAbort);
  try {
    while (true) {
      if (controller.signal.aborted) throw ux1AbortError();
      const readPromise = reader.read();
      readPromise.catch(() => {});
      const next = await Promise.race([readPromise, abortPromise]);
      if (next.done) break;
      const bytes = next.value?.byteLength ?? 0;
      received += bytes;
      if (received > maxBytes) {
        stopReader();
        throw new Error("ux1_calculator_body_limit");
      }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    stopReader();
    throw error;
  } finally {
    controller.signal.removeEventListener("abort", onAbort);
  }
}

export async function readUx1CalculatorExchange(binding, body, limits) {
  const deadlineMs = Number.isFinite(limits?.deadlineMs) ? limits.deadlineMs : UX1_CALCULATOR_DEADLINE_MS;
  const maxBytes = Number.isFinite(limits?.maxBytes) ? limits.maxBytes : UX1_CALCULATOR_MAX_BYTES;
  const controller = new AbortController();
  let rejectAbort = () => {};
  const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
  abortPromise.catch(() => {});
  const onAbort = () => rejectAbort(ux1AbortError());
  controller.signal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const pending = Promise.resolve().then(() => binding.fetch("https://ux1-research-calculator/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: controller.signal,
  }));
  let accepted = false;
  pending.then((response) => {
    if (accepted || !controller.signal.aborted) return;
    abandonUx1Response(response);
  }, () => {});
  try {
    const response = await Promise.race([pending, abortPromise]);
    accepted = true;
    const text = await readLimitedUtf8Body(response, maxBytes, controller, abortPromise);
    return { status: response.status, ok: response.ok, text };
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

async function ux1ClearStoredPreview(env, login, slot) {
  await runtimeInstanceCommand(env, {
    action: "ux1_clear_preview", login,
    expected_revision: slot.revision,
    fingerprint: slot.fingerprint,
  });
}

export async function ux1PreviewPost(request, env) {
  requireSameOrigin(request, { requireOrigin: true });
  const session = await requireUx1Session(request, env);
  const parsed = assertUx1PreviewPost(await readUx1Body(request));
  const slot = await ux1ReadSlot(env, session.login);
  if (!slot || slot.revision !== parsed.expected_revision) throw new HttpError("ux1_preview_conflict", 409);
  const draft = normalizeUx1Draft(slot.draft);
  const fingerprint = await ux1Fingerprint(draft);
  if (fingerprint !== slot.fingerprint) throw new HttpError("ux1_preview_conflict", 409);
  if (ux1StoredJobBlocks(slot.job)) return json(ux1StatePayload(env, slot));
  const previewMode = ux1PreviewMode(env);
  if (previewMode === "rejected") throw new HttpError("ux1_preview_mode_rejected", 400);
  const gate = classifyUx1Draft(draft);
  let preview;
  if (gate.kind === "missing_input" || gate.kind === "unsupported_scope") {
    preview = localUx1Preview({ draft, fingerprint, status: gate.kind, reasons: gate.reasons });
  } else if (previewMode === "github_actions") {
    return await ux1DispatchPreview(env, session, slot, draft, fingerprint);
  } else {
    const binding = env.UX1_RESEARCH_CALCULATOR;
    if (!binding || typeof binding.fetch !== "function") {
      await ux1ClearStoredPreview(env, session.login, slot);
      return json({
        ok: false,
        error: "calculator_not_connected",
        status: "calculator_not_connected",
        recompute_required: true,
        ...ux1Flags(),
        revision: slot.revision,
        fingerprint,
        custom_draft: ux1CustomDraft(draft),
        draft,
        preview: null,
        decision_preview: null,
        historical_execution_check: null,
      }, 503);
    }
    const calculatorRequest = buildUx1PreviewRequest(draft);
    let exchange;
    try {
      exchange = await readUx1CalculatorExchange(binding, canonicalJson(calculatorRequest));
    } catch {
      await ux1ClearStoredPreview(env, session.login, slot);
      throw new HttpError("calculator_failed", 502);
    }
    const calculatorText = exchange.text;
    if (exchange.status === 429) {
      let busy = false;
      try { busy = JSON.parse(calculatorText).error === "calculator_busy"; } catch { busy = false; }
      if (busy) throw new HttpError("calculator_busy", 429);
    }
    if (!exchange.ok) {
      await ux1ClearStoredPreview(env, session.login, slot);
      throw new HttpError("calculator_failed", 502);
    }
    let raw;
    try {
      raw = JSON.parse(calculatorText);
    } catch {
      await ux1ClearStoredPreview(env, session.login, slot);
      throw new HttpError("calculator_failed", 502);
    }
    try {
      preview = projectUx1CalculatorResult(raw, calculatorRequest, draft, fingerprint);
      if (!ux1ExpectedEvidenceMatches(preview, env)) throw new Ux1InputError("calculator_result_rejected", 502);
    } catch (error) {
      await ux1ClearStoredPreview(env, session.login, slot);
      if (error instanceof Ux1InputError) throw new HttpError(error.message, error.status || 502);
      throw new HttpError("calculator_result_rejected", 502);
    }
  }
  preview = { ...preview, runtime_epoch: ux1RuntimeEpoch(env) };
  const stored = await runtimeInstanceCommand(env, {
    action: "ux1_store_preview",
    login: session.login,
    expected_revision: slot.revision,
    fingerprint,
    preview_json: canonicalJson(preview),
  });
  return json(ux1StatePayload(env, parseUx1Slot({ ...stored, found: true })));
}

export async function ux1IntentPost(request, env) {
  requireSameOrigin(request, { requireOrigin: true });
  const session = await requireUx1Session(request, env);
  const parsed = assertUx1IntentPost(await readUx1Body(request));
  const slot = await ux1ReadSlot(env, session.login);
  if (!slot || slot.revision !== parsed.expected_revision || slot.fingerprint !== parsed.fingerprint) {
    throw new HttpError("ux1_intent_conflict", 409);
  }
  if (ux1StoredJobBlocks(slot.job)) throw new HttpError("ux1_job_active", 409);
  if (ux1PreviewBindingStale(slot.preview, env) || ux1TerminalJobConfigStale(slot.job, env)) throw new HttpError("ux1_preview_stale", 409);
  if (!ux1IntentAllowed(slot.preview) || slot.preview.fingerprint !== parsed.fingerprint) {
    throw new HttpError("ux1_intent_conflict", 409);
  }
  const intent = ux1IntentRecord({
    login: session.login,
    revision: slot.revision,
    fingerprint: slot.fingerprint,
    receiptId: await ux1ReceiptId(session.login, slot.revision, slot.fingerprint),
  });
  const stored = await runtimeInstanceCommand(env, {
    action: "ux1_save_intent",
    login: session.login,
    expected_revision: slot.revision,
    fingerprint: slot.fingerprint,
    intent_json: canonicalJson(intent),
  });
  return json(ux1StatePayload(env, { ...parseUx1Slot({ ...stored, found: true }), duplicate: Boolean(stored.duplicate) }));
}

function ux1PreviewMode(env) {
  const mode = String(env?.UX1_PREVIEW_MODE ?? "").trim();
  if (!mode) return "local";
  if (mode === "github_actions") return "github_actions";
  return "rejected";
}

function ux1EvidenceRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).length !== UX1_EVIDENCE_HASH_KEYS.length) return null;
  const evidence = {};
  for (const key of UX1_EVIDENCE_HASH_KEYS) {
    if (typeof value[key] !== "string" || !/^[a-f0-9]{64}$/.test(value[key])) return null;
    evidence[key] = value[key];
  }
  return evidence;
}

function ux1AsyncConfig(env) {
  const ues = String(env?.UX1_UES_REVISION || "");
  const epoch = String(env?.UX1_RUNTIME_EPOCH || "");
  const token = String(env?.UX1_RESEARCH_JOB_TOKEN || "");
  if (!/^[a-f0-9]{40}$/.test(ues) || !/^[a-f0-9]{32}$/.test(epoch) || token.length < 16 || token.length > 256) return null;
  return ux1EvidenceRecord(ux1ParseJsonObject(env?.UX1_EXPECTED_EVIDENCE_HASHES))
    ? { ues, epoch, evidence: ux1EvidenceRecord(ux1ParseJsonObject(env.UX1_EXPECTED_EVIDENCE_HASHES)) }
    : null;
}

function ux1ParseJsonObject(text) {
  if (typeof text !== "string" || !text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function ux1StoredJobBlocks(job) {
  return Boolean(job && (job.status === "queued" || job.status === "running" || job.status === "unknown"));
}

function ux1PublicJobReason(reason) {
  return UX1_PUBLIC_JOB_REASONS.has(reason) ? reason : null;
}

function ux1JobConfigStale(job, env) {
  const config = ux1AsyncConfig(env);
  if (!config || !job) return false;
  if (job.runtime_epoch !== config.epoch || job.ues_revision !== config.ues) return true;
  return UX1_EVIDENCE_HASH_KEYS.some((key) => job.evidence?.[key] !== config.evidence[key]);
}

function ux1TerminalJobConfigStale(job, env) {
  return Boolean(job && !ux1StoredJobBlocks(job) && ux1JobConfigStale(job, env));
}

function ux1JobBindingMatchesConfig(job, env) {
  return Boolean(job && ux1AsyncConfig(env) && !ux1JobConfigStale(job, env));
}

export function projectUx1Job(job, now, slotRevision, env) {
  if (!job || typeof job !== "object") return null;
  const created = Date.parse(job.created_at);
  const age = Number.isFinite(created) ? now - created : 0;
  let status = job.status;
  let reason = job.reason || null;
  if (ux1StoredJobBlocks(job) && age >= UX1_JOB_UNKNOWN_AFTER_MS) {
    status = "unknown";
    reason = "check_required";
  } else if (!ux1StoredJobBlocks(job) && (job.revision !== slotRevision || ux1JobConfigStale(job, env))) {
    status = "superseded";
    reason = "config_changed";
  }
  return {
    request_id: job.request_id,
    status,
    dispatch_state: job.dispatch_state,
    created_at: job.created_at,
    updated_at: job.updated_at,
    reason: ux1PublicJobReason(reason),
  };
}

function ux1BearerMatches(header, secret) {
  const match = /^Bearer ([!-~]{16,256})$/.exec(String(header || ""));
  if (!match || typeof secret !== "string" || secret.length < 16 || secret.length > 256) return false;
  const left = new TextEncoder().encode(match[1]);
  const right = new TextEncoder().encode(secret);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) diff |= (left[index] || 0) ^ (right[index] || 0);
  return diff === 0;
}

function ux1ExactKeys(value, keys) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key)));
}

function ux1RequestIdOk(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function ux1PositiveInt(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value);
}

async function ux1Digest(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readUx1LimitedJson(request, maxBytes) {
  const controller = new AbortController();
  let rejectAbort = () => {};
  const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
  abortPromise.catch(() => {});
  const onAbort = () => rejectAbort(ux1AbortError());
  controller.signal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(), UX1_GITHUB_DEADLINE_MS);
  try {
    const text = await readLimitedUtf8Body(request, maxBytes, controller, abortPromise);
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError("ux1_invalid_body", 400);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (String(error?.message || "") === "ux1_calculator_body_limit") throw new HttpError("ux1_body_too_large", 400);
    throw new HttpError("ux1_invalid_body", 400);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

async function ux1GithubExchange(url, init) {
  const controller = new AbortController();
  let rejectAbort = () => {};
  const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
  abortPromise.catch(() => {});
  const onAbort = () => rejectAbort(ux1AbortError());
  controller.signal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(), UX1_GITHUB_DEADLINE_MS);
  const pending = Promise.resolve().then(() => fetch(url, { ...init, redirect: "manual", signal: controller.signal }));
  let accepted = false;
  pending.then((response) => {
    if (accepted || !controller.signal.aborted) return;
    abandonUx1Response(response);
  }, () => {});
  try {
    const response = await Promise.race([pending, abortPromise]);
    accepted = true;
    const text = await readLimitedUtf8Body(response, UX1_GITHUB_MAX_BYTES, controller, abortPromise);
    return { status: response.status, ok: response.ok, text };
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

async function ux1DispatchResearchJob(env, requestId) {
  if (!env.RUNTIME_SETTINGS_DISPATCH_TOKEN) return "unknown";
  try {
    const exchange = await ux1GithubExchange(
      `https://api.github.com/repos/${UX1_RESEARCH_REPOSITORY}/actions/workflows/${UX1_RESEARCH_WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: githubHeaders(env.RUNTIME_SETTINGS_DISPATCH_TOKEN),
        body: JSON.stringify({ ref: "main", inputs: { ux1_request_id: requestId } }),
      },
    );
    if (exchange.status >= 200 && exchange.status < 300) return "dispatched";
    if (exchange.status >= 400 && exchange.status < 500) return "rejected";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function ux1DispatchPreview(env, session, slot, draft, fingerprint) {
  const config = ux1AsyncConfig(env);
  if (!config || !env.RUNTIME_SETTINGS_DISPATCH_TOKEN) {
    await ux1ClearStoredPreview(env, session.login, slot);
    return json({
      ok: false,
      error: "ux1_async_not_connected",
      status: "ux1_async_not_connected",
      recompute_required: true,
      ...ux1Flags(),
      research_workflow_dispatched: false,
      revision: slot.revision,
      fingerprint,
      custom_draft: ux1CustomDraft(draft),
      draft,
      preview: null,
      job: projectUx1Job(slot.job, Date.now(), slot.revision, env),
      decision_preview: null,
      historical_execution_check: null,
    }, 503);
  }
  const begun = await runtimeInstanceCommand(env, {
    action: "ux1_begin_job",
    login: session.login,
    revision: slot.revision,
    fingerprint,
    epoch: config.epoch,
    ues: config.ues,
    evidence: config.evidence,
    request: buildUx1PreviewRequest(draft),
  });
  const job = JSON.parse(begun.job_json);
  if (begun.created) {
    const outcome = await ux1DispatchResearchJob(env, job.request_id);
    await runtimeInstanceCommand(env, {
      action: "ux1_record_dispatch",
      login: session.login,
      request_id: job.request_id,
      outcome,
    });
  }
  return json(ux1StatePayload(env, await ux1ReadSlot(env, session.login)));
}

export function ux1RunMatches(run, job, runId, runAttempt) {
  if (!run || typeof run !== "object" || Array.isArray(run) || !job) return false;
  const repository = run.repository;
  const headRepository = run.head_repository;
  if (!repository || typeof repository !== "object" || !headRepository || typeof headRepository !== "object") return false;
  return String(run.id) === runId
    && run.event === "workflow_dispatch"
    && run.path === UX1_RESEARCH_WORKFLOW_PATH
    && run.head_sha === job.ues_revision
    && run.display_title === `UX1 preview ${job.request_id}`
    && String(run.run_attempt) === runAttempt
    && run.head_branch === "main"
    && repository.full_name === UX1_RESEARCH_REPOSITORY
    && headRepository.full_name === UX1_RESEARCH_REPOSITORY
    && repository.fork !== true
    && headRepository.fork !== true;
}

async function ux1FetchRun(env, runId) {
  let exchange;
  try {
    exchange = await ux1GithubExchange(
      `https://api.github.com/repos/${UX1_RESEARCH_REPOSITORY}/actions/runs/${runId}`,
      { method: "GET", headers: githubHeaders(env.RUNTIME_SETTINGS_DISPATCH_TOKEN) },
    );
  } catch {
    throw new HttpError("ux1_run_unverified", 502);
  }
  if (!exchange.ok) throw new HttpError("ux1_run_unverified", 502);
  try {
    return JSON.parse(exchange.text);
  } catch {
    throw new HttpError("ux1_run_unverified", 502);
  }
}

function ux1ClaimDenied(requestId, runId, runAttempt) {
  return json({ ok: true, claimed: false, request_id: requestId, run_id: runId, run_attempt: runAttempt });
}

export async function ux1JobClaimPost(request, env) {
  if (!ux1BearerMatches(request.headers.get("Authorization"), env.UX1_RESEARCH_JOB_TOKEN)) {
    throw new HttpError("ux1_job_unauthorized", 401);
  }
  const body = await readUx1LimitedJson(request, UX1_JOB_BODY_MAX_BYTES);
  if (!ux1ExactKeys(body, ["request_id", "run_id", "run_attempt"]) || !ux1RequestIdOk(body.request_id) || !ux1PositiveInt(body.run_id) || !ux1PositiveInt(body.run_attempt)) {
    throw new HttpError("ux1_invalid_body", 400);
  }
  const looked = await runtimeInstanceCommand(env, { action: "ux1_lookup_job", request_id: body.request_id });
  if (!looked.found) throw new HttpError("ux1_job_not_found", 404);
  const job = JSON.parse(looked.job_json);
  if (job.claimed_run_id || (job.status !== "queued" && job.status !== "unknown")) {
    return ux1ClaimDenied(body.request_id, body.run_id, body.run_attempt);
  }
  const draft = {
    objective: job.request?.objective,
    research_case_id: job.request?.research_case_id,
    advanced_settings: job.request?.advanced_settings,
  };
  try {
    if (!job.request || canonicalJson(buildUx1PreviewRequest(draft)) !== canonicalJson(job.request) || await ux1Fingerprint(draft) !== job.fingerprint) {
      throw new HttpError("ux1_run_unverified", 502);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError("ux1_run_unverified", 502);
  }
  const run = await ux1FetchRun(env, body.run_id);
  if (!ux1RunMatches(run, job, body.run_id, body.run_attempt)) throw new HttpError("ux1_run_unverified", 502);
  const claimed = await runtimeInstanceCommand(env, {
    action: "ux1_claim_job",
    request_id: body.request_id,
    run_id: body.run_id,
    run_attempt: body.run_attempt,
  });
  if (!claimed.claimed) return ux1ClaimDenied(body.request_id, body.run_id, body.run_attempt);
  return json({
    ok: true,
    claimed: true,
    request_id: body.request_id,
    run_id: body.run_id,
    run_attempt: body.run_attempt,
    request: claimed.request,
  });
}

export async function ux1JobResultPost(request, env) {
  if (!ux1BearerMatches(request.headers.get("Authorization"), env.UX1_RESEARCH_JOB_TOKEN)) {
    throw new HttpError("ux1_job_unauthorized", 401);
  }
  const body = await readUx1LimitedJson(request, UX1_JOB_BODY_MAX_BYTES);
  if (!ux1ExactKeys(body, ["request_id", "run_id", "run_attempt", "result", "error_code"]) || !ux1RequestIdOk(body.request_id) || !ux1PositiveInt(body.run_id) || !ux1PositiveInt(body.run_attempt)) {
    throw new HttpError("ux1_invalid_body", 400);
  }
  if (!(body.error_code === null || body.error_code === "input_unavailable" || body.error_code === "calculator_failed")) {
    throw new HttpError("ux1_invalid_body", 400);
  }
  if (body.error_code === null ? body.result === null : body.result !== null) throw new HttpError("ux1_invalid_body", 400);
  const looked = await runtimeInstanceCommand(env, { action: "ux1_lookup_job", request_id: body.request_id });
  if (!looked.found) throw new HttpError("ux1_job_not_found", 404);
  const job = JSON.parse(looked.job_json);
  if (job.claimed_run_id !== body.run_id || job.claimed_run_attempt !== body.run_attempt) {
    throw new HttpError("ux1_result_conflict", 409);
  }
  let previewJson = null;
  if (!body.error_code) {
    const draft = {
      objective: job.request?.objective,
      research_case_id: job.request?.research_case_id,
      advanced_settings: job.request?.advanced_settings,
    };
    try {
      if (canonicalJson(buildUx1PreviewRequest(draft)) !== canonicalJson(job.request)) throw new Ux1InputError("calculator_result_rejected", 502);
      const preview = projectUx1CalculatorResult(body.result, job.request, draft, job.fingerprint);
      const evidence = { evidence: Object.fromEntries(UX1_EVIDENCE_HASH_KEYS.map((key) => [key, preview.evidence?.[key]])) };
      if (!preview.evidence || !ux1ExpectedEvidenceMatches(evidence, { UX1_EXPECTED_EVIDENCE_HASHES: JSON.stringify(job.evidence) })) {
        throw new Ux1InputError("calculator_result_rejected", 502);
      }
      if (ux1JobBindingMatchesConfig(job, env)) previewJson = canonicalJson({ ...preview, runtime_epoch: job.runtime_epoch });
    } catch (error) {
      if (error instanceof Ux1InputError && error.message === "calculator_failed") throw new HttpError("calculator_failed", 502);
      throw new HttpError("calculator_result_rejected", 502);
    }
  }
  const finished = await runtimeInstanceCommand(env, {
    action: "ux1_finish_job",
    request_id: body.request_id,
    run_id: body.run_id,
    run_attempt: body.run_attempt,
    error_code: body.error_code,
    preview_json: previewJson,
    terminal_digest: await ux1Digest({ error_code: body.error_code, result: body.result }),
  });
  return json({ ok: true, accepted: true, duplicate: Boolean(finished.duplicate) });
}

export function ux1SelectSlot(sql, login) {
  return sql.exec(
    "SELECT revision, draft_json, fingerprint, preview_json, intent_json, job_json FROM ux1_research_slot WHERE login = ?",
    login,
  ).toArray()[0] || null;
}

export function ux1SlotPayload(row, extra = {}) {
  return {
    ok: true,
    found: Boolean(row),
    revision: row ? Number(row.revision) : 0,
    draft_json: row?.draft_json || null,
    fingerprint: row?.fingerprint || null,
    preview_json: row?.preview_json || null,
    intent_json: row?.intent_json || null,
    job_json: row?.job_json || null,
    ...extra,
  };
}

function ux1ParseStoredJob(text) {
  if (!text) return null;
  try {
    const job = JSON.parse(text);
    return job && typeof job === "object" && !Array.isArray(job) ? job : null;
  } catch {
    return null;
  }
}

function ux1SelectJob(sql, requestId) {
  return sql.exec(
    `SELECT login, revision, draft_json, fingerprint, preview_json, intent_json, job_json
     FROM ux1_research_slot WHERE json_extract(job_json, '$.request_id') = ?`,
    requestId,
  ).toArray()[0] || null;
}

function ux1WriteJob(sql, login, job) {
  const text = JSON.stringify(job);
  if (text.length > 65536) throw new HttpError("ux1_invalid_body", 400);
  sql.exec("UPDATE ux1_research_slot SET job_json = ? WHERE login = ?", text, login);
  return text;
}

function ux1SameSucceededBinding(job, command, row) {
  const evidence = ux1EvidenceRecord(command.evidence);
  if (!job || job.status !== "succeeded" || !evidence || !row) return false;
  return job.revision === Number(row.revision)
    && job.fingerprint === row.fingerprint
    && job.revision === command.revision
    && job.fingerprint === command.fingerprint
    && job.runtime_epoch === command.epoch
    && job.ues_revision === command.ues
    && UX1_EVIDENCE_HASH_KEYS.every((key) => job.evidence?.[key] === evidence[key]);
}

export function ux1MutateJob(sql, command) {
  if (command.action === "ux1_lookup_job") {
    if (!ux1RequestIdOk(command.request_id)) throw new HttpError("ux1_invalid_body", 400);
    const row = ux1SelectJob(sql, command.request_id);
    return row ? ux1SlotPayload(row) : { ok: true, found: false };
  }
  if (command.action === "ux1_claim_job" || command.action === "ux1_finish_job") {
    if (!ux1RequestIdOk(command.request_id) || !ux1PositiveInt(command.run_id) || !ux1PositiveInt(command.run_attempt)) {
      throw new HttpError("ux1_invalid_body", 400);
    }
    const row = ux1SelectJob(sql, command.request_id);
    if (!row) throw new HttpError("ux1_job_not_found", 404);
    const job = ux1ParseStoredJob(row.job_json);
    if (!job) throw new HttpError("ux1_job_not_found", 404);
    const now = new Date().toISOString();
    if (command.action === "ux1_claim_job") {
      if (job.claimed_run_id || (job.status !== "queued" && job.status !== "unknown")) {
        return { ok: true, claimed: false };
      }
      job.status = "running";
      job.claimed_run_id = command.run_id;
      job.claimed_run_attempt = command.run_attempt;
      job.updated_at = now;
      ux1WriteJob(sql, row.login, job);
      return { ok: true, claimed: true, request: job.request };
    }
    if (job.claimed_run_id !== command.run_id || job.claimed_run_attempt !== command.run_attempt) {
      throw new HttpError("ux1_result_conflict", 409);
    }
    if (job.terminal_digest) {
      if (job.terminal_digest === command.terminal_digest) return { ok: true, duplicate: true };
      throw new HttpError("ux1_result_conflict", 409);
    }
    if (job.status !== "running") throw new HttpError("ux1_result_conflict", 409);
    if (typeof command.terminal_digest !== "string" || !/^[a-f0-9]{64}$/.test(command.terminal_digest)) {
      throw new HttpError("ux1_invalid_body", 400);
    }
    job.status = command.error_code ? "failed" : "succeeded";
    job.reason = command.error_code || null;
    job.terminal_digest = command.terminal_digest;
    job.updated_at = now;
    ux1WriteJob(sql, row.login, job);
    const sameSlot = Number(row.revision) === job.revision && row.fingerprint === job.fingerprint;
    if (command.error_code && sameSlot) {
      sql.exec(
        "UPDATE ux1_research_slot SET preview_json = NULL, intent_json = NULL WHERE login = ? AND revision = ? AND fingerprint = ?",
        row.login, Number(row.revision), row.fingerprint,
      );
    } else if (!command.error_code && sameSlot && typeof command.preview_json === "string" && command.preview_json.length <= 65536) {
      sql.exec(
        "UPDATE ux1_research_slot SET preview_json = ? WHERE login = ? AND revision = ? AND fingerprint = ?",
        command.preview_json, row.login, Number(row.revision), row.fingerprint,
      );
    }
    return { ok: true, duplicate: false };
  }
  const login = String(command?.login || "");
  if (!/^[a-z0-9-]{1,39}$/.test(login)) throw new HttpError("ux1_login_invalid", 400);
  const row = ux1SelectSlot(sql, login);
  if (!row) throw new HttpError("ux1_preview_conflict", 409);
  const job = ux1ParseStoredJob(row.job_json);
  if (command.action === "ux1_begin_job") {
    if (ux1StoredJobBlocks(job)) return { ...ux1SlotPayload(row), created: false };
    if (ux1SameSucceededBinding(job, command, row)) return { ...ux1SlotPayload(row), created: false };
    const evidence = ux1EvidenceRecord(command.evidence);
    if (!evidence || command.revision !== Number(row.revision) || command.fingerprint !== row.fingerprint) {
      throw new HttpError("ux1_preview_conflict", 409);
    }
    if (!/^[a-f0-9]{32}$/.test(String(command.epoch || "")) || !/^[a-f0-9]{40}$/.test(String(command.ues || ""))) {
      throw new HttpError("ux1_invalid_body", 400);
    }
    if (!command.request || command.request.schema !== "qsl.ux1.preview_request.v1" || JSON.stringify(command.request).length > 16384) {
      throw new HttpError("ux1_invalid_body", 400);
    }
    const now = new Date().toISOString();
    const next = {
      request_id: crypto.randomUUID(),
      status: "queued",
      dispatch_state: "pending",
      revision: Number(row.revision),
      fingerprint: row.fingerprint,
      runtime_epoch: command.epoch,
      ues_revision: command.ues,
      evidence,
      request: command.request,
      created_at: now,
      updated_at: now,
      claimed_run_id: null,
      claimed_run_attempt: null,
      reason: null,
      terminal_digest: null,
    };
    const jobJson = ux1WriteJob(sql, login, next);
    sql.exec("UPDATE ux1_research_slot SET preview_json = NULL, intent_json = NULL WHERE login = ?", login);
    return { ...ux1SlotPayload(row), preview_json: null, intent_json: null, job_json: jobJson, created: true };
  }
  if (command.action === "ux1_record_dispatch") {
    if (!job || job.request_id !== command.request_id || job.dispatch_state !== "pending") {
      return { ...ux1SlotPayload(row), recorded: false };
    }
    if (command.outcome === "dispatched") job.dispatch_state = "dispatched";
    else if (command.outcome === "rejected") {
      job.dispatch_state = "rejected";
      if (job.status === "queued") job.status = "failed";
      job.reason = "dispatch_rejected";
    } else {
      job.dispatch_state = "unknown";
      if (job.status === "queued") job.status = "unknown";
      job.reason = "dispatch_unconfirmed";
    }
    job.updated_at = new Date().toISOString();
    const jobJson = ux1WriteJob(sql, login, job);
    return { ...ux1SlotPayload(row), job_json: jobJson, recorded: true };
  }
  throw new HttpError("unsupported_ux1_action", 400);
}
