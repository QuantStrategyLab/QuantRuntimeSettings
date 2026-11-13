import { indexedKey, directoryCommand } from "../kv_directory.js";

export function configStore(env) {
  const store = env.STRATEGY_SWITCH_CONFIG;
  if (!store || typeof store.get !== "function" || typeof store.put !== "function") return null;
  return store;
}

export function hasConfigStore(env) {
  return Boolean(configStore(env));
}

export async function readConfigJson(env, key) {
  const store = configStore(env);
  if (!store) return null;
  const text = await store.get(key);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`STRATEGY_SWITCH_CONFIG.${key} must be valid JSON`);
  }
}

export async function writeConfigJson(env, key, value) {
  const store = configStore(env);
  if (!store) throw new Error("STRATEGY_SWITCH_CONFIG KV binding is required");
  const text = JSON.stringify(value, null, 2);
  if (indexedKey(key)) await directoryCommand(env, { action: "put", key, value: text });
  else await store.put(key, text);
}
