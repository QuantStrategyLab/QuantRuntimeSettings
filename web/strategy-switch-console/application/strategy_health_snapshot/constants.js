import { PLATFORM_CONFIG } from "../../config.js";

export const STRATEGY_HEALTH_SNAPSHOT_KEY = "strategy_health_snapshot";
export const STRATEGY_HEALTH_MAX_BODY_BYTES = 256 * 1024;
export const STRATEGY_HEALTH_DEFAULT_STALE_TTL_SECONDS = 2 * 60 * 60;
export const STRATEGY_HEALTH_STATUSES = ["healthy", "watch", "review", "critical"];
export const SUPPORTED_STRATEGY_DOMAINS = Object.freeze([
  ...new Set(Object.values(PLATFORM_CONFIG).flatMap((platform) => platform.supported_domains || [])),
]);
export const STRATEGY_HEALTH_DOMAINS = SUPPORTED_STRATEGY_DOMAINS;
export const STRATEGY_HEALTH_DATA_STATUSES = ["ready", "unavailable", "stale"];
