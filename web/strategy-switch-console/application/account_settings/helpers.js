/**
 * Account-settings pure helpers (identity, draft patch, payload, audit).
 * Never import runtime_support — inject catalog helpers via deps where needed.
 */

import { PLATFORM_CONFIG, DCA_SUPPORTED_PLATFORMS } from "../../config.js";
import { sameStrategyProfile } from "../../strategy_identity.js";
import { riskTierBindingView } from "../console_api/risk_tiers.js";
import { HttpError } from "../http_error.js";
import { ACCOUNT_SETTING_OVERRIDE_FIELDS } from "./constants.js";

const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_CONFIG);

export function accountSettingsIdentity(instance) {
  const config = instance?.config || {};
  const broker = config.broker_environment;
  return {
    platform: instance.platform,
    key: instance.key,
    target_name: typeof config.target_name === "string" ? config.target_name : "",
    broker_environment: broker === "live" || broker === "paper" ? broker : null,
    account_selector: typeof config.account_selector === "string" ? config.account_selector : "",
    deployment_selector: typeof config.deployment_selector === "string" ? config.deployment_selector : "",
    account_scope: typeof config.account_scope === "string" ? config.account_scope : "",
    service_name: typeof config.service_name === "string" ? config.service_name : "",
  };
}

export function accountSettingsIdentityIsComplete(identity) {
  if (!identity || Array.isArray(identity) || typeof identity !== "object"
    || !SUPPORTED_PLATFORMS.includes(identity.platform)
    || (identity.broker_environment !== "paper" && identity.broker_environment !== "live")) return false;
  return ["key", "target_name", "account_selector", "deployment_selector", "account_scope", "service_name"]
    .every((field) => typeof identity[field] === "string" && identity[field].trim() !== "");
}

export function accountSettingsProfileName(value) {
  if (typeof value !== "string" || value.length > 128 || value !== value.trim()
    || !/^[a-z0-9][a-z0-9._-]*$/.test(value)) return "";
  return value;
}

export function accountSettingPositiveAmount(value) {
  if (typeof value !== "string" || value.length > 32 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

export function accountSettingRatio(value) {
  if (typeof value !== "string" || value.length > 32 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  if (whole === "0") return value;
  if (whole === "1" && (frac === "" || /^0+$/.test(frac))) return value;
  return null;
}

export function applyAccountSettingOverrides(current, patch) {
  if (!patch || Array.isArray(patch) || typeof patch !== "object") throw new HttpError("invalid_account_setting_overrides", 400);
  const next = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : {};
  for (const key of Object.keys(patch)) {
    if (!ACCOUNT_SETTING_OVERRIDE_FIELDS.includes(key)) throw new HttpError("invalid_account_setting_overrides", 400);
    const value = patch[key];
    if (value === null) {
      delete next[key];
      continue;
    }
    if (typeof value === "number") throw new HttpError("invalid_account_setting_overrides", 400);
    if (key === "income_layer_enabled" || key === "option_overlay_enabled") {
      if (typeof value !== "boolean") throw new HttpError("invalid_account_setting_overrides", 400);
      next[key] = value;
    } else if (key === "reserved_cash_floor") {
      if (typeof value !== "string" || value.length > 32 || !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
        throw new HttpError("invalid_account_setting_overrides", 400);
      }
      next[key] = value;
    } else if (key === "reserved_cash_ratio") {
      const ratio = accountSettingRatio(value);
      if (ratio === null) throw new HttpError("invalid_account_setting_overrides", 400);
      next[key] = ratio;
    } else if (key === "dca_mode") {
      if (value !== "fixed" && value !== "smart") throw new HttpError("invalid_account_setting_overrides", 400);
      next[key] = value;
    } else if (key === "dca_base_investment_usd") {
      if (!accountSettingPositiveAmount(value)) throw new HttpError("invalid_account_setting_overrides", 400);
      next[key] = value;
    } else if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
      throw new HttpError("invalid_account_setting_overrides", 400);
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function accountSettingsOperations(admin, optionSupported) {
  const allowed = Boolean(admin);
  return {
    save_draft: allowed,
    save_draft_reason: allowed ? "available" : "admin_required",
    save_risk_preference: allowed,
    save_risk_preference_reason: allowed ? "available" : "admin_required",
    save_declaration: allowed,
    save_declaration_reason: allowed ? "available" : "admin_required",
    save_option_draft: allowed && optionSupported === true,
    save_option_draft_reason: !allowed ? "admin_required" : optionSupported === true ? "available" : "option_overlay_not_defined",
    apply_strategy: false,
    activation: false,
    reason: "strategy_application_not_connected",
    apply_strategy_reason: "strategy_application_not_connected",
    activation_reason: "strategy_application_not_connected",
  };
}

export function accountSettingsPayload(observed, effective, admin, extras = {}) {
  const optionSupported = extras.pendingStrategy ? extras.pendingOptionSupported === true : extras.currentOptionSupported === true;
  return {
    ok: true,
    platform: observed.platform,
    key: observed.key,
    instance_revision: observed.instance_revision,
    identity: observed.identity,
    effective,
    effective_read: extras.effectiveRead,
    draft: observed.draft,
    declaration: observed.declaration,
    strategy_options: Array.isArray(extras.strategyOptions) ? extras.strategyOptions : [],
    current_option_supported: extras.currentOptionSupported === true,
    risk: {
      revision: observed.risk.revision,
      scope_id: observed.risk.scope_id,
      preference: observed.risk.preference,
    },
    tier_binding: riskTierBindingView({
      scope_id: observed.risk.scope_id,
      platform: observed.platform,
      target_name: observed.identity?.target_name || null,
      binding: observed.risk.binding || null,
      revision: observed.risk.revision,
    }),
    operations: accountSettingsOperations(admin, optionSupported),
    adopted: false,
    no_order: true,
    execution_authority_granted: false,
    current_dca_supported: extras.currentDcaSupported === true,
  };
}

export function accountSettingsAuditChanges(before, after, requested) {
  const changes = [];
  const left = before?.draft?.overrides && typeof before.draft.overrides === "object" && !Array.isArray(before.draft.overrides) ? before.draft.overrides : {};
  const right = after?.draft?.overrides && typeof after.draft.overrides === "object" && !Array.isArray(after.draft.overrides) ? after.draft.overrides : {};
  const patch = requested?.overrides && typeof requested.overrides === "object" && !Array.isArray(requested.overrides) ? requested.overrides : {};
  const stored = (record, name) => Object.prototype.hasOwnProperty.call(record, name) ? record[name] : undefined;
  const asked = (name) => Object.prototype.hasOwnProperty.call(patch, name);
  if (["reserved_cash_floor", "reserved_cash_ratio"].some(asked) && ["reserved_cash_floor", "reserved_cash_ratio"].some((name) => stored(left, name) !== stored(right, name))) changes.push("cash_draft");
  if (asked("income_layer_enabled") && stored(left, "income_layer_enabled") !== stored(right, "income_layer_enabled")) changes.push("income_draft");
  if (asked("option_overlay_enabled") && stored(left, "option_overlay_enabled") !== stored(right, "option_overlay_enabled")) changes.push("option_draft");
  const strategyDraftChanged = (asked("strategy_profile") && stored(left, "strategy_profile") !== stored(right, "strategy_profile"))
    || ((asked("dca_mode") || asked("dca_base_investment_usd")) && ["dca_mode", "dca_base_investment_usd"].some((name) => stored(left, name) !== stored(right, name)));
  if (strategyDraftChanged) changes.push("strategy_draft");
  if (requested?.declaration && before?.declaration?.revision !== after?.declaration?.revision) changes.push("account_declaration_saved");
  const beforePreference = before?.risk?.preference || null;
  const afterPreference = after?.risk?.preference || null;
  if ((requested?.risk_change === "set" || requested?.risk_change === "clear") && beforePreference !== afterPreference) changes.push(afterPreference ? "risk_saved" : "risk_cleared");
  return changes;
}

export function profileDefinesOptionOverlay(profiles, profileId) {
  if (!Array.isArray(profiles) || typeof profileId !== "string" || !profileId) return false;
  const found = profiles.find((item) => sameStrategyProfile(item?.profile, profileId));
  return found?.option_overlay_enabled === true;
}

export function optionOverlayDraftAllowed(platform, profiles, profileId) {
  return PLATFORM_CONFIG[platform]?.option_overlay === true && profileDefinesOptionOverlay(profiles, profileId);
}

/**
 * @param {string} platform
 * @param {any[]} profiles
 * @param {string} profileId
 * @param {{ isDcaProfile: Function }} deps
 */
export function dcaDraftSupported(platform, profiles, profileId, deps) {
  const { isDcaProfile } = deps;
  if (!profileId || !Array.isArray(profiles)) return false;
  if (!DCA_SUPPORTED_PLATFORMS.has(platform) || !isDcaProfile(profileId)) return false;
  return profiles.some((item) => sameStrategyProfile(item?.profile, profileId));
}

/**
 * @param {string} platform
 * @param {any} accountOption
 * @param {any[]} profiles
 * @param {{
 *   supportedDomainsForAccount: Function,
 *   supportedExecutionModesForPlatform: Function,
 *   assertDcaPlatform: Function,
 *   isFrozenStrategyProfile: Function,
 *   isDcaProfile: Function,
 * }} deps
 */
export function accountDraftStrategyChoices(platform, accountOption, profiles, deps) {
  const {
    supportedDomainsForAccount,
    supportedExecutionModesForPlatform,
    assertDcaPlatform,
    isFrozenStrategyProfile,
    isDcaProfile,
  } = deps;
  if (!Array.isArray(profiles)) return [];
  let domains = [];
  try {
    domains = supportedDomainsForAccount(platform, accountOption || {});
  } catch {
    return [];
  }
  const choices = [];
  const allowsDryRunOnly = accountOption?.default_execution_mode === "dry_run"
    && supportedExecutionModesForPlatform(platform).includes("dry_run");
  for (const profile of profiles) {
    if (!profile || typeof profile.profile !== "string" || !profile.profile) continue;
    if (profile.domain_explicit !== true || profile.lifecycle_stage === "frozen" || isFrozenStrategyProfile(profile)) continue;
    if (!profile.domain || !domains.includes(profile.domain)) continue;
    const modes = Array.isArray(profile.allowed_execution_modes) ? profile.allowed_execution_modes : [];
    if (!modes.some((mode) => mode === "paper" || mode === "live"
      || (allowsDryRunOnly && mode === "dry_run"))) continue;
    try {
      assertDcaPlatform(platform, profile.profile);
    } catch {
      continue;
    }
    choices.push({
      profile: profile.profile,
      label: profile.label || profile.profile,
      label_zh: profile.label_zh || profile.label || profile.profile,
      label_en: profile.label_en || profile.label || profile.profile,
      domain: profile.domain,
      // Existing catalog declarations only, never broker or execution permission.
      lifecycle_stage: typeof profile.lifecycle_stage === "string" ? profile.lifecycle_stage : null,
      allowed_execution_modes: Array.isArray(profile.allowed_execution_modes) && profile.allowed_execution_modes.length ? [...profile.allowed_execution_modes] : null,
      can_switch_live: typeof profile.can_switch_live === "boolean" ? profile.can_switch_live : null,
      blocked_live_reason: typeof profile.blocked_live_reason === "string" ? profile.blocked_live_reason : null,
      option_overlay_enabled: profile.option_overlay_enabled === true,
      dca_supported: dcaDraftSupported(platform, profiles, profile.profile, { isDcaProfile }),
    });
  }
  return choices;
}

/**
 * @param {any[]|null} profiles
 * @param {any} observed
 * @param {any} patch
 * @param {string} trustedProfile
 * @param {object} options
 * @param {{
 *   supportedDomainsForAccount: Function,
 *   supportedExecutionModesForPlatform: Function,
 *   assertDcaPlatform: Function,
 *   isFrozenStrategyProfile: Function,
 *   isDcaProfile: Function,
 * }} deps
 */
export function assertAccountDraftPatch(profiles, observed, patch, trustedProfile, options = {}, deps) {
  if (!patch || Array.isArray(patch) || typeof patch !== "object") throw new HttpError("invalid_account_setting_overrides", 400);
  const choices = profiles ? accountDraftStrategyChoices(observed.platform, observed.config, profiles, deps) : [];
  const rebuilding = observed.draft?.status === "identity_conflict" && options.acknowledgeIdentityConflict === true;
  const stored = observed.draft?.overrides && typeof observed.draft.overrides === "object" && !Array.isArray(observed.draft.overrides) ? observed.draft.overrides : {};
  const current = rebuilding ? {} : stored;
  const touchesStrategy = Object.prototype.hasOwnProperty.call(patch, "strategy_profile");
  const touchesOption = Object.prototype.hasOwnProperty.call(patch, "option_overlay_enabled");
  const touchesDcaMode = Object.prototype.hasOwnProperty.call(patch, "dca_mode");
  const touchesDcaBase = Object.prototype.hasOwnProperty.call(patch, "dca_base_investment_usd");
  if (touchesDcaMode !== touchesDcaBase) throw new HttpError("account_settings_dca_rejected", 400);
  if (touchesDcaMode && (patch.dca_mode === null) !== (patch.dca_base_investment_usd === null)) {
    throw new HttpError("account_settings_dca_rejected", 400);
  }
  if (touchesDcaMode && patch.dca_mode !== null && patch.dca_mode !== "fixed" && patch.dca_mode !== "smart") {
    throw new HttpError("invalid_account_setting_overrides", 400);
  }
  if (touchesDcaBase && patch.dca_base_investment_usd !== null && !accountSettingPositiveAmount(patch.dca_base_investment_usd)) {
    throw new HttpError("invalid_account_setting_overrides", 400);
  }
  if (!profiles && (touchesDcaMode || touchesDcaBase)) throw new HttpError("account_settings_dca_rejected", 400);
  if (touchesStrategy && patch.strategy_profile !== null) {
    const allowedChoice = choices.some((item) => sameStrategyProfile(item.profile, patch.strategy_profile));
    const currentEditable = sameStrategyProfile(patch.strategy_profile, trustedProfile)
      && dcaDraftSupported(observed.platform, profiles, patch.strategy_profile, deps);
    if (typeof patch.strategy_profile !== "string" || (!allowedChoice && !currentEditable)) {
      throw new HttpError("account_settings_strategy_rejected", 400);
    }
  }
  if (!touchesStrategy && !touchesOption && !touchesDcaMode && !touchesDcaBase) return;
  const bound = touchesStrategy
    ? patch.strategy_profile || trustedProfile || ""
    : (typeof current.strategy_profile === "string" && current.strategy_profile ? current.strategy_profile : trustedProfile || "");
  const supports = optionOverlayDraftAllowed(observed.platform, profiles, bound);
  if (touchesOption && patch.option_overlay_enabled !== null && (typeof patch.option_overlay_enabled !== "boolean" || !supports)) {
    throw new HttpError("account_settings_option_rejected", 400);
  }
  const nextOption = touchesOption
    ? patch.option_overlay_enabled
    : (Object.prototype.hasOwnProperty.call(current, "option_overlay_enabled") ? current.option_overlay_enabled : undefined);
  if ((nextOption === true || nextOption === false) && !supports) throw new HttpError("account_settings_option_strategy_conflict", 400);
  // Other setting groups can be edited on a DCA account without rebinding its strategy.
  if (!touchesStrategy && !touchesDcaMode && !touchesDcaBase) return;
  const previous = typeof current.strategy_profile === "string" && current.strategy_profile ? current.strategy_profile : trustedProfile || "";
  const next = touchesStrategy
    ? (patch.strategy_profile === null ? trustedProfile || "" : String(patch.strategy_profile || ""))
    : previous;
  const mergedMode = touchesDcaMode ? patch.dca_mode : (Object.prototype.hasOwnProperty.call(current, "dca_mode") ? current.dca_mode : null);
  const mergedBase = touchesDcaBase ? patch.dca_base_investment_usd : (Object.prototype.hasOwnProperty.call(current, "dca_base_investment_usd") ? current.dca_base_investment_usd : null);
  const hasMergedDca = (mergedMode !== null && mergedMode !== undefined) || (mergedBase !== null && mergedBase !== undefined);
  if (!dcaDraftSupported(observed.platform, profiles, next, deps)) {
    if (hasMergedDca) throw new HttpError("account_settings_dca_rejected", 400);
    if (!sameStrategyProfile(previous, next) && dcaDraftSupported(observed.platform, profiles, previous, deps)
      && (!touchesDcaMode || patch.dca_mode !== null || !touchesDcaBase || patch.dca_base_investment_usd !== null)) {
      throw new HttpError("account_settings_dca_rejected", 400);
    }
    return;
  }
  if (touchesDcaMode || touchesDcaBase) {
    const clearingDca = patch.dca_mode === null && patch.dca_base_investment_usd === null;
    const boundToProfile = sameStrategyProfile(patch.strategy_profile, next);
    const clearingCurrentBinding = patch.strategy_profile === null && clearingDca;
    if (!touchesStrategy || (!boundToProfile && !clearingCurrentBinding)) {
      throw new HttpError("account_settings_dca_rejected", 400);
    }
  }
  if (!sameStrategyProfile(previous, next) || touchesDcaMode || touchesDcaBase) {
    if (!touchesDcaMode || !touchesDcaBase) throw new HttpError("account_settings_dca_rejected", 400);
  }
}

export function accountSettingsProfileApplicationIsFixedHk(application) {
  const identity = application?.identity;
  return application?.platform === "longbridge" && application?.key === "hk"
    && accountSettingsIdentityIsComplete(identity)
    && identity.platform === "longbridge" && identity.key === "hk";
}

export function decodeProfileApplicationJwtPart(value, maxBytes, parseJson = true) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxBytes * 2
    || !/^[A-Za-z0-9_-]+$/.test(value)) throw new HttpError("github_oidc_token_invalid", 401);
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  let binary;
  try { binary = atob(padded); } catch { throw new HttpError("github_oidc_token_invalid", 401); }
  if (binary.length > maxBytes) throw new HttpError("github_oidc_token_invalid", 401);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!parseJson) return { bytes };
  try { return { bytes, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }; }
  catch { throw new HttpError("github_oidc_token_invalid", 401); }
}
