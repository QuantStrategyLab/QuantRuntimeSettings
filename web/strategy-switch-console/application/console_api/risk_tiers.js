/** Closed risk-tier policy bindings. These are owner intent, never execution authority. */
export const RISK_TIER_POLICY_BINDINGS = Object.freeze({
  CAPITAL_PRESERVATION: Object.freeze({
    policy_id: "capital_preservation_v1",
    profile_id: "capital_preservation_v1",
    composer_mdd_multiple: 1.0,
    promotion_size_scale: 0.5,
  }),
  BALANCED_COMPOUNDING: Object.freeze({
    policy_id: "balanced_compounding_v1",
    profile_id: "balanced_compounding_v1",
    composer_mdd_multiple: 1.25,
    promotion_size_scale: 0.75,
  }),
  GROWTH_COMPOUNDING: Object.freeze({
    policy_id: "growth_compounding_v1",
    profile_id: "growth_compounding_v1",
    composer_mdd_multiple: 1.5,
    promotion_size_scale: 1.0,
  }),
});

export const RISK_TIER_BINDING_SCHEMA_VERSION = "qsl.risk_tier_binding.v1";

export function riskTierPolicy(tier) {
  const policy = RISK_TIER_POLICY_BINDINGS[tier];
  return policy ? {
    schema_version: "qsl.risk_tier_policy.v1",
    tier,
    policy_id: policy.policy_id,
    profile_id: policy.profile_id,
    composer_mdd_multiple: policy.composer_mdd_multiple,
    promotion_size_scale: policy.promotion_size_scale,
    executable: false,
    activation_status: "not_connected",
  } : null;
}

/**
 * Declarative tier policies as owner intent only. Nothing consumes these
 * numbers for orders, so every entry keeps the non-executable flags and an
 * unknown tier resolves to null instead of a numeric default.
 */
export function riskTierPolicyCatalog() {
  return Object.keys(RISK_TIER_POLICY_BINDINGS).map((tier) => ({
    ...riskTierPolicy(tier),
    owner_intent_only: true,
    no_order: true,
    execution_authority_granted: false,
  }));
}

/**
 * Effective tier is an independently observed runtime readback, never a copy of
 * the approved policy (ARCHITECTURE.md 4.4). Without an observation the tier
 * stays null and carries an explicit reason code.
 */
export function riskTierEffectiveView(observation) {
  const tier = observation && RISK_TIER_POLICY_BINDINGS[observation.tier] ? observation.tier : null;
  return tier ? {
    tier,
    status: "observed",
    unavailable_reason: null,
    source: observation.source || "runtime_readback",
    observed_at: observation.observed_at || null,
  } : {
    tier: null,
    status: "unavailable",
    unavailable_reason: "effective_tier_not_observed",
    source: null,
    observed_at: null,
  };
}

export function riskTierBindingView({ scope_id, platform, target_name, binding, revision = null, observation = null }) {
  const tier = binding?.profile_selection?.risk_preference || null;
  const policy = riskTierPolicy(tier);
  return {
    schema_version: RISK_TIER_BINDING_SCHEMA_VERSION,
    scope_id: scope_id || binding?.scope_id || null,
    platform: platform || binding?.platform || null,
    target_name: target_name || binding?.target_name || null,
    selected: binding && tier ? {
      tier,
      profile_id: binding.profile_selection.profile_id || policy?.profile_id || null,
      revision,
      binding_sha256: binding.binding_sha256 || null,
      updated_at: binding.updated_at || null,
      source: "risk_profile_binding",
    } : null,
    approved: policy ? {
      tier,
      profile_id: policy.profile_id,
      policy_id: policy.policy_id,
      policy,
      source: "policy_binding",
    } : null,
    effective: riskTierEffectiveView(observation),
    effective_derived_from_approved: false,
    no_order: true,
    execution_authority_granted: false,
  };
}
