export function requireEnv(env, name) {
  if (!env[name]) throw new Error(`${name} is not configured`);
}
