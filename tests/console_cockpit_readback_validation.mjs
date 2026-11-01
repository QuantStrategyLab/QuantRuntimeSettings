import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

const root = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "cockpit-readback-"));
const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
try {
  const outfile = join(directory, "readback.cjs");
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { AuditTimeline } from './src/components/cockpit';
    import { RuntimeReadbackDetails } from './src/components/RuntimeReadbackPanel';
    export { loadAuditEvents, loadRuntimeReadback } from './src/api/cockpit';
    export { mergeAuditEvents } from './src/components/AuditHistory';
    const wrap = node => renderToStaticMarkup(h(I18nProvider, { language: 'en' }, node));
    export const timeline = events => wrap(h(AuditTimeline, { events, status: 'ready', hasMore: true, onMore() {} }));
    export const runtime = value => wrap(h(RuntimeReadbackDetails, { value }));
  ` }, bundle: true, platform: "node", format: "cjs", outfile, logLevel: "silent" });
  const api = createRequire(import.meta.url)(outfile);
  const event = { id: "durable_human_decision:demo", source: "durable_human_decision", occurred_at: "2026-11-01T00:00:00.000Z",
    actor_alias: "user-demo", action: "record_owner_decision", subject: { kind: "owner_decision", id: "demo" },
    revision: "demo-revision", outcome: "decided", ref: null };
  const page = { schema_version: "qsl.audit_events.v1", data_status: "ready", events: [event], next_cursor: "opaque_cursor",
    coverage: "durable_and_retained", errors: [], server_time: "2026-11-01T00:01:00.000Z" };
  let path, method;
  const respond = (body, status = 200) => { globalThis.fetch = async (url, options) => {
    path = url; method = options.method; return Response.json(body, { status });
  }; };
  respond(page);
  let read = await api.loadAuditEvents();
  assert.equal(method, "GET");
  assert.equal(path, "/api/audit-events?limit=25");
  assert.equal(read.data.next_cursor, "opaque_cursor");
  assert.equal(read.data.events[0].event_id, event.id);
  assert.equal(read.data.events[0].actor, event.actor_alias);
  assert.equal(read.data.events[0].subject, "owner_decision: demo");
  assert.equal(read.data.events[0].revision, "demo-revision");
  assert.match(api.timeline(read.data.events), /Load more/);
  const first = read.data.events;
  respond({ ...page, events: [{ ...event, id: "older" }], next_cursor: null });
  read = await api.loadAuditEvents("opaque_cursor");
  assert.equal(path, "/api/audit-events?limit=25&cursor=opaque_cursor");
  assert.equal(read.data.next_cursor, null);
  assert.deepEqual(api.mergeAuditEvents(first, [...first, ...read.data.events]).map(row => row.event_id), [event.id, "older"]);
  for (const malformed of [ {}, { ...page, data_status: "partial" }, { ...page, events: null },
    { ...page, next_cursor: undefined }, { ...page, events: [{}] }, { ...page, events: [event, event] },
    { ...page, errors: ["source_unavailable"] }, { ...page, next_cursor: "" }, { ...page, events: [] } ]) {
    respond(malformed); await assert.rejects(api.loadAuditEvents(), /invalid_|duplicate_/);
  }
  respond(page); await assert.rejects(api.loadAuditEvents("opaque_cursor"), /invalid_audit_page/);
  respond({}, 404); assert.equal((await api.loadAuditEvents()).status, "not_ready");
  respond({}, 503); await assert.rejects(api.loadAuditEvents());
  globalThis.window = new EventTarget();
  let invalidations = 0;
  window.addEventListener("qsl-private-session-invalid", () => invalidations++);
  for (const status of [401, 403]) { respond({}, status); await assert.rejects(api.loadAuditEvents()); }
  assert.equal(invalidations, 2);
  const runtime = { server_time: "2026-11-01T00:01:00.000Z", schema_version: "qsl.runtime_readback.v1", scope: "longbridge:demo", data_status: "ready",
    observed_at: event.occurred_at, runtime_enabled: false, scheduler_state: "paused", strategy_profile: "demo",
    source: "stored_runtime_target_lifecycle", policy: { read_only: true, no_order: true, execution_authority_granted: false } };
  respond(runtime); read = await api.loadRuntimeReadback(runtime.scope);
  assert.equal(path, "/api/runtime/readback?scope=longbridge%3Ademo");
  assert.equal(read.data.runtime_enabled, false);
  assert.match(api.runtime(read.data), /Disabled/);
  respond({ ...runtime, data_status: "stale", runtime_enabled: null, scheduler_state: "unknown", strategy_profile: null });
  read = await api.loadRuntimeReadback(runtime.scope);
  assert.equal(read.data.runtime_enabled, null);
  assert.match(api.runtime(read.data), /Unknown/);
  assert.doesNotMatch(api.runtime(read.data), /Disabled/);
  for (const malformed of [{ ...runtime, scope: "longbridge:other" }, { ...runtime, data_status: "stale" },
    { ...runtime, observed_at: null }, { ...runtime, runtime_enabled: "false" }, { ...runtime, policy: {} }, {}]) {
    respond(malformed); await assert.rejects(api.loadRuntimeReadback(runtime.scope), /invalid_runtime_readback/);
  }
  respond({}, 503); await assert.rejects(api.loadRuntimeReadback(runtime.scope));
  respond({}, 404); assert.equal((await api.loadRuntimeReadback(runtime.scope)).status, "not_ready");
  console.log("Cockpit audit and runtime readback validation passed");
} finally {
  globalThis.fetch = originalFetch; globalThis.window = originalWindow;
  await rm(directory, { recursive: true, force: true });
}
