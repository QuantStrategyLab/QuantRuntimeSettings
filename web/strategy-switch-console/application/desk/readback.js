import { known, unknown } from "./read.js";
import { DeskError, deskResponse, deskJson, deskErrorResponse } from "./http.js";
import { withIdempotency } from "./idempotency.js";

export const READBACK_KEYS = Object.freeze(["strategy_profile", "broker_environment", "income_layer_enabled",
  "option_overlay_enabled", "reserved_cash_floor", "reserved_cash_ratio", "dca_mode",
  "dca_base_investment_usd", "enabled", "account_selector", "cash_currency", "runtime_status_target_id"]);
const booleans = new Set(["enabled", "income_layer_enabled", "option_overlay_enabled"]);
const decimals = new Set(["reserved_cash_floor", "reserved_cash_ratio", "dca_base_investment_usd"]);
const TTL = 86400_000;
const REFRESH_INTERVAL = 30_000;
const admissionPrefix = "desk:readbacks:admission:";
// GitHub login is stable across sessions and case-insensitive.
const admissionKey = actor => admissionPrefix + actor.toLowerCase();
const prefix = "desk:readbacks:record:";

export function normalizeReadbackValue(key, value, cleanRatio, splitSelectorValues) {
  if (key === "account_selector") {
    const values = Array.isArray(value) ? value : [value];
    if (!values.length || values.some(item => typeof item !== "string" || !item.trim())) return null;
    const selectors = splitSelectorValues(value);
    return selectors.length ? [...new Set(selectors)].sort() : null;
  }
  if (value === null || value === undefined || !["string", "boolean", "number"].includes(typeof value)) return null;
  const text = String(value).trim();
  if (booleans.has(key)) return /^(true|1)$/i.test(text) ? "true" : /^(false|0)$/i.test(text) ? "false" : null;
  if (decimals.has(key)) {
    if (!/^(?:\d+|\d*\.\d+)$/.test(text) || (key.endsWith("_ratio") && !cleanRatio(text))) return null;
    // Canonical decimal spelling without floating-point rounding.
    return text.replace(/^\./, "0.").replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  return text || null;
}

export function buildReadback({ target, observed, platform = {}, platformReason = "never_read", now, cleanRatio, splitSelectorValues }) {
  const time = new Date(now).toISOString();
  const revision = observed?.instance_revision ?? target.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new DeskError("store_unavailable", 503);
  const config = observed?.config || target.config;
  const draft = observed?.draft;
  const saved = { ...config, strategy_profile: config.default_strategy_profile, enabled: observed?.enabled };
  if (draft?.status === "current") Object.assign(saved, draft.overrides);
  const fields = READBACK_KEYS.map(key => {
    const left = normalizeReadbackValue(key, saved[key], cleanRatio, splitSelectorValues);
    const right = normalizeReadbackValue(key, platform[key], cleanRatio, splitSelectorValues);
    const savedUnknown = !observed ? "source_unavailable" : draft?.status === "identity_conflict" ? "identity_unverified" : "never_read";
    const wrap = (value, reason) => value === null ? unknown(reason) : known(key === "account_selector" ? value.map(selector => `•••${selector.slice(-4)}`).join(", ") : value, time);
    // Compare complete selector identities before exposing only masked suffixes.
    const equal = key === "account_selector" ? JSON.stringify(left) === JSON.stringify(right) : left === right;
    const a = draft?.status === "identity_conflict" || !observed ? null : left;
    return { key, label: key, saved: wrap(a, savedUnknown), platform: wrap(right, platformReason),
      state: a === null || right === null ? "unknown" : equal ? "match" : "drift" };
  });
  const summary = { match: 0, drift: 0, unknown: 0 };
  for (const field of fields) summary[field.state]++;
  return { target_id: target.id, readback_id: `rb_${crypto.randomUUID()}`, read_at: time,
    saved_revision: revision,
    overall: summary.drift ? "drift" : summary.unknown ? "unknown" : "match", summary, fields,
    identity: { account_suffix: config.account_selector ? String(config.account_selector).slice(-4) : null,
      broker_environment: ["live", "paper"].includes(config.broker_environment) ? config.broker_environment : null,
      service: config.service_name || null, runtime_status_target_id: config.runtime_status_target_id || null },
    facts_binding: unknown("identity_unverified"), alert_route: null,
    actions: { reapply_saved: { allowed: false, reason_code: "not_enabled" }, adopt_platform: { allowed: false, reason_code: "not_enabled" } } };
}

export function readbackTargets(config) {
  return Object.entries(config.options || {}).flatMap(([platform, options]) => options.map(option => ({
    id: `${platform}/${option.target_name}`, platform, key: option.key, config: option, revision: config.revision, optionsCount: options.length,
  })));
}

/**
 * Desk target readback use-case. Inject runtime_support helpers via DI so this
 * module never imports runtime_support.js (avoids circular Worker/DO graphs).
 */
export function createDeskTargetReadback(deps) {
  const {
    runtimeInstanceCommand,
    readRiskProfileLegacy,
    platformRepositories,
    fetchGithubVariables,
    resolveCurrentStrategyForAccount,
    resolveVariableScope,
    resolveGithubEnvironment,
    runtimeTargetFromServiceTargets,
    parseJsonObject,
    runtimeTargetMatchesAccount,
    cleanCurrentRatio,
    splitSelectorValues,
  } = deps;

  // Desk reads deliberately bypass the current-strategies memory/KV cache. Raw
  // variable maps stay local; only explicit resolver fields enter the projection.
  return async function deskTargetReadback(env, target, actor, suppliedObserved = undefined) {
    let observed = suppliedObserved;
    if (observed === undefined) {
      try {
        observed = await runtimeInstanceCommand(env, { action: "account_settings_read", actor,
          platform: target.platform, key: target.key, legacy: await readRiskProfileLegacy(env) });
      } catch { observed = null; }
    }
    if (observed && observed.config?.target_name !== target.config.target_name) throw new DeskError("not_found", 404);
    const config = observed?.config || target.config;
    const token = env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
    const repository = platformRepositories(env)?.[target.platform];
    let platform = {}, platformReason = "source_unavailable";
    if (token && repository && config) {
      const cache = new Map();
      let failed = false;
      const readVariable = async (repo, scope, environment, name) => {
        const key = JSON.stringify([repo, scope, environment]);
        if (!cache.has(key)) cache.set(key, fetchGithubVariables(token, repo, scope, environment, { reportReadErrors: true }));
        const variables = await cache.get(key);
        if (variables === null) failed = true;
        return variables?.get(name) || "";
      };
      try {
        const options = observed?.account_options?.[target.platform] || [];
        const current = await resolveCurrentStrategyForAccount({ platform: target.platform, option: config,
          optionsCount: options.length || target.optionsCount || 1, repository, readVariable });
        if (failed) throw new Error("read_failed");
        const scope = resolveVariableScope(target.platform, config);
        const environment = resolveGithubEnvironment(target.platform, config, scope);
        // Identity must come from a uniquely matched runtime record, never config.
        const service = current?.source === "CLOUD_RUN_SERVICE_TARGETS_JSON"
          ? runtimeTargetFromServiceTargets(await readVariable(repository, "repository", "", "CLOUD_RUN_SERVICE_TARGETS_JSON"), target.platform, config) : null;
        const runtime = current?.source === "RUNTIME_TARGET_JSON"
          ? parseJsonObject(await readVariable(repository, scope, environment, "RUNTIME_TARGET_JSON")) : null;
        if (failed) throw new Error("read_failed");
        const identity = current?.source === "CLOUD_RUN_SERVICE_TARGETS_JSON" ? service
          : runtime && runtimeTargetMatchesAccount(runtime, target.platform, config) ? runtime : null;
        platform = { strategy_profile: current?.strategy_profile, enabled: current?.runtime_target_enabled,
          income_layer_enabled: current?.income_layer_enabled, option_overlay_enabled: current?.option_overlay_enabled,
          reserved_cash_floor: current?.min_reserved_cash_usd, reserved_cash_ratio: current?.reserved_cash_ratio,
          dca_mode: current?.dca_mode, dca_base_investment_usd: current?.dca_base_investment_usd,
          broker_environment: identity?.broker_environment, account_selector: identity?.account_selector,
          cash_currency: identity?.cash_currency, runtime_status_target_id: identity?.runtime_status_target_id };
        platformReason = "never_read";
      } catch { platform = {}; platformReason = "read_failed"; }
    }
    return buildReadback({ target, observed, platform, platformReason, now: Date.now(), cleanRatio: cleanCurrentRatio, splitSelectorValues });
  };
}

export async function deskReadbackResponse(request, env, deps) {
  try {
    const url = new URL(request.url);
    const session = await deps.auth(request, env, { write: request.method === "POST" });
    // Session cookie is hashed; no raw session token is persisted or forwarded.
    // Match readSession's last-cookie-wins decoding and accepted token parts.
    const cookie = (request.headers.get("Cookie") || "").split(";").map(part => part.trim())
      .filter(part => part.startsWith("qsl_switch_session=")).at(-1)?.slice(19) || "";
    const sessionKey = decodeURIComponent(cookie).split(".", 2).join(".");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionKey || session.login));
    const owner = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
    const command = async data => {
      try { return await deps.command(env, { ...data, owner, actor: session.login }); }
      catch (error) { throw new DeskError([400, 404, 409, 429, 503].includes(error.status) ? error.message : "store_unavailable", [400, 404, 409, 429, 503].includes(error.status) ? error.status : 503); }
    };
    const targetsForRequest = async () => {
      try { return readbackTargets(await deps.options(env)); }
      catch { throw new DeskError("store_unavailable", 503); }
    };
    const targetMatch = url.pathname.match(/^\/api\/desk\/targets\/(.+)\/readback$/);
    if (request.method === "GET" && targetMatch) {
      const targets = await targetsForRequest();
      const target = targets.find(item => item.id === decodeURIComponent(targetMatch[1]));
      if (!target) throw new DeskError("not_found", 404);
      const { payload } = await command({ action: "desk_readback_fresh", id: target.id });
      return deskResponse("readback", payload);
    }
    const pollMatch = url.pathname.match(/^\/api\/desk\/readbacks\/([A-Za-z0-9_-]+)$/);
    if (request.method === "GET" && pollMatch) {
      const { payload } = await command({ action: "desk_readback_get", id: pollMatch[1] });
      return deskResponse(payload.target_id ? "readback" : "readback_job", payload);
    }
    if (request.method !== "POST" || url.pathname !== "/api/desk/readbacks") throw new DeskError("not_found", 404);
    if (!(request.headers.get("Content-Type") || "").match(/^application\/json(?:\s*;|$)/i)) throw new DeskError("invalid_json", 400);
    const reader = request.body?.getReader();
    const chunks = [];
    let length = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new DeskError("body_too_large", 400); }
      chunks.push(value);
    }
    const text = await new Blob(chunks).text();
    let body;
    try { body = JSON.parse(text); } catch { throw new DeskError("invalid_json", 400); }
    if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).some(key => !["target_ids", "idempotency_key"].includes(key))) throw new DeskError("invalid_request", 400);
    const targets = await targetsForRequest();
    const ids = Object.hasOwn(body, "target_ids") ? body.target_ids : targets.map(target => target.id);
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string")) throw new DeskError("invalid_targets", 400);
    if (ids.some(id => !targets.some(target => target.id === id))) throw new DeskError("not_found", 404);
    const result = await command({ action: "desk_readback_start", body, ids });
    return deskJson(result.body, result.status);
  } catch (error) { return deskErrorResponse(error); }
}

// Uses the existing RuntimeInstances DO. Alarms perform one fresh target read at
// a time, survive Worker lifetimes, and physically expire snapshots after 24h.
export class DeskReadbackStore {
  constructor(storage, read, now = () => Date.now()) { this.storage = storage; this.read = read; this.now = now; }
  async claim(txn, actor, id, now) {
    const key = admissionKey(actor);
    const current = await txn.get(key);
    if (current?.expires > now) {
      if (current.active) throw new DeskError("readback_in_progress", 429);
      if (current.nextAllowed > now) throw new DeskError("readback_rate_limited", 429);
    }
    await txn.put(key, { active: id, nextAllowed: now + REFRESH_INTERVAL, expires: now + TTL });
    const alarm = await txn.getAlarm();
    if (alarm === null || alarm > now + TTL) await txn.setAlarm(now + TTL);
  }
  async release(actor, id) {
    await this.storage.transaction(async txn => {
      const key = admissionKey(actor);
      if ((await txn.get(key))?.active === id) {
        const now = this.now();
        await txn.put(key, { active: null, nextAllowed: now + REFRESH_INTERVAL, expires: now + TTL });
      }
    });
  }
  async command(command) {
    const { storage } = this;
    const now = this.now();
    if (!command.owner || !command.actor) throw new DeskError("login_required", 401);
    if (command.action === "desk_readback_fresh") {
      const id = crypto.randomUUID();
      await storage.transaction(txn => this.claim(txn, command.actor, id, now));
      try {
        const payload = await this.read(command.id, command.actor);
        await this.command({ ...command, action: "desk_readback_put", payload });
        return { payload };
      } finally { await this.release(command.actor, id); }
    }
    if (command.action === "desk_readback_start") {
      const payloadFor = id => ({ readback_id: `rbj_${id}`, state: "running", started_at: new Date(now).toISOString(), retry_after_ms: 2000 });
      return withIdempotency(storage, {
        scope: `${command.owner}:POST:/api/desk/readbacks`, body: command.body,
        reserve: async (txn, id) => {
          const payload = payloadFor(id);
          await this.claim(txn, command.actor, payload.readback_id, now);
          await txn.put(prefix + payload.readback_id, { owner: command.owner, actor: command.actor, expires: now + TTL, payload, pending: command.ids, results: [] });
          await txn.setAlarm(now + 1);
        },
      }, async id => ({ status: 202, body: await deskResponse("readback_start", { ...payloadFor(id), no_order: true }, { now }).json() }));
    }
    if (command.action === "desk_readback_put") {
      await storage.transaction(async txn => {
        await txn.put(prefix + command.payload.readback_id, { owner: command.owner, expires: now + TTL, payload: command.payload });
        const alarm = await txn.getAlarm();
        if (alarm === null || alarm > now + TTL) await txn.setAlarm(now + TTL);
      });
      return { ok: true };
    }
    if (command.action === "desk_readback_get") {
      const record = await storage.get(prefix + command.id);
      if (!record || record.owner !== command.owner || record.expires <= now) throw new DeskError("not_found", 404);
      return { payload: record.payload };
    }
    throw new DeskError("invalid_request", 400);
  }
  async alarm() {
    const { storage } = this;
    const now = this.now();
    const records = await storage.list({ prefix });
    // Re-arm before source I/O; an interrupted read can safely be retried.
    await storage.setAlarm(now + 1000);
    let ran = false;
    for (const [key, record] of records) {
      if (record.expires <= now) {
        await storage.delete(key);
        continue;
      }
      if (record.payload.state !== "running" || ran) continue;
      ran = true;
      const targetId = record.pending[0];
      try {
        const payload = await this.read(targetId, record.actor);
        await this.command({ action: "desk_readback_put", payload, owner: record.owner, actor: record.actor });
        const failed = payload.fields.every(field => field.platform.status === "unknown");
        record.results.push(failed ? { target_id: targetId, state: "failed", error: "read_failed" }
          : { target_id: targetId, state: "done", overall: payload.overall, readback_id: payload.readback_id });
      } catch { record.results.push({ target_id: targetId, state: "failed", error: "read_failed" }); }
      record.pending.shift();
      if (!record.pending.length) {
        const failures = record.results.filter(result => result.state === "failed").length;
        record.payload = { readback_id: record.payload.readback_id, state: failures === record.results.length ? "failed" : failures ? "partial" : "done", results: record.results };
        await this.release(record.actor, record.payload.readback_id);
      }
      await storage.put(key, record);
    }
    // Re-read transactionally: a new session may have queued a job during I/O.
    await storage.transaction(async txn => {
      let next = Infinity;
      for (const record of (await txn.list({ prefix })).values()) {
        next = Math.min(next, record.payload.state === "running" ? this.now() + 1 : record.expires);
      }
      for (const [key, admission] of await txn.list({ prefix: admissionPrefix })) {
        if (admission.expires <= this.now()) await txn.delete(key);
        else next = Math.min(next, admission.expires);
      }
      if (Number.isFinite(next)) await txn.setAlarm(next);
      else await txn.deleteAlarm();
    });
  }
}
