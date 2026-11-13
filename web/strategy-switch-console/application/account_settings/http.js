/**
 * Account-settings and risk-profile-bindings HTTP use cases.
 *
 * Inject runtime_support-owned helpers (GitHub current-strategy readback,
 * risk-profile builders, catalog domain helpers) so this module never imports
 * runtime_support and cannot form a cycle.
 */

import { PLATFORM_CONFIG } from "../../config.js";
import { riskTierBindingView } from "../console_api/risk_tiers.js";
import { hasConfigStore } from "../config_kv.js";
import { HttpError } from "../http_error.js";
import { hasRuntimeInstanceStore, runtimeInstanceCommand } from "../runtime_instances/command.js";
import { ux1ExactKeys } from "../ux1/research.js";
import { ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY } from "./constants.js";
import {
  accountDraftStrategyChoices,
  accountSettingsAuditChanges,
  accountSettingsIdentityIsComplete,
  accountSettingsPayload,
  accountSettingsProfileApplicationIsFixedHk,
  accountSettingsProfileName,
  assertAccountDraftPatch,
  dcaDraftSupported,
  optionOverlayDraftAllowed,
} from "./helpers.js";
import {
  readGitHubProfileApplicationRequestBody,
  verifyGitHubProfileApplicationToken,
} from "./oidc.js";

const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_CONFIG);

/**
 * @param {any} env
 * @param {{ loadStrategyProfilesConfig: Function }} deps
 */
export async function loadAccountDraftProfiles(env, deps) {
  try {
    return await deps.loadStrategyProfilesConfig(env);
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {any} observed
 * @param {boolean} admin
 * @param {{
 *   effectiveAccountSettings: Function,
 *   loadStrategyProfilesConfig: Function,
 *   supportedDomainsForAccount: Function,
 *   supportedExecutionModesForPlatform: Function,
 *   assertDcaPlatform: Function,
 *   isFrozenStrategyProfile: Function,
 *   isDcaProfile: Function,
 * }} deps
 */
export async function presentAccountSettings(env, observed, admin, deps) {
  const draftDeps = {
    supportedDomainsForAccount: deps.supportedDomainsForAccount,
    supportedExecutionModesForPlatform: deps.supportedExecutionModesForPlatform,
    assertDcaPlatform: deps.assertDcaPlatform,
    isFrozenStrategyProfile: deps.isFrozenStrategyProfile,
    isDcaProfile: deps.isDcaProfile,
  };
  const { effective, effectiveRead } = await deps.effectiveAccountSettings(env, observed);
  const profiles = await loadAccountDraftProfiles(env, deps);
  const strategyOptions = profiles ? accountDraftStrategyChoices(observed.platform, observed.config, profiles, draftDeps) : [];
  const conflict = observed.draft?.status === "identity_conflict";
  const pending = !conflict && typeof observed.draft?.overrides?.strategy_profile === "string" ? observed.draft.overrides.strategy_profile : "";
  const trusted = effective.strategy_profile?.status === "known" && typeof effective.strategy_profile.value === "string" ? effective.strategy_profile.value : "";
  return accountSettingsPayload(observed, effective, admin, {
    effectiveRead,
    strategyOptions,
    pendingStrategy: Boolean(pending),
    pendingOptionSupported: Boolean(pending) && optionOverlayDraftAllowed(observed.platform, profiles, pending),
    currentOptionSupported: Boolean(trusted) && optionOverlayDraftAllowed(observed.platform, profiles, trusted),
    currentDcaSupported: dcaDraftSupported(observed.platform, profiles, trusted, draftDeps),
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   readSession: Function,
 *   json: Function,
 *   readRiskProfileLegacy: Function,
 *   effectiveAccountSettings: Function,
 *   loadStrategyProfilesConfig: Function,
 *   supportedDomainsForAccount: Function,
 *   supportedExecutionModesForPlatform: Function,
 *   assertDcaPlatform: Function,
 *   isFrozenStrategyProfile: Function,
 *   isDcaProfile: Function,
 * }} deps
 */
export async function accountSettingsResponse(request, env, deps) {
  const { readSession, json, readRiskProfileLegacy } = deps;
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") || "";
  const key = url.searchParams.get("key") || "";
  if (!SUPPORTED_PLATFORMS.includes(platform) || !key) return json({ ok: false, error: "account_settings_account_required" }, 400);
  if (!hasRuntimeInstanceStore(env)) return json({ ok: false, error: "runtime_instances_not_bound", no_order: true, execution_authority_granted: false }, 503);
  const legacy = await readRiskProfileLegacy(env);
  let observed;
  try {
    observed = await runtimeInstanceCommand(env, { action: "account_settings_read", actor: session.login, platform, key, legacy });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return json({ ok: false, error: error instanceof HttpError ? error.message : "runtime_instances_unavailable", no_order: true, execution_authority_granted: false }, status);
  }
  return json(await presentAccountSettings(env, observed, session.admin, deps));
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   requireSameOrigin: Function,
 *   readSession: Function,
 *   json: Function,
 *   readBoundedJson: Function,
 *   saveAccountSettings: Function,
 * }} deps
 */
export async function saveCombinedAccountDraft(request, env, deps) {
  const { requireSameOrigin, readSession, json, readBoundedJson, saveAccountSettings } = deps;
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  let raw;
  try { raw = await readBoundedJson(request, 16 * 1024); } catch (error) { return json({ ok: false, error: "invalid_account_setting_overrides" }, error.status || 400); }
  const allowed = ["platform", "key", "identity", "expected_draft_revision", "acknowledge_identity_conflict", "overrides"];
  if (!raw || Array.isArray(raw) || Object.keys(raw).some(key => !allowed.includes(key)) || !Object.hasOwn(raw, "overrides")) return json({ ok: false, error: "invalid_account_setting_overrides" }, 400);
  return saveAccountSettings(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(raw) }), env);
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   requireSameOrigin: Function,
 *   readSession: Function,
 *   json: Function,
 *   readRiskProfileLegacy: Function,
 *   canonicalResearchTaskJson: Function,
 *   effectiveAccountSettings: Function,
 *   loadStrategyProfilesConfig: Function,
 *   supportedDomainsForAccount: Function,
 *   supportedExecutionModesForPlatform: Function,
 *   assertDcaPlatform: Function,
 *   isFrozenStrategyProfile: Function,
 *   isDcaProfile: Function,
 *   buildRiskProfileBindings: Function,
 *   mirrorConfigJson: Function,
 *   RISK_PROFILE_BINDINGS_KEY: string,
 *   RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION: string,
 *   appendAuditLog: Function,
 * }} deps
 */
export async function saveAccountSettings(request, env, deps) {
  const {
    requireSameOrigin, readSession, json, readRiskProfileLegacy, canonicalResearchTaskJson,
    buildRiskProfileBindings, mirrorConfigJson, RISK_PROFILE_BINDINGS_KEY,
    RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION, appendAuditLog,
  } = deps;
  const draftDeps = {
    supportedDomainsForAccount: deps.supportedDomainsForAccount,
    supportedExecutionModesForPlatform: deps.supportedExecutionModesForPlatform,
    assertDcaPlatform: deps.assertDcaPlatform,
    isFrozenStrategyProfile: deps.isFrozenStrategyProfile,
    isDcaProfile: deps.isDcaProfile,
  };
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  let raw;
  try { raw = await request.json(); } catch { return json({ ok: false, error: "request body must be valid JSON" }, 400); }
  const platform = raw?.platform;
  const key = raw?.key;
  if (!SUPPORTED_PLATFORMS.includes(platform) || typeof key !== "string" || !key) return json({ ok: false, error: "account_settings_account_required" }, 400);
  if (!hasRuntimeInstanceStore(env)) return json({ ok: false, error: "runtime_instances_not_bound", no_order: true, execution_authority_granted: false }, 503);
  const legacy = await readRiskProfileLegacy(env);
  let observed;
  try {
    observed = await runtimeInstanceCommand(env, { action: "account_settings_read", actor: session.login, platform, key, legacy });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return json({ ok: false, error: error instanceof HttpError ? error.message : "runtime_instances_unavailable", no_order: true, execution_authority_granted: false }, status);
  }
  const wantsDraft = Object.prototype.hasOwnProperty.call(raw, "overrides");
  const wantsRisk = Object.prototype.hasOwnProperty.call(raw, "risk_preference");
  const wantsDeclaration = Object.prototype.hasOwnProperty.call(raw, "declaration");
  if ((wantsDraft || wantsRisk || wantsDeclaration) && (!raw.identity || Array.isArray(raw.identity) || typeof raw.identity !== "object")) {
    return json({ ok: false, error: "account_settings_identity_required" }, 400);
  }
  if ((wantsDraft || wantsRisk || wantsDeclaration) && canonicalResearchTaskJson(raw.identity) !== canonicalResearchTaskJson(observed.identity)) {
    return json({ ok: false, error: "account_settings_identity_conflict" }, 409);
  }
  const command = { action: "account_settings_save", actor: session.login, platform, key, legacy };
  if (wantsDraft || wantsRisk || wantsDeclaration) command.identity = raw.identity;
  if (wantsDeclaration) {
    if (!Number.isSafeInteger(raw.expected_declaration_revision) || raw.expected_declaration_revision !== observed.declaration.revision) return json({ ok: false, error: "account_settings_declaration_revision_conflict" }, 409);
    command.declaration = raw.declaration;
    command.expected_declaration_revision = raw.expected_declaration_revision;
  }
  if (wantsDraft) {
    if (!Number.isSafeInteger(raw.expected_draft_revision)) return json({ ok: false, error: "account_settings_draft_revision_required" }, 400);
    if (raw.expected_draft_revision !== observed.draft.revision) return json({ ok: false, error: "account_settings_draft_revision_conflict" }, 409);
    command.overrides = raw.overrides;
    command.expected_draft_revision = observed.draft.revision;
    if (raw.acknowledge_identity_conflict === true) command.acknowledge_identity_conflict = true;
    const profiles = await loadAccountDraftProfiles(env, deps);
    const { effective: beforeEffective } = await deps.effectiveAccountSettings(env, observed);
    const trusted = beforeEffective.strategy_profile?.status === "known" && typeof beforeEffective.strategy_profile.value === "string" ? beforeEffective.strategy_profile.value : "";
    try {
      assertAccountDraftPatch(profiles, observed, raw.overrides, trusted, { acknowledgeIdentityConflict: raw.acknowledge_identity_conflict === true }, draftDeps);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      return json({ ok: false, error: error instanceof HttpError ? error.message : "invalid_account_setting_overrides", no_order: true, execution_authority_granted: false }, status);
    }
  }
  if (wantsRisk) {
    if (!Number.isSafeInteger(raw.expected_risk_revision)) return json({ ok: false, error: "risk_profile_revision_required" }, 400);
    if (raw.expected_risk_revision !== observed.risk.revision) return json({ ok: false, error: "risk_profile_revision_conflict" }, 409);
    command.expected_risk_revision = observed.risk.revision;
    if (raw.risk_preference === null) command.risk_change = "clear";
    else {
      let built;
      try {
        built = await buildRiskProfileBindings(
          { bindings: [{ platform, target_name: observed.identity.target_name, risk_preference: raw.risk_preference }] },
          observed.account_options,
          session.login,
        );
      } catch (error) {
        return json({ ok: false, error: error.message || "risk profile bindings are invalid" }, 400);
      }
      command.risk_change = "set";
      command.binding = built[0];
    }
  }
  if (!Object.prototype.hasOwnProperty.call(command, "overrides") && !Object.prototype.hasOwnProperty.call(command, "risk_change") && !Object.prototype.hasOwnProperty.call(command, "declaration")) {
    return json({ ok: false, error: "account_settings_change_required" }, 400);
  }
  let saved;
  try {
    saved = await runtimeInstanceCommand(env, command);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return json({ ok: false, error: error instanceof HttpError ? error.message : "runtime_instances_unavailable", no_order: true, execution_authority_granted: false }, status);
  }
  if (command.risk_change && hasConfigStore(env)) {
    await mirrorConfigJson(env, RISK_PROFILE_BINDINGS_KEY, {
      schema_version: RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION,
      bindings: saved.bindings,
    });
  }
  const changes = accountSettingsAuditChanges(observed, saved, command);
  let auditLogged = false;
  if (changes.length && hasConfigStore(env)) {
    const entry = {
      ts: new Date().toISOString(),
      login: session.login,
      action: "save_account_settings",
      platform,
      key,
      changes,
    };
    if (changes.some((kind) => kind === "cash_draft" || kind === "income_draft" || kind === "option_draft" || kind === "strategy_draft")) entry.draft_revision = saved.draft.revision;
    if (changes.includes("risk_saved") || changes.includes("risk_cleared")) entry.risk_revision = saved.risk.revision;
    if (changes.includes("account_declaration_saved")) entry.declaration_revision = saved.declaration.revision;
    try {
      await appendAuditLog(env, entry);
      auditLogged = true;
    } catch { /* the setting is already stored; a missed audit line must not be saved again */ }
  }
  const presented = await presentAccountSettings(env, saved, true, deps);
  presented.audit_logged = auditLogged;
  return json(presented);
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   readSession: Function,
 *   json: Function,
 *   loadRiskProfileBindings: Function,
 *   riskProfileBindingTargets: Function,
 * }} deps
 */
export async function riskProfileBindingsResponse(request, env, deps) {
  const { readSession, json, loadRiskProfileBindings, riskProfileBindingTargets } = deps;
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  const bindingState = await loadRiskProfileBindings(env);
  if (bindingState.error) {
    return json({
      ok: false,
      error: "risk profile bindings are unavailable",
      reason: bindingState.error,
      no_order: true,
      execution_authority_granted: false,
    }, bindingState.status || 409);
  }
  return json({
    ok: true,
    revision: bindingState.revision,
    bindings: bindingState.bindings,
    tier_bindings: bindingState.bindings.map((binding) => riskTierBindingView({
      scope_id: binding.scope_id,
      platform: binding.platform,
      target_name: binding.target_name,
      binding,
      revision: bindingState.revision,
    })),
    configured_targets: riskProfileBindingTargets(bindingState.account_options || {}),
    no_order: true,
    execution_authority_granted: false,
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   requireSameOrigin: Function,
 *   readSession: Function,
 *   json: Function,
 *   buildRiskProfileBindings: Function,
 *   loadLegacyAccountOptionsConfig: Function,
 *   readRiskProfileLegacy: Function,
 *   mirrorConfigJson: Function,
 *   RISK_PROFILE_BINDINGS_KEY: string,
 *   RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION: string,
 *   appendAuditLog: Function,
 *   riskProfileBindingTargets: Function,
 * }} deps
 */
export async function saveRiskProfileBindings(request, env, deps) {
  const {
    requireSameOrigin, readSession, json, buildRiskProfileBindings, loadLegacyAccountOptionsConfig,
    readRiskProfileLegacy, mirrorConfigJson, RISK_PROFILE_BINDINGS_KEY,
    RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION, appendAuditLog, riskProfileBindingTargets,
  } = deps;
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "request body must be valid JSON" }, 400);
  }
  if (!hasRuntimeInstanceStore(env)) {
    try {
      await buildRiskProfileBindings({ bindings: raw?.bindings }, (await loadLegacyAccountOptionsConfig(env)).options || {}, session.login);
    } catch (error) {
      return json({ ok: false, error: error.message || "risk profile bindings are invalid" }, 400);
    }
    return json({ ok: false, error: "runtime_instances_not_bound", no_order: true, execution_authority_granted: false }, 503);
  }
  const legacy = await readRiskProfileLegacy(env);
  let observed;
  try {
    observed = await runtimeInstanceCommand(env, { action: "risk_profile_read", actor: session.login, legacy });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return json({ ok: false, error: error instanceof HttpError ? error.message : "runtime_instances_unavailable", no_order: true, execution_authority_granted: false }, status);
  }
  if (!Number.isSafeInteger(raw?.expected_revision)) return json({ ok: false, error: "risk_profile_revision_required" }, 400);
  if (raw.expected_revision !== observed.revision) return json({ ok: false, error: "risk_profile_revision_conflict" }, 409);
  let bindings;
  try {
    bindings = await buildRiskProfileBindings({ bindings: raw.bindings }, observed.account_options, session.login);
  } catch (error) {
    return json({ ok: false, error: error.message || "risk profile bindings are invalid" }, 400);
  }
  let saved;
  try {
    saved = await runtimeInstanceCommand(env, {
      action: "risk_profile_replace",
      actor: session.login,
      expected_revision: observed.revision,
      bindings,
      legacy,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return json({ ok: false, error: error instanceof HttpError ? error.message : "runtime_instances_unavailable", no_order: true, execution_authority_granted: false }, status);
  }
  if (hasConfigStore(env)) {
    await mirrorConfigJson(env, RISK_PROFILE_BINDINGS_KEY, {
      schema_version: RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION,
      bindings: saved.bindings,
    });
  }
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: session.login,
      action: "save_risk_profile_bindings",
      binding_count: saved.bindings.length,
    });
  } catch { /* audit failure does not undo the durable object decision */ }
  return json({
    ok: true,
    revision: saved.revision,
    bindings: saved.bindings,
    configured_targets: riskProfileBindingTargets(saved.account_options || {}),
    no_order: true,
    execution_authority_granted: false,
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   requireSameOrigin: Function,
 *   readSession: Function,
 *   json: Function,
 *   canonicalResearchTaskJson: Function,
 *   isDcaProfile: Function,
 *   loadStrategyProfilesConfig: Function,
 *   supportedDomainsForAccount: Function,
 *   supportedExecutionModesForPlatform: Function,
 *   assertDcaPlatform: Function,
 *   isFrozenStrategyProfile: Function,
 *   accountSettingsProfileRuntimeReadback: Function,
 *   appendAuditLog: Function,
 * }} deps
 */
export async function approveAccountSettingsProfileApplication(request, env, deps) {
  const {
    requireSameOrigin, readSession, json, canonicalResearchTaskJson, isDcaProfile,
    accountSettingsProfileRuntimeReadback, appendAuditLog,
  } = deps;
  const draftDeps = {
    supportedDomainsForAccount: deps.supportedDomainsForAccount,
    supportedExecutionModesForPlatform: deps.supportedExecutionModesForPlatform,
    assertDcaPlatform: deps.assertDcaPlatform,
    isFrozenStrategyProfile: deps.isFrozenStrategyProfile,
    isDcaProfile: deps.isDcaProfile,
  };
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  let raw;
  try { raw = await request.json(); } catch { return json({ ok: false, error: "request body must be valid JSON" }, 400); }
  const allowedFields = new Set([
    "platform", "key", "request_key", "identity", "expected_instance_revision",
    "expected_draft_revision", "old_profile", "new_profile",
  ]);
  if (!raw || Array.isArray(raw) || typeof raw !== "object" || Object.keys(raw).some((key) => !allowedFields.has(key))) {
    return json({ ok: false, error: "account_settings_profile_application_request_invalid" }, 400);
  }
  if (!SUPPORTED_PLATFORMS.includes(raw.platform) || typeof raw.key !== "string" || !raw.key) {
    return json({ ok: false, error: "account_settings_account_required" }, 400);
  }
  if (!ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY.test(String(raw.request_key || ""))
    || !Number.isSafeInteger(raw.expected_instance_revision) || raw.expected_instance_revision < 0
    || !Number.isSafeInteger(raw.expected_draft_revision) || raw.expected_draft_revision < 0
    || !accountSettingsIdentityIsComplete(raw.identity)) {
    return json({ ok: false, error: "account_settings_profile_application_request_invalid" }, 400);
  }
  const oldProfile = accountSettingsProfileName(raw.old_profile);
  const newProfile = accountSettingsProfileName(raw.new_profile);
  if (!oldProfile || !newProfile || oldProfile === newProfile) {
    return json({ ok: false, error: "account_settings_profile_application_profile_invalid" }, 400);
  }
  if (!hasRuntimeInstanceStore(env)) return json({ ok: false, error: "runtime_instances_not_bound" }, 503);

  const command = {
    action: "account_settings_profile_application_approve",
    actor: session.login,
    platform: raw.platform,
    key: raw.key,
    request_key: raw.request_key,
    identity: raw.identity,
    expected_instance_revision: raw.expected_instance_revision,
    expected_draft_revision: raw.expected_draft_revision,
    old_profile: oldProfile,
    new_profile: newProfile,
  };
  try {
    const prior = await runtimeInstanceCommand(env, {
      action: "account_settings_profile_application_lookup",
      actor: session.login,
      request_key: raw.request_key,
    });
    if (prior.application) {
      const replay = await runtimeInstanceCommand(env, command);
      return json({
        ok: true,
        replayed: true,
        application: replay.application,
        runtime_applied: false,
        variables_updated: false,
        no_order: true,
        execution_authority_granted: false,
      });
    }

    const observed = await runtimeInstanceCommand(env, {
      action: "account_settings_read", actor: session.login, platform: raw.platform, key: raw.key,
    });
    if (observed.instance_revision !== raw.expected_instance_revision
      || canonicalResearchTaskJson(observed.identity) !== canonicalResearchTaskJson(raw.identity)) {
      return json({ ok: false, error: "account_settings_profile_application_identity_conflict" }, 409);
    }
    const draft = observed.draft;
    if (draft?.status !== "current" || draft.revision !== raw.expected_draft_revision
      || canonicalResearchTaskJson(draft.identity) !== canonicalResearchTaskJson(observed.identity)
      || Object.keys(draft.overrides || {}).length !== 1
      || draft.overrides?.strategy_profile !== newProfile) {
      return json({ ok: false, error: "account_settings_profile_application_draft_conflict" }, 409);
    }
    if (isDcaProfile(oldProfile) || isDcaProfile(newProfile)) {
      return json({ ok: false, error: "account_settings_profile_application_profile_only_required" }, 409);
    }
    const profiles = await loadAccountDraftProfiles(env, deps);
    const selectable = accountDraftStrategyChoices(raw.platform, observed.config, profiles, draftDeps);
    if (!selectable.some((profile) => profile.profile === newProfile && profile.dca_supported !== true)) {
      return json({ ok: false, error: "account_settings_profile_application_profile_not_selectable" }, 409);
    }
    const readback = await accountSettingsProfileRuntimeReadback(env, observed);
    if (!readback) return json({ ok: false, error: "account_settings_runtime_readback_unavailable" }, 503);
    if (readback.runtime_target_enabled !== "false") {
      return json({ ok: false, error: "account_settings_runtime_target_not_disabled" }, 409);
    }
    if (readback.strategy_profile !== oldProfile) {
      return json({ ok: false, error: "account_settings_profile_application_current_profile_conflict" }, 409);
    }
    command.current_profile = readback.strategy_profile;
    command.runtime_target_enabled = false;
    const approved = await runtimeInstanceCommand(env, command);
    let auditLogged = false;
    if (!approved.replayed && hasConfigStore(env)) {
      try {
        await appendAuditLog(env, {
          ts: approved.application.approved_at,
          login: session.login,
          action: "approve_account_settings_profile_application",
          platform: raw.platform,
          key: raw.key,
          request_key: raw.request_key,
          instance_revision: raw.expected_instance_revision,
          draft_revision: raw.expected_draft_revision,
          old_profile: oldProfile,
          new_profile: newProfile,
        });
        auditLogged = true;
      } catch { /* the durable approval is authoritative if its audit mirror is unavailable */ }
    }
    return json({
      ok: true,
      replayed: approved.replayed === true,
      application: approved.application,
      audit_logged: auditLogged,
      runtime_applied: false,
      variables_updated: false,
      no_order: true,
      execution_authority_granted: false,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return json({ ok: false, error: error instanceof HttpError ? error.message : "runtime_instances_unavailable", no_order: true, execution_authority_granted: false }, status);
  }
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   json: Function,
 *   canonicalResearchTaskJson: Function,
 *   resolveVariableScope: Function,
 *   resolveGithubEnvironment: Function,
 *   platformRepositories: Function,
 *   accountSettingsProfileRuntimeReadback: Function,
 * }} deps
 */
export async function claimAccountSettingsProfileApplicationFromGitHub(request, env, deps) {
  const {
    json, canonicalResearchTaskJson, resolveVariableScope, resolveGithubEnvironment,
    platformRepositories, accountSettingsProfileRuntimeReadback,
  } = deps;
  if (new URL(request.url).search || !hasRuntimeInstanceStore(env)) {
    return json({ ok: false, error: "account_settings_profile_application_unavailable", no_order: true, execution_authority_granted: false }, 503);
  }
  try {
    const run = await verifyGitHubProfileApplicationToken(request, env);
    const raw = await readGitHubProfileApplicationRequestBody(request);
    if (!ux1ExactKeys(raw, ["request_key"]) || !ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY.test(String(raw.request_key || ""))) {
      return json({ ok: false, error: "account_settings_profile_application_request_invalid", no_order: true, execution_authority_granted: false }, 400);
    }
    const actor = "github-oidc-profile-application";
    const lookup = await runtimeInstanceCommand(env, {
      action: "account_settings_profile_application_lookup", actor, request_key: raw.request_key,
    });
    const application = lookup.application;
    if (!application) return json({ ok: false, error: "account_settings_profile_application_not_found", no_order: true, execution_authority_granted: false }, 404);
    if (!accountSettingsProfileApplicationIsFixedHk(application)) {
      return json({ ok: false, error: "account_settings_profile_application_target_conflict", no_order: true, execution_authority_granted: false }, 409);
    }
    const command = {
      action: "account_settings_profile_application_claim",
      actor,
      request_key: application.request_key,
      identity: application.identity,
      expected_instance_revision: application.instance_revision,
      expected_draft_revision: application.draft_revision,
      old_profile: application.old_profile,
      new_profile: application.new_profile,
      current_profile: application.old_profile,
      runtime_target_enabled: false,
      workflow_run_id: run.runId,
      workflow_run_attempt: run.runAttempt,
    };
    if (application.status === "claimed") {
      const replay = await runtimeInstanceCommand(env, command);
      return json({ ...replay, ok: true });
    }
    if (application.status !== "approved") {
      return json({ ok: false, error: "account_settings_profile_application_conflict", no_order: true, execution_authority_granted: false }, 409);
    }
    const observed = await runtimeInstanceCommand(env, {
      action: "account_settings_read", actor, platform: application.platform, key: application.key,
    });
    if (observed.instance_revision !== application.instance_revision
      || canonicalResearchTaskJson(observed.identity) !== canonicalResearchTaskJson(application.identity)) {
      return json({ ok: false, error: "account_settings_profile_application_identity_conflict", no_order: true, execution_authority_granted: false }, 409);
    }
    const draft = observed.draft;
    if (draft?.status !== "current" || draft.revision !== application.draft_revision
      || canonicalResearchTaskJson(draft.identity) !== canonicalResearchTaskJson(application.identity)
      || Object.keys(draft.overrides || {}).length !== 1
      || draft.overrides?.strategy_profile !== application.new_profile) {
      return json({ ok: false, error: "account_settings_profile_application_draft_conflict", no_order: true, execution_authority_granted: false }, 409);
    }
    const variableScope = resolveVariableScope(application.platform, observed.config);
    const githubEnvironment = resolveGithubEnvironment(application.platform, observed.config, variableScope);
    const repository = platformRepositories(env)?.[application.platform];
    if (repository !== "QuantStrategyLab/LongBridgePlatform"
      || variableScope !== "environment"
      || githubEnvironment !== "longbridge-hk") {
      return json({ ok: false, error: "account_settings_profile_application_target_conflict", no_order: true, execution_authority_granted: false }, 409);
    }
    const readback = await accountSettingsProfileRuntimeReadback(env, observed, {
      repository, variableScope, githubEnvironment,
    });
    if (!readback) return json({ ok: false, error: "account_settings_runtime_readback_unavailable", no_order: true, execution_authority_granted: false }, 503);
    if (readback.runtime_target_enabled !== "false" || readback.strategy_profile !== application.old_profile) {
      return json({ ok: false, error: "account_settings_profile_application_runtime_conflict", no_order: true, execution_authority_granted: false }, 409);
    }
    const claimed = await runtimeInstanceCommand(env, command);
    return json({ ...claimed, ok: true });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return json({ ok: false, error: error instanceof HttpError ? error.message : "account_settings_profile_application_unavailable", no_order: true, execution_authority_granted: false }, status);
  }
}
