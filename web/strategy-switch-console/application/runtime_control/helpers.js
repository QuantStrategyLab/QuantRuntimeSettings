/**
 * Runtime-control presentation and identity helpers.
 *
 * Leaf-safe: imports platform_registry only. Inject resolvedVariableScope from
 * runtime_support so this module never imports runtime_support.js.
 */

import {
  SUPPORTED_PLATFORMS,
  resolvePlatformRepositories,
} from "../../platform_registry.js";

export function presentRuntimeControl(record) {
  let reason = null;
  try {
    reason = record?.result_json ? JSON.parse(record.result_json).reason || null : null;
  } catch { /* invalid persisted result stays unclassified */ }
  return {
    ok: record?.phase !== "rejected",
    request_id: record?.request_id || null,
    action: record?.action || null,
    phase: record?.phase || null,
    updated_at: record?.updated_at || null,
    unavailable_reason: reason || (record?.phase === "unknown" ? "runtime_control_result_unavailable" : null),
    platform_applied: record?.phase === "applied",
  };
}

export function runtimeControlIdentityIsComplete(identity) {
  return Boolean(identity && SUPPORTED_PLATFORMS.includes(identity.platform)
    && [null, "live", "paper"].includes(identity.broker_environment)
    && ["key", "target_name", "account_selector", "deployment_selector", "account_scope", "service_name"]
      .every((field) => typeof identity[field] === "string" && identity[field].trim() !== ""));
}

/**
 * @param {any} env
 * @param {string} platform
 * @param {string} targetName
 * @param {{ item: any, identity: any, revision: number }} source
 * @param {{ resolvedVariableScope: Function }} deps
 */
export function runtimeControlStopRequest(env, platform, targetName, source, deps) {
  const { resolvedVariableScope } = deps;
  const item = source.item;
  const inputs = { ...item, platform, target_name: targetName };
  const github = {
    repository: resolvePlatformRepositories(env)[platform],
    variable_scope: resolvedVariableScope(item.variable_scope, inputs),
  };
  if (github.variable_scope === "environment") github.environment = item.github_environment;
  return {
    target_id: `${platform}/${targetName}`,
    github,
    runtime_target: {
      platform_id: platform,
      deployment_selector: source.identity.deployment_selector,
      account_selector: source.identity.account_selector.split(",").map((value) => value.trim()).filter(Boolean),
      account_scope: source.identity.account_scope,
      service_name: source.identity.service_name,
    },
  };
}
