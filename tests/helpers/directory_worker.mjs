// Existing business fixtures model discovery directly. Real manifest lifecycle,
// persistence and concurrency are exercised by kv_directory_validation.mjs.
import worker, { __test as originalTest } from "../../web/strategy-switch-console/worker.js";
import { installDirectoryTestAdapter } from "../../web/strategy-switch-console/kv_directory.js";

function prepare(env) {
  installDirectoryTestAdapter(env, async command => {
    const store = env.STRATEGY_SWITCH_CONFIG;
    if (command.action === "put") {
      await store.put(command.key, command.value);
      return { ok: true };
    }
    const result = await store.list({ prefix: command.prefix, limit: command.limit });
    return { ok: true, ...result };
  });
  return env;
}
export default { ...worker, fetch(request, env, ctx) { return worker.fetch(request, prepare(env), ctx); } };
export const __test = { ...originalTest,
  aggregateRuntimeTargetLifecycleSources(env) { return originalTest.aggregateRuntimeTargetLifecycleSources(prepare(env)); },
};

export async function initializeDirectory(runtime) {
  const namespace = await runtime.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const response = await namespace.get(namespace.idFromName("console-kv-directory-v1")).fetch("https://fixture.invalid/kv-directory", {
    method: "POST", body: JSON.stringify({ action: "maintain" }),
  });
  if (!response.ok) throw Error("fixture_directory_migration_failed");
}
