// Platform registry helpers derived from generated config.js.
// Keep Worker platform lists/maps here instead of duplicating literals in worker.js.

import {
  PLATFORM_CONFIG,
  PLATFORM_REPOSITORIES,
  PLATFORM_REPOSITORY_ENV_KEYS,
  PLATFORM_CASH_ONLY_EXECUTION_VARIABLES,
  PLATFORM_MIN_RESERVED_CASH_VARIABLES,
  PLATFORM_RESERVED_CASH_RATIO_VARIABLES,
  OBSERVABILITY_PLATFORMS,
  DCA_SUPPORTED_PLATFORMS,
} from "./config.js";

export const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_CONFIG);

export const DEFAULT_PLATFORM_REPOSITORIES = { ...PLATFORM_REPOSITORIES };

export const PLATFORM_REPOSITORY_ENV = { ...PLATFORM_REPOSITORY_ENV_KEYS };

export const PLATFORM_CASH_ONLY_EXECUTION_VARIABLES_MAP = {
  ...PLATFORM_CASH_ONLY_EXECUTION_VARIABLES,
};

export const PLATFORM_MIN_RESERVED_CASH_VARIABLES_MAP = {
  ...PLATFORM_MIN_RESERVED_CASH_VARIABLES,
};

export const PLATFORM_RESERVED_CASH_RATIO_VARIABLES_MAP = {
  ...PLATFORM_RESERVED_CASH_RATIO_VARIABLES,
};

export const OBSERVABILITY_PLATFORM_IDS = [...OBSERVABILITY_PLATFORMS];

export function isDcaSupportedPlatform(platform) {
  return DCA_SUPPORTED_PLATFORMS.has(platform);
}

export function resolvePlatformRepositories(env = {}) {
  const repositories = { ...DEFAULT_PLATFORM_REPOSITORIES };
  const raw =
    env.STRATEGY_SWITCH_PLATFORM_REPOSITORIES_JSON ||
    env.RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON ||
    "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [platform, repo] of Object.entries(parsed)) {
          if (typeof repo === "string" && repo.trim()) repositories[platform] = repo.trim();
        }
      }
    } catch {
      // Keep generated defaults when override JSON is invalid.
    }
  }
  for (const platform of SUPPORTED_PLATFORMS) {
    for (const name of PLATFORM_REPOSITORY_ENV[platform] || []) {
      const value = env[name];
      if (typeof value === "string" && value.trim()) {
        repositories[platform] = value.trim();
        break;
      }
    }
  }
  return repositories;
}
