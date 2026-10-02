import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BinanceAccountFactsDiagnosticError,
  diagnoseBinanceAccountFactsKv,
} from "../scripts/diagnose_binance_account_facts_kv.mjs";

const report = JSON.parse(readFileSync(
  new URL("./fixtures/binance_account_facts.v1.synthetic.json", import.meta.url), "utf8",
));
const binding = {
  platform: "binance",
  account_key: "synthetic-account",
  account_scope: "synthetic-scope",
  target_name: "synthetic-target-name",
  service_name: "synthetic-service",
  deployment_selector: "synthetic-deployment",
  account_selector: "synthetic-selector",
  target_id: report.target_id,
  account_scope_sha256: report.account_scope_sha256,
  reader_revision: report.source_revision,
  approved_application_revision: report.approved_application_revision,
  source_binding: report.source_binding,
};
const accountId = "1".repeat(32);
const namespaceId = "2".repeat(32);
const privateMarker = "PRIVATE_NATIVE_ACCOUNT_AND_BALANCE";
const key = `private_binance_account_facts:${binding.source_binding.id}`;
const accountsUrl = "https://api.cloudflare.com/client/v4/accounts?per_page=5";
const namespaceUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
const environment = {
  GITHUB_REPOSITORY: "QuantStrategyLab/QuantRuntimeSettings",
  GITHUB_REF: "refs/heads/main",
  GH_TOKEN: "synthetic-github-token",
  CLOUDFLARE_API_TOKEN: "synthetic-cloudflare-token",
  STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: namespaceId,
  BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(binding),
};
const uniqueAccountPage = {
  success: true,
  result: [{ id: accountId, name: "synthetic account name" }],
  result_info: { count: 1, page: 1, per_page: 5, total_count: 1 },
};
const namespaceResponse = {
  success: true,
  result: { id: namespaceId, title: "synthetic namespace title", jurisdiction: "eu" },
};
const run = {
  path: ".github/workflows/binance-account-facts.yml",
  head_sha: "66d705fd756f5648f603bfd745235b5ef389f668",
  event: "workflow_dispatch",
  status: "completed",
  conclusion: "success",
  run_started_at: "2026-10-02T10:00:00Z",
  updated_at: "2026-10-02T10:01:00Z",
};
const stepConclusions = [
  ["Read the bound Spot and Flexible Earn account quantities", "success"],
  ["Recheck Runtime source before publishing", "success"],
  ["Publish with the isolated account-facts token", "failure"],
  ["Remove this run's private report and account-facts files", "success"],
];
const jobs = {
  total_count: 1,
  jobs: [{
    name: "read-and-publish",
    status: "completed",
    conclusion: "failure",
    started_at: "2026-10-02T10:00:01Z",
    completed_at: "2026-10-02T10:00:50Z",
    steps: stepConclusions.map(([name, conclusion]) => ({ name, status: "completed", conclusion })),
  }],
};

function mockFetch({
  runValue = run,
  jobsValue = jobs,
  accountStatus = 200,
  accountBody = JSON.stringify(uniqueAccountPage),
  namespaceStatus = 200,
  namespaceBody = JSON.stringify(namespaceResponse),
  kvStatus = 200,
  kvBody = JSON.stringify(report),
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === accountsUrl) {
      return new Response(accountStatus === 404 ? null : accountBody, { status: accountStatus });
    }
    if (String(url).includes("/storage/kv/namespaces/") && !String(url).includes("/values/")) {
      return new Response(namespaceStatus === 404 ? null : namespaceBody, { status: namespaceStatus });
    }
    if (String(url) === kvUrl) return new Response(kvStatus === 404 ? null : kvBody, { status: kvStatus });
    if (String(url).endsWith("/jobs?per_page=100")) {
      return new Response(JSON.stringify(jobsValue), { status: 200 });
    }
    return new Response(JSON.stringify(runValue), { status: 200 });
  };
  return { calls, fetchImpl };
}

const validFetch = mockFetch();
const validResult = await diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: validFetch.fetchImpl,
  now: Date.parse(report.observed_finished_at),
});
assert.deepEqual(validResult, {
  exists: true,
  valid: true,
  observed_in_attempt_window: true,
});
assert.equal(validFetch.calls.length, 5, "GitHub run/jobs, account and namespace checks, one KV read");
const accountsCall = validFetch.calls.find(call => call.url === accountsUrl);
assert.ok(accountsCall);
assert.equal(accountsCall.init.method, "GET");
assert.equal(accountsCall.init.headers.Authorization, "Bearer synthetic-cloudflare-token");
assert.equal(accountsCall.init.redirect, "error");
const namespaceCall = validFetch.calls.find(call => call.url === namespaceUrl);
assert.ok(namespaceCall);
assert.equal(namespaceCall.init.method, "GET");
assert.equal(namespaceCall.init.headers.Authorization, "Bearer synthetic-cloudflare-token");
assert.equal(namespaceCall.init.redirect, "error");
const kvCall = validFetch.calls.find(call => call.url === kvUrl);
assert.ok(kvCall);
assert.equal(kvCall.init.method, "GET");
assert.equal(kvCall.init.headers.Authorization, "Bearer synthetic-cloudflare-token");
assert.equal(kvCall.init.redirect, "error");
assert.equal(kvCall.init.signal instanceof AbortSignal, true);
assert.equal(JSON.stringify(validResult).includes("BTC"), false);
assert.equal(JSON.stringify(validResult).includes("USDT"), false);
assert.equal(JSON.stringify(validResult).includes("synthetic-account"), false);
assert.equal(JSON.stringify(validResult).includes("synthetic account name"), false);
assert.equal(JSON.stringify(validResult).includes("synthetic namespace title"), false);

const configuredAccount = mockFetch();
assert.deepEqual(await diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: { ...environment, CLOUDFLARE_ACCOUNT_ID: accountId },
  fetchImpl: configuredAccount.fetchImpl,
}), {
  exists: true,
  valid: true,
  observed_in_attempt_window: true,
});
assert.equal(configuredAccount.calls.some(call => call.url === accountsUrl), false);
assert.equal(configuredAccount.calls.some(call => call.url === namespaceUrl), true);

for (const namespaceCase of [
  { namespaceStatus: 404 },
  { namespaceStatus: 403, namespaceBody: privateMarker },
  { namespaceBody: "not-json" },
  { namespaceBody: JSON.stringify({ success: true, result: { id: "3".repeat(32) } }) },
]) {
  const rejectedNamespace = mockFetch(namespaceCase);
  await assert.rejects(diagnoseBinanceAccountFactsKv({
    runId: "37027311498",
    expectedReaderRevision: binding.reader_revision,
    env: environment,
    fetchImpl: rejectedNamespace.fetchImpl,
  }), error => error.code === "namespace_target_unqualified");
  assert.equal(rejectedNamespace.calls.some(call => call.url === kvUrl), false);
}

const wrongResolvedAccountId = "3".repeat(32);
const wrongAccountNamespace = mockFetch({
  accountBody: JSON.stringify({
    ...uniqueAccountPage,
    result: [{ id: wrongResolvedAccountId }],
  }),
  namespaceStatus: 404,
});
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: wrongAccountNamespace.fetchImpl,
}), error => error.code === "namespace_target_unqualified");
assert.equal(wrongAccountNamespace.calls.some(call => call.url === kvUrl), false);
assert.equal(wrongAccountNamespace.calls.some(call =>
  call.url === `https://api.cloudflare.com/client/v4/accounts/${wrongResolvedAccountId}/storage/kv/namespaces/${namespaceId}`), true);

const ambiguousAccounts = mockFetch({
  accountBody: JSON.stringify({
    ...uniqueAccountPage,
    result: [{ id: accountId }, { id: "3".repeat(32) }],
    result_info: { count: 2, page: 1, per_page: 5, total_count: 2 },
  }),
});
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: ambiguousAccounts.fetchImpl,
}), error => error.code === "account_target_unqualified");
assert.equal(ambiguousAccounts.calls.some(call => call.url === kvUrl), false);

const emptyAccounts = mockFetch({
  accountBody: JSON.stringify({
    ...uniqueAccountPage,
    result: [],
    result_info: { count: 0, page: 1, per_page: 5, total_count: 0 },
  }),
});
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: emptyAccounts.fetchImpl,
}), error => error.code === "account_target_unqualified");
assert.equal(emptyAccounts.calls.some(call => call.url === kvUrl), false);

const incompleteAccounts = mockFetch({
  accountBody: JSON.stringify({
    ...uniqueAccountPage,
    result_info: { count: 2, page: 1, per_page: 5, total_count: 6, total_pages: 2 },
  }),
});
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: incompleteAccounts.fetchImpl,
}), error => error.code === "account_target_unqualified");
assert.equal(incompleteAccounts.calls.some(call => call.url === kvUrl), false);

for (const accountCase of [
  { accountStatus: 403, accountBody: privateMarker },
  { accountBody: "not-json" },
  { accountBody: JSON.stringify({ ...uniqueAccountPage, result: [{ id: "bad-id" }] }) },
]) {
  const rejectedAccounts = mockFetch(accountCase);
  await assert.rejects(diagnoseBinanceAccountFactsKv({
    runId: "37027311498",
    expectedReaderRevision: binding.reader_revision,
    env: environment,
    fetchImpl: rejectedAccounts.fetchImpl,
  }), error => error.code === "account_target_unqualified");
  assert.equal(rejectedAccounts.calls.some(call => call.url === kvUrl), false);
}

const notFoundFetch = mockFetch({ kvStatus: 404 });
assert.deepEqual(await diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: notFoundFetch.fetchImpl,
}), {
  exists: false,
  valid: false,
  observed_in_attempt_window: false,
});
assert.equal(notFoundFetch.calls.filter(call => call.url === kvUrl).length, 1);

const deniedFetch = mockFetch({ kvStatus: 403, kvBody: privateMarker });
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: deniedFetch.fetchImpl,
}), error => error instanceof BinanceAccountFactsDiagnosticError
  && error.code === "kv_read_failed"
  && !error.message.includes(privateMarker));
assert.equal(deniedFetch.calls.filter(call => call.url === kvUrl).length, 1, "no retry on errors");

const expectedRevisionMismatch = mockFetch();
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: "b".repeat(40),
  env: environment,
  fetchImpl: expectedRevisionMismatch.fetchImpl,
}), error => error.code === "binding_revision_mismatch");
assert.equal(expectedRevisionMismatch.calls.length, 0);

const wrongRun = mockFetch({ runValue: { ...run, head_sha: "f".repeat(40) } });
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: wrongRun.fetchImpl,
}), error => error.code === "source_run_unqualified");
assert.equal(wrongRun.calls.length, 2, "the KV read waits for qualified producer metadata");

const wrongStepJobs = structuredClone(jobs);
wrongStepJobs.jobs[0].steps[2].conclusion = "success";
const wrongSteps = mockFetch({ jobsValue: wrongStepJobs });
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: wrongSteps.fetchImpl,
}), error => error.code === "source_steps_unqualified");
assert.equal(wrongSteps.calls.some(call => call.url === kvUrl), false);

const badPayload = mockFetch({ kvBody: JSON.stringify({ ...report, private_payload: privateMarker }) });
assert.deepEqual(await diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: badPayload.fetchImpl,
}), {
  exists: true,
  valid: false,
  observed_in_attempt_window: true,
});

const oldObservation = {
  ...report,
  observed_started_at: "2026-10-02T09:59:00Z",
  spot_observed_at: "2026-10-02T09:59:01Z",
  earn_observed_at: "2026-10-02T09:59:02Z",
  observed_finished_at: "2026-10-02T09:59:03Z",
};
assert.deepEqual(await diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: mockFetch({ kvBody: JSON.stringify(oldObservation) }).fetchImpl,
}), {
  exists: true,
  valid: true,
  observed_in_attempt_window: false,
});

const oversizedStream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(256 * 1024));
    controller.enqueue(new Uint8Array([0]));
    controller.close();
  },
});
const oversizedFetch = mockFetch();
const originalFetch = oversizedFetch.fetchImpl;
oversizedFetch.fetchImpl = (url, init) => String(url) === kvUrl
  ? Promise.resolve(new Response(oversizedStream, { status: 200 }))
  : originalFetch(url, init);
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: oversizedFetch.fetchImpl,
}), error => error.code === "kv_value_too_large");

const oversizedAccountsStream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(64 * 1024));
    controller.enqueue(new Uint8Array([0]));
    controller.close();
  },
});
const oversizedAccounts = mockFetch({ accountBody: oversizedAccountsStream });
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: oversizedAccounts.fetchImpl,
}), error => error.code === "account_target_unqualified");
assert.equal(oversizedAccounts.calls.some(call => call.url === kvUrl), false);

const oversizedNamespaceStream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(64 * 1024));
    controller.enqueue(new Uint8Array([0]));
    controller.close();
  },
});
const oversizedNamespace = mockFetch({ namespaceBody: oversizedNamespaceStream });
await assert.rejects(diagnoseBinanceAccountFactsKv({
  runId: "37027311498",
  expectedReaderRevision: binding.reader_revision,
  env: environment,
  fetchImpl: oversizedNamespace.fetchImpl,
}), error => error.code === "namespace_target_unqualified");
assert.equal(oversizedNamespace.calls.some(call => call.url === kvUrl), false);

const workflow = readFileSync(
  new URL("../.github/workflows/diagnose-binance-account-facts.yml", import.meta.url), "utf8",
);
assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
assert.doesNotMatch(workflow, /^\s+(?:push|schedule|workflow_run):/m);
assert.match(workflow, /actions:\s*read\s*\n\s*contents:\s*read/);
assert.match(workflow, /confirm_read_only:[\s\S]*?default:\s*false/);
assert.match(workflow, /github\.ref == 'refs\/heads\/main'[\s\S]*inputs\.confirm_read_only == true/);
assert.match(workflow, /environment:\s*runtime-strategy-switch/);
assert.match(workflow, /ref:\s*\$\{\{ github\.sha \}\}[\s\S]*persist-credentials:\s*false/);
assert.match(workflow, /GH_TOKEN:\s*\$\{\{ secrets\.RUNTIME_SETTINGS_GH_TOKEN \}\}/);
assert.match(workflow, /CLOUDFLARE_API_TOKEN:\s*\$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \|\| vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
assert.doesNotMatch(workflow, /WRANGLER|upload-artifact|kv\s+key\s+(?:put|delete)|actions:\s*write/i);

console.log("Binance account-facts KV diagnostic: synthetic read-only checks PASS");
