import { PLATFORM_CONFIG } from "../../config.js";
import { cleanGithubLogin } from "../auth/identity_lists.js";
import {
  canonicalResearchTaskJson,
  normalizeResearchTaskDigest,
  normalizeResearchTaskTimestamp,
} from "../research_task/helpers.js";
import {
  assertConstantField,
  assertExactObject,
  cleanBoundedArray,
  cleanChoice,
  cleanSlug,
} from "../schema_validators.js";
import {
  RISK_PROFILE_BINDINGS_KEY,
  RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION,
  RISK_PROFILE_BINDING_SCHEMA_VERSION,
  RISK_PROFILE_IDS,
  RISK_PROFILE_PREFERENCES,
  RISK_PROFILE_SELECTION_SCHEMA_VERSION,
} from "./constants.js";

const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_CONFIG);

export function riskProfileScopeId(platform, targetName) {
  return `${platform}--${targetName}`;
}

export function riskProfileBindingTargets(accountOptions) {
  const targets = [];
  for (const platform of SUPPORTED_PLATFORMS) {
    const options = Array.isArray(accountOptions?.[platform]) ? accountOptions[platform] : [];
    for (const option of options) {
      targets.push({
        scope_id: riskProfileScopeId(platform, option.target_name),
        platform,
        target_name: option.target_name,
      });
    }
  }
  return targets.sort((left, right) => left.scope_id.localeCompare(right.scope_id));
}

export function utcTimestampSeconds(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function sha256ExcludingField(payload, excludedField) {
  const material = { ...payload };
  delete material[excludedField];
  const raw = new TextEncoder().encode(canonicalResearchTaskJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function calculateRiskProfileSelectionSha256(payload) {
  return sha256ExcludingField(payload, "selection_sha256");
}

export async function normalizeRiskProfileSelection(payload, fieldName) {
  const value = assertExactObject(payload, ["schema", "profile_id", "risk_preference", "selection_sha256"], fieldName);
  const riskPreference = cleanChoice(value.risk_preference, RISK_PROFILE_PREFERENCES, `${fieldName}.risk_preference`);
  const normalized = {
    schema: RISK_PROFILE_SELECTION_SCHEMA_VERSION,
    profile_id: RISK_PROFILE_IDS[riskPreference],
    risk_preference: riskPreference,
    selection_sha256: normalizeResearchTaskDigest(value.selection_sha256, `${fieldName}.selection_sha256`),
  };
  assertConstantField(value.schema, RISK_PROFILE_SELECTION_SCHEMA_VERSION, `${fieldName}.schema is unsupported`);
  assertConstantField(value.profile_id, normalized.profile_id, `${fieldName}.profile_id does not match risk_preference`);
  if (normalized.selection_sha256 !== await calculateRiskProfileSelectionSha256(normalized)) {
    throw new Error(`${fieldName}.selection_sha256 mismatch`);
  }
  return normalized;
}

export async function calculateRiskProfileBindingSha256(payload) {
  return sha256ExcludingField(payload, "binding_sha256");
}

export async function normalizeRiskProfileBinding(payload, fieldName) {
  const value = assertExactObject(
    payload,
    [
      "schema_version", "scope_id", "platform", "target_name", "profile_selection", "updated_at", "updated_by",
      "no_order", "execution_authority_granted", "binding_sha256",
    ],
    fieldName,
  );
  const platform = cleanChoice(value.platform, SUPPORTED_PLATFORMS, `${fieldName}.platform`);
  const targetName = cleanSlug(value.target_name, `${fieldName}.target_name`);
  const normalized = {
    schema_version: RISK_PROFILE_BINDING_SCHEMA_VERSION,
    scope_id: riskProfileScopeId(platform, targetName),
    platform,
    target_name: targetName,
    profile_selection: await normalizeRiskProfileSelection(value.profile_selection, `${fieldName}.profile_selection`),
    updated_at: normalizeResearchTaskTimestamp(value.updated_at, `${fieldName}.updated_at`),
    updated_by: cleanGithubLogin(value.updated_by, `${fieldName}.updated_by`),
    no_order: value.no_order,
    execution_authority_granted: value.execution_authority_granted,
    binding_sha256: normalizeResearchTaskDigest(value.binding_sha256, `${fieldName}.binding_sha256`),
  };
  assertConstantField(value.schema_version, RISK_PROFILE_BINDING_SCHEMA_VERSION, `${fieldName}.schema_version is unsupported`);
  assertConstantField(value.scope_id, normalized.scope_id, `${fieldName}.scope_id does not match platform and target_name`);
  if (normalized.no_order !== true || normalized.execution_authority_granted !== false) {
    throw new Error(`${fieldName} must remain no-order and non-executable`);
  }
  if (normalized.binding_sha256 !== await calculateRiskProfileBindingSha256(normalized)) {
    throw new Error(`${fieldName}.binding_sha256 mismatch`);
  }
  return normalized;
}

export async function normalizeRiskProfileBindingRegistry(payload, fieldName = RISK_PROFILE_BINDINGS_KEY) {
  const value = assertExactObject(payload, ["schema_version", "bindings"], fieldName);
  assertConstantField(
    value.schema_version,
    RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION,
    `${fieldName}.schema_version is unsupported`,
  );
  const rawBindings = cleanBoundedArray(value.bindings, `${fieldName}.bindings`, {
    maxLength: SUPPORTED_PLATFORMS.length * 20,
    lengthMessage: `${fieldName}.bindings must be a bounded array`,
  });
  const bindings = [];
  const scopes = new Set();
  for (const [index, item] of rawBindings.entries()) {
    const binding = await normalizeRiskProfileBinding(item, `${fieldName}.bindings[${index}]`);
    if (scopes.has(binding.scope_id)) throw new Error(`${fieldName}.bindings contains duplicate scope_id`);
    scopes.add(binding.scope_id);
    bindings.push(binding);
  }
  return bindings.sort((left, right) => left.scope_id.localeCompare(right.scope_id));
}

export async function buildRiskProfileBindings(payload, accountOptions, updatedBy) {
  const value = assertExactObject(payload, ["bindings"], "risk profile bindings request");
  const rawBindings = cleanBoundedArray(value.bindings, "risk profile bindings request.bindings", {
    maxLength: SUPPORTED_PLATFORMS.length * 20,
    lengthMessage: "risk profile bindings request.bindings must be a bounded array",
  });
  const configuredTargets = riskProfileBindingTargets(accountOptions);
  const bindings = [];
  const scopes = new Set();
  const updatedAt = utcTimestampSeconds();
  for (const [index, item] of rawBindings.entries()) {
    const itemValue = assertExactObject(
      item,
      ["platform", "target_name", "risk_preference"],
      `risk profile bindings request.bindings[${index}]`,
    );
    const platform = cleanChoice(itemValue.platform, SUPPORTED_PLATFORMS, `risk profile bindings request.bindings[${index}].platform`);
    const targetName = cleanSlug(itemValue.target_name, `risk profile bindings request.bindings[${index}].target_name`);
    if (!configuredTargets.some((target) => target.platform === platform && target.target_name === targetName)) {
      throw new Error(`risk profile binding target is not configured: ${platform}/${targetName}`);
    }
    const scopeId = riskProfileScopeId(platform, targetName);
    if (scopes.has(scopeId)) throw new Error("risk profile bindings request contains duplicate target");
    scopes.add(scopeId);
    const riskPreference = cleanChoice(
      itemValue.risk_preference,
      RISK_PROFILE_PREFERENCES,
      `risk profile bindings request.bindings[${index}].risk_preference`,
    );
    const profileSelection = {
      schema: RISK_PROFILE_SELECTION_SCHEMA_VERSION,
      profile_id: RISK_PROFILE_IDS[riskPreference],
      risk_preference: riskPreference,
      selection_sha256: "",
    };
    profileSelection.selection_sha256 = await calculateRiskProfileSelectionSha256(profileSelection);
    const binding = {
      schema_version: RISK_PROFILE_BINDING_SCHEMA_VERSION,
      scope_id: scopeId,
      platform,
      target_name: targetName,
      profile_selection: profileSelection,
      updated_at: updatedAt,
      updated_by: cleanGithubLogin(updatedBy, "risk profile binding.updated_by"),
      no_order: true,
      execution_authority_granted: false,
      binding_sha256: "",
    };
    binding.binding_sha256 = await calculateRiskProfileBindingSha256(binding);
    bindings.push(await normalizeRiskProfileBinding(binding, `risk profile bindings request.bindings[${index}]`));
  }
  return bindings.sort((left, right) => left.scope_id.localeCompare(right.scope_id));
}
