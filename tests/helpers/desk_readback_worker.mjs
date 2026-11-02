import worker, { RuntimeInstances } from "../../web/strategy-switch-console/worker.js";
let now = Date.parse("2030-01-02T12:00:00Z");
const NativeDate = Date;
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
// Drive real SQLite storage/transactions and alarms deterministically. No test
// control is exported by the production Worker.
export class SyntheticRuntimeInstances extends RuntimeInstances {
  async alarm() {} // Prevent the host clock from advancing the synthetic clock.
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/test/count") return Response.json({ count: (await this.storage.list({ prefix: "desk:readbacks:record:" })).size, admissions: (await this.storage.list({ prefix: "desk:readbacks:admission:" })).size });
    if (url.pathname === "/test/advance") { now += 30_000; return Response.json({ ok: true }); }
    if (url.pathname === "/test/alarm") { await super.alarm(); return Response.json({ ok: true }); }
    if (url.pathname === "/test/expire") { now += 86400_001; await super.alarm(); return Response.json({ ok: true }); }
    return super.fetch(request);
  }
}
export default { async fetch(request, env, ctx) {
  if (new URL(request.url).pathname.startsWith("/test/")) {
    return env.STRATEGY_SWITCH_RUNTIME_INSTANCES.get(env.STRATEGY_SWITCH_RUNTIME_INSTANCES.idFromName("runtime-instances")).fetch(request);
  }
  return worker.fetch(request, env, ctx);
} };
