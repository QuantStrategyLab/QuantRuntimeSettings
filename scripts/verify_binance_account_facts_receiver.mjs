import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RECEIVER_PATH = "/api/internal/binance-account-facts";
const EXPECTED_ERROR = "invalid_binance_account_facts";
const TIMEOUT_MS = 15_000;

function closedFailure(code) {
  throw new Error(code);
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
      closedFailure("receiver_check_configuration_invalid");
    }
    endpoint = `${base.href.replace(/\/+$/, "")}${RECEIVER_PATH}`;
  } catch {
    closedFailure("receiver_check_configuration_invalid");
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
    closedFailure("receiver_check_unavailable");
  }

  if (response.status !== 400) closedFailure("receiver_check_unexpected_response");
  let body;
  try {
    const text = await response.text();
    if (text.length > 2048) closedFailure("receiver_check_unexpected_response");
    body = JSON.parse(text);
  } catch {
    closedFailure("receiver_check_unexpected_response");
  }
  if (body?.ok !== false || body?.error !== EXPECTED_ERROR) {
    closedFailure("receiver_check_unexpected_response");
  }
  return { status: "verified" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await verifyBinanceAccountFactsReceiver({
      consoleUrl: process.env.STRATEGY_SWITCH_CONSOLE_URL,
      token: process.env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
    });
    console.log(result.status === "verified"
      ? "binance_account_facts_receiver=verified"
      : "binance_account_facts_receiver=skipped");
  } catch {
    console.error("binance_account_facts_receiver=failed");
    process.exitCode = 1;
  }
}
