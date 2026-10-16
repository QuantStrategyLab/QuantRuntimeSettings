// Use one instance per candidate/baseline pair. Same-run cached replies retain
// their original status and body, including failures; they are not fresh reads.
export function legacyListCost(rawUrl) {
  const { pathname } = new URL(rawUrl);
  if (["/api/decisions-inbox", "/api/accounts"].includes(pathname)) return 3;
  if (pathname === "/api/runtime/today") return 2;
  return ["/api/runtime-daily", "/api/control-plane", "/api/owner-decisions",
    "/api/research-promotion-tickets", "/api/reconciliation-recovery", "/api/execution-evidence",
    "/api/runtime-target-lifecycle", "/api/research-tasks", "/api/adaptive-selection"].includes(pathname) ? 1 : 0;
}

export function createAcceptanceBudget({ maxApiRequests = 80, maxLegacyLists = 48, legacy = false } = {}) {
  if (![maxApiRequests, maxLegacyLists].every(n => Number.isInteger(n) && n >= 0)) throw Error("invalid_acceptance_budget");
  const replies = new Map();
  const counts = { network_api_requests: 0, cached_replies: 0, estimated_legacy_lists: 0, blocked_writes: 0 };
  return {
    counts,
    read(url, fetcher) {
      if (replies.has(url)) { counts.cached_replies++; return replies.get(url); }
      const cost = legacy ? legacyListCost(url) : 0;
      if (counts.network_api_requests >= maxApiRequests || counts.estimated_legacy_lists + cost > maxLegacyLists)
        throw Error("acceptance_request_budget_exceeded");
      counts.network_api_requests++; counts.estimated_legacy_lists += cost;
      // Rejected reads remain memoized too. No acceptance retry loop.
      const pending = Promise.resolve().then(fetcher);
      replies.set(url, pending);
      return pending;
    },
  };
}

export async function installAcceptanceBudget(page, { origin, ...options }) {
  const budget = createAcceptanceBudget(options);
  const context = page.context();
  const handler = async route => {
    const request = route.request(), url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) {
      budget.counts.blocked_writes++;
      await route.abort("blockedbyclient"); return;
    }
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) { await route.continue(); return; }
    try {
      const reply = await budget.read(request.url(), async () => {
        const response = await route.fetch({ maxRetries: 0 });
        return { status: response.status(), body: await response.body(), headers: {
          "Content-Type": response.headers()["content-type"] || "application/json",
          "Cache-Control": "no-store",
        } };
      });
      await route.fulfill(reply);
    } catch { await route.abort("blockedbyclient"); }
  };
  await context.route("**/*", handler);
  return { ...budget, close: () => context.unroute("**/*", handler) };
}
