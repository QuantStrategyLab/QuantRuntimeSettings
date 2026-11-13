/**
 * Account-settings / profile-application constants.
 * Owned by application/account_settings; re-exported from runtime_support.
 */

export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_PATH = "/api/internal/account-settings/profile-application/claim";
export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_AUDIENCE = "qrs-profile-application";
export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_REPOSITORY = "QuantStrategyLab/QuantRuntimeSettings";
export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_REF = "refs/heads/main";
export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_WORKFLOW_REF = "QuantStrategyLab/QuantRuntimeSettings/.github/workflows/apply-approved-hk-profile.yml@refs/heads/main";
export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_TOKEN_BYTES = 8192;
export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_JWKS_BYTES = 32 * 1024;
export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_TIMEOUT_MS = 5000;
export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_TIMEOUT_MS = 1000;
export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_MAX_BODY_BYTES = 1024;

export const ACCOUNT_SETTINGS_DO_ACTIONS = new Set([
  "risk_profile_read", "risk_profile_replace", "risk_profile_set",
  "account_settings_read", "account_settings_save", "account_declarations_read",
  "account_settings_profile_application_lookup", "account_settings_profile_application_approve",
  "account_settings_profile_application_claim",
]);

export const ACCOUNT_SETTING_OVERRIDE_FIELDS = [
  "strategy_profile",
  "income_layer_enabled",
  "option_overlay_enabled",
  "reserved_cash_floor",
  "reserved_cash_ratio",
  "dca_mode",
  "dca_base_investment_usd",
];

export const ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
