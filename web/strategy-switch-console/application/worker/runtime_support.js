import { performanceBenchmarkResponse } from "../console_api/performance_benchmarks.js";
import { binanceDetailCommand } from "../../binance_detail_archive.js";
import { createDeskAuth } from "../desk/http.js";
import { createDeskTargetReadback } from "../desk/readback.js";
import { auditPageQuery, auditEventInPage, auditEventOrder, auditNextCursor } from "../console_api/audit_pagination.js";
import { runtimeReadbackProjection } from "../console_api/runtime_readback.js";
import { initialEnrollmentBindingsMatch, initialEnrollmentDigest } from "../console_api/initial_enrollment.js";
import { readNotificationLog } from "../console_api/notification_receipts.js";
import { KvDirectory, currentStrategiesSignature, DIRECTORY_PATH, directoryCommand, directoryList, directoryStatus, indexedKey, maintainDirectory } from "../../kv_directory.js";
import { sourceListFailure } from "../console_api/read_failures.js";
import { strategyTargetExecution, accountExecutionEvidence } from "../console_api/strategy_execution.js";
import { performanceResponse } from "../console_api/performance_routes.js";
import { consoleApiResponse } from "../console_api/routes.js";
import { runControls } from "../console_api/run_controls.js";
import { decorateQueue, decisionFields, actorAlias, pageQuery, shortId } from "../console_api/presentation.js";
import { inbox } from "../console_api/inbox.js";
import {
  DECISION_ACTIONS, DECISION_REVIEW_SCHEMA_VERSION, decisionCategoryPart, decisionCurrentEligibility,
  decisionExpiry, decisionExpiryState, decisionKind, decisionOperationId, decisionOperationReference,
  decisionOperationSha256, decisionRevision, decisionWriteCategory,
  operationIdFor, operationStatusFromApplication,
} from "../console_api/decision_contract.js";
import { RISK_TIER_POLICY_BINDINGS, riskTierBindingView, riskTierPolicyCatalog } from "../console_api/risk_tiers.js";
import { recoveryMaterialPresentation, currentReconciliationObservationPresentation } from "../console_api/reconciliation_presentation.js";
// deploy: 2026-06-30 — config driven by platform-config.json
import { initializeSecretRotation, durableRotationCommand, credentialRotationResponse } from "../../secretRotation.js";
import { RotationError } from "../../secretRotationStepUp.js";
import { CredentialMaintenanceError, initializeCredentialMaintenance, credentialMaintenanceCommand } from "../../credentialMaintenance.js";
import { V2_ASSETS, V2_PAGE_HTML, V2_BUILD_ID } from "../../v2_asset_map.js";
import { CycleHealthError, canonicalCycleJson, cycleHealthSha256, normalizeCycleHealth, normalizeCycleInstant, compareCycleInstants, cycleCoverageComplete, cycleHealthAttemptKey, cycleHealthFaultCategory, cycleHealthFaultTime } from "../../runtime_cycle_health.js";
import { RUNTIME_DAILY_TARGET, RUNTIME_DAILY_TARGETS, RUNTIME_DAILY_TIMEZONE, runtimeDailyBusinessDate, runtimeDailyTarget, runtimeDailyBoundAccountKey, runtimeDailyRunIssue, parseRuntimeDailyTargetKey } from "../../runtime_daily_contract.js";
import {
  BINANCE_FACTS_KEY, BINANCE_FACTS_MAX_BYTES, BinanceFactsError,
  normalizeBinanceFactsBinding, binanceFactsOptionMatches, assertBinanceFactsSourceBinding,
  normalizeBinanceAccountFacts, projectBinanceAccountFacts,
  binanceWalletHistoryEntry, binanceWalletHistoryStorageKey, normalizeBinanceWalletHistoryEntry,
  projectBinanceWalletHistoryFromSources,
  assertBinanceFactsHistoryBindings, BINANCE_WALLET_HISTORY_MAX_DAYS,
} from "../../binance_account_facts.js";
import { DEFAULT_STRATEGY_PROFILES } from "../../strategy_profiles_asset.js";
import { canonicalStrategyProfile, sameStrategyProfile } from "../../strategy_identity.js";
import {
  DCA_SUPPORTED_PLATFORMS,
  DEFAULT_VARIABLE_SCOPES as DEFAULT_VARIABLE_SCOPE,
  PLATFORM_REPOSITORIES,
  DOMAIN_LABELS,
  PLATFORM_MIN_RESERVED_CASH_VARIABLES,
  PLATFORM_RESERVED_CASH_RATIO_VARIABLES,
  PLATFORM_CONFIG,
  PLATFORM_META,
  DEFAULT_ACCOUNT_OPTIONS,
  FALLBACK_INCOME_LAYER_DEFAULTS,
  FALLBACK_OPTION_OVERLAY_DEFAULTS,
  DCA_PROFILE_DEFAULTS,
  RUNTIME_CATALOG_PROJECTION,
  STRATEGY_FEATURES,
  PLATFORM_REPOSITORY_ENV_KEYS,
  OBSERVABILITY_PLATFORMS,
} from "../../config.js";
import {
  DEFAULT_PLATFORM_REPOSITORIES,
  PLATFORM_REPOSITORY_ENV,
  PLATFORM_CASH_ONLY_EXECUTION_VARIABLES_MAP as PLATFORM_CASH_ONLY_EXECUTION_VARIABLES,
  OBSERVABILITY_PLATFORM_IDS,
  resolvePlatformRepositories,
  isDcaSupportedPlatform,
} from "../../platform_registry.js";
import { assertLiveSwitchAllowed, catalogVersionMetadata, isLiveSwitchAllowed } from "../../catalog.js";
import {
  BROKER_ENVIRONMENTS,
  normalizeAccountOptionsPayload as normalizeAccountOptionsSchemaPayload,
  parseAccountOptionsJson as parseAccountOptionsSchemaJson,
} from "../../account_options_schema.js";
import {
  normalizeIbkrPeriodReturn,
  publicIbkrPeriodReturn,
  ACCOUNT_FACTS_BINDINGS_KEY,
  ACCOUNT_FACTS_HISTORY_MAX_DAYS,
  ACCOUNT_FACTS_MAX_BODY_BYTES,
  ACCOUNT_FACTS_STALE_MS,
  ACCOUNT_FACTS_FUTURE_SKEW_MS,
  ACCOUNT_FACTS_SUPPORTED_PLATFORMS,
  ACCOUNT_FACTS_RETURN_UNAVAILABLE,
  IBKR_ACCOUNT_FACTS_PLATFORM,
  SCHWAB_ACCOUNT_FACTS_PLATFORM,
  FIRSTRADE_ACCOUNT_FACTS_PLATFORM,
  validFirstradeAccountId,
  accountFactsOptionMatchesBinding,
  accountFactsPlatformForHistory,
  accountFactsReadModelEnabled,
  accountFactsScopesMatchForPlatform,
  buildAccountFactsHistoryReadModel,
  buildAccountFactsReadModel,
  canonicalizeAccountFactsHistory,
  decideAccountFactsDailyUpsert,
  decideAccountFactsPut,
  historyRetentionCutoff,
  normalizeAccountFactsBindings,
  normalizeAccountFactsHistoryPayload,
  normalizeAccountFactsHistoricalPayload,
  resolveTrustedAccountFactsBinding,
  AccountFactsError,
} from "../../account_facts.js";
import {
  UX1_DRAFT_SCHEMA,
  UX1_EVIDENCE_HASH_KEYS,
  UX1_STUDY,
  Ux1InputError,
  assertUx1DraftPost,
  assertUx1IntentPost,
  assertUx1PreviewPost,
  buildUx1PreviewRequest,
  canonicalJson,
  classifyUx1Draft,
  defaultUx1Draft,
  localUx1Preview,
  normalizeUx1Draft,
  projectUx1CalculatorResult,
  ux1CustomDraft,
  ux1Fingerprint,
  ux1IntentAllowed,
  ux1IntentRecord,
  ux1ReceiptId,
} from "../../ux1_research_contract.js";
import {
  OVERVIEW_FX_PROXY_PATH,
  OVERVIEW_FX_UPSTREAM_URL,
  overviewFxResponse as overviewFxResponseImpl,
  resetOverviewFxCache,
} from "../../infrastructure/fx/overview_fx.js";
import {
  MARKET_BENCHMARK_DO_ACTIONS,
  requireMarketBenchmarkSyncToken,
  marketBenchmarkResponse,
  requireMarketBenchmarkRevisionToken,
  reviseMarketBenchmarkResponse,
  syncMarketBenchmarkResponse,
} from "../market_benchmark/http.js";
import {
  accountFactsResponse as accountFactsResponseImpl,
  accountFactsHistoryResponse as accountFactsHistoryResponseImpl,
  accountFactsIdentityDates,
} from "../account_facts/read.js";
import {
  syncAccountFactsResponse as syncAccountFactsResponseImpl,
} from "../account_facts/sync.js";
import {
  OWNER_DECISION_INTENT_PREFIX,
  OWNER_DECISION_CURRENT_PREFIX,
  OWNER_DECISION_INTENT_SCHEMA_VERSION,
  OWNER_DECISION_QUEUE_SCHEMA_VERSION,
  OWNER_DECISION_CHOICES,
  OWNER_DECISION_MAX_CANDIDATES,
} from "../approval/constants.js";
import {
  currentOwnerDecisionCandidate,
  normalizeOwnerDecisionRequest,
  ownerDecisionCandidateEvidenceSha256,
  buildOwnerDecisionIntent,
  normalizeOwnerDecisionIntent as normalizeOwnerDecisionIntentImpl,
  calculateOwnerDecisionSha256,
  readOwnerDecisionIntent as readOwnerDecisionIntentImpl,
  ownerDecisionArchiveKey,
  ownerDecisionCurrentKey,
  emptyOwnerDecisionQueue,
} from "../approval/helpers.js";
import {
  ownerDecisionQueueResponse as ownerDecisionQueueResponseImpl,
  recordOwnerDecisionResponse as recordOwnerDecisionResponseImpl,
} from "../approval/http.js";
import {
  researchPromotionApplicationResponse as researchPromotionApplicationResponseImpl,
  researchPromotionApplicationInternalResponse as researchPromotionApplicationInternalResponseImpl,
} from "../research_promotion/applications.js";
import {
  RESEARCH_PROMOTION_TICKET_PREFIX,
  RESEARCH_PROMOTION_TICKET_SCHEMA,
  RESEARCH_PROMOTION_QUEUE_SCHEMA,
  RESEARCH_PROMOTION_MAX_TICKETS,
  RESEARCH_PROMOTION_MAX_BODY_BYTES,
  RESEARCH_PROMOTION_RISK_PROFILES,
  RESEARCH_PROMOTION_EXECUTION_MODES,
  DEFAULT_RESEARCH_PROMOTION_RISK_PROFILE,
} from "../research_promotion/constants.js";
import {
  requireDedicatedResearchPromotionSyncToken,
  researchPromotionTicketKey,
  platformSupportsBrokerPaperMode,
  supportedBrokerEnvironmentsForPlatform,
  normalizeResearchPromotionRiskProfile,
  normalizePromotionConfirmation,
  validateResearchPromotionSelectedAccount as validateResearchPromotionSelectedAccountImpl,
  RESEARCH_SUMMARY_HAN,
  RESEARCH_SUMMARY_LATIN,
  RESEARCH_SUMMARY_DIGIT,
  RESEARCH_SUMMARY_LOCALE_FIELDS,
  RESEARCH_SUMMARY_NEW_KEYS,
  RESEARCH_SUMMARY_OLD_KEYS,
  RESEARCH_SUMMARY_HIDDEN,
  researchSummaryExactKeys,
  researchSummaryCodePointLength,
  researchSummarySegment,
  sameResearchSummaryMaterial,
  readBilingualResearchPromotionExplanation,
  readLegacyResearchPromotionExplanation,
  normalizeSavedResearchPromotionExplanation,
  normalizeResearchPromotionSummary,
  normalizeResearchPromotionTicket,
  attachPromotionQueueReadMetadata,
} from "../research_promotion/tickets.js";
import {
  syncResearchPromotionTicketResponse as syncResearchPromotionTicketResponseImpl,
  fetchResearchPromotionTicketResponse as fetchResearchPromotionTicketResponseImpl,
  listResearchPromotionTickets as listResearchPromotionTicketsImpl,
  researchPromotionTicketsResponse as researchPromotionTicketsResponseImpl,
} from "../research_promotion/http.js";
import {
  RESEARCH_TASK_SOURCE_PREFIX,
  RESEARCH_TASK_SOURCE_SCHEMA_VERSION,
  RESEARCH_TASK_SCHEMA_VERSION,
  RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION,
  RESEARCH_TASK_MAX_SOURCES,
  RESEARCH_TASK_MAX_BODY_BYTES,
  RESEARCH_TASK_DEFAULT_STALE_TTL_SECONDS,
  RESEARCH_TASK_OBJECTIVES,
} from "../research_task/constants.js";
import {
  requireDedicatedResearchTaskSyncToken,
  researchTaskSourceKey,
  assertExactFields,
  assertRequiredAndOptionalFields,
  normalizeResearchTaskIdentity,
  normalizeResearchTaskDigest,
  normalizeResearchTaskRevision,
  normalizeResearchTaskTimestamp,
  normalizeResearchTaskText,
  assertResearchTaskHasNoUnsafeMaterial,
  canonicalResearchTaskJson,
  sha256Hex,
  calculateResearchTaskSha256,
  normalizeResearchTask as normalizeResearchTaskImpl,
  normalizeResearchTaskRepository,
  normalizeResearchTaskBound,
  normalizeResearchTaskSourceSnapshot as normalizeResearchTaskSourceSnapshotImpl,
  emptyResearchTaskSourceSnapshot,
  emptyResearchTaskPayload,
  researchTaskStaleTtlSeconds,
} from "../research_task/helpers.js";
import {
  syncResearchTaskSourceResponse as syncResearchTaskSourceResponseImpl,
  researchTaskResponse as researchTaskResponseImpl,
  aggregateResearchTaskSources as aggregateResearchTaskSourcesImpl,
  readResearchTaskSources as readResearchTaskSourcesImpl,
} from "../research_task/http.js";

import { HttpError } from "../http_error.js";
import { buildRiskEnvelopeView, attachRiskEnvelopeView } from "../risk_envelope.js";
import {
  ACCOUNT_DIAGNOSIS_REQUEST_PATH,
  ACCOUNT_DIAGNOSIS_INTERNAL_PREFIX,
  ACCOUNT_DIAGNOSIS_TARGET_ID,
  ACCOUNT_DIAGNOSIS_TARGETS,
  ACCOUNT_DIAGNOSIS_TRIGGERS,
  ACCOUNT_DIAGNOSIS_STATUSES,
  ACCOUNT_DIAGNOSIS_REASON_CODES,
  ACCOUNT_DIAGNOSIS_MAX_BODY_BYTES,
  ACCOUNT_DIAGNOSIS_SUMMARY_MAX_CHARS,
  ACCOUNT_DIAGNOSIS_DEDUPE_WINDOW_MS,
  ACCOUNT_DIAGNOSIS_AUTO_ENABLED_ENV,
  ACCOUNT_DIAGNOSIS_DO_ACTIONS,
  ACCOUNT_DIAGNOSIS_CONFLICT_REASON_TEXT,
} from "../account_diagnosis/constants.js";
import {
  accountDiagnosisConflict,
  accountDiagnosisErrorPayload,
  accountDiagnosisTaskFromRow,
} from "../account_diagnosis/helpers.js";
import {
  requireAccountDiagnosisToken,
  accountDiagnosisRequestId,
  accountDiagnosisChecks,
  accountDiagnosisHasConfirmedAttention,
  accountDiagnosisStateFingerprint,
  accountDiagnosisTargetSpec,
  accountDiagnosisPublicTask,
  accountDiagnosisInternalTask,
  accountDiagnosisNativeContext,
  accountDiagnosisNativeRequest,
  accountDiagnosisAutoEnabled,
} from "../account_diagnosis/checks.js";
import {
  accountDiagnosisAccount as accountDiagnosisAccountImpl,
  accountDiagnosisContext as accountDiagnosisContextImpl,
  accountDiagnosisRecheckStatus as accountDiagnosisRecheckStatusImpl,
  accountDiagnosisIdentityForTarget as accountDiagnosisIdentityForTargetImpl,
} from "../account_diagnosis/context.js";
import {
  accountDiagnosisNativeIO,
  accountDiagnosisNativeStop as accountDiagnosisNativeStopImpl,
  accountDiagnosisNativeReadback as accountDiagnosisNativeReadbackImpl,
  reconcileAccountDiagnosis as reconcileAccountDiagnosisImpl,
  dispatchAccountDiagnosis as dispatchAccountDiagnosisImpl,
  dispatchAccountDiagnosisRecheck as dispatchAccountDiagnosisRecheckImpl,
  maybeAutoDispatchAccountDiagnosis as maybeAutoDispatchAccountDiagnosisImpl,
} from "../account_diagnosis/native.js";
import {
  accountDiagnosisResponse as accountDiagnosisResponseImpl,
  accountDiagnosisInternalResponse as accountDiagnosisInternalResponseImpl,
} from "../account_diagnosis/http.js";
import {
  UX1_CALCULATOR_DEADLINE_MS,
  UX1_CALCULATOR_MAX_BYTES,
  UX1_RESEARCH_REPOSITORY,
  UX1_RESEARCH_WORKFLOW_FILE,
  UX1_RESEARCH_WORKFLOW_PATH,
  UX1_JOB_BODY_MAX_BYTES,
  UX1_GITHUB_DEADLINE_MS,
  UX1_GITHUB_MAX_BYTES,
  UX1_JOB_UNKNOWN_AFTER_MS,
  UX1_PUBLIC_JOB_REASONS,
} from "../ux1/constants.js";
import {
  requireUx1Session,
  ux1DraftGet,
  ux1DraftPost,
  ux1PreviewPost,
  ux1IntentPost,
  ux1JobClaimPost,
  ux1JobResultPost,
  ux1MutateJob,
  ux1SelectSlot,
  ux1SlotPayload,
  presentUx1Preview,
  projectUx1Job,
  ux1RunMatches,
  ux1RuntimeEpoch,
  readUx1CalculatorExchange,
  readLimitedUtf8Body,
  ux1ExactKeys,
} from "../ux1/research.js";
import {
  hasRuntimeInstanceStore,
  runtimeInstanceCommand,
  runtimeInstanceAccountOptions,
  runtimeInstanceConflict,
  runtimeInstanceFields,
} from "../runtime_instances/command.js";
import {
  HK_STOP_DO_ACTIONS,
  HK_STOP_REQUEST_ID,
  HK_STOP_TARGET_ID,
} from "../hk_stop/constants.js";
import {
  hkStopDigestOrEmpty,
  hkStopExactObject,
  hkStopIdentityComplete,
  hkStopObservation,
  hkStopSourceIdentity,
  normalizeHkStopResult,
  presentHkStop,
} from "../hk_stop/helpers.js";
import {
  acceptHkStopResult as acceptHkStopResultImpl,
  loadHkStopAccount as loadHkStopAccountImpl,
} from "../hk_stop/http.js";
import { RUNTIME_CONTROL_DO_ACTIONS } from "../runtime_control/constants.js";
import {
  presentRuntimeControl,
  runtimeControlIdentityIsComplete,
  runtimeControlStopRequest as runtimeControlStopRequestImpl,
} from "../runtime_control/helpers.js";
import {
  runtimeControlSource as runtimeControlSourceImpl,
  readPlatformRuntimeControl as readPlatformRuntimeControlImpl,
  dispatchPlatformRuntimeControl as dispatchPlatformRuntimeControlImpl,
} from "../runtime_control/http.js";
import {
  CONTROL_PLANE_SNAPSHOT_KEY,
  CONTROL_PLANE_SOURCE_PREFIX,
  CONTROL_PLANE_SOURCE_SCHEMA_VERSION,
  CONTROL_PLANE_SOURCE_RETIREMENTS_KEY,
  CONTROL_PLANE_ATTENTION_STATUSES,
  CONTROL_PLANE_MAX_SOURCES,
  CONTROL_PLANE_MAX_BODY_BYTES,
  CONTROL_PLANE_DEFAULT_STALE_TTL_SECONDS,
  CONTROL_PLANE_RESEARCH_SCHEDULE_UTC_DAYS,
  CONTROL_PLANE_RESEARCH_SCHEDULE_UTC_HOUR,
  CONTROL_PLANE_RESEARCH_DELIVERY_GRACE_MS,
  CONTROL_PLANE_CANDIDATE_KINDS,
  CONTROL_PLANE_STAGES,
  CONTROL_PLANE_AUTOMATION_STATES,
  FORWARD_OBSERVATION_RESEARCH_STAGES,
} from "../control_plane/constants.js";
import {
  controlPlaneDecisionExpiryAt,
  isOwnerDecisionCandidate,
  normalizeControlPlaneSourceRetirements,
  controlPlaneSourceKey,
  controlPlaneSnapshotFreshness,
  controlPlaneResearchSnapshotFreshness,
  nextControlPlaneResearchScheduleAfter,
  mergeControlPlaneFreshness,
  earliestControlPlaneTimestamp,
  requireDedicatedControlPlaneSyncToken,
  requireControlPlaneSourceSyncToken,
  normalizeControlPlaneSnapshot,
  normalizeControlPlaneSourceSnapshot,
  emptyControlPlaneSourceSnapshot,
  normalizeControlPlaneCandidates,
  normalizeForwardObservation,
  normalizeForwardObservationDate,
  normalizeControlPlaneIdentifier,
  normalizeControlPlaneLifecycle,
  normalizeControlPlaneEvidence,
  normalizeControlPlaneRecommendation,
  normalizeControlPlaneSummary,
  normalizeControlPlaneAttention,
  normalizeControlPlanePolicy,
  emptyControlPlanePayload,
  controlPlaneStaleTtlSeconds,
} from "../control_plane/helpers.js";
import {
  syncControlPlaneResponse as syncControlPlaneResponseImpl,
  syncControlPlaneSourceResponse as syncControlPlaneSourceResponseImpl,
  controlPlaneResponse as controlPlaneResponseImpl,
  currentControlPlanePayload as currentControlPlanePayloadImpl,
  aggregateControlPlaneSources as aggregateControlPlaneSourcesImpl,
  readControlPlaneSources as readControlPlaneSourcesImpl,
} from "../control_plane/http.js";
import {
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_PATH,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_AUDIENCE,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_REPOSITORY,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_REF,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_WORKFLOW_REF,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_JWKS_URL,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_TOKEN_BYTES,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_JWKS_BYTES,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_TIMEOUT_MS,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_TIMEOUT_MS,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_MAX_BODY_BYTES,
  ACCOUNT_SETTINGS_DO_ACTIONS,
  ACCOUNT_SETTING_OVERRIDE_FIELDS,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY,
} from "../account_settings/constants.js";
import {
  accountSettingsIdentity,
  accountSettingsIdentityIsComplete,
  accountSettingsProfileName,
  accountSettingPositiveAmount,
  accountSettingRatio,
  applyAccountSettingOverrides,
  accountSettingsOperations,
  accountSettingsPayload,
  accountSettingsAuditChanges,
  profileDefinesOptionOverlay,
  optionOverlayDraftAllowed,
  dcaDraftSupported as dcaDraftSupportedImpl,
  accountDraftStrategyChoices as accountDraftStrategyChoicesImpl,
  assertAccountDraftPatch as assertAccountDraftPatchImpl,
  accountSettingsProfileApplicationIsFixedHk,
  decodeProfileApplicationJwtPart,
} from "../account_settings/helpers.js";
import {
  readGitHubProfileApplicationJwks,
  verifyGitHubProfileApplicationToken,
  readGitHubProfileApplicationRequestBody,
} from "../account_settings/oidc.js";
import {
  loadAccountDraftProfiles as loadAccountDraftProfilesImpl,
  presentAccountSettings as presentAccountSettingsImpl,
  accountSettingsResponse as accountSettingsResponseImpl,
  saveCombinedAccountDraft as saveCombinedAccountDraftImpl,
  saveAccountSettings as saveAccountSettingsImpl,
  riskProfileBindingsResponse as riskProfileBindingsResponseImpl,
  saveRiskProfileBindings as saveRiskProfileBindingsImpl,
  approveAccountSettingsProfileApplication as approveAccountSettingsProfileApplicationImpl,
  claimAccountSettingsProfileApplicationFromGitHub as claimAccountSettingsProfileApplicationFromGitHubImpl,
} from "../account_settings/http.js";
import {
  RECONCILIATION_RECOVERY_SOURCE_PREFIX,
  RECONCILIATION_RECOVERY_CONFIRMATION_PREFIX,
  RECONCILIATION_RECOVERY_CURRENT_PREFIX,
  RECONCILIATION_RECOVERY_SOURCE_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_CONFIRMATION_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_CONTROLLER_READ_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_MAX_SOURCES,
  RECONCILIATION_RECOVERY_MAX_BODY_BYTES,
  RECONCILIATION_RECOVERY_DEFAULT_STALE_TTL_SECONDS,
  RECONCILIATION_RECOVERY_MAX_SAMPLE_WINDOW_MS,
  RECONCILIATION_RECOVERY_PLATFORMS,
  RECONCILIATION_RECOVERY_ENVIRONMENTS,
  RECONCILIATION_RECOVERY_STATES,
  RECONCILIATION_RECOVERY_READINESS,
  RECONCILIATION_RECOVERY_DUAL_REVIEW_OUTCOMES,
  RECONCILIATION_RECOVERY_MAX_REQUESTS,
} from "../reconciliation_recovery/constants.js";
import {
  requireDedicatedReconciliationRecoverySyncToken,
  requireDedicatedReconciliationRecoveryControllerToken,
  reconciliationRecoverySourceKey,
  reconciliationRecoveryConfirmationArchiveKey,
  reconciliationRecoveryConfirmationCurrentKey,
  reconciliationRecoveryStaleTtlSeconds,
  reconciliationRecoveryEvidenceFreshness,
  reconciliationRecoveryDecisionExpiryAt,
  currentReconciliationRecoveryRequest,
  normalizeReconciliationRecoveryConfirmationRequest,
  calculateReconciliationRecoveryConfirmationSha256,
  buildReconciliationRecoveryConfirmation,
  normalizeReconciliationRecoveryConfirmation,
  normalizeReconciliationRecoverySourceSnapshot,
  normalizeReconciliationRecoveryRequest,
  emptyReconciliationRecoverySourceSnapshot,
  emptyReconciliationRecoveryPayload,
} from "../reconciliation_recovery/helpers.js";
import {
  syncReconciliationRecoverySourceResponse as syncReconciliationRecoverySourceResponseImpl,
  reconciliationRecoveryResponse as reconciliationRecoveryResponseImpl,
  reconciliationRecoveryControllerReadResponse as reconciliationRecoveryControllerReadResponseImpl,
  readReconciliationRecoveryConfirmation as readReconciliationRecoveryConfirmationImpl,
  recordReconciliationRecoveryConfirmationResponse as recordReconciliationRecoveryConfirmationResponseImpl,
  aggregateReconciliationRecoverySources as aggregateReconciliationRecoverySourcesImpl,
  readReconciliationRecoverySources as readReconciliationRecoverySourcesImpl,
} from "../reconciliation_recovery/http.js";
import { startLogin, finishLogin } from "../auth/login.js";
import { readSession, makeSession } from "../auth/session.js";
import {
  AUTH_CONFIG_KEY,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "../auth/constants.js";
import {
  authorizedOrgLogins,
  hasOrgMatch,
  isAdminLogin,
  isAdminPrincipal,
  isAllowedPrincipal,
  loadAuthConfig,
  normalizeAuthConfigPayload,
} from "../auth/principals.js";
import {
  cleanGithubLogin,
  cleanGithubOrg,
  normalizeLoginList,
  normalizeOrgList,
  parseLoginList,
  parseOrgList,
  uniqueStrings,
} from "../auth/identity_lists.js";
import { requireEnv } from "../auth/require_env.js";
import {
  base64UrlDecode,
  base64UrlEncodeBytes,
  base64UrlEncodeJson,
  clearCookie,
  clearOAuthCookie,
  cookie,
  parseCookies,
  randomToken,
} from "../auth/cookies.js";

export {
  AUTH_CONFIG_KEY,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  authorizedOrgLogins,
  hasOrgMatch,
  isAdminLogin,
  isAdminPrincipal,
  isAllowedPrincipal,
  loadAuthConfig,
  normalizeAuthConfigPayload,
  cleanGithubLogin,
  cleanGithubOrg,
  normalizeLoginList,
  normalizeOrgList,
  parseLoginList,
  parseOrgList,
  uniqueStrings,
  requireEnv,
  base64UrlDecode,
  base64UrlEncodeBytes,
  base64UrlEncodeJson,
  clearCookie,
  clearOAuthCookie,
  cookie,
  parseCookies,
  randomToken,
  HK_STOP_DO_ACTIONS,
  HK_STOP_REQUEST_ID,
  HK_STOP_TARGET_ID,
  hkStopDigestOrEmpty,
  hkStopExactObject,
  hkStopIdentityComplete,
  hkStopObservation,
  hkStopSourceIdentity,
  normalizeHkStopResult,
  presentHkStop,
  MARKET_BENCHMARK_DO_ACTIONS,
  requireMarketBenchmarkSyncToken,
  marketBenchmarkResponse,
  requireMarketBenchmarkRevisionToken,
  reviseMarketBenchmarkResponse,
  syncMarketBenchmarkResponse,
  RUNTIME_CONTROL_DO_ACTIONS,
  presentRuntimeControl,
  runtimeControlIdentityIsComplete,
  RESEARCH_PROMOTION_TICKET_PREFIX,
  RESEARCH_PROMOTION_TICKET_SCHEMA,
  RESEARCH_PROMOTION_QUEUE_SCHEMA,
  RESEARCH_PROMOTION_MAX_TICKETS,
  RESEARCH_PROMOTION_MAX_BODY_BYTES,
  RESEARCH_PROMOTION_EXECUTION_MODES,
  DEFAULT_RESEARCH_PROMOTION_RISK_PROFILE,
  requireDedicatedResearchPromotionSyncToken,
  researchPromotionTicketKey,
  platformSupportsBrokerPaperMode,
  supportedBrokerEnvironmentsForPlatform,
  normalizeResearchPromotionRiskProfile,
  normalizePromotionConfirmation,
  RESEARCH_SUMMARY_HAN,
  RESEARCH_SUMMARY_LATIN,
  RESEARCH_SUMMARY_DIGIT,
  RESEARCH_SUMMARY_LOCALE_FIELDS,
  RESEARCH_SUMMARY_NEW_KEYS,
  RESEARCH_SUMMARY_OLD_KEYS,
  RESEARCH_SUMMARY_HIDDEN,
  researchSummaryExactKeys,
  researchSummaryCodePointLength,
  researchSummarySegment,
  sameResearchSummaryMaterial,
  readBilingualResearchPromotionExplanation,
  readLegacyResearchPromotionExplanation,
  normalizeSavedResearchPromotionExplanation,
  normalizeResearchPromotionSummary,
  normalizeResearchPromotionTicket,
  attachPromotionQueueReadMetadata,
  RESEARCH_TASK_SOURCE_PREFIX,
  RESEARCH_TASK_SOURCE_SCHEMA_VERSION,
  RESEARCH_TASK_SCHEMA_VERSION,
  RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION,
  RESEARCH_TASK_MAX_SOURCES,
  RESEARCH_TASK_MAX_BODY_BYTES,
  RESEARCH_TASK_DEFAULT_STALE_TTL_SECONDS,
  RESEARCH_TASK_OBJECTIVES,
  requireDedicatedResearchTaskSyncToken,
  researchTaskSourceKey,
  assertExactFields,
  assertRequiredAndOptionalFields,
  normalizeResearchTaskIdentity,
  normalizeResearchTaskDigest,
  normalizeResearchTaskRevision,
  normalizeResearchTaskTimestamp,
  normalizeResearchTaskText,
  assertResearchTaskHasNoUnsafeMaterial,
  canonicalResearchTaskJson,
  sha256Hex,
  calculateResearchTaskSha256,
  normalizeResearchTaskRepository,
  normalizeResearchTaskBound,
  emptyResearchTaskSourceSnapshot,
  emptyResearchTaskPayload,
  researchTaskStaleTtlSeconds,
};
export {
  ACCOUNT_DIAGNOSIS_REQUEST_PATH,
  ACCOUNT_DIAGNOSIS_INTERNAL_PREFIX,
  ACCOUNT_DIAGNOSIS_TARGET_ID,
  ACCOUNT_DIAGNOSIS_TARGETS,
  ACCOUNT_DIAGNOSIS_TRIGGERS,
  ACCOUNT_DIAGNOSIS_STATUSES,
  ACCOUNT_DIAGNOSIS_REASON_CODES,
  ACCOUNT_DIAGNOSIS_MAX_BODY_BYTES,
  ACCOUNT_DIAGNOSIS_SUMMARY_MAX_CHARS,
  ACCOUNT_DIAGNOSIS_DEDUPE_WINDOW_MS,
  ACCOUNT_DIAGNOSIS_AUTO_ENABLED_ENV,
  ACCOUNT_DIAGNOSIS_DO_ACTIONS,
  ACCOUNT_DIAGNOSIS_CONFLICT_REASON_TEXT,
  accountDiagnosisConflict,
  accountDiagnosisErrorPayload,
  accountDiagnosisTaskFromRow,
  requireAccountDiagnosisToken,
  accountDiagnosisRequestId,
  accountDiagnosisChecks,
  accountDiagnosisHasConfirmedAttention,
  accountDiagnosisStateFingerprint,
  accountDiagnosisTargetSpec,
  accountDiagnosisPublicTask,
  accountDiagnosisInternalTask,
  accountDiagnosisNativeContext,
  accountDiagnosisNativeRequest,
  accountDiagnosisAutoEnabled,
  accountDiagnosisNativeIO,
};

export {
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_PATH,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_AUDIENCE,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_REPOSITORY,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_REF,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_WORKFLOW_REF,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_JWKS_URL,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_TOKEN_BYTES,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_JWKS_BYTES,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_TIMEOUT_MS,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_TIMEOUT_MS,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_MAX_BODY_BYTES,
  ACCOUNT_SETTINGS_DO_ACTIONS,
  ACCOUNT_SETTING_OVERRIDE_FIELDS,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY,
  accountSettingsIdentity,
  accountSettingsIdentityIsComplete,
  accountSettingsProfileName,
  accountSettingPositiveAmount,
  accountSettingRatio,
  applyAccountSettingOverrides,
  accountSettingsOperations,
  accountSettingsPayload,
  accountSettingsAuditChanges,
  profileDefinesOptionOverlay,
  optionOverlayDraftAllowed,
  accountSettingsProfileApplicationIsFixedHk,
  decodeProfileApplicationJwtPart,
  readGitHubProfileApplicationJwks,
  verifyGitHubProfileApplicationToken,
  readGitHubProfileApplicationRequestBody,
};

export const CYCLE_HEALTH_HISTORY_PAGE_SIZE = 50;
export const CYCLE_HEALTH_SUMMARY_SCHEMA_VERSION = "qsl_runtime_cycle_health_state_summary.v1";
export const DEFAULT_REPOSITORY = "QuantStrategyLab/QuantRuntimeSettings";
export const DEFAULT_WORKFLOW = "manual-strategy-switch.yml";
export const ACCOUNT_OPTIONS_KEY = "account_options";
export const STRATEGY_PROFILES_KEY = "strategy_profiles";
// Risk preferences are a separate, low-frequency owner-intent record.  They
// must never be merged into a strategy switch input, runtime target, or any
// execution credential/policy path.
export const RISK_PROFILE_BINDINGS_KEY = "risk_profile_bindings";
export const RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION = "qsl.risk_profile_binding_registry.v1";
export const RISK_PROFILE_BINDING_SCHEMA_VERSION = "qsl.risk_profile_binding.v1";
export const RISK_PROFILE_SELECTION_SCHEMA_VERSION = "qsl.risk_profile_selection.v1";
const RISK_PROFILE_IDS = {
  CAPITAL_PRESERVATION: "capital_preservation_v1",
  BALANCED_COMPOUNDING: "balanced_compounding_v1",
  GROWTH_COMPOUNDING: "growth_compounding_v1",
};
export const RISK_PROFILE_PREFERENCES = Object.keys(RISK_PROFILE_IDS);
export const DECISION_ACTION_SCHEMA_VERSION = "qsl.decision_action_result.v1";
export const OPERATION_SCHEMA_VERSION = "qsl.operation.v1";
export const AUDIT_EVENTS_SCHEMA_VERSION = "qsl.audit_events.v1";
export const DECISION_ACTION_MAX_BODY_BYTES = 8 * 1024;
export const AUDIT_EVENTS_MAX_ROWS = 101;
export const AUDIT_LOG_KEY = "audit_log";
export const AUDIT_LOG_LIMIT = 50;
export const CURRENT_STRATEGIES_TIMEOUT_MS = 25000;
export const CURRENT_STRATEGIES_CACHE_KEY = "current_strategies_cache";
// The keep-alive bump stays below the KV fresh window so one missed cron tick
// (the schedule is */5) still leaves the entry inside it; a cold isolate then
// never has to fan out to GitHub just because the stamp aged out.
export const CURRENT_STRATEGIES_MEMO_TTL_MS = 60_000;      // 60 sec — a warm isolate re-checks GitHub after this
export const CURRENT_STRATEGIES_KV_FRESH_MS = 1_800_000;   // 30 min — a cold isolate serves the KV entry without any GitHub fan-out
export const CURRENT_STRATEGIES_STALE_TTL_MS = 3_600_000;  // 60 min — return stale plus background refresh before blocking on GitHub
export const CURRENT_STRATEGIES_KV_BUMP_MS = 900_000;      // 15 min — ceiling for ts-only rewrites when the content did not change
export const GITHUB_API_TIMEOUT_MS = 8000;
export const GITHUB_LOGIN_REQUEST_TIMEOUT_MS = 20000;
export const STRATEGY_HEALTH_SNAPSHOT_KEY = "strategy_health_snapshot";
export const STRATEGY_HEALTH_MAX_BODY_BYTES = 256 * 1024;
export const STRATEGY_HEALTH_DEFAULT_STALE_TTL_SECONDS = 2 * 60 * 60;
export const STRATEGY_HEALTH_STATUSES = ["healthy", "watch", "review", "critical"];
// Derived from the generated platform config so a domain is declared once.
const SUPPORTED_STRATEGY_DOMAINS = Object.freeze([
  ...new Set(Object.values(PLATFORM_CONFIG).flatMap((platform) => platform.supported_domains || [])),
]);
export const STRATEGY_HEALTH_DOMAINS = SUPPORTED_STRATEGY_DOMAINS;
export const STRATEGY_HEALTH_DATA_STATUSES = ["ready", "unavailable", "stale"];
export {
  CONTROL_PLANE_SNAPSHOT_KEY,
  CONTROL_PLANE_SOURCE_PREFIX,
  CONTROL_PLANE_SOURCE_SCHEMA_VERSION,
  CONTROL_PLANE_SOURCE_RETIREMENTS_KEY,
  CONTROL_PLANE_ATTENTION_STATUSES,
  CONTROL_PLANE_MAX_SOURCES,
  CONTROL_PLANE_MAX_BODY_BYTES,
  CONTROL_PLANE_DEFAULT_STALE_TTL_SECONDS,
  CONTROL_PLANE_RESEARCH_SCHEDULE_UTC_DAYS,
  CONTROL_PLANE_RESEARCH_SCHEDULE_UTC_HOUR,
  CONTROL_PLANE_RESEARCH_DELIVERY_GRACE_MS,
  CONTROL_PLANE_CANDIDATE_KINDS,
  CONTROL_PLANE_STAGES,
  CONTROL_PLANE_AUTOMATION_STATES,
  FORWARD_OBSERVATION_RESEARCH_STAGES,
};

// M1 adaptive selections are a separate read-only projection. They are not
// lifecycle evidence, an account instruction, or an execution permission.
export const ADAPTIVE_SELECTION_SOURCE_PREFIX = "adaptive_selection_source:";
export const ADAPTIVE_SELECTION_SOURCE_SCHEMA_VERSION = "qsl.adaptive_selection_source_snapshot.v1";
export const ADAPTIVE_SELECTION_DASHBOARD_SCHEMA_VERSION = "qsl.adaptive_selection_dashboard.v1";
export const ADAPTIVE_SELECTION_DECISION_SCHEMA_VERSION = "qsl.selection_decision.v1";
export const ADAPTIVE_SELECTION_MAX_SOURCES = 100;
export const ADAPTIVE_SELECTION_MAX_BODY_BYTES = 256 * 1024;
export const ADAPTIVE_SELECTION_DEFAULT_STALE_TTL_SECONDS = 36 * 60 * 60;
export const ADAPTIVE_SELECTION_AUTHORITY = "shadow_only";
// M0 research arrives through a separate, signed-at-transport-boundary
// snapshot.  It is deliberately neither an M1 selection input nor a research
// task: this Worker only retains a closed, no-order ledger for authenticated
// readers.  No strategy/platform/runtime/broker helper may consume it here.
export const M0_RESEARCH_TRANSPORT_SCHEMA_VERSION = "qsl_m0_research_publisher_envelope.v1";
export const M0_RESEARCH_LEDGER_SCHEMA_VERSION = "qsl_m0_research_ledger.v1";
export const M0_RESEARCH_DASHBOARD_SCHEMA_VERSION = "qsl_m0_research_dashboard.v1";
export const M0_RESEARCH_STORAGE_SCHEMA_VERSION = "qsl_m0_research_ledger_storage.v1";
export const M0_RESEARCH_CURRENT_KEY = "m0_research_ledger_current";
export const M0_RESEARCH_ARCHIVE_PREFIX = "m0_research_ledger_archive:";
export const M0_RESEARCH_MAX_BODY_BYTES = 256 * 1024;
export const M0_RESEARCH_RETENTION_SECONDS = 14 * 24 * 60 * 60;
export const M0_RESEARCH_ALLOWED_SOURCE_REPOSITORY = "QuantStrategyLab/QuantAdvisorResearch";
export const M0_RESEARCH_ALLOWED_PRODUCER_REPOSITORY = "QuantStrategyLab/QuantRuntimeSettings";
export const M0_RESEARCH_SUBJECT_KINDS = ["asset_idea", "theme_context", "strategy_hypothesis", "risk_context"];
export const M0_RESEARCH_HORIZONS = ["short", "medium", "long", "not_applicable"];
export const M0_RESEARCH_STATES = ["candidate", "source_verification_required", "deferred", "context_only"];
export const M0_RESEARCH_CONFIDENCE = ["high", "medium", "low", "mixed", "no_event", "unknown"];
export const M0_RESEARCH_STYLES = ["event_driven", "long_horizon_growth", "value_quality", "macro_context", "mixed_research"];
const M0_RESEARCH_SUMMARY_FIELDS = [
  "subject_count",
  "observation_count",
  "fresh_observation_count",
  "stale_observation_count",
  "unknown_observation_count",
  "horizon_conflict_count",
  "historical_stale_horizon_drift_count",
];
// A console decision is intentionally an auditable owner intent, not an
// execution permit.  It remains separate from workflow dispatch credentials,
// broker credentials, and any future deterministic execution gateway.
export {
  OWNER_DECISION_INTENT_PREFIX,
  OWNER_DECISION_CURRENT_PREFIX,
  OWNER_DECISION_INTENT_SCHEMA_VERSION,
  OWNER_DECISION_QUEUE_SCHEMA_VERSION,
  OWNER_DECISION_CHOICES,
  OWNER_DECISION_MAX_CANDIDATES,
};
// Reconciliation recovery has a different authority boundary from P6
// strategy promotion.  It can only describe an already-authorised legacy
// target that is currently RECONCILE_ONLY; it can never create a new strategy
// release, order, broker credential, or runtime mutation from this Worker.
export {
  RECONCILIATION_RECOVERY_SOURCE_PREFIX,
  RECONCILIATION_RECOVERY_CONFIRMATION_PREFIX,
  RECONCILIATION_RECOVERY_CURRENT_PREFIX,
  RECONCILIATION_RECOVERY_SOURCE_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_CONFIRMATION_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_CONTROLLER_READ_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_MAX_SOURCES,
  RECONCILIATION_RECOVERY_MAX_BODY_BYTES,
  RECONCILIATION_RECOVERY_DEFAULT_STALE_TTL_SECONDS,
  RECONCILIATION_RECOVERY_MAX_SAMPLE_WINDOW_MS,
  RECONCILIATION_RECOVERY_PLATFORMS,
  RECONCILIATION_RECOVERY_ENVIRONMENTS,
  RECONCILIATION_RECOVERY_STATES,
  RECONCILIATION_RECOVERY_READINESS,
  RECONCILIATION_RECOVERY_DUAL_REVIEW_OUTCOMES,
  RECONCILIATION_RECOVERY_MAX_REQUESTS,
};
// Private Binance holdings use one isolated KV record. They are never folded
// into public health, recovery, control-plane, or admin aggregates.
export const BINANCE_PRIVATE_SCOPE_KEY = "private_binance_scope_report";
export const BINANCE_PRIVATE_SCOPE_MAX_BODY_BYTES = 256 * 1024;
export const BINANCE_PRIVATE_SCOPE_MAX_ASSETS = 5000;
export const BINANCE_PRIVATE_SCOPE_WRITE_TTL_SECONDS = 24 * 60 * 60;
export const BINANCE_PRIVATE_SCOPE_INGEST_MAX_AGE_MS = 10 * 60 * 1000;
export const BINANCE_PRIVATE_SCOPE_FUTURE_SKEW_MS = 60 * 1000;
export const BINANCE_PRIVATE_SCOPE_READ_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Execution evidence is deliberately a separate, read-only projection.  A
// candidate's research lifecycle is portable; a broker/data/execution result
// is only meaningful for the exact target platform and lane that produced it.
// Keeping this contract separate prevents a P1/P3 source from accidentally
// turning into an execution or P6 authority source.
export const EXECUTION_EVIDENCE_SOURCE_PREFIX = "execution_evidence_source:";
export const RUNTIME_DAILY_KEY_PREFIX = "runtime_daily:";
export const RUNTIME_DAILY_MAX_BODY_BYTES = 64 * 1024;
export const RUNTIME_DAILY_MAX_RUNS = 20;
export const RUNTIME_DAILY_MAX_LIST = 20;
// History coverage lists the already-stored business dates for one target. It
// never reads record bodies and stays bounded so a large backlog cannot stall
// the read model; hitting the page cap only marks the listing as truncated.
export const RUNTIME_DAILY_HISTORY_PAGE = 100;
export const RUNTIME_DAILY_HISTORY_MAX_PAGES = 10;
export const RUNTIME_DAILY_STALE_MS = 36 * 60 * 60 * 1000;
export const RUNTIME_DAILY_FUTURE_SKEW_MS = 5 * 60 * 1000;
const RUNTIME_DAILY_STATUSES = [
  "no_submission", "no_signal", "no_rebalance", "submitted", "broker_acknowledged", "partially_filled", "filled",
  "reconciliation_required", "unknown", "failed", "blocked", "dry_run", "shadow", "validation",
  "not_due", "market_closed", "outside_window", "within_grace", "missing_report", "read_incomplete", "insufficient", "conflict",
];
export const RUNTIME_DAILY_SCHEDULE_ONLY = ["not_due", "market_closed", "outside_window", "within_grace"];
const RUNTIME_DAILY_ANOMALY_STATUSES = [
  "reconciliation_required", "unknown", "failed", "blocked", "conflict", "missing_report", "read_incomplete", "insufficient",
  "dry_run", "shadow", "validation",
];
const RUNTIME_DAILY_ACTIVITIES = [
  "no_submission", "no_signal", "no_rebalance", "submitted", "broker_acknowledged", "partially_filled", "filled",
  "reconciliation_required", "unknown", "failed", "blocked", "previewed", "insufficient",
];
export const RUNTIME_DAILY_LANES = ["paper", "live", "dry_run", "shadow", "validation", "insufficient"];
export const RUNTIME_DAILY_SCHEDULE_STATES = ["unevaluable", "not_due", "market_closed", "within_grace", "due", "outside_window"];
export const RUNTIME_DAILY_KINDS = ["run", "schedule", "incomplete"];
export const EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION = "qsl_execution_evidence_source_snapshot.v1";
export const EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION = "qsl_execution_evidence_dashboard.v1";
export const EXECUTION_EVIDENCE_MAX_SOURCES = 100;
export const EXECUTION_EVIDENCE_MAX_BODY_BYTES = 256 * 1024;
export const EXECUTION_EVIDENCE_DEFAULT_STALE_TTL_SECONDS = 36 * 60 * 60;
export const EXECUTION_EVIDENCE_PLATFORMS = OBSERVABILITY_PLATFORM_IDS;
export const EXECUTION_EVIDENCE_ENVIRONMENTS = ["shadow", "paper", "live"];
export const EXECUTION_EVIDENCE_CAPABILITIES = ["available", "unavailable", "unknown"];
export const EXECUTION_EVIDENCE_STATUSES = ["verified", "pending", "unavailable", "not_applicable"];
const EXECUTION_RECEIPT_OUTCOMES = [
  "not_due", "no_action", "no_signal", "no_rebalance", "risk_blocked", "submitted", "broker_acknowledged", "partially_filled", "filled", "reconciliation_required", "failed",
];
const EXECUTION_RECEIPT_CONFIRMATIONS = [
  "not_applicable", "not_observed", "acknowledged", "partially_filled", "filled", "reconciliation_required",
];
const EXECUTION_EVIDENCE_RECOMMENDATIONS = [
  "continue_autonomous_shadow", "run_autonomous_paper", "owner_limited_live_canary_decision", "parked",
];
const EXECUTION_EVIDENCE_REASON_CODES = [
  "none", "target_execution_evidence_missing", "paper_not_supported", "paper_execution_evidence_needed",
  "policy_not_active", "source_stale", "manual_live_decision_required", "target_execution_receipt_observed",
  "target_execution_reconciliation_required", "target_execution_receipt_failed",
];
// Runtime target lifecycle is intentionally separate from execution evidence:
// it records whether a target is enabled and whether its no-order monitors are
// healthy. A disabled target is not a missing broker or a paper/live result.
export const RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX = "runtime_target_lifecycle_source:";
export const RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION = "qsl_runtime_target_lifecycle_source_snapshot.v1";
export const RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION = "qsl_runtime_target_lifecycle_dashboard.v1";
export const RUNTIME_TARGET_LIFECYCLE_MAX_SOURCES = 100;
export const RUNTIME_TARGET_LIFECYCLE_MAX_BODY_BYTES = 256 * 1024;
export const RUNTIME_TARGET_LIFECYCLE_CONFIGURED_STATES = ["enabled", "disabled"];
export const RUNTIME_TARGET_LIFECYCLE_EXECUTION_MODES = ["dry_run", "paper", "live"];
export const RUNTIME_TARGET_LIFECYCLE_CHECK_STATUSES = ["pass", "attention", "not_due", "not_applicable", "unavailable"];
export const RUNTIME_TARGET_LIFECYCLE_DISPOSITIONS = ["continue_enabled_monitoring", "continue_disabled_validation", "parked"];
export const RUNTIME_TARGET_LIFECYCLE_EXECUTION_OBSERVATIONS = ["not_due", "monitoring_only", "not_applicable", "attention", "unavailable"];
const RUNTIME_TARGET_LIFECYCLE_REASON_CODES = [
  "none", "target_intentionally_disabled", "runtime_guard_attention", "execution_heartbeat_attention", "monitoring_unavailable",
];
export const HUMAN_DECISION_DO_ACTIONS = new Set([
  "owner_sync_materials", "recovery_sync_materials", "promotion_sync_materials",
  "owner_decide", "recovery_decide", "promotion_decide",
  "owner_read", "recovery_read", "promotion_read",
]);
export const ACCOUNT_FACTS_DO_ACTIONS = new Set([
  "account_external_flow_put",
  "account_executions_put", "account_executions_read",
  "account_period_return_put", "account_period_return_read", "account_daily_native_return_research_read",
  "account_facts_put", "account_facts_read", "account_facts_list", "account_facts_history_read", "account_facts_history_put",
  "binance_wallet_history_put", "binance_wallet_history_read",
  "binance_detail_put", "binance_detail_read",
]);
export const V7_PAPER_PREVIEW_PROFILE = "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve";
export const V7_PAPER_APPLICATION_WORKFLOW_REPOSITORY = "QuantStrategyLab/LongBridgePlatform";
export const V7_PAPER_APPLICATION_WORKFLOW = "apply-paper-candidate.yml";
export const V7_PAPER_APPLICATION_UES_REVISION = "b83ef4b3ae67c47d132ddd660ba3ccc60d474c85";
// Reviewed LongBridge application merge SHA for the paused validation slice.
// This remains a server constant and is never caller input or an enablement.
export const V7_PAPER_APPLICATION_SOURCE_COMMIT = "dcdcb579001e0be5579810121fc7894206e06445";
export const V7_PAPER_APPLICATION_TICKET_RE = /^rpt_[0-9a-f]{64}$/;
export const V7_PAPER_APPLICATION_ACCOUNT_KEY = "paper";
export const V7_PAPER_APPLICATION_ACCOUNT_SCOPE = "PAPER";
export const V7_PAPER_APPLICATION_SERVICE = "longbridge-quant-paper-service";
export const V7_PAPER_APPLICATION_MAX_BODY_BYTES = 16 * 1024;
export const V7_PAPER_APPLICATION_STATUSES = ["approved", "claimed", "applied_paused", "rejected", "uncertain"];
export const V7_PAPER_APPLICATION_DISPATCH_STATES = ["pending", "sent", "unknown"];
export const V7_PAPER_APPLICATION_REASON_CODES = ["", "readback_mismatch", "workflow_rejected", "workflow_uncertain", "dispatch_unverified", "account_changed", "qualification_failed"];
export const V7_PAPER_APPLICATION_DO_ACTIONS = new Set([
  "application_create", "application_latest", "application_read", "application_mark_dispatch", "application_claim", "application_result",
]);
// The workflow has an explicit fail-closed guard until immutable activation
// and durable single-use consumption are connected. Keep the console from
// dispatching a workflow that cannot apply the requested target.
export const SWITCH_ACTIVATION_CONNECTED = false;





export const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_CONFIG);

export function validateAccountOptionsSchemaOrThrow(payload, fieldName = "account_options") {
  return normalizeAccountOptionsSchemaPayload(payload, fieldName);
}


const LIVE_CONTINUITY_STATES = [
  "NONE",
  "ACTIVE_LKG",
  "ACTIVE_REDUCED",
  "RECONCILE_ONLY",
  "RISK_REDUCTION_ONLY",
  "PAUSED",
  "ROLLBACK_LKG",
];
export const LEGACY_CASH_ONLY_EXECUTION_VARIABLE = "CASH_ONLY_EXECUTION";
export const CASH_ONLY_EXECUTION_MODES = ["current", "enabled", "disabled"];
export const INCOME_LAYER_ENABLED_VARIABLE = "INCOME_LAYER_ENABLED";
export const INCOME_LAYER_START_USD_VARIABLE = "INCOME_LAYER_START_USD";
export const INCOME_LAYER_MAX_RATIO_VARIABLE = "INCOME_LAYER_MAX_RATIO";
export const OPTION_OVERLAY_ENABLED_VARIABLE = "OPTION_OVERLAY_ENABLED";
export const RUNTIME_TARGET_ENABLED_VARIABLE = "RUNTIME_TARGET_ENABLED";
export const DCA_MODE_VARIABLE = "DCA_MODE";
export const DCA_BASE_INVESTMENT_VARIABLE = "DCA_BASE_INVESTMENT_USD";
export const IBIT_ZSCORE_EXIT_MODE_VARIABLE = "IBIT_ZSCORE_EXIT_MODE";
export const IBIT_ZSCORE_EXIT_ENABLED_VARIABLE = "IBIT_ZSCORE_EXIT_ENABLED";
export const IBIT_ZSCORE_EXIT_PARKING_SYMBOL_VARIABLE = "IBIT_ZSCORE_EXIT_PARKING_SYMBOL";
const LEGACY_INCOME_LAYER_CONTROL_FIELDS = [
  "income_threshold_usd",
  "qqqi_income_ratio",
  "income_layer_qqqi_weight",
  "income_layer_spyi_weight",
];
const LEGACY_INCOME_LAYER_VARIABLES = [
  "INCOME_THRESHOLD_USD",
  "QQQI_INCOME_RATIO",
  "INCOME_LAYER_QQQI_WEIGHT",
  "INCOME_LAYER_SPYI_WEIGHT",
];
const OPTION_OVERLAY_CONTROL_FIELDS = [
  "option_overlay_enabled",
  "option_growth_overlay_enabled",
  "option_growth_overlay_recipe",
  "option_growth_overlay_start_usd",
  "option_growth_overlay_nav_budget_ratio",
  "option_income_overlay_enabled",
  "option_income_overlay_recipe",
  "option_income_overlay_start_usd",
  "option_income_overlay_nav_risk_ratio",
];
export const OPTION_OVERLAY_VARIABLES = OPTION_OVERLAY_CONTROL_FIELDS.map((field) => field.toUpperCase());
const OPTION_OVERLAY_PROFILE_FIELDS = [
  ...OPTION_OVERLAY_CONTROL_FIELDS,
  "option_overlay_live_gate",
  "option_overlay_live_status",
];
export const OPTION_OVERLAY_MODES = ["current", "enabled", "disabled"];
const DCA_PROFILE_CONFIG = Object.fromEntries(
  Object.entries(DCA_PROFILE_DEFAULTS).map(([profile, defaults]) => [
    profile,
    {
      default_mode: defaults.defaultMode || "fixed",
      default_base_investment_usd: defaults.defaultBaseInvestmentUsd || "1000",
    },
  ]),
);
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src https://fred.stlouisfed.org/graph/graph-landing.php",
    "form-action 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
  ].join("; "),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

// This is deliberately a same-origin, public configuration bootstrap. It
// contains only the config projections already shown by the public console;
// private account routing still arrives after an authenticated /api/config
// request. Keeping it external preserves the strict CSP without unsafe-inline.
export const BOOTSTRAP_CONFIG_JS = [
  "// Generated from non-secret console configuration. Do not edit by hand.",
  `window.__PLATFORM_META__ = ${JSON.stringify(PLATFORM_META)};`,
  `window.__PLATFORM_REPOSITORIES__ = ${JSON.stringify(PLATFORM_REPOSITORIES)};`,
  `window.__PLATFORM_CONFIG__ = ${JSON.stringify(PLATFORM_CONFIG)};`,
  `window.__DEFAULT_ACCOUNT_OPTIONS__ = ${JSON.stringify(DEFAULT_ACCOUNT_OPTIONS)};`,
  `window.__DOMAIN_LABELS__ = ${JSON.stringify(DOMAIN_LABELS)};`,
  `window.__DEFAULT_STRATEGY_PROFILES__ = ${JSON.stringify(DEFAULT_STRATEGY_PROFILES)};`,
  `window.__DCA_PROFILE_DEFAULTS__ = ${JSON.stringify(DCA_PROFILE_DEFAULTS)};`,
  `window.__INCOME_LAYER_DEFAULTS__ = ${JSON.stringify(FALLBACK_INCOME_LAYER_DEFAULTS)};`,
  `window.__OPTION_OVERLAY_DEFAULTS__ = ${JSON.stringify(FALLBACK_OPTION_OVERLAY_DEFAULTS)};`,
  `window.__PLATFORM_MIN_RESERVED_CASH_VARIABLES__ = ${JSON.stringify(PLATFORM_MIN_RESERVED_CASH_VARIABLES)};`,
  `window.__PLATFORM_RESERVED_CASH_RATIO_VARIABLES__ = ${JSON.stringify(PLATFORM_RESERVED_CASH_RATIO_VARIABLES)};`,
].join("\n");

// A secondary external script keeps a failed or stale main bundle from
// trapping a visitor behind the loading screen forever. It does not fetch,
// mutate configuration, or grant access: it only reveals the static login
// surface after the main boot flow has had time to finish its own timeout.
export const BOOT_RECOVERY_JS = [
  "(() => {",
  "  const delayMs = 20_000;",
  "  window.setTimeout(() => {",
  "    if (!document.body?.classList.contains('app-loading')) return;",
  "    document.body.classList.remove('app-loading');",
  "    const login = document.getElementById('login-link');",
  "    if (login) login.hidden = false;",
  "  }, delayMs);",
  "})();",
].join("\n");



export async function credentialMaintenanceResponse(request, env, url) {
  const machine = url.pathname.startsWith("/api/internal/");
  const suffix = url.pathname.split("/").at(-1);
  let action = "credential_maintenance_read";
  if (machine) {
    const expected = typeof env.STRATEGY_SWITCH_SYNC_TOKEN === "string" ? env.STRATEGY_SWITCH_SYNC_TOKEN : "";
    // No dispatch fallback, and no alias for broker, control or session authority.
    const aliases = Object.entries(env).filter(([name, value]) => name !== "STRATEGY_SWITCH_SYNC_TOKEN" &&
      (name.endsWith("_TOKEN") || name === "SESSION_SECRET") && typeof value === "string" && value && value === expected);
    if (!expected || aliases.length) throw new HttpError("credential_maintenance_auth_unavailable", 503);
    const supplied = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
    if (supplied !== expected) throw new HttpError("credential_maintenance_auth_invalid", 401);
    if (suffix === "claim" || suffix === "ack") {
      if (request.method !== "POST") throw new HttpError("method_not_allowed", 405);
      action = `credential_maintenance_${suffix}`;
    } else if (request.method !== "GET") throw new HttpError("method_not_allowed", 405);
  } else {
    const session = await requireUx1Session(request, env);
    if (request.method === "POST") {
      if (!session.admin) throw new HttpError("admin required", 403);
      requireSameOrigin(request, { requireOrigin: true });
      action = "credential_maintenance_save";
    } else if (request.method !== "GET") throw new HttpError("method_not_allowed", 405);
  }
  let body;
  if (request.method === "POST") {
    const text = await request.text();
    if (text.length > 1024) throw new HttpError("invalid_credential_maintenance_request", 400);
    try { body = JSON.parse(text); } catch { throw new HttpError("invalid_credential_maintenance_request", 400); }
  }
  const result = await runtimeInstanceCommand(env, { action, body });
  return json(!machine && request.method === "GET" ? { ...result, ...decisionFields(result, "credential_maintenance") } : result);
}




export async function runtimeInstancesResponse(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  if (request.method === "GET") return json(await runtimeInstanceCommand(env));
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  requireSameOrigin(request, { requireOrigin: true });
  let raw;
  try {
    const text = await request.text();
    if (text.length > 16384) throw new Error();
    raw = JSON.parse(text);
  } catch {
    throw new HttpError("invalid_runtime_instance_request", 400);
  }
  runtimeInstanceFields(raw, ["action", "expected_revision", "platform", "key", "config", "broker_environment", "confirm"]);
  const command = { action: raw.action, expected_revision: raw.expected_revision, actor: session.login };
  if (raw.action === "initialize") {
    if (raw.confirm !== "IMPORT_EXISTING_CONFIG") throw new HttpError("runtime_instance_import_confirmation_required", 400);
    // Explicit, one-time import only. A deployment must freeze legacy writers
    // and review this input before enabling the binding and importing it.
    command.account_options = (await loadLegacyAccountOptionsConfig(env)).options || {};
  } else if (raw.action === "create" || raw.action === "edit") {
    try {
      if (!SUPPORTED_PLATFORMS.includes(raw.platform) || PLATFORM_CONFIG[raw.platform].dry_run_only) throw new Error();
      runtimeInstanceFields(raw.config, ["key", "label", "target_name", "account_selector", "deployment_selector", "account_scope", "service_name", "github_environment", "variable_scope", "cash_currency", "supported_domains", "broker_environment", "default_strategy_profile", "default_execution_mode"]);
      const option = cleanAccountOption(raw.config, raw.platform, 0);
      if (!option.account_selector || !option.deployment_selector || !option.service_name) throw new Error();
      option.default_execution_mode = raw.config.default_execution_mode || "dry_run";
      option.default_strategy_profile = cleanSlug(raw.config.default_strategy_profile, "default_strategy_profile");
      assertStrategyAllowedForAccount({ platform: raw.platform, strategy_profile: option.default_strategy_profile, execution_mode: option.default_execution_mode }, option, await loadStrategyProfilesConfig(env));
      command.platform = raw.platform;
      command.config = option;
      if (raw.action === "edit") command.key = cleanSlug(raw.key, "key");
    } catch {
      throw new HttpError("invalid_runtime_instance_config", 400);
    }
  } else if (raw.action === "set_broker_environment") {
    try {
      if (!SUPPORTED_PLATFORMS.includes(raw.platform) || PLATFORM_CONFIG[raw.platform].dry_run_only) throw new Error();
      command.platform = cleanChoice(raw.platform, SUPPORTED_PLATFORMS, "platform");
      command.key = cleanSlug(raw.key, "key");
      command.broker_environment = normalizeBrokerEnvironment(raw.broker_environment);
      if (!supportedBrokerEnvironmentsForPlatform(command.platform).includes(command.broker_environment)) throw new Error();
    } catch {
      throw new HttpError("invalid_broker_environment", 400);
    }
  } else if (raw.action === "request_retirement") {
    command.platform = raw.platform;
    command.key = raw.key;
  } else {
    throw new HttpError("unsupported_runtime_instance_action", 400);
  }
  return json(await runtimeInstanceCommand(env, command));
}

export async function sessionPayload(request, env) {
  const session = await readSession(request, env);
  return {
    authenticated: Boolean(session),
    login: session?.login || null,
    allowed: Boolean(session?.allowed),
    admin: Boolean(session?.admin),
    server_time: new Date().toISOString(),
  };
}

export async function adminConfigResponse(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  return json(await buildAdminState(session, env));
}

import { dateOnlyExternalFlow, externalFlowEnabled, initializeExternalFlow, normalizeExternalFlow, putExternalFlow, readExternalFlow, readExternalFlowCoverage } from "../account_facts/external_flow.js";
import { initializeExecutions, normalizeExecutions, putExecutions, readExecutions } from "../account_facts/executions.js";



export async function saveAdminConfig(request, env) {
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "STRATEGY_SWITCH_CONFIG KV binding is required to save admin config" }, 400);
  }

  let raw;
  try {
    raw = await request.json();
  } catch (error) {
    return json({ ok: false, error: "request body must be valid JSON" }, 400);
  }
  const bootstrapAdmins = parseLoginList(env.STRATEGY_SWITCH_ADMIN_LOGINS || "", "STRATEGY_SWITCH_ADMIN_LOGINS");
  const bootstrapAdminOrgs = parseOrgList(env.STRATEGY_SWITCH_ADMIN_ORGS || "", "STRATEGY_SWITCH_ADMIN_ORGS");
  const allowedLogins = normalizeLoginList(raw.allowed_logins, "allowed_logins");
  const allowedOrgs = normalizeOrgList(raw.allowed_orgs, "allowed_orgs");
  const submittedAdmins = normalizeLoginList(raw.admin_logins, "admin_logins");
  const submittedAdminOrgs = normalizeOrgList(raw.admin_orgs, "admin_orgs");
  const effectiveAdmins = uniqueStrings([...bootstrapAdmins, ...submittedAdmins]);
  const effectiveAdminOrgs = uniqueStrings([...bootstrapAdminOrgs, ...submittedAdminOrgs]);
  if (!effectiveAdmins.includes(session.login) && !hasOrgMatch(session.orgs, effectiveAdminOrgs)) {
    throw new Error("current admin login or org must remain in admin config");
  }
  const authConfig = {
    allowed_logins: uniqueStrings([...allowedLogins, ...effectiveAdmins]),
    allowed_orgs: allowedOrgs,
    admin_logins: effectiveAdmins,
    admin_orgs: effectiveAdminOrgs,
  };
  const accountOptions = normalizeAccountOptionsInput(raw.account_options, "account_options");

  if (hasRuntimeInstanceStore(env)) {
    const instances = await runtimeInstanceCommand(env);
    if (!instances.initialized || canonicalResearchTaskJson(accountOptions) !== canonicalResearchTaskJson(normalizeAccountOptionsPayload(instances.account_options))) {
      throw new HttpError("runtime_instances_managed_separately", 409);
    }
  }
  await writeConfigJson(env, AUTH_CONFIG_KEY, authConfig);
  if (!hasRuntimeInstanceStore(env)) await writeConfigJson(env, ACCOUNT_OPTIONS_KEY, validateAccountOptionsSchemaOrThrow(accountOptions));
  await appendAuditLog(env, {
    ts: new Date().toISOString(),
    login: session.login,
    action: "save_config",
    allowed_count: authConfig.allowed_logins.length,
    allowed_org_count: authConfig.allowed_orgs.length,
    admin_count: authConfig.admin_logins.length,
    admin_org_count: authConfig.admin_orgs.length,
    account_counts: accountCounts(accountOptions),
  });
  return json(await buildAdminState(session, env));
}

function accountSettingsDraftDeps() {
  return {
    supportedDomainsForAccount,
    supportedExecutionModesForPlatform,
    assertDcaPlatform,
    isFrozenStrategyProfile,
    isDcaProfile,
  };
}

function accountSettingsRuntimeDeps() {
  return {
    ...accountSettingsDraftDeps(),
    readSession,
    json,
    requireSameOrigin,
    readBoundedJson,
    readRiskProfileLegacy,
    effectiveAccountSettings,
    loadStrategyProfilesConfig,
    buildRiskProfileBindings,
    loadRiskProfileBindings,
    loadLegacyAccountOptionsConfig,
    riskProfileBindingTargets,
    mirrorConfigJson,
    RISK_PROFILE_BINDINGS_KEY,
    RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION,
    appendAuditLog,
    canonicalResearchTaskJson,
    accountSettingsProfileRuntimeReadback,
    resolveVariableScope,
    resolveGithubEnvironment,
    platformRepositories,
    saveAccountSettings,
  };
}

export async function riskProfileBindingsResponse(request, env) {
  return riskProfileBindingsResponseImpl(request, env, accountSettingsRuntimeDeps());
}

export async function saveRiskProfileBindings(request, env) {
  return saveRiskProfileBindingsImpl(request, env, accountSettingsRuntimeDeps());
}

export async function consoleRunControls(_request, env, account, session) {
  return runControls(account, session, {
    dispatchAvailable: Boolean(env.RUNTIME_SETTINGS_DISPATCH_TOKEN),
    platformControl: ["ibkr", "schwab"].includes(account.platform)
      ? () => readPlatformRuntimeControl(env, account.platform, account.target_name) : null,
    stopReady: async () => {
      if (account.platform === "longbridge" && account.target_name === "hk") {
        if (account.key !== "hk") return false;
        await loadHkStopAccount(env);
        const { record } = await runtimeInstanceCommand(env, { action: "hk_stop_read" });
        return !record || !["reserved", "accepted", "unknown", "stopped"].includes(record.phase);
      }
      const config = await loadAccountOptionsConfig(env);
      if (!account.target_name || (config.options?.[account.platform] || []).filter(a => a.target_name === account.target_name).length !== 1) return false;
      const inputs = { ...account, platform: account.platform };
      const values = Object.fromEntries(["deployment_selector", "account_scope", "account_selector", "service_name"]
        .map(field => [field, inputs[field] || defaultInputValue(field, inputs)]));
      return Object.values(values).every(Boolean) && String(values.account_selector).split(",").some(value => value.trim());
    },
    resumeTarget: async () => {
      const repository = platformRepositories(env).binance;
      const config = await loadAccountOptionsConfig(env);
      if (repository !== "QuantStrategyLab/BinancePlatform" || !account.target_name ||
        (config.options?.binance || []).filter(a => a.target_name === account.target_name).length !== 1 ||
        resolvedVariableScope(account.variable_scope, { ...account, platform: "binance" }) !== "repository") return null;
      const variables = await fetchGithubVariables(env.RUNTIME_SETTINGS_DISPATCH_TOKEN, repository, "repository", "");
      return binanceResumeTarget(Object.fromEntries(variables), account);
    },
    profileState: async () => {
      if (!hasRuntimeInstanceStore(env)) return { reason: "runtime_instances_not_bound" };
      const observed = await runtimeInstanceCommand(env, { action: "account_settings_read", actor: session.login, platform: account.platform, key: account.key });
      const draft = observed.draft;
      if (draft?.status === "identity_conflict") return { reason: "account_settings_identity_conflict" };
      const next = draft?.overrides?.strategy_profile;
      if (draft?.status !== "current" || typeof next !== "string" || Object.keys(draft.overrides).length !== 1 ||
        !accountSettingsIdentityIsComplete(observed.identity) ||
        canonicalResearchTaskJson(draft.identity) !== canonicalResearchTaskJson(observed.identity)) return { reason: "profile_draft_required" };
      if (isDcaProfile(next)) return { reason: "profile_only_required" };
      const profiles = await loadAccountDraftProfiles(env);
      if (!accountDraftStrategyChoices(account.platform, observed.config, profiles).some(p => p.profile === next && !p.dca_supported)) return { reason: "profile_not_selectable" };
      const readback = await accountSettingsProfileRuntimeReadback(env, observed);
      if (!readback) return { reason: "runtime_readback_unavailable" };
      if (readback.runtime_target_enabled !== "false") return { reason: "runtime_target_not_disabled" };
      if (!readback.strategy_profile || readback.strategy_profile === next || isDcaProfile(readback.strategy_profile)) return { reason: "current_profile_conflict" };
      const history = await runtimeInstanceCommand(env, { action: "console_settings_history", actor: session.login, platform: account.platform, key: account.key });
      if (history.approvals.some(row => row.status === "claimed" || (row.status === "approved" &&
        row.identity_json === canonicalResearchTaskJson(observed.identity) && Number(row.instance_revision) === observed.instance_revision &&
        Number(row.draft_revision) === draft.revision && row.old_profile === readback.strategy_profile && row.new_profile === next)))
        return { reason: "profile_application_pending" };
      return { ready: true };
    },
  });
}

export function dcaDraftSupported(platform, profiles, profileId) {
  return dcaDraftSupportedImpl(platform, profiles, profileId, accountSettingsDraftDeps());
}

export function accountDraftStrategyChoices(platform, accountOption, profiles) {
  return accountDraftStrategyChoicesImpl(platform, accountOption, profiles, accountSettingsDraftDeps());
}

export function assertAccountDraftPatch(profiles, observed, patch, trustedProfile, options = {}) {
  return assertAccountDraftPatchImpl(profiles, observed, patch, trustedProfile, options, accountSettingsDraftDeps());
}

export async function loadAccountDraftProfiles(env) {
  return loadAccountDraftProfilesImpl(env, accountSettingsRuntimeDeps());
}

export async function presentAccountSettings(env, observed, admin) {
  return presentAccountSettingsImpl(env, observed, admin, accountSettingsRuntimeDeps());
}

export async function accountSettingsResponse(request, env) {
  return accountSettingsResponseImpl(request, env, accountSettingsRuntimeDeps());
}

export async function saveCombinedAccountDraft(request, env) {
  return saveCombinedAccountDraftImpl(request, env, accountSettingsRuntimeDeps());
}

export async function saveAccountSettings(request, env) {
  return saveAccountSettingsImpl(request, env, accountSettingsRuntimeDeps());
}

export async function approveAccountSettingsProfileApplication(request, env) {
  return approveAccountSettingsProfileApplicationImpl(request, env, accountSettingsRuntimeDeps());
}

export async function claimAccountSettingsProfileApplicationFromGitHub(request, env) {
  return claimAccountSettingsProfileApplicationFromGitHubImpl(request, env, accountSettingsRuntimeDeps());
}

export async function buildAdminState(session, env) {
  const authConfig = await loadAuthConfig(env);
  const accountConfig = await loadAccountOptionsConfig(env);
  const riskProfileBindingState = await loadRiskProfileBindings(env);
  const runtimeInstances = hasRuntimeInstanceStore(env) ? await runtimeInstanceCommand(env) : null;
  let runtimeInstanceStrategies = [];
  if (runtimeInstances) {
    try {
      runtimeInstanceStrategies = (await loadStrategyProfilesConfig(env)).filter((item) => !isFrozenStrategyProfile(item) && (item.allowed_execution_modes || []).includes("dry_run")).map((item) => ({ profile: item.profile, label: item.label, domain: item.domain }));
    } catch {
      // Catalog failure affects draft authoring, never existing instance
      // readback, retirement requests, or `/api/admin/config` readback.
    }
  }
  return {
    ok: true,
    session: { login: session.login, admin: true },
    kvAvailable: hasConfigStore(env),
    authConfig,
    accountOptions: accountConfig.options || {},
    accountOptionSource: accountConfig.source,
    riskProfileBindings: riskProfileBindingState.bindings,
    riskProfileRevision: riskProfileBindingState.revision,
    riskProfileBindingsError: riskProfileBindingState.error,
    riskProfileBindingTargets: riskProfileBindingTargets(riskProfileBindingState.account_options || accountConfig.options || {}),
    auditLog: await loadAuditLog(env),
    runtimeInstances,
    runtimeInstanceStrategies,
    runtimeInstanceStrategiesAvailable: runtimeInstanceStrategies.length > 0,
  };
}

export async function loadPlatformMeta(env = {}) {
  // Use the same bundled configuration as routing and capability validation.
  // Fetching GitHub main here could mix a newer catalog with an older Worker.
  const merged = Object.fromEntries(Object.entries(PLATFORM_META)
    .map(([platform, meta]) => [platform, { ...meta }]));
  const hidden = new Set(String(env.STRATEGY_SWITCH_HIDDEN_PLATFORMS || "")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  for (const [platform, meta] of Object.entries(merged)) {
    meta.console_visible = !hidden.has(platform);
  }
  return merged;
}

// In-memory cache for the lifetime of this Worker isolate.
let _memCurrentStrategies = null;
let _memCurrentStrategiesTs = 0;
let _memRefreshing = false;  // prevent concurrent background refreshes

// KV free tier caps writes at 1,000/day account-wide and the */5 cron plus every
// background refresh reaches this helper, so a write is paid for only when the
// rendered content changed or the stored entry needs its ts bumped to stay inside
// the fresh window that cold isolates serve from.
// current_strategies_cache carries per-account execution_evidence.observed_at
// stamped with new Date() (see accountExecutionEvidence callers), so whole-payload
// byte equality can never hold; the comparison drops those stamps and keeps the
// stored value untouched for readers.

// readConfigJson reports a damaged value as `STRATEGY_SWITCH_CONFIG.<key> must be
// valid JSON`. Only that shape is a cache miss; a KV read that failed for any other
// reason is an outage and has to reach the caller instead of being mistaken for an
// empty cache — the difference is what keeps cold isolates from fanning out to
// GitHub on every request while the store is unhealthy.
export function isConfigJsonParseError(error) {
  return /^STRATEGY_SWITCH_CONFIG\.[^\s]+ must be valid JSON$/.test(String(error?.message || ""));
}

export async function readCurrentStrategiesCacheEntry(env) {
  try {
    return await readConfigJson(env, CURRENT_STRATEGIES_CACHE_KEY);
  } catch (error) {
    if (!isConfigJsonParseError(error)) throw error;
    return null;
  }
}

export async function writeCurrentStrategiesCache(env, payload, ts) {
  if (env.STRATEGY_SWITCH_RUNTIME_INSTANCES) {
    try {
      await directoryCommand(env, { action: "cache", payload, ts });
      return;
    } catch (error) {
      // Receiver-first compatibility only; a real storage failure remains loud.
      if (error.message !== "kv_directory_legacy_receiver" && error.message !== "kv_directory_invalid_request") throw error;
    }
  }
  const signature = currentStrategiesSignature(payload);
  // A damaged stored value must not wedge the cache; this is the only path that can
  // overwrite it, so the comparison reads through the same repair-aware helper.
  const cached = await readCurrentStrategiesCacheEntry(env);
  if (cached?.data && currentStrategiesSignature(cached.data) === signature
      && cached.ts && ts - cached.ts < CURRENT_STRATEGIES_KV_BUMP_MS) {
    return;
  }
  await writeConfigJson(env, CURRENT_STRATEGIES_CACHE_KEY, { ts, data: payload });
}

// loadCurrentStrategiesSafely answers with evidence-only account entries whenever
// GitHub timed out or threw, so a payload whose every account is exactly that
// shape carries no strategy information and must not be served as fresh.
export function isDegradedCurrentStrategies(payload) {
  const accounts = Object.values(payload || {}).flatMap(options => Object.values(options || {}));
  if (!accounts.length) return false;
  return accounts.every(account => account && typeof account === "object"
    && Object.keys(account).length === 1
    && account.execution_evidence?.status === "read_failed");
}

export async function configPayload(request, env, ctx) {
  const session = await readSession(request, env);
  const meta = await loadPlatformMeta(env);
  if (!session?.allowed) return { accountOptions: null, platformMeta: meta };
  const accountConfig = await loadAccountOptionsConfig(env);
  const strategyProfiles = await loadStrategyProfilesConfig(env);

  const currentStrategies = await readCurrentStrategies(accountConfig.options, env, ctx);

  return {
    accountOptions: accountConfig.options,
    accountOptionsRevision: accountConfig.revision ?? null,
    runtimeDailyBindings: runtimeDailyReadModelEnabled(env) ? await runtimeDailyPublicBindings(env, accountConfig.options) : [],
    platformRepositories: platformRepositories(env),
    platformMeta: meta,
    strategyProfiles,
    currentStrategies,
  };
}

export async function readCurrentStrategies(accountOptions, env, ctx) {
  let currentStrategies = null;
  let cacheFresh = false;

  // 1) In-memory cache
  if (_memCurrentStrategies) {
    const age = Date.now() - _memCurrentStrategiesTs;
    if (age < CURRENT_STRATEGIES_MEMO_TTL_MS) {
      currentStrategies = _memCurrentStrategies;
      cacheFresh = true;
    } else if (age < CURRENT_STRATEGIES_STALE_TTL_MS) {
      currentStrategies = _memCurrentStrategies;
      // stale — trigger background refresh below
    }
  }

  // 2) KV cache
  if (!currentStrategies && hasConfigStore(env)) {
    const cached = await readCurrentStrategiesCacheEntry(env);
    if (cached?.ts && cached.data) {
      const age = Date.now() - cached.ts;
      // A degraded entry stays inside the freshness window but is never *fresh*:
      // the next request must revalidate instead of serving a read_failed payload
      // for the whole 30 minutes.
      if (age < CURRENT_STRATEGIES_KV_FRESH_MS && !isDegradedCurrentStrategies(cached.data)) {
        currentStrategies = cached.data;
        cacheFresh = true;
      } else if (age < CURRENT_STRATEGIES_STALE_TTL_MS) {
        currentStrategies = cached.data;
        // stale — trigger background refresh below
      }
      if (currentStrategies && !_memCurrentStrategies) {
        _memCurrentStrategies = currentStrategies;
        _memCurrentStrategiesTs = cached.ts;
      }
    }
  }

  // 3) Background refresh when stale (return old data immediately)
  if (currentStrategies && !cacheFresh && !_memRefreshing && hasConfigStore(env) && ctx) {
    _memRefreshing = true;
    ctx.waitUntil((async () => {
      try {
        const fresh = await loadCurrentStrategiesSafely(accountOptions, env);
        _memCurrentStrategies = fresh;
        _memCurrentStrategiesTs = Date.now();
        await writeCurrentStrategiesCache(env, fresh, _memCurrentStrategiesTs);
      } catch { /* keep stale data */ }
      finally { _memRefreshing = false; }
    })());
  }

  // 4) Complete miss — must wait for GitHub
  if (!currentStrategies) {
    currentStrategies = await loadCurrentStrategiesSafely(accountOptions, env);
    _memCurrentStrategies = currentStrategies;
    _memCurrentStrategiesTs = Date.now();
    if (hasConfigStore(env) && ctx) {
      ctx.waitUntil(writeCurrentStrategiesCache(env, currentStrategies, _memCurrentStrategiesTs));
    }
  }

  return currentStrategies;
}

export async function strategyProfilesPayload(env) {
  return {
    strategyProfiles: await loadStrategyProfilesConfig(env),
    platformMeta: await loadPlatformMeta(env),
  };
}

export async function runtimeCatalogResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  // This is a generated gate catalog, not a deployment observation.  Keeping
  // the distinction in the response makes it unsuitable as an accidental
  // substitute for the independently refreshed control-plane/evidence views.
  return json(RUNTIME_CATALOG_PROJECTION);
}

export async function loadCurrentStrategies(accountOptions, env) {
  const token = env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
  if (!token || !accountOptions) return executionEvidenceFallback(accountOptions, "not_connected");
  const repositories = platformRepositories(env);

  const variableCache = new Map();
  const readVariable = async (repository, scope, githubEnvironment, name) => {
    const cacheKey = [repository, scope, githubEnvironment || ""].join("|");
    if (!variableCache.has(cacheKey)) {
      variableCache.set(cacheKey, (async () => {
        let status = "ok";
        const values = await fetchGithubVariables(token, repository, scope, githubEnvironment, {
          reportReadErrors: true, onReadFailure: reason => { status = reason; },
        });
        return { values, status };
      })());
    }
    const result = await variableCache.get(cacheKey);
    return result.values?.get(name) || "";
  };

  readVariable.readStatus = async (repository, scope, githubEnvironment) =>
    (await variableCache.get([repository, scope, githubEnvironment || ""].join("|")))?.status || "ok";
  const currentStrategies = {};
  // Process platforms sequentially: each platform's account list is also
  // processed one at a time (not Promise.all). This keeps GitHub API
  // concurrency low enough to avoid secondary rate limiting.
  for (const platform of SUPPORTED_PLATFORMS) {
    const platformStrategies = await loadStrategiesForPlatform(platform, accountOptions, repositories, readVariable);
    if (Object.keys(platformStrategies).length) currentStrategies[platform] = platformStrategies;
    // 100ms gap between platforms to respect GitHub secondary rate limit
    await new Promise((r) => setTimeout(r, 100));
  }
  return currentStrategies;
}

export async function loadStrategiesForPlatform(platform, accountOptions, repositories, readVariable) {
  const options = Array.isArray(accountOptions[platform]) ? accountOptions[platform] : [];
  if (!options.length) return {};
  const repository = repositories[platform];
  if (!repository) return executionEvidenceFallback({ [platform]: options }, "not_connected")[platform];

  // Process accounts sequentially within each platform to stay within
  // GitHub's concurrent request budget per token (~30 burst limit).
  const platformStrategies = {};
  for (const option of options) {
    let status = "ok";
    const trackedRead = async (...args) => {
      const value = await readVariable(...args);
      const result = await readVariable.readStatus?.(...args.slice(0, 3));
      if (result && result !== "ok") status = result;
      return value;
    };
    const current = await resolveCurrentStrategyForAccount({
      platform,
      option,
      optionsCount: options.length,
      repository,
      readVariable: trackedRead,
    });
    platformStrategies[option.key] = { ...current,
      execution_evidence: accountExecutionEvidence(option, current || {}, { status, observedAt: new Date().toISOString() }) };
  }
  return platformStrategies;
}

export function executionEvidenceFallback(accountOptions, status) {
  return Object.fromEntries(Object.entries(accountOptions || {}).map(([platform, options]) => [platform,
    Object.fromEntries(options.map(option => [option.key, {
      execution_evidence: accountExecutionEvidence(option, {}, { status, observedAt: new Date().toISOString() }),
    }]))]));
}

export async function loadCurrentStrategiesSafely(accountOptions, env) {
  try {
    return await withTimeout(
      loadCurrentStrategies(accountOptions, env),
      CURRENT_STRATEGIES_TIMEOUT_MS,
      executionEvidenceFallback(accountOptions, "read_failed"),
    );
  } catch {
    return executionEvidenceFallback(accountOptions, "read_failed");
  }
}

export function withTimeout(promise, timeoutMs, fallback) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export async function fetchWithTimeout(resource, init = {}, timeoutMs = GITHUB_API_TIMEOUT_MS, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(resource, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("GitHub request timed out");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function resolveCurrentStrategyForAccount({ platform, option, optionsCount, repository, readVariable }) {
  const serviceTargetsValue = usesServiceTargetsAsRuntimeSource(platform)
    ? await readVariable(repository, "repository", "", "CLOUD_RUN_SERVICE_TARGETS_JSON")
    : "";
  const serviceTarget = runtimeTargetFromServiceTargets(serviceTargetsValue, platform, option);
  const serviceTargetProfile = cleanCurrentStrategy(serviceTarget?.strategy_profile);
  const serviceTargetReservedCashPayload = reservedCashPayloadFromObject(platform, serviceTarget);
  const serviceTargetIncomeLayerPayload = incomeLayerPayloadFromObject(serviceTarget);
  const serviceTargetOptionOverlayPayload = optionOverlayPayloadFromObject(serviceTarget);
  let serviceTargetRuntimeTargetEnabledPayload = runtimeTargetEnabledPayloadFromObject(serviceTarget);
  if (serviceTarget && !Object.keys(serviceTargetRuntimeTargetEnabledPayload).length) {
    const variableScope = resolveVariableScope(platform, option);
    serviceTargetRuntimeTargetEnabledPayload = await readRuntimeTargetEnabledVariable({
      repository, variableScope,
      githubEnvironment: resolveGithubEnvironment(platform, option, variableScope), readVariable,
    });
  }
  const serviceTargetDcaPayload = dcaPayloadFromObject(serviceTarget);
  const serviceTargetCashOnlyPayload = cashOnlyPayloadFromObject(platform, serviceTarget);
  if (serviceTargetProfile) {
    return {
      strategy_profile: serviceTargetProfile,
      ...runtimeModePayload(serviceTarget),
      strategy_execution: strategyTargetExecution(serviceTarget),
      ...serviceTargetReservedCashPayload,
      ...serviceTargetIncomeLayerPayload,
      ...serviceTargetOptionOverlayPayload,
      ...serviceTargetRuntimeTargetEnabledPayload,
      ...serviceTargetCashOnlyPayload,
      ...dcaPayloadForProfile(serviceTargetProfile, serviceTargetDcaPayload),
      source: "CLOUD_RUN_SERVICE_TARGETS_JSON",
      variable_scope: "repository",
    };
  }
  if (
    Object.keys(serviceTargetReservedCashPayload).length ||
    Object.keys(serviceTargetIncomeLayerPayload).length ||
    Object.keys(serviceTargetOptionOverlayPayload).length ||
    Object.keys(serviceTargetCashOnlyPayload).length ||
    Object.keys(serviceTargetRuntimeTargetEnabledPayload).length
  ) {
    return {
      ...runtimeModePayload(serviceTarget),
      strategy_execution: strategyTargetExecution(serviceTarget),
      ...serviceTargetReservedCashPayload,
      ...serviceTargetIncomeLayerPayload,
      ...serviceTargetOptionOverlayPayload,
      ...serviceTargetCashOnlyPayload,
      ...serviceTargetRuntimeTargetEnabledPayload,
      source: "CLOUD_RUN_SERVICE_TARGETS_JSON",
      variable_scope: "repository",
    };
  }

  const variableScope = resolveVariableScope(platform, option);
  const githubEnvironment = resolveGithubEnvironment(platform, option, variableScope);
  const reservedCashPayloadPromise = readReservedCashVariables({
    platform,
    repository,
    variableScope,
    githubEnvironment,
    readVariable,
  });
  const incomeLayerPayloadPromise = readIncomeLayerVariables({
    repository,
    variableScope,
    githubEnvironment,
    readVariable,
  });
  const optionOverlayPayloadPromise = readOptionOverlayVariables({
    repository,
    variableScope,
    githubEnvironment,
    readVariable,
  });
  const runtimeTargetEnabledPayloadPromise = readRuntimeTargetEnabledVariable({
    repository,
    variableScope,
    githubEnvironment,
    readVariable,
  });
  const dcaPayloadPromise = readDcaVariables({
    repository,
    variableScope,
    githubEnvironment,
    readVariable,
  });
  const cashOnlyPayloadPromise = readCashOnlyVariables({
    platform,
    repository,
    variableScope,
    githubEnvironment,
    readVariable,
  });
  // All fields share one scoped variable-list read; missing fields are not retried.
  const runtimeTargetValue = await readVariable(repository, variableScope, githubEnvironment, "RUNTIME_TARGET_JSON");
  const [
    reservedCashPayload,
    incomeLayerPayload,
    optionOverlayPayload,
    runtimeTargetEnabledPayload,
    dcaPayload,
    cashOnlyPayload,
  ] = await Promise.all([
    reservedCashPayloadPromise,
    incomeLayerPayloadPromise,
    optionOverlayPayloadPromise,
    runtimeTargetEnabledPayloadPromise,
    dcaPayloadPromise,
    cashOnlyPayloadPromise,
  ]);
  const runtimeTarget = parseJsonObject(runtimeTargetValue);
  const runtimeTargetMatches = runtimeTarget && runtimeTargetMatchesAccount(runtimeTarget, platform, option);
  const runtimeTargetProfile = runtimeTargetMatches ? cleanCurrentStrategy(runtimeTarget.strategy_profile) : "";
  if (runtimeTargetProfile) {
    let resumeTarget = null;
    if (platform === "binance" && repository === "QuantStrategyLab/BinancePlatform" && variableScope === "repository") {
      const values = { RUNTIME_TARGET_JSON: runtimeTargetValue };
      for (const name of ["RUNTIME_TARGET_ENABLED", "BINANCE_RECOVERY_CONTROL_ENABLED", "BINANCE_DRY_RUN", "STRATEGY_PROFILE", "CLOUD_RUN_SERVICE_TARGETS_JSON"]) {
        values[name] = await readVariable(repository, variableScope, githubEnvironment, name);
      }
      resumeTarget = await binanceResumeTarget(values, option);
    }
    return {
      strategy_profile: runtimeTargetProfile,
      ...(resumeTarget ? { binance_resume_target_sha256: resumeTarget.runtime_target_sha256 } : {}),
      ...runtimeModePayload(runtimeTarget),
      strategy_execution: strategyTargetExecution(runtimeTarget),
      ...reservedCashPayload,
      ...incomeLayerPayload,
      ...optionOverlayPayload,
      ...runtimeTargetEnabledPayload,
      ...dcaPayloadForProfile(runtimeTargetProfile, dcaPayload),
      ...cashOnlyPayload,
      source: "RUNTIME_TARGET_JSON",
      variable_scope: variableScope,
      github_environment: githubEnvironment || "",
    };
  }

  if (variableScope === "environment" || optionsCount <= 1) {
    const profileValue = await readVariable(repository, variableScope, githubEnvironment, "STRATEGY_PROFILE");
    const profile = cleanCurrentStrategy(profileValue);
    if (profile) {
      const current = {
        strategy_profile: profile,
        ...reservedCashPayload,
        ...incomeLayerPayload,
        ...optionOverlayPayload,
        ...runtimeTargetEnabledPayload,
        ...dcaPayloadForProfile(profile, dcaPayload),
        ...cashOnlyPayload,
        source: "STRATEGY_PROFILE",
        variable_scope: variableScope,
        github_environment: githubEnvironment || "",
      };
      if (variableScope === "environment" && normalizeMatchValue(option?.target_name) === "paper") {
        current.execution_mode = "paper";
      }
      return current;
    }
  }

  if (
    Object.keys(reservedCashPayload).length ||
    Object.keys(incomeLayerPayload).length ||
    Object.keys(optionOverlayPayload).length ||
    Object.keys(runtimeTargetEnabledPayload).length ||
    Object.keys(cashOnlyPayload).length
  ) {
    return {
      ...reservedCashPayload,
      ...incomeLayerPayload,
      ...optionOverlayPayload,
      ...runtimeTargetEnabledPayload,
      ...cashOnlyPayload,
      source: Object.keys(reservedCashPayload).length
        ? "RESERVED_CASH_VARIABLES"
        : (Object.keys(incomeLayerPayload).length
          ? "INCOME_LAYER_VARIABLES"
          : (Object.keys(runtimeTargetEnabledPayload).length
            ? "RUNTIME_TARGET_ENABLED_VARIABLE"
            : (Object.keys(optionOverlayPayload).length
              ? "OPTION_OVERLAY_VARIABLES"
              : "CASH_ONLY_EXECUTION_VARIABLE"))),
      variable_scope: variableScope,
      github_environment: githubEnvironment || "",
    };
  }

  return null;
}

export function usesServiceTargetsAsRuntimeSource(platform) {
  return ["ibkr", "schwab", "firstrade"].includes(platform);
}

export function logout(request) {
  requireSameOrigin(request, { requireOrigin: true });
  return json({ ok: true }, 200, {
    "Set-Cookie": clearCookie(SESSION_COOKIE),
  });
}

export async function acceptHkStopResult(request, env) {
  return acceptHkStopResultImpl(request, env, {
    requireDedicatedExecutionEvidenceSyncToken,
    readBoundedJson,
    json,
  });
}

export async function loadHkStopAccount(env) {
  return loadHkStopAccountImpl(env, { loadAccountOptionsConfig });
}

function runtimeControlRuntimeDeps() {
  return {
    loadAccountOptionsConfig,
    accountSettingsIdentity,
    resolvedVariableScope,
    cleanSlug,
    defaultRepository: DEFAULT_REPOSITORY,
    json,
  };
}

export async function runtimeControlSource(env, platform, targetName) {
  return runtimeControlSourceImpl(env, platform, targetName, runtimeControlRuntimeDeps());
}

export async function readPlatformRuntimeControl(env, platform, targetName) {
  return readPlatformRuntimeControlImpl(env, platform, targetName, runtimeControlRuntimeDeps());
}

export function runtimeControlStopRequest(env, platform, targetName, source) {
  return runtimeControlStopRequestImpl(env, platform, targetName, source, runtimeControlRuntimeDeps());
}

export async function dispatchPlatformRuntimeControl(env, raw) {
  return dispatchPlatformRuntimeControlImpl(env, raw, runtimeControlRuntimeDeps());
}

export async function dispatchPlatformControlReadback(env, raw) {
  if (raw.confirm !== "READ_ONLY" || !["ibkr", "schwab"].includes(raw.platform)
      || Object.keys(raw).some(key => !["platform", "target_name", "operation", "confirm"].includes(key))) throw new HttpError("runtime_control_request_invalid", 400);
  const targetName = cleanSlug(raw.target_name, "target_name");
  const source = await runtimeControlSource(env, raw.platform, targetName);
  const args = { platform: raw.platform, key: source.item.key };
  // Reconcile the original QRS run first. The platform run ID can only come
  // from its validated safe artifact and never from the client.
  await readPlatformRuntimeControl(env, raw.platform, targetName);
  let { record } = await runtimeInstanceCommand(env, { action: "runtime_control_read", ...args });
  if (!record || !["accepted", "unknown", "partial"].includes(record.phase)) return json(presentRuntimeControl(record));
  const checkId = crypto.randomUUID();
  const begun = await runtimeInstanceCommand(env, { action: "runtime_control_begin_check", ...args, request_id: record.request_id, check_id: checkId });
  if (begun.state !== "reserved") return json(presentRuntimeControl(begun.record));
  record = begun.record;
  const details = JSON.parse(record.result_json || "{}");
  let runId = null, rejected = false;
  try {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${env.RUNTIME_SETTINGS_REPO || DEFAULT_REPOSITORY}/actions/workflows/manual-runtime-stop.yml/dispatches`, {
      method: "POST", headers: githubHeaders(env.RUNTIME_SETTINGS_DISPATCH_TOKEN), body: JSON.stringify({ ref: "main", return_run_details: true,
        inputs: { stop_request: JSON.stringify(runtimeControlStopRequest(env, raw.platform, targetName, source)), apply: "false", confirm: "READ_ONLY", apply_hk_stop: "false",
          runtime_control_mode: "readback", runtime_control_operation: record.action, runtime_control_request_id: record.request_id,
          runtime_control_check_id: checkId, runtime_control_platform_run_id: details.platform_run_id } }),
    });
    if (response.status === 200) {
      const body = await response.json();
      if (Number.isSafeInteger(body.workflow_run_id) && body.workflow_run_id > 0) runId = String(body.workflow_run_id);
    } else if (response.status >= 400 && response.status < 500 && response.status !== 429) rejected = true;
  } catch { /* Readback outcome may be unknown; next explicit refresh reads the same check. */ }
  if (runId || rejected) ({ record } = await runtimeInstanceCommand(env, { action: "runtime_control_record_check", ...args,
    request_id: record.request_id, check_id: checkId, run_id: runId, complete: rejected, reason: rejected ? "readback_dispatch_rejected" : null }));
  return json(presentRuntimeControl(record));
}

export async function readRuntimeStop(request, env, url) {
  requireSameOrigin(request);
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  const platform = url.searchParams.get("platform");
  const targetName = url.searchParams.get("target_name");
  if (["ibkr", "schwab"].includes(platform) && targetName) return json(await readPlatformRuntimeControl(env, platform, targetName));
  if (platform !== "longbridge" || targetName !== "hk") {
    return json({
      ok: true, configured: false, platform_applied: false, request_succeeded: false,
      phase: null, runtime_observation: { status: "unknown", request_succeeded: false },
    });
  }
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const stored = await runtimeInstanceCommand(env, { action: "hk_stop_read" });
  const observation = await hkStopObservation(env, stored.record);
  const repository = env.RUNTIME_SETTINGS_REPO || DEFAULT_REPOSITORY;
  return json(presentHkStop(stored.record, observation, repository));
}

export async function dispatchHkRuntimeStop(env, raw) {
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const requestId = raw.request_id ? String(raw.request_id).trim().toLowerCase() : crypto.randomUUID();
  if (!HK_STOP_REQUEST_ID.test(requestId)) throw new HttpError("invalid_hk_stop_request_id", 400);
  const source = await loadHkStopAccount(env);
  const identity = source.identity;
  const identityJson = canonicalResearchTaskJson(identity);
  const runtimeJson = canonicalResearchTaskJson({
    platform_id: identity.platform_id,
    deployment_selector: identity.deployment_selector,
    account_selector: identity.account_selector,
    account_scope: identity.account_scope,
    service_name: identity.service_name,
  });
  const claimed = await runtimeInstanceCommand(env, {
    action: "hk_stop_claim",
    request_id: requestId,
    action_name: "stop",
    source_revision: source.revision,
    identity: source.identity,
    source_identity_sha256: await sha256Hex(identityJson),
    runtime_identity_sha256: await sha256Hex(runtimeJson),
  });
  const repository = env.RUNTIME_SETTINGS_REPO || DEFAULT_REPOSITORY;
  if (claimed.state !== "reserved") {
    const observation = await hkStopObservation(env, claimed.record);
    const body = presentHkStop({ ...claimed.record, reused: true }, observation, repository);
    if (claimed.state === "blocked") return json({ ...body, ok: false, error: "hk_stop_request_pending" }, 409);
    return json(body);
  }
  const stored = claimed.record;
  const stopRequest = {
    target_id: HK_STOP_TARGET_ID,
    github: {
      repository: "QuantStrategyLab/LongBridgePlatform",
      variable_scope: "environment",
      environment: identity.github_environment,
    },
    runtime_target: {
      platform_id: "longbridge",
      deployment_selector: identity.deployment_selector,
      account_selector: identity.account_selector,
      account_scope: identity.account_scope,
      service_name: identity.service_name,
    },
    correlation: {
      request_id: stored.request_id,
      source_revision: stored.source_revision,
      source_identity_sha256: stored.source_identity_sha256,
    },
  };
  let outcome = "unknown";
  try {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${repository}/actions/workflows/manual-runtime-stop.yml/dispatches`, {
      method: "POST",
      headers: githubHeaders(env.RUNTIME_SETTINGS_DISPATCH_TOKEN),
      body: JSON.stringify({
        ref: env.RUNTIME_SETTINGS_REF || "main",
        inputs: {
          stop_request: JSON.stringify(stopRequest),
          apply: "true",
          confirm: "STOP_ONLY",
          apply_hk_stop: "true",
        },
      }),
    });
    if (response.status === 204) outcome = "accepted";
    else if (response.status >= 400 && response.status < 500) outcome = "rejected";
  } catch {
    outcome = "unknown";
  }
  try {
    const recorded = await runtimeInstanceCommand(env, {
      action: "hk_stop_record",
      request_id: claimed.record.request_id,
      phase: outcome,
    });
    const observation = await hkStopObservation(env, recorded.record);
    return json(presentHkStop(recorded.record, observation, repository));
  } catch {
    const observation = { status: "unknown", request_succeeded: false };
    return json(presentHkStop({ ...claimed.record, phase: "reserved", dispatch_result: null, persisted: false }, observation, repository));
  }
}

export async function dispatchRuntimeStop(request, env) {
  requireEnv(env, "RUNTIME_SETTINGS_DISPATCH_TOKEN");
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  const raw = await request.json();
  if (raw && !Array.isArray(raw) && typeof raw === "object" && ["ibkr", "schwab"].includes(raw.platform) && raw.operation === "inspect")
    return await dispatchPlatformControlReadback(env, raw);
  if (raw && !Array.isArray(raw) && typeof raw === "object" && ["ibkr", "schwab"].includes(raw.platform) && raw.operation)
    return await dispatchPlatformRuntimeControl(env, raw);
  const hkStop = raw && !Array.isArray(raw) && raw.platform === "longbridge" && raw.target_name === "hk";
  const allowedKeys = hkStop ? ["platform", "target_name", "confirm", "request_id"] : ["platform", "target_name", "confirm"];
  if (!raw || Array.isArray(raw) || typeof raw !== "object"
    || Object.keys(raw).some((key) => !allowedKeys.includes(key))
    || raw.confirm !== "STOP_ONLY") {
    throw new HttpError("stop accepts only platform, target_name and STOP_ONLY confirmation", 400);
  }
  const platform = cleanChoice(raw.platform, SUPPORTED_PLATFORMS, "platform");
  const targetName = cleanSlug(raw.target_name, "target_name");
  if (platform === "longbridge" && targetName === "hk") return await dispatchHkRuntimeStop(env, raw);
  const accountConfig = await loadAccountOptionsConfig(env);
  const matches = (accountConfig.options?.[platform] || []).filter((item) => item.target_name === targetName);
  if (matches.length !== 1) throw new HttpError("stop requires one configured target", 400);
  // Derive routing only from protected account configuration, not form edits.
  // The workflow independently checks this identity against current variables.
  const inputs = { ...matches[0], platform, target_name: targetName };
  inputs.variable_scope = resolvedVariableScope(inputs.variable_scope, inputs);
  for (const field of ["deployment_selector", "account_scope", "account_selector", "service_name", "github_environment"]) {
    inputs[field] = inputs[field] || defaultInputValue(field, inputs);
  }
  const identity = {
    platform_id: platform,
    deployment_selector: inputs.deployment_selector,
    account_selector: String(inputs.account_selector || "").split(",").map((item) => item.trim()).filter(Boolean),
    account_scope: inputs.account_scope,
    service_name: inputs.service_name,
  };
  if (!identity.deployment_selector || !identity.account_selector.length || !identity.account_scope || !identity.service_name) {
    throw new HttpError("stop target identity is incomplete", 400);
  }
  const github = { repository: platformRepositories(env)[platform], variable_scope: inputs.variable_scope };
  if (github.variable_scope === "environment") github.environment = inputs.github_environment;
  const stopRequest = { target_id: `${platform}/${targetName}`, github, runtime_target: identity };
  const repository = env.RUNTIME_SETTINGS_REPO || DEFAULT_REPOSITORY;
  const workflow = "manual-runtime-stop.yml";
  try {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: githubHeaders(env.RUNTIME_SETTINGS_DISPATCH_TOKEN),
      body: JSON.stringify({
        ref: env.RUNTIME_SETTINGS_REF || "main",
        inputs: { stop_request: JSON.stringify(stopRequest), apply: "true", confirm: "STOP_ONLY" },
      }),
    });
    if (!response.ok) throw new Error("dispatch failed");
  } catch {
    return json({ ok: false, error: "stop dispatch unverified; check the existing run before retrying" }, 502);
  }
  return json({
    ok: true, configured: false, platform_applied: false,
    actions_url: `https://github.com/${repository}/actions/workflows/${workflow}`,
  });
}

export async function binanceResumeTarget(values, option) {
  const target = parseJsonObject(values.RUNTIME_TARGET_JSON);
  const continuity = target?.live_continuity;
  if (values.RUNTIME_TARGET_ENABLED !== "false" || values.BINANCE_RECOVERY_CONTROL_ENABLED !== "true"
    || !["", "false"].includes(values.BINANCE_DRY_RUN || "")
    || !["", "crypto_live_pool_rotation"].includes(values.STRATEGY_PROFILE || "")
    || values.CLOUD_RUN_SERVICE_TARGETS_JSON
    || target?.platform_id !== "binance" || target.strategy_profile !== "crypto_live_pool_rotation"
    || target.execution_mode !== "live" || target.dry_run_only !== false
    || continuity?.baseline_kind !== "legacy_authorized"
    || !["RECONCILE_ONLY", "ACTIVE_LKG"].includes(continuity?.state)
    || typeof continuity.baseline_id !== "string" || !continuity.baseline_id.trim()
    || typeof continuity.captured_at !== "string" || !continuity.captured_at.trim()
    || !/^[a-f0-9]{64}$/.test(continuity.baseline_target_sha256 || "")) return null;
  const inputs = { ...option, platform: "binance" };
  const identity = { platform_id: "binance" };
  for (const field of ["deployment_selector", "account_selector", "account_scope", "service_name"]) {
    const value = inputs[field] || defaultInputValue(field, inputs);
    identity[field] = field === "account_selector"
      ? String(value || "").split(",").map((item) => item.trim()).filter(Boolean) : value;
    if (!value || JSON.stringify(identity[field]) !== JSON.stringify(target[field])) return null;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(values.RUNTIME_TARGET_JSON));
  return {
    runtime_target: identity,
    runtime_target_sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

export async function dispatchBinanceResume(request, env) {
  requireEnv(env, "RUNTIME_SETTINGS_DISPATCH_TOKEN");
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  const raw = await request.json();
  if (!raw || Array.isArray(raw) || typeof raw !== "object"
    || Object.keys(raw).some((key) => !["platform", "target_name", "runtime_target_sha256", "confirm"].includes(key))
    || raw.platform !== "binance" || raw.confirm !== "RESUME_EXISTING"
    || typeof raw.runtime_target_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.runtime_target_sha256)) {
    throw new HttpError("resume accepts only the existing Binance target and RESUME_EXISTING confirmation", 400);
  }
  const config = await loadAccountOptionsConfig(env);
  const matches = (config.options?.binance || []).filter((item) => item.target_name === raw.target_name);
  const repository = platformRepositories(env).binance;
  if (matches.length !== 1 || repository !== "QuantStrategyLab/BinancePlatform"
    || resolvedVariableScope(matches[0].variable_scope, { ...matches[0], platform: "binance" }) !== "repository") {
    throw new HttpError("resume requires one configured Binance repository target", 400);
  }
  let target;
  try {
    const variables = await fetchGithubVariables(env.RUNTIME_SETTINGS_DISPATCH_TOKEN, repository, "repository", "");
    target = await binanceResumeTarget(Object.fromEntries(variables), matches[0]);
  } catch {
    return json({ ok: false, error: "resume source unavailable; no request submitted" }, 502);
  }
  if (!target || target.runtime_target_sha256 !== raw.runtime_target_sha256) {
    return json({ ok: false, error: "existing recovery configuration changed or unavailable; refresh before continuing" }, 409);
  }
  // Only the external switch is requested. The platform's private ACTIVE_LKG
  // validator remains mandatory; a console confirmation cannot activate it.
  const resumeRequest = { target_id: `binance/${matches[0].target_name}`,
    github: { repository, variable_scope: "repository" }, ...target };
  const settingsRepository = env.RUNTIME_SETTINGS_REPO || DEFAULT_REPOSITORY;
  const workflow = "manual-binance-resume.yml";
  try {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${settingsRepository}/actions/workflows/${workflow}/dispatches`, {
      method: "POST", headers: githubHeaders(env.RUNTIME_SETTINGS_DISPATCH_TOKEN),
      body: JSON.stringify({ ref: "main", inputs: { resume_request: JSON.stringify(resumeRequest), apply: "true", confirm: "RESUME_EXISTING" } }),
    });
    if (!response.ok) throw new Error("dispatch failed");
  } catch {
    return json({ ok: false, error: "resume dispatch unverified; check the existing run before retrying" }, 502);
  }
  return json({ ok: true, configured: false, platform_applied: false,
    actions_url: `https://github.com/${settingsRepository}/actions/workflows/${workflow}` });
}

export async function dispatchSwitch(request, env) {
  requireEnv(env, "RUNTIME_SETTINGS_DISPATCH_TOKEN");
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);

  const rawInput = await request.json();
  const inputs = normalizeSwitchInputs(rawInput);
  assertSwitchIntent(inputs);
  if (inputs.live_continuity_state !== "NONE") {
    return json({
      ok: false,
      error: "legacy continuity recovery requires the private reconciliation recovery controller; manual switch cannot restore execution",
    }, 409);
  }
  const accountConfig = await loadAccountOptionsConfig(env);
  const accountOption = assertConfiguredAccount(inputs, accountConfig.options);
  assertStrategyAllowedForAccount(inputs, accountOption, await loadStrategyProfilesConfig(env));
  if (!SWITCH_ACTIVATION_CONNECTED) {
    return json({
      ok: false,
      error: "账户应用尚未接通，系统未提交变更",
      workflow_dispatched: false,
    }, 409);
  }
  const repository = env.RUNTIME_SETTINGS_REPO || DEFAULT_REPOSITORY;
  const workflow = env.RUNTIME_SETTINGS_WORKFLOW || DEFAULT_WORKFLOW;
  const apiUrl = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`;
  const response = await fetchWithTimeout(apiUrl, {
    method: "POST",
    headers: githubHeaders(env.RUNTIME_SETTINGS_DISPATCH_TOKEN),
    body: JSON.stringify({
      ref: env.RUNTIME_SETTINGS_REF || "main",
      inputs,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return json({ ok: false, error: `GitHub dispatch failed: ${text.slice(0, 600)}` }, 502);
  }

  return json({
    ok: true,
    repository,
    workflow,
    actions_url: `https://github.com/${repository}/actions/workflows/${workflow}`,
    account_options_sync: {
      synced: false,
      deferred: true,
      reason: "workflow_success_required",
    },
    inputs,
  });
}

export async function syncDefaultStrategyForAccount(env, accountOptions, inputs, session) {
  if (hasRuntimeInstanceStore(env)) {
    try {
      await runtimeInstanceCommand(env, { action: "sync_defaults", actor: session?.login || "github-actions", inputs });
      return { synced: true, audit_logged: true };
    } catch (error) {
      return { synced: false, reason: error instanceof HttpError ? error.message : "runtime_instances_unavailable" };
    }
  }
  if (!hasConfigStore(env)) return { synced: false, reason: "kv_not_bound" };
  try {
    const { options, changed } = updateAccountOptionsDefaultStrategy(accountOptions, inputs);
    let auditLogged = false;
    if (changed) {
      await writeConfigJson(env, ACCOUNT_OPTIONS_KEY, validateAccountOptionsSchemaOrThrow(options));
      try {
        await appendAuditLog(env, {
          ts: new Date().toISOString(),
          login: session?.login || "",
          action: "sync_default_strategy",
          platform: inputs.platform,
          target_name: inputs.target_name,
          strategy_profile: inputs.strategy_profile,
        });
        auditLogged = true;
      } catch {
        auditLogged = false;
      }
    }
    return { synced: true, changed, audit_logged: auditLogged };
  } catch (error) {
    return { synced: false, error: error.message || "account option sync failed" };
  }
}

export async function syncAccountDefaultResponse(request, env) {
  requireInternalSyncToken(request, env);
  let rawInput;
  try {
    rawInput = await request.json();
  } catch {
    return json({ ok: false, error: "request body must be valid JSON" }, 400);
  }
  let inputs;
  try {
    inputs = normalizeSwitchInputs(rawInput);
  } catch (error) {
    if (isFrozenStrategyProfile({ profile: rawInput?.strategy_profile })) {
      throw new HttpError("frozen strategy requires valid continuity input", 409);
    }
    throw error;
  }
  const accountConfig = await loadAccountOptionsConfig(env);
  const strategyProfiles = await loadStrategyProfilesConfig(env);
  const strategy = strategyProfiles.find((item) => sameStrategyProfile(item.profile, inputs.strategy_profile));
  if (!strategy) throw new Error(`strategy ${inputs.strategy_profile} is not configured`);

  let accountOptions = accountConfig.options;
  let accountOption = configuredAccountForInputs(inputs, accountOptions);
  let registeredLegacyContinuityAccount = false;
  if (!accountOption) {
    if (isFrozenStrategyProfile(strategy)) throw new HttpError(`strategy ${inputs.strategy_profile} is frozen for new selection`, 409);
    if (hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instance_registration_requires_management", 409);
    const registration = registerLegacyContinuityAccount(env, accountOptions, inputs, strategy);
    accountOptions = registration.options;
    accountOption = registration.account;
    registeredLegacyContinuityAccount = registration.registered;
    if (registeredLegacyContinuityAccount) {
      await writeConfigJson(env, ACCOUNT_OPTIONS_KEY, validateAccountOptionsSchemaOrThrow(accountOptions));
      try {
        await appendAuditLog(env, {
          ts: new Date().toISOString(),
          login: "github-actions",
          action: "register_legacy_continuity_account",
          platform: inputs.platform,
          target_name: inputs.target_name,
          strategy_profile: inputs.strategy_profile,
          live_continuity_state: inputs.live_continuity_state,
        });
      } catch {
        // The routing registration is still valid if its non-critical audit
        // append fails; callers receive the registration result below.
      }
    }
  }
  if (!accountOption) throw new Error("switch inputs do not match configured account options");
  if (isFrozenStrategyProfile(strategy) && !sameStrategyProfile(accountOption.default_strategy_profile, inputs.strategy_profile)) {
    throw new HttpError(`strategy ${inputs.strategy_profile} requires an existing matching account default`, 409);
  }
  assertStrategyAllowedForAccount(inputs, accountOption, strategyProfiles);
  const result = await syncDefaultStrategyForAccount(env, accountOptions, inputs, {
    login: "github-actions",
  });
  const kvSyncSkipped = result.reason === "kv_not_bound";
  const accountOptionsSync = kvSyncSkipped ? { ...result, skipped: true } : result;
  return json(
    {
      ok: result.synced || kvSyncSkipped,
      account_options_sync: accountOptionsSync,
      legacy_continuity_account_registered: registeredLegacyContinuityAccount,
    },
    result.synced || kvSyncSkipped ? 200 : 500,
  );
}

export function requireInternalSyncToken(request, env) {
  const expected = env.STRATEGY_SWITCH_SYNC_TOKEN || env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
  if (!expected) throw new HttpError("internal sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("internal sync token is invalid", 401);
}

export async function syncStrategyProfilesResponse(request, env) {
  requireInternalSyncToken(request, env);
  const result = await syncStrategyProfilesConfig(env, { login: "github-actions" });
  const kvSyncSkipped = result.reason === "kv_not_bound";
  const strategyProfilesSync = kvSyncSkipped ? { ...result, skipped: true } : result;
  return json(
    {
      ok: result.synced || kvSyncSkipped,
      strategy_profiles_sync: strategyProfilesSync,
      strategy_profiles_count: result.count,
    },
    result.synced || kvSyncSkipped ? 200 : 500,
  );
}

export async function syncStrategyHealthResponse(request, env) {
  requireDedicatedStrategyHealthSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "strategy health KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, STRATEGY_HEALTH_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid strategy health payload" }, error.status || 400);
  }

  let snapshot;
  try {
    snapshot = normalizeStrategyHealthSnapshot(raw, "strategy health snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid strategy health payload" }, 400);
  }

  await writeConfigJson(env, STRATEGY_HEALTH_SNAPSHOT_KEY, snapshot);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "strategy-health-sync",
      action: "sync_strategy_health",
      schema_version: snapshot.schema_version,
      strategy_count: snapshot.summary.strategy_count,
      data_status: snapshot.data_status,
    });
  } catch {
    // Snapshot delivery remains successful; audit data must never expose the payload.
  }
  return json({
    ok: true,
    schema_version: snapshot.schema_version,
    strategy_count: snapshot.summary.strategy_count,
    generated_at: snapshot.generated_at,
  });
}

export async function strategyHealthResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyStrategyHealthPayload("snapshot_unavailable"));

  let snapshot;
  try {
    const stored = await readConfigJson(env, STRATEGY_HEALTH_SNAPSHOT_KEY);
    if (!stored) return json(emptyStrategyHealthPayload("snapshot_unavailable"));
    snapshot = normalizeStrategyHealthSnapshot(stored, STRATEGY_HEALTH_SNAPSHOT_KEY);
  } catch {
    return json(emptyStrategyHealthPayload("snapshot_invalid"));
  }

  const ttlSeconds = strategyHealthStaleTtlSeconds(env);
  const freshnessTimestamps = [snapshot.generated_at, snapshot.computed_at]
    .filter(Boolean)
    .map((value) => Date.parse(value));
  const freshnessAt = freshnessTimestamps.length ? Math.min(...freshnessTimestamps) : Number.NaN;
  const now = Date.now();
  const futureBeyondClockSkew = Number.isFinite(freshnessAt) && freshnessAt > now + 5 * 60 * 1000;
  const ageSeconds = futureBeyondClockSkew
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(freshnessAt)
      ? Math.max(0, (now - freshnessAt) / 1000)
      : Number.POSITIVE_INFINITY;
  if (["ready", "partial"].includes(snapshot.data_status) && ageSeconds > ttlSeconds) {
    snapshot.data_status = "stale";
  }
  return json(snapshot);
}

export async function humanDecisionRequestKey({ requestId, kind, actor, subjectId, materialKey, action, target }) {
  if (requestId !== undefined && requestId !== null && requestId !== "") {
    const text = String(requestId).trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(text)) throw new HttpError("invalid request_id", 400);
    return `id:${kind}:${text}`;
  }
  const digest = await calculateOwnerDecisionSha256({
    actor, kind, subject_id: subjectId, material_key: materialKey, action, target: target || null,
  });
  return `fp:${digest}`;
}

export async function researchPromotionMaterialKey(ticket) {
  return calculateOwnerDecisionSha256({
    ticket_id: ticket.ticket_id,
    strategy_profile: ticket.strategy_profile,
    domain: ticket.domain,
    proposed_params: ticket.proposed_params,
    shadow_passed: ticket.shadow_passed,
    shadow_evidence_kind: ticket.shadow_evidence_kind,
  });
}

// The legacy six-field material key remains the durable terminal index. This
// independent versioned snapshot binds all saved producer review content without
// rekeying historical records or hashing post-decision/observation-only fields.
export function researchPromotionReviewMaterial(ticket) {
  return {
    schema_version: "qsl_promotion_review_material.v2",
    ticket_id: ticket.ticket_id, strategy_profile: ticket.strategy_profile, domain: ticket.domain,
    proposed_params: ticket.proposed_params, shadow_passed: ticket.shadow_passed,
    shadow_evidence_kind: ticket.shadow_evidence_kind,
    drift_status: ticket.drift_status, drift_score: ticket.drift_score,
    budget: ticket.budget, search_iterations: ticket.search_iterations,
    suggested_risk_profile: ticket.suggested_risk_profile,
    notification_subject: ticket.notification_subject, notification_body: ticket.notification_body,
    notes: ticket.notes, research_summary: ticket.research_summary || null,
  };
}
export const RESEARCH_PROMOTION_REVIEW_INVALID = "research_promotion_review_material_invalid";
export class ResearchPromotionReviewMaterialError extends HttpError {
  constructor() { super(RESEARCH_PROMOTION_REVIEW_INVALID, 400); }
}
export async function researchPromotionReviewBinding(ticket) {
  let canonical;
  try {
    canonical = canonicalResearchTaskJson(researchPromotionReviewMaterial(ticket));
  } catch (error) {
    // Only canonical data validation is recoverable per ticket. Hash/storage
    // failures must not be relabelled as invalid material or a healthy queue.
    if (error?.message === "research task must use finite JSON values"
      || error?.message === "research task must use JSON values") throw new ResearchPromotionReviewMaterialError();
    throw error;
  }
  return { schema_version: "qsl_promotion_review_binding.v2", review_sha256: await sha256Hex(canonical) };
}
export function promotionReviewBindingsMatch(left, right) {
  return left?.schema_version === "qsl_promotion_review_binding.v2" && right?.schema_version === left.schema_version
    && /^[0-9a-f]{64}$/.test(left.review_sha256) && left.review_sha256 === right.review_sha256;
}
export function promotionMaterialReviewBinding(row) {
  try {
    const binding = JSON.parse(row?.summary_json || "{}").review_binding;
    return promotionReviewBindingsMatch(binding, binding) ? { schema_version: "qsl_promotion_review_binding.v2", review_sha256: binding.review_sha256 } : null;
  } catch { return null; }
}

export async function recoveryDecisionMaterialKey(recovery) {
  if (recovery.mode === "initial_enrollment") return calculateOwnerDecisionSha256({
    mode: recovery.mode, recovery_id: recovery.recovery_id,
    candidate_sha256: recovery.candidate?.candidate_sha256 || recovery.candidate_sha256,
    facts_sha256: recovery.candidate?.facts_sha256 || recovery.facts_sha256,
  });
  return calculateOwnerDecisionSha256({
    recovery_id: recovery.recovery_id,
    candidate_sha256: recovery.candidate_sha256,
    dual_review_binding_sha256: recovery.dual_review.evidence_binding_sha256,
  });
}

export async function mirrorConfigJson(env, key, value) {
  try {
    await writeConfigJson(env, key, value);
    return true;
  } catch {
    return false;
  }
}

export async function readLegacyConfig(env, key) {
  try {
    return { value: await readConfigJson(env, key), blocked: false, unreadable: false };
  } catch (error) {
    if (String(error?.message || "").includes("must be valid JSON")) return { value: null, blocked: true, unreadable: false };
    return { value: null, blocked: false, unreadable: true };
  }
}

export function humanDecisionTimestamp(value) {
  return String(value || new Date().toISOString()).replace(/\.\d{3}Z$/, "Z");
}

// Actionable material expires when the evidence that produced it would itself be
// stale. A missing or future-dated anchor yields null, which callers treat as
// "not actionable" rather than inventing authority.
export { controlPlaneDecisionExpiryAt };

export { reconciliationRecoveryDecisionExpiryAt };

export async function publishHumanOwnerMaterials(env, snapshot, sourceId) {
  const ownerCandidates = (snapshot.candidates || []).filter(isOwnerDecisionCandidate);
  if (!ownerCandidates.length && !hasRuntimeInstanceStore(env)) return { ok: true, skipped: true };
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const expiresAtMs = controlPlaneDecisionExpiryAt(snapshot, controlPlaneStaleTtlSeconds(env));
  const grouped = new Map();
  for (const candidate of ownerCandidates) {
    const list = grouped.get(candidate.candidate_id) || [];
    list.push(candidate);
    grouped.set(candidate.candidate_id, list);
  }
  const materials = [];
  const duplicateSubjectIds = [];
  for (const [subjectId, list] of grouped) {
    if (list.length > 1) duplicateSubjectIds.push(subjectId);
    const candidate = list[0];
    const materialKey = await ownerDecisionCandidateEvidenceSha256(candidate);
    const legacyRead = await readLegacyConfig(env, ownerDecisionCurrentKey(subjectId));
    if (legacyRead.unreadable) throw new HttpError("human_decision_legacy_unreadable", 503);
    let legacy = null;
    if (legacyRead.blocked) legacy = { blocked: true };
    else if (legacyRead.value) {
      try {
        const intent = await normalizeOwnerDecisionIntent(legacyRead.value, ownerDecisionCurrentKey(subjectId));
        if (intent.candidate_id !== subjectId || intent.candidate_evidence_sha256 !== materialKey) legacy = { blocked: true };
        else {
          legacy = {
            record: {
              action: intent.decision,
              actor: intent.decided_by,
              decided_at: intent.decided_at,
              material_key: materialKey,
              target_json: canonicalResearchTaskJson({ decision: intent.decision }),
              payload: intent,
            },
          };
        }
      } catch {
        legacy = { blocked: true };
      }
    }
    materials.push({
      subject_id: subjectId,
      material_key: materialKey,
      summary_json: JSON.stringify({ candidate_id: subjectId }),
      eligible: list.length === 1 && candidate.freshness?.status === "fresh",
      expires_at_ms: expiresAtMs,
      legacy,
    });
  }
  return runtimeInstanceCommand(env, {
    action: "owner_sync_materials",
    actor: "control-plane-sync",
    source_id: sourceId,
    updated_at: humanDecisionTimestamp(),
    now_ms: Date.now(),
    replace_source: true,
    materials,
    duplicate_subject_ids: duplicateSubjectIds,
  });
}

export function recoveryMaterialEligible(recovery, sourceFreshness, evidenceFreshness) {
  if (recovery.mode === "initial_enrollment") return sourceFreshness?.data_status === "ready" && evidenceFreshness?.data_status === "ready"
    && Object.values(recovery.candidate.coverage).every(status => status === "complete");
  return sourceFreshness?.data_status === "ready"
    && evidenceFreshness?.data_status === "ready"
    && recovery.readiness === "awaiting_human_confirmation"
    && recovery.reconciliation_state === "RECONCILE_ONLY"
    && !recovery.blocker_codes.length
    && recovery.dual_review.evidence_binding_sha256 === recovery.candidate_sha256
    && recovery.evidence_sample_count >= 1;
}

export async function publishHumanRecoveryMaterials(env, source) {
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const ttlSeconds = reconciliationRecoveryStaleTtlSeconds(env);
  const now = Date.now();
  const sourceFreshness = controlPlaneSnapshotFreshness(source, ttlSeconds, now);
  const grouped = new Map();
  for (const recovery of source.recoveries || []) {
    const list = grouped.get(recovery.recovery_id) || [];
    list.push(recovery);
    grouped.set(recovery.recovery_id, list);
  }
  const materials = [];
  const duplicateSubjectIds = [];
  for (const [subjectId, list] of grouped) {
    if (list.length > 1) duplicateSubjectIds.push(subjectId);
    const recovery = list[0];
    const evidenceFreshness = reconciliationRecoveryEvidenceFreshness(recovery, sourceFreshness, ttlSeconds, now);
    const materialKey = await recoveryDecisionMaterialKey(recovery);
    const legacyRead = recovery.mode === "initial_enrollment" ? { unreadable: false, blocked: false, value: null }
      : await readLegacyConfig(env, reconciliationRecoveryConfirmationCurrentKey(subjectId));
    if (legacyRead.unreadable) throw new HttpError("human_decision_legacy_unreadable", 503);
    let legacy = null;
    if (legacyRead.blocked) legacy = { blocked: true };
    else if (legacyRead.value) {
      try {
        const confirmation = await normalizeReconciliationRecoveryConfirmation(legacyRead.value, reconciliationRecoveryConfirmationCurrentKey(subjectId));
        if (confirmation.recovery_id !== subjectId || confirmation.candidate_sha256 !== recovery.candidate_sha256 || confirmation.dual_review_binding_sha256 !== recovery.dual_review.evidence_binding_sha256) {
          legacy = { blocked: true };
        } else {
          legacy = {
            record: {
              action: "approve",
              actor: confirmation.confirmed_by,
              decided_at: confirmation.confirmed_at,
              material_key: materialKey,
              target_json: canonicalResearchTaskJson({ decision: "approve" }),
              payload: confirmation,
            },
          };
        }
      } catch {
        legacy = { blocked: true };
      }
    }
    materials.push({
      subject_id: subjectId,
      material_key: materialKey,
      summary_json: JSON.stringify({ recovery_id: subjectId }),
      eligible: list.length === 1 && recoveryMaterialEligible(recovery, sourceFreshness, evidenceFreshness),
      expires_at_ms: reconciliationRecoveryDecisionExpiryAt(recovery, source, ttlSeconds, now),
      legacy,
    });
  }
  return runtimeInstanceCommand(env, {
    action: "recovery_sync_materials",
    actor: "reconciliation-recovery-source-sync",
    source_id: source.source_id,
    updated_at: humanDecisionTimestamp(),
    now_ms: Date.now(),
    replace_source: true,
    materials,
    duplicate_subject_ids: duplicateSubjectIds,
  });
}

export async function publishHumanPromotionMaterial(env, ticket, existing) {
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const materialKey = await researchPromotionMaterialKey(ticket);
  let legacy = null;
  if (existing && (existing.state === "human_accepted" || existing.state === "human_rejected")) {
    const existingKey = await researchPromotionMaterialKey(existing);
    const actor = String(existing.human_decision_actor || "").trim();
    if (!actor || !existing.human_decided_at || existingKey !== materialKey) legacy = { blocked: true };
    else {
      legacy = {
        record: {
          action: existing.state === "human_accepted" ? "accept" : "reject",
          actor,
          decided_at: existing.human_decided_at,
          material_key: materialKey,
          target_json: canonicalResearchTaskJson({
            selected_account: existing.selected_account || null,
            confirmation: {
              target_platform: existing.confirmation_target_platform,
              execution_mode: existing.confirmation_execution_mode,
              risk_profile: existing.confirmation_risk_profile,
            },
          }),
          payload: { ticket: existing, selected_account: existing.selected_account || null, proposed_params: existing.proposed_params },
        },
      };
    }
  }
  return runtimeInstanceCommand(env, {
    action: "promotion_sync_materials",
    actor: "research-promotion-ticket-sync",
    source_id: "research-promotion",
    updated_at: humanDecisionTimestamp(),
    now_ms: Date.now(),
    replace_source: false,
    materials: [{
      subject_id: ticket.ticket_id,
      material_key: materialKey,
      summary_json: JSON.stringify({
        ticket_id: ticket.ticket_id,
        strategy_profile: ticket.strategy_profile,
        domain: ticket.domain,
        review_binding: await researchPromotionReviewBinding(ticket),
      }),
      eligible: true,
      expires_at_ms: Date.now() + controlPlaneStaleTtlSeconds(env) * 1000,
      legacy,
    }],
  });
}

// A fixed projection of the durable terminal record, never a request echo or KV fallback.
export async function humanDecisionReceipt(record, expected) {
  const invalid = () => { throw new HttpError("human_decision_receipt_unavailable", 503); };
  const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  const actions = { owner: ["approve_limited_live_canary", "keep_parked"], recovery: ["approve", "reject"], promotion: ["accept", "reject"] };
  if (!record || !actions[record.kind]?.includes(record.action) || !text(record.subject_id, 256)
    || !/^[0-9a-f]{64}$/.test(record.material_key) || !text(record.actor, 100)
    || !text(record.decided_at, 40) || !Number.isFinite(Date.parse(record.decided_at))
    || record.kind !== expected.kind || record.subject_id !== expected.subject_id || record.material_key !== expected.material_sha256) invalid();
  let target;
  try { target = JSON.parse(record.target_json); } catch { invalid(); }
  let projection;
  if (record.kind === "promotion") {
    const account = target?.selected_account;
    const confirmation = target?.confirmation;
    if (account != null && (!SUPPORTED_PLATFORMS.includes(account.platform) || !text(account.key, 128))) invalid();
    if (confirmation != null && (!SUPPORTED_PLATFORMS.includes(confirmation.target_platform)
      || !["live", "paper", "dry_run"].includes(confirmation.execution_mode)
      || !RESEARCH_PROMOTION_RISK_PROFILES.includes(confirmation.risk_profile))) invalid();
    if (record.action === "accept" && (!account || !confirmation || account.platform !== confirmation.target_platform)) invalid();
    if (record.payload?.ticket?.live_authority_granted !== false || record.payload?.ticket?.human_decision !== record.action
      || record.payload?.ticket?.ticket_id !== record.subject_id || record.payload.ticket.human_decided_at !== record.decided_at
      || await researchPromotionMaterialKey(record.payload.ticket) !== record.material_key
      || canonicalResearchTaskJson(record.payload.selected_account ?? null) !== canonicalResearchTaskJson(account ?? null)
      || canonicalResearchTaskJson(record.payload.confirmation ?? null) !== canonicalResearchTaskJson(confirmation ?? null)) invalid();
    projection = {
      selected_account: account ? { platform: account.platform, key: account.key } : null,
      confirmation: confirmation ? { target_platform: confirmation.target_platform, execution_mode: confirmation.execution_mode, risk_profile: confirmation.risk_profile } : null,
    };
  } else {
    if (target?.decision !== record.action || record.payload?.no_order !== true || record.payload?.execution_authority_granted !== false) invalid();
    const payload = record.payload;
    if (record.kind === "owner") {
      if (payload.schema_version !== "qsl_owner_decision_intent.v1" || payload.candidate_id !== record.subject_id
        || payload.candidate_evidence_sha256 !== record.material_key || payload.decision !== record.action
        || payload.decided_by !== record.actor || payload.decided_at !== record.decided_at
        || payload.decision_sha256 !== await calculateOwnerDecisionSha256(payload)) invalid();
    } else if (payload.mode === "initial_enrollment") {
      const approval = record.action === "approve";
      if (payload.schema_version !== (approval ? "qsl_initial_enrollment_confirmation.v1" : "qsl_initial_enrollment_rejection.v1")
        || payload.recovery_id !== record.subject_id || (approval ? payload.confirmed_by : payload.decided_by) !== record.actor
        || (approval ? payload.confirmed_at : payload.decided_at) !== record.decided_at || (!approval && payload.decision !== "reject")
        || (approval && payload.confirmation_sha256 !== await calculateReconciliationRecoveryConfirmationSha256(payload))
        || await recoveryDecisionMaterialKey(payload) !== record.material_key) invalid();
    } else {
      const approval = record.action === "approve";
      if (payload.schema_version !== (approval ? "qsl_reconciliation_recovery_confirmation.v1" : "qsl_reconciliation_recovery_rejection.v1")
        || payload.recovery_id !== record.subject_id || (approval ? payload.confirmed_by : payload.decided_by) !== record.actor
        || (approval ? payload.confirmed_at : payload.decided_at) !== record.decided_at || (!approval && payload.decision !== "reject")
        || await recoveryDecisionMaterialKey({ recovery_id: payload.recovery_id, candidate_sha256: payload.candidate_sha256, dual_review: { evidence_binding_sha256: payload.dual_review_binding_sha256 } }) !== record.material_key) invalid();
    }
    projection = { decision: target.decision };
  }
  // Extra stored target fields must not be silently dropped into an apparently matching receipt.
  if (canonicalResearchTaskJson(target) !== canonicalResearchTaskJson(projection)) invalid();
  let reviewBinding = null;
  if (record.kind === "promotion" && record.payload?.review_binding !== undefined) {
    const material = record.payload.review_material;
    if (material?.schema_version !== "qsl_promotion_review_material.v2" || material.ticket_id !== record.subject_id
      || await researchPromotionMaterialKey(material) !== record.material_key
      || !promotionReviewBindingsMatch(record.payload.review_binding, { schema_version: "qsl_promotion_review_binding.v2", review_sha256: await calculateOwnerDecisionSha256(material) })) invalid();
    reviewBinding = { schema_version: "qsl_promotion_review_binding.v2", review_sha256: record.payload.review_binding.review_sha256 };
  }
  const receipt = {
    schema_version: reviewBinding ? "qsl_human_decision_receipt.v2" : "qsl_human_decision_receipt.v1",
    ...(reviewBinding ? { review_binding: reviewBinding } : {}),
    kind: record.kind, subject_id: record.subject_id, material_sha256: record.material_key,
    action: record.action, target: projection, decided_at: record.decided_at, decided_by: record.actor,
    no_order: true, execution_authority_granted: false,
  };
  return { ...receipt, receipt_sha256: await calculateOwnerDecisionSha256(receipt) };
}

export async function exactHumanDecisionResponse(request, env, session, kind) {
  const params = new URL(request.url).searchParams;
  if (!params.has("decision_subject_id") && !params.has("decision_material_sha256")) return null;
  requireSameOrigin(request);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  const subjectId = params.get("decision_subject_id");
  const material = params.get("decision_material_sha256");
  if (params.getAll("decision_subject_id").length !== 1 || params.getAll("decision_material_sha256").length !== 1
    || !subjectId || subjectId.length > 256 || /[\u0000-\u001f\u007f]/.test(subjectId) || !/^[0-9a-f]{64}$/.test(material || "")) {
    return json({ ok: false, error: "human_decision_lookup_invalid" }, 400);
  }
  try {
    if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
    const result = await runtimeInstanceCommand(env, {
      action: `${kind}_read`, actor: session.login, subject_id: subjectId, exact_material_key: material, now_ms: Date.now(),
    });
    if (result.ok !== true || result.exact_material_key !== material || !Object.prototype.hasOwnProperty.call(result, "decision")) {
      throw new HttpError("human_decision_receipt_unavailable", 503);
    }
    const receipt = result.decision === null ? null : await humanDecisionReceipt(result.decision, { kind, subject_id: subjectId, material_sha256: material });
    return json({ ok: true, decision_readback: {
      schema_version: "qsl_human_decision_readback.v1", source: "durable_human_decision_record",
      kind, subject_id: subjectId, requested_material_sha256: material, observed_at: new Date().toISOString(),
      lookup_status: receipt ? "found" : "not_found", receipt, current_material: result.current_material,
    } });
  } catch {
    // Unreadable authority is never reported as a completed empty lookup.
    return json({ ok: false, error: "human_decision_receipt_unavailable" }, 503);
  }
}

export async function readHumanDecisionAuthority(env, kind, subjectId) {
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  return runtimeInstanceCommand(env, { action: `${kind}_read`, actor: `${kind}-decision-read`, subject_id: subjectId });
}

// A safe projection of durable material authority. It carries only digests and
// server-side expiry; raw provider payloads and credentials never enter a read model.
export function humanDecisionAuthorityView(authority) {
  if (!authority || typeof authority !== "object") return null;
  const materialKey = /^[0-9a-f]{64}$/.test(authority.material_key || "") ? authority.material_key : null;
  const expiresAt = typeof authority.expires_at === "string" && Number.isFinite(Date.parse(authority.expires_at))
    ? authority.expires_at
    : null;
  return {
    material_sha256: materialKey,
    expires_at: expiresAt,
    eligible: typeof authority.eligible === "boolean" ? authority.eligible : null,
    blocked: authority.blocked === true,
    unavailable: authority.migrated === false,
    source: "durable_human_decision_material",
  };
}

export function overlayPromotionDecision(ticket, authority) {
  if (!authority || authority.migrated === false) return ticket;
  const current = authority.eligible === true && authority.blocked !== true ? authority.decision : null;
  if (current?.payload?.ticket && (current.action === "accept" || current.action === "reject")) {
    return normalizeResearchPromotionTicket(current.payload.ticket, "human decision ticket");
  }
  if (ticket.state !== "human_accepted" && ticket.state !== "human_rejected") return ticket;
  return normalizeResearchPromotionTicket({
    ...ticket,
    state: "awaiting_human",
    human_decision: "",
    human_decided_at: "",
    confirmation_target_platform: "",
    confirmation_execution_mode: "",
    confirmation_risk_profile: "",
  }, "human decision ticket");
}

export async function promotionTicketWithAuthority(env, ticket) {
  const authority = await readHumanDecisionAuthority(env, "promotion", ticket.ticket_id);
  return overlayPromotionDecision(ticket, authority);
}

function controlPlaneRuntimeDeps() {
  return {
    readBoundedJson,
    publishHumanOwnerMaterials,
    appendAuditLog,
  };
}

export async function syncControlPlaneResponse(request, env) {
  return syncControlPlaneResponseImpl(request, env, controlPlaneRuntimeDeps());
}

export async function syncControlPlaneSourceResponse(request, env) {
  return syncControlPlaneSourceResponseImpl(request, env, controlPlaneRuntimeDeps());
}

export async function controlPlaneResponse(request, env) {
  return controlPlaneResponseImpl(request, env);
}

export async function currentControlPlanePayload(env) {
  return currentControlPlanePayloadImpl(env);
}

export { isOwnerDecisionCandidate };

export {
  currentOwnerDecisionCandidate,
  normalizeOwnerDecisionRequest,
  ownerDecisionCandidateEvidenceSha256,
  buildOwnerDecisionIntent,
  calculateOwnerDecisionSha256,
  ownerDecisionArchiveKey,
  ownerDecisionCurrentKey,
  emptyOwnerDecisionQueue,
};

export async function normalizeOwnerDecisionIntent(payload, fieldName) {
  return normalizeOwnerDecisionIntentImpl(payload, fieldName);
}

export async function readOwnerDecisionIntent(env, candidateId, materialKey) {
  return readOwnerDecisionIntentImpl(env, candidateId, materialKey, {
    readHumanDecisionAuthority,
    humanDecisionAuthorityView,
  });
}

export async function ownerDecisionQueueResponse(request, env) {
  return ownerDecisionQueueResponseImpl(request, env, {
    json,
    readSession,
    exactHumanDecisionResponse,
    hasConfigStore,
    currentControlPlanePayload,
    isOwnerDecisionCandidate,
    ownerDecisionCandidateEvidenceSha256,
    readOwnerDecisionIntent,
    emptyOwnerDecisionQueue,
    uniqueStrings,
    OWNER_DECISION_MAX_CANDIDATES,
    OWNER_DECISION_QUEUE_SCHEMA_VERSION,
  });
}

export async function recordOwnerDecisionResponse(request, env) {
  return recordOwnerDecisionResponseImpl(request, env, {
    json,
    requireSameOrigin,
    readSession,
    hasConfigStore,
    readBoundedJson,
    normalizeOwnerDecisionRequest,
    currentControlPlanePayload,
    currentOwnerDecisionCandidate,
    ownerDecisionCandidateEvidenceSha256,
    humanDecisionTimestamp,
    buildOwnerDecisionIntent,
    canonicalResearchTaskJson,
    humanDecisionRequestKey,
    runtimeInstanceCommand,
    humanDecisionReceipt,
    mirrorConfigJson,
    ownerDecisionArchiveKey,
    ownerDecisionCurrentKey,
    appendAuditLog,
  });
}

// Recovery snapshots contain digest-bound review metadata. Initial enrollment
// additionally carries bounded broker facts for the authenticated review;
// raw receipts remain in the platform's protected source, and confirmation
// records intent without granting execution authority.
export async function initialEnrollmentAccountOption(env, item) {
  if (!await initialEnrollmentBindingsMatch(item.candidate, item.facts)
      || item.candidate.platform_id.toLowerCase() !== "ibkr"
      || item.facts.observed_at !== item.candidate.first_observed_at
      || item.facts.observed_at !== item.candidate.last_observed_at) throw new HttpError("initial_enrollment_invalid", 409);
  const config = await loadAccountOptionsConfig(env);
  const configured = await loadAccountFactsBindings(env, { propagateReadErrors: true });
  const bindings = (configured?.bindings || []).filter(binding => binding.platform === "ibkr" && binding.target_id === item.target_id);
  const options = (config.options?.ibkr || []).filter(option => bindings.length === 1 && option.key === bindings[0].account_key);
  if (options.length !== 1 || bindings.length !== 1 || !accountFactsOptionMatchesBinding(options[0], bindings[0])
      || await initialEnrollmentDigest({ account_ids: [bindings[0].account_selector] }, true) !== item.candidate.account_scope_sha256) {
    throw new HttpError("initial_enrollment_identity_mismatch", 409);
  }
  return options[0];
}

function reconciliationRecoveryRuntimeDeps() {
  return {
    readBoundedJson,
    publishHumanRecoveryMaterials,
    appendAuditLog,
    initialEnrollmentAccountOption,
    exactHumanDecisionResponse,
    recoveryDecisionMaterialKey,
    humanDecisionTimestamp,
    humanDecisionRequestKey,
    humanDecisionReceipt,
    runtimeInstanceCommand,
    mirrorConfigJson,
    readHumanDecisionAuthority,
    humanDecisionAuthorityView,
    controlPlaneSnapshotFreshness,
    earliestControlPlaneTimestamp,
  };
}

export async function syncReconciliationRecoverySourceResponse(request, env) {
  return syncReconciliationRecoverySourceResponseImpl(request, env, reconciliationRecoveryRuntimeDeps());
}

export async function reconciliationRecoveryResponse(request, env) {
  return reconciliationRecoveryResponseImpl(request, env, {
    exactHumanDecisionResponse,
    aggregateReconciliationRecoverySources,
  });
}

export async function syncBinancePrivateScopeResponse(request, env) {
  requireDedicatedReconciliationRecoverySyncToken(request, env);
  const store = configStore(env);
  if (!store) {
    return json({ ok: false, error: "binance_private_scope_storage_unavailable" }, 503);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, BINANCE_PRIVATE_SCOPE_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: "invalid_binance_private_scope_payload" }, error.status === 413 ? 413 : 400);
  }
  let report;
  try {
    report = normalizeBinancePrivateScopeReport(raw, { requireIngestFreshness: true });
  } catch {
    return json({ ok: false, error: "invalid_binance_private_scope_payload" }, 400);
  }
  try {
    await store.put(BINANCE_PRIVATE_SCOPE_KEY, JSON.stringify(report), {
      expirationTtl: BINANCE_PRIVATE_SCOPE_WRITE_TTL_SECONDS,
    });
  } catch {
    return json({ ok: false, error: "binance_private_scope_storage_unavailable" }, 503);
  }
  return json({
    ok: true,
    observed_at: report.observed_at,
    source_run_id: report.source_run_id,
    asset_count: report.assets.length,
  });
}

export async function trustedBinanceFactsBinding(env, readiness = null) {
  const text = String(env.BINANCE_ACCOUNT_FACTS_BINDING_JSON || "");
  if (!text) return null;
  let binding;
  try { binding = normalizeBinanceFactsBinding(JSON.parse(text)); }
  catch { throw new BinanceFactsError("binance_account_facts_binding_invalid", 503); }
  await assertBinanceFactsSourceBinding(binding);
  if (readiness) readiness.binding_valid = true;
  let config;
  try { config = await loadAccountOptionsConfig(env); }
  catch {
    throw new BinanceFactsError("binance_account_facts_account_options_unavailable", 503);
  }
  if (readiness) readiness.account_options_readable = true;
  const options = config.options?.binance || [];
  const matchCount = options.filter(option => binanceFactsOptionMatches(option, binding)).length;
  if (matchCount !== 1) {
    throw new BinanceFactsError("binance_account_facts_binding_unmatched", 409);
  }
  if (readiness) readiness.unique_match = true;
  return binding;
}

export function binanceFactsErrorResponse(error) {
  return json({ ok: false, error: error instanceof BinanceFactsError
    ? error.code : "binance_account_facts_unavailable" }, error instanceof BinanceFactsError ? error.status : 503);
}

export function binanceFactsSyncAuthorizationResponse(request, env) {
  const token = String(env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN || "");
  const otherTokens = ["ACCOUNT_FACTS_SYNC_TOKEN", "IBKR_ACCOUNT_FACTS_SYNC_TOKEN", "SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN", "FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN",
    "RECONCILIATION_RECOVERY_SYNC_TOKEN", "RECONCILIATION_RECOVERY_CONTROLLER_TOKEN", "STRATEGY_SWITCH_SYNC_TOKEN"];
  if (!token || otherTokens.some(name => env[name] && env[name] === token)) {
    return json({ ok: false, error: "binance_account_facts_token_unavailable" }, 503);
  }
  if ((request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] !== token) {
    return json({ ok: false, error: "binance_account_facts_token_invalid" }, 401);
  }
  return null;
}

export async function binanceDigestSnapshotResponse(request, env, url) {
  const token = env.BINANCE_DIGEST_READ_TOKEN;
  const otherTokens = ["BINANCE_ACCOUNT_FACTS_SYNC_TOKEN", "ACCOUNT_FACTS_SYNC_TOKEN", "IBKR_ACCOUNT_FACTS_SYNC_TOKEN",
    "SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN", "FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN", "RECONCILIATION_RECOVERY_SYNC_TOKEN",
    "RECONCILIATION_RECOVERY_CONTROLLER_TOKEN", "STRATEGY_SWITCH_SYNC_TOKEN", "SESSION_SECRET"];
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(token)
      || otherTokens.some(name => env[name] === token)) {
    return json({ ok: false, error: "digest_snapshot_read_unavailable" }, 503);
  }
  if (request.headers.get("Authorization") !== `Bearer ${token}`) {
    return json({ ok: false, error: "digest_snapshot_read_unauthorized" }, 401);
  }
  const day = url.searchParams.get("business_day");
  const start = Date.parse(`${day}T06:00:00+08:00`);
  const end = start + 86400000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || !Number.isFinite(start)
      || new Date(start + 8 * 3600000).toISOString().slice(0, 10) !== day || end > Date.now()) {
    return json({ ok: false, error: "digest_snapshot_window_invalid" }, 400);
  }
  try {
    const binding = await trustedBinanceFactsBinding(env);
    if (!binding || !configStore(env)) throw new Error("digest_snapshot_read_unavailable");
    const retained = await runtimeInstanceCommand(env, {
      action: "binance_detail_read", binding, date: day, business_day: true,
    });
    if (retained?.ok !== true) throw new Error("digest_snapshot_read_unavailable");
    // The existing latest cache can supply a snapshot from before this
    // retention path was released, provided it still matches the window.
    const raw = retained.report ?? await readConfigJson(env, `${BINANCE_FACTS_KEY}:${binding.source_binding.id}`);
    if (!raw) return json({ ok: false, error: "digest_snapshot_missing" }, 404);
    const report = normalizeBinanceAccountFacts(raw, binding);
    const observedFrom = Date.parse(report.observed_started_at);
    const observedUntil = Date.parse(report.observed_finished_at);
    if (observedFrom < start || observedUntil >= end) {
      return json({ ok: false, error: "digest_snapshot_missing" }, 404);
    }
    const valuation = report.wallet_valuation;
    const wallet = url.searchParams.get("include_valuation") === "1" && valuation?.status === "available"
      ? { wallet_valuation: {
          amount: valuation.amount, currency: valuation.currency, as_of: valuation.observed_at,
        } }
      : {};
    return json({ ok: true, business_day: day, account_key: binding.account_key,
      target_id: binding.target_id, as_of: report.observed_finished_at,
      holdings: report.assets.map(({ asset, quantity }) => ({ asset, quantity })), ...wallet });
  } catch {
    return json({ ok: false, error: "digest_snapshot_read_unavailable" }, 503);
  }
}

export async function binanceAccountFactsReadinessResponse(request, env) {
  const authError = binanceFactsSyncAuthorizationResponse(request, env);
  if (authError) return authError;
  const readiness = { binding_valid: false, account_options_readable: false, unique_match: false };
  try {
    const binding = await trustedBinanceFactsBinding(env, readiness);
    if (!binding) throw new BinanceFactsError("binance_account_facts_binding_missing", 503);
    return json({ ok: true, ready: true, ...readiness });
  } catch (error) {
    return json({ ok: false, ready: false, ...readiness,
      error: error instanceof BinanceFactsError ? error.code : "binance_account_facts_unavailable" },
    error instanceof BinanceFactsError ? error.status : 503);
  }
}

export async function syncBinanceAccountFactsResponse(request, env) {
  const authError = binanceFactsSyncAuthorizationResponse(request, env);
  if (authError) return authError;
  try {
    const binding = await trustedBinanceFactsBinding(env);
    if (!binding) throw new BinanceFactsError("binance_account_facts_binding_missing", 503);
    const raw = await readBoundedJson(request, BINANCE_FACTS_MAX_BYTES);
    const report = normalizeBinanceAccountFacts(raw, binding, { ingest: true });
    const store = configStore(env);
    if (!store) throw new BinanceFactsError("binance_account_facts_storage_unavailable", 503);
    if (!hasRuntimeInstanceStore(env)) throw new BinanceFactsError("binance_account_facts_history_storage_unavailable", 503);
    const storageKey = `${BINANCE_FACTS_KEY}:${binding.source_binding.id}`;
    const previous = await readConfigJson(env, storageKey);
    let unchanged = false;
    if (previous) {
      const validPrevious = normalizeBinanceAccountFacts(previous, binding);
      const incomingTime = Date.parse(report.observed_finished_at);
      const previousTime = Date.parse(validPrevious.observed_finished_at);
      if (incomingTime < previousTime || (incomingTime === previousTime
          && canonicalJson(report) !== canonicalJson(validPrevious))) {
        throw new BinanceFactsError("binance_account_facts_observation_conflict", 409);
      }
      unchanged = incomingTime === previousTime;
    }
    try {
      const detail = await runtimeInstanceCommand(env, {
        action: "binance_detail_put", binding, report, date: report.observed_finished_at.slice(0, 10),
      });
      if (detail.readback_verified !== true) throw new Error("binance_detail_readback_failed");
      const history = binanceWalletHistoryEntry(report, binding);
      await runtimeInstanceCommand(env, {
        action: "binance_wallet_history_put",
        account_key: binding.account_key,
        storage_account_key: binanceWalletHistoryStorageKey(binding),
        target_id: binding.target_id,
        account_scope: binding.account_scope,
        source_binding_id: binding.source_binding.id,
        history,
      });
    } catch {
      throw new BinanceFactsError("binance_account_facts_history_storage_unavailable", 503);
    }
    if (unchanged) return json({ ok: true, status: "unchanged" });
    await store.put(storageKey, JSON.stringify(report), { expirationTtl: 2 * 24 * 60 * 60 });
    return json({ ok: true, status: "published", observed_finished_at: report.observed_finished_at,
      asset_count: report.assets.length });
  } catch (error) {
    if (error?.status === 413) return json({ ok: false, error: "binance_account_facts_payload_too_large" }, 413);
    return binanceFactsErrorResponse(error);
  }
}

export async function binanceDetailArchiveResponse(request, env, url) {
  const authError = binanceFactsSyncAuthorizationResponse(request, env);
  if (authError) return authError;
  try {
    const binding = await trustedBinanceFactsBinding(env);
    if (!binding) throw new Error("binding_missing");
    const result = await runtimeInstanceCommand(env, {
      action: "binance_detail_read", binding, date: url.searchParams.get("date"),
    });
    return json(result, result.report ? 200 : 404);
  } catch {
    return json({ ok: false, error: "binance_detail_archive_unavailable" }, 503);
  }
}

export async function binanceWalletHistoryResponse(request, env, url) {
  if (!accountFactsReadModelEnabled(env)) return accountFactsDisabledResponse();
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasRuntimeInstanceStore(env)) return json({ ok: false, error: "account_facts_store_unavailable" }, 503);
  try {
    const binding = await trustedBinanceFactsBinding(env);
    if (!binding) throw new BinanceFactsError("binance_account_facts_binding_missing", 503);
    if (url.searchParams.get("account_key") !== binding.account_key) {
      throw new BinanceFactsError("binance_account_facts_binding_unmatched", 409);
    }
    let historicalBindings;
    try {
      const encoded = String(env.BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON || "[]");
      historicalBindings = await assertBinanceFactsHistoryBindings(JSON.parse(encoded), binding);
    } catch {
      throw new BinanceFactsError("binance_account_facts_history_bindings_invalid", 503);
    }
    const buckets = [];
    for (const sourceBinding of [binding, ...historicalBindings]) {
      const stored = await runtimeInstanceCommand(env, {
        action: "binance_wallet_history_read",
        account_key: binding.account_key,
        storage_account_key: binanceWalletHistoryStorageKey(sourceBinding),
        target_id: binding.target_id,
        account_scope: binding.account_scope,
        source_binding_id: sourceBinding.source_binding.id,
      });
      buckets.push({ binding: sourceBinding, days: Array.isArray(stored.days) ? stored.days : [] });
    }
    return json(projectBinanceWalletHistoryFromSources(buckets, binding, historicalBindings));
  } catch (error) {
    const allowedErrors = new Set([
      "binance_account_facts_binding_invalid", "binance_account_facts_account_options_unavailable",
      "binance_account_facts_binding_unmatched", "binance_account_facts_binding_missing",
      "binance_wallet_history_identity_mismatch", "binance_wallet_history_stored_invalid",
      "binance_wallet_history_conflict", "binance_account_facts_history_bindings_invalid",
    ]);
    const code = allowedErrors.has(error?.code || error?.message)
      ? (error.code || error.message) : "binance_wallet_history_unavailable";
    return json({ ok: false, error: code }, error?.status || 503);
  }
}

export async function binanceAccountFactsResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  try {
    const binding = await trustedBinanceFactsBinding(env);
    if (!binding) return json({ ok: true, report_status: "unavailable", report: null });
    const raw = await readConfigJson(env, `${BINANCE_FACTS_KEY}:${binding.source_binding.id}`);
    if (!raw) return json({ ok: true, report_status: "missing", report: null });
    const report = projectBinanceAccountFacts(raw, binding);
    if (!report) return json({ ok: true, report_status: "expired", report: null });
    return json({ ok: true, report_status: "available", report });
  } catch { return json({ ok: true, report_status: "unavailable", report: null }); }
}

export async function binancePrivateScopeResponse(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.allowed || !session.admin) return json({ ok: false, error: "admin required" }, 403);
  if (!hasConfigStore(env)) return json({ ok: true, report: null });
  try {
    const raw = await readConfigJson(env, BINANCE_PRIVATE_SCOPE_KEY);
    if (!raw) return json({ ok: true, report: null });
    const report = normalizeBinancePrivateScopeReport(raw);
    const ageMs = Date.now() - Date.parse(report.observed_at);
    if (ageMs > BINANCE_PRIVATE_SCOPE_READ_MAX_AGE_MS || ageMs < -BINANCE_PRIVATE_SCOPE_FUTURE_SKEW_MS) {
      return json({ ok: true, report: null });
    }
    return json({ ok: true, report });
  } catch {
    return json({ ok: true, report: null });
  }
}

// This is a least-privilege service-to-service read for a platform-owned
// controller.  It deliberately returns only the current, redacted digest
// binding and immutable human receipt; broker state remains in the platform.
export async function reconciliationRecoveryControllerReadResponse(request, env, url) {
  return reconciliationRecoveryControllerReadResponseImpl(request, env, url, {
    aggregateReconciliationRecoverySources,
  });
}

export { currentReconciliationRecoveryRequest };
export { normalizeReconciliationRecoveryConfirmationRequest };
export { calculateReconciliationRecoveryConfirmationSha256 };
export { buildReconciliationRecoveryConfirmation };
export { normalizeReconciliationRecoveryConfirmation };
export { reconciliationRecoveryConfirmationArchiveKey };
export { reconciliationRecoveryConfirmationCurrentKey };

export async function readReconciliationRecoveryConfirmation(env, recoveryId) {
  return readReconciliationRecoveryConfirmationImpl(env, recoveryId, {
    readHumanDecisionAuthority,
    humanDecisionAuthorityView,
  });
}

export async function recordReconciliationRecoveryConfirmationResponse(request, env) {
  return recordReconciliationRecoveryConfirmationResponseImpl(request, env, {
    ...reconciliationRecoveryRuntimeDeps(),
    aggregateReconciliationRecoverySources,
  });
}

export async function aggregateReconciliationRecoverySources(env) {
  return aggregateReconciliationRecoverySourcesImpl(env, {
    readReconciliationRecoverySources,
    controlPlaneSnapshotFreshness,
    earliestControlPlaneTimestamp,
    readReconciliationRecoveryConfirmation,
    recoveryDecisionMaterialKey,
    initialEnrollmentAccountOption,
  });
}

export async function readReconciliationRecoverySources(env) {
  return readReconciliationRecoverySourcesImpl(env, {
    initialEnrollmentAccountOption,
  });
}

export { reconciliationRecoverySourceKey };

export function runtimeDailyReadModelEnabled(env) {
  return String(env.RUNTIME_DAILY_READ_MODEL_ENABLED || "") === "true";
}

export function runtimeDailyDisabledResponse() {
  return json({ ok: false, error: "runtime_daily_disabled" }, 404);
}

export function runtimeDailyKey(businessDate, target = RUNTIME_DAILY_TARGET) {
  return `${RUNTIME_DAILY_KEY_PREFIX}${target.target_key}:${businessDate}`;
}

export function runtimeDailyToday(now = Date.now()) {
  return runtimeDailyBusinessDate(now);
}

export function runtimeDailyCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return value;
}

export function runtimeDailyInstant(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[7] !== "Z" && (Number(match[8]) > 23 || Number(match[9]) > 59)) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function runtimeDailyExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function runtimeDailyBoundedText(value, max) {
  if (typeof value !== "string" || !value || value.length > max) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const lowered = value.toLowerCase();
  return !["secret", "token", "password", "bearer", "traceback", "/users/", "/home/"].some((marker) => lowered.includes(marker));
}

export function runtimeDailyChoice(value, allowed) {
  return typeof value === "string" && allowed.includes(value);
}

export function runtimeDailyReject(code) {
  throw new HttpError(code, 400);
}

export function runtimeDailyOptionalInstant(value, observedMs) {
  if (value === null) return null;
  const parsed = runtimeDailyInstant(value);
  if (parsed === null) runtimeDailyReject("invalid_runtime_daily_time");
  if (parsed > observedMs + RUNTIME_DAILY_FUTURE_SKEW_MS) runtimeDailyReject("runtime_daily_future_observation");
  return parsed;
}

export function runtimeDailyScheduleInstants(schedule, observedMs) {
  const latest = schedule.latest_due_at === null ? null : runtimeDailyInstant(schedule.latest_due_at);
  const next = schedule.next_due_at === null ? null : runtimeDailyInstant(schedule.next_due_at);
  const grace = schedule.grace_ends_at === null ? null : runtimeDailyInstant(schedule.grace_ends_at);
  if (schedule.latest_due_at !== null && latest === null) runtimeDailyReject("invalid_runtime_daily_time");
  if (schedule.next_due_at !== null && next === null) runtimeDailyReject("invalid_runtime_daily_time");
  if (schedule.grace_ends_at !== null && grace === null) runtimeDailyReject("invalid_runtime_daily_time");
  // latest_due is the last cron time already reached. next_due and grace_ends are plans.
  if (latest !== null && latest > observedMs + RUNTIME_DAILY_FUTURE_SKEW_MS) runtimeDailyReject("invalid_runtime_daily_time");
  if (next !== null && next <= observedMs) runtimeDailyReject("invalid_runtime_daily_time");
  if (latest !== null && next !== null && next <= latest) runtimeDailyReject("invalid_runtime_daily_time");
  if (latest !== null && grace !== null && grace < latest) runtimeDailyReject("invalid_runtime_daily_time");
}

// These additional constraints describe only the merged Schwab projector. The
// original LongBridge key sets, time tolerance and receipt protocol stay intact.
export function validateSchwabRuntimeDailyRun(run, observedMs, started, finished) {
  const evidence = run.evidence;
  const confirmations = {
    not_due: ["not_applicable"], no_action: ["not_applicable"], no_signal: ["not_applicable"], no_rebalance: ["not_applicable"],
    risk_blocked: ["not_applicable"], submitted: ["not_observed"], broker_acknowledged: ["acknowledged"],
    partially_filled: ["partially_filled"], filled: ["filled"], reconciliation_required: ["reconciliation_required"],
    failed: ["not_applicable", "not_observed", "reconciliation_required"],
  };
  if ((run.run_id !== null && !/^run\.[0-9a-f]{32}$/.test(run.run_id))
    || run.source_object !== null || run.source_objects.length !== 0 || run.object_updated_at !== null
    || run.execution_lane === "paper" || run.run_time_known !== (started !== null || finished !== null)) runtimeDailyReject("invalid_runtime_daily_run");
  if ((started !== null && started > observedMs) || (finished !== null && finished > observedMs)) runtimeDailyReject("invalid_runtime_daily_time");
  if (run.report_status !== null && !["ok", "skipped", "success", "completed", "no_action", "error", "failed", "failure", "cancelled", "canceled", "timed_out"].includes(run.report_status)) runtimeDailyReject("invalid_runtime_daily_run");
  if (evidence.execution_status !== null && !["no_op", "no_action", "no_signal", "no_rebalance", "skipped", "outside_market_hours", "submitted", "pending_reconciliation", "reconciliation_required", "unknown", "unknown_order", "blocked", "risk_blocked", "error", "failed", "failure", "dry_run", "previewed", "partial", "partially_filled", "filled", "completed"].includes(evidence.execution_status)) runtimeDailyReject("invalid_runtime_daily_run");
  if (!runtimeDailyChoice(evidence.receipt_state, ["valid", "missing", "invalid"])) runtimeDailyReject("invalid_runtime_daily_run");
  if (evidence.receipt_state === "valid") {
    if (typeof evidence.receipt_id !== "string" || !/^execution-receipt\.[0-9a-f]{32}$/.test(evidence.receipt_id)
      || started === null || finished === null
      || !Object.prototype.hasOwnProperty.call(confirmations, evidence.receipt_outcome)
      || !confirmations[evidence.receipt_outcome].includes(evidence.receipt_broker_confirmation)) runtimeDailyReject("invalid_runtime_daily_run");
  } else if (evidence.receipt_id !== null || evidence.receipt_outcome !== null || evidence.receipt_broker_confirmation !== null) runtimeDailyReject("invalid_runtime_daily_run");
  const completedReceipt = { no_submission: "no_action", no_signal: "no_signal", no_rebalance: "no_rebalance", filled: "filled" };
  if (Object.prototype.hasOwnProperty.call(completedReceipt, run.activity)
    && (evidence.receipt_state !== "valid" || evidence.receipt_outcome !== completedReceipt[run.activity]
      || !["ok", "skipped", "success", "completed", "no_action"].includes(run.report_status)
      || run.execution_lane !== "live" || runtimeDailyRunIssue(run) !== null)) runtimeDailyReject("runtime_daily_summary_conflict");
  if (["no_submission", "no_signal", "no_rebalance"].includes(run.activity)
    && (evidence.broker_submission_done !== false || evidence.action_done === true || evidence.orders_pending_count !== 0
      || (evidence.execution_status !== null && !["no_op", "no_action", "no_signal", "no_rebalance", "skipped", "outside_market_hours", "completed"].includes(evidence.execution_status)))) runtimeDailyReject("runtime_daily_summary_conflict");
}

export function validateSchwabRuntimeDailySummary(raw, record, runs, observedMs) {
  if (raw.completeness !== (record.completeness === "complete" ? "complete" : "incomplete")) runtimeDailyReject("runtime_daily_summary_conflict");
  const runSignatures = new Map();
  for (const run of runs) {
    if (run.run_id === null) continue;
    const signature = canonicalResearchTaskJson(run);
    const previous = runSignatures.get(run.run_id);
    if (previous !== undefined && previous !== signature && !record.conflicts.includes(run.run_id)) runtimeDailyReject("runtime_daily_summary_conflict");
    runSignatures.set(run.run_id, signature);
  }
  const incomplete = raw.read_errors.length > 0 || record.conflicts.length > 0 || record.schedule.state === "unevaluable"
    || record.excluded_reports.some(item => item.reason !== "other_business_date")
    || runs.some(run => run.run_id === null || run.evidence.receipt_state !== "valid" || !run.run_time_known);
  if (record.completeness === "complete" && incomplete) runtimeDailyReject("runtime_daily_summary_conflict");
  // A run that only finishes after the due time cannot prove that due cycle.
  // This is a receiver invariant of the existing producer, not a new scheduler.
  const latest = runtimeDailyInstant(record.schedule.latest_due_at);
  const covering = latest === null ? [] : runs.filter(run => {
    const started = runtimeDailyInstant(run.started_at), finished = runtimeDailyInstant(run.finished_at);
    return started !== null && finished !== null && started >= latest && finished <= observedMs
      && runtimeDailyToday(started) === record.business_date;
  });
  const quiet = ["no_submission", "no_signal", "no_rebalance"];
  if ([...quiet, "filled", ...RUNTIME_DAILY_SCHEDULE_ONLY].includes(record.status)
    && record.completeness !== "complete") runtimeDailyReject("runtime_daily_summary_conflict");
  if ([...quiet, "filled"].includes(record.status)) {
    if (record.kind !== "run" || covering.length === 0 || covering.some(run => run.execution_lane !== "live")) runtimeDailyReject("runtime_daily_summary_conflict");
    if (quiet.includes(record.status) && (!['due', 'within_grace'].includes(record.schedule.state)
      || covering.some(run => run.activity !== record.status))) runtimeDailyReject("runtime_daily_summary_conflict");
    if (record.status === "filled" && !covering.some(run => run.activity === "filled")) runtimeDailyReject("runtime_daily_summary_conflict");
  }
  if (RUNTIME_DAILY_SCHEDULE_ONLY.includes(record.status)
    && (record.kind !== "schedule" || record.schedule.state !== record.status || covering.length > 0)) runtimeDailyReject("runtime_daily_summary_conflict");
}

export function validateSchwabRuntimeDailySchedule(schedule, observedMs) {
  const { state, reason, publication_grace_ended: ended, expected_window: window } = schedule;
  const latest = schedule.latest_due_at === null ? null : runtimeDailyInstant(schedule.latest_due_at);
  const next = schedule.next_due_at === null ? null : runtimeDailyInstant(schedule.next_due_at);
  const grace = schedule.grace_ends_at === null ? null : runtimeDailyInstant(schedule.grace_ends_at);
  const reasons = { due: ["publication_grace_ended"], within_grace: ["publication_grace_open"],
    not_due: ["before_schedule", "no_cron_on_business_date"], market_closed: ["market_closed"],
    outside_window: ["outside_expected_window"], unevaluable: ["schedule_missing", "schedule_invalid"] };
  if (!reasons[state]?.includes(reason)
    || (latest !== null && (latest > observedMs || runtimeDailyToday(latest) !== schedule.business_date))
    || (next !== null && (next <= observedMs || runtimeDailyToday(next) !== schedule.business_date))) runtimeDailyReject("invalid_runtime_daily_projection");
  let valid;
  if (state === "unevaluable") valid = latest === null && next === null && grace === null && ended === null && window === "unspecified";
  else if (state === "due" || state === "within_grace") valid = latest !== null && grace !== null && next === null && window !== "outside"
    && (state === "due" ? ended === true && grace <= observedMs : ended === false && grace > observedMs);
  else if (state === "not_due") valid = latest === null && grace === null && ended === null && window !== "outside"
    && ((reason === "before_schedule") === (next !== null));
  else if (state === "market_closed") valid = latest !== null && grace === null && ended === null;
  else valid = window === "outside" && ended === null && ((latest === null) === (grace === null)) && !(grace !== null && next !== null);
  if (!valid) runtimeDailyReject("invalid_runtime_daily_projection");
}

export function normalizeRuntimeDailyRun(run, observedMs, target) {
  if (!runtimeDailyExactKeys(run, [
    "run_id", "source_object", "source_objects", "started_at", "finished_at", "object_updated_at",
    "report_status", "execution_lane", "activity", "run_time_known", "evidence",
  ])) runtimeDailyReject("invalid_runtime_daily_run");
  if (run.run_id !== null && !runtimeDailyBoundedText(run.run_id, 120)) runtimeDailyReject("invalid_runtime_daily_run");
  if (run.source_object !== null && !runtimeDailyBoundedText(run.source_object, 512)) runtimeDailyReject("invalid_runtime_daily_run");
  if (!Array.isArray(run.source_objects) || run.source_objects.length > 8 || run.source_objects.some((item) => !runtimeDailyBoundedText(item, 512))) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  const started = runtimeDailyOptionalInstant(run.started_at, observedMs);
  const finished = runtimeDailyOptionalInstant(run.finished_at, observedMs);
  runtimeDailyOptionalInstant(run.object_updated_at, observedMs);
  if (started !== null && finished !== null && finished < started) runtimeDailyReject("invalid_runtime_daily_time");
  if (run.report_status !== null && !runtimeDailyBoundedText(run.report_status, 64)) runtimeDailyReject("invalid_runtime_daily_run");
  if (!runtimeDailyChoice(run.execution_lane, RUNTIME_DAILY_LANES) || !runtimeDailyChoice(run.activity, RUNTIME_DAILY_ACTIVITIES)) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (typeof run.run_time_known !== "boolean") runtimeDailyReject("invalid_runtime_daily_run");
  const evidenceKeys = [
    "execution_status", "broker_submission_done", "action_done", "orders_pending_count", "errors_present",
    "receipt_outcome", "receipt_broker_confirmation",
  ];
  if (target.platform === "schwab") evidenceKeys.push("receipt_state", "receipt_id");
  if (!runtimeDailyExactKeys(run.evidence, evidenceKeys)) runtimeDailyReject("invalid_runtime_daily_run");
  const evidence = run.evidence;
  if (evidence.execution_status !== null && !runtimeDailyBoundedText(evidence.execution_status, 64)) runtimeDailyReject("invalid_runtime_daily_run");
  for (const field of ["broker_submission_done", "action_done"]) {
    if (evidence[field] !== null && typeof evidence[field] !== "boolean") runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (evidence.orders_pending_count !== null && (!Number.isInteger(evidence.orders_pending_count) || evidence.orders_pending_count < 0 || evidence.orders_pending_count > 100000)) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (typeof evidence.errors_present !== "boolean") runtimeDailyReject("invalid_runtime_daily_run");
  for (const field of ["receipt_outcome", "receipt_broker_confirmation"]) {
    if (evidence[field] !== null && !runtimeDailyBoundedText(evidence[field], 64)) runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (target.platform === "schwab") validateSchwabRuntimeDailyRun(run, observedMs, started, finished);
  return {
    run_id: run.run_id,
    source_object: run.source_object,
    source_objects: [...run.source_objects],
    started_at: run.started_at,
    finished_at: run.finished_at,
    object_updated_at: run.object_updated_at,
    report_status: run.report_status,
    execution_lane: run.execution_lane,
    activity: run.activity,
    run_time_known: run.run_time_known,
    evidence: { ...evidence },
  };
}

export function normalizeRuntimeDailyProjection(raw, now = Date.now(), registeredTarget = null) {
  if (!runtimeDailyExactKeys(raw, ["platform", "observed_at", "completeness", "read_errors", "records", "unmatched_reports"])) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  const target = registeredTarget || runtimeDailyTarget(raw.platform);
  if (target && raw.platform !== target.platform) runtimeDailyReject("invalid_runtime_daily_target");
  if (!target || !runtimeDailyChoice(raw.completeness, ["complete", "incomplete"])) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  const observedMs = runtimeDailyInstant(raw.observed_at);
  if (observedMs === null) runtimeDailyReject("invalid_runtime_daily_time");
  if (observedMs > now + RUNTIME_DAILY_FUTURE_SKEW_MS) runtimeDailyReject("runtime_daily_future_observation");
  if (!Array.isArray(raw.read_errors) || raw.read_errors.length > RUNTIME_DAILY_MAX_LIST || raw.read_errors.some((item) => !runtimeDailyBoundedText(item, 120))) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (!Array.isArray(raw.records) || raw.records.length !== 1) runtimeDailyReject("invalid_runtime_daily_target");
  if (!Array.isArray(raw.unmatched_reports) || raw.unmatched_reports.length > RUNTIME_DAILY_MAX_LIST) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  const record = raw.records[0];
  if (!runtimeDailyExactKeys(record, [
    "platform", "target_key", "target", "business_date", "timezone", "observed_at", "status", "kind",
    "completeness", "execution_lane", "schedule", "runs", "excluded_reports", "conflicts", "fills",
  ])) runtimeDailyReject("invalid_runtime_daily_projection");
  if (record.platform !== target.platform || record.target_key !== target.target_key || record.timezone !== RUNTIME_DAILY_TIMEZONE) {
    runtimeDailyReject(record.timezone === RUNTIME_DAILY_TIMEZONE ? "invalid_runtime_daily_target" : "invalid_runtime_daily_timezone");
  }
  if (!runtimeDailyExactKeys(record.target, ["service", "strategy_profile", "account_scope"])) runtimeDailyReject("invalid_runtime_daily_target");
  if (record.target.service !== target.service || record.target.strategy_profile !== target.strategy_profile || record.target.account_scope !== target.account_scope) {
    runtimeDailyReject("invalid_runtime_daily_target");
  }
  const businessDate = runtimeDailyCalendarDate(record.business_date);
  if (!businessDate || businessDate > runtimeDailyToday(now)) runtimeDailyReject("invalid_runtime_daily_date");
  if (target.platform === "schwab" && businessDate > runtimeDailyToday(observedMs)) runtimeDailyReject("invalid_runtime_daily_date");
  if (record.observed_at !== raw.observed_at) runtimeDailyReject("invalid_runtime_daily_time");
  if (!runtimeDailyChoice(record.status, RUNTIME_DAILY_STATUSES) || !runtimeDailyChoice(record.kind, RUNTIME_DAILY_KINDS)) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (!runtimeDailyChoice(record.completeness, ["complete", "incomplete", "insufficient"]) || !runtimeDailyChoice(record.execution_lane, RUNTIME_DAILY_LANES)) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (!runtimeDailyExactKeys(record.schedule, [
    "state", "business_date", "timezone", "latest_due_at", "next_due_at", "grace_ends_at",
    "publication_grace_ended", "expected_window", "reason",
  ])) runtimeDailyReject("invalid_runtime_daily_projection");
  const schedule = record.schedule;
  if (!runtimeDailyChoice(schedule.state, RUNTIME_DAILY_SCHEDULE_STATES) || schedule.business_date !== businessDate || schedule.timezone !== RUNTIME_DAILY_TIMEZONE) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  runtimeDailyScheduleInstants(schedule, observedMs);
  if (schedule.publication_grace_ended !== null && typeof schedule.publication_grace_ended !== "boolean") {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (!runtimeDailyChoice(schedule.expected_window, ["unspecified", "inside", "outside"])) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (schedule.reason !== null && !runtimeDailyBoundedText(schedule.reason, 120)) runtimeDailyReject("invalid_runtime_daily_projection");
  if (target.platform === "schwab") validateSchwabRuntimeDailySchedule(schedule, observedMs);
  if (!Array.isArray(record.runs) || record.runs.length > RUNTIME_DAILY_MAX_RUNS) runtimeDailyReject("runtime_daily_run_limit");
  const runs = record.runs.map((run) => normalizeRuntimeDailyRun(run, observedMs, target));
  if (!Array.isArray(record.excluded_reports) || record.excluded_reports.length > RUNTIME_DAILY_MAX_LIST) runtimeDailyReject("invalid_runtime_daily_projection");
  const excluded = record.excluded_reports.map((item) => {
    const keys = Object.keys(item || {});
    const allowed = keys.length === 3 ? ["run_id", "reason", "business_date"] : ["run_id", "reason"];
    if (!runtimeDailyExactKeys(item, allowed) || !runtimeDailyBoundedText(item.reason, 64)) runtimeDailyReject("invalid_runtime_daily_projection");
    if (item.run_id !== null && !runtimeDailyBoundedText(item.run_id, 120)) runtimeDailyReject("invalid_runtime_daily_projection");
    if (allowed.length === 3 && runtimeDailyCalendarDate(item.business_date) === null) runtimeDailyReject("invalid_runtime_daily_date");
    if (target.platform === "schwab" && (allowed.length !== 2
      || !runtimeDailyChoice(item.reason, ["missing_run_time", "invalid_run_time", "inverted_run_time", "future_run_time", "other_business_date"])
      || (item.run_id !== null && !/^run\.[0-9a-f]{32}$/.test(item.run_id)))) runtimeDailyReject("invalid_runtime_daily_projection");
    return allowed.length === 3
      ? { run_id: item.run_id, reason: item.reason, business_date: item.business_date }
      : { run_id: item.run_id, reason: item.reason };
  });
  if (!Array.isArray(record.conflicts) || record.conflicts.length > RUNTIME_DAILY_MAX_LIST || record.conflicts.some((item) => !runtimeDailyBoundedText(item, 160))) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (["no_submission", "no_signal", "no_rebalance", "filled", ...RUNTIME_DAILY_SCHEDULE_ONLY].includes(record.status)
    && (record.conflicts.length || runs.some(run => runtimeDailyRunIssue(run) !== null))) {
    runtimeDailyReject("runtime_daily_summary_conflict");
  }
  if (!runtimeDailyExactKeys(record.fills, ["source", "records", "count"]) || record.fills.source !== "not_connected" || record.fills.count !== null || !Array.isArray(record.fills.records) || record.fills.records.length !== 0) {
    runtimeDailyReject("invalid_runtime_daily_fills");
  }
  const unmatched = raw.unmatched_reports.map((item) => {
    if (target.platform === "schwab") {
      if (!runtimeDailyExactKeys(item, ["reason"]) || !runtimeDailyChoice(item.reason, ["invalid_report", "wrong_platform", "wrong_target", "invalid_source_object"])) runtimeDailyReject("invalid_runtime_daily_projection");
      return { reason: item.reason };
    }
    if (!runtimeDailyExactKeys(item, ["run_id", "platform", "service", "strategy_profile", "account_scope", "reason"])) {
      runtimeDailyReject("invalid_runtime_daily_projection");
    }
    for (const field of ["platform", "service", "strategy_profile", "account_scope", "reason"]) {
      if (item[field] !== null && !runtimeDailyBoundedText(item[field], 120)) runtimeDailyReject("invalid_runtime_daily_projection");
    }
    if (item.run_id !== null && !runtimeDailyBoundedText(item.run_id, 120)) runtimeDailyReject("invalid_runtime_daily_projection");
    return { ...item };
  });
  if (target.platform === "schwab") {
    if (raw.read_errors.some(item => !["report_read_error", "coverage_unconfirmed", "report_rejected"].includes(item))
      || record.conflicts.some(item => !/^run\.[0-9a-f]{32}$/.test(item))
      || record.execution_lane === "paper") runtimeDailyReject("invalid_runtime_daily_projection");
    const lanes = new Set(runs.map(run => run.execution_lane));
    if (record.execution_lane !== (lanes.size === 1 ? runs[0].execution_lane : "insufficient")) runtimeDailyReject("invalid_runtime_daily_projection");
    validateSchwabRuntimeDailySummary(raw, record, runs, observedMs);
  }
  return {
    platform: target.platform,
    observed_at: raw.observed_at,
    completeness: raw.completeness,
    read_errors: [...raw.read_errors],
    records: [{
      platform: target.platform,
      target_key: target.target_key,
      target: { ...record.target },
      business_date: businessDate,
      timezone: RUNTIME_DAILY_TIMEZONE,
      observed_at: raw.observed_at,
      status: record.status,
      kind: record.kind,
      completeness: record.completeness,
      execution_lane: record.execution_lane,
      schedule: { ...schedule },
      runs,
      excluded_reports: excluded,
      conflicts: [...record.conflicts],
      fills: { source: "not_connected", records: [], count: null },
    }],
    unmatched_reports: unmatched,
  };
}

export async function runtimeDailyTrustedBinding(env, target, accountOptions = null) {
  const config = accountOptions ? { options: accountOptions } : await loadAccountOptionsConfig(env);
  const accountKey = runtimeDailyBoundAccountKey(config?.options, target.platform);
  if (!accountKey) return null;
  if (target.platform === "longbridge") return { accountKey, fingerprint: null };
  // The payload never supplies this identity. Reuse the protected account-facts
  // contract rather than inferring a physical account from service/live labels.
  const bindings = await loadAccountFactsBindings(env, { propagateReadErrors: true });
  const matches = (bindings?.bindings || []).filter(item => item.platform === target.platform
    && item.service_name === target.service && item.account_scope === target.account_scope);
  const option = config.options.schwab.find(item => item.key === accountKey);
  if (matches.length !== 1 || !accountFactsOptionMatchesBinding(option, matches[0])) return null;
  return { accountKey, sourceBindingId: matches[0].source_binding.id,
    fingerprint: await sha256Hex(canonicalResearchTaskJson({ target, binding: matches[0] })) };
}

// A protected registration opts an account into this read model; account-facts
// bindings alone do not register a daily source or authorize a publisher.
export async function runtimeDailyRegisteredBindings(env, accountOptions) {
  if (!hasConfigStore(env)) throw Error("runtime_daily_bindings_store_unavailable");
  const registry = await readConfigJson(env, "runtime_daily_bindings");
  if (registry === null) return [];
  if (!runtimeDailyExactKeys(registry, ["schema_version", "bindings"])
    || registry.schema_version !== "qsl_runtime_daily_bindings.v1" || !Array.isArray(registry.bindings) || registry.bindings.length > 64)
    throw Error("runtime_daily_bindings_invalid");
  if (!registry.bindings.length) return [];
  const facts = await loadAccountFactsBindings(env, { propagateReadErrors: true });
  const entries = registry.bindings.map(item => {
    const platform = item?.platform || "ibkr";
    const keys = ["account_key", "target_id", "source_binding_id", "strategy_profile", "target_key", ...(Object.hasOwn(item || {}, "platform") ? ["platform"] : [])];
    if (!runtimeDailyExactKeys(item, keys) || !["ibkr", "longbridge", "firstrade", "binance"].includes(platform)
      || !runtimeDailyBoundedText(item.account_key, 120) || !runtimeDailyBoundedText(item.target_id, 120)
      || typeof item.source_binding_id !== "string" || !/^[a-f0-9]{64}$/.test(item.source_binding_id)
      || !runtimeDailyBoundedText(item.strategy_profile, 120)) throw Error("runtime_daily_bindings_invalid");
    const target = parseRuntimeDailyTargetKey(item.target_key, platform);
    if (!target || (platform === "ibkr" && item.target_key.split("|").length !== 4)
      || target.strategy_profile !== item.strategy_profile
      || ![target.service, target.strategy_profile, target.account_scope].every(value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)))
      throw Error("runtime_daily_bindings_invalid");
    return { item, target, platform };
  });
  let binance = null, binanceReadFailed = false;
  if (entries.some(entry => entry.platform === "binance")) {
    try { binance = await trustedBinanceFactsBinding(env); }
    catch { binanceReadFailed = true; }
  }
  return Promise.all(entries.map(async ({ item, target, platform }) => {
    if (platform === "binance" && binanceReadFailed) return { platform, target_key: item.target_key, account_key: item.account_key, status: "read_failed" };
    const collision = entries.some(other => other.item !== item && (other.item.account_key === item.account_key && other.platform === platform
      || other.item.target_key === item.target_key || other.item.target_id === item.target_id
      || other.item.source_binding_id === item.source_binding_id));
    const resolved = platform === "binance" ? {ok: Boolean(binance), binding: binance}
      : resolveTrustedAccountFactsBinding(facts, item.target_id, item.source_binding_id);
    const options = (accountOptions?.[platform] || []).filter(option => option.key === item.account_key);
    const b = resolved.binding;
    const optionMatches = Boolean(b) && (platform === "binance" ? options.length === 1 && binanceFactsOptionMatches(options[0], b)
      : options.length === 1 && accountFactsOptionMatchesBinding(options[0], b));
    const binding = resolved.ok && b.platform === platform && b.account_key === item.account_key
      && b.target_id === item.target_id && b.source_binding.id === item.source_binding_id && optionMatches
      && (target.service === b.service_name || (platform === "binance" && b.service_name === ""))
      && (target.account_scope === b.account_scope || (platform === "longbridge" && target.account_scope === "hk" && b.account_scope === "HK")) ? b : null;
    const sharedPhysicalAccount = platform === "ibkr" && binding && entries.some(other => other.platform === "ibkr" && other.item !== item && other.item.account_key !== item.account_key
      && facts?.bindings.some(otherBinding => otherBinding.platform === "ibkr" && otherBinding.account_key === other.item.account_key
        && otherBinding.account_selector === binding.account_selector));
    if (collision || !binding || sharedPhysicalAccount) return { platform, target_key: item.target_key, account_key: item.account_key, status: "conflict" };
    return { platform, target_key: item.target_key, account_key: item.account_key, status: "bound", target,
      sourceBindingId: item.source_binding_id,
      fingerprint: await sha256Hex(canonicalResearchTaskJson({ target, registration: item, binding })) };
  }));
}

export async function runtimeDailyPublicBindings(env, accountOptions, readRegistered = () => runtimeDailyRegisteredBindings(env, accountOptions)) {
  const legacy = await Promise.all(Object.values(RUNTIME_DAILY_TARGETS).map(async target => {
    try {
      const binding = await runtimeDailyTrustedBinding(env, target, accountOptions);
      return { platform: target.platform, target_key: target.target_key, account_key: binding?.accountKey || null,
        status: binding ? "bound" : "unresolved" };
    } catch {
      return { platform: target.platform, target_key: target.target_key, account_key: null, status: "read_failed" };
    }
  }));
  try {
    const registered = await readRegistered();
    return [...legacy, ...registered.map(({ platform, target_key, account_key, status }) => ({ platform, target_key, account_key, status }))];
  } catch {
    return [...legacy, { platform: "ibkr", target_key: "", account_key: null, status: "read_failed" }];
  }
}

export function runtimeDailyStoredProjection(raw, target, binding) {
  if (target.platform === "longbridge" && !binding.fingerprint) return raw;
  if (!runtimeDailyExactKeys(raw, ["binding_fingerprint", "projection"])) throw new HttpError("runtime_daily_record_invalid", 503);
  if (raw.binding_fingerprint !== binding.fingerprint) throw new HttpError("runtime_daily_binding_changed", 409);
  return raw.projection;
}

export function runtimeDailyUnattributedResponse() {
  return json({ ok: false, error: "runtime_daily_account_unattributed" }, 409);
}

export function runtimeDailyPublicRecord(record) {
  return {
    target_key: record.target_key,
    service: record.target.service,
    strategy_profile: record.target.strategy_profile,
    account_scope: record.target.account_scope,
    business_date: record.business_date,
    timezone: record.timezone,
    observed_at: record.observed_at,
    status: record.status,
    kind: record.kind,
    completeness: record.completeness,
    execution_lane: record.execution_lane,
    schedule: {
      state: record.schedule.state,
      business_date: record.schedule.business_date,
      timezone: record.schedule.timezone,
      latest_due_at: record.schedule.latest_due_at,
      next_due_at: record.schedule.next_due_at,
      grace_ends_at: record.schedule.grace_ends_at,
      publication_grace_ended: record.schedule.publication_grace_ended,
      expected_window: record.schedule.expected_window,
      // Only Schwab's validated, fixed closed-session facts may reach health UI.
      // Legacy LongBridge reasons remain private bounded diagnostic text.
      ...(record.platform === "schwab" && ["no_cron_on_business_date", "market_closed"].includes(record.schedule.reason)
        ? { reason: record.schedule.reason } : {}),
    },
    runs: record.runs.map((run) => ({
      run_id: run.run_id,
      started_at: run.started_at,
      finished_at: run.finished_at,
      activity: run.activity,
      execution_lane: run.execution_lane,
      errors_present: run.evidence.errors_present,
      ...(record.platform === "schwab" ? { issue: runtimeDailyRunIssue(run) } : {}),
    })),
    conflict_count: record.conflicts.length,
    excluded_count: record.excluded_reports.length,
  };
}

// The directory contains only successfully discovered or registered record keys.
// Unknown coverage remains null; it must never look like an empty history.
export async function runtimeDailyHistory(env, target) {
  const prefix = `${RUNTIME_DAILY_KEY_PREFIX}${target.target_key}:`;
  try {
    const listing = await directoryList(env, prefix, RUNTIME_DAILY_HISTORY_PAGE * RUNTIME_DAILY_HISTORY_MAX_PAGES);
    const dates = listing.keys.map(entry => runtimeDailyCalendarDate(entry.name.slice(prefix.length))).filter(Boolean).sort();
    return { available_from: dates[0] || null, available_through: dates.at(-1) || null,
      stored_days: dates.length, truncated: false };
  } catch {
    return null;
  }
}

export function runtimeDailyReadSummary(status, reason, observedRunCount = null) {
  return {
    source: "stored_runtime_daily_projection", status, reason,
    observed_run_count: observedRunCount,
    total_run_count: status === "complete" ? observedRunCount : null,
  };
}

export function runtimeDailyReadStatus(stored, now) {
  const record = stored.records[0];
  // Preserve partial observations without turning their length into a day total.
  // Read completeness and execution outcome/freshness are separate facts.
  const complete = stored.completeness === "complete" && record.completeness === "complete"
    && !stored.read_errors.length && !stored.unmatched_reports.length && !record.conflicts.length
    && record.kind !== "incomplete" && !["read_incomplete", "missing_report", "insufficient", "conflict"].includes(record.status);
  const observedMs = runtimeDailyInstant(stored.observed_at);
  const today = record.business_date === runtimeDailyToday(now);
  let dataStatus = "historical";
  if (today) {
    const fresh = observedMs !== null && observedMs <= now + RUNTIME_DAILY_FUTURE_SKEW_MS && now - observedMs <= RUNTIME_DAILY_STALE_MS;
    dataStatus = fresh ? "fresh" : "stale";
  }
  return {
    data_status: dataStatus,
    read_summary: runtimeDailyReadSummary(complete ? "complete" : "partial",
      complete ? null : "runtime_daily_incomplete", record.runs.length),
    read_error_count: stored.read_errors.length,
    // These producer codes contain no object paths, identities or exception text.
    // Unknown legacy diagnostics remain private and retain an explicit error.
    read_error_codes: stored.read_errors.map(error => {
      if (["report_read_error", "coverage_unconfirmed", "report_rejected", "read_failed", "read_truncated", "list_failed"].includes(error)) return error;
      if (error === "listing truncated") return "listing_truncated";
      if (error === "runtime_target_enabled_schedule_unverified") return "schedule_unverified";
      if (error === "runtime_target_disabled") return "target_disabled";
      return "source_read_error";
    }),
    unmatched_count: stored.unmatched_reports.length,
    record: runtimeDailyPublicRecord(record),
    fills: { source: "not_connected", records: [], count: null },
  };
}

export async function syncRuntimeDailyResponse(request, env) {
  if (!runtimeDailyReadModelEnabled(env)) return runtimeDailyDisabledResponse();
  const ibkrToken = String(env.IBKR_RUNTIME_DAILY_SYNC_TOKEN || "");
  const supplied = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const isIbkr = !!ibkrToken && supplied === ibkrToken && supplied !== String(env.EXECUTION_EVIDENCE_SYNC_TOKEN || "");
  if (isIbkr && [env.ACCOUNT_FACTS_SYNC_TOKEN,
    env.IBKR_ACCOUNT_FACTS_SYNC_TOKEN, env.SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN,
    env.FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN, env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
    env.STRATEGY_SWITCH_SYNC_TOKEN, env.RECONCILIATION_RECOVERY_SYNC_TOKEN,
    env.RECONCILIATION_RECOVERY_CONTROLLER_TOKEN, env.CYCLE_HEALTH_PROVISIONER_TOKEN]
    .some(value => value && String(value) === ibkrToken)) {
    throw new HttpError("runtime_daily_token_ambiguous", 503);
  }
  if (!isIbkr) requireDedicatedExecutionEvidenceSyncToken(request, env);
  if (!hasConfigStore(env)) return json({ ok: false, error: "runtime daily KV is not configured" }, 503);
  let raw;
  try {
    raw = await readBoundedJson(request, RUNTIME_DAILY_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid_runtime_daily_projection" }, error.status || 400);
  }
  let target, binding, projection;
  try {
    const configured = String(env.IBKR_RUNTIME_DAILY_TARGET_KEY || "");
    let authorized;
    try { authorized = configured.startsWith("[") || configured.startsWith("{") ? JSON.parse(configured) : [configured]; }
    catch { throw new HttpError("runtime_daily_target_unauthorized", 403); }
    const isGroups = authorized && !Array.isArray(authorized) && typeof authorized === "object";
    if (isGroups && !runtimeDailyExactKeys(authorized, ["ibkr", "execution"])) throw new HttpError("runtime_daily_target_unauthorized", 403);
    const allowed = isGroups ? authorized[isIbkr ? "ibkr" : "execution"] : isIbkr ? authorized : [];
    if (!Array.isArray(allowed) || allowed.length > 64 || new Set(allowed).size !== allowed.length
      || allowed.some(key => typeof key !== "string" || !parseRuntimeDailyTargetKey(key, isIbkr ? "ibkr" : "longbridge")
        || (isIbkr && key.split("|").length !== 4))) throw new HttpError("runtime_daily_target_unauthorized", 403);
    const registeredRequest = raw?.records?.length === 1 && allowed.includes(raw.records[0]?.target_key);
    if (isIbkr || registeredRequest) {
      if (!registeredRequest || (isIbkr ? raw?.platform !== "ibkr" : raw?.platform === "ibkr")) throw new HttpError("runtime_daily_target_unauthorized", 403);
      const options = (await loadAccountOptionsConfig(env)).options;
      const matches = (await runtimeDailyRegisteredBindings(env, options)).filter(item => item.target_key === raw.records[0].target_key && item.platform === raw.platform);
      if (matches.length !== 1 || matches[0].status !== "bound") return runtimeDailyUnattributedResponse();
      target = matches[0].target;
      binding = { accountKey: matches[0].account_key, fingerprint: matches[0].fingerprint, sourceBindingId: matches[0].sourceBindingId };
    } else {
      projection = normalizeRuntimeDailyProjection(raw);
      target = runtimeDailyTarget(projection.platform);
      binding = await runtimeDailyTrustedBinding(env, target);
    }
  }
  catch (error) {
    if (error instanceof HttpError) throw error;
    return json({ ok: false, error: "runtime_daily_read_failed" }, 503);
  }
  if (!binding) return runtimeDailyUnattributedResponse();
  if (!projection) projection = normalizeRuntimeDailyProjection(raw, Date.now(), target);
  if (target.platform === "schwab" || binding.sourceBindingId) {
    // Reuse the existing protected source_binding.id, not a new identity or a
    // body-supplied account. This also guards a new day with no cached fingerprint.
    const sourceBindingId = request.headers.get("X-QSL-Source-Binding-ID");
    if (typeof sourceBindingId !== "string" || !/^[0-9a-f]{64}$/.test(sourceBindingId)) {
      return json({ ok: false, error: "runtime_daily_source_binding_invalid" }, 400);
    }
    if (sourceBindingId !== binding.sourceBindingId) {
      return json({ ok: false, error: "runtime_daily_source_binding_mismatch" }, 409);
    }
  }
  const accountKey = binding.accountKey;
  const businessDate = projection.records[0].business_date;
  const store = configStore(env);
  const key = runtimeDailyKey(businessDate, target);
  const storedText = await store.get(key);
  if (storedText !== null && storedText !== undefined) {
    let storedRaw;
    let storedProjection;
    try {
      storedRaw = JSON.parse(storedText);
      storedProjection = normalizeRuntimeDailyProjection(runtimeDailyStoredProjection(storedRaw, target, binding), Date.now(), target);
    } catch (error) {
      if (error.message === "runtime_daily_binding_changed") return json({ ok: false, error: error.message }, 409);
      return json({ ok: false, error: "runtime_daily_existing_record_invalid" }, 409);
    }
    if (storedProjection.records[0].business_date !== businessDate || storedProjection.platform !== target.platform
      || storedProjection.records[0].target_key !== target.target_key) {
      return json({ ok: false, error: "runtime_daily_existing_record_invalid" }, 409);
    }
    const storedObservedAt = runtimeDailyInstant(storedProjection.observed_at);
    const incomingObservedAt = runtimeDailyInstant(projection.observed_at);
    if (storedObservedAt === null || incomingObservedAt === null) {
      return json({ ok: false, error: "runtime_daily_existing_record_invalid" }, 409);
    }
    if (incomingObservedAt < storedObservedAt) {
      return json({ ok: false, error: "runtime_daily_stale_observation" }, 409);
    }
    if (incomingObservedAt === storedObservedAt) {
      if (canonicalResearchTaskJson(projection) === canonicalResearchTaskJson(storedProjection)) {
        return json({
          ok: true,
          stored: true,
          business_date: businessDate,
          platform: target.platform,
          target_key: target.target_key,
          account_key: accountKey,
          ...(binding.fingerprint && target.platform !== "schwab" ? { observed_at: projection.observed_at } : {}),
        });
      }
      return json({ ok: false, error: "runtime_daily_observation_conflict" }, 409);
    }
  }
  await writeConfigJson(env, key, binding.fingerprint
    ? { binding_fingerprint: binding.fingerprint, projection } : projection);
  return json({
    ok: true,
    stored: true,
    business_date: businessDate,
    platform: target.platform,
    target_key: target.target_key,
    account_key: accountKey,
    ...(binding.fingerprint && target.platform !== "schwab" ? { observed_at: projection.observed_at } : {}),
  });
}

export async function runtimeDailyResponse(request, env, url, context = null) {
  if (!runtimeDailyReadModelEnabled(env)) return runtimeDailyDisabledResponse();
  const session = await (context ? context.readSession() : readSession(request, env));
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json({ ok: false, error: "runtime daily KV is not configured" }, 503);
  const platforms = url.searchParams.getAll("platform");
  const accounts = url.searchParams.getAll("account_key");
  if (platforms.length > 1 || accounts.length > 1 || url.searchParams.getAll("date").length !== 1
    || (platforms.length !== accounts.length)) return json({ ok: false, error: "invalid_runtime_daily_selection" }, 400);
  // Legacy date-only reads always mean PAPER, never the first configured target.
  let target = platforms.length ? runtimeDailyTarget(platforms[0]) : RUNTIME_DAILY_TARGET;
  if ((!target && !["ibkr", "firstrade", "binance"].includes(platforms[0])) || (accounts.length && !runtimeDailyBoundedText(accounts[0], 120))) return json({ ok: false, error: "invalid_runtime_daily_selection" }, 400);
  const historyOptions = url.searchParams.getAll("include_history");
  if (historyOptions.length > 1 || historyOptions.some(value => !["true", "false"].includes(value)))
    return json({ ok: false, error: "invalid_runtime_daily_selection" }, 400);
  const includeHistory = historyOptions[0] !== "false";
  const businessDate = runtimeDailyCalendarDate(url.searchParams.get("date"));
  if (!businessDate || businessDate > runtimeDailyToday()) return json({ ok: false, error: "invalid_runtime_daily_date" }, 400);
  let binding;
  try {
    const config = await (context ? context.readOptions() : loadAccountOptionsConfig(env));
    const matches = accounts.length ? (await (context ? context.readRegistered() : runtimeDailyRegisteredBindings(env, config.options)))
      .filter(item => item.platform === platforms[0] && item.account_key === accounts[0]) : [];
    if (matches.length) {
      if (matches.length !== 1 || matches[0].status !== "bound") return runtimeDailyUnattributedResponse();
      binding = { accountKey: matches[0].account_key, fingerprint: matches[0].fingerprint };
      target = matches[0].target;
    } else if (platforms[0] === "ibkr" || !target) return runtimeDailyUnattributedResponse();
    else binding = await runtimeDailyTrustedBinding(env, target, config.options);
  }
  catch { return json({ ok: false, error: "runtime_daily_read_failed" }, 503); }
  if (!binding || (accounts.length && accounts[0] !== binding.accountKey)) return runtimeDailyUnattributedResponse();
  const accountKey = binding.accountKey;
  let stored;
  try {
    stored = await readConfigJson(env, runtimeDailyKey(businessDate, target));
  } catch {
    return json({ ok: false, error: "runtime_daily_read_failed",
      read_summary: runtimeDailyReadSummary("read_failed", "runtime_daily_read_failed") }, 503);
  }
  const base = {
    ok: true,
    date: businessDate,
    timezone: RUNTIME_DAILY_TIMEZONE,
    account_key: accountKey,
    platform: target.platform,
    target_key: target.target_key,
    history: includeHistory ? await runtimeDailyHistory(env, target) : null,
  };
  if (stored === null || stored === undefined) {
    return json({ ...base, data_status: "unavailable", record: null, fills: null, read_error_count: 0, unmatched_count: 0,
      read_summary: runtimeDailyReadSummary("no_data", "runtime_daily_record_missing") });
  }
  let projection;
  try {
    projection = normalizeRuntimeDailyProjection(runtimeDailyStoredProjection(stored, target, binding), Date.now(), target);
  } catch (error) {
    if (error.message === "runtime_daily_binding_changed") return json({ ok: false, error: error.message }, 409);
    return json({ ok: false, error: "runtime_daily_record_invalid",
      read_summary: runtimeDailyReadSummary("read_failed", "runtime_daily_record_invalid") }, 503);
  }
  if (projection.records[0].business_date !== businessDate || projection.platform !== target.platform
    || projection.records[0].target_key !== target.target_key) {
    return json({ ok: false, error: "runtime_daily_record_invalid",
      read_summary: runtimeDailyReadSummary("read_failed", "runtime_daily_record_invalid") }, 503);
  }
  return json({ ...base, ...runtimeDailyReadStatus(projection, Date.now()) });
}

export async function syncExecutionEvidenceSourceResponse(request, env) {
  requireDedicatedExecutionEvidenceSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "execution evidence KV is not configured" }, 503);
  }

  const receiptId = request.headers.get("X-QSL-Execution-Evidence-Receipt");
  if (receiptId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receiptId)) {
    return json({ ok: false, error: "invalid execution evidence receipt identifier" }, 400);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, EXECUTION_EVIDENCE_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid execution evidence payload" }, error.status || 400);
  }

  let source;
  try {
    source = normalizeExecutionEvidenceSourceSnapshot(raw, "execution evidence source snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid execution evidence payload" }, 400);
  }

  await writeConfigJson(env, executionEvidenceSourceKey(source.source_id), source);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "execution-evidence-source-sync",
      action: "sync_execution_evidence_source",
      source_id: source.source_id,
      schema_version: source.schema_version,
      deployment_count: source.deployments.length,
      data_status: source.data_status,
      ...(receiptId === null ? {} : { receipt_id: receiptId }),
    });
  } catch {
    // The source snapshot is accepted independently of optional audit retention.
  }
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    deployment_count: source.deployments.length,
    generated_at: source.generated_at,
    ...(receiptId === null ? {} : { receipt_id: receiptId }),
  });
}

export async function executionEvidenceResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyExecutionEvidencePayload("snapshot_unavailable"));
  return json(await aggregateExecutionEvidenceSources(env));
}

export async function aggregateExecutionEvidenceSources(env) {
  const sources = await readExecutionEvidenceSources(env);
  if (!sources.length) return emptyExecutionEvidencePayload("snapshot_unavailable");

  const ttlSeconds = executionEvidenceStaleTtlSeconds(env);
  const now = Date.now();
  const deployments = [];
  const deploymentIds = new Set();
  const duplicateDeploymentIds = new Set();
  const errors = [];
  const timestamps = [];
  let hasReadySource = false;
  let hasStaleSource = false;

  for (const source of sources) {
    const freshness = controlPlaneSnapshotFreshness(source, ttlSeconds, now);
    if (source.generated_at) timestamps.push(source.generated_at);
    if (source.computed_at) timestamps.push(source.computed_at);
    if (freshness.data_status === "ready") hasReadySource = true;
    if (freshness.data_status === "stale") {
      hasStaleSource = true;
      errors.push("execution_evidence_source_stale");
    }
    for (const deployment of source.deployments) {
      if (deploymentIds.has(deployment.deployment_id)) {
        duplicateDeploymentIds.add(deployment.deployment_id);
        errors.push("execution_evidence_duplicate_deployment");
        continue;
      }
      deploymentIds.add(deployment.deployment_id);
      deployments.push({ source_id: source.source_id, freshness, deployment });
    }
    errors.push(...source.errors);
  }

  const uniqueDeployments = deployments.filter((entry) => !duplicateDeploymentIds.has(entry.deployment.deployment_id));
  const dataStatus = hasStaleSource ? "stale" : (hasReadySource ? "ready" : "unavailable");
  return {
    schema_version: EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION,
    generated_at: earliestControlPlaneTimestamp(timestamps),
    computed_at: earliestControlPlaneTimestamp(timestamps),
    data_status: dataStatus,
    summary: normalizeExecutionEvidenceSummary(uniqueDeployments.map((entry) => entry.deployment)),
    deployments: uniqueDeployments,
    policy: {
      execution_evidence_read_only: true,
      p6_owner_decision_required: true,
      limited_live_canary_active: false,
      notice: "执行证据按策略、平台和执行通道分别记录；它不授权订单或实盘。",
    },
    errors: uniqueStrings(errors),
  };
}

export async function readExecutionEvidenceSources(env) {
  const store = configStore(env);
  if (!store) return [];
  let listing;
  try {
    listing = await directoryList(env, EXECUTION_EVIDENCE_SOURCE_PREFIX, EXECUTION_EVIDENCE_MAX_SOURCES);
  } catch {
    return [emptyExecutionEvidenceSourceSnapshot("execution_evidence_source_list_unavailable")];
  }
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const sources = [];
  for (const entry of keys.slice(0, EXECUTION_EVIDENCE_MAX_SOURCES)) {
    const key = typeof entry?.name === "string" ? entry.name : "";
    if (!key.startsWith(EXECUTION_EVIDENCE_SOURCE_PREFIX)) continue;
    try {
      const stored = await readConfigJson(env, key);
      if (!stored) throw new Error("indexed_record_unavailable");
      sources.push(normalizeExecutionEvidenceSourceSnapshot(stored, key));
    } catch {
      sources.push(emptyExecutionEvidenceSourceSnapshot("execution_evidence_source_invalid"));
    }
  }
  return sources;
}

export function executionEvidenceSourceKey(sourceId) {
  return `${EXECUTION_EVIDENCE_SOURCE_PREFIX}${sourceId}`;
}

export function runtimeTargetLifecycleAuditState(source, ttlSeconds, now) {
  if (!source) return null;
  const state = structuredClone(source);
  state.freshness = controlPlaneSnapshotFreshness(source, ttlSeconds, now).data_status;
  delete state.generated_at;
  delete state.computed_at;
  for (const target of state.targets) {
    if (target.deployment?.observed_at) {
      target.deployment.observed_at = controlPlaneSnapshotFreshness({
        data_status: "ready", computed_at: target.deployment.observed_at,
      }, ttlSeconds, now).data_status;
    }
  }
  return JSON.stringify(state);
}

export async function syncRuntimeTargetLifecycleSourceResponse(request, env) {
  // This publisher has the same narrow scope as execution evidence: sanitized
  // platform status only, never credentials, accounts, orders, or commands.
  requireDedicatedExecutionEvidenceSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "runtime target lifecycle KV is not configured" }, 503);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, RUNTIME_TARGET_LIFECYCLE_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid runtime target lifecycle payload" }, error.status || 400);
  }
  let source;
  try {
    source = normalizeRuntimeTargetLifecycleSourceSnapshot(raw, "runtime target lifecycle source snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid runtime target lifecycle payload" }, 400);
  }
  const sourceKey = runtimeTargetLifecycleSourceKey(source.source_id);
  let previous = null;
  try {
    previous = normalizeRuntimeTargetLifecycleSourceSnapshot(await readConfigJson(env, sourceKey));
  } catch {
    // Missing/unreadable history must not prevent a fresh, valid observation.
  }
  // Always retain the new evidence timestamps. Only the optional rolling audit
  // skips unchanged polling records; operator actions are audited separately.
  await writeConfigJson(env, sourceKey, source);
  try {
    const ttlSeconds = executionEvidenceStaleTtlSeconds(env);
    const now = Date.now();
    if (runtimeTargetLifecycleAuditState(previous, ttlSeconds, now) !== runtimeTargetLifecycleAuditState(source, ttlSeconds, now)) {
      await appendAuditLog(env, {
        ts: new Date().toISOString(),
        login: "runtime-target-lifecycle-source-sync",
        action: "sync_runtime_target_lifecycle_source",
        source_id: source.source_id,
        schema_version: source.schema_version,
        target_count: source.targets.length,
        data_status: source.data_status,
      });
    }
  } catch {
    // A valid no-order snapshot remains useful when convenience audit retention fails.
  }
  await maybeAutoDispatchAccountDiagnosis(env, source);
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    target_count: source.targets.length,
    generated_at: source.generated_at,
  });
}

export async function runtimeReadbackResponse(request, env, url) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required", error_state: "unauthorized" }, 401);
  if ([...url.searchParams.keys()].some(key => key !== "scope") || url.searchParams.getAll("scope").length !== 1
    || !/^[a-z0-9_-]+:[a-zA-Z0-9_.-]+$/.test(url.searchParams.get("scope") || ""))
    return json({ ok: false, error: "invalid_runtime_scope" }, 400);
  const scope = url.searchParams.get("scope");
  try {
    const config = await loadAccountOptionsConfig(env);
    const accounts = Object.entries(config.options || {}).flatMap(([platform, rows]) => rows.map(row => ({ ...row, platform })));
    const matches = accounts.filter(row => `${row.platform}:${row.key}` === scope);
    if (!matches.length) return json({ ok: false, error: "runtime_scope_not_found" }, 404);
    if (matches.length !== 1) return json({ ok: false, error: "runtime_binding_conflict" }, 409);
    if (!hasConfigStore(env)) return json({ ok: false, error: "runtime_readback_unavailable" }, 503);
    const snapshot = await aggregateRuntimeTargetLifecycleSources(env);
    if (snapshot.errors?.some(code => /source_list_unavailable|source_invalid/.test(code)))
      return json({ ok: false, error: "runtime_readback_failed" }, 503);
    return json(runtimeReadbackProjection(matches[0], accounts, snapshot));
  } catch {
    return json({ ok: false, error: "runtime_readback_failed" }, 503);
  }
}

export async function runtimeTargetLifecycleResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyRuntimeTargetLifecyclePayload("snapshot_unavailable"));
  return json(await aggregateRuntimeTargetLifecycleSources(env));
}

function accountDiagnosisRuntimeDeps() {
  return {
    json,
    readSession,
    requireSameOrigin,
    readBoundedJson,
    hasConfigStore,
    hasRuntimeInstanceStore,
    loadAccountOptionsConfig,
    readRuntimeTargetLifecycleSources,
    executionEvidenceStaleTtlSeconds,
    controlPlaneSnapshotFreshness,
    runtimeInstanceCommand,
    canonicalResearchTaskJson,
    sha256Hex,
    fetchWithTimeout,
    githubHeaders,
  };
}

export async function accountDiagnosisAccount(env, platform, key) {
  return accountDiagnosisAccountImpl(env, platform, key, accountDiagnosisRuntimeDeps());
}

export async function accountDiagnosisContext(env, platform, key) {
  return accountDiagnosisContextImpl(env, platform, key, accountDiagnosisRuntimeDeps());
}

export async function accountDiagnosisRecheckStatus(env, task) {
  return accountDiagnosisRecheckStatusImpl(env, task, accountDiagnosisRuntimeDeps());
}

export async function accountDiagnosisIdentityForTarget(env, targetId) {
  return accountDiagnosisIdentityForTargetImpl(env, targetId, accountDiagnosisRuntimeDeps());
}

export async function accountDiagnosisNativeStop(env, context, task) {
  return accountDiagnosisNativeStopImpl(env, context, task, accountDiagnosisRuntimeDeps());
}

export async function accountDiagnosisNativeReadback(env, context, task, record, cancelRequested = false) {
  return accountDiagnosisNativeReadbackImpl(env, context, task, record, cancelRequested, accountDiagnosisRuntimeDeps());
}

export async function reconcileAccountDiagnosis(env, requestId, cancel = false) {
  return reconcileAccountDiagnosisImpl(env, requestId, cancel, accountDiagnosisRuntimeDeps());
}

export async function dispatchAccountDiagnosis(env, requestId) {
  return dispatchAccountDiagnosisImpl(env, requestId, accountDiagnosisRuntimeDeps());
}

export async function dispatchAccountDiagnosisRecheck(env, task) {
  return dispatchAccountDiagnosisRecheckImpl(env, task, accountDiagnosisRuntimeDeps());
}

export async function maybeAutoDispatchAccountDiagnosis(env, source) {
  return maybeAutoDispatchAccountDiagnosisImpl(env, source, accountDiagnosisRuntimeDeps());
}

export async function accountDiagnosisResponse(request, env, url) {
  return accountDiagnosisResponseImpl(request, env, url, accountDiagnosisRuntimeDeps());
}

export async function accountDiagnosisInternalResponse(request, env, url) {
  return accountDiagnosisInternalResponseImpl(request, env, url, accountDiagnosisRuntimeDeps());
}

export function projectRuntimeAccountState(entry) {
  const base = { scope: "monitoring_only", limit: "not_trading_or_books" };
  const target = entry?.target || {};
  const monitoring = target.monitoring || {};
  const disposition = target.disposition || {};
  const deployment = target.deployment;
  const sourceFresh = entry?.freshness?.data_status === "ready";
  const deploymentFresh = Boolean(deployment?.observed_at) && entry?.deployment_freshness?.data_status === "ready";
  let activation = "unknown";
  if (deploymentFresh && deployment.runtime_enabled === true && deployment.scheduler_state === "enabled") activation = "enabled";
  else if (deploymentFresh && deployment.runtime_enabled === false && deployment.scheduler_state === "paused") activation = "disabled";
  const configured = target.target?.configured_state;
  const retainedFault = monitoring.runtime_guard === "attention"
    || monitoring.execution_heartbeat === "attention"
    || disposition.code === "parked";
  if (retainedFault) return { ...base, health: "abnormal", activation, reason: "retained_attention" };
  if ((configured === "enabled" && activation === "disabled") || (configured === "disabled" && activation === "enabled")) {
    return { ...base, health: "abnormal", activation, reason: "config_inconsistent" };
  }
  if (monitoring.execution_heartbeat === "not_due") {
    return { ...base, health: "unknown", activation, reason: "check_not_due" };
  }
  const enabledAgrees = configured === "enabled"
    && activation === "enabled"
    && monitoring.runtime_guard === "pass"
    && monitoring.execution_heartbeat === "pass"
    && disposition.code === "continue_enabled_monitoring";
  const disabledAgrees = configured === "disabled"
    && activation === "disabled"
    && monitoring.runtime_guard === "pass"
    && monitoring.execution_heartbeat === "not_applicable"
    && disposition.code === "continue_disabled_validation";
  if (sourceFresh && (enabledAgrees || disabledAgrees)) {
    return { ...base, health: "normal", activation, reason: "monitoring_agrees" };
  }
  let reason = "evidence_insufficient";
  if (!sourceFresh) reason = "source_not_fresh";
  else if (!deployment) reason = "deployment_missing";
  else if (!deploymentFresh) reason = "deployment_not_fresh";
  else if (activation === "unknown") reason = "activation_unconfirmed";
  return { ...base, health: "unknown", activation, reason };
}

export async function aggregateRuntimeTargetLifecycleSources(env) {
  const sources = await readRuntimeTargetLifecycleSources(env);
  if (!sources.length) return emptyRuntimeTargetLifecyclePayload("snapshot_unavailable");
  const ttlSeconds = executionEvidenceStaleTtlSeconds(env);
  const now = Date.now();
  const targets = [];
  const targetIds = new Set();
  const duplicateTargetIds = new Set();
  const errors = [];
  const timestamps = [];
  let hasReadySource = false;
  let hasStaleSource = false;
  for (const source of sources) {
    const freshness = controlPlaneSnapshotFreshness(source, ttlSeconds, now);
    if (source.generated_at) timestamps.push(source.generated_at);
    if (source.computed_at) timestamps.push(source.computed_at);
    if (freshness.data_status === "ready") hasReadySource = true;
    if (freshness.data_status === "stale") {
      hasStaleSource = true;
      errors.push("runtime_target_lifecycle_source_stale");
    }
    for (const target of source.targets) {
      if (targetIds.has(target.target_id)) {
        duplicateTargetIds.add(target.target_id);
        errors.push("runtime_target_lifecycle_duplicate_target");
        continue;
      }
      targetIds.add(target.target_id);
      const entry = {
        source_id: source.source_id,
        observed_at: earliestControlPlaneTimestamp([source.generated_at, source.computed_at].filter(Boolean)),
        evidence_valid_for_seconds: ttlSeconds,
        freshness,
        target,
        // A lifecycle source is deliberately no-order.  Keep this derived
        // observation separate from the monitoring checks so a green check
        // cannot be mistaken for a broker submission or fill receipt.
        execution_observation: runtimeTargetLifecycleExecutionObservation(target),
        ...(target.deployment ? {deployment_freshness: target.deployment.observed_at
          ? controlPlaneSnapshotFreshness({data_status:"ready", computed_at:target.deployment.observed_at}, ttlSeconds, now)
          : freshness} : {}),
      };
      entry.account_state = projectRuntimeAccountState(entry);
      targets.push(entry);
    }
    errors.push(...source.errors);
  }
  const uniqueTargets = targets.filter((entry) => !duplicateTargetIds.has(entry.target.target_id));
  const dataStatus = hasStaleSource ? "stale" : (hasReadySource ? "ready" : "unavailable");
  return {
    schema_version: RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION,
    generated_at: earliestControlPlaneTimestamp(timestamps),
    computed_at: earliestControlPlaneTimestamp(timestamps),
    data_status: dataStatus,
    summary: {
      target_count: uniqueTargets.length,
      enabled: uniqueTargets.filter((entry) => entry.target.target.configured_state === "enabled").length,
      disabled: uniqueTargets.filter((entry) => entry.target.target.configured_state === "disabled").length,
      attention: uniqueTargets.filter((entry) => entry.target.disposition.code === "parked").length,
    },
    targets: uniqueTargets,
    policy: {
      lifecycle_status_read_only: true,
      execution_observation_read_only: true,
      no_order: true,
      order_or_fill_evidence: "not_collected",
      notice: "已启用目标持续监控；已停用目标持续进行无执行验证。运行或心跳通过只说明监测正常，不代表已提交订单或已成交。",
    },
    errors: uniqueStrings(errors),
  };
}

export function runtimeTargetLifecycleExecutionObservation(target) {
  const monitoring = target?.monitoring || {};
  const configuredState = target?.target?.configured_state;
  let code = "unavailable";
  if (monitoring.runtime_guard === "attention" || monitoring.execution_heartbeat === "attention") {
    code = "attention";
  } else if (monitoring.runtime_guard === "unavailable" || monitoring.execution_heartbeat === "unavailable") {
    code = "unavailable";
  } else if (configuredState === "disabled") {
    code = "not_applicable";
  } else if (monitoring.execution_heartbeat === "not_due") {
    code = "not_due";
  } else if (monitoring.execution_heartbeat === "pass") {
    code = "monitoring_only";
  }
  return {
    code: cleanChoice(code, RUNTIME_TARGET_LIFECYCLE_EXECUTION_OBSERVATIONS, "runtime target lifecycle execution observation"),
    // The source contract always declares no_order=true.  Only the separate
    // execution-receipt chain may later provide an order/fill attestation.
    order_or_fill_evidence: "not_collected",
  };
}

export async function readRuntimeTargetLifecycleSources(env) {
  const store = configStore(env);
  if (!store) return [];
  let listing;
  try {
    listing = await directoryList(env, RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX, RUNTIME_TARGET_LIFECYCLE_MAX_SOURCES);
  } catch {
    return [emptyRuntimeTargetLifecycleSourceSnapshot("runtime_target_lifecycle_source_list_unavailable")];
  }
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const sources = [];
  for (const entry of keys.slice(0, RUNTIME_TARGET_LIFECYCLE_MAX_SOURCES)) {
    const key = typeof entry?.name === "string" ? entry.name : "";
    if (!key.startsWith(RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX)) continue;
    try {
      const stored = await readConfigJson(env, key);
      if (!stored) throw new Error("indexed_record_unavailable");
      sources.push(normalizeRuntimeTargetLifecycleSourceSnapshot(stored, key));
    } catch {
      sources.push(emptyRuntimeTargetLifecycleSourceSnapshot("runtime_target_lifecycle_source_invalid"));
    }
  }
  return sources;
}

export function runtimeTargetLifecycleSourceKey(sourceId) {
  return `${RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX}${sourceId}`;
}

export async function syncResearchTaskSourceResponse(request, env) {
  return syncResearchTaskSourceResponseImpl(request, env, {
    readBoundedJson,
    appendAuditLog,
    normalizeResearchTaskSourceSnapshot,
  });
}

export async function researchTaskResponse(request, env) {
  return researchTaskResponseImpl(request, env, {
    aggregateResearchTaskSources,
  });
}

export async function aggregateResearchTaskSources(env) {
  return aggregateResearchTaskSourcesImpl(env, {
    readResearchTaskSources,
    controlPlaneSnapshotFreshness,
    earliestControlPlaneTimestamp,
  });
}

export async function readResearchTaskSources(env) {
  return readResearchTaskSourcesImpl(env, {
    normalizeResearchTaskSourceSnapshot,
  });
}

export async function aggregateControlPlaneSources(env) {
  return aggregateControlPlaneSourcesImpl(env);
}

export { normalizeControlPlaneSourceRetirements };

export async function readControlPlaneSources(env) {
  return readControlPlaneSourcesImpl(env);
}

export { controlPlaneSourceKey };

export async function syncAdaptiveSelectionSourceResponse(request, env) {
  requireDedicatedAdaptiveSelectionSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "adaptive selection KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, ADAPTIVE_SELECTION_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid adaptive selection payload" }, error.status || 400);
  }

  let source;
  try {
    source = await normalizeAdaptiveSelectionSourceSnapshot(raw, "adaptive selection source snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid adaptive selection payload" }, 400);
  }

  await writeConfigJson(env, adaptiveSelectionSourceKey(source.source_id), source);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "adaptive-selection-source-sync",
      action: "sync_adaptive_selection_source",
      source_id: source.source_id,
      schema_version: source.schema_version,
      candidate_count: source.decision?.candidates.length || 0,
      data_status: source.data_status,
      no_order: true,
    });
  } catch {
    // This source remains safe and usable if the rolling convenience log fails.
  }
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    candidate_count: source.decision?.candidates.length || 0,
    generated_at: source.generated_at,
    no_order: true,
  });
}

export async function syncM0ResearchLedgerResponse(request, env) {
  requireDedicatedM0ResearchSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "M0 research ledger KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, M0_RESEARCH_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid M0 research ledger payload" }, error.status || 400);
  }

  let envelope;
  try {
    envelope = await normalizeM0ResearchLedgerTransport(raw, "M0 research ledger transport");
  } catch (error) {
    // Validation deliberately completes before any KV write.  A malformed,
    // over-scoped, or digest-mismatched payload can therefore never replace
    // the last known-good current ledger.
    return json({ ok: false, error: error.message || "invalid M0 research ledger payload" }, 400);
  }

  const current = await readCurrentM0ResearchLedgerRecord(env);
  if (current) {
    // A retry for the exact immutable source is not a new decision or a
    // second write. Acknowledge it so a lost response cannot make a valid
    // no-order publication look failed, while retaining the guards below.
    if (envelope.source_artifact.sha256 === current.envelope.source_artifact.sha256) {
      return json({
        ok: true,
        schema_version: current.envelope.schema_version,
        source_repository: current.envelope.source_artifact.repository,
        source_revision: current.envelope.source_artifact.revision,
        source_run_id: current.envelope.source_artifact.run_id,
        artifact_id: current.envelope.source_artifact.artifact_id,
        ledger_sha256: current.envelope.ledger_sha256,
        replayed: true,
        no_order: true,
        expires_at: current.expires_at,
      });
    }
    const replayError = m0ResearchLedgerReplayError(current.envelope, envelope);
    if (replayError) return json({ ok: false, error: replayError }, 409);
  }

  // Capture once so the persisted interval is exactly the requested physical
  // retention even when the request crosses a wall-clock second boundary.
  const storedNow = new Date();
  const storedAt = utcTimestampSeconds(storedNow);
  const expiresAt = utcTimestampSeconds(new Date(storedNow.getTime() + M0_RESEARCH_RETENTION_SECONDS * 1000));
  const record = {
    schema_version: M0_RESEARCH_STORAGE_SCHEMA_VERSION,
    stored_at: storedAt,
    expires_at: expiresAt,
    envelope,
  };
  try {
    // Archive first: an archive failure must not advance the current pointer.
    // The archive identity is derived exclusively from the verified digest;
    // callers never choose a KV key.
    await writeM0ResearchLedgerRecord(env, m0ResearchLedgerArchiveKey(envelope.ledger_sha256), record);
    await writeM0ResearchLedgerRecord(env, M0_RESEARCH_CURRENT_KEY, record);
  } catch {
    return json({ ok: false, error: "M0 research ledger persistence failed" }, 503);
  }

  try {
    await appendAuditLog(env, {
      ts: storedAt,
      login: "m0-research-ledger-sync",
      action: "sync_m0_research_ledger",
      source_repository: envelope.source_artifact.repository,
      source_revision: envelope.source_artifact.revision,
      source_run_id: envelope.source_artifact.run_id,
      artifact_id: envelope.source_artifact.artifact_id,
      ledger_sha256: envelope.ledger_sha256,
      no_order: true,
    });
  } catch {
    // Retention of an optional convenience log must not change a valid,
    // already persisted no-order research ledger.
  }
  return json({
    ok: true,
    schema_version: envelope.schema_version,
    source_repository: envelope.source_artifact.repository,
    source_revision: envelope.source_artifact.revision,
    source_run_id: envelope.source_artifact.run_id,
    artifact_id: envelope.source_artifact.artifact_id,
    ledger_sha256: envelope.ledger_sha256,
    replayed: false,
    no_order: true,
    expires_at: expiresAt,
  });
}

export async function m0ResearchLedgerResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyM0ResearchDashboardPayload("m0_research_ledger_unavailable"));
  const record = await readCurrentM0ResearchLedgerRecord(env);
  return json(record
    ? projectM0ResearchDashboardForRead(record.envelope.ledger, record.envelope.ledger_sha256)
    : emptyM0ResearchDashboardPayload("m0_research_ledger_unavailable"));
}

export function m0ResearchLedgerReplayError(current, incoming) {
  if (!current || !incoming) return null;
  if (incoming.ledger_sha256 === current.ledger_sha256
    || incoming.source_artifact.sha256 === current.source_artifact.sha256) {
    return "M0 research ledger current replay rejected";
  }
  // Run IDs are closed identifiers rather than an assumed numeric sequence.
  // An equal source/run identity is a replay; ledger time is the portable
  // ordering guard for a different run identifier.
  if (incoming.source_artifact.repository === current.source_artifact.repository
    && incoming.source_artifact.run_id === current.source_artifact.run_id) {
    return "M0 research ledger current replay rejected";
  }
  const incomingTime = Date.parse(incoming.ledger.computed_at);
  const currentTime = Date.parse(current.ledger.computed_at);
  if (Number.isFinite(incomingTime) && Number.isFinite(currentTime) && incomingTime <= currentTime) {
    return "M0 research ledger time rollback rejected";
  }
  return null;
}

export function m0ResearchLedgerArchiveKey(ledgerSha256) {
  return `${M0_RESEARCH_ARCHIVE_PREFIX}${ledgerSha256}`;
}

export async function writeM0ResearchLedgerRecord(env, key, record) {
  const store = configStore(env);
  if (!store) throw new Error("M0 research ledger KV is not configured");
  await store.put(key, JSON.stringify(record), { expirationTtl: M0_RESEARCH_RETENTION_SECONDS });
}

export async function readCurrentM0ResearchLedgerRecord(env) {
  if (!hasConfigStore(env)) return null;
  let stored;
  try {
    stored = await readConfigJson(env, M0_RESEARCH_CURRENT_KEY);
  } catch {
    return null;
  }
  if (!stored) return null;
  try {
    return await normalizeM0ResearchLedgerStorageRecord(stored, "M0 research ledger current record");
  } catch {
    return null;
  }
}

export async function adaptiveSelectionResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyAdaptiveSelectionPayload("adaptive_selection_source_unavailable"));
  return json(await aggregateAdaptiveSelectionSources(env));
}

export async function aggregateAdaptiveSelectionSources(env) {
  const sources = await readAdaptiveSelectionSources(env);
  if (!sources.length) return emptyAdaptiveSelectionPayload("adaptive_selection_source_unavailable");

  const ttlSeconds = adaptiveSelectionStaleTtlSeconds(env);
  const now = Date.now();
  const selections = [];
  const errors = [];
  const timestamps = [];
  let hasReadySource = false;
  let hasStaleSource = false;

  for (const source of sources) {
    const freshness = controlPlaneSnapshotFreshness(source, ttlSeconds, now);
    if (source.generated_at) timestamps.push(source.generated_at);
    if (source.computed_at) timestamps.push(source.computed_at);
    if (freshness.data_status === "ready") hasReadySource = true;
    if (freshness.data_status === "stale") {
      hasStaleSource = true;
      errors.push("adaptive_selection_source_stale");
    }
    if (source.decision) selections.push({ source_id: source.source_id, freshness, decision: source.decision });
    errors.push(...source.errors);
  }

  return {
    schema_version: ADAPTIVE_SELECTION_DASHBOARD_SCHEMA_VERSION,
    generated_at: earliestControlPlaneTimestamp(timestamps),
    computed_at: earliestControlPlaneTimestamp(timestamps),
    data_status: hasStaleSource ? "stale" : (hasReadySource ? "ready" : "unavailable"),
    summary: normalizeAdaptiveSelectionSummary(selections),
    selections: selections.sort((left, right) => left.source_id.localeCompare(right.source_id)),
    policy: {
      authority: ADAPTIVE_SELECTION_AUTHORITY,
      no_order: true,
      execution_authority_granted: false,
      notice: "M1 仅展示 Shadow 建议和拒绝原因；不会修改策略、平台、资金、运行状态或订单。",
    },
    errors: uniqueStrings(errors),
  };
}

export async function readAdaptiveSelectionSources(env) {
  const store = configStore(env);
  if (!store) return [];
  let listing;
  try {
    listing = await directoryList(env, ADAPTIVE_SELECTION_SOURCE_PREFIX, ADAPTIVE_SELECTION_MAX_SOURCES);
  } catch {
    return [emptyAdaptiveSelectionSourceSnapshot("adaptive_selection_source_list_unavailable")];
  }
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const sources = [];
  for (const entry of keys.slice(0, ADAPTIVE_SELECTION_MAX_SOURCES)) {
    const key = typeof entry?.name === "string" ? entry.name : "";
    if (!key.startsWith(ADAPTIVE_SELECTION_SOURCE_PREFIX)) continue;
    try {
      const stored = await readConfigJson(env, key);
      if (!stored) throw new Error("indexed_record_unavailable");
      sources.push(await normalizeAdaptiveSelectionSourceSnapshot(stored, key));
    } catch {
      sources.push(emptyAdaptiveSelectionSourceSnapshot("adaptive_selection_source_invalid"));
    }
  }
  return sources;
}

export function adaptiveSelectionSourceKey(sourceId) {
  return `${ADAPTIVE_SELECTION_SOURCE_PREFIX}${sourceId}`;
}

export {
  controlPlaneSnapshotFreshness,
  controlPlaneResearchSnapshotFreshness,
  nextControlPlaneResearchScheduleAfter,
};

export { reconciliationRecoveryEvidenceFreshness };

export {
  mergeControlPlaneFreshness,
  earliestControlPlaneTimestamp,
};

export async function readBoundedJson(request, maxBytes) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > maxBytes) throw new HttpError("request body is too large", 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new HttpError("request body is too large", 413);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError("request body must be valid JSON", 400);
  }
}

export function requireDedicatedStrategyHealthSyncToken(request, env) {
  const expected = String(env.STRATEGY_HEALTH_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("strategy health sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("strategy health sync token is invalid", 401);
}

export {
  requireDedicatedControlPlaneSyncToken,
  requireControlPlaneSourceSyncToken,
};

export function requireDedicatedAdaptiveSelectionSyncToken(request, env) {
  const expected = String(env.ADAPTIVE_SELECTION_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("adaptive selection sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("adaptive selection sync token is invalid", 401);
}

export function requireDedicatedExecutionEvidenceSyncToken(request, env) {
  const expected = String(env.EXECUTION_EVIDENCE_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("execution evidence sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("execution evidence sync token is invalid", 401);
}

export function requireDedicatedAccountFactsSyncToken(request, env) {
  const configured = [
    ["longbridge", String(env.ACCOUNT_FACTS_SYNC_TOKEN || "")],
    [IBKR_ACCOUNT_FACTS_PLATFORM, String(env.IBKR_ACCOUNT_FACTS_SYNC_TOKEN || "")],
    [SCHWAB_ACCOUNT_FACTS_PLATFORM, String(env.SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN || "")],
    [FIRSTRADE_ACCOUNT_FACTS_PLATFORM, String(env.FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN || "")],
  ].filter(([, token]) => token);
  const firstradeToken = String(env.FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN || "");
  if (firstradeToken && [env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN, env.EXECUTION_EVIDENCE_SYNC_TOKEN,
    env.STRATEGY_SWITCH_SYNC_TOKEN, env.RECONCILIATION_RECOVERY_SYNC_TOKEN,
    env.RECONCILIATION_RECOVERY_CONTROLLER_TOKEN, env.CYCLE_HEALTH_PROVISIONER_TOKEN]
    .some(other => other && String(other) === firstradeToken)) {
    throw new HttpError("account_facts_sync_token_ambiguous", 503);
  }
  if (new Set(configured.map(([, token]) => token)).size !== configured.length) {
    throw new HttpError("account_facts_sync_token_ambiguous", 503);
  }
  if (!configured.length) throw new HttpError("account_facts_sync_token_not_configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const match = configured.find(([, expected]) => token === expected);
  if (match) return match[0];
  throw new HttpError("account_facts_sync_token_invalid", 401);
}

export function accountFactsDisabledResponse() {
  return json({ ok: false, error: "account_facts_disabled" }, 404);
}

// Sync producers keep only the HTTP status, so a refused push is undiagnosable
// from their logs. Publish the refusal code, tagged with a fixed endpoint literal
// from the caller; free-form exception text is classified to "unknown" so payload
// content, identities and credentials cannot enter the log stream. The response
// body and status are exactly what this helper already returned.
export function accountFactsErrorResponse(error, endpoint = "read") {
  const code = error instanceof AccountFactsError ? error.code
    : error instanceof HttpError ? error.message
    : error?.message || "invalid_account_facts_history";
  const status = error?.status || 400;
  console.warn("account_facts_refused", {
    endpoint,
    http_status: status,
    error_category: typeof code === "string" && /^[a-z][a-z0-9_]{2,63}$/.test(code) ? code : "unknown",
  });
  return json({ ok: false, error: code }, status);
}

export function requireCycleHealthProvisionToken(request, env) {
  const expected = String(env.STRATEGY_SWITCH_SYNC_TOKEN || env.RUNTIME_SETTINGS_DISPATCH_TOKEN || "");
  if (!expected) throw new HttpError("cycle_health_provisioner_unavailable", 503);
  const sourceTokens = [
    env.ACCOUNT_FACTS_SYNC_TOKEN, env.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,
    env.SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN, env.FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN, env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
    env.EXECUTION_EVIDENCE_SYNC_TOKEN,
  ].filter(Boolean).map(String);
  if (sourceTokens.includes(expected)) throw new HttpError("cycle_health_provisioner_token_alias", 503);
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("cycle_health_provisioner_token_invalid", 401);
}

export async function resolveCycleHealthBindingFingerprint(env, targetId, bindingId) {
  const config = await loadAccountOptionsConfig(env);
  const options = Array.isArray(config?.options?.longbridge) ? config.options.longbridge : [];
  const matches = options.filter(o => o.runtime_status_target_id === targetId);
  const allMatches = Object.entries(config.options || {}).flatMap(([platform, items]) =>
    (Array.isArray(items) ? items : []).filter(o => o.runtime_status_target_id === targetId).map(o => ({ platform, key: o.key })));
  if (matches.length !== 1 || allMatches.length !== 1 || allMatches[0].platform !== "longbridge"
    || options.filter(o => o.key === matches[0]?.key).length !== 1) throw new HttpError("cycle_health_option_not_unique", 409);
  const bindings = await loadAccountFactsBindings(env);
  const bound = bindings?.bindings?.filter(b => b.platform === "longbridge" && b.account_key === matches[0].key) || [];
  if (bound.length !== 1 || bound[0].account_scope !== "paper" || bound[0].source_binding.id !== bindingId
    || !accountFactsOptionMatchesBinding(matches[0], bound[0])) throw new HttpError("cycle_health_binding_mismatch", 409);
  return cycleHealthSha256({ binding: bound[0], runtime_status_target_id: targetId });
}

export async function runtimeCycleHealthAdmissionResponse(request, env) {
  try {
    requireCycleHealthProvisionToken(request, env);
    if (!hasRuntimeInstanceStore(env)) throw new HttpError("cycle_health_store_unavailable", 503);
    const raw = await readBoundedJson(request, 8192);
    const fields = ["source_id", "target_id", "configuration_sha256", "required_from", "expected_authority_revision"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || Object.keys(raw).length !== fields.length || fields.some(field => !Object.hasOwn(raw, field))) {
      throw new HttpError("cycle_health_admission_request_invalid", 400);
    }
    const sourceId = normalizeControlPlaneIdentifier(raw.source_id, "source_id", false);
    const targetId = raw.target_id;
    if (targetId !== "longbridge.paper" || !/^[a-f0-9]{64}$/.test(raw.configuration_sha256 || "")
      || !Number.isSafeInteger(raw.expected_authority_revision) || raw.expected_authority_revision < 0) {
      throw new HttpError("cycle_health_admission_request_invalid", 400);
    }
    const requiredFrom = normalizeCycleInstant(raw.required_from);
    const bindingId = request.headers.get("X-QSL-Source-Binding-ID") || "";
    if (!/^[a-f0-9]{64}$/.test(bindingId)) throw new HttpError("cycle_health_binding_required", 409);
    const bindingFingerprint = await resolveCycleHealthBindingFingerprint(env, targetId, bindingId);
    return json(await runtimeInstanceCommand(env, {
      action: "cycle_health_provision", source_id: sourceId, target_id: targetId,
      binding_fingerprint: bindingFingerprint, configuration_sha256: raw.configuration_sha256,
      required_from: requiredFrom, expected_authority_revision: raw.expected_authority_revision,
    }));
  } catch (error) {
    return json({ ok: false, error: error instanceof HttpError || error instanceof CycleHealthError
      ? error.message : "cycle_health_admission_unavailable" }, error.status || 400);
  }
}

export async function runtimeCycleHealthSourceResponse(request, env) {
  try {
    const platform = requireDedicatedAccountFactsSyncToken(request, env);
    if (platform !== "longbridge") throw new HttpError("cycle_health_token_platform_mismatch", 403);
    const dedicated = String(env.ACCOUNT_FACTS_SYNC_TOKEN || "");
    if ([env.EXECUTION_EVIDENCE_SYNC_TOKEN, env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN].some(t => t && String(t) === dedicated)) {
      throw new HttpError("cycle_health_token_alias", 503);
    }
    if (!hasRuntimeInstanceStore(env)) throw new HttpError("cycle_health_store_unavailable", 503);
    const url = new URL(request.url);
    let source, targetId, sourceId, historyCursor = null;
    const bindingId = request.headers.get("X-QSL-Source-Binding-ID") || "";
    if (!/^[a-f0-9]{64}$/.test(bindingId)) throw new HttpError("cycle_health_binding_required", 409);
    if (request.method === "GET") {
      if ([...url.searchParams.keys()].some(k => !["source_id", "target_id", "history_cursor"].includes(k))
        || url.searchParams.getAll("source_id").length !== 1 || url.searchParams.getAll("target_id").length !== 1
        || url.searchParams.getAll("history_cursor").length > 1) throw new HttpError("cycle_health_invalid_query", 400);
      sourceId = normalizeControlPlaneIdentifier(url.searchParams.get("source_id"), "source_id", false);
      targetId = url.searchParams.get("target_id");
      historyCursor = url.searchParams.get("history_cursor");
      if (historyCursor !== null) {
        if (historyCursor.length > 512) throw new HttpError("cycle_health_history_cursor_invalid", 400);
      }
    } else {
      const raw = await readBoundedJson(request, ACCOUNT_FACTS_MAX_BODY_BYTES);
      if (!Array.isArray(raw?.targets) || raw.targets.length !== 1) throw new HttpError("cycle_health_one_target_required", 400);
      const { cycle_health: health, ...legacyTarget } = raw.targets[0];
      if (!health) throw new HttpError("cycle_health_extension_required", 400);
      // Reuse the lifecycle shape with the companion member removed. The legacy
      // normalizer and legacy POST still reject this extension as before.
      source = normalizeRuntimeTargetLifecycleSourceSnapshot({ ...raw, targets: [legacyTarget] });
      normalizeCycleInstant(raw.generated_at); normalizeCycleInstant(raw.computed_at);
      if (raw.generated_at !== raw.computed_at || source.data_status !== "ready") throw new HttpError("cycle_health_observation_time_mismatch", 400);
      source.generated_at = raw.generated_at; source.computed_at = raw.computed_at;
      if (legacyTarget.deployment?.observed_at !== undefined) {
        source.targets[0].deployment.observed_at = normalizeCycleInstant(legacyTarget.deployment.observed_at);
        if (compareCycleInstants(legacyTarget.deployment.observed_at, raw.computed_at) > 0) throw new HttpError("cycle_health_deployment_chronology", 400);
      }
      const age = Date.now() - Date.parse(source.computed_at);
      if (age > ACCOUNT_FACTS_STALE_MS || age < -ACCOUNT_FACTS_FUTURE_SKEW_MS) throw new HttpError("cycle_health_observation_age", 409);
      targetId = source.targets[0].target_id; sourceId = source.source_id;
      source.targets[0].cycle_health = await normalizeCycleHealth(health, {
        target_id: targetId, source_binding_id: bindingId, observed_at: source.computed_at,
      });
    }
    if (targetId !== "longbridge.paper" || (source && (source.targets[0].target.platform !== "longbridge" || source.targets[0].target.execution_mode !== "paper"))) throw new HttpError("cycle_health_paper_target_required", 403);
    const bindingFingerprint = await resolveCycleHealthBindingFingerprint(env, targetId, bindingId);
    const identity = { source_id: sourceId, target_id: targetId, binding_fingerprint: bindingFingerprint, source_binding_id: bindingId };
    const admission = await runtimeInstanceCommand(env, { ...identity, action: "cycle_health_admission" });
    if (source && source.targets[0].cycle_health.configuration_sha256 !== admission.configuration_sha256) throw new HttpError("cycle_health_configuration_not_admitted", 409);
    const command = { ...identity, ...admission, action: source ? "cycle_health_put" : "cycle_health_read",
      ...(historyCursor ? { history_cursor: historyCursor } : {}) };
    if (source) {
      command.observation = source;
      command.observation_json = canonicalCycleJson(source);
      command.observation_sha256 = await cycleHealthSha256(source);
      command.received_at = new Date().toISOString();
    }
    return json(await runtimeInstanceCommand(env, command));
  } catch (error) {
    return json({ ok: false, error: error instanceof HttpError || error instanceof CycleHealthError ? error.message : "cycle_health_invalid_source" }, error.status || 400);
  }
}

export async function loadAccountFactsBindings(env, { propagateReadErrors = false } = {}) {
  if (!hasConfigStore(env)) {
    if (propagateReadErrors) throw new Error("account_facts_bindings_store_unavailable");
    return null;
  }
  let raw;
  try {
    raw = await readConfigJson(env, ACCOUNT_FACTS_BINDINGS_KEY);
  } catch (error) {
    if (propagateReadErrors) throw error;
    return null;
  }
  if (!raw) return null;
  return normalizeAccountFactsBindings(raw);
}

export async function loadStoredAccountFactsMap(env, accountOptions, bindings) {
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("account_facts_store_unavailable", 503);
  const accounts = [];
  const bindingByAccount = new Map(
    (bindings?.bindings || []).map((item) => [`${item.platform}:${item.account_key}`, item]),
  );
  for (const [platform, options] of Object.entries(accountOptions || {})) {
    if (!Array.isArray(options)) continue;
    for (const option of options) {
      if (!option || typeof option.key !== "string" || !option.key) continue;
      const binding = bindingByAccount.get(`${platform}:${option.key}`);
      if (!binding || !accountFactsOptionMatchesBinding(option, binding)) continue;
      accounts.push({
        platform,
        account_key: option.key,
        account_scope: binding.account_scope,
        account_selector: binding.account_selector,
        ...(platform === SCHWAB_ACCOUNT_FACTS_PLATFORM
          ? { broker_account_hash: binding.broker_account_hash }
          : {}),
        ...(platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM ? { broker_account_id: binding.broker_account_id } : {}),
        target_id: binding.target_id,
        source_binding_id: binding.source_binding.id,
      });
    }
  }
  const listed = await runtimeInstanceCommand(env, {
    action: "account_facts_list",
    accounts,
  });
  const storedByAccount = new Map();
  for (const row of listed.observations || []) {
    if (!row?.platform || !row?.account_key || !row?.payload) continue;
    storedByAccount.set(`${row.platform}:${row.account_key}`, row.payload);
  }
  return storedByAccount;
}

export function periodReturnCommand(binding, action) {
  return { action, platform: "ibkr", account_key: binding.account_key, account_scope: binding.account_scope,
    account_selector: binding.account_selector, target_id: binding.target_id, source_binding_id: binding.source_binding.id,
    ...(binding.history_source_binding_ids ? { history_source_binding_ids: binding.history_source_binding_ids } : {}) };
}

export async function readBoundAccountExecutions(option, env) {
  if (option.platform !== "ibkr" || !accountFactsReadModelEnabled(env)) return null;
  const bindings = await loadAccountFactsBindings(env);
  const matches = (bindings?.bindings || []).filter(binding => binding.platform === option.platform
    && binding.account_key === option.key);
  if (!matches.length) return null;
  if (matches.length !== 1 || !accountFactsOptionMatchesBinding(option, matches[0])) {
    throw new HttpError("execution_account_unattributed", 409);
  }
  const stored = await runtimeInstanceCommand(env, periodReturnCommand(matches[0], "account_executions_read"));
  if (!stored.ok) throw new HttpError("execution_store_unavailable", 503);
  return stored.executions;
}

export async function syncAccountExternalFlowResponse(request, env) {
  if (!accountFactsReadModelEnabled(env)) return accountFactsDisabledResponse();
  try {
    const platform = requireDedicatedAccountFactsSyncToken(request, env);
    if (!hasConfigStore(env) || !hasRuntimeInstanceStore(env)) throw new HttpError("account_facts_store_unavailable", 503);
    const raw = await readBoundedJson(request, ACCOUNT_FACTS_MAX_BODY_BYTES);
    const fields = ["schema_version", "target_id", "source_binding_id", "account_scope", "account_selector", "externalFlow"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== fields.length
        || fields.some(key => !Object.hasOwn(raw, key)) || raw.schema_version !== "account_external_flow.v1") {
      throw new HttpError("invalid_external_flow", 400);
    }
    const bindings = await loadAccountFactsBindings(env);
    const resolved = resolveTrustedAccountFactsBinding(bindings, raw.target_id, raw.source_binding_id);
    if (!resolved.ok || resolved.binding.platform !== platform) throw new HttpError("account_facts_identity_mismatch", 409);
    const binding = resolved.binding;
    if (raw.account_scope !== binding.account_scope || raw.account_selector !== binding.account_selector) {
      throw new HttpError("account_facts_identity_mismatch", 409);
    }
    const config = await loadAccountOptionsConfig(env);
    const options = (config.options?.[platform] || []).filter(item => item.key === binding.account_key);
    if (options.length !== 1 || !accountFactsOptionMatchesBinding(options[0], binding)) throw new HttpError("account_facts_account_unattributed", 409);
    const flow = normalizeExternalFlow(raw.externalFlow);
    if (!externalFlowEnabled(env) && !dateOnlyExternalFlow(flow)) throw new HttpError("external_flow_disabled", 409);
    const source = { ibkr: "ibkr_flex", schwab: "schwab_transactions", longbridge: "longbridge_cashflow" }[platform];
    if (!source || flow.windows.some(w => w.source !== source)) throw new HttpError("external_flow_source_mismatch", 409);
    const stored = await runtimeInstanceCommand(env, { action: "account_external_flow_put", platform,
      account_key: binding.account_key, account_scope: binding.account_scope, account_selector: binding.account_selector,
      target_id: binding.target_id, source_binding_id: binding.source_binding.id,
      ...(platform === SCHWAB_ACCOUNT_FACTS_PLATFORM ? { broker_account_hash: binding.broker_account_hash } : {}),
      ...(platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM ? { broker_account_id: binding.broker_account_id } : {}),
      externalFlow: flow });
    return json({ ok: true, stored: true, unchanged: stored.unchanged === true, readback_verified: stored.readback_verified === true,
      account_key: binding.account_key, window_count: flow.windows.length,
      record_count: new Set(flow.windows.flatMap(w => w.records.map(r => r.source_ref))).size });
  } catch (error) {
    if (error instanceof AccountFactsError || error instanceof HttpError || error?.code?.startsWith("external_flow")
        || error?.code === "invalid_external_flow") return accountFactsErrorResponse(error, "external_flow_sync");
    return json({ ok: false, error: "account_external_flow_unavailable" }, 503);
  }
}

export async function syncAccountExecutionsResponse(request, env) {
  if (!accountFactsReadModelEnabled(env)) return accountFactsDisabledResponse();
  try {
    if (requireDedicatedAccountFactsSyncToken(request, env) !== "ibkr") throw new HttpError("account_facts_sync_token_platform_mismatch", 403);
    if (!hasConfigStore(env) || !hasRuntimeInstanceStore(env)) throw new HttpError("account_facts_store_unavailable", 503);
    const raw = await readBoundedJson(request, ACCOUNT_FACTS_MAX_BODY_BYTES);
    const bindings = await loadAccountFactsBindings(env);
    const resolved = resolveTrustedAccountFactsBinding(bindings, raw?.target_id, raw?.source_binding_id);
    if (!resolved.ok || resolved.binding.platform !== "ibkr") throw new HttpError("account_facts_identity_mismatch", 409);
    const binding = resolved.binding;
    const config = await loadAccountOptionsConfig(env);
    const options = (config.options?.ibkr || []).filter(item => item.key === binding.account_key);
    if (options.length !== 1 || !accountFactsOptionMatchesBinding(options[0], binding)) throw new HttpError("account_facts_account_unattributed", 409);
    const payload = normalizeExecutions(raw, { binding });
    if (payload.records.some(row => row.report_ref !== payload.source_ref)) throw new HttpError("invalid_broker_executions", 400);
    const stored = await runtimeInstanceCommand(env, { ...periodReturnCommand(binding, "account_executions_put"), payload });
    return json({ ok: true, stored: true, unchanged: stored.unchanged === true,
      account_key: binding.account_key, period: payload.period, record_count: payload.records.length });
  } catch (error) {
    if (error instanceof AccountFactsError || error instanceof HttpError || error?.code?.startsWith("execution_")
        || error?.code === "invalid_broker_executions") return accountFactsErrorResponse(error, "executions_sync");
    return json({ ok: false, error: "account_executions_unavailable" }, 503);
  }
}

export async function syncAccountPeriodReturnResponse(request, env) {
  if (!accountFactsReadModelEnabled(env)) return accountFactsDisabledResponse();
  try {
    if (requireDedicatedAccountFactsSyncToken(request, env) !== "ibkr") throw new HttpError("account_facts_sync_token_platform_mismatch", 403);
    if (!hasConfigStore(env) || !hasRuntimeInstanceStore(env)) throw new HttpError("account_facts_store_unavailable", 503);
    const raw = await readBoundedJson(request, ACCOUNT_FACTS_MAX_BODY_BYTES);
    const bindings = await loadAccountFactsBindings(env);
    const resolved = resolveTrustedAccountFactsBinding(bindings, raw?.target_id, raw?.source_binding_id);
    if (!resolved.ok || resolved.binding.platform !== "ibkr") throw new HttpError("account_facts_identity_mismatch", 409);
    const binding = resolved.binding;
    const config = await loadAccountOptionsConfig(env);
    const options = (config.options?.ibkr || []).filter(item => item.key === binding.account_key);
    if (options.length !== 1 || !accountFactsOptionMatchesBinding(options[0], binding)) throw new HttpError("account_facts_account_unattributed", 409);
    const payload = normalizeIbkrPeriodReturn(raw, { binding });
    const stored = await runtimeInstanceCommand(env, { ...periodReturnCommand(binding, "account_period_return_put"), payload,
      historical: new URL(request.url).searchParams.get("historical") === "true" });
    return json({ ok: true, stored: true, unchanged: stored.unchanged === true, account_key: binding.account_key,
      period: payload.period, currency: payload.currency, method: payload.method });
  } catch (error) {
    if (error instanceof AccountFactsError || error instanceof HttpError) return accountFactsErrorResponse(error, "period_return_sync");
    return json({ ok: false, error: "account_period_return_unavailable" }, 503);
  }
}

export async function syncAccountFactsResponse(request, env, options) {
  return syncAccountFactsResponseImpl(request, env, {
    json,
    hasConfigStore,
    hasRuntimeInstanceStore,
    loadAccountOptionsConfig,
    loadAccountFactsBindings,
    runtimeInstanceCommand,
    readBoundedJson,
    requireDedicatedAccountFactsSyncToken,
    accountFactsErrorResponse: (error) => accountFactsErrorResponse(
      error, options?.historical ? "history_sync" : "current_sync"),
  }, options);
}

export async function accountFactsResponse(request, env) {
  return accountFactsResponseImpl(request, env, {
    json,
    readSession,
    hasConfigStore,
    hasRuntimeInstanceStore,
    loadAccountOptionsConfig,
    loadAccountFactsBindings: (env) => loadAccountFactsBindings(env, { propagateReadErrors: true }),
    loadStoredAccountFactsMap,
    runtimeInstanceCommand,
    periodReturnCommand,
    accountFactsErrorResponse,
  });
}

export async function accountFactsHistoryResponse(request, env, url) {
  return accountFactsHistoryResponseImpl(request, env, url, {
    json,
    readSession,
    hasConfigStore,
    hasRuntimeInstanceStore,
    loadAccountOptionsConfig,
    loadAccountFactsBindings: (env) => loadAccountFactsBindings(env, { propagateReadErrors: true }),
    runtimeInstanceCommand,
    accountFactsErrorResponse,
    sha256Hex,
  });
}

export {
  requireDedicatedReconciliationRecoverySyncToken,
  requireDedicatedReconciliationRecoveryControllerToken,
};






export function normalizeBrokerEnvironment(value, fieldName = "broker_environment") {
  const environment = String(value || "").trim();
  if (!BROKER_ENVIRONMENTS.includes(environment)) {
    throw new Error(`${fieldName} must be live or paper`);
  }
  return environment;
}

export function validateResearchPromotionSelectedAccount(args) {
  return validateResearchPromotionSelectedAccountImpl(args, {
    cleanChoice,
    cleanSlug,
    SUPPORTED_PLATFORMS,
    BROKER_ENVIRONMENTS,
    supportedBrokerEnvironmentsForPlatform,
    supportedDomainsForAccount,
    PLATFORM_CONFIG,
    assertDcaPlatform,
    cleanExecutionMode,
  });
}

export function researchPromotionCandidateIdentity(ticket) {
  return {
    strategy_profile: String(ticket?.strategy_profile || ""),
    domain: String(ticket?.domain || ""),
    proposed_params:
      ticket?.proposed_params && typeof ticket.proposed_params === "object" && !Array.isArray(ticket.proposed_params)
        ? ticket.proposed_params
        : {},
    search_iterations: Number(ticket?.search_iterations || 0),
    shadow_evidence_kind: String(ticket?.shadow_evidence_kind || ""),
  };
}

export function researchPromotionCandidatesMatch(left, right) {
  return (
    canonicalResearchTaskJson(researchPromotionCandidateIdentity(left))
    === canonicalResearchTaskJson(researchPromotionCandidateIdentity(right))
  );
}

export function assertResearchPromotionExpectedCandidate(ticket, raw, { requireExpectedParams = false } = {}) {
  if (requireExpectedParams && !Object.prototype.hasOwnProperty.call(raw || {}, "expected_proposed_params")) {
    throw new HttpError("accept requires expected_proposed_params", 400);
  }
  if (!Object.prototype.hasOwnProperty.call(raw || {}, "expected_proposed_params")) return;
  const expected = raw.expected_proposed_params;
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new HttpError("expected_proposed_params must be an object", 400);
  }
  const stored = ticket.proposed_params || {};
  if (canonicalResearchTaskJson(expected) !== canonicalResearchTaskJson(stored)) {
    throw new HttpError("expected_proposed_params does not match stored ticket candidate", 409);
  }
  if (raw.expected_strategy_profile != null) {
    if (String(raw.expected_strategy_profile).trim() !== ticket.strategy_profile) {
      throw new HttpError("expected_strategy_profile does not match stored ticket", 409);
    }
  }
  if (raw.expected_domain != null) {
    if (String(raw.expected_domain).trim() !== ticket.domain) {
      throw new HttpError("expected_domain does not match stored ticket", 409);
    }
  }
}

export function applyResearchPromotionDecision(
  ticket,
  {
    decision,
    confirmation = null,
    paperSupported = false,
    selectedAccount = null,
    accountOptions = null,
    strategyProfiles = null,
    decidedAt = null,
    expectedRaw = null,
  },
) {
  if (ticket.state !== "awaiting_human") {
    throw new HttpError(`ticket ${ticket.ticket_id} is not awaiting human (state=${ticket.state})`, 409);
  }
  const normalized = String(decision || "").trim().toLowerCase();
  if (normalized !== "accept" && normalized !== "reject") {
    throw new HttpError("decision must be accept or reject", 400);
  }
  assertResearchPromotionExpectedCandidate(ticket, expectedRaw || {}, {
    requireExpectedParams: normalized === "accept",
  });
  const stamp = decidedAt || new Date().toISOString();
  const next = {
    ...ticket,
    human_decision: normalized,
    human_decided_at: stamp,
    live_authority_granted: false,
    updated_at: stamp,
    notes: [...(ticket.notes || [])],
  };
  if (normalized === "accept") {
    if (!confirmation) {
      throw new HttpError(
        "accept requires confirmation (target_platform, execution_mode, risk_profile)",
        400,
      );
    }
    const confirmed = normalizePromotionConfirmation(confirmation, "confirmation", {
      paperSupported: Boolean(paperSupported),
    });
    if (!selectedAccount) {
      throw new HttpError("accept requires selected_account", 400);
    }
    validateResearchPromotionSelectedAccount({
      ticket,
      selectedAccount,
      confirmation: confirmed,
      accountOptions,
      strategyProfiles,
    });
    next.confirmation_target_platform = confirmed.target_platform;
    next.confirmation_execution_mode = confirmed.execution_mode;
    next.confirmation_risk_profile = confirmed.risk_profile;
    next.state = "human_accepted";
    next.notes.push(
      "human_accepted_intent_only_no_live_authority",
      `confirmation_platform=${confirmed.target_platform}`,
      `confirmation_mode=${confirmed.execution_mode}`,
      `confirmation_risk_profile=${confirmed.risk_profile}`,
    );
  } else {
    next.state = "human_rejected";
    next.notes.push("human_rejected");
  }
  return next;
}

export async function syncResearchPromotionTicketResponse(request, env) {
  return syncResearchPromotionTicketResponseImpl(request, env, {
    readBoundedJson,
    publishHumanPromotionMaterial,
    appendAuditLog,
  });
}

export async function fetchResearchPromotionTicketResponse(request, env) {
  return fetchResearchPromotionTicketResponseImpl(request, env, {
    promotionTicketWithAuthority,
  });
}

export async function listResearchPromotionTickets(env) {
  return listResearchPromotionTicketsImpl(env, {
    readHumanDecisionAuthority,
    overlayPromotionDecision,
    humanDecisionAuthorityView,
  });
}

export async function researchPromotionTicketsResponse(request, env) {
  return researchPromotionTicketsResponseImpl(request, env, {
    exactHumanDecisionResponse,
    listResearchPromotionTickets,
    researchPromotionReviewBinding,
    ResearchPromotionReviewMaterialError,
    RESEARCH_PROMOTION_REVIEW_INVALID,
    researchPromotionMaterialKey,
    promotionReviewBindingsMatch,
    attachResearchPromotionApplicationPreparation,
    loadAccountOptionsConfig,
    loadStrategyProfilesConfig,
    publicResearchPromotionApplication,
  });
}

const DECISION_POLICY = Object.freeze({
  no_order: true,
  execution_authority_granted: false,
  current_evidence_required: true,
  human_confirmation_required: true,
  notice: "只记录人工决定意图；不会下单、变更资金或启用实盘。",
});

export function decisionInboxSources() {
  return {
    owner: ownerDecisionQueueResponse,
    promotion: researchPromotionTicketsResponse,
    recovery: reconciliationRecoveryResponse,
    credential: (request, env) => credentialMaintenanceResponse(
      request, env, new URL("/api/credential-maintenance", request.url),
    ),
  };
}

export function decodeDecisionApiId(raw) {
  let id;
  try {
    id = decodeURIComponent(String(raw || ""));
  } catch {
    return null;
  }
  const parts = decisionCategoryPart(id);
  if (parts) return { id, category: parts.category, subject_id: parts.subject_id };
  const legacyCredential = /^credential:(.+)$/.exec(id);
  if (!legacyCredential || legacyCredential[1].length > 256 || /[\u0000-\u001f\u007f]/.test(legacyCredential[1])) return null;
  return { id, category: "credential_maintenance", subject_id: legacyCredential[1] };
}

export function decodeOperationApiId(raw) {
  let id;
  try {
    id = decodeURIComponent(String(raw || ""));
  } catch {
    return null;
  }
  const match = /^operation:(owner_decision|strategy_promotion|paper_account_application|reconciliation_recovery|credential_maintenance):(.+)$/.exec(id);
  if (!match || match[2].length > 256 || /[\u0000-\u001f\u007f]/.test(match[2])) return null;
  return { id, category: match[1], subject_id: match[2] };
}

const DECISION_SOURCE_BY_CATEGORY = Object.freeze({
  owner_decision: "owner",
  strategy_promotion: "promotion",
  paper_account_application: "promotion",
  reconciliation_recovery: "recovery",
  credential_maintenance: "credential",
});

/**
 * Absence is only proven when the owning source was read. A failed or
 * unavailable source stays a 503 so a missing id never masks a broken read.
 */
export function decisionSourceUnreadable(queue, category) {
  const name = DECISION_SOURCE_BY_CATEGORY[category];
  const source = (queue?.sources || []).find((entry) => entry.source === name);
  if (!source) return true;
  return ["read_failed", "unavailable"].includes(source.status);
}

// The durable record keeps the operation id in its request key. The id names the
// recorded intent; a legacy fingerprint key carries no client operation id.
export function recordedDecisionOperationId(record) {
  const match = /^id:(?:owner|promotion|recovery):(.+)$/.exec(
    typeof record?.request_key === "string" ? record.request_key : "",
  );
  return match ? match[1] : null;
}

// The recorded intent's canonical target: accepted selection for promotion, action elsewhere.
export function decisionIntentTargetJson(category, action, selection) {
  if (category === "strategy_promotion" || category === "paper_account_application") {
    const accepted = action === "accept" ? selection : null;
    return canonicalResearchTaskJson({
      selected_account: accepted?.selected_account ?? null,
      confirmation: accepted?.confirmation ?? null,
    });
  }
  return canonicalResearchTaskJson({ decision: action });
}

// A terminal item synthesized from the durable record. It keeps the original
// decision id resolvable after the pending projection drops or recategorizes it.
export function durableDecisionItem(record, parsed, kind, aliasItem = null) {
  const material = /^[0-9a-f]{64}$/.test(record.material_key || "") ? record.material_key : null;
  const reviewSha = /^[0-9a-f]{64}$/.test(record.payload?.review_binding?.review_sha256 || "")
    ? record.payload.review_binding.review_sha256 : null;
  const binding = {
    kind,
    subject_id: record.subject_id,
    material_sha256: material,
    ...(reviewSha ? { review_binding: { schema_version: "qsl_promotion_review_binding.v2", review_sha256: reviewSha } } : {}),
  };
  return {
    id: parsed.id,
    short_id: shortId(parsed.id),
    decision_id: parsed.id,
    category: parsed.category,
    title_key: `decisions.${parsed.category}`,
    revision: decisionRevision(binding, parsed.id),
    actionable: false,
    blocking_reason_codes: ["decision_already_decided"],
    allowed_actions: [],
    request_id_required: false,
    action_endpoint: null,
    decision_state: {
      status: "decided",
      action: record.action,
      decided_at: typeof record.decided_at === "string" ? record.decided_at : null,
    },
    decision_binding: binding,
    operation_reference: aliasItem?.operation_reference
      || decisionOperationReference({}, parsed.category, parsed.subject_id),
    source: "durable_human_decision_record",
  };
}

export async function loadDecisionById(request, env, parsed) {
  // Detail and action routes address one decision by id. Reading the unpaged
  // projection keeps them independent of the presentation page a client last saw.
  const queue = await inbox(request, env, decisionInboxSources(), { paginate: false });
  const item = queue.items.find((entry) => entry.id === parsed.id) || null;
  if (item) return { queue, item, authorityRaw: undefined };
  // A terminal record outlives the pending projection: accepted paper tickets are
  // recategorized and rejected tickets leave the queue, so resolve them durably.
  const kind = decisionKind(parsed.category);
  if (!kind || !hasRuntimeInstanceStore(env)) return { queue, item: null, authorityRaw: undefined };
  let authorityRaw;
  try {
    authorityRaw = await readHumanDecisionAuthority(env, kind, parsed.subject_id);
  } catch {
    throw new HttpError("decision_authority_unavailable", 503);
  }
  const record = authorityRaw?.migrated === false ? null : authorityRaw?.decision;
  if (!record || record.kind !== kind || record.subject_id !== parsed.subject_id)
    return { queue, item: null, authorityRaw };
  const alias = queue.items.find((entry) => entry.decision_binding?.subject_id === parsed.subject_id
    && entry.decision_binding?.kind === kind);
  return { queue, item: durableDecisionItem(record, parsed, kind, alias || null), authorityRaw };
}

export async function readDecisionAuthorityOrNull(env, kind, subjectId) {
  if (!kind) return null;
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  return readHumanDecisionAuthority(env, kind, subjectId);
}

export async function decisionReviewResponse(request, env, rawId) {
  if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required", error_state: "unauthorized" }, 401);
  const parsed = decodeDecisionApiId(rawId);
  if (!parsed) return json({ ok: false, error: "decision_id_invalid" }, 400);
  const { queue, item, authorityRaw: loadedAuthority } = await loadDecisionById(request, env, parsed);
  if (!item) {
    if (decisionSourceUnreadable(queue, parsed.category))
      return json({ ok: false, error: "decision_source_unavailable", error_state: queue.error_state || null }, 503);
    return json({ ok: false, error: "decision_not_found" }, 404);
  }
  const kind = decisionKind(parsed.category);
  let authorityRaw;
  try {
    authorityRaw = loadedAuthority !== undefined
      ? loadedAuthority
      : await readDecisionAuthorityOrNull(env, kind, parsed.subject_id);
  } catch {
    return json({ ok: false, error: "decision_authority_unavailable" }, 503);
  }
  const authority = authorityRaw ? humanDecisionAuthorityView(authorityRaw) : null;
  const now = Date.now();
  let receipt = null;
  const errors = [];
  if (authorityRaw?.decision) {
    try {
      receipt = await humanDecisionReceipt(authorityRaw.decision, {
        kind,
        subject_id: parsed.subject_id,
        material_sha256: authorityRaw.decision.material_key,
      });
    } catch {
      errors.push("decision_receipt_unavailable");
    }
  }
  if (authorityRaw?.migrated === false) errors.push("decision_authority_unavailable");
  if (queue.status !== "ok") errors.push("decision_source_partial");
  return json({
    schema_version: DECISION_REVIEW_SCHEMA_VERSION,
    server_time: new Date(now).toISOString(),
    data_status: errors.length ? "partial" : "ready",
    decision_id: item.id,
    decision: item,
    current_eligibility: decisionCurrentEligibility(item, authority, now),
    decision_authority: authority,
    decision_receipt: receipt,
    operation: item.operation_reference,
    policy: DECISION_POLICY,
    tier_policies: riskTierPolicyCatalog(),
    errors: [...new Set(errors)],
  });
}

export function decisionSelection(raw) {
  const selection = raw?.selection;
  if (!selection || Array.isArray(selection) || typeof selection !== "object") return null;
  return {
    confirmation: selection.confirmation && typeof selection.confirmation === "object" && !Array.isArray(selection.confirmation)
      ? selection.confirmation : null,
    selected_account: selection.selected_account && typeof selection.selected_account === "object" && !Array.isArray(selection.selected_account)
      ? selection.selected_account : null,
  };
}

export async function decisionActionResponse(request, env, rawId) {
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required", error_state: "unauthorized" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  const parsed = decodeDecisionApiId(rawId);
  if (!parsed) return json({ ok: false, error: "decision_id_invalid" }, 400);
  const supported = DECISION_ACTIONS[parsed.category] || [];
  const kind = decisionKind(parsed.category);
  if (!kind || !supported.length) return json({ ok: false, error: "decision_not_actionable" }, 409);

  let raw;
  try {
    raw = await readBoundedJson(request, DECISION_ACTION_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid decision action" }, error.status || 400);
  }
  if (!raw || Array.isArray(raw) || typeof raw !== "object")
    return json({ ok: false, error: "decision_action_request_invalid" }, 400);
  if (Object.keys(raw).some((key) => !["action", "expected_revision", "expected_expires_at", "request_id", "operation_id", "selection"].includes(key)))
    return json({ ok: false, error: "decision_action_request_invalid" }, 400);
  const action = typeof raw.action === "string" ? raw.action.trim() : "";
  if (!supported.includes(action))
    return json({ ok: false, error: "decision_action_invalid" }, 400);
  if (typeof raw.expected_revision !== "string" || !/^rev[0-9]-[0-9a-z-]{1,64}$/.test(raw.expected_revision))
    return json({ ok: false, error: "decision_revision_required" }, 400);
  const requestId = typeof raw.request_id === "string" ? raw.request_id.trim() : "";
  // The operation id names the intent. It is the durable idempotency key, so a
  // retry with the same id replays and a new intent needs a new id.
  const operationId = decisionOperationId(raw);
  if (!operationId) {
    if (requestId && !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))
      return json({ ok: false, error: "invalid request_id" }, 400);
    return json({ ok: false, error: "decision_operation_id_invalid" }, 400);
  }
  const operationSha256 = await decisionOperationSha256(parsed.id, raw);
  const selection = decisionSelection(raw);
  if ((parsed.category === "strategy_promotion" || parsed.category === "paper_account_application")
    && action === "accept" && (!selection?.confirmation || !selection?.selected_account))
    return json({ ok: false, error: "decision_selection_required" }, 400);

  const { queue, item } = await loadDecisionById(request, env, parsed);
  if (!item) {
    if (decisionSourceUnreadable(queue, parsed.category))
      return json({ ok: false, error: "decision_source_unavailable", error_state: queue.error_state || null }, 503);
    return json({ ok: false, error: "decision_not_found" }, 404);
  }
  const now = Date.now();
  const serverTime = new Date(now).toISOString();
  let authorityRaw;
  try {
    authorityRaw = await readHumanDecisionAuthority(env, kind, parsed.subject_id);
  } catch {
    return json({ ok: false, error: "decision_authority_unavailable", server_time: serverTime }, 503);
  }
  const authority = humanDecisionAuthorityView(authorityRaw);
  const materialKey = item.decision_binding?.material_sha256 || null;
  const existing = authorityRaw?.decision;
  if (existing && materialKey && existing.material_key === materialKey) {
    // The durable request key keeps the operation id that produced the record.
    const recordedOperationId = recordedDecisionOperationId(existing);
    // A retry replays only when the recorded operation id and the complete
    // canonical intent match. Any other intent on the same material conflicts,
    // whether it reuses the id or presents a new one with the same action.
    let recordedTarget = null;
    try {
      recordedTarget = canonicalResearchTaskJson(JSON.parse(existing.target_json || "{}"));
    } catch {
      recordedTarget = null;
    }
    const intentMatches = recordedOperationId !== null && recordedOperationId === operationId
      && recordedTarget !== null
      && recordedTarget === decisionIntentTargetJson(parsed.category, action, selection);
    if (existing.kind !== kind || existing.subject_id !== parsed.subject_id || existing.action !== action
      || !intentMatches) {
      return json({
        ok: false,
        error: "decision_operation_conflict",
        decision_id: item.id,
        operation_id: operationId,
        recorded_operation_id: recordedOperationId,
        server_time: serverTime,
      }, 409);
    }
    const receipt = await humanDecisionReceipt(existing, {
      kind, subject_id: parsed.subject_id, material_sha256: materialKey,
    });
    return json({
      schema_version: DECISION_ACTION_SCHEMA_VERSION,
      ok: true,
      replayed: true,
      decision_id: item.id,
      revision: item.revision,
      action,
      operation_id: operationId,
      operation_sha256: operationSha256,
      decision_receipt: receipt,
      decided_at: existing.decided_at,
      decision_state: { status: "decided", action, decided_at: existing.decided_at },
      operation: item.operation_reference,
      policy: DECISION_POLICY,
      server_time: serverTime,
    });
  }
  if (raw.expected_revision !== item.revision)
    return json({ ok: false, error: "decision_revision_conflict", decision_id: item.id, server_time: serverTime }, 409);
  if (raw.expected_expires_at !== undefined && raw.expected_expires_at !== item.expires_at)
    return json({ ok: false, error: "decision_expiry_changed", decision_id: item.id, server_time: serverTime }, 409);
  if (decisionExpiryState(item.expires_at, now) !== "active")
    return json({ ok: false, error: "decision_expired", decision_id: item.id, server_time: serverTime }, 409);
  if (decisionExpiryState(authority?.expires_at, now) !== "active")
    return json({ ok: false, error: "decision_expired", decision_id: item.id, server_time: serverTime }, 409);
  if (authority?.blocked === true)
    return json({ ok: false, error: "decision_legacy_blocked", decision_id: item.id, server_time: serverTime }, 409);
  if (authority?.eligible === false)
    return json({ ok: false, error: "decision_material_ineligible", decision_id: item.id, server_time: serverTime }, 409);
  if (item.actionable !== true)
    return json({
      ok: false, error: "decision_not_actionable", decision_id: item.id,
      blocking_reason_codes: item.blocking_reason_codes || [], server_time: serverTime,
    }, 409);
  if (!(item.allowed_actions || []).some((entry) => entry.action === action))
    return json({ ok: false, error: "decision_action_not_allowed", decision_id: item.id, server_time: serverTime }, 409);
  if (!materialKey)
    return json({ ok: false, error: "decision_evidence_unavailable", decision_id: item.id, server_time: serverTime }, 409);

  let targetPath;
  let innerBody;
  if (parsed.category === "owner_decision") {
    targetPath = "/api/owner-decisions";
    innerBody = {
      candidate_id: parsed.subject_id,
      decision: action,
      candidate_evidence_sha256: materialKey,
      request_id: operationId,
    };
  } else if (parsed.category === "reconciliation_recovery") {
    targetPath = "/api/reconciliation-recovery-confirmations";
    if (item.initial_enrollment) {
      innerBody = {
        mode: "initial_enrollment",
        recovery_id: parsed.subject_id,
        candidate_sha256: item.initial_enrollment.candidate_sha256,
        facts_sha256: item.initial_enrollment.facts_sha256,
        decision: action,
        request_id: operationId,
      };
    } else {
      innerBody = {
        recovery_id: parsed.subject_id,
        candidate_sha256: item.evidence_summary?.candidate_sha256,
        dual_review_binding_sha256: item.evidence_summary?.dual_review_binding_sha256,
        decision: action,
        request_id: operationId,
      };
    }
  } else {
    targetPath = "/api/research-promotion-decisions";
    let ticket;
    try {
      ticket = await loadStoredResearchPromotionTicket(env, parsed.subject_id);
    } catch (error) {
      return json({
        ok: false, error: error.message || "research promotion ticket unavailable",
        decision_id: item.id, server_time: serverTime,
      }, error.status || 503);
    }
    innerBody = {
      ticket_id: parsed.subject_id,
      decision: action,
      expected_proposed_params: ticket.proposed_params,
      expected_material_sha256: materialKey,
      ...(item.decision_binding?.review_binding?.review_sha256
        ? { expected_review_sha256: item.decision_binding.review_binding.review_sha256 } : {}),
      ...(action === "accept" && selection ? {
        confirmation: selection.confirmation,
        selected_account: selection.selected_account,
      } : {}),
      request_id: operationId,
    };
  }

  const innerResponse = await ({
    "/api/owner-decisions": recordOwnerDecisionResponse,
    "/api/reconciliation-recovery-confirmations": recordReconciliationRecoveryConfirmationResponse,
    "/api/research-promotion-decisions": recordResearchPromotionDecisionResponse,
  })[targetPath](new Request(new URL(targetPath, request.url), {
    method: "POST",
    headers: new Headers(request.headers),
    body: JSON.stringify(innerBody),
  }), env);
  let payload = null;
  try {
    payload = await innerResponse.json();
  } catch {
    payload = null;
  }
  if (!innerResponse.ok || payload?.ok !== true) {
    return json({
      ...(payload && typeof payload === "object" ? payload : { ok: false, error: "decision_action_unavailable" }),
      schema_version: DECISION_ACTION_SCHEMA_VERSION,
      decision_id: item.id,
      action,
      server_time: serverTime,
    }, innerResponse.status || 503);
  }
  const decidedAt = payload.intent?.decided_at
    || payload.confirmation?.confirmed_at
    || payload.ticket?.human_decided_at
    || null;
  return json({
    schema_version: DECISION_ACTION_SCHEMA_VERSION,
    ok: true,
    replayed: payload.replayed === true,
    decision_id: item.id,
    revision: item.revision,
    action,
    operation_id: operationId,
    operation_sha256: operationSha256,
    decision_receipt: payload.decision_receipt || null,
    decided_at: decidedAt,
    decision_state: { status: "decided", action, decided_at: decidedAt },
    operation: item.operation_reference,
    policy: DECISION_POLICY,
    server_time: serverTime,
  });
}

export function operationDecisionStatus(category, decision, application) {
  const promoted = category === "strategy_promotion" || category === "paper_account_application";
  if (promoted && application) {
    return { status: operationStatusFromApplication(application), reason_code: application.reason_code || null };
  }
  if (!decision) return { status: "unaccepted", reason_code: "decision_pending" };
  // The operation records the human decision; it never implies activation.
  if (promoted) return decision.action === "accept"
    ? { status: "accepted", reason_code: "application_not_created" }
    : { status: "failed", reason_code: "decision_rejected" };
  return { status: "accepted", reason_code: "operation_not_connected" };
}

export async function operationResponse(request, env, rawId) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required", error_state: "unauthorized" }, 401);
  const parsed = decodeOperationApiId(rawId);
  if (!parsed) return json({ ok: false, error: "operation_not_found" }, 404);
  const now = Date.now();
  const serverTime = new Date(now).toISOString();
  const kind = decisionKind(parsed.category);
  if (kind && !hasRuntimeInstanceStore(env))
    return json({ ok: false, error: "runtime_instances_not_bound", server_time: serverTime }, 503);

  let authorityRaw = null;
  let ticket = null;
  if (kind) {
    try {
      if (parsed.category === "strategy_promotion" || parsed.category === "paper_account_application") {
        ticket = await loadStoredResearchPromotionTicket(env, parsed.subject_id);
      }
      authorityRaw = await readHumanDecisionAuthority(env, kind, parsed.subject_id);
    } catch (error) {
      return json({
        ok: false, error: error.message || "operation_unavailable",
        operation_id: parsed.id, server_time: serverTime,
      }, error.status || 503);
    }
  }
  let application = null;
  if (kind === "promotion") {
    try {
      const stored = await runtimeInstanceCommand(env, {
        action: "application_latest", actor: session.login, ticket_id: parsed.subject_id,
      });
      application = stored.application || null;
    } catch {
      return json({ ok: false, error: "operation_unavailable", operation_id: parsed.id, server_time: serverTime }, 503);
    }
  }
  const decision = authorityRaw?.decision || null;
  const status = operationDecisionStatus(parsed.category, decision, application);
  const publicApplication = application ? publicResearchPromotionApplication(application) : null;
  return json({
    schema_version: OPERATION_SCHEMA_VERSION,
    server_time: serverTime,
    data_status: "ready",
    operation: {
      id: parsed.id,
      decision_id: `${parsed.category}:${parsed.subject_id}`,
      kind: kind || parsed.category,
      subject_id: parsed.subject_id,
      status: status.status,
      reason_code: status.reason_code,
      activation_status: "not_connected",
      updated_at: publicApplication?.updated_at || decision?.decided_at || ticket?.updated_at || null,
      dispatch: publicApplication ? {
        status: publicApplication.dispatch_state || "unknown",
        workflow_run_id: publicApplication.workflow_run_id || null,
        updated_at: publicApplication.updated_at || null,
      } : null,
      application: publicApplication,
    },
    decision: decision ? {
      material_sha256: /^[0-9a-f]{64}$/.test(decision.material_key || "") ? decision.material_key : null,
      action: decision.action,
      decided_at: decision.decided_at,
    } : null,
    policy: DECISION_POLICY,
    errors: [],
  });
}

// Event type by normalized projection source. Comparing the normalized source
// keeps a promotion application from being reported as an account-settings approval.
export function auditEventAction(source, kind) {
  if (source === "durable_human_decision") return `record_${kind}_decision`;
  if (source === "research_promotion_application") return "research_promotion_application";
  if (source === "account_settings_application") return "account_settings_approval";
  return null;
}

export function auditEventSubjectId(row) {
  if (typeof row.ticket_id === "string" && row.ticket_id) return { kind: "strategy_promotion", id: row.ticket_id };
  if (typeof row.recovery_id === "string" && row.recovery_id) return { kind: "reconciliation_recovery", id: row.recovery_id };
  if (typeof row.candidate_id === "string" && row.candidate_id) return { kind: "owner_decision", id: row.candidate_id };
  if (typeof row.platform === "string" && typeof row.key === "string") return { kind: "account_settings", id: `${row.platform}:${row.key}` };
  return null;
}

export async function auditEventsResponse(request, env, url) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required", error_state: "unauthorized" }, 401);
  let page;
  try {
    page = auditPageQuery(url);
  } catch {
    return json({ ok: false, error: "invalid_pagination" }, 400);
  }
  const now = Date.now();
  const serverTime = new Date(now).toISOString();
  if (!hasRuntimeInstanceStore(env))
    return json({ ok: false, error: "runtime_instances_not_bound", server_time: serverTime }, 503);
  let rows;
  try {
    const result = await runtimeInstanceCommand(env, {
      action: "console_audit_events", actor: session.login, limit: page.limit + 1, snapshot: page.snapshot, before: page.before,
    });
    if (!Array.isArray(result.rows)) throw Error("invalid_audit_rows");
    rows = result.rows;
  } catch {
    return json({ ok: false, error: "audit_projection_unavailable", server_time: serverTime }, 503);
  }
  const events = [];
  for (const row of rows) {
    const occurredAt = typeof row.occurred_at === "string" && Number.isFinite(Date.parse(row.occurred_at))
      ? row.occurred_at : null;
    if (!occurredAt) return json({ ok: false, error: "audit_projection_invalid" }, 503);
    if (row.source === "credential_rotation") {
      events.push({ id: row.event_id, event_id: row.event_id, occurred_at: occurredAt,
        actor_alias: await actorAlias(row.actor || null), action: row.action,
        subject: { kind: "credential", id: "ibkr_flex" }, operation_id: row.ref ?? null, outcome: row.status });
      continue;
    }
    const source = row.source === "decision" ? "durable_human_decision"
      : row.source === "promotion_application" ? "research_promotion_application"
        : row.source === "account_settings_application" ? "account_settings_application"
          : null;
    if (!source) return json({ ok: false, error: "audit_projection_invalid" }, 503);
    const subject = source === "durable_human_decision"
      ? { kind: `${row.kind}_decision`, id: row.subject_id }
      : source === "research_promotion_application"
        ? { kind: "strategy_promotion", id: row.subject_id }
        : { kind: "account_settings", id: row.subject_id };
    if (typeof subject.id !== "string" || !subject.id || subject.id.length > 256) return json({ ok: false, error: "audit_projection_invalid" }, 503);
    const revision = /^[0-9a-f]{64}$/.test(row.revision || "") ? row.revision : null;
    events.push({
      id: `${source}:${row.ref}`,
      source,
      occurred_at: occurredAt,
      action: auditEventAction(source, row.kind),
      actor_alias: await actorAlias(row.actor || null),
      subject,
      revision,
      outcome: typeof row.status === "string" && row.status.length <= 40 ? row.status : null,
      ref: source === "durable_human_decision"
        ? `/api/decisions/${encodeURIComponent(`${row.kind === "promotion" ? "strategy_promotion" : row.kind === "owner" ? "owner_decision" : "reconciliation_recovery"}:${row.subject_id}`)}`
        : source === "research_promotion_application"
          ? `/api/operations/${encodeURIComponent(`operation:strategy_promotion:${row.subject_id}`)}`
          : null,
    });
  }
  try {
    if (!hasConfigStore(env)) throw Error("audit_log_unavailable");
    const storedLog = await readConfigJson(env, AUDIT_LOG_KEY);
    if (storedLog !== null && !Array.isArray(storedLog)) throw Error("audit_log_invalid");
    const log = storedLog || [];
    const ids = await Promise.all(log.map(row => cycleHealthSha256(row)));
    const occurrences = new Map();
    const aliases = await Promise.all(log.map((row) =>
      actorAlias(typeof row?.login === "string" ? row.login : null)));
    log.forEach((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw Error("audit_log_invalid");
      const occurredAt = typeof row.ts === "string" && Number.isFinite(Date.parse(row.ts)) ? row.ts : null;
      const action = typeof row.action === "string" && row.action.length <= 64 ? row.action : null;
      if (!occurredAt || !action) throw Error("audit_log_invalid");
      const subject = auditEventSubjectId(row);
      const occurrence = occurrences.get(ids[index]) || 0;
      occurrences.set(ids[index], occurrence + 1);
      events.push({
        id: `bounded_audit_log:${ids[index]}:${occurrence}`,
        source: "bounded_audit_log",
        occurred_at: new Date(occurredAt).toISOString(),
        action,
        actor_alias: aliases[index] || null,
        subject,
        revision: null,
        outcome: "recorded",
        ref: null,
      });
    });
  } catch {
    return json({ ok: false, error: "audit_log_unavailable", server_time: serverTime }, 503);
  }
  const seen = new Set();
  const unique = events
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .filter(event => auditEventInPage(event, page))
    .sort(auditEventOrder);
  const pageEvents = unique.slice(0, page.limit);
  return json({
    schema_version: AUDIT_EVENTS_SCHEMA_VERSION,
    server_time: serverTime,
    data_status: "ready",
    events: pageEvents.map(event => { if (!event.event_id) return event; const { id, ...safe } = event; return safe; }),
    next_cursor: unique.length > page.limit ? auditNextCursor(pageEvents.at(-1), page) : null,
    coverage: "durable_human_decisions_and_application_records_and_bounded_audit_log",
    policy: DECISION_POLICY,
    errors: [],
  });
}

export function attachResearchPromotionApplicationPreparation(ticket, accountOptions, strategyProfiles) {
  const blockers = new Set(["activation_not_connected"]);
  if (ticket?.shadow_passed !== true || !String(ticket?.shadow_evidence_kind || "").trim()) {
    blockers.add("research_evidence_unverified");
  }
  const params = ticket?.proposed_params;
  const strategy = (Array.isArray(strategyProfiles) ? strategyProfiles : [])
    .find((item) => item.profile === ticket.strategy_profile);
  const candidateIdentity = researchCandidateIdentityForStrategy(strategy);
  const applicationAdapter = researchCandidateApplicationAdapter(strategy);
  const candidateParamsBound = candidateIdentity
    ? Boolean(
      params
      && !Array.isArray(params)
      && typeof params === "object"
      && canonicalResearchTaskJson(params) === canonicalResearchTaskJson(candidateIdentity),
    )
    : Boolean(params && !Array.isArray(params) && typeof params === "object" && !Object.keys(params).length);
  if (!candidateParamsBound) {
    blockers.add("candidate_params_unbound");
  }
  if (!strategy) blockers.add("strategy_not_configured");
  if (candidateIdentity && !applicationAdapter) blockers.add("paper_application_adapter_unavailable");

  const confirmedPlatform = String(ticket.confirmation_target_platform || "").trim();
  const platforms = confirmedPlatform ? [confirmedPlatform] : SUPPORTED_PLATFORMS;
  const accounts = [];
  for (const platform of strategy ? platforms : []) {
    const options = Array.isArray(accountOptions?.[platform]) ? accountOptions[platform] : [];
    for (const option of options) {
      if (!supportedDomainsForAccount(platform, option).includes(ticket.domain)) continue;
      const accountBlockers = [];
      const configuredExecutionMode = cleanExecutionMode(
        option.default_execution_mode || PLATFORM_CONFIG[platform]?.default_execution_mode || "live",
      );
      if (strategy) {
        try {
          const brokerEnvironment = normalizeBrokerEnvironment(
            option.broker_environment,
            `account_options.${platform}.${option.key}.broker_environment`,
          );
          if (!supportedBrokerEnvironmentsForPlatform(platform).includes(brokerEnvironment)) {
            throw new HttpError(`${platform} does not support broker environment ${brokerEnvironment}`, 400);
          }
          const executionMode = String(
            ticket.confirmation_execution_mode || brokerEnvironment,
          ).trim().toLowerCase();
          validateResearchPromotionSelectedAccount({
            ticket,
            selectedAccount: { platform, key: option.key },
            confirmation: {
              target_platform: platform,
              execution_mode: executionMode,
              risk_profile: ticket.confirmation_risk_profile || ticket.suggested_risk_profile,
            },
            accountOptions,
            strategyProfiles,
          });
        } catch (error) {
          accountBlockers.push(researchPromotionApplicationBlocker(error));
        }
      }
      if (accountBlockers.length) continue;
      accounts.push({
        platform,
        key: option.key,
        label: option.label,
        configured_execution_mode: configuredExecutionMode,
        broker_environment: option.broker_environment,
        preflight_status: accountBlockers.length ? "blocked" : (strategy ? "ready" : "blocked"),
        blocker_codes: [...new Set(accountBlockers)],
      });
    }
  }
  if (!accounts.length) blockers.add("configured_account_missing");
  if (strategy && accounts.length && accounts.every((account) => account.preflight_status !== "ready")) {
    blockers.add("account_preflight_failed");
  }
  const candidateBlockers = [...blockers].filter((code) => code !== "activation_not_connected");
  const previewAccounts = (
    ticket?.state === "human_accepted"
    && ticket?.shadow_passed === true
    && String(ticket?.shadow_evidence_kind || "").trim()
    && candidateIdentity
    && applicationAdapter
    && strategy?.domain === "us_equity"
    && candidateParamsBound
    && candidateBlockers.length === 0
  )
    ? accounts.filter((account) => {
      const option = (accountOptions?.[account.platform] || [])
        .find((item) => item.key === account.key);
      return (
        account.platform === "longbridge"
        && account.broker_environment === "paper"
        && account.configured_execution_mode === "live"
        && String(option?.account_selector || "").trim()
      );
    })
    : [];
  const previewRequest = previewAccounts.length === 1
    ? {
      platform_id: previewAccounts[0].platform,
      account_scope: String(
        (accountOptions?.[previewAccounts[0].platform] || [])
          .find((item) => item.key === previewAccounts[0].key)?.account_selector || "",
      ).trim(),
      strategy_profile: ticket.strategy_profile,
      candidate_id: params.candidate_id,
      config_sha256: params.config_sha256,
    }
    : null;
  return {
    ...attachRiskEnvelopeView(ticket),
    application_preparation: {
      status: "blocked",
      preflight_status: candidateBlockers.length ? "blocked" : "ready",
      activation_status: "not_connected",
      dispatch_allowed: false,
      blocker_codes: [...blockers].sort(),
      account_options: accounts,
      preview_request: previewRequest,
    },
  };
}

export function researchCandidateIdentityForStrategy(strategy) {
  const identity = strategy?.research_candidate_identity;
  return identity && typeof identity === "object" && !Array.isArray(identity) ? identity : null;
}

export function researchCandidateApplicationAdapter(strategy) {
  if (strategy?.profile !== V7_PAPER_PREVIEW_PROFILE) return null;
  return {
    platform: "longbridge",
    account_key: V7_PAPER_APPLICATION_ACCOUNT_KEY,
    workflow_repository: V7_PAPER_APPLICATION_WORKFLOW_REPOSITORY,
    workflow: V7_PAPER_APPLICATION_WORKFLOW,
  };
}

export function researchPromotionApplicationBlocker(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("broker environment is unknown")) return "broker_environment_unknown";
  if (message.includes("does not support broker environment")) return "broker_environment_unsupported";
  if (message.includes("not configured")) return "strategy_not_configured";
  if (message.includes("domain") && message.includes("not supported")) return "strategy_domain_not_supported";
  if (message.includes("live-enabled") || message.includes("blocked for live") || message.includes("does not allow")) {
    return "strategy_execution_not_allowed";
  }
  if (message.includes("configured account")) return "configured_account_mismatch";
  return "account_preflight_failed";
}

export async function recordResearchPromotionDecisionResponse(request, env) {
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "STRATEGY_SWITCH_CONFIG KV binding is required" }, 503);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, 8 * 1024);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid research promotion decision" }, error.status || 400);
  }
  const ticketId = String(raw?.ticket_id || "").trim();
  const decision = String(raw?.decision || "").trim().toLowerCase();
  if (!ticketId) return json({ ok: false, error: "ticket_id is required" }, 400);
  const stored = await readConfigJson(env, researchPromotionTicketKey(ticketId));
  if (!stored) return json({ ok: false, error: "research promotion ticket not found" }, 404);
  let ticket;
  try {
    ticket = normalizeResearchPromotionTicket(stored);
    assertResearchPromotionExpectedCandidate(ticket, raw, { requireExpectedParams: decision === "accept" });
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid research promotion decision" }, error.status || 400);
  }
  const materialKey = await researchPromotionMaterialKey(ticket);
  // Keep the legacy material index stable; the separate review digest binds the complete producer review.
  if (Object.prototype.hasOwnProperty.call(raw, "expected_material_sha256") && raw.expected_material_sha256 !== materialKey) {
    return json({ ok: false, error: "human_decision_material_conflict" }, 409);
  }
  const reviewMaterial = researchPromotionReviewMaterial(ticket);
  const reviewBinding = await researchPromotionReviewBinding(ticket);
  const selectedAccount = raw?.selected_account || null;
  const confirmation = raw?.confirmation || null;
  const target = { selected_account: selectedAccount, confirmation };
  const targetJson = canonicalResearchTaskJson(target);
  let authority;
  try {
    authority = await readHumanDecisionAuthority(env, "promotion", ticket.ticket_id);
  } catch (error) {
    return json({ ok: false, error: error.message || "research promotion decision unavailable" }, error.status || 503);
  }
  if (authority.migrated !== false) {
    if (authority.blocked) return json({ ok: false, error: "human_decision_legacy_blocked" }, 409);
    if (authority.eligible !== true || authority.material_key !== materialKey) {
      return json({ ok: false, error: "human_decision_material_conflict" }, 409);
    }
    const existing = authority.decision;
    if (existing && existing.action === decision && existing.target_json === targetJson && existing.payload?.ticket) {
      if (Object.prototype.hasOwnProperty.call(raw, "expected_review_sha256")
        && (existing.payload.review_binding?.schema_version !== "qsl_promotion_review_binding.v2"
          || raw.expected_review_sha256 !== existing.payload.review_binding.review_sha256)) {
        return json({ ok: false, error: "human_decision_review_binding_unqualified" }, 409);
      }
      return json({
        ok: true,
        ticket: attachRiskEnvelopeView(existing.payload.ticket),
        live_authority_granted: false,
        replayed: true,
        actor: existing.actor,
        decision_receipt: await humanDecisionReceipt(existing, { kind: "promotion", subject_id: ticket.ticket_id, material_sha256: materialKey }),
      });
    }
    if (existing) return json({ ok: false, error: "human_decision_conflict" }, 409);
  }
  if (Object.prototype.hasOwnProperty.call(raw, "expected_review_sha256") && raw.expected_review_sha256 !== reviewBinding.review_sha256) {
    return json({ ok: false, error: "human_decision_review_material_conflict" }, 409);
  }
  const targetPlatform = String(
    raw?.confirmation?.target_platform || ticket.confirmation_target_platform || "",
  ).trim();
  const paperSupported = platformSupportsBrokerPaperMode(targetPlatform);
  const accountConfig = decision === "accept" ? await loadAccountOptionsConfig(env) : null;
  const serverAccountRevision = accountConfig?.source === "durable_object" && Number.isSafeInteger(accountConfig.revision)
    ? accountConfig.revision
    : null;
  const strategyProfiles = decision === "accept" ? await loadStrategyProfilesConfig(env) : null;
  let decided;
  try {
    decided = applyResearchPromotionDecision(ticket, {
      decision,
      confirmation,
      paperSupported,
      selectedAccount,
      accountOptions: accountConfig?.options,
      strategyProfiles,
      decidedAt: new Date().toISOString(),
      expectedRaw: raw,
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid research promotion decision" }, error.status || 400);
  }
  if (decided.live_authority_granted) {
    return json({ ok: false, error: "refusing to persist live_authority_granted=true" }, 500);
  }
  const preflightRevision = decision === "accept" ? serverAccountRevision : null;
  if (decision === "accept" && Object.prototype.hasOwnProperty.call(raw, "expected_account_revision")
    && Number(raw.expected_account_revision) !== serverAccountRevision) {
    return json({ ok: false, error: "runtime_instance_revision_conflict" }, 409);
  }
  const decidedAt = decided.human_decided_at || humanDecisionTimestamp();
  let requestKey;
  try {
    requestKey = await humanDecisionRequestKey({
      requestId: raw?.request_id,
      kind: "promotion",
      actor: session.login,
      subjectId: ticket.ticket_id,
      materialKey,
      action: decision,
      target,
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid research promotion decision" }, error.status || 400);
  }
  let recorded;
  try {
    recorded = await runtimeInstanceCommand(env, {
      action: "promotion_decide",
      ...(Object.prototype.hasOwnProperty.call(raw, "expected_review_sha256") ? { review_binding: reviewBinding } : {}),
      actor: session.login,
      subject_id: ticket.ticket_id,
      material_key: materialKey,
      action_name: decision,
      request_key: requestKey,
      target_json: canonicalResearchTaskJson(target),
      decided_at: decidedAt,
      now_ms: Date.now(),
      preflight_revision: preflightRevision,
      payload: {
        ticket: decided,
        ...(Object.prototype.hasOwnProperty.call(raw, "expected_review_sha256") ? { review_binding: reviewBinding, review_material: reviewMaterial } : {}),
        selected_account: selectedAccount,
        confirmation,
        proposed_params: ticket.proposed_params,
      },
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "research promotion decision unavailable" }, error.status || 503);
  }
  const decisionReceipt = await humanDecisionReceipt(recorded.record, { kind: "promotion", subject_id: ticket.ticket_id, material_sha256: materialKey });
  const recordedTicket = recorded.record.payload.ticket;
  await mirrorConfigJson(env, researchPromotionTicketKey(recordedTicket.ticket_id), recordedTicket);
  try {
    await appendAuditLog(env, {
      ts: recordedTicket.updated_at,
      login: session.login,
      action: "research_promotion_decision",
      ticket_id: recordedTicket.ticket_id,
      decision: recordedTicket.human_decision,
      confirmation_target_platform: recordedTicket.confirmation_target_platform,
      confirmation_execution_mode: recordedTicket.confirmation_execution_mode,
      confirmation_risk_profile: recordedTicket.confirmation_risk_profile,
      suggested_risk_profile: recordedTicket.suggested_risk_profile,
      live_authority_granted: false,
    });
  } catch {
    // Decision persistence must not depend on optional audit retention.
  }
  return json({
    ok: true,
    ticket: attachRiskEnvelopeView(recordedTicket),
    decision_receipt: decisionReceipt,
    live_authority_granted: false,
    replayed: recorded.replayed === true,
  });
}

export function v7PaperApplicationCandidate(strategy, ticket) {
  if (!researchCandidateApplicationAdapter(strategy)) {
    throw new HttpError("paper application adapter is not configured for candidate", 409);
  }
  if (ticket?.shadow_evidence_kind !== "v7_nonlive_shadow_and_simulated_paper") {
    throw new HttpError("v7_shadow_evidence_kind_not_qualified", 409);
  }
  const notes = Array.isArray(ticket?.notes) ? ticket.notes : [];
  const requiredEvidence = [
    "frozen_v7_forward_financial_gates_passed_research_only",
    "forward_record_sha256",
    "financial_evidence_sha256",
    "p1_manifest_sha256",
    "p4_policy_sha256",
    "baseline_p3_evidence_sha256",
  ];
  if (notes[0] !== requiredEvidence[0] || requiredEvidence.slice(1).some((prefix) =>
    !notes.some((note) => new RegExp(`^${prefix}=[0-9a-f]{64}$`).test(String(note))))) {
    throw new HttpError("v7_shadow_evidence_provenance_incomplete", 409);
  }
  const identity = researchCandidateIdentityForStrategy(strategy);
  if (!identity || ticket?.domain !== "us_equity") {
    throw new HttpError("research_candidate_not_eligible_for_paper_application", 409);
  }
  const params = ticket?.proposed_params;
  if (!params || Array.isArray(params) || typeof params !== "object"
    || canonicalResearchTaskJson(params) !== canonicalResearchTaskJson(identity)) {
    throw new HttpError("candidate_params_unbound", 409);
  }
  return {
    candidate_id: String(identity.candidate_id || ""),
    config_sha256: String(identity.config_sha256 || ""),
  };
}

export async function loadStoredResearchPromotionTicket(env, ticketId) {
  if (!hasConfigStore(env)) throw new HttpError("research promotion KV is not configured", 503);
  const stored = await readConfigJson(env, researchPromotionTicketKey(ticketId));
  if (!stored) throw new HttpError("research promotion ticket not found", 404);
  let ticket;
  try {
    ticket = normalizeResearchPromotionTicket(stored, "stored research promotion ticket");
  } catch (error) {
    throw new HttpError(error.message || "invalid stored research promotion ticket", 409);
  }
  return promotionTicketWithAuthority(env, ticket);
}

export async function qualifyV7PaperApplication(env, { ticketId, selectedAccount, expectedRevision }) {
  assertExactFields(selectedAccount, ["platform", "key"], "selected_account");
  const platform = cleanChoice(selectedAccount.platform, SUPPORTED_PLATFORMS, "selected_account.platform");
  const key = cleanSlug(selectedAccount.key, "selected_account.key");
  if (platform !== "longbridge" || key !== V7_PAPER_APPLICATION_ACCOUNT_KEY) {
    throw new HttpError("only the configured LongBridge paper account is supported", 409);
  }
  if (!V7_PAPER_APPLICATION_TICKET_RE.test(String(ticketId || ""))) {
    throw new HttpError("research promotion ticket is not from the V7 producer", 409);
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new HttpError("runtime instance revision is required", 400);
  }
  const ticket = await loadStoredResearchPromotionTicket(env, ticketId);
  const promotionMaterialKey = await researchPromotionMaterialKey(ticket);
  const promotionAuthority = await readHumanDecisionAuthority(env, "promotion", ticket.ticket_id);
  if (promotionAuthority.blocked || promotionAuthority.eligible !== true || promotionAuthority.decision?.action !== "accept" || promotionAuthority.material_key !== promotionMaterialKey) {
    throw new HttpError("research candidate is not human_accepted", 409);
  }
  const boundAccount = promotionAuthority.decision.payload?.selected_account || {};
  if (boundAccount.platform !== platform || boundAccount.key !== key) {
    throw new HttpError("promotion_account_binding_conflict", 409);
  }
  if (ticket.state !== "human_accepted") throw new HttpError("research candidate is not human_accepted", 409);
  if (ticket.live_authority_granted !== false || ticket.shadow_passed !== true || !String(ticket.shadow_evidence_kind || "").trim()) {
    throw new HttpError("research candidate evidence is not qualified", 409);
  }
  const strategyProfiles = await loadStrategyProfilesConfig(env);
  const strategy = (Array.isArray(strategyProfiles) ? strategyProfiles : [])
    .find((item) => item.profile === ticket.strategy_profile);
  if (!strategy) throw new HttpError("selected candidate strategy profile is not configured", 409);
  const candidate = v7PaperApplicationCandidate(strategy, ticket);
  const state = await runtimeInstanceCommand(env);
  if (!state.initialized) throw new HttpError("runtime instances are not initialized", 409);
  if (state.revision !== expectedRevision) throw new HttpError("runtime instance revision conflict", 409);
  const instance = (state.instances || []).find((item) => item.kind === "existing" && item.platform === platform && item.key === key && item.retirement_status === "none");
  const config = instance?.config;
  if (!config) throw new HttpError("selected LongBridge paper account is unavailable", 409);
  if (String(config.broker_environment || "") !== "paper"
    || String(config.account_selector || "") !== V7_PAPER_APPLICATION_ACCOUNT_SCOPE
    || String(config.service_name || "") !== V7_PAPER_APPLICATION_SERVICE
    || String(config.runtime_status_target_id || "") !== "longbridge.paper"
    || String(config.default_execution_mode || "") !== "live") {
    throw new HttpError("selected LongBridge paper account binding is incomplete", 409);
  }
  const expectedStrategyProfile = String(config.default_strategy_profile || "").trim();
  if (!expectedStrategyProfile) throw new HttpError("selected account strategy profile is unknown", 409);
  validateResearchPromotionSelectedAccount({
    ticket,
    selectedAccount: { platform, key },
    confirmation: {
      target_platform: ticket.confirmation_target_platform,
      execution_mode: ticket.confirmation_execution_mode,
      risk_profile: ticket.confirmation_risk_profile,
    },
    accountOptions: { longbridge: [config] },
    strategyProfiles,
  });
  return {
    ticket,
    strategy,
    candidate,
    promotionMaterialKey,
    revision: state.revision,
    account: {
      platform_id: platform,
      account_key: key,
      account_scope: V7_PAPER_APPLICATION_ACCOUNT_SCOPE,
      account_selector: V7_PAPER_APPLICATION_ACCOUNT_SCOPE,
      service_name: V7_PAPER_APPLICATION_SERVICE,
      broker_environment: "paper",
      expected_strategy_profile: expectedStrategyProfile,
    },
  };
}

export function publicResearchPromotionApplication(application) {
  if (!application) return null;
  const { claim_token: _claimToken, ...publicApplication } = application;
  return publicApplication;
}

export async function dispatchV7PaperApplication(env, applicationId) {
  const token = String(env.RUNTIME_SETTINGS_DISPATCH_TOKEN || "");
  if (!token) throw new HttpError("paper application dispatch unavailable", 503);
  const url = `https://api.github.com/repos/${V7_PAPER_APPLICATION_WORKFLOW_REPOSITORY}/actions/workflows/${V7_PAPER_APPLICATION_WORKFLOW}/dispatches`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({ ref: "main", inputs: { application_id: applicationId } }),
  });
  if (!response.ok) throw new HttpError("paper application dispatch unverified", 502);
}

export function applicationIdFromPath(pathname) {
  const value = String(pathname || "").slice("/api/internal/research-promotion-application/".length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError("invalid application_id", 400);
  }
  return value;
}

export async function researchPromotionApplicationResponse(request, env, url) {
  return researchPromotionApplicationResponseImpl(request, env, url, {
    json,
    readSession,
    requireSameOrigin,
    readBoundedJson,
    runtimeInstanceCommand,
    assertExactFields,
    randomToken,
    qualifyV7PaperApplication,
    dispatchV7PaperApplication,
    publicResearchPromotionApplication,
    isUnsupportedApplicationActionError: (error) => (
      error instanceof HttpError
      && error.message === "unsupported_research_promotion_application_action"
    ),
    V7_PAPER_APPLICATION_MAX_BODY_BYTES,
    V7_PAPER_APPLICATION_SOURCE_COMMIT,
    V7_PAPER_APPLICATION_UES_REVISION,
  });
}

export function validateV7PaperApplicationReadback(application, readback) {
  if (!readback || typeof readback !== "object" || Array.isArray(readback)) return false;
  return readback.application_id === application.application_id
    && readback.platform_id === application.platform_id
    && readback.account_scope === application.account_scope
    && readback.service_name === application.service_name
    && readback.strategy_profile === application.strategy_profile
    && readback.candidate_id === application.candidate_id
    && readback.config_sha256 === application.config_sha256
    && readback.source_commit === application.source_commit
    && readback.ues_revision === application.approved_ues_revision
    && readback.runtime_target_enabled === false
    && typeof readback.revision_name === "string" && readback.revision_name.trim() !== "";
}

export async function researchPromotionApplicationInternalResponse(request, env, url) {
  return researchPromotionApplicationInternalResponseImpl(request, env, url, {
    json,
    requireDedicatedExecutionEvidenceSyncToken,
    hasRuntimeInstanceStore,
    applicationIdFromPath,
    readBoundedJson,
    runtimeInstanceCommand,
    assertExactFields,
    qualifyV7PaperApplication,
    validateV7PaperApplicationReadback,
    V7_PAPER_APPLICATION_MAX_BODY_BYTES,
    V7_PAPER_APPLICATION_WORKFLOW_REPOSITORY,
    V7_PAPER_APPLICATION_WORKFLOW,
  });
}

export async function normalizeResearchTask(payload, fieldName) {
  return normalizeResearchTaskImpl(payload, fieldName, {
    cleanChoice,
    CONTROL_PLANE_CANDIDATE_KINDS,
    STRATEGY_HEALTH_DOMAINS,
  });
}

export async function normalizeResearchTaskSourceSnapshot(payload, fieldName = "research task source snapshot") {
  return normalizeResearchTaskSourceSnapshotImpl(payload, fieldName, {
    cleanChoice,
    CONTROL_PLANE_CANDIDATE_KINDS,
    STRATEGY_HEALTH_DOMAINS,
    STRATEGY_HEALTH_DATA_STATUSES,
    normalizeControlPlaneIdentifier,
    normalizeStrategyHealthTimestamp,
    normalizeStrategyHealthErrors,
  });
}

export function normalizeStrategyHealthSnapshot(payload, fieldName = "strategy health snapshot") {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  if (payload.schema_version !== "strategy_health_dashboard.v1") {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const status = cleanChoice(payload.data_status || "unavailable", [...STRATEGY_HEALTH_DATA_STATUSES, "partial"], `${fieldName}.data_status`);
  const strategies = status === "unavailable"
    ? []
    : normalizeStrategyHealthStrategies(payload.strategies, fieldName);
  const summary = normalizeStrategyHealthSummary(payload.summary, strategies);
  const errors = normalizeStrategyHealthErrors(payload.errors);
  return {
    schema_version: "strategy_health_dashboard.v1",
    generated_at: normalizeStrategyHealthTimestamp(payload.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(payload.computed_at, `${fieldName}.computed_at`, true),
    data_status: status,
    summary,
    strategies,
    policy: normalizeStrategyHealthPolicy(payload.policy),
    errors,
  };
}

export function normalizeStrategyHealthStrategies(value, fieldName) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error(`${fieldName}.strategies must be an array with at most 100 items`);
  }
  const seen = new Set();
  return value.map((item, index) => {
    if (!item || Array.isArray(item) || typeof item !== "object") {
      throw new Error(`${fieldName}.strategies[${index}] must be an object`);
    }
    const profile = cleanSlug(item.profile, `${fieldName}.strategies[${index}].profile`).toLowerCase();
    if (seen.has(profile)) throw new Error(`${fieldName}.strategies contains duplicate profile`);
    seen.add(profile);
    return {
      profile,
      domain: cleanChoice(item.domain, STRATEGY_HEALTH_DOMAINS, `${fieldName}.strategies[${index}].domain`),
      as_of: sanitizeStrategyHealthText(item.as_of, `${fieldName}.strategies[${index}].as_of`, 64, true),
      status: cleanChoice(item.status, STRATEGY_HEALTH_STATUSES, `${fieldName}.strategies[${index}].status`),
      score: normalizeStrategyHealthScore(item.score, `${fieldName}.strategies[${index}].score`),
      components: normalizeStrategyHealthComponents(item.components, `${fieldName}.strategies[${index}].components`),
      decision: normalizeStrategyHealthDecision(item.decision, `${fieldName}.strategies[${index}].decision`),
      review: normalizeStrategyHealthReview(item.review, `${fieldName}.strategies[${index}].review`),
      freshness: normalizeStrategyHealthFreshness(item.freshness, `${fieldName}.strategies[${index}].freshness`),
      source_revision: sanitizeStrategyHealthText(item.source_revision, `${fieldName}.strategies[${index}].source_revision`, 120, true),
    };
  });
}

export function normalizeStrategyHealthSummary(value, strategies) {
  const counts = Object.fromEntries(STRATEGY_HEALTH_STATUSES.map((status) => [status, 0]));
  for (const item of strategies) counts[item.status] += 1;
  return { strategy_count: strategies.length, ...counts };
}

export function normalizeStrategyHealthComponents(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    performance: normalizeStrategyHealthScore(source.performance, `${fieldName}.performance`),
    risk: normalizeStrategyHealthScore(source.risk, `${fieldName}.risk`),
    decay: normalizeStrategyHealthScore(source.decay, `${fieldName}.decay`),
    stability: normalizeStrategyHealthScore(source.stability, `${fieldName}.stability`),
    operations: normalizeStrategyHealthScore(source.operations, `${fieldName}.operations`),
  };
}

export function normalizeStrategyHealthDecision(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    code: cleanSlug(source.code || "evidence_missing", `${fieldName}.code`).toLowerCase(),
    label: sanitizeStrategyHealthText(source.label, `${fieldName}.label`, 120, false, "证据不足，保持研究态"),
    reason: sanitizeStrategyHealthText(source.reason, `${fieldName}.reason`, 240, false, "没有可用的机器检查结果。"),
  };
}

export function normalizeStrategyHealthReview(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    requested_stage: sanitizeStrategyHealthText(source.requested_stage, `${fieldName}.requested_stage`, 80, true),
    evidence_package_id: sanitizeStrategyHealthText(source.evidence_package_id, `${fieldName}.evidence_package_id`, 120, true),
    validation: normalizeStrategyHealthSummaryObject(source.validation),
    risk: normalizeStrategyHealthSummaryObject(source.risk),
    kelly_readiness: normalizeStrategyHealthSummaryObject(source.kelly_readiness),
  };
}

export function normalizeStrategyHealthSummaryObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value).slice(0, 12)) {
    if (!/^[A-Za-z0-9_.-]{1,48}$/.test(key)) continue;
    if (/(token|secret|password|cookie|private|path|key)/i.test(key)) continue;
    if (typeof raw === "boolean") result[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = raw;
    else if (typeof raw === "string") {
      const safe = sanitizeStrategyHealthText(raw, "summary.value", 120, true);
      if (safe !== null) result[key] = safe;
    }
  }
  return result;
}

export function normalizeStrategyHealthFreshness(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    status: cleanChoice(source.status || "unknown", ["fresh", "stale", "unknown"], `${fieldName}.status`),
    age_seconds: normalizeStrategyHealthAge(source.age_seconds, `${fieldName}.age_seconds`),
  };
}

export function normalizeStrategyHealthAge(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 315360000) throw new Error(`${fieldName} is invalid`);
  return Math.round(number);
}

export function normalizeStrategyHealthScore(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error(`${fieldName} must be between 0 and 100`);
  return number;
}

export function normalizeStrategyHealthTimestamp(value, fieldName, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = normalizeStrategyHealthText(value, fieldName, 64);
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }
  return text;
}

export function normalizeStrategyHealthText(value, fieldName, maxLength, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = String(value || "").trim();
  if (
    !text ||
    text.length > maxLength ||
    /[<>\\]/.test(text) ||
    text.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(text)
  ) throw new Error(`${fieldName} is invalid`);
  return text;
}

export function sanitizeStrategyHealthText(value, fieldName, maxLength, nullable = false, fallback = null) {
  if (value === null || value === undefined || value === "") return nullable ? null : fallback;
  let text;
  try {
    text = normalizeStrategyHealthText(value, fieldName, maxLength);
  } catch {
    return nullable ? null : fallback;
  }
  if (
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(text) ||
    /\b(?:token|secret|password|api[_ -]?key|private[_ -]?key|cookie)\s*[:=]\s*[^\s,;]{8,}/i.test(text) ||
    /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,})\b/.test(text) ||
    /(?:^|[\s(])(?:\/Users\/|\/home\/|[A-Za-z]:[\\/])/.test(text)
  ) return nullable ? null : fallback;
  return text;
}

export function normalizeStrategyHealthErrors(value) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.slice(0, 20).filter((item) => /^[a-z][a-z0-9_.-]{0,63}$/.test(String(item || ""))));
}

export function normalizeStrategyHealthPolicy(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const list = (raw) => Array.isArray(raw)
    ? raw.slice(0, 20).map((item) => sanitizeStrategyHealthText(item, "policy.item", 120, true)).filter(Boolean)
    : [];
  return {
    mode: sanitizeStrategyHealthText(source.mode, "policy.mode", 40, false, "read_only"),
    automatic_stages: list(source.automatic_stages),
    automatic_modes: list(source.automatic_modes),
    human_gate_stages: list(source.human_gate_stages),
    canary_requirements: list(source.canary_requirements),
    human_actions: list(source.human_actions),
    machine_checks: list(source.machine_checks),
    notice: sanitizeStrategyHealthText(source.notice, "policy.notice", 240, false, "健康不等于已批准 live。"),
  };
}

export function emptyStrategyHealthPayload(errorCode) {
  return {
    schema_version: "strategy_health_dashboard.v1",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { strategy_count: 0, healthy: 0, watch: 0, review: 0, critical: 0 },
    strategies: [],
    policy: normalizeStrategyHealthPolicy({}),
    errors: [errorCode],
  };
}

export function strategyHealthStaleTtlSeconds(env) {
  const configured = Number(env.STRATEGY_HEALTH_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 604800) {
    return STRATEGY_HEALTH_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}

export {
  normalizeControlPlaneSnapshot,
  normalizeControlPlaneSourceSnapshot,
  emptyControlPlaneSourceSnapshot,
};

export function requireDedicatedM0ResearchSyncToken(request, env) {
  const expected = String(env.M0_RESEARCH_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("M0 research sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("M0 research sync token is invalid", 401);
}

export async function normalizeM0ResearchLedgerTransport(payload, fieldName = "M0 research ledger transport") {
  const source = assertExactFields(payload, [
    "schema_version", "producer", "source_artifact", "ledger_sha256", "ledger",
  ], fieldName);
  if (source.schema_version !== M0_RESEARCH_TRANSPORT_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const normalized = {
    schema_version: M0_RESEARCH_TRANSPORT_SCHEMA_VERSION,
    producer: normalizeM0ResearchProducer(source.producer, `${fieldName}.producer`),
    source_artifact: normalizeM0ResearchSourceArtifact(source.source_artifact, `${fieldName}.source_artifact`),
    ledger_sha256: normalizeResearchTaskDigest(source.ledger_sha256, `${fieldName}.ledger_sha256`),
    ledger: normalizeM0ResearchLedger(source.ledger, `${fieldName}.ledger`),
  };
  // The ledger digest binds the closed embedded ledger.  source_artifact.sha256
  // intentionally remains a distinct immutable declaration about the QAR
  // source artifact; it is not a hash of this derived ledger.
  const recomputed = await calculateM0ResearchLedgerSha256(normalized.ledger);
  if (normalized.ledger_sha256 !== recomputed) {
    throw new Error(`${fieldName}.ledger_sha256 mismatch`);
  }
  const computedAt = Date.parse(normalized.ledger.computed_at);
  if (!Number.isFinite(computedAt) || computedAt > Date.now() + 5 * 60 * 1000) {
    throw new Error(`${fieldName}.ledger.computed_at is in the future`);
  }
  if (computedAt < Date.now() - M0_RESEARCH_RETENTION_SECONDS * 1000) {
    throw new Error(`${fieldName}.ledger is expired`);
  }
  return normalized;
}

export async function normalizeM0ResearchLedgerStorageRecord(payload, fieldName) {
  const record = assertExactFields(payload, ["schema_version", "stored_at", "expires_at", "envelope"], fieldName);
  if (record.schema_version !== M0_RESEARCH_STORAGE_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const storedAt = normalizeM0ResearchTimestamp(record.stored_at, `${fieldName}.stored_at`);
  const expiresAt = normalizeM0ResearchTimestamp(record.expires_at, `${fieldName}.expires_at`);
  const storedMillis = Date.parse(storedAt);
  const expiresMillis = Date.parse(expiresAt);
  if (expiresMillis - storedMillis !== M0_RESEARCH_RETENTION_SECONDS * 1000 || expiresMillis <= Date.now()) {
    throw new Error(`${fieldName} is expired`);
  }
  return {
    schema_version: M0_RESEARCH_STORAGE_SCHEMA_VERSION,
    stored_at: storedAt,
    expires_at: expiresAt,
    envelope: await normalizeM0ResearchLedgerTransport(record.envelope, `${fieldName}.envelope`),
  };
}

export function normalizeM0ResearchLedger(payload, fieldName) {
  const ledger = assertExactFields(payload, [
    "schema_version", "generated_at", "computed_at", "data_status", "summary", "subjects", "policy", "errors",
  ], fieldName);
  if (ledger.schema_version !== M0_RESEARCH_LEDGER_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const generatedAt = normalizeM0ResearchTimestamp(ledger.generated_at, `${fieldName}.generated_at`);
  const computedAt = normalizeM0ResearchTimestamp(ledger.computed_at, `${fieldName}.computed_at`);
  if (generatedAt !== computedAt || /\./.test(generatedAt)) {
    throw new Error(`${fieldName} timestamps must be the same canonical second`);
  }
  const dataStatus = cleanChoice(ledger.data_status, ["ready", "unavailable", "stale"], `${fieldName}.data_status`);
  if (!Array.isArray(ledger.subjects) || ledger.subjects.length > 50000) {
    throw new Error(`${fieldName}.subjects must be a bounded array`);
  }
  const subjects = ledger.subjects.map((subject, index) => normalizeM0ResearchSubject(
    subject, `${fieldName}.subjects[${index}]`, computedAt,
  ));
  assertM0ResearchSortedUnique(subjects, (subject) => `${subject.subject.kind}\u0000${subject.subject.identifier}`, `${fieldName}.subjects`);
  const summary = normalizeM0ResearchLedgerSummary(ledger.summary, `${fieldName}.summary`);
  const calculatedSummary = summarizeM0ResearchSubjects(subjects);
  if (!m0ResearchSummariesEqual(summary, calculatedSummary)) {
    throw new Error(`${fieldName}.summary does not match subjects`);
  }
  const expectedStatus = summary.fresh_observation_count > 0
    ? "ready"
    : (summary.observation_count > 0 ? "stale" : "unavailable");
  if (dataStatus !== expectedStatus) throw new Error(`${fieldName}.data_status does not match subjects`);
  if (dataStatus === "unavailable" && subjects.length) throw new Error(`${fieldName}.subjects must be empty when unavailable`);
  return {
    schema_version: M0_RESEARCH_LEDGER_SCHEMA_VERSION,
    generated_at: generatedAt,
    computed_at: computedAt,
    data_status: dataStatus,
    summary,
    subjects,
    policy: normalizeM0ResearchLedgerPolicy(ledger.policy, `${fieldName}.policy`),
    errors: normalizeM0ResearchErrorCodes(ledger.errors, `${fieldName}.errors`),
  };
}

export function normalizeM0ResearchLedgerSummary(value, fieldName) {
  const summary = assertExactFields(value, M0_RESEARCH_SUMMARY_FIELDS, fieldName);
  const result = {};
  for (const key of M0_RESEARCH_SUMMARY_FIELDS) {
    result[key] = normalizeM0ResearchCount(summary[key], `${fieldName}.${key}`);
  }
  return result;
}

export function m0ResearchSummariesEqual(left, right) {
  return M0_RESEARCH_SUMMARY_FIELDS.every((field) => left[field] === right[field]);
}

export function normalizeM0ResearchLedgerPolicy(value, fieldName) {
  const policy = assertExactFields(value, ["authority", "no_order", "permitted_next_step", "notice"], fieldName);
  if (policy.authority !== "research_only" || policy.no_order !== true || policy.permitted_next_step !== "research_validation_only") {
    throw new Error(`${fieldName} must remain research-only and no-order`);
  }
  return {
    authority: "research_only",
    no_order: true,
    permitted_next_step: "research_validation_only",
    notice: normalizeM0ResearchText(policy.notice, `${fieldName}.notice`, 240),
  };
}

export function normalizeM0ResearchSubject(value, fieldName, ledgerComputedAt) {
  const item = assertExactFields(value, ["subject", "observations", "horizon_conflict", "historical_stale_horizon_drift"], fieldName);
  const subject = assertExactFields(item.subject, ["kind", "identifier"], `${fieldName}.subject`);
  const normalizedSubject = {
    kind: cleanChoice(subject.kind, M0_RESEARCH_SUBJECT_KINDS, `${fieldName}.subject.kind`),
    identifier: normalizeM0ResearchIdentifier(subject.identifier, `${fieldName}.subject.identifier`),
  };
  if (!Array.isArray(item.observations) || !item.observations.length || item.observations.length > 100) {
    throw new Error(`${fieldName}.observations must be a non-empty bounded array`);
  }
  const observations = item.observations.map((observation, index) => normalizeM0ResearchObservation(
    observation, `${fieldName}.observations[${index}]`, ledgerComputedAt,
  ));
  assertM0ResearchSortedUnique(observations, (observation) => (
    `${observation.source_report_digest}\u0000${observation.source_entry_digest}`
  ), `${fieldName}.observations`);
  const expectedHorizonView = calculateM0ResearchHorizonViews(observations);
  const horizonConflict = normalizeM0ResearchHorizonView(
    item.horizon_conflict, `${fieldName}.horizon_conflict`, ["none", "conflict"], expectedHorizonView.horizon_conflict,
  );
  const historicalStaleHorizonDrift = normalizeM0ResearchHorizonView(
    item.historical_stale_horizon_drift, `${fieldName}.historical_stale_horizon_drift`,
    ["none", "drift", "unavailable"], expectedHorizonView.historical_stale_horizon_drift,
  );
  return {
    subject: normalizedSubject,
    observations,
    horizon_conflict: horizonConflict,
    historical_stale_horizon_drift: historicalStaleHorizonDrift,
  };
}

export function normalizeM0ResearchObservation(value, fieldName, ledgerComputedAt) {
  const item = assertExactFields(value, [
    "source_ids", "source_report_digest", "source_entry_digest", "hypothesis_id", "as_of", "generated_at", "expires_at",
    "research_context", "freshness",
  ], fieldName);
  if (!Array.isArray(item.source_ids) || !item.source_ids.length || item.source_ids.length > 100) {
    throw new Error(`${fieldName}.source_ids must be a non-empty bounded array`);
  }
  const sourceIds = item.source_ids.map((sourceId, index) => normalizeM0ResearchIdentifier(sourceId, `${fieldName}.source_ids[${index}]`));
  assertM0ResearchSortedUnique(sourceIds, (sourceId) => sourceId, `${fieldName}.source_ids`);
  const generatedAt = normalizeM0ResearchTimestamp(item.generated_at, `${fieldName}.generated_at`);
  const expiresAt = normalizeM0ResearchTimestamp(item.expires_at, `${fieldName}.expires_at`);
  const generatedMillis = Date.parse(generatedAt);
  const expiresMillis = Date.parse(expiresAt);
  if (expiresMillis - generatedMillis !== 7 * 24 * 60 * 60 * 1000) {
    throw new Error(`${fieldName} must have the fixed seven-day M0 expiry`);
  }
  const asOf = normalizeM0ResearchDate(item.as_of, `${fieldName}.as_of`);
  if (asOf > generatedAt.slice(0, 10)) throw new Error(`${fieldName}.as_of cannot be after generated_at`);
  const context = normalizeM0ResearchContext(item.research_context, `${fieldName}.research_context`);
  const freshness = normalizeM0ResearchFreshness(
    item.freshness, `${fieldName}.freshness`, generatedMillis, expiresMillis, Date.parse(ledgerComputedAt),
  );
  return {
    source_ids: sourceIds,
    source_report_digest: normalizeResearchTaskDigest(item.source_report_digest, `${fieldName}.source_report_digest`),
    source_entry_digest: normalizeResearchTaskDigest(item.source_entry_digest, `${fieldName}.source_entry_digest`),
    hypothesis_id: normalizeM0ResearchIdentifier(item.hypothesis_id, `${fieldName}.hypothesis_id`),
    as_of: asOf,
    generated_at: generatedAt,
    expires_at: expiresAt,
    research_context: context,
    freshness,
  };
}

export function normalizeM0ResearchContext(value, fieldName) {
  const context = assertExactFields(value, [
    "state", "primary_horizon", "suitable_horizons", "source_confidence", "source_style", "theme_ids",
  ], fieldName);
  const primaryHorizon = cleanChoice(context.primary_horizon, M0_RESEARCH_HORIZONS, `${fieldName}.primary_horizon`);
  if (!Array.isArray(context.suitable_horizons) || !context.suitable_horizons.length || context.suitable_horizons.length > 4) {
    throw new Error(`${fieldName}.suitable_horizons is invalid`);
  }
  const suitableHorizons = context.suitable_horizons.map((horizon, index) => cleanChoice(
    horizon, M0_RESEARCH_HORIZONS, `${fieldName}.suitable_horizons[${index}]`,
  ));
  if (!suitableHorizons.includes(primaryHorizon)) throw new Error(`${fieldName}.primary_horizon must be suitable`);
  assertM0ResearchUnique(suitableHorizons, `${fieldName}.suitable_horizons`);
  if (!Array.isArray(context.theme_ids) || context.theme_ids.length > 24) throw new Error(`${fieldName}.theme_ids is invalid`);
  const themeIds = context.theme_ids.map((themeId, index) => normalizeM0ResearchIdentifier(themeId, `${fieldName}.theme_ids[${index}]`));
  assertM0ResearchUnique(themeIds, `${fieldName}.theme_ids`);
  return {
    state: cleanChoice(context.state, M0_RESEARCH_STATES, `${fieldName}.state`),
    primary_horizon: primaryHorizon,
    suitable_horizons: suitableHorizons,
    source_confidence: cleanChoice(context.source_confidence, M0_RESEARCH_CONFIDENCE, `${fieldName}.source_confidence`),
    source_style: cleanChoice(context.source_style, M0_RESEARCH_STYLES, `${fieldName}.source_style`),
    theme_ids: themeIds,
  };
}

export function normalizeM0ResearchFreshness(value, fieldName, generatedMillis, expiresMillis, ledgerComputedMillis) {
  const freshness = assertExactFields(value, ["status", "age_seconds"], fieldName);
  const status = cleanChoice(freshness.status, ["fresh", "stale", "unknown"], `${fieldName}.status`);
  const expectedAge = generatedMillis > ledgerComputedMillis
    ? null
    : Math.max(0, Math.floor((ledgerComputedMillis - generatedMillis) / 1000));
  const age = freshness.age_seconds === null ? null : normalizeM0ResearchCount(freshness.age_seconds, `${fieldName}.age_seconds`, 315360000);
  if (status === "unknown") {
    if (age !== null || generatedMillis <= ledgerComputedMillis) throw new Error(`${fieldName} unknown state is invalid`);
    return { status, age_seconds: null };
  }
  if (age !== expectedAge || generatedMillis > ledgerComputedMillis) throw new Error(`${fieldName}.age_seconds is invalid`);
  if (status === "fresh" && ledgerComputedMillis >= expiresMillis) throw new Error(`${fieldName} cannot be fresh after expiry`);
  return { status, age_seconds: age };
}

export function calculateM0ResearchHorizonViews(observations) {
  const freshHorizons = [...new Set(observations
    .filter((observation) => observation.freshness.status === "fresh")
    .map((observation) => observation.research_context.primary_horizon))].sort();
  const staleHorizons = [...new Set(observations
    .filter((observation) => observation.freshness.status === "stale")
    .map((observation) => observation.research_context.primary_horizon))].sort();
  return {
    horizon_conflict: { status: freshHorizons.length > 1 ? "conflict" : "none", primary_horizons: freshHorizons },
    historical_stale_horizon_drift: {
      status: freshHorizons.length
        ? (staleHorizons.length && JSON.stringify(staleHorizons) !== JSON.stringify(freshHorizons) ? "drift" : "none")
        : (staleHorizons.length ? "unavailable" : "none"),
      primary_horizons: staleHorizons,
    },
  };
}

export function projectM0ResearchDashboardForRead(ledger, sourceLedgerSha256, now = new Date()) {
  // The stored envelope remains the immutable, digest-bound publication
  // record. This is deliberately a different dashboard schema: changing
  // freshness at read time must never pretend to be a re-validatable ledger.
  const nowMillis = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMillis)) return emptyM0ResearchDashboardPayload("m0_research_ledger_unavailable");
  const subjects = ledger.subjects.map((entry) => {
    const observations = entry.observations.map((observation) => ({
      ...observation,
      freshness: projectM0ResearchObservationFreshness(observation, nowMillis),
    }));
    const horizonViews = calculateM0ResearchHorizonViews(observations);
    return {
      subject: { ...entry.subject },
      observations,
      horizon_conflict: horizonViews.horizon_conflict,
      historical_stale_horizon_drift: horizonViews.historical_stale_horizon_drift,
    };
  });
  const summary = summarizeM0ResearchSubjects(subjects);
  const dataStatus = summary.fresh_observation_count > 0
    ? "ready"
    : (summary.observation_count > 0 ? "stale" : "unavailable");
  return {
    schema_version: M0_RESEARCH_DASHBOARD_SCHEMA_VERSION,
    source_ledger_sha256: sourceLedgerSha256,
    source_generated_at: ledger.generated_at,
    source_computed_at: ledger.computed_at,
    viewed_at: utcTimestampSeconds(new Date(nowMillis)),
    data_status: dataStatus,
    summary,
    subjects,
    policy: { ...ledger.policy },
    errors: [...ledger.errors],
  };
}

export function projectM0ResearchObservationFreshness(observation, nowMillis) {
  const generatedMillis = Date.parse(observation.generated_at);
  const expiresMillis = Date.parse(observation.expires_at);
  if (!Number.isFinite(generatedMillis) || !Number.isFinite(expiresMillis) || nowMillis < generatedMillis) {
    return { status: "unknown", age_seconds: null };
  }
  const ageSeconds = Math.max(0, Math.floor((nowMillis - generatedMillis) / 1000));
  // A stale source is never promoted by this projection.  A former fresh
  // observation is demoted as soon as its own expiry is reached.
  const status = observation.freshness.status === "fresh" && nowMillis < expiresMillis
    ? "fresh"
    : "stale";
  return { status, age_seconds: ageSeconds };
}

export function normalizeM0ResearchHorizonView(value, fieldName, allowedStatuses, expected) {
  const view = assertExactFields(value, ["status", "primary_horizons"], fieldName);
  const status = cleanChoice(view.status, allowedStatuses, `${fieldName}.status`);
  if (!Array.isArray(view.primary_horizons) || view.primary_horizons.length > 4) {
    throw new Error(`${fieldName}.primary_horizons is invalid`);
  }
  const horizons = view.primary_horizons.map((horizon, index) => cleanChoice(
    horizon, M0_RESEARCH_HORIZONS, `${fieldName}.primary_horizons[${index}]`,
  ));
  assertM0ResearchSortedUnique(horizons, (horizon) => horizon, `${fieldName}.primary_horizons`);
  if (status !== expected.status || JSON.stringify(horizons) !== JSON.stringify(expected.primary_horizons)) {
    throw new Error(`${fieldName} does not match observations`);
  }
  return { status, primary_horizons: horizons };
}

export function summarizeM0ResearchSubjects(subjects) {
  const observations = subjects.flatMap((subject) => subject.observations);
  return {
    subject_count: subjects.length,
    observation_count: observations.length,
    fresh_observation_count: observations.filter((observation) => observation.freshness.status === "fresh").length,
    stale_observation_count: observations.filter((observation) => observation.freshness.status === "stale").length,
    unknown_observation_count: observations.filter((observation) => observation.freshness.status === "unknown").length,
    horizon_conflict_count: subjects.filter((subject) => subject.horizon_conflict.status === "conflict").length,
    historical_stale_horizon_drift_count: subjects.filter((subject) => subject.historical_stale_horizon_drift.status === "drift").length,
  };
}

export function normalizeM0ResearchErrorCodes(value, fieldName) {
  if (!Array.isArray(value) || value.length > 20) throw new Error(`${fieldName} is invalid`);
  const errors = value.map((error, index) => {
    if (typeof error !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/.test(error)) {
      throw new Error(`${fieldName}[${index}] is invalid`);
    }
    return error;
  });
  assertM0ResearchSortedUnique(errors, (error) => error, fieldName);
  return errors;
}

export function normalizeM0ResearchRepository(value, fieldName, allowedRepository) {
  const repository = normalizeResearchTaskRepository(value, fieldName);
  if (repository !== allowedRepository) throw new Error(`${fieldName} is not an approved M0 repository`);
  return repository;
}

export function normalizeM0ResearchRevision(value, fieldName) {
  return normalizeResearchTaskRevision(value, fieldName);
}

export function normalizeM0ResearchProducer(value, fieldName) {
  const producer = assertExactFields(value, ["repository", "revision"], fieldName);
  return {
    repository: normalizeM0ResearchRepository(
      producer.repository, `${fieldName}.repository`, M0_RESEARCH_ALLOWED_PRODUCER_REPOSITORY,
    ),
    revision: normalizeM0ResearchRevision(producer.revision, `${fieldName}.revision`),
  };
}

export function normalizeM0ResearchSourceArtifact(value, fieldName) {
  const artifact = assertExactFields(value, ["repository", "revision", "run_id", "artifact_id", "sha256"], fieldName);
  return {
    repository: normalizeM0ResearchRepository(
      artifact.repository, `${fieldName}.repository`, M0_RESEARCH_ALLOWED_SOURCE_REPOSITORY,
    ),
    revision: normalizeM0ResearchRevision(artifact.revision, `${fieldName}.revision`),
    run_id: normalizeM0ResearchIdentifier(artifact.run_id, `${fieldName}.run_id`),
    artifact_id: normalizeM0ResearchArtifactId(artifact.artifact_id, `${fieldName}.artifact_id`),
    sha256: normalizeResearchTaskDigest(artifact.sha256, `${fieldName}.sha256`),
  };
}

export function normalizeM0ResearchArtifactId(value, fieldName) {
  // Keep this exactly aligned with #309's generic identifier schema.  Artifact
  // IDs are provenance labels, not strategy slugs, so uppercase and `:/` are
  // valid when they satisfy the closed source-artifact contract.
  return normalizeM0ResearchIdentifier(value, fieldName);
}

export function normalizeM0ResearchIdentifier(value, fieldName) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:/-]{1,128}$/.test(value)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
}

export function normalizeM0ResearchTimestamp(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} must be a UTC timestamp`);
  }
  if (new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error(`${fieldName} must be a real UTC timestamp`);
  }
  return value;
}

export function normalizeM0ResearchDate(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${fieldName} must be an ISO date`);
  }
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${fieldName} must be a real ISO date`);
  }
  return value;
}

export function normalizeM0ResearchCount(value, fieldName, maximum = 50000) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${fieldName} is invalid`);
  return value;
}

export function normalizeM0ResearchText(value, fieldName, maximum) {
  if (typeof value !== "string" || !value || value.length > maximum || /[<>\\\u0000-\u001f]/.test(value)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
}

export function assertM0ResearchUnique(values, fieldName) {
  if (new Set(values).size !== values.length) throw new Error(`${fieldName} contains duplicates`);
}

export function assertM0ResearchSortedUnique(values, key, fieldName) {
  let previous = null;
  for (const value of values) {
    const current = key(value);
    if (previous !== null && current <= previous) throw new Error(`${fieldName} must be sorted and unique`);
    previous = current;
  }
}

export function canonicalM0ResearchLedgerJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("M0 research ledger must use finite JSON values");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalM0ResearchLedgerJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("M0 research ledger must use JSON values");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalM0ResearchLedgerJson(value[key])}`).join(",")}}`;
}

export async function calculateM0ResearchLedgerSha256(ledger) {
  const raw = new TextEncoder().encode(canonicalM0ResearchLedgerJson(ledger));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function emptyM0ResearchDashboardPayload(errorCode, now = new Date()) {
  return {
    schema_version: M0_RESEARCH_DASHBOARD_SCHEMA_VERSION,
    source_ledger_sha256: null,
    source_generated_at: null,
    source_computed_at: null,
    viewed_at: utcTimestampSeconds(now),
    data_status: "unavailable",
    summary: {
      subject_count: 0,
      observation_count: 0,
      fresh_observation_count: 0,
      stale_observation_count: 0,
      unknown_observation_count: 0,
      horizon_conflict_count: 0,
      historical_stale_horizon_drift_count: 0,
    },
    subjects: [],
    policy: {
      authority: "research_only",
      no_order: true,
      permitted_next_step: "research_validation_only",
      notice: "M0 研究台账不可用；不会推断策略、平台、运行状态或订单。",
    },
    errors: [errorCode],
  };
}

export async function normalizeAdaptiveSelectionSourceSnapshot(payload, fieldName = "adaptive selection source snapshot") {
  const source = assertExactFields(payload, [
    "schema_version", "source_id", "generated_at", "computed_at", "data_status", "decision", "errors",
  ], fieldName);
  if (source.schema_version !== ADAPTIVE_SELECTION_SOURCE_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const dataStatus = cleanChoice(source.data_status, STRATEGY_HEALTH_DATA_STATUSES, `${fieldName}.data_status`);
  const generatedAt = normalizeStrategyHealthTimestamp(source.generated_at, `${fieldName}.generated_at`, true);
  const computedAt = normalizeStrategyHealthTimestamp(source.computed_at, `${fieldName}.computed_at`, true);
  const decision = source.decision === null
    ? null
    : await normalizeAdaptiveSelectionDecision(source.decision, `${fieldName}.decision`);
  if (dataStatus === "unavailable" && decision !== null) {
    throw new Error(`${fieldName}.decision must be null when unavailable`);
  }
  if (dataStatus !== "unavailable" && (!decision || !generatedAt || !computedAt)) {
    throw new Error(`${fieldName} requires decision and timestamps when available`);
  }
  return {
    schema_version: ADAPTIVE_SELECTION_SOURCE_SCHEMA_VERSION,
    source_id: normalizeControlPlaneIdentifier(source.source_id, `${fieldName}.source_id`, false),
    generated_at: generatedAt,
    computed_at: computedAt,
    data_status: dataStatus,
    decision,
    errors: normalizeStrategyHealthErrors(source.errors),
  };
}

export async function normalizeAdaptiveSelectionDecision(payload, fieldName) {
  const value = assertExactFields(payload, [
    "schema", "decision_id", "created_at", "authority", "no_order", "market_context", "policy_id",
    "recommended_strategy_profile", "recommended_platform_id", "candidates", "input_digest", "decision_digest",
  ], fieldName);
  if (value.schema !== ADAPTIVE_SELECTION_DECISION_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema is unsupported`);
  }
  if (value.authority !== ADAPTIVE_SELECTION_AUTHORITY || value.no_order !== true) {
    throw new Error(`${fieldName} must remain shadow-only and no-order`);
  }
  if (!Array.isArray(value.candidates) || value.candidates.length > 1000) {
    throw new Error(`${fieldName}.candidates must be a bounded array`);
  }
  const candidates = value.candidates.map((item, index) =>
    normalizeAdaptiveSelectionCandidate(item, `${fieldName}.candidates[${index}]`),
  );
  const candidateIds = new Set();
  for (const candidate of candidates) {
    if (candidateIds.has(candidate.strategy_profile)) {
      throw new Error(`${fieldName}.candidates contains duplicate strategy_profile`);
    }
    candidateIds.add(candidate.strategy_profile);
  }
  const recommendedStrategy = normalizeControlPlaneIdentifier(
    value.recommended_strategy_profile, `${fieldName}.recommended_strategy_profile`, true,
  );
  const recommendedPlatform = normalizeControlPlaneIdentifier(
    value.recommended_platform_id, `${fieldName}.recommended_platform_id`, true,
  );
  const recommendedCandidate = candidates.find((item) => item.strategy_profile === recommendedStrategy && item.accepted);
  if ((recommendedStrategy === null) !== (recommendedPlatform === null)) {
    throw new Error(`${fieldName}.recommended strategy and platform must be provided together`);
  }
  if (recommendedStrategy && (!recommendedCandidate || recommendedCandidate.selected_platform_id !== recommendedPlatform)) {
    throw new Error(`${fieldName}.recommended candidate is not accepted`);
  }
  const normalized = {
    schema: ADAPTIVE_SELECTION_DECISION_SCHEMA_VERSION,
    decision_id: normalizeControlPlaneIdentifier(value.decision_id, `${fieldName}.decision_id`, false),
    created_at: normalizeStrategyHealthTimestamp(value.created_at, `${fieldName}.created_at`),
    authority: ADAPTIVE_SELECTION_AUTHORITY,
    no_order: true,
    market_context: normalizeAdaptiveSelectionMarketContext(value.market_context, `${fieldName}.market_context`),
    policy_id: normalizeControlPlaneIdentifier(value.policy_id, `${fieldName}.policy_id`, false),
    recommended_strategy_profile: recommendedStrategy,
    recommended_platform_id: recommendedPlatform,
    candidates,
    input_digest: normalizeAdaptiveSelectionDigest(value.input_digest, `${fieldName}.input_digest`),
    decision_digest: normalizeAdaptiveSelectionDigest(value.decision_digest, `${fieldName}.decision_digest`),
  };
  // `input_digest` cannot be reconstructed from the display projection alone:
  // QPK calculates it from the private, immutable selection input.  The QPK
  // decision digest binds that exact input digest to every decision field that
  // is displayed here, so a changed input digest cannot be silently accepted.
  if (normalized.decision_digest !== await calculateAdaptiveSelectionDecisionDigest(normalized)) {
    throw new Error(`${fieldName}.decision_digest mismatch`);
  }
  return normalized;
}

export function normalizeAdaptiveSelectionMarketContext(value, fieldName) {
  const item = assertExactFields(value, [
    "schema", "as_of", "domain", "data_version", "data_freshness_days", "regime", "regime_confidence", "factors",
  ], fieldName);
  if (item.schema !== "qsl.market_context_snapshot.v1") {
    throw new Error(`${fieldName}.schema is unsupported`);
  }
  const asOf = String(item.as_of || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
    throw new Error(`${fieldName}.as_of must be an ISO date`);
  }
  if (!Number.isInteger(item.data_freshness_days) || item.data_freshness_days < 0 || item.data_freshness_days > 366) {
    throw new Error(`${fieldName}.data_freshness_days is invalid`);
  }
  const confidence = Number(item.regime_confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`${fieldName}.regime_confidence is invalid`);
  }
  if (!item.factors || Array.isArray(item.factors) || typeof item.factors !== "object" || Object.keys(item.factors).length > 100) {
    throw new Error(`${fieldName}.factors is invalid`);
  }
  const factors = {};
  for (const [key, raw] of Object.entries(item.factors)) {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(key)) throw new Error(`${fieldName}.factors key is invalid`);
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || Math.abs(numeric) > 1_000_000) {
      throw new Error(`${fieldName}.factors.${key} is invalid`);
    }
    factors[key] = numeric;
  }
  return {
    schema: "qsl.market_context_snapshot.v1",
    as_of: asOf,
    domain: cleanChoice(item.domain, STRATEGY_HEALTH_DOMAINS, `${fieldName}.domain`),
    data_version: normalizeControlPlaneIdentifier(item.data_version, `${fieldName}.data_version`, false),
    data_freshness_days: item.data_freshness_days,
    regime: normalizeControlPlaneIdentifier(item.regime, `${fieldName}.regime`, false),
    regime_confidence: confidence,
    factors,
  };
}

export function normalizeAdaptiveSelectionCandidate(value, fieldName) {
  const item = assertExactFields(value, [
    "strategy_profile", "release_digest", "selected_platform_id", "score", "risk_multiplier", "accepted", "reasons", "proposed_weight",
  ], fieldName);
  const score = item.score === null ? null : Number(item.score);
  const riskMultiplier = Number(item.risk_multiplier);
  if (score !== null && (!Number.isFinite(score) || Math.abs(score) > 1_000_000)) {
    throw new Error(`${fieldName}.score is invalid`);
  }
  if (!Number.isFinite(riskMultiplier) || riskMultiplier < 0 || riskMultiplier > 1) {
    throw new Error(`${fieldName}.risk_multiplier is invalid`);
  }
  if (typeof item.accepted !== "boolean") throw new Error(`${fieldName}.accepted must be boolean`);
  if (item.proposed_weight !== 0) throw new Error(`${fieldName}.proposed_weight must remain zero`);
  if (!Array.isArray(item.reasons) || item.reasons.length > 32) throw new Error(`${fieldName}.reasons is invalid`);
  const reasons = item.reasons.map((reason) => {
    const code = String(reason || "");
    if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(code)) throw new Error(`${fieldName}.reason is invalid`);
    return code;
  });
  return {
    strategy_profile: normalizeControlPlaneIdentifier(item.strategy_profile, `${fieldName}.strategy_profile`, false),
    release_digest: normalizeAdaptiveSelectionReleaseDigest(item.release_digest, `${fieldName}.release_digest`),
    selected_platform_id: normalizeControlPlaneIdentifier(item.selected_platform_id, `${fieldName}.selected_platform_id`, true),
    score,
    risk_multiplier: riskMultiplier,
    accepted: item.accepted,
    reasons,
    proposed_weight: 0,
  };
}

export function normalizeAdaptiveSelectionReleaseDigest(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._:=+-]{1,160}$/.test(text) || /(token|secret|password|cookie|private|api[_-]?key)/i.test(text)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return text;
}

export function normalizeAdaptiveSelectionDigest(value, fieldName) {
  const text = String(value || "");
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${fieldName} is invalid`);
  return text;
}

export function isAdaptiveSelectionFloatPath(path) {
  if (path[0] === "market_context") {
    return path[1] === "regime_confidence" || path[1] === "factors";
  }
  return path[0] === "candidates"
    && ["score", "risk_multiplier", "proposed_weight"].includes(path[2]);
}

export function canonicalAdaptiveSelectionNumber(value, forceFloat) {
  if (!Number.isFinite(value)) throw new Error("adaptive selection decision must use finite JSON values");
  if (Object.is(value, -0)) return forceFloat ? "-0.0" : "0";
  let text = String(value);
  const exponent = text.match(/^(.*)e([+-]?)(\d+)$/i);
  if (exponent) {
    const [, mantissa, sign, rawExponent] = exponent;
    // Python's json.dumps (used by QPK canonical_sha256) pads one-digit
    // negative exponents, while V8's Number#toString does not.
    text = `${mantissa}e${sign || "+"}${sign === "-" ? rawExponent.padStart(2, "0") : rawExponent}`;
  }
  if (forceFloat && !/[.eE]/.test(text)) return `${text}.0`;
  return text;
}

export function canonicalAdaptiveSelectionDecisionJson(value, path = []) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return canonicalAdaptiveSelectionNumber(value, isAdaptiveSelectionFloatPath(path));
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalAdaptiveSelectionDecisionJson(item, [...path, "*"])).join(",")}]`;
  }
  if (!value || typeof value !== "object") throw new Error("adaptive selection decision must use JSON values");
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalAdaptiveSelectionDecisionJson(value[key], [...path, key])}`
  )).join(",")}}`;
}

export async function calculateAdaptiveSelectionDecisionDigest(payload) {
  const material = { ...payload };
  delete material.decision_digest;
  const raw = new TextEncoder().encode(canonicalAdaptiveSelectionDecisionJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeAdaptiveSelectionSummary(selections) {
  const entries = Array.isArray(selections) ? selections : [];
  const decisions = entries.map((item) => item.decision).filter(Boolean);
  const candidates = decisions.flatMap((item) => item.candidates);
  return {
    source_count: entries.length,
    decision_count: decisions.length,
    candidate_count: candidates.length,
    recommended_count: decisions.filter((item) => item.recommended_strategy_profile).length,
    rejected_candidate_count: candidates.filter((item) => !item.accepted).length,
  };
}

export function emptyAdaptiveSelectionSourceSnapshot(errorCode) {
  return {
    schema_version: ADAPTIVE_SELECTION_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    decision: null,
    errors: [errorCode],
  };
}

export function emptyAdaptiveSelectionPayload(errorCode) {
  return {
    schema_version: ADAPTIVE_SELECTION_DASHBOARD_SCHEMA_VERSION,
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { source_count: 0, decision_count: 0, candidate_count: 0, recommended_count: 0, rejected_candidate_count: 0 },
    selections: [],
    policy: {
      authority: ADAPTIVE_SELECTION_AUTHORITY,
      no_order: true,
      execution_authority_granted: false,
      notice: "M1 Shadow 建议尚不可用；控制台不会推断策略、平台或订单。",
    },
    errors: [errorCode],
  };
}

export function adaptiveSelectionStaleTtlSeconds(env) {
  const configured = Number(env.ADAPTIVE_SELECTION_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 604800) {
    return ADAPTIVE_SELECTION_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}

export {
  normalizeControlPlaneCandidates,
  normalizeForwardObservation,
  normalizeForwardObservationDate,
  normalizeControlPlaneIdentifier,
  normalizeControlPlaneLifecycle,
  normalizeControlPlaneEvidence,
  normalizeControlPlaneRecommendation,
  normalizeControlPlaneSummary,
  normalizeControlPlaneAttention,
  normalizeControlPlanePolicy,
};

export function normalizeBinancePrivateScopeReport(payload, { requireIngestFreshness = false } = {}) {
  const report = assertExactFields(payload, [
    "platform",
    "observed_at",
    "source_run_id",
    "source_sha",
    "account_scope_sha256",
    "assets",
    "historical_difference_unresolved",
    "no_order",
    "execution_authority_granted",
  ], "Binance private scope report");
  if (report.platform !== "binance") throw new Error("Binance private scope report.platform must be binance");
  const observedAt = report.observed_at;
  if (typeof observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(observedAt)) {
    throw new Error("Binance private scope report.observed_at must be an ISO timestamp with timezone");
  }
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) {
    throw new Error("Binance private scope report.observed_at must be valid");
  }
  if (requireIngestFreshness) {
    const ageMs = Date.now() - observedAtMs;
    if (ageMs > BINANCE_PRIVATE_SCOPE_INGEST_MAX_AGE_MS || ageMs < -BINANCE_PRIVATE_SCOPE_FUTURE_SKEW_MS) {
      throw new Error("Binance private scope report.observed_at is outside the ingestion window");
    }
  }
  const sourceRunId = report.source_run_id;
  if (typeof sourceRunId !== "string" || !/^[1-9]\d{0,19}$/.test(sourceRunId)) {
    throw new Error("Binance private scope report.source_run_id must be a decimal string");
  }
  const sourceSha = report.source_sha;
  if (typeof sourceSha !== "string" || !/^[0-9a-fA-F]{40}$/.test(sourceSha)) {
    throw new Error("Binance private scope report.source_sha must be a 40 character hex string");
  }
  const accountScopeSha256 = report.account_scope_sha256;
  if (typeof accountScopeSha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(accountScopeSha256)) {
    throw new Error("Binance private scope report.account_scope_sha256 must be a 64 character hex string");
  }
  if (!Array.isArray(report.assets) || report.assets.length > BINANCE_PRIVATE_SCOPE_MAX_ASSETS) {
    throw new Error(`Binance private scope report.assets must contain at most ${BINANCE_PRIVATE_SCOPE_MAX_ASSETS} items`);
  }
  const seenAssets = new Set();
  const assets = report.assets.map((value, index) => {
    const item = assertExactFields(value, ["asset", "free", "locked"], `Binance private scope report.assets[${index}]`);
    const asset = item.asset;
    if (typeof asset !== "string" || !/^[\p{L}\p{N}]{1,20}$/u.test(asset)) {
      throw new Error(`Binance private scope report.assets[${index}].asset is invalid`);
    }
    if (seenAssets.has(asset)) throw new Error("Binance private scope report.assets contains duplicate assets");
    seenAssets.add(asset);
    const free = normalizeBinancePrivateScopeDecimal(item.free, `Binance private scope report.assets[${index}].free`);
    const locked = normalizeBinancePrivateScopeDecimal(item.locked, `Binance private scope report.assets[${index}].locked`);
    if (binancePrivateScopeDecimalIsZero(free) && binancePrivateScopeDecimalIsZero(locked)) {
      throw new Error(`Binance private scope report.assets[${index}] must not be an all-zero row`);
    }
    return { asset, free, locked };
  });
  if (report.historical_difference_unresolved !== true) {
    throw new Error("Binance private scope report.historical_difference_unresolved must be true");
  }
  if (report.no_order !== true) throw new Error("Binance private scope report.no_order must be true");
  if (report.execution_authority_granted !== false) {
    throw new Error("Binance private scope report.execution_authority_granted must be false");
  }
  return {
    platform: "binance",
    observed_at: observedAt,
    source_run_id: sourceRunId,
    source_sha: sourceSha.toLowerCase(),
    account_scope_sha256: accountScopeSha256.toLowerCase(),
    assets,
    historical_difference_unresolved: true,
    no_order: true,
    execution_authority_granted: false,
  };
}

export function normalizeBinancePrivateScopeDecimal(value, fieldName) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`${fieldName} must be a non-negative finite decimal string`);
  }
  return value;
}

export function binancePrivateScopeDecimalIsZero(value) {
  return /^0+(?:\.0+)?$/.test(value);
}

export { normalizeReconciliationRecoverySourceSnapshot };
export { normalizeReconciliationRecoveryRequest };

export function normalizeExecutionEvidenceSourceSnapshot(payload, fieldName = "execution evidence source snapshot") {
  const source = assertExactFields(payload, [
    "schema_version", "source_id", "generated_at", "computed_at", "data_status", "deployments", "errors",
  ], fieldName);
  if (source.schema_version !== EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const dataStatus = cleanChoice(source.data_status, STRATEGY_HEALTH_DATA_STATUSES, `${fieldName}.data_status`);
  if (!Array.isArray(source.deployments) || source.deployments.length > 1000) {
    throw new Error(`${fieldName}.deployments must be an array with at most 1000 items`);
  }
  const deployments = [];
  const seen = new Set();
  for (const [index, item] of source.deployments.entries()) {
    const deployment = normalizeExecutionEvidenceDeployment(item, `${fieldName}.deployments[${index}]`);
    if (seen.has(deployment.deployment_id)) {
      throw new Error(`${fieldName}.deployments contains duplicate deployment_id`);
    }
    seen.add(deployment.deployment_id);
    deployments.push(deployment);
  }
  if (dataStatus === "unavailable" && deployments.length) {
    throw new Error(`${fieldName}.deployments must be empty when unavailable`);
  }
  return {
    schema_version: EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION,
    source_id: normalizeControlPlaneIdentifier(source.source_id, `${fieldName}.source_id`, false),
    generated_at: normalizeStrategyHealthTimestamp(source.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(source.computed_at, `${fieldName}.computed_at`, true),
    data_status: dataStatus,
    deployments,
    errors: normalizeStrategyHealthErrors(source.errors),
  };
}

export function normalizeExecutionEvidenceDeployment(value, fieldName) {
  const item = assertRequiredAndOptionalFields(value, [
    "deployment_id", "strategy", "target", "capabilities", "evidence", "recommendation",
  ], ["execution_receipt"], fieldName);
  const strategy = assertExactFields(item.strategy, [
    "candidate_id", "candidate_kind", "domain", "strategy_revision",
  ], `${fieldName}.strategy`);
  const target = assertExactFields(item.target, ["platform", "environment"], `${fieldName}.target`);
  const capabilities = assertExactFields(item.capabilities, ["shadow", "paper"], `${fieldName}.capabilities`);
  const evidence = assertExactFields(item.evidence, [
    "strategy", "target_data", "target_execution",
  ], `${fieldName}.evidence`);
  const recommendation = assertExactFields(item.recommendation, ["code", "reason_code"], `${fieldName}.recommendation`);
  const executionReceipt = item.execution_receipt === undefined
    ? null
    : normalizeExecutionEvidenceReceipt(item.execution_receipt, `${fieldName}.execution_receipt`);
  const normalized = {
    deployment_id: normalizeControlPlaneIdentifier(item.deployment_id, `${fieldName}.deployment_id`, false),
    strategy: {
      candidate_id: normalizeControlPlaneIdentifier(strategy.candidate_id, `${fieldName}.strategy.candidate_id`, false),
      candidate_kind: cleanChoice(strategy.candidate_kind, CONTROL_PLANE_CANDIDATE_KINDS, `${fieldName}.strategy.candidate_kind`),
      domain: cleanChoice(strategy.domain, STRATEGY_HEALTH_DOMAINS, `${fieldName}.strategy.domain`),
      strategy_revision: normalizeResearchTaskRevision(strategy.strategy_revision, `${fieldName}.strategy.strategy_revision`),
    },
    target: {
      platform: cleanChoice(target.platform, EXECUTION_EVIDENCE_PLATFORMS, `${fieldName}.target.platform`),
      environment: cleanChoice(target.environment, EXECUTION_EVIDENCE_ENVIRONMENTS, `${fieldName}.target.environment`),
    },
    capabilities: {
      shadow: cleanChoice(capabilities.shadow, EXECUTION_EVIDENCE_CAPABILITIES, `${fieldName}.capabilities.shadow`),
      paper: cleanChoice(capabilities.paper, EXECUTION_EVIDENCE_CAPABILITIES, `${fieldName}.capabilities.paper`),
    },
    evidence: {
      strategy: cleanChoice(evidence.strategy, EXECUTION_EVIDENCE_STATUSES, `${fieldName}.evidence.strategy`),
      target_data: cleanChoice(evidence.target_data, EXECUTION_EVIDENCE_STATUSES, `${fieldName}.evidence.target_data`),
      target_execution: cleanChoice(evidence.target_execution, EXECUTION_EVIDENCE_STATUSES, `${fieldName}.evidence.target_execution`),
    },
    recommendation: {
      code: cleanChoice(recommendation.code, EXECUTION_EVIDENCE_RECOMMENDATIONS, `${fieldName}.recommendation.code`),
      reason_code: cleanChoice(recommendation.reason_code, EXECUTION_EVIDENCE_REASON_CODES, `${fieldName}.recommendation.reason_code`),
    },
  };
  if (normalized.recommendation.code === "continue_autonomous_shadow" && normalized.capabilities.shadow !== "available") {
    throw new Error(`${fieldName}.recommendation requires an available shadow capability`);
  }
  if (normalized.recommendation.code === "run_autonomous_paper" && normalized.capabilities.paper !== "available") {
    throw new Error(`${fieldName}.recommendation requires an available paper capability`);
  }
  if (normalized.recommendation.code === "owner_limited_live_canary_decision") {
    const statuses = Object.values(normalized.evidence);
    if (!statuses.every((status) => status === "verified")) {
      throw new Error(`${fieldName}.recommendation requires matching verified strategy, data, and execution evidence`);
    }
  }
  if (executionReceipt !== null) {
    const expectedExecutionStatus = ["failed", "reconciliation_required"].includes(executionReceipt.outcome)
      ? "unavailable"
      : (["no_signal", "no_rebalance"].includes(executionReceipt.outcome) ? "not_applicable" : "verified");
    if (normalized.evidence.target_execution !== expectedExecutionStatus) {
      throw new Error(`${fieldName}.execution_receipt does not match target_execution evidence`);
    }
    normalized.execution_receipt = executionReceipt;
  }
  return normalized;
}

export function normalizeExecutionEvidenceReceipt(value, fieldName) {
  const receipt = assertExactFields(value, ["outcome", "broker_confirmation", "observed_at"], fieldName);
  const outcome = cleanChoice(receipt.outcome, EXECUTION_RECEIPT_OUTCOMES, `${fieldName}.outcome`);
  const confirmation = cleanChoice(
    receipt.broker_confirmation,
    EXECUTION_RECEIPT_CONFIRMATIONS,
    `${fieldName}.broker_confirmation`,
  );
  const allowedConfirmations = {
    not_due: ["not_applicable"],
    no_action: ["not_applicable"],
    no_signal: ["not_applicable"],
    no_rebalance: ["not_applicable"],
    risk_blocked: ["not_applicable"],
    submitted: ["not_observed"],
    broker_acknowledged: ["acknowledged"],
    partially_filled: ["partially_filled"],
    filled: ["filled"],
    reconciliation_required: ["reconciliation_required"],
    failed: ["not_applicable", "not_observed", "reconciliation_required"],
  };
  if (!allowedConfirmations[outcome].includes(confirmation)) {
    throw new Error(`${fieldName}.broker_confirmation does not match outcome`);
  }
  return {
    outcome,
    broker_confirmation: confirmation,
    observed_at: normalizeResearchTaskTimestamp(receipt.observed_at, `${fieldName}.observed_at`),
  };
}

export function normalizeRuntimeTargetLifecycleSourceSnapshot(payload, fieldName = "runtime target lifecycle source snapshot") {
  const source = assertExactFields(payload, [
    "schema_version", "source_id", "generated_at", "computed_at", "data_status", "targets", "errors",
  ], fieldName);
  if (source.schema_version !== RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const dataStatus = cleanChoice(source.data_status, STRATEGY_HEALTH_DATA_STATUSES, `${fieldName}.data_status`);
  if (!Array.isArray(source.targets) || source.targets.length > 1000) {
    throw new Error(`${fieldName}.targets must be an array with at most 1000 items`);
  }
  const targets = [];
  const seen = new Set();
  for (const [index, item] of source.targets.entries()) {
    const target = normalizeRuntimeTargetLifecycleTarget(item, `${fieldName}.targets[${index}]`);
    if (seen.has(target.target_id)) throw new Error(`${fieldName}.targets contains duplicate target_id`);
    seen.add(target.target_id);
    targets.push(target);
  }
  if (dataStatus === "unavailable" && targets.length) {
    throw new Error(`${fieldName}.targets must be empty when unavailable`);
  }
  return {
    schema_version: RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION,
    source_id: normalizeControlPlaneIdentifier(source.source_id, `${fieldName}.source_id`, false),
    generated_at: normalizeStrategyHealthTimestamp(source.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(source.computed_at, `${fieldName}.computed_at`, true),
    data_status: dataStatus,
    targets,
    errors: normalizeStrategyHealthErrors(source.errors),
  };
}

export function normalizeRuntimeTargetLifecycleTarget(value, fieldName) {
  const item = assertRequiredAndOptionalFields(value, ["target_id", "target", "monitoring", "disposition", "no_order"], ["deployment"], fieldName);
  const target = assertExactFields(item.target, ["platform", "configured_state", "execution_mode"], `${fieldName}.target`);
  const monitoring = assertExactFields(item.monitoring, ["runtime_guard", "execution_heartbeat"], `${fieldName}.monitoring`);
  const disposition = assertExactFields(item.disposition, ["code", "reason_code"], `${fieldName}.disposition`);
  if (item.no_order !== true) throw new Error(`${fieldName}.no_order must be true`);
  const normalized = {
    target_id: normalizeControlPlaneIdentifier(item.target_id, `${fieldName}.target_id`, false),
    target: {
      platform: cleanChoice(target.platform, EXECUTION_EVIDENCE_PLATFORMS, `${fieldName}.target.platform`),
      configured_state: cleanChoice(target.configured_state, RUNTIME_TARGET_LIFECYCLE_CONFIGURED_STATES, `${fieldName}.target.configured_state`),
      execution_mode: cleanChoice(target.execution_mode, RUNTIME_TARGET_LIFECYCLE_EXECUTION_MODES, `${fieldName}.target.execution_mode`),
    },
    monitoring: {
      runtime_guard: cleanChoice(monitoring.runtime_guard, RUNTIME_TARGET_LIFECYCLE_CHECK_STATUSES, `${fieldName}.monitoring.runtime_guard`),
      execution_heartbeat: cleanChoice(monitoring.execution_heartbeat, RUNTIME_TARGET_LIFECYCLE_CHECK_STATUSES, `${fieldName}.monitoring.execution_heartbeat`),
    },
    disposition: {
      code: cleanChoice(disposition.code, RUNTIME_TARGET_LIFECYCLE_DISPOSITIONS, `${fieldName}.disposition.code`),
      reason_code: cleanChoice(disposition.reason_code, RUNTIME_TARGET_LIFECYCLE_REASON_CODES, `${fieldName}.disposition.reason_code`),
    },
    no_order: true,
  };
  if (item.deployment !== undefined) {
    const observed = assertRequiredAndOptionalFields(item.deployment, ["runtime_enabled", "scheduler_state", "strategy_profile", "execution_mode"], ["observed_at"], `${fieldName}.deployment`);
    if (observed.runtime_enabled !== null && typeof observed.runtime_enabled !== "boolean") throw new Error("deployment switch must be boolean or null");
    normalized.deployment = {
      ...(observed.observed_at === undefined ? {} : {observed_at: normalizeM0ResearchTimestamp(observed.observed_at, "deployment.observed_at")}),
      runtime_enabled: observed.runtime_enabled,
      scheduler_state: cleanChoice(observed.scheduler_state, ["enabled", "paused", "mixed", "missing", "unknown", "not_applicable"], "deployment.scheduler_state"),
      strategy_profile: observed.strategy_profile === null ? null : cleanSlug(observed.strategy_profile, "deployment.strategy_profile"),
      execution_mode: observed.execution_mode === null ? null : cleanChoice(observed.execution_mode, RUNTIME_TARGET_LIFECYCLE_EXECUTION_MODES, "deployment.execution_mode"),
    };
  }
  const guardUnavailable = normalized.monitoring.runtime_guard === "unavailable";
  const heartbeatUnavailable = normalized.monitoring.execution_heartbeat === "unavailable";
  const hasAttention = normalized.monitoring.runtime_guard === "attention" || normalized.monitoring.execution_heartbeat === "attention";
  if (normalized.target.configured_state === "disabled") {
    if (normalized.monitoring.execution_heartbeat !== "not_applicable") {
      throw new Error(`${fieldName}.disabled target must not claim an execution heartbeat`);
    }
    if (!hasAttention && !guardUnavailable && normalized.disposition.code !== "continue_disabled_validation") {
      throw new Error(`${fieldName}.disabled target requires continue_disabled_validation`);
    }
  } else if (!hasAttention && !guardUnavailable && !heartbeatUnavailable && normalized.disposition.code !== "continue_enabled_monitoring") {
    throw new Error(`${fieldName}.enabled healthy target requires continue_enabled_monitoring`);
  }
  if (hasAttention || guardUnavailable || heartbeatUnavailable) {
    if (normalized.disposition.code !== "parked") throw new Error(`${fieldName}.unhealthy monitoring requires parked`);
  }
  return normalized;
}

export function normalizeExecutionEvidenceSummary(deployments) {
  return {
    deployment_count: deployments.length,
    autonomous_shadow: deployments.filter((item) => item.recommendation.code === "continue_autonomous_shadow").length,
    autonomous_paper: deployments.filter((item) => item.recommendation.code === "run_autonomous_paper").length,
    owner_canary_decision: deployments.filter((item) => item.recommendation.code === "owner_limited_live_canary_decision").length,
    parked: deployments.filter((item) => item.recommendation.code === "parked").length,
  };
}

export function emptyExecutionEvidenceSourceSnapshot(errorCode) {
  return {
    schema_version: EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    deployments: [],
    errors: [errorCode],
  };
}

export function emptyRuntimeTargetLifecycleSourceSnapshot(errorCode) {
  return {
    schema_version: RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    targets: [],
    errors: [errorCode],
  };
}

export function emptyRuntimeTargetLifecyclePayload(errorCode) {
  return {
    schema_version: RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION,
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { target_count: 0, enabled: 0, disabled: 0, attention: 0 },
    targets: [],
    policy: {
      lifecycle_status_read_only: true,
      execution_observation_read_only: true,
      no_order: true,
      order_or_fill_evidence: "not_collected",
      notice: "运行目标生命周期快照尚不可用；页面不会推断目标已启用或存在订单/成交。",
    },
    errors: [errorCode],
  };
}

export function emptyExecutionEvidencePayload(errorCode) {
  return {
    schema_version: EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION,
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { deployment_count: 0, autonomous_shadow: 0, autonomous_paper: 0, owner_canary_decision: 0, parked: 0 },
    deployments: [],
    policy: {
      execution_evidence_read_only: true,
      p6_owner_decision_required: true,
      limited_live_canary_active: false,
      notice: "执行证据尚不可用；控制台不会推断 paper 或 live 状态。",
    },
    errors: [errorCode],
  };
}

export { emptyReconciliationRecoverySourceSnapshot };
export { emptyReconciliationRecoveryPayload };
export { reconciliationRecoveryStaleTtlSeconds };

export function executionEvidenceStaleTtlSeconds(env) {
  const configured = Number(env.EXECUTION_EVIDENCE_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 604800) {
    return EXECUTION_EVIDENCE_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}

export {
  emptyControlPlanePayload,
  controlPlaneStaleTtlSeconds,
};

export async function syncStrategyProfilesConfig(env, session) {
  const profiles = normalizeStrategyProfilesPayload(DEFAULT_STRATEGY_PROFILES, "DEFAULT_STRATEGY_PROFILES");
  if (!hasConfigStore(env)) return { synced: false, reason: "kv_not_bound", count: profiles.length };
  let changed = true;
  try {
    const current = await readConfigJson(env, STRATEGY_PROFILES_KEY);
    if (current) {
      const normalizedCurrent = normalizeStrategyProfilesPayload(current, STRATEGY_PROFILES_KEY);
      changed = JSON.stringify(normalizedCurrent) !== JSON.stringify(profiles);
    }
  } catch {
    changed = true;
  }
  let auditLogged = false;
  if (changed) {
    await writeConfigJson(env, STRATEGY_PROFILES_KEY, profiles);
    try {
      await appendAuditLog(env, {
        ts: new Date().toISOString(),
        login: session?.login || "",
        action: "sync_strategy_profiles",
        count: profiles.length,
      });
      auditLogged = true;
    } catch {
      auditLogged = false;
    }
  }
  return { synced: true, changed, count: profiles.length, audit_logged: auditLogged };
}

export function updateAccountOptionsDefaultStrategy(accountOptions, inputs) {
  const options = normalizeAccountOptionsPayload(accountOptions || {}, ACCOUNT_OPTIONS_KEY);
  const platformOptions = options[inputs.platform] || [];
  const rawPlatformOptions = Array.isArray(accountOptions?.[inputs.platform]) ? accountOptions[inputs.platform] : [];
  let matched = false;
  let changed = false;
  const updatedPlatformOptions = platformOptions.map((option, index) => {
    if (!accountOptionMatchesInputs(option, inputs)) return option;
    matched = true;
    const rawOption = rawPlatformOptions[index] && typeof rawPlatformOptions[index] === "object"
      ? rawPlatformOptions[index]
      : {};
    const nextOption = { ...option };
    let optionChanged = false;
    if ("ibit_zscore_exit_mode" in rawOption) optionChanged = true;
    if (inputs.plugin_mode === "none") {
      const currentPluginMode = nextOption.plugin_mode || "none";
      if (currentPluginMode !== inputs.plugin_mode) {
        nextOption.plugin_mode = inputs.plugin_mode;
        optionChanged = true;
      }
    }
    if (inputs.option_overlay_mode === "enabled" || inputs.option_overlay_mode === "disabled") {
      if (nextOption.option_overlay_mode !== inputs.option_overlay_mode) {
        nextOption.option_overlay_mode = inputs.option_overlay_mode;
        optionChanged = true;
      }
    }
    const cashOnlyExecutionMode = cashOnlyExecutionModeFromInputs(inputs);
    if (cashOnlyExecutionMode === "enabled" || cashOnlyExecutionMode === "disabled") {
      if (nextOption.cash_only_execution_mode !== cashOnlyExecutionMode) {
        nextOption.cash_only_execution_mode = cashOnlyExecutionMode;
        optionChanged = true;
      }
    }
    const dcaControls = dcaControlsFromInputs(inputs);
    if (isDcaProfile(inputs.strategy_profile)) {
      if (dcaControls.dca_mode && nextOption.dca_mode !== dcaControls.dca_mode) {
        nextOption.dca_mode = dcaControls.dca_mode;
        optionChanged = true;
      }
      if (
        dcaControls.dca_base_investment_usd &&
        nextOption.dca_base_investment_usd !== dcaControls.dca_base_investment_usd
      ) {
        nextOption.dca_base_investment_usd = dcaControls.dca_base_investment_usd;
        optionChanged = true;
      }
    } else {
      for (const field of ["dca_mode", "dca_base_investment_usd"]) {
        if (field in nextOption) {
          delete nextOption[field];
          optionChanged = true;
        }
      }
    }
    if ("ibit_zscore_exit_mode" in nextOption) {
      delete nextOption.ibit_zscore_exit_mode;
      optionChanged = true;
    }
    changed = changed || optionChanged;
    if (!optionChanged) return option;
    return nextOption;
  });
  if (!matched) throw new Error("switch inputs do not match configured account options");
  return {
    options: { ...options, [inputs.platform]: updatedPlatformOptions },
    changed,
  };
}

export function normalizeSwitchInputs(raw) {
  const platform = cleanChoice(raw.platform, SUPPORTED_PLATFORMS, "platform");
  const targetName = cleanSlug(raw.target_name, "target_name");
  const strategyProfile = cleanSlug(raw.strategy_profile, "strategy_profile").toLowerCase();
  assertDcaPlatform(platform, strategyProfile);
  const executionMode = cleanExecutionMode(raw.execution_mode || "live");
  if (!supportedExecutionModesForPlatform(platform).includes(executionMode)) {
    throw new Error(`${platform} does not support ${executionMode} control execution`);
  }
  const liveContinuity = normalizeLiveContinuityInputs(raw, executionMode);
  // "current" is used only by internal deployment reconciliation to retain
  // a service's existing plugin mount.  It is deliberately not exposed as a
  // console editing mode, where operators can still select only "none".
  const requestedPluginMode = cleanChoice(raw.plugin_mode || "none", ["auto", "none", "current"], "plugin_mode");
  const pluginMode = requestedPluginMode === "auto" ? "none" : requestedPluginMode;
  if (String(raw.custom_plugin_mounts_json || "").trim()) {
    throw new Error("legacy custom plugin mounts are retired pending a P1/P2/P3-bound signal.v2 adapter");
  }
  const optionOverlayMode = cleanChoice(raw.option_overlay_mode || "current", OPTION_OVERLAY_MODES, "option_overlay_mode");
  if (optionOverlayMode === "enabled") {
    throw new Error("option overlay is retired; migrate existing option settings and obligations explicitly");
  }
  const cashOnlyExecutionMode = cleanChoice(
    raw.cash_only_execution_mode || "enabled",
    CASH_ONLY_EXECUTION_MODES,
    "cash_only_execution_mode",
  );
  const variableScope = cleanChoice(
    raw.variable_scope || "default",
    ["default", "repository", "environment"],
    "variable_scope",
  );
  const apply = cleanBoolean(raw.apply);
  const triggerPlatformSync = cleanBoolean(raw.trigger_platform_sync) && apply;
  const extraVariablesJson = cleanOptionalJsonObject(raw.extra_variables_json || "", "extra_variables_json");
  const extraVariables = extraVariablesJson ? JSON.parse(extraVariablesJson) : {};
  const directDcaVariables = [DCA_MODE_VARIABLE, DCA_BASE_INVESTMENT_VARIABLE].filter((name) =>
    extraVariables[name] !== undefined && String(extraVariables[name] || "").trim() !== "",
  );
  if (directDcaVariables.length) {
    throw new Error("use dca_mode and dca_base_investment_usd control fields instead of DCA_MODE variables");
  }
  const directIbitZscoreVariables = [
    IBIT_ZSCORE_EXIT_ENABLED_VARIABLE,
    IBIT_ZSCORE_EXIT_MODE_VARIABLE,
    IBIT_ZSCORE_EXIT_PARKING_SYMBOL_VARIABLE,
    "IBIT_ZSCORE_EXIT_RISK_REDUCED_EXPOSURE",
    "IBIT_ZSCORE_EXIT_RISK_OFF_EXPOSURE",
    "IBIT_ZSCORE_EXIT_ALLOW_OUTSIDE_EXECUTION_WINDOW",
  ].filter((name) => extraVariables[name] !== undefined && String(extraVariables[name] || "").trim() !== "");
  if (directIbitZscoreVariables.length) {
    throw new Error(
      "IBIT_ZSCORE_EXIT variables are derived from ibit_smart_dca smart DCA mode; do not set them directly",
    );
  }
  rejectResearchOnlyExtraVariables(extraVariables);
  const directCashOnlyVariables = [
    LEGACY_CASH_ONLY_EXECUTION_VARIABLE,
    ...Object.values(PLATFORM_CASH_ONLY_EXECUTION_VARIABLES),
  ].filter((name) => extraVariables[name] !== undefined && String(extraVariables[name] || "").trim() !== "");
  if (directCashOnlyVariables.length) {
    throw new Error("use cash_only_execution_mode instead of CASH_ONLY_EXECUTION variables");
  }
  const dcaExtraControls = dcaPayloadFromObject(extraVariables);
  stripLegacyIbitZscoreExitControls(extraVariables);

  const inputs = {
    platform,
    target_name: targetName,
    strategy_profile: strategyProfile,
    execution_mode: executionMode,
    live_continuity_state: liveContinuity.state,
    variable_scope: variableScope,
    plugin_mode: pluginMode,
    option_overlay_mode: optionOverlayMode,
    service_targets_mode: "auto",
    apply: apply ? "true" : "false",
    trigger_platform_sync: triggerPlatformSync ? "true" : "false",
    confirm_apply: apply ? (triggerPlatformSync ? "APPLY_AND_SYNC" : "APPLY") : "",
    platform_sync_workflow: "sync-cloud-run-env.yml",
  };

  if (liveContinuity.state !== "NONE") {
    inputs.live_continuity_baseline_id = liveContinuity.baseline_id;
    inputs.live_continuity_captured_at = liveContinuity.captured_at;
  }

  addOptional(inputs, "github_environment", raw.github_environment, cleanSlug);
  addOptional(inputs, "deployment_selector", raw.deployment_selector, cleanSlug);
  addOptional(inputs, "account_selector", raw.account_selector, cleanCsv);
  addOptional(inputs, "account_scope", raw.account_scope, cleanSlug);
  addOptional(inputs, "service_name", raw.service_name, cleanSlug);
  addOptional(inputs, "reserved_cash_ratio", raw.reserved_cash_ratio, cleanRatio);
  addOptional(inputs, "min_reserved_cash_usd", raw.min_reserved_cash_usd, cleanNonNegativeNumber);
  addOptional(inputs, "income_layer_start_usd", raw.income_layer_start_usd, cleanNonNegativeNumber);
  addOptional(inputs, "income_layer_max_ratio", raw.income_layer_max_ratio, cleanRatio);
  const rawHasDcaMode = raw.dca_mode !== undefined && raw.dca_mode !== null && String(raw.dca_mode).trim() !== "";
  const rawHasDcaBase = raw.dca_base_investment_usd !== undefined &&
    raw.dca_base_investment_usd !== null &&
    String(raw.dca_base_investment_usd).trim() !== "";
  const dcaModeValue = rawHasDcaMode ? raw.dca_mode : dcaExtraControls.dca_mode;
  const dcaBaseInvestmentValue = rawHasDcaBase
    ? raw.dca_base_investment_usd
    : dcaExtraControls.dca_base_investment_usd;
  const hasDcaMode = Boolean(String(dcaModeValue || "").trim());
  const hasDcaBase = Boolean(String(dcaBaseInvestmentValue || "").trim());
  if (!isDcaProfile(strategyProfile) && (hasDcaMode || hasDcaBase)) {
    throw new Error("DCA settings are only supported for DCA strategy profiles");
  }
  if (isDcaProfile(strategyProfile)) {
    if (hasDcaMode) extraVariables.dca_mode = cleanDcaMode(dcaModeValue);
    if (hasDcaBase) extraVariables.dca_base_investment_usd = cleanPositiveNumber(
      dcaBaseInvestmentValue,
      "dca_base_investment_usd",
    );
  }
  const cashOnlyMode = cleanChoice(
    raw.cash_only_execution_mode || extraVariables.cash_only_execution_mode || "enabled",
    CASH_ONLY_EXECUTION_MODES,
    "cash_only_execution_mode",
  );
  if (cashOnlyMode !== "current") {
    extraVariables.cash_only_execution_mode = cashOnlyMode;
  }
  if (Object.keys(extraVariables).length) inputs.extra_variables_json = JSON.stringify(extraVariables);
  return inputs;
}

export function normalizeLiveContinuityInputs(raw, executionMode) {
  const state = String(raw.live_continuity_state || "NONE").trim().toUpperCase();
  if (!LIVE_CONTINUITY_STATES.includes(state)) {
    throw new Error(`live_continuity_state must be one of ${LIVE_CONTINUITY_STATES.join(", ")}`);
  }
  const rawBaselineId = String(raw.live_continuity_baseline_id || "").trim();
  const rawCapturedAt = String(raw.live_continuity_captured_at || "").trim();
  if (state === "NONE") {
    if (rawBaselineId || rawCapturedAt) {
      throw new Error("live continuity baseline fields require a non-NONE live_continuity_state");
    }
    return { state };
  }
  if (executionMode !== "live") {
    throw new Error("live continuity is only valid for live execution_mode");
  }
  return {
    state,
    baseline_id: cleanSlug(rawBaselineId, "live_continuity_baseline_id"),
    captured_at: normalizeM0ResearchDate(rawCapturedAt, "live_continuity_captured_at"),
  };
}

export function assertSwitchIntent(inputs) {
  if (
    inputs.apply !== "true" ||
    inputs.trigger_platform_sync !== "true" ||
    inputs.confirm_apply !== "APPLY_AND_SYNC"
  ) {
    throw new Error("switch endpoint requires apply=true and APPLY_AND_SYNC");
  }
}

export function assertConfiguredAccount(inputs, accountOptions) {
  if (!accountOptions) throw new Error("account options are not configured");
  const matched = configuredAccountForInputs(inputs, accountOptions);
  if (!matched) throw new Error("switch inputs do not match configured account options");
  return matched;
}

export function configuredAccountForInputs(inputs, accountOptions) {
  if (!accountOptions) return null;
  const options = accountOptions[inputs.platform] || [];
  return options.find((option) => accountOptionMatchesInputs(option, inputs)) || null;
}

export function registerLegacyContinuityAccount(env, accountOptions, inputs, strategy) {
  if (!hasConfigStore(env)) {
    throw new Error("switch inputs do not match configured account options");
  }
  if (!isEligibleLegacyContinuityInput(inputs, strategy)) {
    throw new Error("switch inputs do not match configured account options");
  }
  const platformOptions = accountOptions[inputs.platform] || [];
  if (platformOptions.some((option) => option.target_name === inputs.target_name)) {
    throw new Error("legacy continuity account target conflicts with configured account options");
  }
  if (platformOptions.some((option) => option.service_name
    && option.service_name === inputs.service_name
    && accountOptionMatchesInputs(option, { ...inputs, target_name: option.target_name }))) {
    throw new HttpError("deployment already has a configured account; use its existing target", 400);
  }
  if (platformOptions.length >= 20) {
    throw new Error(`account options for ${inputs.platform} have reached the maximum`);
  }

  const account = cleanAccountOption(
    {
      key: inputs.target_name,
      label: `Legacy continuity ${inputs.target_name}`,
      target_name: inputs.target_name,
      account_selector: inputs.account_selector,
      deployment_selector: inputs.deployment_selector,
      account_scope: inputs.account_scope,
      service_name: inputs.service_name,
      github_environment: inputs.github_environment,
      variable_scope: resolvedVariableScope(inputs.variable_scope, inputs),
      supported_domains: [strategy.domain],
    },
    inputs.platform,
    platformOptions.length,
  );
  const options = normalizeAccountOptionsPayload(
    { ...accountOptions, [inputs.platform]: [...platformOptions, account] },
    ACCOUNT_OPTIONS_KEY,
  );
  return { options, account: options[inputs.platform].at(-1), registered: true };
}

export function assertStrategyAllowedForAccount(inputs, accountOption, strategyProfiles) {
  const strategy = strategyProfiles.find((item) => sameStrategyProfile(item.profile, inputs.strategy_profile));
  if (!strategy) {
    throw new Error(`strategy ${inputs.strategy_profile} is not configured`);
  }
  const supportedDomains = supportedDomainsForAccount(inputs.platform, accountOption);
  if (!supportedDomains.includes(strategy.domain)) {
    throw new Error(
      `strategy domain ${strategy.domain} is not supported by ${inputs.platform}/${accountOption.key}`,
    );
  }
  const executionMode = cleanExecutionMode(inputs.execution_mode);
  if (!supportedExecutionModesForPlatform(inputs.platform).includes(executionMode)) {
    throw new Error(`${inputs.platform} does not support ${executionMode} control execution`);
  }
  const allowedModes = strategy.allowed_execution_modes || [];
  if (isFrozenStrategyProfile(strategy) && !(
    ["RECONCILE_ONLY", "RISK_REDUCTION_ONLY"].includes(inputs.live_continuity_state)
    && isEligibleLegacyContinuityInput(inputs, strategy)
  )) {
    throw new HttpError(`strategy ${inputs.strategy_profile} is frozen for new selection`, 409);
  }
  if (executionMode === "live") {
    if (isEligibleLegacyContinuityInput(inputs, strategy)) {
      assertDcaPlatform(inputs.platform, inputs.strategy_profile);
      return;
    }
    assertLiveSwitchAllowed(strategy, inputs.strategy_profile);
    const lifecycleStage = cleanLifecycleStage(strategy.lifecycle_stage || "research_active");
    if (!["live_enabled", "runtime_enabled"].includes(lifecycleStage)) {
      throw new Error(`strategy ${inputs.strategy_profile} is not live-enabled`);
    }
    if (!allowedModes.includes(executionMode)) {
      throw new Error(`strategy ${inputs.strategy_profile} is not live-enabled`);
    }
    if (strategy.blocked_live_reason) {
      throw new Error(`strategy ${inputs.strategy_profile} is blocked for live: ${strategy.blocked_live_reason}`);
    }
  } else if (allowedModes.length && !allowedModes.includes(executionMode)) {
    throw new Error(`strategy ${inputs.strategy_profile} does not allow ${executionMode} execution`);
  }
  if (inputs.option_overlay_mode === "enabled" && strategy.option_overlay_enabled !== true) {
    throw new Error(`strategy ${inputs.strategy_profile} does not define an option overlay`);
  }
  assertDcaPlatform(inputs.platform, inputs.strategy_profile);
}

export function isEligibleLegacyContinuityInput(inputs, strategy) {
  if (
    inputs.execution_mode !== "live" ||
    !inputs.live_continuity_state ||
    inputs.live_continuity_state === "NONE" ||
    !inputs.live_continuity_baseline_id ||
    !inputs.live_continuity_captured_at ||
    inputs.plugin_mode !== "current" ||
    inputs.option_overlay_mode !== "current" ||
    inputs.reserved_cash_ratio ||
    inputs.min_reserved_cash_usd ||
    inputs.income_layer_start_usd ||
    inputs.income_layer_max_ratio
  ) {
    return false;
  }
  const extraVariables = inputs.extra_variables_json ? JSON.parse(inputs.extra_variables_json) : {};
  const extraVariableNames = Object.keys(extraVariables);
  if (
    extraVariableNames.length > 1 ||
    (extraVariableNames.length === 1 && (
      extraVariableNames[0] !== "RUNTIME_TARGET_ENABLED" ||
      extraVariables.RUNTIME_TARGET_ENABLED !== "true"
    ))
  ) {
    return false;
  }
  const policy = strategy?.live_continuity;
  return policy?.eligible === true && Array.isArray(policy.allowed_platforms) && policy.allowed_platforms.includes(inputs.platform);
}

export function resolvedVariableScope(value, inputs) {
  const text = String(value || "").trim();
  if (!text || text === "default") return defaultInputValue("variable_scope", inputs);
  return text;
}

export function accountOptionMatchesInputs(option, inputs) {
  if (option.target_name !== inputs.target_name) return false;
  const fields = [
    "account_selector",
    "deployment_selector",
    "account_scope",
    "service_name",
    "github_environment",
    "variable_scope",
  ];
  for (const field of fields) {
    if (field === "variable_scope") {
      if (resolvedVariableScope(option[field], inputs) !== resolvedVariableScope(inputs[field], inputs)) {
        return false;
      }
      continue;
    }
    const expected = option[field] || "";
    const actual = inputs[field] || "";
    if (expected && actual !== expected) return false;
    if (!expected && actual && !["default", "auto", defaultInputValue(field, inputs)].includes(actual)) return false;
  }
  return true;
}

export function defaultInputValue(field, inputs) {
  const platform = inputs.platform;
  const targetName = inputs.target_name;
  if (field === "variable_scope") return DEFAULT_VARIABLE_SCOPE[platform] || "repository";
  if (field === "plugin_mode") return "none";
  if (field === "deployment_selector") {
    if (platform === "firstrade") return "firstrade";
    if (platform === "qmt") return "qmt";
    return ["sg", "hk", "paper"].includes(targetName.toLowerCase()) ? targetName.toUpperCase() : targetName;
  }
  if (field === "account_scope") {
    if (platform === "firstrade") return "US";
    if (platform === "qmt") return "CN";
    return inputs.deployment_selector || defaultInputValue("deployment_selector", inputs);
  }
  if (field === "account_selector") {
    if (platform === "firstrade") return "firstrade";
    if (platform === "qmt") return "qmt";
    return inputs.account_scope || defaultInputValue("account_scope", inputs);
  }
  if (field === "github_environment") {
    const variableScope = inputs.variable_scope === "default"
      ? defaultInputValue("variable_scope", inputs)
      : inputs.variable_scope;
    if (variableScope !== "environment") return "";
    return platform === "longbridge" ? `longbridge-${targetName.toLowerCase()}` : targetName;
  }
  if (field === "service_name") {
    if (platform === "schwab") return "charles-schwab-quant-service";
    if (platform === "firstrade") return "firstrade-quant-service";
    if (platform === "qmt") return "qmt-quant-service";
    if (platform === "longbridge") return `longbridge-quant-${targetName.toLowerCase()}-service`;
    if (platform === "ibkr") return `interactive-brokers-${targetName.toLowerCase()}-service`;
  }
  return "";
}

export function parseAccountOptions(raw, fieldName = "account options") {
  const text = String(raw || "").trim();
  if (!text) return null;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
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
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON`);
  }
  return normalizeStrategyProfilesPayload(payload, fieldName);
}

export function isFrozenStrategyProfile(strategy) {
  const profile = canonicalStrategyProfile(strategy?.profile);
  // Normalize only the policy lookup; retain the original profile in payloads.
  return strategy?.frozen === true || DEFAULT_STRATEGY_PROFILES.some((item) => item.profile === profile && item.frozen === true);
}

export function normalizeStrategyProfilesPayload(payload, fieldName = "strategy profiles") {
  if (!Array.isArray(payload) || payload.length > 100) {
    throw new Error(`${fieldName} must be an array with at most 100 items`);
  }

  const result = [];
  const seen = new Set();
  for (const [index, item] of payload.entries()) {
    if (!item || Array.isArray(item) || typeof item !== "object") {
      throw new Error(`${fieldName}[${index}] must be an object`);
    }
    const profile = cleanCurrentStrategy(item.profile || item.strategy_profile);
    if (!profile) throw new Error(`${fieldName}[${index}].profile is invalid`);
    if (seen.has(profile)) continue;
    seen.add(profile);
    const entry = {
      profile,
      label: cleanLabel(item.label || item.display_name || profile, `${fieldName}[${index}].label`),
      runtime_enabled: cleanProfileBoolean(item.runtime_enabled ?? false),
    };
    addConfigOptional(
      entry,
      "label_en",
      item.label_en || item.display_name_en || item.label,
      cleanLabel,
    );
    addConfigOptional(
      entry,
      "label_zh",
      item.label_zh || item.display_name_zh,
      cleanLabel,
    );
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
    // DCA detection: accept from item payload OR hardcoded DCA_PROFILE_CONFIG
    const dcaEnabled = item.dca_enabled === true || Boolean(DCA_PROFILE_CONFIG[profile]);
    if (dcaEnabled) {
      const dcaDefaults = DCA_PROFILE_CONFIG[profile] || null;
      entry.dca_enabled = true;
      entry.dca_default_mode = cleanDcaMode(item.dca_default_mode || item.default_dca_mode || dcaDefaults?.default_mode || "fixed");
      entry.dca_default_base_investment_usd = cleanPositiveNumber(
        item.dca_default_base_investment_usd ||
          item.default_dca_base_investment_usd ||
          dcaDefaults?.default_base_investment_usd ||
          "1000",
        `${fieldName}[${index}].dca_default_base_investment_usd`,
      );
    }
    // Pass through combo_enabled and combo_mode from item payload
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
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  assertExactFields(value, ["candidate_id", "config_sha256"], fieldName);
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
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
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
  addConfigOptional(result, "option_overlay_live_gate", item.option_overlay_live_gate || (enabled ? "promotion_required" : "disabled"), (value, field) =>
    cleanChoice(value, ["promotion_required", "live_allowed", "disabled"], field),
  );
  addConfigOptional(result, "option_overlay_live_status", item.option_overlay_live_status || (enabled ? "research_only" : "disabled"), (value, field) =>
    cleanChoice(value, ["research_only", "live_allowed", "disabled"], field),
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
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
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
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }

  // Structural gate from account_options_schema.js; cleanAccountOption keeps
  // console-specific enrichment (domain inference, mode defaults, length caps).
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
  if (!item || Array.isArray(item) || typeof item !== "object") {
    throw new Error(`account option ${platform}[${index}] must be an object`);
  }
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
  if (!items.length || items.length > SUPPORTED_STRATEGY_DOMAINS.length) {
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
  return cleanChoice(value, SUPPORTED_STRATEGY_DOMAINS, fieldName);
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

export function cleanChoice(value, allowed, field) {
  const text = String(value || "").trim();
  if (!allowed.includes(text)) throw new Error(`${field} is invalid`);
  return text;
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

export function cleanBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false" || value === "" || value === undefined || value === null) return false;
  throw new Error("boolean input is invalid");
}

export function cleanRatio(value, field) {
  const text = cleanNumberText(value, field);
  const numeric = Number(text);
  if (numeric < 0 || numeric > 1) throw new Error(`${field} must be between 0 and 1`);
  return text;
}

export function cleanNonNegativeNumber(value, field) {
  const text = cleanNumberText(value, field);
  if (Number(text) < 0) throw new Error(`${field} must be non-negative`);
  return text;
}

export function cleanPositiveNumber(value, field) {
  const text = cleanNumberText(value, field);
  if (Number(text) <= 0) throw new Error(`${field} must be greater than 0`);
  return text;
}

export function cleanNumberText(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 32 || !/^(?:\d+|\d*\.\d+)$/.test(text)) {
    throw new Error(`${field} must be a finite decimal number`);
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) throw new Error(`${field} must be finite`);
  return text;
}

export function cleanSlug(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 120 || !/^[A-Za-z0-9._=-]+$/.test(text)) {
    throw new Error(`${field} must use letters, numbers, dot, underscore, dash, or equals`);
  }
  return text;
}

export function cleanRepositoryName(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 160 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    throw new Error(`${field} must be owner/repo`);
  }
  return text;
}

export function cleanLabel(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 80 || /[<>{}]/.test(text)) {
    throw new Error(`${field} is invalid`);
  }
  return text;
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
  // Keep runtime_enabled as a first-class catalog stage so bundled SSOT and
  // /api/strategy-profiles readback stay bit-identical for deploy verification.
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

export function requireSameOrigin(request, options = {}) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    if (options.requireOrigin) throw new HttpError("Origin header is required", 403);
    return;
  }
  if (origin !== new URL(request.url).origin) throw new HttpError("cross-origin request rejected", 403);
}

export const deskAuth = createDeskAuth({ readSession, requireSameOrigin });

export async function fetchGithubVariables(token, repository, scope, githubEnvironment, { reportReadErrors = false, onReadFailure = () => {} } = {}) {
  const apiUrl = githubVariablesUrl(repository, scope, githubEnvironment);
  const values = new Map();
  // Evidence-aware readers opt in. Other callers retain their existing fallback.
  const failed = (reason = "read_failed") => { onReadFailure(reason); return reportReadErrors ? null : new Map(); };
  if (!apiUrl) return failed();
  try {
    // Follow the variable-list pages, never arbitrary URLs returned by an upstream.
    for (let page = 1; ; page += 1) {
      const response = await fetchWithTimeout(`${apiUrl}?per_page=100&page=${page}`, {
        headers: githubHeaders(token),
      });
      if (!response.ok) return failed([401, 403].includes(response.status) ? "permission_denied" : "read_failed");
      const payload = await response.json();
      if (!Array.isArray(payload?.variables)) return failed();
      for (const item of payload.variables) {
        if (typeof item.name === "string" && typeof item.value === "string") values.set(item.name, item.value);
      }
      if (!response.headers.get("Link")?.includes('rel="next"')) return values;
    }
  } catch {
    return failed();
  }
}


export function githubVariablesUrl(repository, scope, githubEnvironment) {
  const [owner, repo] = String(repository || "").split("/");
  if (!owner || !repo) return "";
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  if (scope === "environment") {
    if (!githubEnvironment) return "";
    return `${base}/environments/${encodeURIComponent(githubEnvironment)}/variables`;
  }
  return `${base}/actions/variables`;
}

export function resolveVariableScope(platform, option) {
  const configured = String(option?.variable_scope || "").trim();
  if (configured && configured !== "default") return configured;
  return DEFAULT_VARIABLE_SCOPE[platform] || "repository";
}

export function resolveGithubEnvironment(platform, option, variableScope) {
  if (variableScope !== "environment") return "";
  const configured = String(option?.github_environment || "").trim();
  if (configured) return configured;
  const targetName = String(option?.target_name || option?.key || "").trim();
  if (!targetName) return "";
  if (platform === "longbridge") return `longbridge-${targetName.toLowerCase()}`;
  return targetName;
}

export function runtimeTargetFromServiceTargets(rawValue, platform, option) {
  const payload = parseJsonValue(rawValue);
  const targets = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.targets) ? payload.targets : []);
  const matches = [];
  for (const entry of targets) {
    if (!entry || Array.isArray(entry) || typeof entry !== "object") continue;
    const runtimeTarget = entry.runtime_target && typeof entry.runtime_target === "object"
      ? entry.runtime_target
      : {};
    if (!runtimeTargetMatchesAccount(runtimeTarget, platform, option, entry)) continue;
    // Match deployment identity before reading overrides. The deploy planner
    // supports nested env values and gives explicit top-level values precedence.
    const nestedEnv = entry.env && typeof entry.env === "object" && !Array.isArray(entry.env)
      ? entry.env : {};
    const settings = { ...nestedEnv, ...entry };
    matches.push({
      ...runtimeTarget,
      strategy_profile: runtimeTarget.strategy_profile || entry.strategy_profile,
      ...reservedCashPayloadFromObject(platform, settings),
      ...incomeLayerPayloadFromObject(settings),
      ...optionOverlayPayloadFromObject(settings),
      ...runtimeTargetEnabledPayloadFromObject(settings),
      ...dcaPayloadFromObject(settings),
      ...cashOnlyPayloadFromObject(platform, settings),
    });
  }
  return matches.length === 1 ? matches[0] : null;
}

export async function readCashOnlyVariables({ platform, repository, variableScope, githubEnvironment, readVariable }) {
  const platformVariable = PLATFORM_CASH_ONLY_EXECUTION_VARIABLES[platform];
  const [platformValue, legacyValue] = await Promise.all([
    readVariable(repository, variableScope, githubEnvironment, platformVariable),
    readVariable(repository, variableScope, githubEnvironment, LEGACY_CASH_ONLY_EXECUTION_VARIABLE),
  ]);
  return cashOnlyPayloadFromValues(platformValue ?? legacyValue);
}

export function cashOnlyPayloadFromObject(platform, payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return cashOnlyPayloadFromValues(
    payload[PLATFORM_CASH_ONLY_EXECUTION_VARIABLES[platform]] ??
      payload[LEGACY_CASH_ONLY_EXECUTION_VARIABLE] ??
      payload.cash_only_execution,
  );
}

export function cashOnlyPayloadFromValues(value) {
  const enabled = cleanOptionalBoolean(value);
  if (enabled === null) return {};
  return { cash_only_execution: enabled };
}

export async function readReservedCashVariables({ platform, repository, variableScope, githubEnvironment, readVariable }) {
  const [floorValue, ratioValue] = await Promise.all([
    readVariable(repository, variableScope, githubEnvironment, PLATFORM_MIN_RESERVED_CASH_VARIABLES[platform]),
    readVariable(repository, variableScope, githubEnvironment, PLATFORM_RESERVED_CASH_RATIO_VARIABLES[platform]),
  ]);
  return reservedCashPayloadFromValues(floorValue, ratioValue);
}

export async function readIncomeLayerVariables({ repository, variableScope, githubEnvironment, readVariable }) {
  const [enabledValue, startUsdValue, maxRatioValue] = await Promise.all([
    readVariable(repository, variableScope, githubEnvironment, INCOME_LAYER_ENABLED_VARIABLE),
    readVariable(repository, variableScope, githubEnvironment, INCOME_LAYER_START_USD_VARIABLE),
    readVariable(repository, variableScope, githubEnvironment, INCOME_LAYER_MAX_RATIO_VARIABLE),
  ]);
  return incomeLayerPayloadFromValues(enabledValue, startUsdValue, maxRatioValue);
}

export async function readOptionOverlayVariables({ repository, variableScope, githubEnvironment, readVariable }) {
  const enabledValue = await readVariable(repository, variableScope, githubEnvironment, OPTION_OVERLAY_ENABLED_VARIABLE);
  return optionOverlayPayloadFromValue(enabledValue);
}

export async function readRuntimeTargetEnabledVariable({ repository, variableScope, githubEnvironment, readVariable }) {
  const value = await readVariable(repository, variableScope, githubEnvironment, RUNTIME_TARGET_ENABLED_VARIABLE);
  return runtimeTargetEnabledPayloadFromValue(value);
}

export async function readDcaVariables({ repository, variableScope, githubEnvironment, readVariable }) {
  const [modeValue, baseInvestmentValue] = await Promise.all([
    readVariable(repository, variableScope, githubEnvironment, DCA_MODE_VARIABLE),
    readVariable(repository, variableScope, githubEnvironment, DCA_BASE_INVESTMENT_VARIABLE),
  ]);
  return dcaPayloadFromValues(modeValue, baseInvestmentValue);
}

export function reservedCashPayloadFromObject(platform, payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return reservedCashPayloadFromValues(
    payload[PLATFORM_MIN_RESERVED_CASH_VARIABLES[platform]] ??
      payload.min_reserved_cash_usd ??
      payload.reserved_cash_floor_usd,
    payload[PLATFORM_RESERVED_CASH_RATIO_VARIABLES[platform]] ??
      payload.reserved_cash_ratio,
  );
}

export function reservedCashPayloadFromValues(floorValue, ratioValue) {
  const result = {};
  const floor = cleanCurrentNonNegativeNumber(floorValue);
  const ratio = cleanCurrentRatio(ratioValue);
  if (floor) result.min_reserved_cash_usd = floor;
  if (ratio) result.reserved_cash_ratio = ratio;
  return result;
}

export function incomeLayerPayloadFromObject(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return incomeLayerPayloadFromValues(
    payload[INCOME_LAYER_ENABLED_VARIABLE] ?? payload.income_layer_enabled,
    payload[INCOME_LAYER_START_USD_VARIABLE] ?? payload.income_layer_start_usd,
    payload[INCOME_LAYER_MAX_RATIO_VARIABLE] ?? payload.income_layer_max_ratio,
  );
}

export function incomeLayerPayloadFromValues(enabledValue, startUsdValue, maxRatioValue) {
  const result = {};
  const enabled = cleanOptionalBoolean(enabledValue);
  const startUsd = cleanCurrentNonNegativeNumber(startUsdValue);
  const maxRatio = cleanCurrentRatio(maxRatioValue);
  if (enabled !== null) result.income_layer_enabled = enabled;
  if (startUsd) result.income_layer_start_usd = startUsd;
  if (maxRatio) result.income_layer_max_ratio = maxRatio;
  return result;
}

export function optionOverlayPayloadFromObject(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return optionOverlayPayloadFromValue(
    payload[OPTION_OVERLAY_ENABLED_VARIABLE] ?? payload.option_overlay_enabled,
  );
}

export function optionOverlayPayloadFromValue(value) {
  const enabled = cleanOptionalBoolean(value);
  return enabled === null ? {} : { option_overlay_enabled: enabled };
}

export function runtimeTargetEnabledPayloadFromObject(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return runtimeTargetEnabledPayloadFromValue(
    payload[RUNTIME_TARGET_ENABLED_VARIABLE] ?? payload.runtime_target_enabled,
  );
}

export function runtimeTargetEnabledPayloadFromValue(value) {
  const enabled = cleanOptionalBoolean(value);
  return enabled === null ? {} : { runtime_target_enabled: enabled };
}

export function dcaPayloadFromObject(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return dcaPayloadFromValues(
    payload[DCA_MODE_VARIABLE] ?? payload.dca_mode,
    payload[DCA_BASE_INVESTMENT_VARIABLE] ??
      payload.dca_base_investment_usd ??
      payload.base_investment_usd,
  );
}

export function stripLegacyIbitZscoreExitControls(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return;
  for (const field of [
    "ibit_zscore_exit_mode",
    "ibit_zscore_exit_enabled",
    "ibit_zscore_exit_parking_symbol",
    "ibit_zscore_exit_risk_reduced_exposure",
    "ibit_zscore_exit_risk_off_exposure",
    "ibit_zscore_exit_allow_outside_execution_window",
  ]) {
    delete payload[field];
  }
}

export function dcaPayloadFromValues(modeValue, baseInvestmentValue) {
  const result = {};
  const mode = cleanCurrentDcaMode(modeValue);
  const baseInvestmentUsd = cleanCurrentPositiveNumber(baseInvestmentValue);
  if (mode) result.dca_mode = mode;
  if (baseInvestmentUsd) result.dca_base_investment_usd = baseInvestmentUsd;
  return result;
}

export function dcaControlsFromInputs(inputs) {
  const payload = inputs?.extra_variables_json ? JSON.parse(inputs.extra_variables_json) : {};
  return {
    ...dcaPayloadFromObject(payload),
    ...dcaPayloadFromObject(inputs),
  };
}

export function cashOnlyExecutionModeFromInputs(inputs) {
  const direct = String(inputs?.cash_only_execution_mode || "").trim().toLowerCase();
  if (direct === "enabled" || direct === "disabled") return direct;
  try {
    const payload = inputs?.extra_variables_json ? JSON.parse(inputs.extra_variables_json) : {};
    const mode = String(payload.cash_only_execution_mode || "").trim().toLowerCase();
    return mode === "enabled" || mode === "disabled" ? mode : "";
  } catch {
    return "";
  }
}

export function dcaPayloadForProfile(profile, payload) {
  return isDcaProfile(profile) ? payload : {};
}

export function runtimeModePayload(runtimeTarget) {
  const executionMode = normalizeRuntimeExecutionMode(runtimeTarget?.execution_mode, runtimeTarget?.dry_run_only);
  const payload = {};
  if (executionMode) payload.execution_mode = executionMode;
  const dryRunOnly = cleanOptionalBoolean(runtimeTarget?.dry_run_only);
  if (dryRunOnly !== null) payload.dry_run_only = dryRunOnly;
  return payload;
}

export function normalizeRuntimeExecutionMode(value, dryRunOnly) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "live" || mode === "dry_run") return mode;
  if (mode === "paper" && cleanOptionalBoolean(dryRunOnly) !== true) return mode;
  const dryRun = cleanOptionalBoolean(dryRunOnly);
  if (dryRun === true) return "dry_run";
  if (dryRun === false) return "live";
  return "";
}

export function cleanOptionalBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1") return true;
    if (text === "false" || text === "0") return false;
  }
  return null;
}

export function cleanCurrentNonNegativeNumber(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 32 || !/^(?:\d+|\d*\.\d+)$/.test(text)) return "";
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return "";
  return text;
}

export function cleanCurrentRatio(value) {
  const text = cleanCurrentNonNegativeNumber(value);
  if (!text) return "";
  const numeric = Number(text);
  if (numeric < 0 || numeric > 1) return "";
  return text;
}

export function cleanCurrentPositiveNumber(value) {
  const text = cleanCurrentNonNegativeNumber(value);
  if (!text || Number(text) <= 0) return "";
  return text;
}

export function cleanCurrentDcaMode(value) {
  try {
    return cleanDcaMode(value || "");
  } catch {
    return "";
  }
}

export function runtimeTargetMatchesAccount(runtimeTarget, platform, option, entry = {}) {
  const runtimePlatform = String(runtimeTarget?.platform_id || "").trim().toLowerCase();
  if (runtimePlatform && runtimePlatform !== platform) return false;

  const serviceName = String(option?.service_name || defaultCurrentServiceName(platform, option?.target_name || option?.key) || "");
  const serviceCandidates = [
    runtimeTarget?.service_name,
    entry?.service,
    entry?.service_name,
  ].filter((value) => normalizeMatchValue(value));
  if (serviceName && serviceCandidates.length) {
    return hasCandidate(serviceName, serviceCandidates);
  }

  if (hasCandidate(option?.account_scope, [
    runtimeTarget?.account_scope,
    entry?.ACCOUNT_GROUP,
    entry?.account_scope,
  ])) return true;

  if (hasCandidate(option?.deployment_selector, [
    runtimeTarget?.deployment_selector,
    entry?.deployment_selector,
  ])) return true;

  const optionSelectors = splitSelectorValues(option?.account_selector);
  const runtimeSelectors = splitSelectorValues(runtimeTarget?.account_selector || entry?.account_selector);
  if (optionSelectors.some((value) => runtimeSelectors.includes(value))) return true;

  const targetName = String(option?.target_name || option?.key || "").trim();
  return Boolean(targetName && hasCandidate(targetName, [
    runtimeTarget?.target_name,
    runtimeTarget?.deployment_selector,
    runtimeTarget?.account_scope,
    entry?.target_name,
  ]));
}

export function defaultCurrentServiceName(platform, targetName) {
  const normalized = String(targetName || "").trim().toLowerCase();
  if (!normalized) return "";
  if (platform === "longbridge") return `longbridge-quant-${normalized}-service`;
  if (platform === "ibkr") return `interactive-brokers-${normalized}-service`;
  if (platform === "schwab") return "charles-schwab-quant-service";
  if (platform === "firstrade") return "firstrade-quant-service";
  if (platform === "qmt") return "qmt-quant-service";
  return "";
}

export function hasCandidate(expected, candidates) {
  const normalizedExpected = normalizeMatchValue(expected);
  if (!normalizedExpected) return false;
  return candidates.some((candidate) => normalizeMatchValue(candidate) === normalizedExpected);
}

export function splitSelectorValues(value) {
  if (Array.isArray(value)) return value.map(normalizeMatchValue).filter(Boolean);
  return String(value || "")
    .split(/[,\s]+/)
    .map(normalizeMatchValue)
    .filter(Boolean);
}

export function normalizeMatchValue(value) {
  return String(value || "").trim().toLowerCase();
}

export function parseJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  for (const candidate of [text, text.replaceAll("\\n", "\n")]) {
    try {
      const payload = JSON.parse(candidate);
      return payload && !Array.isArray(payload) && typeof payload === "object" ? payload : null;
    } catch {
      // Try the next representation.
    }
  }
  return null;
}

export function parseJsonValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  for (const candidate of [text, text.replaceAll("\\n", "\n")]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next representation.
    }
  }
  return null;
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

export function cleanJson(value, field) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length > 8000) throw new Error(`${field} is too long`);
  JSON.parse(text);
  return text;
}

export function cleanOptionalJsonObject(value, field) {
  const text = cleanJson(value, field);
  if (!text) return "";
  const payload = JSON.parse(text);
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error(`${field} must be a JSON object`);
  }
  for (const name of Object.keys(payload)) {
    if (looksLikeSecretName(name)) {
      throw new Error(`${field}.${name} looks like a secret and must not be stored here`);
    }
  }
  return text;
}

export function looksLikeSecretName(name) {
  const upperName = String(name || "").toUpperCase();
  if (/_SECRET_(ID|NAME|REF|RESOURCE|RESOURCE_NAME|VERSION)$/.test(upperName)) return false;
  return /PASSWORD|PRIVATE_KEY|TOKEN|API_KEY|ACCESS_KEY|CLIENT_SECRET|SECRET/.test(upperName);
}

export function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "QuantRuntimeSettings-StrategySwitchConsole",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function fetchGithubOrgLogins(token, timeoutMs = GITHUB_API_TIMEOUT_MS) {
  const orgs = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetchWithTimeout(`https://api.github.com/user/orgs?per_page=100&page=${page}`, {
      headers: githubHeaders(token),
    }, timeoutMs);
    if (!response.ok) return orgs;
    const payload = await response.json();
    if (!Array.isArray(payload) || !payload.length) break;
    for (const org of payload) {
      const login = cleanGithubOrg(org?.login || "", "github org");
      if (login) orgs.push(login);
    }
    if (payload.length < 100) break;
  }
  return uniqueStrings(orgs);
}

export async function loadAccountOptionsConfig(env) {
  if (hasRuntimeInstanceStore(env)) {
    const state = await runtimeInstanceCommand(env);
    if (state.initialized) return { options: state.account_options, source: "durable_object", revision: state.revision };
    // Existing execution can read the frozen legacy configuration during import;
    // every instance writer rejects this uninitialized state.
  }
  return loadLegacyAccountOptionsConfig(env);
}

export async function loadLegacyAccountOptionsConfig(env) {
  if (hasConfigStore(env)) {
    const stored = await readConfigJson(env, ACCOUNT_OPTIONS_KEY);
    if (stored) {
      return {
        options: normalizeAccountOptionsPayload(stored, ACCOUNT_OPTIONS_KEY),
        source: "kv",
      };
    }
  }
  return {
    options: parseAccountOptions(env.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON || "", "STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON"),
    source: env.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON ? "secret" : "none",
  };
}

export async function loadStrategyProfilesConfig(env) {
  if (hasConfigStore(env)) {
    const stored = await readConfigJson(env, STRATEGY_PROFILES_KEY);
    if (stored) return normalizeStrategyProfilesPayload(stored, STRATEGY_PROFILES_KEY);
  }
  const configured = parseStrategyProfiles(
    env.STRATEGY_SWITCH_STRATEGY_PROFILES_JSON || "",
    "STRATEGY_SWITCH_STRATEGY_PROFILES_JSON",
  );
  if (configured) return configured;
  return normalizeStrategyProfilesPayload(DEFAULT_STRATEGY_PROFILES, "DEFAULT_STRATEGY_PROFILES");
}

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

export async function calculateRiskProfileSelectionSha256(payload) {
  const material = { ...payload };
  delete material.selection_sha256;
  const raw = new TextEncoder().encode(canonicalResearchTaskJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function normalizeRiskProfileSelection(payload, fieldName) {
  const value = assertExactFields(payload, ["schema", "profile_id", "risk_preference", "selection_sha256"], fieldName);
  const riskPreference = cleanChoice(value.risk_preference, RISK_PROFILE_PREFERENCES, `${fieldName}.risk_preference`);
  const normalized = {
    schema: RISK_PROFILE_SELECTION_SCHEMA_VERSION,
    profile_id: RISK_PROFILE_IDS[riskPreference],
    risk_preference: riskPreference,
    selection_sha256: normalizeResearchTaskDigest(value.selection_sha256, `${fieldName}.selection_sha256`),
  };
  if (value.schema !== RISK_PROFILE_SELECTION_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema is unsupported`);
  }
  if (value.profile_id !== normalized.profile_id) {
    throw new Error(`${fieldName}.profile_id does not match risk_preference`);
  }
  if (normalized.selection_sha256 !== await calculateRiskProfileSelectionSha256(normalized)) {
    throw new Error(`${fieldName}.selection_sha256 mismatch`);
  }
  return normalized;
}

export async function calculateRiskProfileBindingSha256(payload) {
  const material = { ...payload };
  delete material.binding_sha256;
  const raw = new TextEncoder().encode(canonicalResearchTaskJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function normalizeRiskProfileBinding(payload, fieldName) {
  const value = assertExactFields(payload, [
    "schema_version", "scope_id", "platform", "target_name", "profile_selection", "updated_at", "updated_by",
    "no_order", "execution_authority_granted", "binding_sha256",
  ], fieldName);
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
  if (value.schema_version !== RISK_PROFILE_BINDING_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  if (value.scope_id !== normalized.scope_id) {
    throw new Error(`${fieldName}.scope_id does not match platform and target_name`);
  }
  if (normalized.no_order !== true || normalized.execution_authority_granted !== false) {
    throw new Error(`${fieldName} must remain no-order and non-executable`);
  }
  if (normalized.binding_sha256 !== await calculateRiskProfileBindingSha256(normalized)) {
    throw new Error(`${fieldName}.binding_sha256 mismatch`);
  }
  return normalized;
}

export async function normalizeRiskProfileBindingRegistry(payload, fieldName = RISK_PROFILE_BINDINGS_KEY) {
  const value = assertExactFields(payload, ["schema_version", "bindings"], fieldName);
  if (value.schema_version !== RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  if (!Array.isArray(value.bindings) || value.bindings.length > SUPPORTED_PLATFORMS.length * 20) {
    throw new Error(`${fieldName}.bindings must be a bounded array`);
  }
  const bindings = [];
  const scopes = new Set();
  for (const [index, item] of value.bindings.entries()) {
    const binding = await normalizeRiskProfileBinding(item, `${fieldName}.bindings[${index}]`);
    if (scopes.has(binding.scope_id)) throw new Error(`${fieldName}.bindings contains duplicate scope_id`);
    scopes.add(binding.scope_id);
    bindings.push(binding);
  }
  return bindings.sort((left, right) => left.scope_id.localeCompare(right.scope_id));
}

export async function buildRiskProfileBindings(payload, accountOptions, updatedBy) {
  const value = assertExactFields(payload, ["bindings"], "risk profile bindings request");
  if (!Array.isArray(value.bindings) || value.bindings.length > SUPPORTED_PLATFORMS.length * 20) {
    throw new Error("risk profile bindings request.bindings must be a bounded array");
  }
  const bindings = [];
  const scopes = new Set();
  const updatedAt = utcTimestampSeconds();
  for (const [index, item] of value.bindings.entries()) {
    const itemValue = assertExactFields(item, ["platform", "target_name", "risk_preference"], `risk profile bindings request.bindings[${index}]`);
    const platform = cleanChoice(itemValue.platform, SUPPORTED_PLATFORMS, `risk profile bindings request.bindings[${index}].platform`);
    const targetName = cleanSlug(itemValue.target_name, `risk profile bindings request.bindings[${index}].target_name`);
    if (!riskProfileBindingTargets(accountOptions).some((target) => target.platform === platform && target.target_name === targetName)) {
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

export async function readRiskProfileLegacy(env) {
  if (!hasConfigStore(env)) return { state: "absent" };
  try {
    const stored = await readConfigJson(env, RISK_PROFILE_BINDINGS_KEY);
    if (!stored) return { state: "absent" };
    return { state: "valid", bindings: await normalizeRiskProfileBindingRegistry(stored) };
  } catch {
    return { state: "blocked" };
  }
}

export async function loadRiskProfileBindings(env) {
  if (!hasRuntimeInstanceStore(env)) {
    return { bindings: [], revision: null, account_options: null, error: "runtime_instances_not_bound", status: 503 };
  }
  const legacy = await readRiskProfileLegacy(env);
  try {
    const state = await runtimeInstanceCommand(env, { action: "risk_profile_read", actor: "risk-profile-read", legacy });
    return { bindings: state.bindings, revision: state.revision, account_options: state.account_options, error: null, status: 200 };
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return {
      bindings: [],
      revision: null,
      account_options: null,
      error: error instanceof HttpError ? error.message : "runtime_instances_unavailable",
      status,
    };
  }
}

function deskTargetReadbackDeps() {
  return {
    runtimeInstanceCommand,
    readRiskProfileLegacy,
    platformRepositories,
    fetchGithubVariables,
    resolveCurrentStrategyForAccount,
    resolveVariableScope,
    resolveGithubEnvironment,
    runtimeTargetFromServiceTargets,
    parseJsonObject,
    runtimeTargetMatchesAccount,
    cleanCurrentRatio,
    splitSelectorValues,
  };
}

const deskTargetReadbackImpl = createDeskTargetReadback(deskTargetReadbackDeps());

export async function deskTargetReadback(env, target, actor, suppliedObserved = undefined) {
  return deskTargetReadbackImpl(env, target, actor, suppliedObserved);
}

export async function effectiveAccountSettings(env, observed) {
  const broker = observed.identity?.broker_environment === "live" || observed.identity?.broker_environment === "paper"
    ? { status: "known", value: observed.identity.broker_environment }
    : { status: "unknown" };
  // Keep the legacy value shape: non-DCA settings remain absent for old clients.
  const effective = {
    strategy_profile: { status: "unknown" },
    broker_environment: broker,
    income_layer_enabled: { status: "unknown" },
    option_overlay_enabled: { status: "unknown" },
    reserved_cash_floor: { status: "unknown" },
    reserved_cash_ratio: { status: "unknown" },
  };
  const fields = ["strategy_profile", "dca_mode", "dca_base_investment_usd", "income_layer_enabled",
    "option_overlay_enabled", "reserved_cash_floor", "reserved_cash_ratio"];
  // This names the resolver path, not a particular variable, deployment or broker readback.
  const finish = (reason = "runtime_setting_unresolved", dcaReason = reason) => ({
    effective,
    effectiveRead: Object.fromEntries(fields.map(field => [field, {
      status: effective[field]?.status === "known" ? "known" : "unknown",
      source: "github_runtime_configuration",
      source_as_of: null,
      reason: effective[field]?.status === "known" ? null : field.startsWith("dca_") ? dcaReason : reason,
    }])),
  });
  const token = env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
  const repository = platformRepositories(env)?.[observed.platform];
  if (!token) return finish("reader_not_configured");
  if (!repository) return finish("repository_not_configured");
  if (!observed.config) return finish("account_config_unavailable");
  const options = Array.isArray(observed.account_options?.[observed.platform]) ? observed.account_options[observed.platform] : [];
  const variableCache = new Map();
  let readFailed = false;
  const readVariable = async (repo, scope, githubEnvironment, name) => {
    const cacheKey = [repo, scope, githubEnvironment || ""].join("|");
    if (!variableCache.has(cacheKey)) variableCache.set(cacheKey, fetchGithubVariables(token, repo, scope, githubEnvironment, { reportReadErrors: true }));
    const values = await variableCache.get(cacheKey);
    if (values === null) readFailed = true;
    return values?.get(name) || "";
  };
  let current = null;
  try {
    current = await resolveCurrentStrategyForAccount({
      platform: observed.platform,
      option: observed.config,
      optionsCount: options.length || 1,
      repository,
      readVariable,
    });
  } catch {
    return finish("runtime_configuration_read_failed");
  }
  // A failed later page must discard earlier values, never certify missing settings.
  if (readFailed) return finish("runtime_configuration_read_failed");
  if (!current || typeof current !== "object") current = {};
  if (typeof current.strategy_profile === "string" && current.strategy_profile) {
    effective.strategy_profile = { status: "known", value: current.strategy_profile };
  }
  if (typeof current.income_layer_enabled === "boolean") effective.income_layer_enabled = { status: "known", value: current.income_layer_enabled };
  if (typeof current.option_overlay_enabled === "boolean") effective.option_overlay_enabled = { status: "known", value: current.option_overlay_enabled };
  if (typeof current.min_reserved_cash_usd === "string" && current.min_reserved_cash_usd) {
    effective.reserved_cash_floor = { status: "known", value: current.min_reserved_cash_usd };
  }
  if (typeof current.reserved_cash_ratio === "string") {
    const ratio = cleanCurrentRatio(current.reserved_cash_ratio);
    if (ratio) effective.reserved_cash_ratio = { status: "known", value: ratio };
  }
  const profile = effective.strategy_profile.status === "known" ? effective.strategy_profile.value : "";
  if (isDcaProfile(profile) && DCA_SUPPORTED_PLATFORMS.has(observed.platform)) {
    const mode = current.dca_mode === "fixed" || current.dca_mode === "smart" ? current.dca_mode : "";
    const amount = typeof current.dca_base_investment_usd === "string" ? current.dca_base_investment_usd : "";
    effective.dca_mode = mode ? { status: "known", value: mode } : { status: "unknown" };
    effective.dca_base_investment_usd = amount ? { status: "known", value: amount } : { status: "unknown" };
    return finish();
  }
  return finish("runtime_setting_unresolved", !DCA_SUPPORTED_PLATFORMS.has(observed.platform) || profile
    ? "dca_not_applicable" : "strategy_profile_unresolved");
}

export async function accountSettingsProfileRuntimeReadback(env, observed, resolved = null) {
  const token = env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
  const repository = resolved?.repository ?? platformRepositories(env)?.[observed.platform];
  if (!token || !repository || !observed.config) return null;
  const options = Array.isArray(observed.account_options?.[observed.platform])
    ? observed.account_options[observed.platform] : [];
  const variableCache = new Map();
  const readVariable = async (repo, scope, githubEnvironment, name) => {
    const cacheKey = [repo, scope, githubEnvironment || ""].join("|");
    if (!variableCache.has(cacheKey)) {
      variableCache.set(cacheKey, fetchGithubVariables(token, repo, scope, githubEnvironment));
    }
    return (await variableCache.get(cacheKey)).get(name) || "";
  };
  try {
    const current = await resolveCurrentStrategyForAccount({
      platform: observed.platform,
      option: observed.config,
      optionsCount: options.length || 1,
      repository,
      readVariable,
    });
    if (!current) return null;
    const variableScope = resolved?.variableScope ?? resolveVariableScope(observed.platform, observed.config);
    const githubEnvironment = resolved?.githubEnvironment ?? resolveGithubEnvironment(observed.platform, observed.config, variableScope);
    const variables = await variableCache.get([repository, variableScope, githubEnvironment || ""].join("|"));
    return {
      strategy_profile: current.strategy_profile || null,
      runtime_target_enabled: variables?.get(RUNTIME_TARGET_ENABLED_VARIABLE) || null,
    };
  } catch {
    return null;
  }
}

export function hasConfigStore(env) {
  return Boolean(configStore(env));
}

export function configStore(env) {
  const store = env.STRATEGY_SWITCH_CONFIG;
  if (!store || typeof store.get !== "function" || typeof store.put !== "function") return null;
  return store;
}

export async function readConfigJson(env, key) {
  const store = configStore(env);
  if (!store) return null;
  const text = await store.get(key);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`STRATEGY_SWITCH_CONFIG.${key} must be valid JSON`);
  }
}

export async function writeConfigJson(env, key, value) {
  const store = configStore(env);
  if (!store) throw new Error("STRATEGY_SWITCH_CONFIG KV binding is required");
  const text = JSON.stringify(value, null, 2);
  if (indexedKey(key)) await directoryCommand(env, { action: "put", key, value: text });
  else await store.put(key, text);
}

export async function loadAuditLog(env) {
  if (!hasConfigStore(env)) return [];
  const payload = await readConfigJson(env, AUDIT_LOG_KEY);
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((entry) => entry && !Array.isArray(entry) && typeof entry === "object")
    .slice(0, AUDIT_LOG_LIMIT);
}

export async function appendAuditLog(env, entry) {
  if (!hasConfigStore(env)) return;
  let current = [];
  try {
    current = await loadAuditLog(env);
  } catch (error) {
    current = [];
  }
  await writeConfigJson(env, AUDIT_LOG_KEY, [entry, ...current].slice(0, AUDIT_LOG_LIMIT));
}

export function accountCounts(accountOptions) {
  const counts = {};
  for (const platform of SUPPORTED_PLATFORMS) {
    counts[platform] = Array.isArray(accountOptions[platform]) ? accountOptions[platform].length : 0;
  }
  return counts;
}

export async function overviewFxResponse(request, fetchImpl = fetch) {
  return overviewFxResponseImpl(request, {
    fetchImpl,
    fetchWithTimeout,
    json,
    responseHeaders,
  });
}

export function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: responseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }, headers),
  });
}

export function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: responseHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    }, headers),
  });
}

export function redirect(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: responseHeaders({ Location: location }, headers),
  });
}

export function responseHeaders(base = {}, extra = {}) {
  const headers = new Headers(SECURITY_HEADERS);
  appendHeaderEntries(headers, base);
  appendHeaderEntries(headers, extra);
  return headers;
}

export function appendHeaderEntries(headers, values) {
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
}

export function renderMessage(title, message) {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<body style="font-family:system-ui,sans-serif;margin:40px;color:#1c211d;background:#f7f8f3">
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">返回控制台</a></p></body>`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
