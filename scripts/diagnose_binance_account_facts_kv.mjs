import {
  normalizeBinanceAccountFacts,
  normalizeBinanceFactsBinding,
  assertBinanceFactsSourceBinding,
  BINANCE_FACTS_KEY,
  BINANCE_FACTS_MAX_BYTES,
} from "../web/strategy-switch-console/binance_account_facts.js";

const BINANCE_REPOSITORY = "QuantStrategyLab/BinancePlatform";
const QRS_REPOSITORY = "QuantStrategyLab/QuantRuntimeSettings";
const WORKFLOW_PATH = ".github/workflows/binance-account-facts.yml";
const WORKFLOW_HEAD_SHA = "66d705fd756f5648f603bfd745235b5ef389f668";
const EXPECTED_RUN_ID = "37039707588";
const JOB_NAME = "read-and-publish";
const STEP_CONCLUSIONS = [
  ["Read the bound Spot and Flexible Earn account quantities", "success"],
  ["Recheck Runtime source before publishing", "success"],
  ["Publish with the isolated account-facts token", "failure"],
  ["Remove this run's private report and account-facts files", "success"],
];
const GITHUB_API = "https://api.github.com";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const API_TIMEOUT_MS = 15_000;
const ACCOUNT_LIST_PAGE_SIZE = 5;
const ACCOUNT_LIST_MAX_BYTES = 64 * 1024;
const SOURCE_REVISION = /^[a-f0-9]{40}$/;
const RUN_ID = /^[1-9][0-9]{0,19}$/;

export class BinanceAccountFactsDiagnosticError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new BinanceAccountFactsDiagnosticError(code);
}

function isoInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) {
    return null;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)
      || new Date(milliseconds).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return milliseconds;
}

async function readGithubJson(path, { token, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(`${GITHUB_API}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    fail("metadata_read_failed");
  }
  if (response.status === 404) fail("metadata_not_found");
  if (!response.ok) fail("metadata_read_failed");
  let text;
  try {
    text = await response.text();
  } catch {
    fail("metadata_read_failed");
  }
  if (Buffer.byteLength(text, "utf8") > 64 * 1024) fail("metadata_invalid");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("metadata_invalid");
    return value;
  } catch {
    fail("metadata_invalid");
  }
}

function validateRun(run, jobs, expectedReaderRevision) {
  if (run.path !== WORKFLOW_PATH || run.head_sha !== WORKFLOW_HEAD_SHA
      || run.event !== "workflow_dispatch" || run.status !== "completed"
      || run.conclusion !== "success") fail("source_run_unqualified");
  if (!SOURCE_REVISION.test(expectedReaderRevision)) fail("source_revision_unqualified");
  const startedAt = isoInstant(run.run_started_at);
  const finishedAt = isoInstant(run.updated_at);
  if (startedAt === null || finishedAt === null || finishedAt < startedAt) {
    fail("source_run_window_invalid");
  }
  if (!Array.isArray(jobs.jobs) || jobs.total_count !== 1) fail("source_job_unqualified");
  const matchingJobs = jobs.jobs.filter(job => job?.name === JOB_NAME);
  if (matchingJobs.length !== 1) fail("source_job_unqualified");
  const [job] = matchingJobs;
  if (job.status !== "completed" || job.conclusion !== "failure"
      || isoInstant(job.started_at) === null || isoInstant(job.completed_at) === null) {
    fail("source_job_unqualified");
  }
  if (!Array.isArray(job.steps)) fail("source_steps_unqualified");
  let previousIndex = -1;
  for (const [name, conclusion] of STEP_CONCLUSIONS) {
    const matches = job.steps.map((step, index) => ({ step, index }))
      .filter(({ step }) => step?.name === name);
    if (matches.length !== 1) fail("source_steps_unqualified");
    const [{ step, index }] = matches;
    if (index <= previousIndex || step.status !== "completed" || step.conclusion !== conclusion) {
      fail("source_steps_unqualified");
    }
    previousIndex = index;
  }
  return { startedAt, finishedAt };
}

async function readKvValue({ key, accountId, namespaceId, token, fetchImpl }) {
  const url = `${CLOUDFLARE_API}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const signal = AbortSignal.timeout(API_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal,
    });
  } catch {
    fail(signal.aborted ? "kv_read_timeout" : "kv_read_failed");
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    fail("kv_read_failed");
  }
  const bytes = await readResponseBytes(response.body, BINANCE_FACTS_MAX_BYTES, signal,
    "kv_value_too_large", "kv_read_failed", "kv_read_timeout");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("kv_value_invalid");
  }
}

async function readResponseBytes(body, maxBytes, signal, tooLargeCode, readFailedCode, timeoutCode) {
  if (!body) fail(readFailedCode);
  const reader = body.getReader();
  const chunks = [];
  let bytes = 0;
  let tooLarge = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        tooLarge = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    fail(signal.aborted ? timeoutCode : readFailedCode);
  } finally {
    reader.releaseLock();
  }
  if (tooLarge) fail(tooLargeCode);
  return Buffer.concat(chunks, bytes);
}

async function readUniqueCloudflareAccount({ token, fetchImpl }) {
  const signal = AbortSignal.timeout(API_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${CLOUDFLARE_API}/accounts?per_page=${ACCOUNT_LIST_PAGE_SIZE}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal,
    });
  } catch {
    fail(signal.aborted ? "account_discovery_timeout" : "account_target_unqualified");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    fail("account_target_unqualified");
  }
  let payload;
  try {
    const bytes = await readResponseBytes(response.body, ACCOUNT_LIST_MAX_BYTES, signal,
      "account_discovery_too_large", "account_target_unqualified", "account_discovery_timeout");
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("account_target_unqualified");
  }

  const info = payload?.result_info;
  const accounts = payload?.result;
  const oneCompletePage = info?.count === 1 && info.page === 1
    && info.per_page === ACCOUNT_LIST_PAGE_SIZE && info.total_count === 1
    && (info.total_pages === undefined || info.total_pages === 1);
  if (payload?.success !== true || !oneCompletePage || !Array.isArray(accounts)
      || accounts.length !== 1 || !/^[a-f0-9]{32}$/i.test(accounts[0]?.id || "")) {
    fail("account_target_unqualified");
  }
  return accounts[0].id;
}

async function verifyCloudflareNamespace({ accountId, namespaceId, token, fetchImpl }) {
  const signal = AbortSignal.timeout(API_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(
      `${CLOUDFLARE_API}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal,
      },
    );
  } catch {
    fail("namespace_target_unqualified");
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    fail("namespace_target_unqualified");
  }
  let value;
  try {
    const bytes = await readResponseBytes(response.body, ACCOUNT_LIST_MAX_BYTES, signal,
      "namespace_target_unqualified", "namespace_target_unqualified", "namespace_target_unqualified");
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("namespace_target_unqualified");
  }
  if (value?.success !== true || value.result?.id !== namespaceId) {
    fail("namespace_target_unqualified");
  }
}

function summarizeStoredValue(value, binding, window, now) {
  if (value === null) {
    return { exists: false, valid: false, observed_in_attempt_window: false };
  }
  let report;
  try {
    report = JSON.parse(value);
  } catch {
    return { exists: true, valid: false, observed_in_attempt_window: false };
  }
  const reportStartedAt = isoInstant(report?.observed_started_at);
  const reportFinishedAt = isoInstant(report?.observed_finished_at);
  const observedInAttemptWindow = reportStartedAt !== null && reportFinishedAt !== null
    && reportStartedAt >= window.startedAt && reportFinishedAt <= window.finishedAt;
  try {
    normalizeBinanceAccountFacts(report, binding, {
      now: reportFinishedAt ?? now,
      ingest: false,
    });
    return { exists: true, valid: true, observed_in_attempt_window: observedInAttemptWindow };
  } catch {
    return { exists: true, valid: false, observed_in_attempt_window: observedInAttemptWindow };
  }
}

export async function diagnoseBinanceAccountFactsKv({
  runId,
  expectedReaderRevision,
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (env.GITHUB_REPOSITORY !== QRS_REPOSITORY || env.GITHUB_REF !== "refs/heads/main") {
    fail("protected_ref_required");
  }
  if (runId !== EXPECTED_RUN_ID || !RUN_ID.test(runId)) fail("source_run_id_invalid");
  if (!SOURCE_REVISION.test(expectedReaderRevision || "")) fail("source_revision_invalid");
  if (!env.GH_TOKEN) fail("github_read_token_missing");
  if (!env.CLOUDFLARE_API_TOKEN) fail("cloudflare_api_token_missing");
  if ((env.CLOUDFLARE_ACCOUNT_ID && !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID))
      || !/^[a-f0-9]{32}$/i.test(env.STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID || "")) {
    fail("cloudflare_target_invalid");
  }

  let binding;
  try {
    binding = normalizeBinanceFactsBinding(JSON.parse(env.BINANCE_ACCOUNT_FACTS_BINDING_JSON || ""));
    await assertBinanceFactsSourceBinding(binding);
  } catch {
    fail("binding_invalid");
  }
  if (expectedReaderRevision !== binding.reader_revision) fail("binding_revision_mismatch");

  const run = await readGithubJson(
    `/repos/${BINANCE_REPOSITORY}/actions/runs/${runId}`,
    { token: env.GH_TOKEN, fetchImpl },
  );
  const jobs = await readGithubJson(
    `/repos/${BINANCE_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`,
    { token: env.GH_TOKEN, fetchImpl },
  );
  const window = validateRun(run, jobs, expectedReaderRevision);
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || await readUniqueCloudflareAccount({
    token: env.CLOUDFLARE_API_TOKEN,
    fetchImpl,
  });
  await verifyCloudflareNamespace({
    accountId,
    namespaceId: env.STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID,
    token: env.CLOUDFLARE_API_TOKEN,
    fetchImpl,
  });
  const key = `${BINANCE_FACTS_KEY}:${binding.source_binding.id}`;
  const storedValue = await readKvValue({
    key,
    accountId,
    namespaceId: env.STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID,
    token: env.CLOUDFLARE_API_TOKEN,
    fetchImpl,
  });
  return summarizeStoredValue(storedValue, binding, window, now);
}

if (import.meta.url === new URL(process.argv[1] || "", "file://").href) {
  try {
    const result = await diagnoseBinanceAccountFactsKv({
      runId: process.env.BINANCE_ACCOUNT_FACTS_SOURCE_RUN_ID,
      expectedReaderRevision: process.env.BINANCE_ACCOUNT_FACTS_EXPECTED_READER_REVISION,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    const code = error instanceof BinanceAccountFactsDiagnosticError ? error.code : "diagnostic_failed";
    console.error(`binance_account_facts_kv_diagnostic=${code}`);
    process.exitCode = 1;
  }
}
