/**
 * HK stop HTTP / account loading use cases.
 *
 * Inject runtime_support-owned helpers (auth token, JSON body, account options)
 * so this module never imports runtime_support and cannot form a cycle.
 */

import { HttpError } from "../http_error.js";
import { hasRuntimeInstanceStore, runtimeInstanceCommand } from "../runtime_instances/command.js";
import {
  hkStopIdentityComplete,
  hkStopSourceIdentity,
  normalizeHkStopResult,
} from "./helpers.js";

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   requireDedicatedExecutionEvidenceSyncToken: Function,
 *   readBoundedJson: Function,
 *   json: Function,
 * }} deps
 */
export async function acceptHkStopResult(request, env, deps) {
  const {
    requireDedicatedExecutionEvidenceSyncToken,
    readBoundedJson,
    json,
  } = deps;
  requireDedicatedExecutionEvidenceSyncToken(request, env);
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const result = normalizeHkStopResult(await readBoundedJson(request, 8192), env);
  const recorded = await runtimeInstanceCommand(env, {
    action: "hk_stop_accept_result",
    result,
    now: new Date().toISOString(),
  });
  return json({
    ok: true,
    replayed: recorded.replayed === true,
    phase: "stopped",
    stop_confirmed: true,
    platform_applied: false,
    request_succeeded: false,
    in_flight_state: "unknown",
  });
}

/**
 * @param {any} env
 * @param {{ loadAccountOptionsConfig: Function }} deps
 */
export async function loadHkStopAccount(env, deps) {
  const { loadAccountOptionsConfig } = deps;
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const loaded = await loadAccountOptionsConfig(env);
  if (loaded.source !== "durable_object" || !Number.isSafeInteger(loaded.revision)) {
    throw new HttpError("hk_stop_source_unavailable", 409);
  }
  const matches = (loaded.options?.longbridge || []).filter((item) => item.key === "hk" && item.target_name === "hk");
  if (matches.length !== 1) throw new HttpError("stop requires one configured target", 400);
  const identity = hkStopSourceIdentity(matches[0], { key: "hk" });
  if (!hkStopIdentityComplete(identity)) throw new HttpError("hk_stop_identity_incomplete", 400);
  return { revision: loaded.revision, identity };
}
