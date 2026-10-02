import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RECEIVER_PATH = "/api/internal/binance-account-facts";
const READINESS_FIELDS = ["ok", "ready", "binding_valid", "account_options_readable", "unique_match"];
const EXPECTED_ERROR = "invalid_binance_account_facts";
const TIMEOUT_MS = 15_000;
const CATEGORIES = new Set([
  "token_invalid", "binding_unmatched", "config_or_binding", "route_not_found",
  "account_options_unavailable", "redirect", "unknown", "transport", "configuration_invalid",
]);

function closedFailure(category, httpStatus = null) {
  const error = new Error(category);
  error.category = category;
  error.httpStatus = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
    ? httpStatus : null;
  throw error;
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

export async function verifyBinanceAccountFactsReceiver({
  consoleUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
  readinessOnly = false,
} = {}) {
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
    });
    if (result.status === "verified") console.log("binance_account_facts_receiver=verified status=400");
    else if (result.status === "ready") console.log("binance_account_facts_readiness=ready");
    else console.log("binance_account_facts_receiver=skipped");
  } catch (error) {
    const category = CATEGORIES.has(error?.category) ? error.category : "unknown";
    const status = Number.isInteger(error?.httpStatus) ? ` status=${error.httpStatus}` : "";
    const label = process.env.BINANCE_ACCOUNT_FACTS_READINESS_ONLY === "true"
      ? "binance_account_facts_readiness" : "binance_account_facts_receiver";
    console.error(`${label}=${category}${status}`);
    process.exitCode = 1;
  }
}
