/**
 * NAMING-CANONICAL (Roadmap v2.0 Item 16): Pure validation and alias helpers.
 *
 * Pure leaf helpers under application/naming_canonical/:
 * - Imports only inward from ./constants.js.
 * - Never imports runtime_support.js, worker.js, storage, or HTTP modules.
 * - Preserves immutable legacy hashes/keys via non-destructive legacy_aliases.
 */

import {
  ACCOUNT_SLOT_TUPLE_RE,
  ALIAS_KINDS,
  ALIAS_KIND_SET,
  CANONICAL_NAMING_REGISTRY,
  CANONICAL_PLATFORM_SLUGS,
  CANONICAL_RISK_TIER_MAP,
  DISPOSITION_SET,
  EMBEDDED_PRIVATE_PATH_RE,
  ENVIRONMENT_SET,
  NAMING_REGISTRY_SCHEMA,
  PLATFORM_SLUG_SET,
  PLUGIN_ID_RE,
  PRIVATE_LOCATOR_KEYS,
  PRIVATE_VALUE_RE,
  RAW_GROUPED_CANDIDATE_RE,
  RAW_SPLIT_DIGITS_RE,
  RAW_U_DU_ACCOUNT_RE,
  REVERSE_RISK_TIER_MAP,
  STRATEGY_FORBIDDEN_EMBEDDED_RE,
  STRATEGY_FORBIDDEN_SEGMENT_RE,
  STRATEGY_PROFILE_ID_RE,
  STRATEGY_VERSION_FIELD_RE,
  URI_SCHEME_PREFIX_RE,
} from "./constants.js";

export function isUnsafePrivateLocator(value) {
  if (typeof value !== "string") return false;
  return (
    URI_SCHEME_PREFIX_RE.test(value)
    || EMBEDDED_PRIVATE_PATH_RE.test(value)
    || PRIVATE_VALUE_RE.test(value)
  );
}

export function isRawAccountIdentifier(value) {
  if (typeof value !== "string") return false;
  if (RAW_U_DU_ACCOUNT_RE.test(value) || RAW_SPLIT_DIGITS_RE.test(value)) {
    return true;
  }
  const matches = value.match(RAW_GROUPED_CANDIDATE_RE);
  if (matches) {
    for (const group of matches) {
      if (group.replace(/[-_.\s]/g, "").length >= 6) return true;
    }
  }
  return false;
}

export function isValidPlatformSlug(slug) {
  return typeof slug === "string" && PLATFORM_SLUG_SET.has(slug);
}

export function parseAccountSlotKey(key) {
  if (typeof key !== "string" || !key.length) {
    return { ok: false, reason: "invalid_account_slot_type" };
  }
  if (isUnsafePrivateLocator(key)) {
    return { ok: false, reason: "unsafe_private_locator" };
  }
  const match = ACCOUNT_SLOT_TUPLE_RE.exec(key);
  if (!match) {
    if (isRawAccountIdentifier(key)) {
      return { ok: false, reason: "raw_account_id_prohibited" };
    }
    return { ok: false, reason: "invalid_account_slot_format" };
  }
  const [, platform, env, slot] = match;
  if (isRawAccountIdentifier(slot)) {
    return { ok: false, reason: "raw_account_id_prohibited" };
  }
  return { ok: true, key, platform, env, slot };
}

export function formatAccountSlotKey(platform, env, slot) {
  if (!isValidPlatformSlug(platform) || typeof env !== "string" || !ENVIRONMENT_SET.has(env) || typeof slot !== "string") {
    return null;
  }
  const key = `${platform}:${env}:${slot}`;
  const parsed = parseAccountSlotKey(key);
  return parsed.ok ? parsed.key : null;
}

export function isValidStrategyProfileId(id) {
  if (typeof id !== "string" || !id.length) return false;
  if (isUnsafePrivateLocator(id) || isRawAccountIdentifier(id)) return false;
  if (STRATEGY_FORBIDDEN_EMBEDDED_RE.test(id)) return false;
  const match = STRATEGY_PROFILE_ID_RE.exec(id);
  if (!match) return false;
  const [, , asset, family, horizon] = match;
  return (
    !STRATEGY_FORBIDDEN_SEGMENT_RE.test(asset)
    && !STRATEGY_FORBIDDEN_SEGMENT_RE.test(family)
    && !STRATEGY_FORBIDDEN_SEGMENT_RE.test(horizon)
  );
}

export function isValidPluginId(id) {
  if (typeof id !== "string" || !id.length) return false;
  if (isUnsafePrivateLocator(id) || isRawAccountIdentifier(id)) return false;
  return PLUGIN_ID_RE.test(id);
}

export function pluginCapabilityClass(id) {
  if (!isValidPluginId(id)) return null;
  if (id.startsWith("obs_")) return "observer";
  if (id.startsWith("risk_")) return "risk_reduction";
  return null;
}

export function consoleTierToEngineTier(consoleTier) {
  if (typeof consoleTier !== "string") return null;
  return Object.hasOwn(CANONICAL_RISK_TIER_MAP, consoleTier)
    ? CANONICAL_RISK_TIER_MAP[consoleTier]
    : null;
}

export function engineTierToConsoleTier(engineTier) {
  if (typeof engineTier !== "string") return null;
  return Object.hasOwn(REVERSE_RISK_TIER_MAP, engineTier)
    ? REVERSE_RISK_TIER_MAP[engineTier]
    : null;
}

function hasNonEmptyHumanLabel(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

function scanSafetyViolations(value, path, errors) {
  if (typeof value === "string") {
    if (isUnsafePrivateLocator(value)) {
      errors.push(`${path}:unsafe_private_locator`);
    }
    if (isRawAccountIdentifier(value)) {
      errors.push(`${path}:raw_account_id_prohibited`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanSafetyViolations(value[i], `${path}[${i}]`, errors);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (PRIVATE_LOCATOR_KEYS.has(k)) {
        errors.push(`${path}.${k}:private_locator_key_prohibited`);
      }
      scanSafetyViolations(v, `${path}.${k}`, errors);
    }
  }
}

function canonicalIdSetForKind(registry, kind) {
  if (!registry || typeof registry !== "object") return new Set();
  if (kind === "platforms") {
    return new Set(Object.keys(registry.platforms || {}));
  }
  if (kind === "accounts") {
    return new Set(
      Array.isArray(registry.account_slots)
        ? registry.account_slots.map((item) => item?.slot_key).filter((v) => typeof v === "string")
        : [],
    );
  }
  if (kind === "strategies") {
    return new Set(
      Array.isArray(registry.strategies)
        ? registry.strategies.map((item) => item?.strategy_id).filter((v) => typeof v === "string")
        : [],
    );
  }
  if (kind === "plugins") {
    return new Set(
      Array.isArray(registry.plugins)
        ? registry.plugins.map((item) => item?.plugin_id).filter((v) => typeof v === "string")
        : [],
    );
  }
  return new Set();
}

function isValidCanonicalTargetForKind(kind, id) {
  if (kind === "platforms") return isValidPlatformSlug(id);
  if (kind === "accounts") return parseAccountSlotKey(id).ok;
  if (kind === "strategies") return isValidStrategyProfileId(id);
  if (kind === "plugins") return isValidPluginId(id);
  return false;
}

function buildNormalizedTargetIndex(ids) {
  const index = new Map();
  for (const id of ids) {
    const norm = id.toLowerCase();
    if (!index.has(norm)) index.set(norm, new Set());
    index.get(norm).add(id);
  }
  return index;
}

export function resolveCanonicalAlias(kind, name, registry = CANONICAL_NAMING_REGISTRY) {
  if (!ALIAS_KIND_SET.has(kind)) {
    return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "invalid_alias_kind" };
  }
  if (typeof name !== "string" || name.length === 0 || name.trim() !== name) {
    return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "invalid_input" };
  }
  if (isUnsafePrivateLocator(name)) {
    return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "unsafe_private_locator" };
  }
  if (isRawAccountIdentifier(name)) {
    return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "raw_account_id_prohibited" };
  }

  const canonicalSet = canonicalIdSetForKind(registry, kind);
  const normCanonicalTargets = buildNormalizedTargetIndex(canonicalSet);
  const entries = Array.isArray(registry?.legacy_aliases?.[kind]) ? registry.legacy_aliases[kind] : [];
  const exactTargets = new Map();
  const normalizedTargets = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry.legacy_id !== "string" || typeof entry.canonical_id !== "string") continue;
    const legacy = entry.legacy_id;
    const canonical = entry.canonical_id;
    if (!exactTargets.has(legacy)) exactTargets.set(legacy, new Set());
    exactTargets.get(legacy).add(canonical);
    const norm = legacy.trim().toLowerCase();
    if (!normalizedTargets.has(norm)) normalizedTargets.set(norm, new Set());
    normalizedTargets.get(norm).add(canonical);
  }

  const normInput = name.toLowerCase();
  const normConflictSet = normalizedTargets.get(normInput);
  const normCanonConflictSet = normCanonicalTargets.get(normInput);

  if (canonicalSet.has(name)) {
    const selfExact = exactTargets.get(name);
    if ((selfExact && ([...selfExact].some((target) => target !== name) || selfExact.size > 1))
      || (normConflictSet && [...normConflictSet].some((target) => target !== name))
      || (normCanonConflictSet && [...normCanonConflictSet].some((cid) => cid !== name))) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "ambiguous_alias" };
    }
    if (!isValidCanonicalTargetForKind(kind, name)) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "invalid_canonical_id" };
    }
    return { ok: true, kind, input: name, canonical: name, aliased: false };
  }

  const exactMatchSet = exactTargets.get(name);
  if (exactMatchSet) {
    if (exactMatchSet.size > 1 || (normConflictSet && normConflictSet.size > 1)) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "ambiguous_alias" };
    }
    const target = [...exactMatchSet][0];
    if (normCanonConflictSet && [...normCanonConflictSet].some((cid) => cid !== target)) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "ambiguous_alias" };
    }
    if (!canonicalSet.has(target) || !isValidCanonicalTargetForKind(kind, target)) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "invalid_alias_target" };
    }
    return { ok: true, kind, input: name, canonical: target, aliased: true };
  }

  if ((normConflictSet && normConflictSet.size > 1)
    || (normCanonConflictSet && normCanonConflictSet.size > 1)
    || (normCanonConflictSet && normConflictSet && [...normCanonConflictSet].some((cid) => ![...normConflictSet].includes(cid)))) {
    return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "ambiguous_alias" };
  }

  if (kind === "accounts" && !name.includes(":")) {
    const suffixMatches = new Set();
    for (const entry of entries) {
      if (typeof entry?.legacy_id !== "string" || typeof entry?.canonical_id !== "string") continue;
      const idx = entry.legacy_id.indexOf(":");
      if (idx > 0 && entry.legacy_id.slice(idx + 1).toLowerCase() === normInput) {
        suffixMatches.add(entry.canonical_id);
      }
    }
    if (Array.isArray(registry?.account_slots)) {
      for (const slotItem of registry.account_slots) {
        if (typeof slotItem?.slot === "string" && slotItem.slot.toLowerCase() === normInput && typeof slotItem?.slot_key === "string") {
          suffixMatches.add(slotItem.slot_key);
        }
      }
    }
    if (suffixMatches.size > 1) {
      return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "ambiguous_alias" };
    }
  }

  return { ok: false, kind, input: name, canonical: null, aliased: false, reason: "unknown_alias" };
}

export function validateNamingRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    return { ok: false, errors: ["registry:must_be_object"] };
  }

  if (registry.schema_version !== NAMING_REGISTRY_SCHEMA) {
    errors.push("schema_version:invalid");
  }
  if (registry.immutable_legacy_hashes !== true) {
    errors.push("immutable_legacy_hashes:must_be_true");
  }
  if (
    registry.authority?.convention_only !== true
    || registry.authority?.authorizes_rename_or_migration !== false
    || registry.authority?.authorizes_deployment_or_trading !== false
  ) {
    errors.push("authority:invalid_boundary_flags");
  }

  scanSafetyViolations(registry, "registry", errors);

  // Platforms: closed 5-slug set, binance dormant, zero A-share venue.
  const platforms = registry.platforms;
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) {
    errors.push("platforms:must_be_object");
  } else {
    const keys = Object.keys(platforms);
    if (keys.length !== CANONICAL_PLATFORM_SLUGS.length || CANONICAL_PLATFORM_SLUGS.some((slug) => !Object.hasOwn(platforms, slug))) {
      errors.push("platforms:must_match_closed_slug_set");
    }
    for (const key of keys) {
      if (!isValidPlatformSlug(key)) {
        errors.push(`platforms.${key}:disallowed_platform_slug`);
        continue;
      }
      const entry = platforms[key];
      if (!entry || typeof entry !== "object") {
        errors.push(`platforms.${key}:invalid_entry`);
        continue;
      }
      if (entry.slug !== key) {
        errors.push(`platforms.${key}:slug_mismatch`);
      }
      if (entry.status !== "active" && entry.status !== "dormant") {
        errors.push(`platforms.${key}:invalid_status`);
      }
      if (key === "binance" && entry.status !== "dormant") {
        errors.push("platforms.binance:must_be_dormant");
      }
      if (!hasNonEmptyHumanLabel(entry.label_zh) || !hasNonEmptyHumanLabel(entry.label_en)) {
        errors.push(`platforms.${key}:labels_required`);
      }
    }
  }

  // Account slots: {platform}:{env}:{slot}, unique, zero raw account numbers.
  const accountSlotKeys = new Set();
  if (!Array.isArray(registry.account_slots) || registry.account_slots.length === 0) {
    errors.push("account_slots:must_be_non_empty_array");
  } else {
    for (let i = 0; i < registry.account_slots.length; i++) {
      const entry = registry.account_slots[i];
      const prefix = `account_slots[${i}]`;
      if (!entry || typeof entry !== "object") {
        errors.push(`${prefix}:invalid_entry`);
        continue;
      }
      const parsed = parseAccountSlotKey(entry.slot_key);
      if (!parsed.ok) {
        errors.push(`${prefix}:${parsed.reason}`);
      } else {
        if (entry.platform !== parsed.platform || entry.env !== parsed.env || entry.slot !== parsed.slot) {
          errors.push(`${prefix}:tuple_field_mismatch`);
        }
        if (accountSlotKeys.has(entry.slot_key)) {
          errors.push(`${prefix}:duplicate_slot_key`);
        }
        accountSlotKeys.add(entry.slot_key);
      }
      if (entry.synthetic !== true) {
        errors.push(`${prefix}:must_be_synthetic`);
      }
      if (!hasNonEmptyHumanLabel(entry.label_zh) || !hasNonEmptyHumanLabel(entry.label_en)) {
        errors.push(`${prefix}:labels_required`);
      }
    }
  }

  // Strategies: {market}_{asset}_{family}_{horizon}, separate version & risk_tier, unique IDs.
  const strategyIds = new Set();
  if (!Array.isArray(registry.strategies) || registry.strategies.length === 0) {
    errors.push("strategies:must_be_non_empty_array");
  } else {
    for (let i = 0; i < registry.strategies.length; i++) {
      const entry = registry.strategies[i];
      const prefix = `strategies[${i}]`;
      if (!entry || typeof entry !== "object") {
        errors.push(`${prefix}:invalid_entry`);
        continue;
      }
      if (!isValidStrategyProfileId(entry.strategy_id)) {
        errors.push(`${prefix}:invalid_strategy_id`);
      } else {
        if (strategyIds.has(entry.strategy_id)) {
          errors.push(`${prefix}:duplicate_strategy_id`);
        }
        strategyIds.add(entry.strategy_id);
        const expectedId = `${entry.market}_${entry.asset}_${entry.family}_${entry.horizon}`;
        if (entry.strategy_id !== expectedId) {
          errors.push(`${prefix}:tuple_field_mismatch`);
        }
      }
      if (typeof entry.version !== "string" || !STRATEGY_VERSION_FIELD_RE.test(entry.version)) {
        errors.push(`${prefix}:invalid_version_metadata`);
      }
      if (!Object.hasOwn(CANONICAL_RISK_TIER_MAP, entry.risk_tier)) {
        errors.push(`${prefix}:invalid_risk_tier`);
      }
      if (!DISPOSITION_SET.has(entry.disposition)) {
        errors.push(`${prefix}:invalid_disposition`);
      }
      if (!hasNonEmptyHumanLabel(entry.label_zh) || !hasNonEmptyHumanLabel(entry.label_en)) {
        errors.push(`${prefix}:labels_required`);
      }
    }
  }

  // Plugins: obs_* (read_only, no risk adjustment) vs risk_* (scalar <= 1.0); zero fuse bypass.
  const pluginIds = new Set();
  if (!Array.isArray(registry.plugins) || registry.plugins.length === 0) {
    errors.push("plugins:must_be_non_empty_array");
  } else {
    for (let i = 0; i < registry.plugins.length; i++) {
      const entry = registry.plugins[i];
      const prefix = `plugins[${i}]`;
      if (!entry || typeof entry !== "object") {
        errors.push(`${prefix}:invalid_entry`);
        continue;
      }
      const capClass = pluginCapabilityClass(entry.plugin_id);
      if (!capClass) {
        errors.push(`${prefix}:invalid_plugin_id`);
      } else {
        if (pluginIds.has(entry.plugin_id)) {
          errors.push(`${prefix}:duplicate_plugin_id`);
        }
        pluginIds.add(entry.plugin_id);
        if (entry.capability_class !== capClass) {
          errors.push(`${prefix}:capability_class_mismatch`);
        }
      }
      if (entry.can_bypass_fuse !== false) {
        errors.push(`${prefix}:fuse_bypass_prohibited`);
      }
      if (capClass === "observer") {
        if (entry.read_only !== true) {
          errors.push(`${prefix}:observer_must_be_read_only`);
        }
        if (entry.can_adjust_risk !== false) {
          errors.push(`${prefix}:observer_cannot_adjust_risk`);
        }
        if (entry.max_scalar !== null && entry.max_scalar !== 1.0) {
          errors.push(`${prefix}:observer_invalid_max_scalar`);
        }
      } else if (capClass === "risk_reduction") {
        if (entry.read_only !== false) {
          errors.push(`${prefix}:risk_plugin_read_only_mismatch`);
        }
        if (entry.can_adjust_risk !== true) {
          errors.push(`${prefix}:risk_plugin_must_declare_risk_adjustment`);
        }
        if (typeof entry.max_scalar !== "number" || !Number.isFinite(entry.max_scalar) || entry.max_scalar < 0 || entry.max_scalar > 1.0) {
          errors.push(`${prefix}:risk_plugin_max_scalar_out_of_bounds`);
        }
      }
      if (!hasNonEmptyHumanLabel(entry.label_zh) || !hasNonEmptyHumanLabel(entry.label_en)) {
        errors.push(`${prefix}:labels_required`);
      }
    }
  }

  // Risk tiers: strict 1:1 bijection.
  const riskTiers = registry.risk_tiers;
  const expectedConsoleTiers = Object.keys(CANONICAL_RISK_TIER_MAP);
  if (!riskTiers || typeof riskTiers !== "object" || Array.isArray(riskTiers)) {
    errors.push("risk_tiers:must_be_object");
  } else {
    const keys = Object.keys(riskTiers);
    if (keys.length !== expectedConsoleTiers.length || expectedConsoleTiers.some((t) => !Object.hasOwn(riskTiers, t))) {
      errors.push("risk_tiers:must_match_canonical_keys");
    }
    const seenEngine = new Set();
    for (const key of keys) {
      const entry = riskTiers[key];
      if (!entry || typeof entry !== "object") {
        errors.push(`risk_tiers.${key}:invalid_entry`);
        continue;
      }
      if (entry.console_tier !== key) {
        errors.push(`risk_tiers.${key}:console_tier_mismatch`);
      }
      if (entry.engine_tier !== CANONICAL_RISK_TIER_MAP[key]) {
        errors.push(`risk_tiers.${key}:engine_tier_mismatch`);
      }
      if (seenEngine.has(entry.engine_tier)) {
        errors.push(`risk_tiers.${key}:duplicate_engine_tier`);
      }
      seenEngine.add(entry.engine_tier);
      if (!hasNonEmptyHumanLabel(entry.label_zh) || !hasNonEmptyHumanLabel(entry.label_en)) {
        errors.push(`risk_tiers.${key}:labels_required`);
      }
    }
    if (seenEngine.size !== expectedConsoleTiers.length) {
      errors.push("risk_tiers:bijection_broken");
    }
  }

  // Legacy aliases: valid targets, no duplicates, no ambiguous collisions, no canonical shadowing.
  const aliases = registry.legacy_aliases;
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
    errors.push("legacy_aliases:must_be_object");
  } else {
    const aliasKeys = Object.keys(aliases);
    if (aliasKeys.length !== ALIAS_KINDS.length || ALIAS_KINDS.some((k) => !Object.hasOwn(aliases, k))) {
      errors.push("legacy_aliases:invalid_categories");
    }
    const targetSets = {
      platforms: new Set(Object.keys(platforms || {})),
      accounts: accountSlotKeys,
      strategies: strategyIds,
      plugins: pluginIds,
    };
    for (const kind of ALIAS_KINDS) {
      const list = aliases[kind];
      if (!Array.isArray(list)) {
        errors.push(`legacy_aliases.${kind}:must_be_array`);
        continue;
      }
      const seenExact = new Set();
      const seenNormTarget = new Map();
      const targets = targetSets[kind];
      const normCanonicalTargets = buildNormalizedTargetIndex(targets);
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const prefix = `legacy_aliases.${kind}[${i}]`;
        if (!item || typeof item !== "object") {
          errors.push(`${prefix}:invalid_entry`);
          continue;
        }
        if (typeof item.legacy_id !== "string" || item.legacy_id.trim() !== item.legacy_id || item.legacy_id.length === 0) {
          errors.push(`${prefix}:invalid_legacy_id`);
          continue;
        }
        if (typeof item.canonical_id !== "string" || !targets.has(item.canonical_id) || !isValidCanonicalTargetForKind(kind, item.canonical_id)) {
          errors.push(`${prefix}:invalid_canonical_target`);
        }
        const norm = item.legacy_id.toLowerCase();
        const normCanonSet = normCanonicalTargets.get(norm);
        if ((targets.has(item.legacy_id) && item.canonical_id !== item.legacy_id)
          || (normCanonSet && [...normCanonSet].some((cid) => cid !== item.canonical_id))) {
          errors.push(`${prefix}:shadows_canonical_id`);
        }
        if (seenExact.has(item.legacy_id)) {
          errors.push(`${prefix}:duplicate_legacy_id`);
        }
        seenExact.add(item.legacy_id);
        if (seenNormTarget.has(norm) && seenNormTarget.get(norm) !== item.canonical_id) {
          errors.push(`${prefix}:ambiguous_normalized_alias`);
        }
        seenNormTarget.set(norm, item.canonical_id);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
