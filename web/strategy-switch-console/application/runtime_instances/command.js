import { HttpError } from "../http_error.js";

export function hasRuntimeInstanceStore(env) {
  return env.STRATEGY_SWITCH_RUNTIME_INSTANCES !== undefined && env.STRATEGY_SWITCH_RUNTIME_INSTANCES !== null;
}

export async function runtimeInstanceCommand(env, command) {
  const namespace = env.STRATEGY_SWITCH_RUNTIME_INSTANCES;
  if (!namespace?.idFromName || !namespace?.get) throw new HttpError("runtime_instances_not_bound", 503);
  try {
    const stub = namespace.get(namespace.idFromName("runtime-instances"));
    const response = await stub.fetch("https://runtime-instances/", command ? {
      method: "POST", body: JSON.stringify(command),
    } : {});
    let result;
    try {
      result = await response.json();
    } catch {
      throw new HttpError("runtime_instances_unavailable", response.status || 503);
    }
    if (!response.ok) throw new HttpError(result.error || "runtime_instances_unavailable", response.status);
    return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error && typeof error.status === "number") {
      throw new HttpError(error.message || "runtime_instances_unavailable", error.status);
    }
    throw new HttpError("runtime_instances_unavailable", 503);
  }
}

export function runtimeInstanceAccountOptions(instances) {
  const options = {};
  for (const instance of instances) {
    if (instance.kind !== "existing") continue;
    (options[instance.platform] ||= []).push(instance.config);
  }
  return options;
}

export function runtimeInstanceConflict(instances, platform, config, exceptKey = null) {
  const selectors = (value) => String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const item of instances) {
    if (item.platform !== platform || item.key === exceptKey) continue;
    const other = item.config;
    if (item.key === config.key || other.target_name === config.target_name ||
        (other.service_name && other.service_name === config.service_name) ||
        selectors(other.account_selector).some((value) => selectors(config.account_selector).includes(value))) {
      throw new HttpError("runtime_instance_identity_conflict", 409);
    }
  }
}

export function runtimeInstanceFields(raw, allowed) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => !allowed.includes(key))) {
    throw new HttpError("invalid_runtime_instance_fields", 400);
  }
}
