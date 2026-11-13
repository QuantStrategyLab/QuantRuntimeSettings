/**
 * Runtime-control source / read / dispatch use cases.
 *
 * Inject runtime_support-owned helpers (account options, identity, slug, json)
 * so this module never imports runtime_support and cannot form a cycle.
 */

import { HttpError } from "../http_error.js";
import { fetchWithTimeout } from "../auth/fetch.js";
import { githubHeaders } from "../auth/github.js";
import { readRuntimeControlReceipt } from "../console_api/runtime_control_receipts.js";
import { HK_STOP_REQUEST_ID } from "../hk_stop/constants.js";
import {
  hasRuntimeInstanceStore,
  runtimeInstanceCommand,
} from "../runtime_instances/command.js";
import {
  presentRuntimeControl,
  runtimeControlIdentityIsComplete,
  runtimeControlStopRequest,
} from "./helpers.js";

/**
 * @param {any} env
 * @param {string} platform
 * @param {string} targetName
 * @param {{
 *   loadAccountOptionsConfig: Function,
 *   accountSettingsIdentity: Function,
 * }} deps
 */
export async function runtimeControlSource(env, platform, targetName, deps) {
  const { loadAccountOptionsConfig, accountSettingsIdentity } = deps;
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const source = await loadAccountOptionsConfig(env);
  if (source.source !== "durable_object" || !Number.isSafeInteger(source.revision)) {
    throw new HttpError("runtime_control_source_unavailable", 409);
  }
  const matches = (source.options?.[platform] || []).filter((item) => item.target_name === targetName);
  if (matches.length !== 1) throw new HttpError("runtime_control_identity_incomplete", 409);
  const item = matches[0];
  const identity = accountSettingsIdentity({ platform, key: item.key, config: item });
  if (!runtimeControlIdentityIsComplete(identity)) {
    throw new HttpError("runtime_control_identity_incomplete", 409);
  }
  return { item, identity, revision: source.revision };
}

/**
 * @param {any} env
 * @param {string} platform
 * @param {string} targetName
 * @param {{
 *   loadAccountOptionsConfig: Function,
 *   accountSettingsIdentity: Function,
 *   defaultRepository: string,
 * }} deps
 */
export async function readPlatformRuntimeControl(env, platform, targetName, deps) {
  const { defaultRepository } = deps;
  const source = await runtimeControlSource(env, platform, targetName, deps);
  const args = { platform, key: source.item.key };
  let { record } = await runtimeInstanceCommand(env, { action: "runtime_control_read", ...args });
  if (record && ["reserved", "accepted", "unknown", "partial"].includes(record.phase)) {
    const result = await readRuntimeControlReceipt({
      repository: env.RUNTIME_SETTINGS_REPO || defaultRepository,
      token: env.RUNTIME_SETTINGS_DISPATCH_TOKEN,
      requestId: record.request_id,
      operation: record.action,
      runId: record.workflow_run_id,
      requestedAt: record.requested_at,
    });
    if (result.run_id && !record.workflow_run_id) {
      ({ record } = await runtimeInstanceCommand(env, {
        action: "runtime_control_record",
        ...args,
        request_id: record.request_id,
        phase: "unknown",
        run_id: result.run_id,
      }));
    }
    if (result.platform_run_id && record.workflow_run_id) {
      ({ record } = await runtimeInstanceCommand(env, {
        action: "runtime_control_capture",
        ...args,
        request_id: record.request_id,
        run_id: record.workflow_run_id,
        platform_run_id: result.platform_run_id,
        reason: result.reason,
      }));
    }
    if (["applied", "partial", "protected", "rejected"].includes(result.status) && record.workflow_run_id) {
      ({ record } = await runtimeInstanceCommand(env, {
        action: "runtime_control_resolve",
        ...args,
        request_id: record.request_id,
        phase: result.status,
        run_id: record.workflow_run_id,
        reason: result.reason,
      }));
    }
  }
  let details = {};
  try { details = JSON.parse(record?.result_json || "{}"); } catch { /* retain unknown */ }
  if (record && ["accepted", "unknown", "partial"].includes(record.phase) && details.check_id && !details.check_complete) {
    const checked = await readRuntimeControlReceipt({
      repository: env.RUNTIME_SETTINGS_REPO || defaultRepository,
      token: env.RUNTIME_SETTINGS_DISPATCH_TOKEN,
      requestId: record.request_id,
      operation: record.action,
      checkId: details.check_id,
      runId: details.check_run_id,
      requestedAt: details.check_requested_at,
    });
    if (checked.run_id) {
      ({ record } = await runtimeInstanceCommand(env, {
        action: "runtime_control_record_check",
        ...args,
        request_id: record.request_id,
        check_id: details.check_id,
        run_id: checked.run_id,
        complete: checked.complete === true,
      }));
    }
    if (["applied", "partial", "protected", "rejected"].includes(checked.status) && checked.complete
        && checked.platform_run_id === details.platform_run_id) {
      ({ record } = await runtimeInstanceCommand(env, {
        action: "runtime_control_resolve",
        ...args,
        request_id: record.request_id,
        phase: checked.status,
        run_id: record.workflow_run_id,
        check_id: details.check_id,
        check_run_id: checked.run_id,
        reason: checked.reason,
      }));
    }
  }
  return presentRuntimeControl(record);
}

/**
 * @param {any} env
 * @param {any} raw
 * @param {{
 *   loadAccountOptionsConfig: Function,
 *   accountSettingsIdentity: Function,
 *   resolvedVariableScope: Function,
 *   cleanSlug: Function,
 *   defaultRepository: string,
 *   json: Function,
 * }} deps
 */
export async function dispatchPlatformRuntimeControl(env, raw, deps) {
  const { cleanSlug, defaultRepository, json } = deps;
  if (raw.confirm !== "CONTROL_ONLY" || !["ibkr", "schwab"].includes(raw.platform)
      || !["enable", "disable"].includes(raw.operation)
      || Object.keys(raw).some((key) => !["platform", "target_name", "operation", "request_id", "confirm"].includes(key))) {
    throw new HttpError("runtime_control_request_invalid", 400);
  }
  const targetName = cleanSlug(raw.target_name, "target_name");
  const requestId = raw.request_id || crypto.randomUUID();
  if (!HK_STOP_REQUEST_ID.test(requestId)) throw new HttpError("runtime_control_request_invalid", 400);
  const source = await runtimeControlSource(env, raw.platform, targetName, deps);
  const args = { platform: raw.platform, key: source.item.key };
  const claimed = await runtimeInstanceCommand(env, {
    action: "runtime_control_claim",
    ...args,
    identity: source.identity,
    source_revision: source.revision,
    request_id: requestId,
    operation: raw.operation,
  });
  if (claimed.state !== "reserved") {
    const body = presentRuntimeControl(claimed.record);
    return json(
      claimed.state === "blocked" ? { ...body, ok: false, error: "runtime_control_pending" } : body,
      claimed.state === "blocked" ? 409 : 200,
    );
  }
  const stopRequest = runtimeControlStopRequest(env, raw.platform, targetName, source, deps);
  let phase = "unknown", runId = null;
  try {
    const response = await fetchWithTimeout(
      `https://api.github.com/repos/${env.RUNTIME_SETTINGS_REPO || defaultRepository}/actions/workflows/manual-runtime-stop.yml/dispatches`,
      {
        method: "POST",
        headers: githubHeaders(env.RUNTIME_SETTINGS_DISPATCH_TOKEN),
        body: JSON.stringify({
          ref: "main",
          return_run_details: true,
          inputs: {
            stop_request: JSON.stringify(stopRequest),
            apply: "true",
            confirm: "CONTROL_ONLY",
            apply_hk_stop: "false",
            runtime_control_operation: raw.operation,
            runtime_control_request_id: requestId,
          },
        }),
      },
    );
    if (response.status === 200) {
      const body = await response.json();
      if (Number.isSafeInteger(body.workflow_run_id) && body.workflow_run_id > 0) {
        phase = "accepted";
        runId = String(body.workflow_run_id);
      }
    } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      phase = "rejected";
    }
  } catch { /* Outcome may already have occurred; never resend. */ }
  try {
    const recorded = await runtimeInstanceCommand(env, {
      action: "runtime_control_record",
      ...args,
      request_id: requestId,
      phase,
      run_id: runId,
    });
    return json(presentRuntimeControl(recorded.record), recorded.record?.phase === "rejected" ? 502 : 200);
  } catch {
    return json({ ...presentRuntimeControl(claimed.record), phase: "unknown" });
  }
}
