// Strategy catalog gate helpers. Pure functions only — no KV/network.

export const LIVE_SWITCHABLE_LIFECYCLE_STAGES = new Set([
  "live_enabled",
  "runtime_enabled",
]);

export function normalizeLifecycleStage(value) {
  const stage = String(value || "").trim();
  if (!stage) return "research_active";
  return stage;
}

export function isLiveSwitchAllowed(strategy) {
  if (!strategy || typeof strategy !== "object") return false;
  if (strategy.runtime_enabled !== true) return false;
  if (strategy.can_switch_live !== true) return false;
  const stage = normalizeLifecycleStage(strategy.lifecycle_stage);
  return LIVE_SWITCHABLE_LIFECYCLE_STAGES.has(stage);
}

export function assertLiveSwitchAllowed(strategy, profileId) {
  if (isLiveSwitchAllowed(strategy)) return;
  const reason = strategy?.blocked_live_reason || strategy?.lifecycle_stage || "not_runtime_enabled";
  throw new Error(`strategy ${profileId} is not live-enabled (${reason})`);
}

export function catalogVersionMetadata(profiles, source = "bundle") {
  const enabled = (profiles || [])
    .filter((item) => item?.runtime_enabled === true)
    .map((item) => item.profile);
  return {
    source,
    profile_count: Array.isArray(profiles) ? profiles.length : 0,
    runtime_enabled_profiles: enabled,
    generated_at: new Date().toISOString(),
  };
}
