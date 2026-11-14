import { performanceBenchmarkResponse } from "./application/console_api/performance_benchmarks.js";
import { binanceDetailCommand } from "./binance_detail_archive.js";
import { createDeskAuth, DeskError, deskErrorResponse } from "./application/desk/http.js";
import { DeskReadbackStore, deskReadbackResponse, buildReadback, readbackTargets } from "./application/desk/readback.js";
import { deskCredentialsResponse } from "./application/desk/credentials.js";
import { deskSwitchTargetsResponse } from "./application/desk/switch_targets.js";
import { deskAccountsResponse } from "./application/desk/accounts.js";
import { deskOverviewResponse } from "./application/desk/overview.js";
import { deskPerformanceResponse } from "./application/desk/performance.js";
import { deskRibbonResponse } from "./application/desk/ribbon.js";
import { deskSwitchStrategiesResponse } from "./application/desk/switch_strategies.js";
import { todaySummary } from "./application/console_api/operations.js";
import { auditPageQuery, auditEventInPage, auditEventOrder, auditNextCursor } from "./application/console_api/audit_pagination.js";
import { runtimeReadbackProjection } from "./application/console_api/runtime_readback.js";
import { initialEnrollmentBindingsMatch, initialEnrollmentDigest } from "./application/console_api/initial_enrollment.js";
import { readNotificationLog } from "./application/console_api/notification_receipts.js";
import { readRuntimeControlReceipt } from "./application/console_api/runtime_control_receipts.js";
import { KvDirectory, currentStrategiesSignature, DIRECTORY_PATH, directoryCommand, directoryList, directoryStatus, indexedKey, maintainDirectory } from "./kv_directory.js";
import { sourceListFailure } from "./application/console_api/read_failures.js";
import { strategyTargetExecution, accountExecutionEvidence } from "./application/console_api/strategy_execution.js";
import { performanceResponse } from "./application/console_api/performance_routes.js";
import { consoleApiResponse } from "./application/console_api/routes.js";
import { runControls } from "./application/console_api/run_controls.js";
import { decorateQueue, decisionFields, actorAlias, pageQuery, shortId } from "./application/console_api/presentation.js";
import { inbox } from "./application/console_api/inbox.js";
import {
  DECISION_ACTIONS, DECISION_REVIEW_SCHEMA_VERSION, decisionCategoryPart, decisionCurrentEligibility,
  decisionExpiry, decisionExpiryState, decisionKind, decisionOperationId, decisionOperationReference,
  decisionOperationSha256, decisionRevision, decisionWriteCategory,
  operationIdFor, operationStatusFromApplication,
} from "./application/console_api/decision_contract.js";
import { RISK_TIER_POLICY_BINDINGS, riskTierBindingView, riskTierPolicyCatalog } from "./application/console_api/risk_tiers.js";
import { recoveryMaterialPresentation, currentReconciliationObservationPresentation } from "./application/console_api/reconciliation_presentation.js";
// deploy: 2026-06-30 — config driven by platform-config.json
import { initializeSecretRotation, durableRotationCommand, credentialRotationResponse } from "./secretRotation.js";
import { RotationError } from "./secretRotationStepUp.js";
import { CredentialMaintenanceError, initializeCredentialMaintenance, credentialMaintenanceCommand } from "./credentialMaintenance.js";
import { V2_ASSETS, V2_PAGE_HTML, V2_BUILD_ID } from "./v2_asset_map.js";
import { CycleHealthError, canonicalCycleJson, cycleHealthSha256, normalizeCycleHealth, normalizeCycleInstant, compareCycleInstants, cycleCoverageComplete, cycleHealthAttemptKey, cycleHealthFaultCategory, cycleHealthFaultTime } from "./runtime_cycle_health.js";
import { RUNTIME_DAILY_TARGET, RUNTIME_DAILY_TARGETS, RUNTIME_DAILY_TIMEZONE, runtimeDailyBusinessDate, runtimeDailyTarget, runtimeDailyBoundAccountKey, runtimeDailyRunIssue, parseRuntimeDailyTargetKey } from "./runtime_daily_contract.js";
import {
  BINANCE_FACTS_KEY, BINANCE_FACTS_MAX_BYTES, BinanceFactsError,
  normalizeBinanceFactsBinding, binanceFactsOptionMatches, assertBinanceFactsSourceBinding,
  normalizeBinanceAccountFacts, projectBinanceAccountFacts,
  binanceWalletHistoryEntry, binanceWalletHistoryStorageKey, normalizeBinanceWalletHistoryEntry,
  projectBinanceWalletHistoryFromSources,
  assertBinanceFactsHistoryBindings, BINANCE_WALLET_HISTORY_MAX_DAYS,
} from "./binance_account_facts.js";
import { DEFAULT_STRATEGY_PROFILES } from "./strategy_profiles_asset.js";
import { canonicalStrategyProfile, sameStrategyProfile } from "./strategy_identity.js";
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
} from "./config.js";
import {
  DEFAULT_PLATFORM_REPOSITORIES,
  PLATFORM_REPOSITORY_ENV,
  PLATFORM_CASH_ONLY_EXECUTION_VARIABLES_MAP as PLATFORM_CASH_ONLY_EXECUTION_VARIABLES,
  OBSERVABILITY_PLATFORM_IDS,
  resolvePlatformRepositories,
  isDcaSupportedPlatform,
} from "./platform_registry.js";
import { assertLiveSwitchAllowed, catalogVersionMetadata, isLiveSwitchAllowed } from "./catalog.js";
import {
  BROKER_ENVIRONMENTS,
  normalizeAccountOptionsPayload as normalizeAccountOptionsSchemaPayload,
  parseAccountOptionsJson as parseAccountOptionsSchemaJson,
} from "./account_options_schema.js";
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
} from "./account_facts.js";
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
} from "./ux1_research_contract.js";
import {
  OVERVIEW_FX_PROXY_PATH,
  OVERVIEW_FX_UPSTREAM_URL,
  overviewFxResponse as overviewFxResponseImpl,
  resetOverviewFxCache,
} from "./infrastructure/fx/overview_fx.js";
import {
  MARKET_BENCHMARK_API_PATH,
  MARKET_BENCHMARK_SYNC_PATH,
  MARKET_BENCHMARK_SCHEMA,
  MARKET_BENCHMARK_SERIES_IDS,
  MarketBenchmarkError,
  normalizeMarketBenchmarkSyncPayload,
  publicMarketBenchmarkReadModel,
} from "./infrastructure/market_benchmark/market_benchmark.js";
import {
  MARKET_BENCHMARK_REVISION_PATH,
  planRevisionApply,
  revisionApplyLogSummary,
  MarketBenchmarkRevisionError,
} from "./infrastructure/market_benchmark/market_benchmark_revision.js";
import {
  accountFactsResponse as accountFactsResponseImpl,
  accountFactsHistoryResponse as accountFactsHistoryResponseImpl,
  accountFactsIdentityDates,
} from "./application/account_facts/read.js";
import {
  syncAccountFactsResponse as syncAccountFactsResponseImpl,
} from "./application/account_facts/sync.js";
import {
  ownerDecisionQueueResponse as ownerDecisionQueueResponseImpl,
  recordOwnerDecisionResponse as recordOwnerDecisionResponseImpl,
} from "./application/approval/owner_decisions.js";
import {
  researchPromotionApplicationResponse as researchPromotionApplicationResponseImpl,
  researchPromotionApplicationInternalResponse as researchPromotionApplicationInternalResponseImpl,
} from "./application/research_promotion/applications.js";
import { HttpError } from "./application/http_error.js";
import { buildRiskEnvelopeView, attachRiskEnvelopeView } from "./application/risk_envelope.js";
import {
  ACCOUNT_DIAGNOSIS_REQUEST_PATH,
  ACCOUNT_DIAGNOSIS_INTERNAL_PREFIX,
} from "./application/account_diagnosis/constants.js";
import {
  UX1_CALCULATOR_DEADLINE_MS,
  UX1_CALCULATOR_MAX_BYTES,
  UX1_JOB_UNKNOWN_AFTER_MS,
} from "./application/ux1/constants.js";
import {
  runtimeInstanceCommand,
} from "./application/runtime_instances/command.js";
import { readSession, makeSession } from "./application/auth/session.js";
import { startLogin, finishLogin } from "./application/auth/login.js";
import {
  ux1DraftGet,
  ux1DraftPost,
  ux1PreviewPost,
  ux1IntentPost,
  ux1JobClaimPost,
  ux1JobResultPost,
  presentUx1Preview,
  projectUx1Job,
  ux1RunMatches,
  ux1RuntimeEpoch,
  readUx1CalculatorExchange,
} from "./application/ux1/research.js";

import * as api from './application/worker/runtime_support.js';
import { RuntimeInstances } from "./application/runtime_instances/durable_object.js";
export { RuntimeInstances };

const {
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_PATH,
  CURRENT_STRATEGIES_KV_BUMP_MS,
  CURRENT_STRATEGIES_KV_FRESH_MS,
  CURRENT_STRATEGIES_TIMEOUT_MS,
  DEFAULT_REPOSITORY,
  acceptHkStopResult,
  accountDiagnosisInternalResponse,
  accountDiagnosisResponse,
  accountDraftStrategyChoices,
  accountFactsErrorResponse,
  accountFactsHistoryResponse,
  accountFactsResponse,
  accountOptionMatchesInputs,
  accountSettingsAuditChanges,
  accountSettingsResponse,
  adaptiveSelectionResponse,
  adminConfigResponse,
  aggregateRuntimeTargetLifecycleSources,
  approveAccountSettingsProfileApplication,
  assertAccountDraftPatch,
  assertConfiguredAccount,
  assertStrategyAllowedForAccount,
  attachPromotionQueueReadMetadata,
  attachResearchPromotionApplicationPreparation,
  auditEventAction,
  auditEventsResponse,
  binanceAccountFactsReadinessResponse,
  binanceAccountFactsResponse,
  binanceDetailArchiveResponse,
  binanceDigestSnapshotResponse,
  binancePrivateScopeResponse,
  binanceWalletHistoryResponse,
  BOOTSTRAP_CONFIG_JS,
  BOOT_RECOVERY_JS,
  buildRiskProfileBindings,
  calculateAdaptiveSelectionDecisionDigest,
  calculateM0ResearchLedgerSha256,
  calculateReconciliationRecoveryConfirmationSha256,
  calculateResearchTaskSha256,
  calculateRiskProfileBindingSha256,
  calculateRiskProfileSelectionSha256,
  canonicalResearchTaskJson,
  claimAccountSettingsProfileApplicationFromGitHub,
  configPayload,
  consoleRunControls,
  controlPlaneResearchSnapshotFreshness,
  controlPlaneResponse,
  credentialMaintenanceResponse,
  dcaDraftSupported,
  decisionActionResponse,
  decisionReviewResponse,
  deskAuth,
  deskTargetReadback,
  dispatchAccountDiagnosis,
  dispatchBinanceResume,
  dispatchRuntimeStop,
  dispatchSwitch,
  effectiveAccountSettings,
  emptyAdaptiveSelectionPayload,
  emptyControlPlanePayload,
  emptyExecutionEvidencePayload,
  emptyM0ResearchDashboardPayload,
  emptyReconciliationRecoveryPayload,
  emptyResearchTaskPayload,
  emptyStrategyHealthPayload,
  executionEvidenceResponse,
  fetchResearchPromotionTicketResponse,
  fetchWithTimeout,
  hasConfigStore,
  html,
  humanDecisionReceipt,
  inferAccountSupportedDomains,
  isConfigJsonParseError,
  isDegradedCurrentStrategies,
  json,
  loadAccountOptionsConfig,
  loadAccountFactsBindings,
  loadStoredAccountFactsMap,
  isFrozenStrategyProfile,
  isDcaProfile,
  supportedExecutionModesForPlatform,
  cleanLifecycleStage,
  loadAuditLog,
  loadCurrentStrategies,
  loadCurrentStrategiesSafely,
  loadPlatformMeta,
  loadStrategyProfilesConfig,
  logout,
  m0ResearchLedgerResponse,
  marketBenchmarkResponse,
  normalizeAccountOptionsPayload,
  normalizeAdaptiveSelectionSourceSnapshot,
  normalizeControlPlaneSnapshot,
  normalizeControlPlaneSourceSnapshot,
  normalizeExecutionEvidenceSourceSnapshot,
  normalizeM0ResearchLedgerTransport,
  normalizeReconciliationRecoveryConfirmation,
  normalizeReconciliationRecoverySourceSnapshot,
  normalizeResearchPromotionTicket,
  normalizeResearchTask,
  normalizeResearchTaskSourceSnapshot,
  normalizeRiskProfileBindingRegistry,
  normalizeRuntimeTargetLifecycleTarget,
  normalizeStrategyHealthSnapshot,
  normalizeStrategyProfilesPayload,
  normalizeSwitchInputs,
  operationResponse,
  overviewFxResponse,
  ownerDecisionQueueResponse,
  platformRepositories,
  projectM0ResearchDashboardForRead,
  projectRuntimeAccountState,
  readBoundAccountExecutions,
  readCurrentStrategies,
  readCurrentStrategiesCacheEntry,
  readRuntimeStop,
  reconciliationRecoveryControllerReadResponse,
  reconciliationRecoveryResponse,
  recordOwnerDecisionResponse,
  recordReconciliationRecoveryConfirmationResponse,
  recordResearchPromotionDecisionResponse,
  requireSameOrigin,
  researchPromotionApplicationInternalResponse,
  researchPromotionApplicationResponse,
  researchPromotionMaterialKey,
  researchPromotionReviewBinding,
  researchPromotionReviewMaterial,
  researchPromotionTicketsResponse,
  researchTaskResponse,
  resolvedVariableScope,
  responseHeaders,
  reviseMarketBenchmarkResponse,
  riskProfileBindingTargets,
  riskProfileBindingsResponse,
  runtimeCatalogResponse,
  runtimeCycleHealthAdmissionResponse,
  runtimeCycleHealthSourceResponse,
  runtimeDailyPublicBindings,
  runtimeDailyReadModelEnabled,
  runtimeDailyRegisteredBindings,
  runtimeDailyResponse,
  runtimeInstancesResponse,
  runtimeReadbackResponse,
  runtimeTargetLifecycleResponse,
  saveAccountSettings,
  saveAdminConfig,
  saveCombinedAccountDraft,
  saveRiskProfileBindings,
  sessionPayload,
  sha256Hex,
  splitSelectorValues,
  strategyHealthResponse,
  strategyProfilesPayload,
  supportedDomainsForAccount,
  syncAccountDefaultResponse,
  syncAccountExecutionsResponse,
  syncAccountExternalFlowResponse,
  syncAccountFactsResponse,
  syncAccountPeriodReturnResponse,
  syncAdaptiveSelectionSourceResponse,
  syncBinanceAccountFactsResponse,
  syncBinancePrivateScopeResponse,
  syncControlPlaneResponse,
  syncControlPlaneSourceResponse,
  syncDefaultStrategyForAccount,
  syncExecutionEvidenceSourceResponse,
  syncM0ResearchLedgerResponse,
  syncMarketBenchmarkResponse,
  syncReconciliationRecoverySourceResponse,
  syncResearchPromotionTicketResponse,
  syncResearchTaskSourceResponse,
  syncRuntimeDailyResponse,
  syncRuntimeTargetLifecycleSourceResponse,
  syncStrategyHealthResponse,
  syncStrategyProfilesConfig,
  syncStrategyProfilesResponse,
  updateAccountOptionsDefaultStrategy,
  validateResearchPromotionSelectedAccount,
  withTimeout,
  writeCurrentStrategiesCache,
} = api;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") {
        if (request.method !== "GET" && request.method !== "HEAD") return json({ ok: false, error: "method_not_allowed" }, 405);
        const headers = responseHeaders({ "Content-Type": "text/html; charset=utf-8", "X-Console-Build": V2_BUILD_ID, "Cache-Control": "no-store" });
        return new Response(request.method === "HEAD" ? null : V2_PAGE_HTML, { status: 200, headers });
      }
      if (["/v2", "/v2/", "/v2/index.html"].includes(url.pathname)) {
        if (request.method !== "GET" && request.method !== "HEAD") return json({ ok: false, error: "method_not_allowed" }, 405);
        return new Response(null, { status: 302, headers: responseHeaders({ Location: `/${url.search}`, "Cache-Control": "no-store" }) });
      }
      if (url.pathname === "/v2" || url.pathname.startsWith("/v2/")) {
        const buildHeaders = values => responseHeaders({ ...values, "X-Console-Build": V2_BUILD_ID });
        if (request.method !== "GET" && request.method !== "HEAD") return json({ ok: false, error: "method_not_allowed" }, 405);
        const asset = V2_ASSETS[url.pathname];
        if (!asset) {
          if (request.method === "HEAD") return new Response(null, { status: 404, headers: buildHeaders({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }) });
          return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: buildHeaders({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }) });
        }
        const hashedBundle = /^\/v2\/assets\/index-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(url.pathname);
        const headers = buildHeaders({ "Content-Type": asset.contentType, "Cache-Control": hashedBundle ? "public, max-age=31536000, immutable" : "no-cache" });
        if (request.method === "HEAD") return new Response(null, { status: 200, headers });
        const binary = atob(asset.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return new Response(bytes, { status: 200, headers });
      }
      if (url.pathname === "/api/admin/kv-directory") {
        const session = await readSession(request, env);
        if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
        if (request.method === "GET") {
          try { return json(await directoryStatus(env)); }
          catch { return json({ status: "read_failed", complete: null, last_success: null,
            last_error: null, retry_at: null, in_progress: null, data_as_of: null,
            unavailable_reason: "kv_directory_unavailable" }, 503); }
        }
        if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
        if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        requireSameOrigin(request, { requireOrigin: true });
        return json(await maintainDirectory(env));
      }
      if (url.pathname === "/login") return await startLogin(request, env);
      if (url.pathname === "/callback") return await finishLogin(request, env);
      if (url.pathname.startsWith("/api/performance/")) {
        return await performanceResponse(request, env, {
          json, readSession, accountOptions: loadAccountOptionsConfig, facts: accountFactsResponse,
          executions: readBoundAccountExecutions,
          history: (req, e) => accountFactsHistoryResponse(req, e, new URL(req.url)),
          binanceCurrent: binanceAccountFactsResponse,
          wallet: (req, e) => binanceWalletHistoryResponse(req, e, new URL(req.url)), benchmarks: marketBenchmarkResponse,
        });
      }
      if (["/api/decisions-inbox", "/api/owner-decisions/history", "/api/accounts", "/api/account-settings/diff", "/api/account-settings/history", "/api/account-settings/draft", "/api/runtime/today", "/api/strategies/summary", "/api/notifications/send-log", "/api/desk/alerts/delivery", "/api/accounts/run-controls"].includes(url.pathname)) {
        // The today projection invokes the same daily reader once per account.
        // Share only this request's authenticated session and binding inputs.
        let todaySession, todayOptions, todayRegistered;
        const today = url.pathname === "/api/runtime/today";
        const readTodaySession = () => todaySession ??= readSession(request, env);
        const readTodayOptions = () => todayOptions ??= loadAccountOptionsConfig(env);
        const readTodayRegistered = () => todayRegistered ??= readTodayOptions().then(config => runtimeDailyRegisteredBindings(env, config.options));
        return await consoleApiResponse(request, env, {
          json, readSession: today ? readTodaySession : readSession, command: runtimeInstanceCommand,
          accountOptions: today ? readTodayOptions : loadAccountOptionsConfig,
          settings: accountSettingsResponse, saveDraft: saveCombinedAccountDraft,
          owner: ownerDecisionQueueResponse, promotion: researchPromotionTicketsResponse,
          recovery: reconciliationRecoveryResponse, credential: (req, e) => credentialMaintenanceResponse(req, e, new URL("/api/credential-maintenance", req.url)),
          audit: loadAuditLog,
          profiles: loadStrategyProfilesConfig, health: strategyHealthResponse,
          currentStrategies: (options, e) => readCurrentStrategies(options, e, ctx),
          dailyBindings: async e => runtimeDailyReadModelEnabled(e) ? runtimeDailyPublicBindings(e, (await (today ? readTodayOptions() : loadAccountOptionsConfig(e))).options, today ? readTodayRegistered : undefined) : [],
          daily: (req, e) => runtimeDailyResponse(req, e, new URL(req.url), today ? { readSession: readTodaySession, readOptions: readTodayOptions, readRegistered: readTodayRegistered } : undefined),
          notificationReceipts: e => readNotificationLog({ repository: e.RUNTIME_SETTINGS_REPO || DEFAULT_REPOSITORY, token: e.RUNTIME_SETTINGS_DISPATCH_TOKEN }),
          runControls: consoleRunControls,
        });
      }
      if (url.pathname === "/api/desk/credentials") {
        return await deskCredentialsResponse(request, env, { auth: deskAuth, command: runtimeInstanceCommand });
      }
      if (url.pathname === "/api/desk/switch/targets") {
        return await deskSwitchTargetsResponse(request, env, { auth: deskAuth, options: loadAccountOptionsConfig });
      }
      // N1 read projections: five exact GET paths over already-stored sources only.
      if (url.pathname === "/api/desk/ribbon") return await deskRibbonResponse(request, env, deskN1Deps());
      if (url.pathname === "/api/desk/overview") return await deskOverviewResponse(request, env, deskN1Deps());
      if (url.pathname === "/api/desk/accounts") return await deskAccountsResponse(request, env, deskN1Deps());
      if (url.pathname === "/api/desk/performance") return await deskPerformanceResponse(request, env, deskN1Deps());
      if (/^\/api\/desk\/switch\/targets\/[^/]+\/strategies$/.test(url.pathname)) {
        return await deskSwitchStrategiesResponse(request, env, deskN1Deps());
      }
      if (url.pathname.startsWith("/api/desk/targets/") || url.pathname === "/api/desk/readbacks" || url.pathname.startsWith("/api/desk/readbacks/")) {
        return await deskReadbackResponse(request, env, {
          auth: deskAuth, command: runtimeInstanceCommand, options: loadAccountOptionsConfig,
        });
      }
      if (url.pathname === "/api/session") return json(await sessionPayload(request, env));
      if (url.pathname === OVERVIEW_FX_PROXY_PATH) return await overviewFxResponse(request);
      if (url.pathname === "/api/market-benchmark/performance") {
        return await performanceBenchmarkResponse(request, env, { command: runtimeInstanceCommand });
      }
      if (url.pathname === MARKET_BENCHMARK_API_PATH && (request.method === "GET" || request.method === "HEAD")) {
        return await marketBenchmarkResponse(request, env);
      }
      if (url.pathname === MARKET_BENCHMARK_SYNC_PATH && request.method === "POST") {
        return await syncMarketBenchmarkResponse(request, env);
      }
      if (url.pathname === MARKET_BENCHMARK_REVISION_PATH && request.method === "POST") {
        return await reviseMarketBenchmarkResponse(request, env);
      }
      if (url.pathname === "/api/strategy-profiles") return json(await strategyProfilesPayload(env));
      if (url.pathname === "/api/runtime-catalog") return await runtimeCatalogResponse(request, env);
      if (url.pathname.startsWith("/api/credential-rotation/")) return await credentialRotationResponse(request, env, {
        session: readSession, command: runtimeInstanceCommand,
      });
      if (url.pathname === "/api/credential-maintenance" || url.pathname === "/api/internal/credential-maintenance" || url.pathname === "/api/internal/credential-maintenance/claim" || url.pathname === "/api/internal/credential-maintenance/ack") return await credentialMaintenanceResponse(request, env, url);
      if (url.pathname === "/api/config") return json(await configPayload(request, env, ctx));
      if (url.pathname === "/api/admin/runtime-instances") return await runtimeInstancesResponse(request, env);
      if (url.pathname === "/api/admin/config" && request.method === "GET") {
        return await adminConfigResponse(request, env);
      }
      if (url.pathname === "/api/admin/config" && request.method === "POST") {
        return await saveAdminConfig(request, env);
      }
      if (url.pathname === "/api/risk-profiles" && request.method === "GET") {
        return await riskProfileBindingsResponse(request, env);
      }
      if (url.pathname === "/api/risk-profiles" && request.method === "POST") {
        return await saveRiskProfileBindings(request, env);
      }
      if (url.pathname === "/api/account-settings" && request.method === "GET") {
        return await accountSettingsResponse(request, env);
      }
      if (url.pathname === "/api/account-settings" && request.method === "POST") {
        return await saveAccountSettings(request, env);
      }
      if (url.pathname === "/api/account-settings/profile-application/approve" && request.method === "POST") {
        return await approveAccountSettingsProfileApplication(request, env);
      }
      if (url.pathname === ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_PATH) {
        if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        return await claimAccountSettingsProfileApplicationFromGitHub(request, env);
      }
      if (url.pathname === "/api/internal/sync-account-default" && request.method === "POST") {
        return await syncAccountDefaultResponse(request, env);
      }
      if (url.pathname === "/api/internal/sync-strategy-profiles" && request.method === "POST") {
        return await syncStrategyProfilesResponse(request, env);
      }
      if (url.pathname === "/api/internal/sync-strategy-health" && request.method === "POST") {
        return await syncStrategyHealthResponse(request, env);
      }
      if (url.pathname === "/api/strategy-health" && request.method === "GET") {
        return await strategyHealthResponse(request, env);
      }
      if (url.pathname === "/api/internal/sync-control-plane" && request.method === "POST") {
        return await syncControlPlaneResponse(request, env);
      }
      if (url.pathname === "/api/internal/sync-control-plane-source" && request.method === "POST") {
        return await syncControlPlaneSourceResponse(request, env);
      }
      if (url.pathname === "/api/control-plane" && request.method === "GET") {
        return await controlPlaneResponse(request, env);
      }
      if (url.pathname === "/api/internal/sync-adaptive-selection-source" && request.method === "POST") {
        return await syncAdaptiveSelectionSourceResponse(request, env);
      }
      if (url.pathname === "/api/adaptive-selection" && request.method === "GET") {
        return await adaptiveSelectionResponse(request, env);
      }
      if (url.pathname === "/api/internal/sync-m0-research-ledger" && request.method === "POST") {
        return await syncM0ResearchLedgerResponse(request, env);
      }
      if (url.pathname === "/api/m0-research" && request.method === "GET") {
        return await m0ResearchLedgerResponse(request, env);
      }
      if (url.pathname === "/api/owner-decisions" && request.method === "GET") {
        return await ownerDecisionQueueResponse(request, env);
      }
      if (url.pathname === "/api/owner-decisions" && request.method === "POST") {
        return await recordOwnerDecisionResponse(request, env);
      }
      if (url.pathname.startsWith("/api/decisions/")) {
        const rest = url.pathname.slice("/api/decisions/".length);
        if (rest.endsWith("/actions")) {
          if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
          return await decisionActionResponse(request, env, rest.slice(0, -"/actions".length));
        }
        return await decisionReviewResponse(request, env, rest);
      }
      if (url.pathname.startsWith("/api/operations/")) {
        if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
        return await operationResponse(request, env, url.pathname.slice("/api/operations/".length));
      }
      if (url.pathname === "/api/runtime/readback") {
        if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
        return await runtimeReadbackResponse(request, env, url);
      }
      if (url.pathname === "/api/audit-events") {
        if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
        return await auditEventsResponse(request, env, url);
      }
      if (url.pathname === "/api/internal/sync-reconciliation-recovery-source" && request.method === "POST") {
        return await syncReconciliationRecoverySourceResponse(request, env);
      }
      if (url.pathname === "/api/internal/reconciliation-recovery-confirmation" && request.method === "GET") {
        return await reconciliationRecoveryControllerReadResponse(request, env, url);
      }
      if (url.pathname === "/api/reconciliation-recovery" && request.method === "GET") {
        return await reconciliationRecoveryResponse(request, env);
      }
      if (url.pathname === "/api/reconciliation-recovery-confirmations" && request.method === "POST") {
        return await recordReconciliationRecoveryConfirmationResponse(request, env);
      }
      if (url.pathname === "/api/internal/binance-private-scope" && request.method === "POST") {
        return await syncBinancePrivateScopeResponse(request, env);
      }
      if (url.pathname === "/api/binance-private-scope" && request.method === "GET") {
        return await binancePrivateScopeResponse(request, env);
      }
      if (url.pathname === "/api/internal/binance-account-facts/archive" && request.method === "GET") {
        return await binanceDetailArchiveResponse(request, env, url);
      }
      if (url.pathname === "/api/internal/binance-account-facts/digest" && request.method === "GET") {
        return await binanceDigestSnapshotResponse(request, env, url);
      }
      if (url.pathname === "/api/internal/binance-account-facts" && request.method === "GET") {
        return await binanceAccountFactsReadinessResponse(request, env);
      }
      if (url.pathname === "/api/internal/binance-account-facts" && request.method === "POST") {
        return await syncBinanceAccountFactsResponse(request, env);
      }
      if (url.pathname === "/api/binance-account-facts" && request.method === "GET") {
        return await binanceAccountFactsResponse(request, env);
      }
      if (url.pathname === "/api/binance-account-facts/history" && request.method === "GET") {
        return await binanceWalletHistoryResponse(request, env, url);
      }
      if (url.pathname === "/api/internal/runtime-stop-result" && request.method === "POST") {
        return await acceptHkStopResult(request, env);
      }
      if (url.pathname === "/api/internal/sync-execution-evidence-source" && request.method === "POST") {
        return await syncExecutionEvidenceSourceResponse(request, env);
      }
      if (url.pathname === "/api/execution-evidence" && request.method === "GET") {
        return await executionEvidenceResponse(request, env);
      }
      if (url.pathname === "/api/runtime-daily/sync" && request.method === "POST") {
        return await syncRuntimeDailyResponse(request, env);
      }
      if (url.pathname === "/api/runtime-daily" && request.method === "GET") {
        return await runtimeDailyResponse(request, env, url);
      }
      if (url.pathname === "/api/account-facts/period-return/sync" && request.method === "POST") {
        return syncAccountPeriodReturnResponse(request, env);
      }
      if (url.pathname === "/api/account-facts/external-flow/sync" && request.method === "POST") {
        return syncAccountExternalFlowResponse(request, env);
      }
      if (url.pathname === "/api/account-facts/executions/sync" && request.method === "POST") {
        return syncAccountExecutionsResponse(request, env);
      }
      if (url.pathname === "/api/account-facts/sync" && request.method === "POST") {
        return await syncAccountFactsResponse(request, env);
      }
      if (url.pathname === "/api/account-facts/history/sync" && request.method === "POST") {
        return await syncAccountFactsResponse(request, env, { historical: true });
      }
      if (url.pathname === "/api/account-facts/history" && request.method === "GET") {
        return await accountFactsHistoryResponse(request, env, url);
      }
      if (url.pathname === "/api/account-facts" && request.method === "GET") {
        return await accountFactsResponse(request, env);
      }
      if (url.pathname === "/api/internal/runtime-cycle-health-admission" && request.method === "POST") {
        return runtimeCycleHealthAdmissionResponse(request, env);
      }
      if (url.pathname === "/api/internal/runtime-cycle-health-source" && ["POST", "GET"].includes(request.method)) {
        return runtimeCycleHealthSourceResponse(request, env);
      }
      if (url.pathname === "/api/internal/sync-runtime-target-lifecycle-source" && request.method === "POST") {
        return await syncRuntimeTargetLifecycleSourceResponse(request, env);
      }
      if (url.pathname === "/api/runtime-target-lifecycle" && request.method === "GET") {
        return await runtimeTargetLifecycleResponse(request, env);
      }
      if (url.pathname === ACCOUNT_DIAGNOSIS_REQUEST_PATH) {
        return await accountDiagnosisResponse(request, env, url);
      }
      if (url.pathname.startsWith(ACCOUNT_DIAGNOSIS_INTERNAL_PREFIX)) {
        return await accountDiagnosisInternalResponse(request, env, url);
      }
      if (url.pathname === "/api/internal/sync-research-task-source" && request.method === "POST") {
        return await syncResearchTaskSourceResponse(request, env);
      }
      if (url.pathname === "/api/research-tasks" && request.method === "GET") {
        return await researchTaskResponse(request, env);
      }

      if (url.pathname === "/api/internal/sync-research-promotion-ticket" && request.method === "POST") {
        return await syncResearchPromotionTicketResponse(request, env);
      }
      if (url.pathname === "/api/internal/research-promotion-ticket" && request.method === "GET") {
        return await fetchResearchPromotionTicketResponse(request, env);
      }
      if (url.pathname === "/api/research-promotion-tickets" && request.method === "GET") {
        return await researchPromotionTicketsResponse(request, env);
      }
      if (url.pathname === "/api/research-promotion-decisions" && request.method === "POST") {
        return await recordResearchPromotionDecisionResponse(request, env);
      }
      if (url.pathname === "/api/research-promotion-applications") {
        return await researchPromotionApplicationResponse(request, env, url);
      }
      if (url.pathname.startsWith("/api/internal/research-promotion-application/")) {
        return await researchPromotionApplicationInternalResponse(request, env, url);
      }
      if (url.pathname === "/api/ux1/draft" && request.method === "GET") return await ux1DraftGet(request, env);
      if (url.pathname === "/api/ux1/draft" && request.method === "POST") return await ux1DraftPost(request, env);
      if (url.pathname === "/api/ux1/preview" && request.method === "POST") return await ux1PreviewPost(request, env);
      if (url.pathname === "/api/ux1/intent" && request.method === "POST") return await ux1IntentPost(request, env);
      if (url.pathname === "/api/ux1/jobs/claim" && request.method === "POST") return await ux1JobClaimPost(request, env);
      if (url.pathname === "/api/ux1/jobs/result" && request.method === "POST") return await ux1JobResultPost(request, env);
      if (url.pathname === "/api/ux1/draft" || url.pathname === "/api/ux1/preview" || url.pathname === "/api/ux1/intent" || url.pathname === "/api/ux1/jobs/claim" || url.pathname === "/api/ux1/jobs/result") {
        return json({ ok: false, error: "method_not_allowed" }, 405);
      }
      if (url.pathname === "/api/logout" && request.method === "POST") return logout(request);
      if (url.pathname === "/api/switch" && request.method === "POST") return await dispatchSwitch(request, env);
      if (url.pathname === "/api/runtime-stop" && request.method === "GET") return await readRuntimeStop(request, env, url);
      if (url.pathname === "/api/runtime-stop" && request.method === "POST") return await dispatchRuntimeStop(request, env);
      if (url.pathname === "/api/runtime-resume" && request.method === "POST") return await dispatchBinanceResume(request, env);
      if (url.pathname === "/bootstrap-config.js") {
        return new Response(BOOTSTRAP_CONFIG_JS, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (url.pathname === "/boot-recovery.js") {
        return new Response(BOOT_RECOVERY_JS, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (url.pathname === "/app.css" || url.pathname === "/app.js") return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
      return json({ ok: false, error: "not_found" }, 404);
    } catch (error) {
      const directoryError = /^(kv_directory_|kv_list_daily_limit_exceeded)/.test(error.message || "");
      return json({ ok: false, error: error.message || "unexpected error" }, error.status || (directoryError ? 503 : 500),
        directoryError ? { "Retry-After": String(error.retry_after || 300) } : {});
    }
  },

  // Cron trigger: keep the current-strategies KV cache warm so
  // users never wait for GitHub API on the /api/config endpoint.
  async scheduled(event, env, ctx) {
    if (!hasConfigStore(env)) return;
    // Maintenance is bounded and persisted globally; normal reads never scan KV.
    try { await directoryCommand(env, { action: "maintain" }); } catch { /* Keep the actual directory error visible to readers. */ }
    const token = env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
    if (!token) return;

    try {
      const accountConfig = await loadAccountOptionsConfig(env);
      const strategies = await loadCurrentStrategiesSafely(accountConfig.options, env);
      await writeCurrentStrategiesCache(env, strategies, Date.now());
    } catch {
      // Silently skip — next user request will populate cache via SWR
    }
  },
};

// N1 desk reads may call only these existing read-only RuntimeInstances commands
// (they use the DO's POST transport). Writes, dispatch, scheduler, readback
// creation and provider collection are not reachable through this wrapper.
const DESK_N1_READ_COMMANDS = Object.freeze(["account_facts_list", "account_facts_history_read", "credential_maintenance_read"]);

async function deskN1ReadCommand(env, command) {
  if (!DESK_N1_READ_COMMANDS.includes(command?.action)) throw new HttpError("desk_read_command_not_allowed", 500);
  return runtimeInstanceCommand(env, command);
}

// N1 section 4.A eligibility: only what the saved configuration and the catalog
// prove. Configuration compatibility is not runtime switchability; anything the
// existing checks cannot classify stays unknown (null).
function deskStrategyEligibility(platform, option, profile, profiles, domains) {
  void option; void profiles;
  if (typeof profile?.domain !== "string" || !domains.includes(profile.domain)) return { value: "blocked", reason: "domain_not_supported" };
  if (isFrozenStrategyProfile(profile)) return { value: "blocked", reason: "strategy_frozen" };
  if (isDcaProfile(profile.profile) && !DCA_SUPPORTED_PLATFORMS.has(platform)) return null;
  if (!supportedExecutionModesForPlatform(platform).includes("live")) return { value: "no_live", reason: "platform_live_not_supported" };
  const stage = cleanLifecycleStage(profile.lifecycle_stage || "research_active");
  const liveModes = Array.isArray(profile.allowed_execution_modes) && profile.allowed_execution_modes.includes("live");
  if (isLiveSwitchAllowed(profile) && ["live_enabled", "runtime_enabled"].includes(stage) && liveModes && !profile.blocked_live_reason) {
    return { value: "eligible", reason: null };
  }
  return { value: "no_live", reason: "catalog_not_live_enabled" };
}

function deskN1Deps() {
  const dailyDeps = {
    dailyBindings: async e => runtimeDailyReadModelEnabled(e) ? runtimeDailyPublicBindings(e, (await loadAccountOptionsConfig(e)).options) : [],
    daily: (req, e) => runtimeDailyResponse(req, e, new URL(req.url)),
  };
  return {
    auth: deskAuth,
    now: () => Date.now(),
    options: loadAccountOptionsConfig,
    profiles: loadStrategyProfilesConfig,
    domains: supportedDomainsForAccount,
    eligibility: deskStrategyEligibility,
    command: deskN1ReadCommand,
    factsBindings: e => loadAccountFactsBindings(e, { propagateReadErrors: true }),
    // The stored-facts loader issues only the allowlisted account_facts_list read.
    factsStored: (e, options, bindings) => loadStoredAccountFactsMap(e, options, bindings),
    // One stored runtime-daily summary for a New York business date (16:00Z is inside it).
    // `options.schedule` is the ribbon's explicit opt-in; the same single read is made.
    runtimeDay: (req, e, accounts, date, options) => todaySummary(req, e, dailyDeps, accounts, Date.parse(`${date}T16:00:00Z`), options),
  };
}

export const __test = {
  deskN1Deps, deskN1ReadCommand, deskStrategyEligibility, DESK_N1_READ_COMMANDS,
  splitSelectorValues,
  deskAuth,
  credentialRotationResponse, runtimeInstanceCommand,
  auditEventAction,
  effectiveAccountSettings,
  deskTargetReadback,
  writeCurrentStrategiesCache,
  readCurrentStrategiesCacheEntry,
  isConfigJsonParseError,
  currentStrategiesSignature,
  isDegradedCurrentStrategies,
  currentStrategiesKvBumpMs: CURRENT_STRATEGIES_KV_BUMP_MS,
  currentStrategiesKvFreshMs: CURRENT_STRATEGIES_KV_FRESH_MS,
  dispatchAccountDiagnosis,
  humanDecisionReceipt,
  researchPromotionMaterialKey,
  researchPromotionReviewMaterial,
  researchPromotionReviewBinding,
  accountSettingsAuditChanges,
  accountDraftStrategyChoices,
  assertAccountDraftPatch,
  dcaDraftSupported,
  buildRiskEnvelopeView,
  attachRiskEnvelopeView,
  attachPromotionQueueReadMetadata,
  normalizeResearchPromotionTicket,
  normalizeRuntimeTargetLifecycleTarget,
  projectRuntimeAccountState,
  aggregateRuntimeTargetLifecycleSources,
  loadPlatformMeta,
  assertConfiguredAccount,
  validateResearchPromotionSelectedAccount,
  attachResearchPromotionApplicationPreparation,
  accountOptionMatchesInputs,
  resolvedVariableScope,
  currentStrategiesTimeoutMs: CURRENT_STRATEGIES_TIMEOUT_MS,
  assertStrategyAllowedForAccount,
  inferAccountSupportedDomains,
  loadCurrentStrategies,
  normalizeSwitchInputs,
  normalizeAccountOptionsPayload,
  normalizeStrategyProfilesPayload,
  canonicalResearchTaskJson,
  sha256Hex,
  calculateRiskProfileSelectionSha256,
  calculateRiskProfileBindingSha256,
  normalizeRiskProfileBindingRegistry,
  buildRiskProfileBindings,
  riskProfileBindingTargets,
  platformRepositories,
  requireSameOrigin,
  responseHeaders,
  fetchWithTimeout,
  overviewFxResponse,
  OVERVIEW_FX_PROXY_PATH,
  OVERVIEW_FX_UPSTREAM_URL,
  resetOverviewFxCache,
  marketBenchmarkResponse,
  syncMarketBenchmarkResponse,
  MARKET_BENCHMARK_API_PATH,
  MARKET_BENCHMARK_REVISION_PATH,
  MARKET_BENCHMARK_SYNC_PATH,
  MARKET_BENCHMARK_SCHEMA,
  // Retain the published test-export shape; this legacy launch date is not a
  // read, write or upstream-fetch boundary.
  MARKET_BENCHMARK_INCEPTION_DATE_CONST: "2026-10-09",
  normalizeMarketBenchmarkSyncPayload,
  publicMarketBenchmarkReadModel,
  MarketBenchmarkError,
  syncDefaultStrategyProfiles: syncStrategyProfilesConfig,
  syncDefaultStrategyForAccount,
  normalizeStrategyHealthSnapshot,
  emptyStrategyHealthPayload,
  normalizeControlPlaneSnapshot,
  normalizeControlPlaneSourceSnapshot,
  controlPlaneResearchSnapshotFreshness,
  emptyControlPlanePayload,
  normalizeAdaptiveSelectionSourceSnapshot,
  calculateAdaptiveSelectionDecisionDigest,
  emptyAdaptiveSelectionPayload,
  normalizeM0ResearchLedgerTransport,
  calculateM0ResearchLedgerSha256,
  projectM0ResearchDashboardForRead,
  emptyM0ResearchDashboardPayload,
  normalizeReconciliationRecoverySourceSnapshot,
  emptyReconciliationRecoveryPayload,
  calculateReconciliationRecoveryConfirmationSha256,
  normalizeReconciliationRecoveryConfirmation,
  normalizeExecutionEvidenceSourceSnapshot,
  emptyExecutionEvidencePayload,
  calculateResearchTaskSha256,
  normalizeResearchTask,
  normalizeResearchTaskSourceSnapshot,
  emptyResearchTaskPayload,
  makeSession,
  presentUx1Preview,
  projectUx1Job,
  ux1RunMatches,
  ux1RuntimeEpoch,
  readUx1CalculatorExchange,
  normalizeAccountFactsBindings,
  normalizeAccountFactsHistoryPayload,
  buildAccountFactsReadModel,
  resolveTrustedAccountFactsBinding,
  decideAccountFactsPut,
  accountFactsOptionMatchesBinding,
  accountFactsErrorResponse,
  canonicalizeAccountFactsHistory,
  ux1JobUnknownAfterMs: UX1_JOB_UNKNOWN_AFTER_MS,
  ux1CalculatorDeadlineMs: UX1_CALCULATOR_DEADLINE_MS,
  ux1CalculatorMaxBytes: UX1_CALCULATOR_MAX_BYTES,
  supportedDomainsForAccount,
  updateAccountOptionsDefaultStrategy,
  withTimeout,
};
