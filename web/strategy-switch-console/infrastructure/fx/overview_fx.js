/**
 * Same-origin Overview FX proxy (Frankfurter ECB USD base).
 *
 * Pure-ish Worker helper: no Durable Object, no auth, no secrets.
 * Caller injects json / responseHeaders / fetchWithTimeout so this module
 * does not import worker.js (avoids cycles) and wire headers stay identical.
 */

export const OVERVIEW_FX_UPSTREAM_URL =
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,EUR,HKD,SGD";
export const OVERVIEW_FX_PROXY_PATH = "/api/overview-fx";
export const OVERVIEW_FX_TIMEOUT_MS = 5000;
export const OVERVIEW_FX_CACHE_MS = 60 * 60 * 1000;

/** @type {{ at: number, status: number, body: string, contentType: string } | null} */
let overviewFxCache = null;

export function resetOverviewFxCache() {
  overviewFxCache = null;
}

/**
 * @param {Request} request
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   fetchWithTimeout: Function,
 *   json: Function,
 *   responseHeaders: Function,
 * }} deps
 */
export async function overviewFxResponse(request, deps) {
  const fetchImpl = deps.fetchImpl || fetch;
  const { fetchWithTimeout, json, responseHeaders } = deps;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  const now = Date.now();
  if (
    overviewFxCache
    && now - overviewFxCache.at < OVERVIEW_FX_CACHE_MS
    && overviewFxCache.status === 200
  ) {
    const headers = responseHeaders({
      "Content-Type": overviewFxCache.contentType,
      "Cache-Control": "no-store",
    });
    return new Response(request.method === "HEAD" ? null : overviewFxCache.body, {
      status: 200,
      headers,
    });
  }
  let upstream;
  try {
    upstream = await fetchWithTimeout(
      OVERVIEW_FX_UPSTREAM_URL,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
      OVERVIEW_FX_TIMEOUT_MS,
      fetchImpl,
    );
  } catch {
    return json({ ok: false, error: "overview_fx_upstream_unavailable" }, 502);
  }
  let bodyText;
  try {
    bodyText = await upstream.text();
  } catch {
    return json({ ok: false, error: "overview_fx_upstream_unavailable" }, 502);
  }
  if (!upstream.ok) return json({ ok: false, error: "overview_fx_upstream_failed" }, 502);
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return json({ ok: false, error: "overview_fx_upstream_invalid" }, 502);
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || parsed.base !== "USD"
    || !parsed.rates
    || typeof parsed.rates !== "object"
    || Array.isArray(parsed.rates)
  ) {
    return json({ ok: false, error: "overview_fx_upstream_invalid" }, 502);
  }
  const contentType = "application/json; charset=utf-8";
  overviewFxCache = { at: now, status: 200, body: bodyText, contentType };
  const headers = responseHeaders({ "Content-Type": contentType, "Cache-Control": "no-store" });
  return new Response(request.method === "HEAD" ? null : bodyText, { status: 200, headers });
}
