export const ACCOUNT_DIAGNOSIS_REQUEST_PATH = "/api/account-diagnosis";
export const ACCOUNT_DIAGNOSIS_INTERNAL_PREFIX = "/api/internal/account-diagnosis/";
export const ACCOUNT_DIAGNOSIS_TARGET_ID = "binance.crypto_live_pool_rotation";
export const ACCOUNT_DIAGNOSIS_TARGETS = Object.freeze({
  [ACCOUNT_DIAGNOSIS_TARGET_ID]: Object.freeze({
    platform: "binance",
    recheckRepository: "QuantStrategyLab/BinancePlatform",
    recheckWorkflow: "runtime-target-lifecycle.yml",
  }),
  "longbridge.paper": Object.freeze({
    platform: "longbridge",
    recheckRepository: "QuantStrategyLab/LongBridgePlatform",
    recheckWorkflow: "runtime-target-lifecycle.yml",
  }),
  "longbridge.hk": Object.freeze({
    platform: "longbridge",
    recheckRepository: "QuantStrategyLab/LongBridgePlatform",
    recheckWorkflow: "runtime-target-lifecycle.yml",
  }),
  "longbridge.sg": Object.freeze({
    platform: "longbridge",
    recheckRepository: "QuantStrategyLab/LongBridgePlatform",
    recheckWorkflow: "runtime-target-lifecycle.yml",
  }),
  "schwab.primary": Object.freeze({
    platform: "schwab",
    recheckRepository: "QuantStrategyLab/CharlesSchwabPlatform",
    recheckWorkflow: "runtime-target-lifecycle.yml",
  }),
  "firstrade.primary": Object.freeze({
    platform: "firstrade",
    recheckRepository: "QuantStrategyLab/FirstradePlatform",
    recheckWorkflow: "runtime-target-lifecycle.yml",
  }),
});
export const ACCOUNT_DIAGNOSIS_TRIGGERS = ["incident", "manual_check"];
export const ACCOUNT_DIAGNOSIS_STATUSES = ["queued", "running", "succeeded", "failed", "unknown"];
export const ACCOUNT_DIAGNOSIS_REASON_CODES = ["diagnosis_ready", "capacity_unavailable", "codex_unavailable", "invalid_response"];
export const ACCOUNT_DIAGNOSIS_MAX_BODY_BYTES = 16 * 1024;
export const ACCOUNT_DIAGNOSIS_SUMMARY_MAX_CHARS = 600;
export const ACCOUNT_DIAGNOSIS_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_DIAGNOSIS_AUTO_ENABLED_ENV = "ACCOUNT_DIAGNOSIS_AUTO_ENABLED";
export const ACCOUNT_DIAGNOSIS_DO_ACTIONS = new Set([
  "diagnosis_create", "diagnosis_latest", "diagnosis_read", "diagnosis_mark_dispatch", "diagnosis_claim", "diagnosis_result", "diagnosis_mark_recheck", "diagnosis_native_intent", "diagnosis_native_save", "diagnosis_native_cancel",
]);
/** Stable 409/qualification reason codes for /api/account-diagnosis (P0-08). */
export const ACCOUNT_DIAGNOSIS_CONFLICT_REASON_TEXT = Object.freeze({
  account_diagnosis_config_unavailable: "账户选项配置不可用，无法绑定诊断身份。",
  account_diagnosis_account_not_found: "未找到匹配的账户选项。",
  account_diagnosis_account_not_unique: "账户选项不唯一，无法安全绑定诊断身份。",
  account_diagnosis_target_not_admitted: "该 target 未纳入账户诊断准入清单。",
  account_diagnosis_identity_conflict: "target 与账户身份冲突或不唯一。",
  account_diagnosis_lifecycle_store_unavailable: "生命周期配置存储不可用。",
  account_diagnosis_lifecycle_match_missing: "缺少匹配的生命周期观测来源。",
  account_diagnosis_lifecycle_match_ambiguous: "生命周期观测来源不唯一。",
  account_diagnosis_source_unavailable: "生命周期来源不可用（非 ready/stale）。",
  account_diagnosis_observation_missing: "缺少观测时间，无法确认诊断资格。",
  account_diagnosis_incident_requires_attention: "incident 触发需要已确认的监测关注项。",
  account_diagnosis_native_binding_conflict: "诊断原生任务身份或材料绑定冲突。",
  account_diagnosis_workflow_binding_conflict: "诊断工作流运行绑定冲突。",
  account_diagnosis_schema_incompatible: "诊断上下文 schema 不兼容。",
});
