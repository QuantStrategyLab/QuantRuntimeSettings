import { withIdempotency } from "../../web/strategy-switch-console/application/desk/idempotency.js";
import { deskErrorResponse, deskResponse, deskJson } from "../../web/strategy-switch-console/application/desk/http.js";

// Synthetic DO only: no production ingress, external dispatch or broker access.
export class SyntheticDeskStore {
  constructor(ctx) { this.storage = ctx.storage; }
  async fetch(request) {
    try {
      const { scope, body, fail, delay } = await request.json();
      const result = await withIdempotency(this.storage, { scope, body }, async (requestId) => {
        const count = (await this.storage.get("creates") || 0) + 1;
        await this.storage.put("creates", count);
        if (delay) await new Promise((resolve) => setTimeout(resolve, 25));
        if (fail) throw new Error("synthetic private source failure");
        const response = deskResponse("synthetic_request", { no_order: true, request_id: requestId, creates: count }, { status: 202, now: "2020-01-02T03:04:05Z" });
        return { status: response.status, body: await response.json() };
      });
      return deskJson(result.body, result.status);
    } catch (error) { return deskErrorResponse(error); }
  }
}

export default { async fetch(request, env) {
  return env.STORE.get(env.STORE.idFromName("synthetic-desk")).fetch(request);
} };
