import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RECEIVER_PATH = "/api/internal/binance-account-facts";
const READINESS_FIELDS = ["ok", "ready", "binding_valid", "account_options_readable", "unique_match"];
const EXPECTED_ERROR = "invalid_binance_account_facts";
const TIMEOUT_MS = 15_000;
const STABILITY_BUDGET_MS = 75_000;
const STABILITY_DELAY_MS = 5_000;
const STABILITY_ATTEMPTS = 4;
const CATEGORIES = new Set([
  "token_invalid", "binding_unmatched", "config_or_binding", "route_not_found",
  "account_options_unavailable", "redirect", "unknown", "transport", "configuration_invalid",
  "forbidden", "challenge", "request_timeout", "budget_exhausted", "attempts_exhausted",
]);

function closedError(category, httpStatus = null) {
  const error = new Error(category);
  error.category = category;
  error.httpStatus = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
    ? httpStatus : null;
  return error;
}

function closedFailure(category, httpStatus = null) {
  throw closedError(category, httpStatus);
}

async function responseObject(response) {
  try {
    const text = await response.text();
    if (text.length > 2048) return null;
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function hasExactFields(value, expected) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

async function verifyReadiness(endpoint, token, fetchImpl, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    closedFailure("transport");
  }

  const body = await responseObject(response);
  if (response.status === 200 && hasExactFields(body, READINESS_FIELDS)
      && body.ok === true && body.ready === true && body.binding_valid === true
      && body.account_options_readable === true && body.unique_match === true) {
    return { status: "ready", bindingValid: true, accountOptionsReadable: true, uniqueMatch: true };
  }
  if (response.status === 401 && body?.ok === false && body.error === "binance_account_facts_token_invalid") {
    closedFailure("token_invalid", response.status);
  }
  if (response.status === 409 && body?.ok === false && body.error === "binance_account_facts_binding_unmatched") {
    closedFailure("binding_unmatched", response.status);
  }
  if (response.status === 503 && body?.ok === false && [
    "binance_account_facts_token_unavailable",
    "binance_account_facts_binding_missing",
    "binance_account_facts_binding_invalid",
  ].includes(body.error)) {
    closedFailure("config_or_binding", response.status);
  }
  if (response.status === 503 && body?.ok === false
      && body.error === "binance_account_facts_account_options_unavailable") {
    closedFailure("account_options_unavailable", response.status);
  }
  if (response.status === 404) closedFailure("route_not_found", response.status);
  if (response.status >= 300 && response.status < 400) closedFailure("redirect", response.status);
  closedFailure("unknown", response.status);
}

function cancellableDelay(ms, { signal }) {
  return new Promise((resolve, reject) => {
    const end = performance.now() + ms;
    let timer;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const wake = () => {
      const remainingMs = end - performance.now();
      if (remainingMs > 0) timer = setTimeout(wake, Math.ceil(remainingMs));
      else { cleanup(); resolve(); }
    };
    timer = setTimeout(wake, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function verifyDeploymentReadiness(endpoint, token, fetchImpl, timeoutMs, timing, logImpl, startedAt) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    closedFailure("configuration_invalid");
  }
  const deadline = startedAt + STABILITY_BUDGET_MS;
  let lastNow = startedAt;
  let attempt = 0;
  let status = null;
  let consecutiveReady = 0;
  const now = () => {
    const value = timing.now();
    if (!Number.isFinite(value) || value < lastNow) closedFailure("configuration_invalid", status);
    lastNow = value;
    return value;
  };
  const remaining = () => {
    const value = deadline - now();
    if (value <= 0) closedFailure("budget_exhausted", status);
    return value;
  };
  const report = category => {
    const entry = { attempt, elapsedMs: Math.max(0, Math.floor(now() - startedAt)),
      category: category === "ready" || CATEGORIES.has(category) ? category : "unknown",
      httpStatus: closedError("unknown", status).httpStatus, consecutiveReady };
    try { logImpl(entry); } catch { closedFailure("unknown", status); }
  };
  // The race enforces cancellation even when a fetch/body reader/delay ignores
  // abort. One controller spans fetch and body, capped by the remaining budget.
  const bounded = async (operation, capMs, timeoutCategory) => {
    const start = now();
    const available = deadline - start;
    if (available <= 0) closedFailure("budget_exhausted", status);
    const end = start + Math.min(capMs, available);
    const controller = new AbortController();
    const category = () => now() >= deadline ? "budget_exhausted" : timeoutCategory;
    const check = () => {
      remaining();
      if (now() >= end) closedFailure(timeoutCategory, status);
    };
    check();
    const timerMs = Math.max(0, end - now());
    let timer;
    const expiration = new Promise((_, reject) => {
      timer = timing.setTimeout(() => {
        let error;
        try { error = closedError(category(), status); } catch (failure) { error = failure; }
        controller.abort(error);
        reject(error);
      }, timerMs);
    });
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => { check(); return operation(controller.signal, check); }), expiration,
      ]);
      check();
      return value;
    } finally {
      // Also release unread response bodies on fatal headers/parse failures.
      // Only a closed, non-sensitive reason reaches the cancellation signal.
      controller.abort(closedError("unknown", status));
      timing.clearTimeout(timer);
    }
  };

  try {
    for (attempt = 1; attempt <= STABILITY_ATTEMPTS; attempt += 1) {
      status = null;
      remaining();
      const result = await bounded(async (signal, check) => {
        let response;
        try {
          response = await fetchImpl(endpoint, {
            method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "manual", signal,
          });
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          closedFailure(error?.name === "TimeoutError" ? "request_timeout" : "transport");
        }
        if (signal.aborted) throw signal.reason;
        status = response.status;
        check();
        if (String(response.headers?.get("cf-mitigated") || "").trim().toLowerCase() === "challenge") {
          closedFailure("challenge", status);
        }
        if (status >= 300 && status < 400) closedFailure("redirect", status);
        if (status === 401) closedFailure("token_invalid", status);
        if (status === 403) closedFailure("forbidden", status);
        if (status === 404) closedFailure("route_not_found", status);
        const body = await responseObject(response);
        check();
        if (status === 200 && hasExactFields(body, READINESS_FIELDS)
            && READINESS_FIELDS.every(field => body[field] === true)) return "ready";
        if (status === 503 && hasExactFields(body, [...READINESS_FIELDS, "error"])
            && body.ok === false && body.ready === false && body.binding_valid === true
            && body.account_options_readable === false && body.unique_match === false
            && body.error === "binance_account_facts_account_options_unavailable") {
          return "account_options_unavailable";
        }
        if (status === 409 && body?.ok === false && body.error === "binance_account_facts_binding_unmatched") {
          closedFailure("binding_unmatched", status);
        }
        if (status === 503 && body?.ok === false && [
          "binance_account_facts_token_unavailable", "binance_account_facts_binding_missing",
          "binance_account_facts_binding_invalid",
        ].includes(body.error)) closedFailure("config_or_binding", status);
        if (status === 503 && body?.ok === false
            && body.error === "binance_account_facts_account_options_unavailable") {
          // Preserve the useful category, but an inexact shape is fatal.
          closedFailure("account_options_unavailable", status);
        }
        closedFailure("unknown", status);
      }, Math.min(TIMEOUT_MS, timeoutMs), "request_timeout");
      consecutiveReady = result === "ready" ? consecutiveReady + 1 : 0;
      report(result);
      remaining(); // Includes parse and synchronous logging overhead.
      if (consecutiveReady === 2) return { status: "stable", attempts: attempt };
      if (attempt === STABILITY_ATTEMPTS) closedFailure("attempts_exhausted", status);
      remaining();
      const sleepStartedAt = now();
      await bounded(signal => timing.delay(STABILITY_DELAY_MS, { signal }), remaining(), "budget_exhausted");
      remaining();
      if (now() - sleepStartedAt < STABILITY_DELAY_MS) closedFailure("configuration_invalid", status);
    }
  } catch (error) {
    const failure = CATEGORIES.has(error?.category) ? error : closedError("unknown", status);
    report(failure.category);
    throw failure;
  }
}

export async function verifyBinanceAccountFactsReceiver({
  consoleUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
  readinessOnly = false,
  deploymentReadiness = false,
  nowImpl = () => performance.now(),
  delayImpl = cancellableDelay,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  logImpl = () => {},
} = {}) {
  const startedAt = deploymentReadiness ? nowImpl() : null;
  if (deploymentReadiness && readinessOnly) closedFailure("configuration_invalid");
  if (typeof token !== "string" || token.length === 0) return { status: "skipped" };

  let endpoint;
  try {
    const base = new URL(consoleUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
      closedFailure("configuration_invalid");
    }
    endpoint = `${base.href.replace(/\/+$/, "")}${RECEIVER_PATH}`;
  } catch {
    closedFailure("configuration_invalid");
  }

  if (deploymentReadiness) {
    return await verifyDeploymentReadiness(endpoint, token, fetchImpl, timeoutMs,
      { now: nowImpl, delay: delayImpl, setTimeout: setTimeoutImpl, clearTimeout: clearTimeoutImpl }, logImpl, startedAt);
  }
  if (readinessOnly) return await verifyReadiness(endpoint, token, fetchImpl, timeoutMs);

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    closedFailure("transport");
  }

  const status = response.status;
  if (status === 400) {
    const body = await responseObject(response);
    if (body?.ok === false && body.error === EXPECTED_ERROR) return { status: "verified", httpStatus: 400 };
    closedFailure("unknown", status);
  }
  if (status === 401) {
    const body = await responseObject(response);
    if (body?.ok === false && body.error === "binance_account_facts_token_invalid") {
      closedFailure("token_invalid", status);
    }
  }
  if (status === 409) {
    const body = await responseObject(response);
    if (body?.ok === false && body.error === "binance_account_facts_binding_unmatched") {
      closedFailure("binding_unmatched", status);
    }
  }
  if (status === 503) {
    const body = await responseObject(response);
    if (body?.ok === false && [
      "binance_account_facts_token_unavailable",
      "binance_account_facts_binding_missing",
      "binance_account_facts_binding_invalid",
    ].includes(body.error)) {
      closedFailure("config_or_binding", status);
    }
    if (body?.ok === false && body.error === "binance_account_facts_account_options_unavailable") {
      closedFailure("account_options_unavailable", status);
    }
  }
  if (status === 404) closedFailure("route_not_found", status);
  if (status >= 300 && status < 400) closedFailure("redirect", status);
  closedFailure("unknown", status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await verifyBinanceAccountFactsReceiver({
      consoleUrl: process.env.STRATEGY_SWITCH_CONSOLE_URL,
      token: process.env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
      readinessOnly: process.env.BINANCE_ACCOUNT_FACTS_READINESS_ONLY === "true",
      deploymentReadiness: process.env.BINANCE_ACCOUNT_FACTS_DEPLOYMENT_READINESS === "true",
      logImpl: ({ attempt, elapsedMs, category, httpStatus, consecutiveReady }) => {
        const status = httpStatus === null ? "" : ` status=${httpStatus}`;
        console.log(`binance_account_facts_stability attempt=${attempt} elapsed_ms=${elapsedMs} category=${category}${status} consecutive_ready=${consecutiveReady}`);
      },
    });
    if (result.status === "verified") console.log("binance_account_facts_receiver=verified status=400");
    else if (result.status === "stable") console.log("binance_account_facts_stability=stable");
    else if (result.status === "ready") console.log("binance_account_facts_readiness=ready");
    else console.log("binance_account_facts_receiver=skipped");
  } catch (error) {
    const category = CATEGORIES.has(error?.category) ? error.category : "unknown";
    const status = Number.isInteger(error?.httpStatus) ? ` status=${error.httpStatus}` : "";
    const label = process.env.BINANCE_ACCOUNT_FACTS_DEPLOYMENT_READINESS === "true"
      ? "binance_account_facts_stability" : process.env.BINANCE_ACCOUNT_FACTS_READINESS_ONLY === "true"
        ? "binance_account_facts_readiness" : "binance_account_facts_receiver";
    console.error(`${label}=${category}${status}`);
    process.exitCode = 1;
  }
}
