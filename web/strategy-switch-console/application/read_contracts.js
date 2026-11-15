// Operation classification registry for the console Worker and the
// RuntimeInstances Durable Object (ADR 0002; `.github/engineering.md`,
// "Observation and identity boundaries"). It is review data: no production
// module imports it, and it changes no request behaviour.
//
// Every public route branch in `worker.js` `fetch` and every internal action the
// Durable Object dispatches has exactly one entry. Each method/action has an
// effect class:
//
// - "observation": invoking it causes no application-owned persistent effect.
// - "command": it may write. Includes jobs, alarms and authentication flows.
// - an exception id, or a list of ids, from
//   `tests/fixtures/read-contract-exceptions.json`: an observation whose
//   request lifecycle still reaches a registered, expiring write. The list is
//   the union over everything the handler reaches, including injected
//   dependencies and callbacks (e.g. the Console group's `settings` and
//   `runControls` dependencies, the Desk readback store's read callback).
//
// `scope` records what a result covers (R4): "static", "session", "command",
// "contract:<document>" for a declared scope/completeness contract, or
// "undeclared", which is allowed only for operations listed under P1 in the
// exception register.
//
// `tests/read_contract_boundaries_validation.mjs` extracts the route and action
// surface from the code and fails on an unclassified entry, a stale entry, or a
// register that disagrees with this file. Classify a new operation here in the
// same change that adds it.

export const ROUTE_METHODS = Object.freeze(["GET", "HEAD", "POST", "*"]);

const N1 = "contract:docs/desk-n1-read-projection-contract.md";

// `match` is the route condition exactly as written in `worker.js`, with
// whitespace collapsed. `handler` is the function or value the branch serves.
export const PUBLIC_ROUTES = Object.freeze([
  { id: "/", match: 'url.pathname === "/"', handler: "V2_PAGE_HTML", effects: { GET: "observation", HEAD: "observation" }, scope: "static" },
  { id: "/v2 redirect", match: '["/v2", "/v2/", "/v2/index.html"].includes(url.pathname)', handler: "Location", effects: { GET: "observation", HEAD: "observation" }, scope: "static" },
  { id: "/v2/", match: 'url.pathname === "/v2" || url.pathname.startsWith("/v2/")', handler: "V2_ASSETS", effects: { GET: "observation", HEAD: "observation" }, scope: "static" },
  { id: "/api/admin/kv-directory", match: 'url.pathname === "/api/admin/kv-directory"', handler: "directoryStatus", effects: { GET: "B0", POST: "command" }, scope: "undeclared" },
  { id: "/login", match: 'url.pathname === "/login"', handler: "startLogin", effects: { "*": "command" }, scope: "command" },
  { id: "/callback", match: 'url.pathname === "/callback"', handler: "finishLogin", effects: { "*": "command" }, scope: "command" },
  { id: "/api/performance/", match: 'url.pathname.startsWith("/api/performance/")', handler: "performanceResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "console api group", match: '["/api/decisions-inbox", "/api/owner-decisions/history", "/api/accounts", "/api/account-settings/diff", "/api/account-settings/history", "/api/account-settings/draft", "/api/runtime/today", "/api/strategies/summary", "/api/notifications/send-log", "/api/desk/alerts/delivery", "/api/accounts/run-controls"].includes(url.pathname)', handler: "consoleApiResponse", effects: { GET: ["B7", "B1", "B3", "B0"], POST: "command" }, scope: "undeclared" },
  { id: "/api/desk/credentials", match: 'url.pathname === "/api/desk/credentials"', handler: "deskCredentialsResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/desk/switch/targets", match: 'url.pathname === "/api/desk/switch/targets"', handler: "deskSwitchTargetsResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/desk/ribbon", match: 'url.pathname === "/api/desk/ribbon"', handler: "deskRibbonResponse", effects: { GET: "B0" }, scope: N1 },
  { id: "/api/desk/overview", match: 'url.pathname === "/api/desk/overview"', handler: "deskOverviewResponse", effects: { GET: "B0" }, scope: N1 },
  { id: "/api/desk/accounts", match: 'url.pathname === "/api/desk/accounts"', handler: "deskAccountsResponse", effects: { GET: "B0" }, scope: N1 },
  { id: "/api/desk/performance", match: 'url.pathname === "/api/desk/performance"', handler: "deskPerformanceResponse", effects: { GET: "B0" }, scope: N1 },
  { id: "/api/desk/switch/targets/:id/strategies", match: '/^\\/api\\/desk\\/switch\\/targets\\/[^/]+\\/strategies$/.test(url.pathname)', handler: "deskSwitchStrategiesResponse", effects: { GET: "B0" }, scope: N1 },
  { id: "/api/desk/readbacks", match: 'url.pathname.startsWith("/api/desk/targets/") || url.pathname === "/api/desk/readbacks" || url.pathname.startsWith("/api/desk/readbacks/")', handler: "deskReadbackResponse", effects: { GET: ["B6", "B1", "B0"], POST: "command" }, scope: "undeclared" },
  { id: "/api/session", match: 'url.pathname === "/api/session"', handler: "sessionPayload", effects: { "*": "observation" }, scope: "session" },
  { id: "OVERVIEW_FX_PROXY_PATH", match: "url.pathname === OVERVIEW_FX_PROXY_PATH", handler: "overviewFxResponse", effects: { GET: "observation" }, scope: "undeclared" },
  { id: "/api/market-benchmark/performance", match: 'url.pathname === "/api/market-benchmark/performance"', handler: "performanceBenchmarkResponse", effects: { GET: "B0", HEAD: "B0" }, scope: "undeclared" },
  { id: "MARKET_BENCHMARK_API_PATH", match: 'url.pathname === MARKET_BENCHMARK_API_PATH && (request.method === "GET" || request.method === "HEAD")', handler: "marketBenchmarkResponse", effects: { GET: "B0", HEAD: "B0" }, scope: "undeclared" },
  { id: "MARKET_BENCHMARK_SYNC_PATH", match: 'url.pathname === MARKET_BENCHMARK_SYNC_PATH && request.method === "POST"', handler: "syncMarketBenchmarkResponse", effects: { POST: "command" }, scope: "command" },
  { id: "MARKET_BENCHMARK_REVISION_PATH", match: 'url.pathname === MARKET_BENCHMARK_REVISION_PATH && request.method === "POST"', handler: "reviseMarketBenchmarkResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/strategy-profiles", match: 'url.pathname === "/api/strategy-profiles"', handler: "strategyProfilesPayload", effects: { "*": "observation" }, scope: "undeclared" },
  { id: "/api/runtime-catalog", match: 'url.pathname === "/api/runtime-catalog"', handler: "runtimeCatalogResponse", effects: { "*": "observation" }, scope: "static" },
  { id: "/api/credential-rotation/", match: 'url.pathname.startsWith("/api/credential-rotation/")', handler: "credentialRotationResponse", effects: { GET: ["B4", "B0"], POST: "command" }, scope: "undeclared" },
  { id: "credential maintenance group", match: 'url.pathname === "/api/credential-maintenance" || url.pathname === "/api/internal/credential-maintenance" || url.pathname === "/api/internal/credential-maintenance/claim" || url.pathname === "/api/internal/credential-maintenance/ack"', handler: "credentialMaintenanceResponse", effects: { GET: "B0", POST: "command" }, scope: "undeclared" },
  { id: "/api/config", match: 'url.pathname === "/api/config"', handler: "configPayload", effects: { "*": ["B7", "B0"] }, scope: "undeclared" },
  { id: "/api/admin/runtime-instances", match: 'url.pathname === "/api/admin/runtime-instances"', handler: "runtimeInstancesResponse", effects: { GET: "B0", POST: "command" }, scope: "undeclared" },
  { id: "/api/admin/config", match: 'url.pathname === "/api/admin/config" && request.method === "GET"', handler: "adminConfigResponse", effects: { GET: ["B1", "B0"] }, scope: "undeclared" },
  { id: "/api/admin/config", match: 'url.pathname === "/api/admin/config" && request.method === "POST"', handler: "saveAdminConfig", effects: { POST: "command" }, scope: "command" },
  { id: "/api/risk-profiles", match: 'url.pathname === "/api/risk-profiles" && request.method === "GET"', handler: "riskProfileBindingsResponse", effects: { GET: ["B1", "B0"] }, scope: "undeclared" },
  { id: "/api/risk-profiles", match: 'url.pathname === "/api/risk-profiles" && request.method === "POST"', handler: "saveRiskProfileBindings", effects: { POST: "command" }, scope: "command" },
  { id: "/api/account-settings", match: 'url.pathname === "/api/account-settings" && request.method === "GET"', handler: "accountSettingsResponse", effects: { GET: ["B1", "B0"] }, scope: "undeclared" },
  { id: "/api/account-settings", match: 'url.pathname === "/api/account-settings" && request.method === "POST"', handler: "saveAccountSettings", effects: { POST: "command" }, scope: "command" },
  { id: "/api/account-settings/profile-application/approve", match: 'url.pathname === "/api/account-settings/profile-application/approve" && request.method === "POST"', handler: "approveAccountSettingsProfileApplication", effects: { POST: "command" }, scope: "command" },
  { id: "ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_PATH", match: "url.pathname === ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_PATH", handler: "claimAccountSettingsProfileApplicationFromGitHub", effects: { POST: "command" }, scope: "command" },
  { id: "/api/internal/sync-account-default", match: 'url.pathname === "/api/internal/sync-account-default" && request.method === "POST"', handler: "syncAccountDefaultResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/internal/sync-strategy-profiles", match: 'url.pathname === "/api/internal/sync-strategy-profiles" && request.method === "POST"', handler: "syncStrategyProfilesResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/internal/sync-strategy-health", match: 'url.pathname === "/api/internal/sync-strategy-health" && request.method === "POST"', handler: "syncStrategyHealthResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/strategy-health", match: 'url.pathname === "/api/strategy-health" && request.method === "GET"', handler: "strategyHealthResponse", effects: { GET: "observation" }, scope: "undeclared" },
  { id: "/api/internal/sync-control-plane", match: 'url.pathname === "/api/internal/sync-control-plane" && request.method === "POST"', handler: "syncControlPlaneResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/internal/sync-control-plane-source", match: 'url.pathname === "/api/internal/sync-control-plane-source" && request.method === "POST"', handler: "syncControlPlaneSourceResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/control-plane", match: 'url.pathname === "/api/control-plane" && request.method === "GET"', handler: "controlPlaneResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/internal/sync-adaptive-selection-source", match: 'url.pathname === "/api/internal/sync-adaptive-selection-source" && request.method === "POST"', handler: "syncAdaptiveSelectionSourceResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/adaptive-selection", match: 'url.pathname === "/api/adaptive-selection" && request.method === "GET"', handler: "adaptiveSelectionResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/internal/sync-m0-research-ledger", match: 'url.pathname === "/api/internal/sync-m0-research-ledger" && request.method === "POST"', handler: "syncM0ResearchLedgerResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/m0-research", match: 'url.pathname === "/api/m0-research" && request.method === "GET"', handler: "m0ResearchLedgerResponse", effects: { GET: "observation" }, scope: "undeclared" },
  { id: "/api/owner-decisions", match: 'url.pathname === "/api/owner-decisions" && request.method === "GET"', handler: "ownerDecisionQueueResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/owner-decisions", match: 'url.pathname === "/api/owner-decisions" && request.method === "POST"', handler: "recordOwnerDecisionResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/decisions/", match: 'url.pathname.startsWith("/api/decisions/")', handler: "decisionReviewResponse", effects: { GET: "B0", POST: "command" }, scope: "undeclared" },
  { id: "/api/operations/", match: 'url.pathname.startsWith("/api/operations/")', handler: "operationResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/runtime/readback", match: 'url.pathname === "/api/runtime/readback"', handler: "runtimeReadbackResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/audit-events", match: 'url.pathname === "/api/audit-events"', handler: "auditEventsResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/internal/sync-reconciliation-recovery-source", match: 'url.pathname === "/api/internal/sync-reconciliation-recovery-source" && request.method === "POST"', handler: "syncReconciliationRecoverySourceResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/internal/reconciliation-recovery-confirmation", match: 'url.pathname === "/api/internal/reconciliation-recovery-confirmation" && request.method === "GET"', handler: "reconciliationRecoveryControllerReadResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/reconciliation-recovery", match: 'url.pathname === "/api/reconciliation-recovery" && request.method === "GET"', handler: "reconciliationRecoveryResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/reconciliation-recovery-confirmations", match: 'url.pathname === "/api/reconciliation-recovery-confirmations" && request.method === "POST"', handler: "recordReconciliationRecoveryConfirmationResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/internal/binance-private-scope", match: 'url.pathname === "/api/internal/binance-private-scope" && request.method === "POST"', handler: "syncBinancePrivateScopeResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/binance-private-scope", match: 'url.pathname === "/api/binance-private-scope" && request.method === "GET"', handler: "binancePrivateScopeResponse", effects: { GET: "observation" }, scope: "undeclared" },
  { id: "/api/internal/binance-account-facts/archive", match: 'url.pathname === "/api/internal/binance-account-facts/archive" && request.method === "GET"', handler: "binanceDetailArchiveResponse", effects: { GET: ["B5", "B0"] }, scope: "undeclared" },
  { id: "/api/internal/binance-account-facts/digest", match: 'url.pathname === "/api/internal/binance-account-facts/digest" && request.method === "GET"', handler: "binanceDigestSnapshotResponse", effects: { GET: ["B5", "B0"] }, scope: "undeclared" },
  { id: "/api/internal/binance-account-facts", match: 'url.pathname === "/api/internal/binance-account-facts" && request.method === "GET"', handler: "binanceAccountFactsReadinessResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/internal/binance-account-facts", match: 'url.pathname === "/api/internal/binance-account-facts" && request.method === "POST"', handler: "syncBinanceAccountFactsResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/binance-account-facts", match: 'url.pathname === "/api/binance-account-facts" && request.method === "GET"', handler: "binanceAccountFactsResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/binance-account-facts/history", match: 'url.pathname === "/api/binance-account-facts/history" && request.method === "GET"', handler: "binanceWalletHistoryResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/internal/runtime-stop-result", match: 'url.pathname === "/api/internal/runtime-stop-result" && request.method === "POST"', handler: "acceptHkStopResult", effects: { POST: "command" }, scope: "command" },
  { id: "/api/internal/sync-execution-evidence-source", match: 'url.pathname === "/api/internal/sync-execution-evidence-source" && request.method === "POST"', handler: "syncExecutionEvidenceSourceResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/execution-evidence", match: 'url.pathname === "/api/execution-evidence" && request.method === "GET"', handler: "executionEvidenceResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/runtime-daily/sync", match: 'url.pathname === "/api/runtime-daily/sync" && request.method === "POST"', handler: "syncRuntimeDailyResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/runtime-daily", match: 'url.pathname === "/api/runtime-daily" && request.method === "GET"', handler: "runtimeDailyResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/account-facts/period-return/sync", match: 'url.pathname === "/api/account-facts/period-return/sync" && request.method === "POST"', handler: "syncAccountPeriodReturnResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/account-facts/external-flow/sync", match: 'url.pathname === "/api/account-facts/external-flow/sync" && request.method === "POST"', handler: "syncAccountExternalFlowResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/account-facts/executions/sync", match: 'url.pathname === "/api/account-facts/executions/sync" && request.method === "POST"', handler: "syncAccountExecutionsResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/account-facts/sync", match: 'url.pathname === "/api/account-facts/sync" && request.method === "POST"', handler: "syncAccountFactsResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/account-facts/history/sync", match: 'url.pathname === "/api/account-facts/history/sync" && request.method === "POST"', handler: "syncAccountFactsResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/account-facts/history", match: 'url.pathname === "/api/account-facts/history" && request.method === "GET"', handler: "accountFactsHistoryResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/account-facts", match: 'url.pathname === "/api/account-facts" && request.method === "GET"', handler: "accountFactsResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/internal/runtime-cycle-health-admission", match: 'url.pathname === "/api/internal/runtime-cycle-health-admission" && request.method === "POST"', handler: "runtimeCycleHealthAdmissionResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/internal/runtime-cycle-health-source", match: 'url.pathname === "/api/internal/runtime-cycle-health-source" && ["POST", "GET"].includes(request.method)', handler: "runtimeCycleHealthSourceResponse", effects: { GET: ["B2", "B0"], POST: "command" }, scope: "undeclared" },
  { id: "/api/internal/sync-runtime-target-lifecycle-source", match: 'url.pathname === "/api/internal/sync-runtime-target-lifecycle-source" && request.method === "POST"', handler: "syncRuntimeTargetLifecycleSourceResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/runtime-target-lifecycle", match: 'url.pathname === "/api/runtime-target-lifecycle" && request.method === "GET"', handler: "runtimeTargetLifecycleResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "ACCOUNT_DIAGNOSIS_REQUEST_PATH", match: "url.pathname === ACCOUNT_DIAGNOSIS_REQUEST_PATH", handler: "accountDiagnosisResponse", effects: { GET: "B0", POST: "command" }, scope: "undeclared" },
  { id: "ACCOUNT_DIAGNOSIS_INTERNAL_PREFIX", match: "url.pathname.startsWith(ACCOUNT_DIAGNOSIS_INTERNAL_PREFIX)", handler: "accountDiagnosisInternalResponse", effects: { GET: "B0", POST: "command" }, scope: "undeclared" },
  { id: "/api/internal/sync-research-task-source", match: 'url.pathname === "/api/internal/sync-research-task-source" && request.method === "POST"', handler: "syncResearchTaskSourceResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/research-tasks", match: 'url.pathname === "/api/research-tasks" && request.method === "GET"', handler: "researchTaskResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/internal/sync-research-promotion-ticket", match: 'url.pathname === "/api/internal/sync-research-promotion-ticket" && request.method === "POST"', handler: "syncResearchPromotionTicketResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/internal/research-promotion-ticket", match: 'url.pathname === "/api/internal/research-promotion-ticket" && request.method === "GET"', handler: "fetchResearchPromotionTicketResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/research-promotion-tickets", match: 'url.pathname === "/api/research-promotion-tickets" && request.method === "GET"', handler: "researchPromotionTicketsResponse", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/research-promotion-decisions", match: 'url.pathname === "/api/research-promotion-decisions" && request.method === "POST"', handler: "recordResearchPromotionDecisionResponse", effects: { POST: "command" }, scope: "command" },
  { id: "/api/research-promotion-applications", match: 'url.pathname === "/api/research-promotion-applications"', handler: "researchPromotionApplicationResponse", effects: { GET: "B0", POST: "command" }, scope: "undeclared" },
  { id: "/api/internal/research-promotion-application/", match: 'url.pathname.startsWith("/api/internal/research-promotion-application/")', handler: "researchPromotionApplicationInternalResponse", effects: { GET: "B0", POST: "command" }, scope: "undeclared" },
  { id: "/api/ux1/draft", match: 'url.pathname === "/api/ux1/draft" && request.method === "GET"', handler: "ux1DraftGet", effects: { GET: "B0" }, scope: "undeclared" },
  { id: "/api/ux1/draft", match: 'url.pathname === "/api/ux1/draft" && request.method === "POST"', handler: "ux1DraftPost", effects: { POST: "command" }, scope: "command" },
  { id: "/api/ux1/preview", match: 'url.pathname === "/api/ux1/preview" && request.method === "POST"', handler: "ux1PreviewPost", effects: { POST: "command" }, scope: "command" },
  { id: "/api/ux1/intent", match: 'url.pathname === "/api/ux1/intent" && request.method === "POST"', handler: "ux1IntentPost", effects: { POST: "command" }, scope: "command" },
  { id: "/api/ux1/jobs/claim", match: 'url.pathname === "/api/ux1/jobs/claim" && request.method === "POST"', handler: "ux1JobClaimPost", effects: { POST: "command" }, scope: "command" },
  { id: "/api/ux1/jobs/result", match: 'url.pathname === "/api/ux1/jobs/result" && request.method === "POST"', handler: "ux1JobResultPost", effects: { POST: "command" }, scope: "command" },
  { id: "ux1 method fallback", match: 'url.pathname === "/api/ux1/draft" || url.pathname === "/api/ux1/preview" || url.pathname === "/api/ux1/intent" || url.pathname === "/api/ux1/jobs/claim" || url.pathname === "/api/ux1/jobs/result"', handler: "method_not_allowed", effects: { "*": "observation" }, scope: "static" },
  { id: "/api/logout", match: 'url.pathname === "/api/logout" && request.method === "POST"', handler: "logout", effects: { POST: "command" }, scope: "command" },
  { id: "/api/switch", match: 'url.pathname === "/api/switch" && request.method === "POST"', handler: "dispatchSwitch", effects: { POST: "command" }, scope: "command" },
  { id: "/api/runtime-stop", match: 'url.pathname === "/api/runtime-stop" && request.method === "GET"', handler: "readRuntimeStop", effects: { GET: ["B3", "B0"] }, scope: "undeclared" },
  { id: "/api/runtime-stop", match: 'url.pathname === "/api/runtime-stop" && request.method === "POST"', handler: "dispatchRuntimeStop", effects: { POST: "command" }, scope: "command" },
  { id: "/api/runtime-resume", match: 'url.pathname === "/api/runtime-resume" && request.method === "POST"', handler: "dispatchBinanceResume", effects: { POST: "command" }, scope: "command" },
  { id: "/bootstrap-config.js", match: 'url.pathname === "/bootstrap-config.js"', handler: "BOOTSTRAP_CONFIG_JS", effects: { "*": "observation" }, scope: "static" },
  { id: "/boot-recovery.js", match: 'url.pathname === "/boot-recovery.js"', handler: "BOOT_RECOVERY_JS", effects: { "*": "observation" }, scope: "static" },
  { id: "/app.css,/app.js", match: 'url.pathname === "/app.css" || url.pathname === "/app.js"', handler: "Response", effects: { "*": "observation" }, scope: "static" },
]);

// Internal actions of the RuntimeInstances Durable Object and other entry
// points of the deployed Worker. Every observation on either named object
// ("runtime-instances", "console-kv-directory-v1") runs after the shared
// constructor, so it carries B0 until that constructor only wires dependencies.
const read = (effect = "B0") => ({ effect, scope: "undeclared" });
const write = () => ({ effect: "command", scope: "command" });

export const INTERNAL_OPERATIONS = Object.freeze({
  // RuntimeInstances.fetch: GET and the instance-state transaction.
  "action:instance_state:GET": read(),
  "action:instance_state:initialize": write(),
  "action:instance_state:create": write(),
  "action:instance_state:edit": write(),
  "action:instance_state:request_retirement": write(),
  "action:instance_state:set_broker_environment": write(),
  "action:instance_state:sync_defaults": write(),
  // KvDirectory.command on the "console-kv-directory-v1" object.
  "action:directory:status": read(),
  "action:directory:read": read(),
  "action:directory:cache": write(),
  "action:directory:put": write(),
  "action:directory:maintain": write(),
  // Lifecycle and scheduled entry points.
  "action:lifecycle:alarm": write(),
  "worker:scheduled": write(),
  // Literal action lists in RuntimeInstances.fetch.
  "action:desk_readback_start": write(),
  "action:desk_readback_get": read(),
  "action:desk_readback_fresh": read(["B6", "B1", "B0"]),
  "action:credential_maintenance_read": read(),
  "action:credential_maintenance_save": write(),
  "action:credential_maintenance_claim": write(),
  "action:credential_maintenance_ack": write(),
  "action:console_decision_history": read(),
  "action:console_settings_history": read(),
  "action:console_account_metadata": read(),
  "action:console_audit_events": read(),
  "action:cycle_health_admission": read(),
  "action:cycle_health_put": write(),
  "action:cycle_health_read": read(["B2", "B0"]),
  "action:cycle_health_provision": write(),
  // "rotation_" prefix, served by durableRotationCommand.
  "action:rotation_denied": write(),
  "action:rotation_read": read(),
  "action:rotation_begin": write(),
  "action:rotation_complete": write(),
  // "ux1_" prefix, served by ux1ResearchCommand.
  "action:ux1_begin_job": write(),
  "action:ux1_record_dispatch": write(),
  "action:ux1_lookup_job": read(),
  "action:ux1_claim_job": write(),
  "action:ux1_finish_job": write(),
  "action:ux1_read": read(),
  "action:ux1_save": write(),
  "action:ux1_store_preview": write(),
  "action:ux1_save_intent": write(),
  "action:ux1_clear_preview": write(),
  // ACCOUNT_DIAGNOSIS_DO_ACTIONS
  "action:diagnosis_create": write(),
  "action:diagnosis_latest": read(),
  "action:diagnosis_read": read(),
  "action:diagnosis_mark_dispatch": write(),
  "action:diagnosis_claim": write(),
  "action:diagnosis_result": write(),
  "action:diagnosis_mark_recheck": write(),
  "action:diagnosis_native_intent": write(),
  "action:diagnosis_native_save": write(),
  "action:diagnosis_native_cancel": write(),
  // HUMAN_DECISION_DO_ACTIONS
  "action:owner_sync_materials": write(),
  "action:recovery_sync_materials": write(),
  "action:promotion_sync_materials": write(),
  "action:owner_decide": write(),
  "action:recovery_decide": write(),
  "action:promotion_decide": write(),
  "action:owner_read": read(),
  "action:recovery_read": read(),
  "action:promotion_read": read(),
  // V7_PAPER_APPLICATION_DO_ACTIONS
  "action:application_create": write(),
  "action:application_latest": read(),
  "action:application_read": read(),
  "action:application_mark_dispatch": write(),
  "action:application_claim": write(),
  "action:application_result": write(),
  // ACCOUNT_SETTINGS_DO_ACTIONS
  "action:risk_profile_read": read(["B1", "B0"]),
  "action:risk_profile_replace": write(),
  "action:risk_profile_set": write(),
  "action:account_settings_read": read(["B1", "B0"]),
  "action:account_settings_save": write(),
  "action:account_declarations_read": read(),
  "action:account_settings_profile_application_lookup": read(),
  "action:account_settings_profile_application_approve": write(),
  "action:account_settings_profile_application_claim": write(),
  // ACCOUNT_FACTS_DO_ACTIONS
  "action:account_external_flow_put": write(),
  "action:account_executions_put": write(),
  "action:account_executions_read": read(),
  "action:account_period_return_put": write(),
  "action:account_period_return_read": read(),
  "action:account_daily_native_return_research_read": read(),
  "action:account_facts_put": write(),
  "action:account_facts_read": read(),
  "action:account_facts_list": read(),
  "action:account_facts_history_read": read(),
  "action:account_facts_history_put": write(),
  "action:binance_wallet_history_put": write(),
  "action:binance_wallet_history_read": read(),
  "action:binance_detail_put": write(),
  "action:binance_detail_read": read(["B5", "B0"]),
  // MARKET_BENCHMARK_DO_ACTIONS
  "action:market_benchmark_put": write(),
  "action:market_benchmark_read": read(),
  "action:market_benchmark_revise": write(),
  // RUNTIME_CONTROL_DO_ACTIONS
  "action:runtime_control_claim": write(),
  "action:runtime_control_record": write(),
  "action:runtime_control_read": read(),
  "action:runtime_control_resolve": write(),
  "action:runtime_control_capture": write(),
  "action:runtime_control_begin_check": write(),
  "action:runtime_control_record_check": write(),
  // HK_STOP_DO_ACTIONS
  "action:hk_stop_claim": write(),
  "action:hk_stop_record": write(),
  "action:hk_stop_read": read(),
  "action:hk_stop_accept_result": write(),
});

/** Operation id for one method of a public route entry. */
export function routeOperationId(route, method) {
  return `route:${route.id}#${method}`;
}

/** Every classified operation id with its effect list and scope. */
export function classifiedOperations() {
  const operations = new Map();
  for (const route of PUBLIC_ROUTES) {
    for (const [method, effect] of Object.entries(route.effects)) {
      // A command method of a mixed route is not a projection.
      operations.set(routeOperationId(route, method), { effects: [effect].flat(), scope: effect === "command" ? "command" : route.scope });
    }
  }
  for (const [id, entry] of Object.entries(INTERNAL_OPERATIONS)) {
    operations.set(id, { effects: [entry.effect].flat(), scope: entry.scope });
  }
  return operations;
}
