import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RECEIVER_PATH = "/api/internal/binance-account-facts";
const EXPECTED_ERROR = "invalid_binance_account_facts";
const TIMEOUT_MS = 15_000;
const CATEGORIES = new Set([
  "token_invalid", "binding_unmatched", "config_or_binding", "route_not_found",
  "redirect", "unknown", "transport", "configuration_invalid",
]);

function closedFailure(category, httpStatus = null) {
  const error = new Error(category);
  error.category = category;
  error.httpStatus = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
    ? httpStatus : null;
  throw error;
}

async function responseError(response) {
  try {
    const text = await response.text();
    if (text.length > 2048) return null;
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body)
      ? { ok: body.ok, error: body.error }
      : null;
  } catch {
    return null;
  }
}

export async function verifyBinanceAccountFactsReceiver({
  consoleUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
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
    const body = await responseError(response);
    if (body?.ok === false && body.error === EXPECTED_ERROR) return { status: "verified", httpStatus: 400 };
    closedFailure("unknown", status);
  }
  if (status === 401) {
    const body = await responseError(response);
    if (body?.ok === false && body.error === "binance_account_facts_token_invalid") {
      closedFailure("token_invalid", status);
    }
  }
  if (status === 409) {
    const body = await responseError(response);
    if (body?.ok === false && body.error === "binance_account_facts_binding_unmatched") {
      closedFailure("binding_unmatched", status);
    }
  }
  if (status === 503) {
    const body = await responseError(response);
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
    });
    console.log(result.status === "verified"
      ? "binance_account_facts_receiver=verified status=400"
      : "binance_account_facts_receiver=skipped");
  } catch (error) {
    const category = CATEGORIES.has(error?.category) ? error.category : "unknown";
    const status = Number.isInteger(error?.httpStatus) ? ` status=${error.httpStatus}` : "";
    console.error(`binance_account_facts_receiver=${category}${status}`);
    process.exitCode = 1;
  }
}
