import {
  BROKER_ENVIRONMENTS,
  normalizeAccountOptionsPayload as normalizeAccountOptionsSchemaPayload,
} from "../../account_options_schema.js";
import {
  DCA_SUPPORTED_PLATFORMS,
  PLATFORM_CONFIG,
} from "../../config.js";
import { resolvePlatformRepositories } from "../../platform_registry.js";
import { canonicalStrategyProfile } from "../../strategy_identity.js";
import { DEFAULT_STRATEGY_PROFILES } from "../../strategy_profiles_asset.js";
import {
  assertExactObject,
  assertPlainObject,
  cleanChoice,
  cleanLabel,
  cleanNonNegativeNumber,
  cleanOptionalBoolean,
  cleanPositiveNumber,
  cleanRatio,
  cleanSlug,
} from "../schema_validators.js";
import { STRATEGY_HEALTH_DOMAINS } from "../strategy_health_snapshot/constants.js";
import {
  CASH_ONLY_EXECUTION_MODES,
  DCA_PROFILE_CONFIG,
  LEGACY_INCOME_LAYER_CONTROL_FIELDS,
  LEGACY_INCOME_LAYER_VARIABLES,
  OPTION_OVERLAY_CONTROL_FIELDS,
  OPTION_OVERLAY_MODES,
  OPTION_OVERLAY_PROFILE_FIELDS,
  OPTION_OVERLAY_VARIABLES,
  SUPPORTED_PLATFORMS,
} from "./constants.js";

export function validateAccountOptionsSchemaOrThrow(payload, fieldName = "account_options") {
  return normalizeAccountOptionsSchemaPayload(payload, fieldName);
}

export function cleanCurrentStrategy(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text.length > 120 || !/^[a-z0-9._=-]+$/.test(text)) return "";
  return text;
}

export function cleanCsv(value, field) {
  const text = String(value || "").trim();
  if (text.length > 300 || !/^[A-Za-z0-9._=,\-\s]+$/.test(text)) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}

export function parseAccountOptions(raw, fieldName = "account options") {
  const text = String(raw || "").trim();
  if (!text) return null;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${fieldName} must be valid JSON`);
  }
  return normalizeAccountOptionsPayload(payload, fieldName);
}

export function normalizeAccountOptionsInput(value, fieldName) {
  if (typeof value === "string") return parseAccountOptions(value, fieldName) || {};
  return normalizeAccountOptionsPayload(value, fieldName);
}

export function parseStrategyProfiles(raw, fieldName = "strategy profiles") {
  const text = String(raw || "").trim();
  if (!text) return null;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${fieldName} must be valid JSON`);
  }
  return normalizeStrategyProfilesPayload(payload, fieldName);
}

export function isFrozenStrategyProfile(strategy) {
  const profile = canonicalStrategyProfile(strategy?.profile);
  return strategy?.frozen === true || DEFAULT_STRATEGY_PROFILES.some((item) => item.profile === profile && item.frozen === true);
}

export function normalizeStrategyProfilesPayload(payload, fieldName = "strategy profiles") {
  if (!Array.isArray(payload) || payload.length > 100) {
    throw new Error(`${fieldName} must be an array with at most 100 items`);
  }

  const result = [];
  const seen = new Set();
  for (const [index, item] of payload.entries()) {
    assertPlainObject(item, `${fieldName}[${index}]`);
    const profile = cleanCurrentStrategy(item.profile || item.strategy_profile);
    if (!profile) throw new Error(`${fieldName}[${index}].profile is invalid`);
    if (seen.has(profile)) continue;
    seen.add(profile);
    const entry = {
      profile,
      label: cleanLabel(item.label || item.display_name || profile, `${fieldName}[${index}].label`),
      runtime_enabled: cleanProfileBoolean(item.runtime_enabled ?? false),
    };
    addConfigOptional(entry, "label_en", item.label_en || item.display_name_en || item.label, cleanLabel);
    addConfigOptional(entry, "label_zh", item.label_zh || item.display_name_zh, cleanLabel);
    const rawDomain = typeof item.domain === "string" ? item.domain.trim() : "";
    entry.domain = cleanStrategyDomain(rawDomain || "us_equity", `${fieldName}[${index}].domain`);
    Object.defineProperty(entry, "domain_explicit", { value: rawDomain !== "", enumerable: false });
    if (isFrozenStrategyProfile(item)) entry.frozen = true;
    const sourceLifecycleStage = item.lifecycle_stage || item.lifecycleStage;
    const canSwitchLive = cleanOptionalBoolean(item.can_switch_live);
    if (canSwitchLive !== null) entry.can_switch_live = canSwitchLive;
    const allowedExecutionModes = cleanAllowedExecutionModes(item.allowed_execution_modes);
    if (allowedExecutionModes.length) entry.allowed_execution_modes = allowedExecutionModes;
    if (sourceLifecycleStage) {
      entry.lifecycle_stage = canonicalLifecycleStage(sourceLifecycleStage, {
        runtimeEnabled: entry.runtime_enabled === true,
        canSwitchLive: canSwitchLive === true,
        allowedExecutionModes,
      });
    }
    addConfigOptional(entry, "blocked_live_reason", item.blocked_live_reason, cleanLabel);
    if (item.live_continuity !== undefined && item.live_continuity !== null) {
      entry.live_continuity = normalizeLiveContinuityPolicy(
        item.live_continuity,
        `${fieldName}[${index}].live_continuity`,
      );
    }
    if (item.research_candidate_identity !== undefined && item.research_candidate_identity !== null) {
      entry.research_candidate_identity = normalizeResearchCandidateIdentity(
        item.research_candidate_identity,
        `${fieldName}[${index}].research_candidate_identity`,
        profile,
      );
    }
    addConfigOptional(entry, "latest_evidence_status", item.latest_evidence_status, cleanLifecycleStage);
    addConfigOptional(entry, "plugin_gate_status", item.plugin_gate_status, cleanLifecycleStage);
    const dcaEnabled = item.dca_enabled === true || Boolean(DCA_PROFILE_CONFIG[profile]);
    if (dcaEnabled) {
      const dcaDefaults = DCA_PROFILE_CONFIG[profile] || null;
      entry.dca_enabled = true;
      entry.dca_default_mode = cleanDcaMode(item.dca_default_mode || item.default_dca_mode || dcaDefaults?.default_mode || "fixed");
      entry.dca_default_base_investment_usd = cleanPositiveNumber(
        item.dca_default_base_investment_usd
          || item.default_dca_base_investment_usd
          || dcaDefaults?.default_base_investment_usd
          || "1000",
        `${fieldName}[${index}].dca_default_base_investment_usd`,
      );
    }
    if (item.combo_enabled === true) {
      entry.combo_enabled = true;
      entry.combo_mode = String(item.combo_mode || "dynamic").trim() || "dynamic";
    }
    const incomeLayerConfig = incomeLayerConfigFromProfileItem(item, `${fieldName}[${index}]`);
    if (incomeLayerConfig) Object.assign(entry, incomeLayerConfig);
    const optionOverlayConfig = optionOverlayConfigFromProfileItem(item, `${fieldName}[${index}]`);
    if (optionOverlayConfig) Object.assign(entry, optionOverlayConfig);
    result.push(entry);
  }
  return result;
}

export function normalizeResearchCandidateIdentity(value, fieldName, profile) {
  assertPlainObject(value, fieldName);
  assertExactObject(value, ["candidate_id", "config_sha256"], fieldName);
  const candidateId = cleanCurrentStrategy(value.candidate_id);
  if (!candidateId || candidateId !== profile) {
    throw new Error(`${fieldName}.candidate_id must match profile`);
  }
  const configSha256 = String(value.config_sha256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(configSha256)) {
    throw new Error(`${fieldName}.config_sha256 must be a 64-character sha256`);
  }
  return { candidate_id: candidateId, config_sha256: configSha256 };
}

export function normalizeLiveContinuityPolicy(value, fieldName) {
  assertPlainObject(value, fieldName);
  const unsupported = Object.keys(value).filter((key) => !["eligible", "allowed_platforms"].includes(key));
  if (unsupported.length) {
    throw new Error(`${fieldName} contains unsupported fields: ${unsupported.sort().join(", ")}`);
  }
  if (typeof value.eligible !== "boolean") {
    throw new Error(`${fieldName}.eligible must be boolean`);
  }
  if (!Array.isArray(value.allowed_platforms)) {
    throw new Error(`${fieldName}.allowed_platforms must be an array`);
  }
  const allowedPlatforms = value.allowed_platforms.map((platform) =>
    cleanChoice(platform, SUPPORTED_PLATFORMS, `${fieldName}.allowed_platforms`),
  );
  if (new Set(allowedPlatforms).size !== allowedPlatforms.length) {
    throw new Error(`${fieldName}.allowed_platforms must not contain duplicates`);
  }
  if (value.eligible && !allowedPlatforms.length) {
    throw new Error(`${fieldName}.eligible requires allowed_platforms`);
  }
  return { eligible: value.eligible, allowed_platforms: allowedPlatforms };
}

export function rejectResearchOnlyExtraVariables(extraVariables) {
  const blocked = [
    ...LEGACY_INCOME_LAYER_CONTROL_FIELDS,
    ...LEGACY_INCOME_LAYER_VARIABLES,
    ...OPTION_OVERLAY_CONTROL_FIELDS,
    ...OPTION_OVERLAY_VARIABLES,
  ].filter((name) => extraVariables[name] !== undefined);
  if (blocked.length) {
    throw new Error(
      `direct option overlay settings and legacy income controls are research-only: ${blocked.join(", ")}`,
    );
  }
}

export function incomeLayerConfigFromProfileItem(item, fieldName) {
  const hasIncomeLayerConfig = [
    "income_layer_enabled",
    "income_layer_start_usd",
    "income_layer_max_ratio",
    "income_layer_allocations",
  ].some((field) => item[field] !== undefined && item[field] !== null && String(item[field]).trim() !== "");
  if (!hasIncomeLayerConfig) return null;
  const enabled = item.income_layer_enabled === undefined || item.income_layer_enabled === null
    ? true
    : cleanProfileBoolean(item.income_layer_enabled);
  if (!enabled) return { income_layer_enabled: false };
  return {
    income_layer_enabled: true,
    income_layer_start_usd: cleanNonNegativeNumber(
      item.income_layer_start_usd,
      `${fieldName}.income_layer_start_usd`,
    ),
    income_layer_max_ratio: cleanRatio(item.income_layer_max_ratio, `${fieldName}.income_layer_max_ratio`),
    income_layer_allocations: cleanIncomeLayerAllocations(
      item.income_layer_allocations,
      `${fieldName}.income_layer_allocations`,
    ),
  };
}

export function optionOverlayConfigFromProfileItem(item, fieldName) {
  const hasOptionOverlayConfig = OPTION_OVERLAY_PROFILE_FIELDS.some((field) =>
    item[field] !== undefined && item[field] !== null && String(item[field]).trim() !== "",
  );
  if (!hasOptionOverlayConfig) return null;
  const enabled = item.option_overlay_enabled === undefined || item.option_overlay_enabled === null
    ? true
    : cleanProfileBoolean(item.option_overlay_enabled);
  const result = { option_overlay_enabled: enabled };
  addConfigOptional(
    result,
    "option_overlay_live_gate",
    item.option_overlay_live_gate || (enabled ? "promotion_required" : "disabled"),
    (value, field) => cleanChoice(value, ["promotion_required", "live_allowed", "disabled"], field),
  );
  addConfigOptional(
    result,
    "option_overlay_live_status",
    item.option_overlay_live_status || (enabled ? "research_only" : "disabled"),
    (value, field) => cleanChoice(value, ["research_only", "live_allowed", "disabled"], field),
  );
  if (!enabled) return result;

  addOptionalOptionFamilyConfig(result, item, "growth", fieldName);
  addOptionalOptionFamilyConfig(result, item, "income", fieldName);
  return result;
}

export function addOptionalOptionFamilyConfig(target, item, family, fieldName) {
  const prefix = `option_${family}_overlay`;
  const enabledField = `${prefix}_enabled`;
  if (item[enabledField] === undefined || item[enabledField] === null || String(item[enabledField]).trim() === "") {
    return;
  }
  const enabled = cleanProfileBoolean(item[enabledField]);
  target[enabledField] = enabled;
  if (!enabled) return;

  target[`${prefix}_recipe`] = cleanSlug(item[`${prefix}_recipe`], `${fieldName}.${prefix}_recipe`);
  target[`${prefix}_start_usd`] = cleanNonNegativeNumber(
    item[`${prefix}_start_usd`],
    `${fieldName}.${prefix}_start_usd`,
  );
  if (family === "growth") {
    target.option_growth_overlay_nav_budget_ratio = cleanRatio(
      item.option_growth_overlay_nav_budget_ratio,
      `${fieldName}.option_growth_overlay_nav_budget_ratio`,
    );
  } else {
    target.option_income_overlay_nav_risk_ratio = cleanRatio(
      item.option_income_overlay_nav_risk_ratio,
      `${fieldName}.option_income_overlay_nav_risk_ratio`,
    );
  }
}

export function cleanIncomeLayerAllocations(value, fieldName) {
  assertPlainObject(value, fieldName);
  const result = {};
  let total = 0;
  for (const [rawSymbol, rawWeight] of Object.entries(value)) {
    const symbol = String(rawSymbol || "").trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) throw new Error(`${fieldName} contains an invalid symbol`);
    const weight = Number(cleanPositiveNumber(rawWeight, `${fieldName}.${symbol}`));
    total += weight;
    result[symbol] = weight;
  }
  if (!Object.keys(result).length || total <= 0) throw new Error(`${fieldName} must contain positive allocations`);
  return result;
}

export function cleanProfileBoolean(value) {
  if (value === true || value === "true" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  throw new Error("runtime_enabled must be boolean");
}

export function normalizeAccountOptionsPayload(payload, fieldName = "account options") {
  assertPlainObject(payload, fieldName);
  validateAccountOptionsSchemaOrThrow(payload, fieldName);

  const result = {};
  for (const platform of SUPPORTED_PLATFORMS) {
    const items = payload[platform];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.length > 20) {
      throw new Error(`${fieldName}.${platform} must be an array with at most 20 items`);
    }
    result[platform] = items.map((item, index) => cleanAccountOption(item, platform, index));
  }
  return result;
}

export function cleanAccountOption(item, platform, index) {
  assertPlainObject(item, `account option ${platform}[${index}]`);
  const key = cleanSlug(item.key || item.target_name || `${platform}-${index}`, "account key");
  const label = cleanLabel(item.label || item.target_name || key, "account label");
  const option = {
    key,
    label,
    target_name: cleanSlug(item.target_name || key, "target_name"),
  };
  addConfigOptional(option, "account_selector", item.account_selector, cleanCsv);
  addConfigOptional(option, "deployment_selector", item.deployment_selector, cleanSlug);
  addConfigOptional(option, "account_scope", item.account_scope, cleanSlug);
  addConfigOptional(option, "service_name", item.service_name, cleanSlug);
  addConfigOptional(option, "runtime_status_target_id", item.runtime_status_target_id, cleanSlug);
  addConfigOptional(option, "broker_environment", item.broker_environment, normalizeBrokerEnvironment);
  addConfigOptional(option, "default_execution_mode", item.default_execution_mode, cleanExecutionMode);
  addConfigOptional(option, "default_strategy_profile", item.default_strategy_profile, cleanSlug);
  addConfigOptional(
    option,
    "cash_currency",
    item.cash_currency || item.market_currency || item.trading_currency,
    cleanCashCurrency,
  );
  addConfigOptional(option, "github_environment", item.github_environment, cleanSlug);
  addConfigOptional(option, "variable_scope", item.variable_scope, (value, field) =>
    cleanChoice(value || "default", ["default", "repository", "environment"], field),
  );
  addConfigOptional(option, "plugin_mode", item.plugin_mode, (value, field) =>
    cleanChoice(value || "auto", ["auto", "none"], field),
  );
  addConfigOptional(option, "option_overlay_mode", item.option_overlay_mode, (value, field) =>
    cleanChoice(value || "enabled", OPTION_OVERLAY_MODES, field),
  );
  addConfigOptional(option, "cash_only_execution_mode", item.cash_only_execution_mode, (value, field) =>
    cleanChoice(value || "enabled", CASH_ONLY_EXECUTION_MODES, field),
  );
  addConfigOptional(option, "dca_mode", item.dca_mode, cleanDcaMode);
  addConfigOptional(option, "dca_base_investment_usd", item.dca_base_investment_usd, cleanPositiveNumber);
  option.supported_domains = shouldInferSupportedDomains(item.supported_domains)
    ? inferAccountSupportedDomains(platform, option)
    : normalizeSupportedDomains(item.supported_domains, `account option ${platform}[${index}].supported_domains`);
  return option;
}

export function normalizeBrokerEnvironment(value, fieldName = "broker_environment") {
  const environment = String(value || "").trim();
  if (!BROKER_ENVIRONMENTS.includes(environment)) {
    throw new Error(`${fieldName} must be live or paper`);
  }
  return environment;
}

export function shouldInferSupportedDomains(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === "";
}

export function supportedDomainsForAccount(platform, option) {
  const platformDomains = inferAccountSupportedDomains(platform, option || {});
  if (Array.isArray(option?.supported_domains) && option.supported_domains.length) {
    return normalizeSupportedDomains(option.supported_domains, "supported_domains")
      .filter((domain) => platformDomains.includes(domain));
  }
  return platformDomains;
}

export function inferAccountSupportedDomains(platform, option) {
  void option;
  const domains = PLATFORM_CONFIG[platform]?.supported_domains;
  return Array.isArray(domains) ? [...domains] : [];
}

export function platformRepositories(env) {
  return resolvePlatformRepositories(env);
}

export function normalizeSupportedDomains(value, fieldName) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,;]+/);
  if (!items.length || items.length > STRATEGY_HEALTH_DOMAINS.length) {
    throw new Error(`${fieldName} must list one or more strategy domains`);
  }
  const result = [];
  for (const item of items) {
    const domain = cleanStrategyDomain(item, fieldName);
    if (!result.includes(domain)) result.push(domain);
  }
  if (!result.length) throw new Error(`${fieldName} must list one or more strategy domains`);
  return result;
}

export function cleanStrategyDomain(value, fieldName) {
  return cleanChoice(value, STRATEGY_HEALTH_DOMAINS, fieldName);
}

export function cleanCashCurrency(value, fieldName) {
  return cleanChoice(String(value || "").trim().toUpperCase(), ["USD", "HKD", "CNY"], fieldName);
}

export function addConfigOptional(target, key, value, cleaner) {
  if (value === undefined || value === null || String(value).trim() === "") return;
  target[key] = cleaner(value, key);
}

export function addOptional(target, key, value, cleaner) {
  if (value === undefined || value === null || String(value).trim() === "") return;
  target[key] = cleaner(value, key);
}

export function isDcaProfile(profile) {
  return Boolean(DCA_PROFILE_CONFIG[canonicalStrategyProfile(profile)]);
}

export function assertDcaPlatform(platform, strategyProfile) {
  if (isDcaProfile(strategyProfile) && !DCA_SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(
      `DCA strategy profiles are not supported on ${platform}; got strategy_profile=${strategyProfile}`,
    );
  }
}

export function cleanDcaMode(value, field = "dca_mode") {
  const mode = String(value || "").trim().toLowerCase();
  const aliases = {
    ordinary: "fixed",
    ordinary_dca: "fixed",
    fixed_dca: "fixed",
    smart_dca: "smart",
  };
  const normalized = aliases[mode] || mode;
  return cleanChoice(normalized, ["fixed", "smart"], field);
}

export function cleanLifecycleStage(value, field = "lifecycle_stage") {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text.length > 80 || !/^[a-z0-9._-]+$/.test(text)) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}

export function canonicalLifecycleStage(value, deployment = {}) {
  const stage = cleanLifecycleStage(value);
  if (["research_active", "shadow_active", "paper_active", "live_candidate", "live_enabled", "runtime_enabled"].includes(stage)) {
    return stage;
  }
  if (["research", "research_backtest_only", "ai_monitored_candidate"].includes(stage)) return "research_active";
  if (stage === "shadow_candidate") return "shadow_active";
  void deployment;
  throw new Error(`lifecycle_stage ${stage} is unsupported`);
}

export function cleanAllowedExecutionModes(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\s/|]+/);
  const modes = [];
  for (const item of items) {
    const mode = String(item || "").trim().toLowerCase();
    if (!mode) continue;
    if (!["live", "paper", "dry_run"].includes(mode)) {
      throw new Error(`allowed_execution_modes contains unsupported mode ${mode}`);
    }
    if (!modes.includes(mode)) modes.push(mode);
  }
  return modes;
}

export function cleanExecutionMode(value) {
  const mode = cleanChoice(value || "live", ["live", "paper", "dry_run"], "execution_mode");
  return mode === "paper" ? "dry_run" : mode;
}

export function supportedExecutionModesForPlatform(platform) {
  const modes = PLATFORM_CONFIG[platform]?.supported_execution_modes;
  if (!Array.isArray(modes)) return [];
  return modes.filter((mode) => mode === "live" || mode === "dry_run");
}
