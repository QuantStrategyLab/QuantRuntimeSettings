// deploy: 2026-06-30 — config driven by platform-config.json
import { PAGE_HTML } from "./page_asset.js";
import { DEFAULT_STRATEGY_PROFILES } from "./strategy_profiles_asset.js";
import {
  DCA_SUPPORTED_PLATFORMS,
  DEFAULT_VARIABLE_SCOPES as DEFAULT_VARIABLE_SCOPE,
  PLATFORM_REPOSITORIES,
  DOMAIN_LABELS,
  PLATFORM_MIN_RESERVED_CASH_VARIABLES,
  PLATFORM_RESERVED_CASH_RATIO_VARIABLES,
  PLATFORM_CONFIG,
  DEFAULT_ACCOUNT_OPTIONS,
  FALLBACK_INCOME_LAYER_DEFAULTS,
  FALLBACK_OPTION_OVERLAY_DEFAULTS,
  DCA_PROFILE_DEFAULTS,
  RUNTIME_CATALOG_PROJECTION,
  STRATEGY_FEATURES,
} from "./config.js";
import { APP_CSS } from "./app_css.js";
import { APP_JS } from "./app_js.js";

const DEFAULT_REPOSITORY = "QuantStrategyLab/QuantRuntimeSettings";
const DEFAULT_WORKFLOW = "manual-strategy-switch.yml";
const SESSION_COOKIE = "qsl_switch_session";
const OAUTH_STATE_COOKIE = "qsl_switch_oauth_state";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const AUTH_CONFIG_KEY = "auth_config";
const ACCOUNT_OPTIONS_KEY = "account_options";
const STRATEGY_PROFILES_KEY = "strategy_profiles";
// Risk preferences are a separate, low-frequency owner-intent record.  They
// must never be merged into a strategy switch input, runtime target, or any
// execution credential/policy path.
const RISK_PROFILE_BINDINGS_KEY = "risk_profile_bindings";
const RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION = "qsl.risk_profile_binding_registry.v1";
const RISK_PROFILE_BINDING_SCHEMA_VERSION = "qsl.risk_profile_binding.v1";
const RISK_PROFILE_SELECTION_SCHEMA_VERSION = "qsl.risk_profile_selection.v1";
const RISK_PROFILE_IDS = {
  CAPITAL_PRESERVATION: "capital_preservation_v1",
  BALANCED_COMPOUNDING: "balanced_compounding_v1",
  GROWTH_COMPOUNDING: "growth_compounding_v1",
};
const RISK_PROFILE_PREFERENCES = Object.keys(RISK_PROFILE_IDS);
const AUDIT_LOG_KEY = "audit_log";
const AUDIT_LOG_LIMIT = 50;
const CURRENT_STRATEGIES_TIMEOUT_MS = 25000;
const CURRENT_STRATEGIES_CACHE_KEY = "current_strategies_cache";
const CURRENT_STRATEGIES_CACHE_TTL_MS = 5_000;       // 5 sec — rapid refresh during active development
const CURRENT_STRATEGIES_STALE_TTL_MS = 600_000;       // 10 min — return stale + background refresh
const GITHUB_API_TIMEOUT_MS = 8000;
const STRATEGY_HEALTH_SNAPSHOT_KEY = "strategy_health_snapshot";
const STRATEGY_HEALTH_MAX_BODY_BYTES = 256 * 1024;
const STRATEGY_HEALTH_DEFAULT_STALE_TTL_SECONDS = 2 * 60 * 60;
const STRATEGY_HEALTH_STATUSES = ["healthy", "watch", "review", "critical"];
const STRATEGY_HEALTH_DOMAINS = ["us_equity", "hk_equity", "cn_equity", "crypto"];
const STRATEGY_HEALTH_DATA_STATUSES = ["ready", "unavailable", "stale"];
const CONTROL_PLANE_SNAPSHOT_KEY = "control_plane_snapshot";
const CONTROL_PLANE_SOURCE_PREFIX = "control_plane_source:";
const CONTROL_PLANE_SOURCE_SCHEMA_VERSION = "qsl_control_plane_source_snapshot.v1";
const CONTROL_PLANE_ATTENTION_STATUSES = ["research_only", "attention_required", "unavailable"];
const CONTROL_PLANE_MAX_SOURCES = 100;
const CONTROL_PLANE_MAX_BODY_BYTES = 256 * 1024;
// The current source is a once-per-trading-day P1/P3 lane, rather than a live
// execution heartbeat. A 36-hour boundary tolerates weekends and a delayed
// scheduled run without presenting a daily snapshot as permanently stale.
const CONTROL_PLANE_DEFAULT_STALE_TTL_SECONDS = 36 * 60 * 60;
const CONTROL_PLANE_CANDIDATE_KINDS = ["individual", "portfolio", "plugin"];
const CONTROL_PLANE_STAGES = ["P1", "P2", "P3", "P4", "P5", "P6"];
const CONTROL_PLANE_LIFECYCLE_STATUSES = [
  "research", "evidence_pending", "verified", "deferred", "parked", "paper", "shadow", "owner_decision_required",
];
const CONTROL_PLANE_RECOMMENDATIONS = [
  "none", "keep_research", "defer", "park", "auto_paper_evaluation", "auto_shadow_evaluation", "owner_live_decision",
];
const CONTROL_PLANE_AUTOMATION_STATES = ["not_configured", "configured", "active"];
// M1 adaptive selections are a separate read-only projection. They are not
// lifecycle evidence, an account instruction, or an execution permission.
const ADAPTIVE_SELECTION_SOURCE_PREFIX = "adaptive_selection_source:";
const ADAPTIVE_SELECTION_SOURCE_SCHEMA_VERSION = "qsl.adaptive_selection_source_snapshot.v1";
const ADAPTIVE_SELECTION_DASHBOARD_SCHEMA_VERSION = "qsl.adaptive_selection_dashboard.v1";
const ADAPTIVE_SELECTION_DECISION_SCHEMA_VERSION = "qsl.selection_decision.v1";
const ADAPTIVE_SELECTION_MAX_SOURCES = 100;
const ADAPTIVE_SELECTION_MAX_BODY_BYTES = 256 * 1024;
const ADAPTIVE_SELECTION_DEFAULT_STALE_TTL_SECONDS = 36 * 60 * 60;
const ADAPTIVE_SELECTION_AUTHORITY = "shadow_only";
// M0 research arrives through a separate, signed-at-transport-boundary
// snapshot.  It is deliberately neither an M1 selection input nor a research
// task: this Worker only retains a closed, no-order ledger for authenticated
// readers.  No strategy/platform/runtime/broker helper may consume it here.
const M0_RESEARCH_TRANSPORT_SCHEMA_VERSION = "qsl_m0_research_publisher_envelope.v1";
const M0_RESEARCH_LEDGER_SCHEMA_VERSION = "qsl_m0_research_ledger.v1";
const M0_RESEARCH_DASHBOARD_SCHEMA_VERSION = "qsl_m0_research_dashboard.v1";
const M0_RESEARCH_STORAGE_SCHEMA_VERSION = "qsl_m0_research_ledger_storage.v1";
const M0_RESEARCH_CURRENT_KEY = "m0_research_ledger_current";
const M0_RESEARCH_ARCHIVE_PREFIX = "m0_research_ledger_archive:";
const M0_RESEARCH_MAX_BODY_BYTES = 256 * 1024;
const M0_RESEARCH_RETENTION_SECONDS = 14 * 24 * 60 * 60;
const M0_RESEARCH_ALLOWED_SOURCE_REPOSITORY = "QuantStrategyLab/QuantAdvisorResearch";
const M0_RESEARCH_ALLOWED_PRODUCER_REPOSITORY = "QuantStrategyLab/QuantRuntimeSettings";
const M0_RESEARCH_SUBJECT_KINDS = ["asset_idea", "theme_context", "strategy_hypothesis", "risk_context"];
const M0_RESEARCH_HORIZONS = ["short", "medium", "long", "not_applicable"];
const M0_RESEARCH_STATES = ["candidate", "source_verification_required", "deferred", "context_only"];
const M0_RESEARCH_CONFIDENCE = ["high", "medium", "low", "mixed", "no_event", "unknown"];
const M0_RESEARCH_STYLES = ["event_driven", "long_horizon_growth", "value_quality", "macro_context", "mixed_research"];
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
const OWNER_DECISION_INTENT_PREFIX = "owner_decision_intent:";
const OWNER_DECISION_CURRENT_PREFIX = "owner_decision_current:";
const OWNER_DECISION_INTENT_SCHEMA_VERSION = "qsl_owner_decision_intent.v1";
const OWNER_DECISION_QUEUE_SCHEMA_VERSION = "qsl_owner_decision_queue.v1";
const OWNER_DECISION_CHOICES = ["approve_limited_live_canary", "keep_parked", "retire_candidate"];
const OWNER_DECISION_MAX_CANDIDATES = 100;
// Execution evidence is deliberately a separate, read-only projection.  A
// candidate's research lifecycle is portable; a broker/data/execution result
// is only meaningful for the exact target platform and lane that produced it.
// Keeping this contract separate prevents a P1/P3 source from accidentally
// turning into an execution or P6 authority source.
const EXECUTION_EVIDENCE_SOURCE_PREFIX = "execution_evidence_source:";
const EXECUTION_EVIDENCE_SOURCE_SCHEMA_VERSION = "qsl_execution_evidence_source_snapshot.v1";
const EXECUTION_EVIDENCE_DASHBOARD_SCHEMA_VERSION = "qsl_execution_evidence_dashboard.v1";
const EXECUTION_EVIDENCE_MAX_SOURCES = 100;
const EXECUTION_EVIDENCE_MAX_BODY_BYTES = 256 * 1024;
const EXECUTION_EVIDENCE_DEFAULT_STALE_TTL_SECONDS = 36 * 60 * 60;
const EXECUTION_EVIDENCE_PLATFORMS = ["alpaca", "longbridge", "ibkr", "schwab", "firstrade", "qmt", "binance"];
const EXECUTION_EVIDENCE_ENVIRONMENTS = ["shadow", "paper", "live"];
const EXECUTION_EVIDENCE_CAPABILITIES = ["available", "unavailable", "unknown"];
const EXECUTION_EVIDENCE_STATUSES = ["verified", "pending", "unavailable", "not_applicable"];
const EXECUTION_EVIDENCE_RECOMMENDATIONS = [
  "continue_autonomous_shadow", "run_autonomous_paper", "owner_limited_live_canary_decision", "parked",
];
const EXECUTION_EVIDENCE_REASON_CODES = [
  "none", "target_execution_evidence_missing", "paper_not_supported", "paper_execution_evidence_needed",
  "policy_not_active", "source_stale", "manual_live_decision_required",
];
// Runtime target lifecycle is intentionally separate from execution evidence:
// it records whether a target is enabled and whether its no-order monitors are
// healthy. A disabled target is not a missing broker or a paper/live result.
const RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX = "runtime_target_lifecycle_source:";
const RUNTIME_TARGET_LIFECYCLE_SOURCE_SCHEMA_VERSION = "qsl_runtime_target_lifecycle_source_snapshot.v1";
const RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION = "qsl_runtime_target_lifecycle_dashboard.v1";
const RUNTIME_TARGET_LIFECYCLE_MAX_SOURCES = 100;
const RUNTIME_TARGET_LIFECYCLE_MAX_BODY_BYTES = 256 * 1024;
const RUNTIME_TARGET_LIFECYCLE_CONFIGURED_STATES = ["enabled", "disabled"];
const RUNTIME_TARGET_LIFECYCLE_EXECUTION_MODES = ["dry_run", "paper", "live"];
const RUNTIME_TARGET_LIFECYCLE_CHECK_STATUSES = ["pass", "attention", "not_due", "not_applicable", "unavailable"];
const RUNTIME_TARGET_LIFECYCLE_DISPOSITIONS = ["continue_enabled_monitoring", "continue_disabled_validation", "parked"];
const RUNTIME_TARGET_LIFECYCLE_REASON_CODES = [
  "none", "target_intentionally_disabled", "runtime_guard_attention", "execution_heartbeat_attention", "monitoring_unavailable",
];
// Research tasks are a separate, immutable and no-order index.  They do not
// share storage or a sync credential with candidate lifecycle snapshots.
const RESEARCH_TASK_SOURCE_PREFIX = "research_task_source:";
const RESEARCH_TASK_SOURCE_SCHEMA_VERSION = "qsl_research_task_source_snapshot.v1";
const RESEARCH_TASK_SCHEMA_VERSION = "qsl.research_task.v1";
const RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION = "qsl_research_task_dashboard.v1";
const RESEARCH_TASK_MAX_SOURCES = 100;
const RESEARCH_TASK_MAX_BODY_BYTES = 256 * 1024;
const RESEARCH_TASK_DEFAULT_STALE_TTL_SECONDS = 36 * 60 * 60;
const RESEARCH_TASK_TYPES = [
  "strategy_diagnosis", "hypothesis_evaluation", "parameter_challenge", "strategy_candidate", "portfolio_candidate", "plugin_candidate",
];
const RESEARCH_TASK_OBJECTIVES = ["diagnose_degradation", "test_hypothesis", "challenge_parameters", "evaluate_candidate"];

const SUPPORTED_PLATFORMS = ["longbridge", "ibkr", "schwab", "firstrade", "qmt", "binance"];
const SUPPORTED_STRATEGY_DOMAINS = ["us_equity", "hk_equity", "cn_equity", "crypto"];
const LIVE_CONTINUITY_STATES = [
  "NONE",
  "ACTIVE_LKG",
  "ACTIVE_REDUCED",
  "RECONCILE_ONLY",
  "RISK_REDUCTION_ONLY",
  "PAUSED",
  "ROLLBACK_LKG",
];
const DEFAULT_PLATFORM_REPOSITORIES = {
  longbridge: "QuantStrategyLab/LongBridgePlatform",
  ibkr: "QuantStrategyLab/InteractiveBrokersPlatform",
  schwab: "QuantStrategyLab/CharlesSchwabPlatform",
  firstrade: "QuantStrategyLab/FirstradePlatform",
  qmt: "QuantStrategyLab/QmtPlatform",
  binance: "QuantStrategyLab/BinancePlatform",
};
const PLATFORM_REPOSITORY_ENV = {
  longbridge: ["STRATEGY_SWITCH_LONGBRIDGE_REPO", "RUNTIME_SETTINGS_LONGBRIDGE_REPO"],
  ibkr: ["STRATEGY_SWITCH_IBKR_REPO", "RUNTIME_SETTINGS_IBKR_REPO"],
  schwab: ["STRATEGY_SWITCH_SCHWAB_REPO", "RUNTIME_SETTINGS_SCHWAB_REPO"],
  firstrade: ["STRATEGY_SWITCH_FIRSTRADE_REPO", "RUNTIME_SETTINGS_FIRSTRADE_REPO"],
  qmt: ["STRATEGY_SWITCH_QMT_REPO", "RUNTIME_SETTINGS_QMT_REPO"],
  binance: ["STRATEGY_SWITCH_BINANCE_REPO", "RUNTIME_SETTINGS_BINANCE_REPO"],
};
const PLATFORM_CASH_ONLY_EXECUTION_VARIABLES = {
  longbridge: "LONGBRIDGE_CASH_ONLY_EXECUTION",
  ibkr: "IBKR_CASH_ONLY_EXECUTION",
  schwab: "SCHWAB_CASH_ONLY_EXECUTION",
  firstrade: "FIRSTRADE_CASH_ONLY_EXECUTION",
};
const LEGACY_CASH_ONLY_EXECUTION_VARIABLE = "CASH_ONLY_EXECUTION";
const CASH_ONLY_EXECUTION_MODES = ["current", "enabled", "disabled"];
const INCOME_LAYER_ENABLED_VARIABLE = "INCOME_LAYER_ENABLED";
const INCOME_LAYER_START_USD_VARIABLE = "INCOME_LAYER_START_USD";
const INCOME_LAYER_MAX_RATIO_VARIABLE = "INCOME_LAYER_MAX_RATIO";
const OPTION_OVERLAY_ENABLED_VARIABLE = "OPTION_OVERLAY_ENABLED";
const RUNTIME_TARGET_ENABLED_VARIABLE = "RUNTIME_TARGET_ENABLED";
const DCA_MODE_VARIABLE = "DCA_MODE";
const DCA_BASE_INVESTMENT_VARIABLE = "DCA_BASE_INVESTMENT_USD";
const IBIT_ZSCORE_EXIT_MODE_VARIABLE = "IBIT_ZSCORE_EXIT_MODE";
const IBIT_ZSCORE_EXIT_ENABLED_VARIABLE = "IBIT_ZSCORE_EXIT_ENABLED";
const IBIT_ZSCORE_EXIT_PARKING_SYMBOL_VARIABLE = "IBIT_ZSCORE_EXIT_PARKING_SYMBOL";
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
const OPTION_OVERLAY_VARIABLES = OPTION_OVERLAY_CONTROL_FIELDS.map((field) => field.toUpperCase());
const OPTION_OVERLAY_PROFILE_FIELDS = [
  ...OPTION_OVERLAY_CONTROL_FIELDS,
  "option_overlay_live_gate",
  "option_overlay_live_status",
];
const OPTION_OVERLAY_MODES = ["current", "enabled", "disabled"];
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/login") return await startLogin(request, env);
      if (url.pathname === "/callback") return await finishLogin(request, env);
      if (url.pathname === "/admin") return await adminPage(request, env);
      if (url.pathname === "/api/session") return json(await sessionPayload(request, env));
      if (url.pathname === "/api/strategy-profiles") return json(await strategyProfilesPayload(env));
      if (url.pathname === "/api/runtime-catalog") return await runtimeCatalogResponse(request, env);
      if (url.pathname === "/api/config") return json(await configPayload(request, env, ctx));
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
      if (url.pathname === "/api/internal/sync-execution-evidence-source" && request.method === "POST") {
        return await syncExecutionEvidenceSourceResponse(request, env);
      }
      if (url.pathname === "/api/execution-evidence" && request.method === "GET") {
        return await executionEvidenceResponse(request, env);
      }
      if (url.pathname === "/api/internal/sync-runtime-target-lifecycle-source" && request.method === "POST") {
        return await syncRuntimeTargetLifecycleSourceResponse(request, env);
      }
      if (url.pathname === "/api/runtime-target-lifecycle" && request.method === "GET") {
        return await runtimeTargetLifecycleResponse(request, env);
      }
      if (url.pathname === "/api/internal/sync-research-task-source" && request.method === "POST") {
        return await syncResearchTaskSourceResponse(request, env);
      }
      if (url.pathname === "/api/research-tasks" && request.method === "GET") {
        return await researchTaskResponse(request, env);
      }
      if (url.pathname === "/api/logout" && request.method === "POST") return logout(request);
      if (url.pathname === "/api/switch" && request.method === "POST") return await dispatchSwitch(request, env);
      if (url.pathname === "/app.css") return new Response(APP_CSS, { status: 200, headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
      if (url.pathname === "/app.js") return new Response(APP_JS, { status: 200, headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
      return html(PAGE_HTML);
    } catch (error) {
      return json({ ok: false, error: error.message || "unexpected error" }, error.status || 500);
    }
  },

  // Cron trigger: keep the current-strategies KV cache warm so
  // users never wait for GitHub API on the /api/config endpoint.
  async scheduled(event, env, ctx) {
    if (!hasConfigStore(env)) return;
    const token = env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
    if (!token) return;

    try {
      const accountConfig = await loadAccountOptionsConfig(env);
      const strategies = await loadCurrentStrategiesSafely(accountConfig.options, env);
      await writeConfigJson(env, CURRENT_STRATEGIES_CACHE_KEY, {
        ts: Date.now(),
        data: strategies,
      });
    } catch {
      // Silently skip — next user request will populate cache via SWR
    }
  },
};

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function startLogin(request, env) {
  requireEnv(env, "GITHUB_CLIENT_ID");
  const url = new URL(request.url);
  const state = randomToken();
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);
  authorizeUrl.searchParams.set("scope", "read:user read:org");
  authorizeUrl.searchParams.set("state", state);
  return redirect(authorizeUrl.toString(), {
    "Set-Cookie": cookie(OAUTH_STATE_COOKIE, state, 600),
  });
}

async function finishLogin(request, env) {
  requireEnv(env, "GITHUB_CLIENT_ID");
  requireEnv(env, "GITHUB_CLIENT_SECRET");
  requireEnv(env, "SESSION_SECRET");

  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  if (!code || !state || cookies[OAUTH_STATE_COOKIE] !== state) {
    return html(renderMessage("登录失败", "OAuth state 校验失败，请重新登录。"), 400, clearOAuthCookie());
  }

  const tokenResponse = await fetchWithTimeout("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/callback`,
    }),
  });
  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return html(renderMessage("登录失败", "GitHub token exchange 失败。"), 502, clearOAuthCookie());
  }

  const userResponse = await fetchWithTimeout("https://api.github.com/user", {
    headers: githubHeaders(tokenPayload.access_token),
  });
  const user = await userResponse.json();
  const login = String(user.login || "").toLowerCase();
  if (!userResponse.ok || !login) {
    return html(renderMessage("登录失败", "无法读取 GitHub 用户。"), 502, clearOAuthCookie());
  }

  const authConfig = await loadAuthConfig(env);
  const orgLogins = await fetchGithubOrgLogins(tokenPayload.access_token);
  if (!isAllowedPrincipal(login, orgLogins, authConfig)) {
    return html(renderMessage("没有权限", `${login} 不在允许登录名单或组织中。`), 403, clearOAuthCookie());
  }

  const session = await makeSession(login, authorizedOrgLogins(orgLogins, authConfig), env);
  return redirect("/", {
    "Set-Cookie": [
      cookie(SESSION_COOKIE, session, SESSION_TTL_SECONDS),
      clearCookie(OAUTH_STATE_COOKIE),
    ],
  });
}

async function sessionPayload(request, env) {
  const session = await readSession(request, env);
  return {
    authenticated: Boolean(session),
    login: session?.login || null,
    allowed: Boolean(session?.allowed),
    admin: Boolean(session?.admin),
  };
}

async function adminPage(request, env) {
  const session = await requireAdminSession(request, env);
  if (session instanceof Response) return session;
  return html(await renderAdminPage(await buildAdminState(session, env)));
}

async function adminConfigResponse(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  return json(await buildAdminState(session, env));
}

async function saveAdminConfig(request, env) {
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

  await writeConfigJson(env, AUTH_CONFIG_KEY, authConfig);
  await writeConfigJson(env, ACCOUNT_OPTIONS_KEY, accountOptions);
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

async function riskProfileBindingsResponse(request, env) {
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
    }, 409);
  }
  return json({
    ok: true,
    bindings: bindingState.bindings,
    configured_targets: riskProfileBindingTargets((await loadAccountOptionsConfig(env)).options),
    no_order: true,
    execution_authority_granted: false,
  });
}

async function saveRiskProfileBindings(request, env) {
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "STRATEGY_SWITCH_CONFIG KV binding is required to save risk profiles" }, 400);
  }

  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "request body must be valid JSON" }, 400);
  }
  const accountConfig = await loadAccountOptionsConfig(env);
  let bindings;
  try {
    bindings = await buildRiskProfileBindings(raw, accountConfig.options, session.login);
  } catch (error) {
    return json({ ok: false, error: error.message || "risk profile bindings are invalid" }, 400);
  }
  await writeConfigJson(env, RISK_PROFILE_BINDINGS_KEY, {
    schema_version: RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION,
    bindings,
  });
  await appendAuditLog(env, {
    ts: new Date().toISOString(),
    login: session.login,
    action: "save_risk_profile_bindings",
    binding_count: bindings.length,
  });
  return json({
    ok: true,
    bindings,
    configured_targets: riskProfileBindingTargets(accountConfig.options),
    no_order: true,
    execution_authority_granted: false,
  });
}

async function requireAdminSession(request, env) {
  const session = await readSession(request, env);
  if (!session) return redirect("/login");
  if (!session.admin) {
    return html(renderMessage("没有管理权限", `${session.login} 不在管理员名单中。`), 403);
  }
  return session;
}

async function buildAdminState(session, env) {
  const authConfig = await loadAuthConfig(env);
  const accountConfig = await loadAccountOptionsConfig(env);
  const riskProfileBindingState = await loadRiskProfileBindings(env);
  return {
    ok: true,
    session: { login: session.login, admin: true },
    kvAvailable: hasConfigStore(env),
    authConfig,
    accountOptions: accountConfig.options || {},
    accountOptionSource: accountConfig.source,
    riskProfileBindings: riskProfileBindingState.bindings,
    riskProfileBindingsError: riskProfileBindingState.error,
    riskProfileBindingTargets: riskProfileBindingTargets(accountConfig.options),
    auditLog: await loadAuditLog(env),
  };
}

async function renderAdminPage(state) {
  const disabled = state.kvAvailable ? "" : " disabled";
  const statusClass = state.kvAvailable ? "ready" : "warn";
  const statusText = state.kvAvailable ? "KV 已连接 / KV connected" : "KV 未绑定，只读 / Read-only";
  const sourceText = state.accountOptionSource === "kv"
    ? "KV"
    : (state.accountOptionSource === "secret" ? "Worker secret" : "none");
  const accountRows = SUPPORTED_PLATFORMS.map((platform) => {
    const count = Array.isArray(state.accountOptions[platform]) ? state.accountOptions[platform].length : 0;
    return `<tr><td>${escapeHtml(platform)}</td><td>${count}</td></tr>`;
  }).join("");
  const auditRows = state.auditLog.length
    ? state.auditLog.map((entry) => (
      `<tr><td>${escapeHtml(entry.ts || "")}</td><td>${escapeHtml(entry.login || "")}</td><td>${escapeHtml(entry.action || "")}</td></tr>`
    )).join("")
    : `<tr><td colspan="3">暂无记录 / No records</td></tr>`;
  const profileByScope = new Map(state.riskProfileBindings.map((binding) => [binding.scope_id, binding]));
  const riskProfileRows = state.riskProfileBindingTargets.length
    ? state.riskProfileBindingTargets.map((target) => {
      const selected = profileByScope.get(target.scope_id)?.profile_selection?.risk_preference || "";
      const option = (value, label) => `<option value="${escapeHtml(value)}"${selected === value ? " selected" : ""}>${escapeHtml(label)}</option>`;
      return `<tr><td>${escapeHtml(target.platform)}</td><td>${escapeHtml(target.target_name)}</td><td><select data-risk-profile-platform="${escapeHtml(target.platform)}" data-risk-profile-target="${escapeHtml(target.target_name)}"${disabled}>${option("", "未设置 / Not configured")}${option("CAPITAL_PRESERVATION", "保本优先 / Capital preservation")}${option("BALANCED_COMPOUNDING", "平衡复利 / Balanced compounding")}${option("GROWTH_COMPOUNDING", "增长复利 / Growth compounding")}</select></td></tr>`;
    }).join("")
    : `<tr><td colspan="3">暂无已配置目标 / No configured targets</td></tr>`;
  const riskProfileNotice = state.riskProfileBindingsError
    ? `风险偏好记录不可用：${escapeHtml(state.riskProfileBindingsError)}。请先修复 KV 中的记录。`
    : "只保存组合风险偏好意图；不改策略、仓位、参数，不生成订单，也不授予实盘权限。";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Strategy Switch Login Management</title>
  <style>
    :root {
      --bg: #f5f6f8;
      --surface: #ffffff;
      --ink: #16191f;
      --muted: #66707c;
      --line: #dce1e7;
      --accent: #136f63;
      --warn: #9a5b13;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100svh; background: var(--bg); color: var(--ink); letter-spacing: 0; }
    button, textarea, select { font: inherit; letter-spacing: 0; }
    .topbar {
      min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 16px 28px; border-bottom: 1px solid var(--line); background: rgba(250, 251, 252, 0.94);
      position: sticky; top: 0; z-index: 10; backdrop-filter: blur(14px);
    }
    .brand { display: grid; gap: 3px; min-width: 0; }
    h1 { margin: 0; font-size: 21px; line-height: 1.12; font-weight: 780; overflow-wrap: anywhere; }
    .brand p, .muted { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
    a, button { color: inherit; }
    .btn {
      min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      padding: 0 13px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
      color: var(--muted); text-decoration: none; white-space: nowrap; font-size: 13px; font-weight: 740; cursor: pointer;
    }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #ffffff; }
    .btn:disabled { opacity: 0.48; cursor: not-allowed; }
    .shell { width: min(1080px, calc(100vw - 36px)); margin: 0 auto; padding: 24px 0 34px; display: grid; gap: 18px; }
    .status {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
      padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
    }
    .metric { display: grid; gap: 5px; min-width: 0; }
    .metric strong { font-size: 15px; line-height: 1.2; overflow-wrap: anywhere; }
    .metric span { color: var(--muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
    .ready strong { color: var(--accent); }
    .warn strong { color: var(--warn); }
    form { display: grid; gap: 18px; }
    section { display: grid; gap: 12px; padding: 18px 0; border-top: 1px solid var(--line); }
    section:first-child { border-top: 0; padding-top: 0; }
    h2 { margin: 0; font-size: 16px; line-height: 1.25; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 7px; color: var(--muted); font-size: 12px; font-weight: 740; }
    textarea {
      width: 100%; min-height: 118px; resize: vertical; border: 1px solid var(--line); border-radius: 8px;
      background: var(--surface); color: var(--ink); padding: 11px 12px; line-height: 1.45; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    select { min-height: 36px; width: 100%; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); padding: 0 9px; }
    textarea.json { min-height: 320px; }
    .panel { padding: 18px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; }
    .form-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    #status { color: var(--muted); font-size: 13px; line-height: 1.45; min-height: 20px; }
    @media (max-width: 760px) {
      .topbar { align-items: flex-start; flex-direction: column; padding: 15px 18px; }
      .shell { width: min(100% - 24px, 1080px); padding-top: 16px; }
      .status, .grid { grid-template-columns: 1fr; }
      textarea.json { min-height: 260px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <h1>登录管理 / Login Management</h1>
      <p>GitHub OAuth 2.0 管理策略切换权限。</p>
    </div>
    <div class="actions">
      <a class="btn" href="/">返回切换页</a>
      <button class="btn" id="logout-button" type="button">退出</button>
    </div>
  </header>
  <main class="shell">
    <div class="status">
      <div class="metric">
        <strong>${escapeHtml(state.session.login)}</strong>
        <span>当前管理员 / Current admin</span>
      </div>
      <div class="metric ${statusClass}">
        <strong>${escapeHtml(statusText)}</strong>
        <span>保存后台配置需要 Cloudflare KV。</span>
      </div>
      <div class="metric">
        <strong>${escapeHtml(sourceText)}</strong>
        <span>账号配置来源 / Account source</span>
      </div>
    </div>
    <form class="panel" id="admin-form">
      <section>
        <h2>登录权限 / Login Access</h2>
        <p class="muted">每行一个 GitHub 用户名或组织名。管理员会自动拥有切换权限；secret 里的管理员和管理员组织始终保留为兜底入口。</p>
        <div class="grid">
          <label>
            可切换用户 / Allowed logins
            <textarea id="allowed-logins"${disabled}>${escapeHtml(state.authConfig.allowed_logins.join("\n"))}</textarea>
          </label>
          <label>
            可切换组织 / Allowed orgs
            <textarea id="allowed-orgs"${disabled}>${escapeHtml(state.authConfig.allowed_orgs.join("\n"))}</textarea>
          </label>
          <label>
            管理员 / Admin logins
            <textarea id="admin-logins"${disabled}>${escapeHtml(state.authConfig.admin_logins.join("\n"))}</textarea>
          </label>
          <label>
            管理员组织 / Admin orgs
            <textarea id="admin-orgs"${disabled}>${escapeHtml(state.authConfig.admin_orgs.join("\n"))}</textarea>
          </label>
        </div>
      </section>
      <section>
        <h2>账号下拉 / Account Options</h2>
        <p class="muted">这里只保存账号路由，不保存 broker 密码、token、API key 或云密钥。</p>
        <textarea class="json" id="account-options"${disabled}>${escapeHtml(JSON.stringify(state.accountOptions, null, 2))}</textarea>
      </section>
      <div class="form-actions">
        <button class="btn primary" id="save-button" type="submit"${disabled}>保存配置</button>
        <span id="status">${state.kvAvailable ? "" : "当前未绑定 STRATEGY_SWITCH_CONFIG KV，只能查看。"} </span>
      </div>
    </form>
    <form class="panel" id="risk-profile-form">
      <section>
        <h2>组合风险偏好 / Portfolio Risk Preference</h2>
        <p class="muted">${riskProfileNotice}</p>
        <table>
          <thead><tr><th>Platform</th><th>Target</th><th>Risk preference</th></tr></thead>
          <tbody>${riskProfileRows}</tbody>
        </table>
      </section>
      <div class="form-actions">
        <button class="btn primary" id="save-risk-profile-button" type="submit"${disabled}>保存风险偏好</button>
        <span id="risk-profile-status"></span>
      </div>
    </form>
    <div class="panel">
      <h2>账号数量 / Account Counts</h2>
      <table>
        <thead><tr><th>Platform</th><th>Accounts</th></tr></thead>
        <tbody>${accountRows}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2>最近修改 / Recent Changes</h2>
      <table>
        <thead><tr><th>Time</th><th>Login</th><th>Action</th></tr></thead>
        <tbody id="audit-rows">${auditRows}</tbody>
      </table>
    </div>
  </main>
  <script>
    const kvAvailable = ${JSON.stringify(state.kvAvailable)};
    const statusNode = document.getElementById("status");
    const riskProfileStatusNode = document.getElementById("risk-profile-status");
    const setStatus = (message) => { statusNode.textContent = message; };
    const parseLogins = (value) => value.split(/[\\s,]+/).map((item) => item.trim()).filter(Boolean);

    document.getElementById("logout-button").addEventListener("click", async () => {
      await fetch("/api/logout", { method: "POST" });
      window.location.href = "/";
    });

    document.getElementById("admin-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!kvAvailable) return;
      let accountOptions;
      try {
        accountOptions = JSON.parse(document.getElementById("account-options").value);
      } catch {
        setStatus("账号 JSON 无效 / Account JSON is invalid");
        return;
      }
      setStatus("正在保存 / Saving...");
      try {
        const response = await fetch("/api/admin/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allowed_logins: parseLogins(document.getElementById("allowed-logins").value),
            allowed_orgs: parseLogins(document.getElementById("allowed-orgs").value),
            admin_logins: parseLogins(document.getElementById("admin-logins").value),
            admin_orgs: parseLogins(document.getElementById("admin-orgs").value),
            account_options: accountOptions,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || "save failed");
        setStatus("已保存 / Saved");
      } catch (error) {
        setStatus("保存失败 / Save failed: " + error.message);
      }
    });

    document.getElementById("risk-profile-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!kvAvailable) return;
      const bindings = [...document.querySelectorAll("[data-risk-profile-platform]")]
        .map((node) => ({
          platform: node.dataset.riskProfilePlatform,
          target_name: node.dataset.riskProfileTarget,
          risk_preference: node.value,
        }))
        .filter((item) => item.risk_preference);
      riskProfileStatusNode.textContent = "正在保存 / Saving...";
      try {
        const response = await fetch("/api/risk-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bindings }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || "save failed");
        riskProfileStatusNode.textContent = "已保存；仅为不可执行的风险偏好意图 / Saved as no-order preference";
      } catch (error) {
        riskProfileStatusNode.textContent = "保存失败 / Save failed: " + error.message;
      }
    });
  </script>
</body>
</html>`;
}

let _cachedSharedConfig = null;
let _cachedPlatformMeta = null;

async function loadSharedConfig() {
  if (_cachedSharedConfig) return _cachedSharedConfig;
  try {
    const url = "https://raw.githubusercontent.com/QuantStrategyLab/QuantRuntimeSettings/main/platform-config.json";
    const resp = await fetchWithTimeout(url, {}, 5000);
    if (resp.ok) _cachedSharedConfig = await resp.json();
  } catch { /* fallback to hardcoded */ }
  return _cachedSharedConfig;
}

async function loadPlatformMeta() {
  const merged = {
    longbridge: { label: "LongBridge", code: "LB", accent: "var(--lb)" },
    ibkr: { label: "IBKR", code: "IB", accent: "var(--ib)" },
    schwab: { label: "Schwab", code: "SW", accent: "var(--sw)" },
    firstrade: { label: "Firstrade", code: "FT", accent: "var(--ft)" },
    qmt: { label: "QMT", code: "QM", accent: "var(--qmt)" },
    binance: { label: "Binance", code: "BN", accent: "var(--bn)" },
  };
  try {
    const config = await loadSharedConfig();
    if (config && config.platforms) {
      const raw = config.platforms;
      for (const pid of Object.keys(raw)) {
        merged[pid] = {
          label: raw[pid].label,
          code: raw[pid].code,
          accent: raw[pid].accent_color,
        };
      }
    }
  } catch { /* keep defaults */ }
  return merged;
}

// In-memory cache for the lifetime of this Worker isolate.
let _memCurrentStrategies = null;
let _memCurrentStrategiesTs = 0;
let _memRefreshing = false;  // prevent concurrent background refreshes

async function configPayload(request, env, ctx) {
  const session = await readSession(request, env);
  const meta = await loadPlatformMeta();
  if (!session?.allowed) return { accountOptions: null, platformMeta: meta };
  const accountConfig = await loadAccountOptionsConfig(env);
  const strategyProfiles = await loadStrategyProfilesConfig(env);

  let currentStrategies = null;
  let cacheFresh = false;

  // 1) In-memory cache
  if (_memCurrentStrategies) {
    const age = Date.now() - _memCurrentStrategiesTs;
    if (age < CURRENT_STRATEGIES_CACHE_TTL_MS) {
      currentStrategies = _memCurrentStrategies;
      cacheFresh = true;
    } else if (age < CURRENT_STRATEGIES_STALE_TTL_MS) {
      currentStrategies = _memCurrentStrategies;
      // stale — trigger background refresh below
    }
  }

  // 2) KV cache
  if (!currentStrategies && hasConfigStore(env)) {
    const cached = await readConfigJson(env, CURRENT_STRATEGIES_CACHE_KEY);
    if (cached?.ts && cached.data) {
      const age = Date.now() - cached.ts;
      if (age < CURRENT_STRATEGIES_CACHE_TTL_MS) {
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
        const fresh = await loadCurrentStrategiesSafely(accountConfig.options, env);
        _memCurrentStrategies = fresh;
        _memCurrentStrategiesTs = Date.now();
        await writeConfigJson(env, CURRENT_STRATEGIES_CACHE_KEY, {
          ts: _memCurrentStrategiesTs,
          data: fresh,
        });
      } catch { /* keep stale data */ }
      finally { _memRefreshing = false; }
    })());
  }

  // 4) Complete miss — must wait for GitHub
  if (!currentStrategies) {
    currentStrategies = await loadCurrentStrategiesSafely(accountConfig.options, env);
    _memCurrentStrategies = currentStrategies;
    _memCurrentStrategiesTs = Date.now();
    if (hasConfigStore(env) && ctx) {
      ctx.waitUntil(writeConfigJson(env, CURRENT_STRATEGIES_CACHE_KEY, {
        ts: _memCurrentStrategiesTs,
        data: currentStrategies,
      }));
    }
  }

  return {
    accountOptions: accountConfig.options,
    platformRepositories: platformRepositories(env),
    platformMeta: meta,
    strategyProfiles,
    currentStrategies,
  };
}

async function strategyProfilesPayload(env) {
  return {
    strategyProfiles: await loadStrategyProfilesConfig(env),
    platformMeta: await loadPlatformMeta(),
  };
}

async function runtimeCatalogResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  // This is a generated gate catalog, not a deployment observation.  Keeping
  // the distinction in the response makes it unsuitable as an accidental
  // substitute for the independently refreshed control-plane/evidence views.
  return json(RUNTIME_CATALOG_PROJECTION);
}

async function loadCurrentStrategies(accountOptions, env) {
  const token = env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
  if (!token || !accountOptions) return {};
  const repositories = platformRepositories(env);

  const variableCache = new Map();
  const readVariable = (repository, scope, githubEnvironment, name, { skipCache = false } = {}) => {
    const cacheKey = [repository, scope, githubEnvironment || "", name].join("|");
    if (skipCache) variableCache.delete(cacheKey);
    if (!variableCache.has(cacheKey)) {
      variableCache.set(cacheKey, fetchGithubVariable(token, repository, scope, githubEnvironment, name));
    }
    return variableCache.get(cacheKey);
  };

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

async function loadStrategiesForPlatform(platform, accountOptions, repositories, readVariable) {
  const options = Array.isArray(accountOptions[platform]) ? accountOptions[platform] : [];
  if (!options.length) return {};
  const repository = repositories[platform];
  if (!repository) return {};

  // Process accounts sequentially within each platform to stay within
  // GitHub's concurrent request budget per token (~30 burst limit).
  const platformStrategies = {};
  for (const option of options) {
    const current = await resolveCurrentStrategyForAccount({
      platform,
      option,
      optionsCount: options.length,
      repository,
      readVariable,
    });
    if (current) platformStrategies[option.key] = current;
  }
  return platformStrategies;
}

async function loadCurrentStrategiesSafely(accountOptions, env) {
  try {
    return await withTimeout(
      loadCurrentStrategies(accountOptions, env),
      CURRENT_STRATEGIES_TIMEOUT_MS,
      {},
    );
  } catch {
    return {};
  }
}

function withTimeout(promise, timeoutMs, fallback) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function fetchWithTimeout(resource, init = {}, timeoutMs = GITHUB_API_TIMEOUT_MS, fetchImpl = fetch) {
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

async function resolveCurrentStrategyForAccount({ platform, option, optionsCount, repository, readVariable }) {
  const serviceTargetsValue = usesServiceTargetsAsRuntimeSource(platform)
    ? await readVariable(repository, "repository", "", "CLOUD_RUN_SERVICE_TARGETS_JSON")
    : "";
  const serviceTarget = runtimeTargetFromServiceTargets(serviceTargetsValue, platform, option);
  const serviceTargetProfile = cleanCurrentStrategy(serviceTarget?.strategy_profile);
  const serviceTargetReservedCashPayload = reservedCashPayloadFromObject(platform, serviceTarget);
  const serviceTargetIncomeLayerPayload = incomeLayerPayloadFromObject(serviceTarget);
  const serviceTargetOptionOverlayPayload = optionOverlayPayloadFromObject(serviceTarget);
  const serviceTargetRuntimeTargetEnabledPayload = runtimeTargetEnabledPayloadFromObject(serviceTarget);
  const serviceTargetDcaPayload = dcaPayloadFromObject(serviceTarget);
  const serviceTargetCashOnlyPayload = cashOnlyPayloadFromObject(platform, serviceTarget);
  if (serviceTargetProfile) {
    return {
      strategy_profile: serviceTargetProfile,
      ...runtimeModePayload(serviceTarget),
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
  // Await in parallel: each reads a different variable so
  // there is no risk of hammering the same GitHub API endpoint.
  // Read RUNTIME_TARGET_JSON first with retry — parallel reads inside
  // Promise.all can hit GitHub secondary rate limits and return empty.
  let runtimeTargetValue = await readVariable(repository, variableScope, githubEnvironment, "RUNTIME_TARGET_JSON");
  if (!runtimeTargetValue) {
    runtimeTargetValue = await readVariable(repository, variableScope, githubEnvironment, "RUNTIME_TARGET_JSON", { skipCache: true });
  }
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
    return {
      strategy_profile: runtimeTargetProfile,
      ...runtimeModePayload(runtimeTarget),
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

function usesServiceTargetsAsRuntimeSource(platform) {
  return ["ibkr", "schwab", "firstrade"].includes(platform);
}

function logout(request) {
  requireSameOrigin(request, { requireOrigin: true });
  return json({ ok: true }, 200, {
    "Set-Cookie": clearCookie(SESSION_COOKIE),
  });
}

async function dispatchSwitch(request, env) {
  requireEnv(env, "RUNTIME_SETTINGS_DISPATCH_TOKEN");
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);

  const rawInput = await request.json();
  const inputs = normalizeSwitchInputs(rawInput);
  assertSwitchIntent(inputs);
  const accountConfig = await loadAccountOptionsConfig(env);
  const accountOption = assertConfiguredAccount(inputs, accountConfig.options);
  assertStrategyAllowedForAccount(inputs, accountOption, await loadStrategyProfilesConfig(env));
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

async function syncDefaultStrategyForAccount(env, accountOptions, inputs, session) {
  if (!hasConfigStore(env)) return { synced: false, reason: "kv_not_bound" };
  try {
    const { options, changed } = updateAccountOptionsDefaultStrategy(accountOptions, inputs);
    let auditLogged = false;
    if (changed) {
      await writeConfigJson(env, ACCOUNT_OPTIONS_KEY, options);
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

async function syncAccountDefaultResponse(request, env) {
  requireInternalSyncToken(request, env);
  let rawInput;
  try {
    rawInput = await request.json();
  } catch {
    return json({ ok: false, error: "request body must be valid JSON" }, 400);
  }
  const inputs = normalizeSwitchInputs(rawInput);
  const accountConfig = await loadAccountOptionsConfig(env);
  const strategyProfiles = await loadStrategyProfilesConfig(env);
  const strategy = strategyProfiles.find((item) => item.profile === inputs.strategy_profile);
  if (!strategy) throw new Error(`strategy ${inputs.strategy_profile} is not configured`);

  let accountOptions = accountConfig.options;
  let accountOption = configuredAccountForInputs(inputs, accountOptions);
  let registeredLegacyContinuityAccount = false;
  if (!accountOption) {
    const registration = registerLegacyContinuityAccount(env, accountOptions, inputs, strategy);
    accountOptions = registration.options;
    accountOption = registration.account;
    registeredLegacyContinuityAccount = registration.registered;
    if (registeredLegacyContinuityAccount) {
      await writeConfigJson(env, ACCOUNT_OPTIONS_KEY, accountOptions);
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

function requireInternalSyncToken(request, env) {
  const expected = env.STRATEGY_SWITCH_SYNC_TOKEN || env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
  if (!expected) throw new HttpError("internal sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("internal sync token is invalid", 401);
}

async function syncStrategyProfilesResponse(request, env) {
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

async function syncStrategyHealthResponse(request, env) {
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

async function strategyHealthResponse(request, env) {
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
  if (snapshot.data_status === "ready" && ageSeconds > ttlSeconds) {
    snapshot.data_status = "stale";
  }
  return json(snapshot);
}

async function syncControlPlaneResponse(request, env) {
  requireDedicatedControlPlaneSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "control plane KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, CONTROL_PLANE_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid control plane payload" }, error.status || 400);
  }

  let snapshot;
  try {
    snapshot = normalizeControlPlaneSnapshot(raw, "control plane snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid control plane payload" }, 400);
  }

  await writeConfigJson(env, CONTROL_PLANE_SNAPSHOT_KEY, snapshot);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "control-plane-sync",
      action: "sync_control_plane",
      schema_version: snapshot.schema_version,
      candidate_count: snapshot.summary.candidate_count,
      data_status: snapshot.data_status,
    });
  } catch {
    // A successful snapshot must not expose its payload through audit failures.
  }
  return json({
    ok: true,
    schema_version: snapshot.schema_version,
    candidate_count: snapshot.summary.candidate_count,
    generated_at: snapshot.generated_at,
  });
}

async function syncControlPlaneSourceResponse(request, env) {
  requireDedicatedControlPlaneSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "control plane KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, CONTROL_PLANE_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid control plane source payload" }, error.status || 400);
  }

  let source;
  try {
    source = normalizeControlPlaneSourceSnapshot(raw, "control plane source snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid control plane source payload" }, 400);
  }

  await writeConfigJson(env, controlPlaneSourceKey(source.source_id), source);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "control-plane-source-sync",
      action: "sync_control_plane_source",
      source_id: source.source_id,
      schema_version: source.schema_version,
      candidate_count: source.candidates.length,
      data_status: source.data_status,
    });
  } catch {
    // The source snapshot is accepted independently of an optional audit write.
  }
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    candidate_count: source.candidates.length,
    generated_at: source.generated_at,
  });
}

async function controlPlaneResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  return json(await currentControlPlanePayload(env));
}

async function currentControlPlanePayload(env) {
  if (!hasConfigStore(env)) return emptyControlPlanePayload("snapshot_unavailable");

  const sourceSnapshot = await aggregateControlPlaneSources(env);
  if (sourceSnapshot) return sourceSnapshot;

  let snapshot;
  try {
    const stored = await readConfigJson(env, CONTROL_PLANE_SNAPSHOT_KEY);
    if (!stored) return emptyControlPlanePayload("snapshot_unavailable");
    snapshot = normalizeControlPlaneSnapshot(stored, CONTROL_PLANE_SNAPSHOT_KEY);
  } catch {
    return emptyControlPlanePayload("snapshot_invalid");
  }

  const ttlSeconds = controlPlaneStaleTtlSeconds(env);
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
  if (snapshot.data_status === "ready" && ageSeconds > ttlSeconds) snapshot.data_status = "stale";
  return snapshot;
}

function isOwnerDecisionCandidate(candidate) {
  return candidate?.lifecycle?.stage === "P6"
    && candidate.lifecycle.status === "owner_decision_required"
    && candidate.recommendation?.code === "owner_live_decision";
}

function currentOwnerDecisionCandidate(controlPlane, candidateId) {
  if (controlPlane?.data_status !== "ready") {
    throw new HttpError("current control-plane evidence is not ready", 409);
  }
  const candidate = controlPlane.candidates.find((item) => item.candidate_id === candidateId);
  if (!candidate || !isOwnerDecisionCandidate(candidate)) {
    throw new HttpError("candidate is not awaiting an owner decision", 409);
  }
  if (candidate.freshness?.status !== "fresh") {
    throw new HttpError("candidate evidence is not fresh", 409);
  }
  return candidate;
}

function normalizeOwnerDecisionRequest(payload) {
  const value = assertExactFields(payload, [
    "candidate_id", "decision", "candidate_evidence_sha256",
  ], "owner decision request");
  return {
    candidate_id: normalizeControlPlaneIdentifier(value.candidate_id, "owner decision request.candidate_id", false),
    decision: cleanChoice(value.decision, OWNER_DECISION_CHOICES, "owner decision request.decision"),
    candidate_evidence_sha256: normalizeResearchTaskDigest(
      value.candidate_evidence_sha256,
      "owner decision request.candidate_evidence_sha256",
    ),
  };
}

async function ownerDecisionCandidateEvidenceSha256(candidate) {
  return await calculateOwnerDecisionSha256({
    candidate_id: candidate.candidate_id,
    candidate_kind: candidate.candidate_kind,
    domain: candidate.domain,
    lifecycle: candidate.lifecycle,
    evidence: candidate.evidence,
    recommendation: { code: candidate.recommendation?.code || "none" },
  });
}

async function buildOwnerDecisionIntent({ candidate, decision, decidedBy, candidateEvidenceSha256, decidedAt }) {
  const intent = {
    schema_version: OWNER_DECISION_INTENT_SCHEMA_VERSION,
    candidate_id: candidate.candidate_id,
    candidate_kind: candidate.candidate_kind,
    domain: candidate.domain,
    decision,
    decided_at: decidedAt,
    decided_by: decidedBy,
    candidate_evidence_sha256: candidateEvidenceSha256,
    no_order: true,
    execution_authority_granted: false,
    decision_sha256: "",
  };
  intent.decision_sha256 = await calculateOwnerDecisionSha256(intent);
  return await normalizeOwnerDecisionIntent(intent, "owner decision intent");
}

async function normalizeOwnerDecisionIntent(payload, fieldName) {
  const value = assertExactFields(payload, [
    "schema_version", "candidate_id", "candidate_kind", "domain", "decision", "decided_at", "decided_by",
    "candidate_evidence_sha256", "no_order", "execution_authority_granted", "decision_sha256",
  ], fieldName);
  if (value.schema_version !== OWNER_DECISION_INTENT_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const intent = {
    schema_version: OWNER_DECISION_INTENT_SCHEMA_VERSION,
    candidate_id: normalizeControlPlaneIdentifier(value.candidate_id, `${fieldName}.candidate_id`, false),
    candidate_kind: cleanChoice(value.candidate_kind, CONTROL_PLANE_CANDIDATE_KINDS, `${fieldName}.candidate_kind`),
    domain: cleanChoice(value.domain, STRATEGY_HEALTH_DOMAINS, `${fieldName}.domain`),
    decision: cleanChoice(value.decision, OWNER_DECISION_CHOICES, `${fieldName}.decision`),
    decided_at: normalizeResearchTaskTimestamp(value.decided_at, `${fieldName}.decided_at`),
    decided_by: cleanGithubLogin(value.decided_by, `${fieldName}.decided_by`),
    candidate_evidence_sha256: normalizeResearchTaskDigest(
      value.candidate_evidence_sha256,
      `${fieldName}.candidate_evidence_sha256`,
    ),
    no_order: value.no_order,
    execution_authority_granted: value.execution_authority_granted,
    decision_sha256: normalizeResearchTaskDigest(value.decision_sha256, `${fieldName}.decision_sha256`),
  };
  if (intent.no_order !== true || intent.execution_authority_granted !== false) {
    throw new Error(`${fieldName} must remain no-order and non-executable`);
  }
  if (intent.decision_sha256 !== await calculateOwnerDecisionSha256(intent)) {
    throw new Error(`${fieldName}.decision_sha256 mismatch`);
  }
  return intent;
}

async function calculateOwnerDecisionSha256(payload) {
  const material = { ...payload };
  delete material.decision_sha256;
  const raw = new TextEncoder().encode(canonicalResearchTaskJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readOwnerDecisionIntent(env, candidateId) {
  try {
    const stored = await readConfigJson(env, ownerDecisionCurrentKey(candidateId));
    if (!stored) return { intent: null, error: null };
    return { intent: await normalizeOwnerDecisionIntent(stored, ownerDecisionCurrentKey(candidateId)), error: null };
  } catch {
    return { intent: null, error: "owner_decision_intent_invalid" };
  }
}

function ownerDecisionArchiveKey(candidateId, decisionSha256) {
  return `${OWNER_DECISION_INTENT_PREFIX}${candidateId}:${decisionSha256}`;
}

function ownerDecisionCurrentKey(candidateId) {
  return `${OWNER_DECISION_CURRENT_PREFIX}${candidateId}`;
}

function emptyOwnerDecisionQueue(errorCode, controlPlane = null) {
  return {
    schema_version: OWNER_DECISION_QUEUE_SCHEMA_VERSION,
    data_status: controlPlane?.data_status === "stale" ? "stale" : "unavailable",
    computed_at: controlPlane?.computed_at || null,
    candidates: [],
    policy: {
      admin_required: true,
      current_evidence_required: true,
      execution_authority_granted: false,
      no_order: true,
      notice: "网页只记录所有者决定意图；不会下单、变更资金或启用实盘。",
    },
    errors: uniqueStrings([...(controlPlane?.errors || []), errorCode]),
  };
}

async function ownerDecisionQueueResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyOwnerDecisionQueue("snapshot_unavailable"));

  const controlPlane = await currentControlPlanePayload(env);
  if (controlPlane.data_status !== "ready") {
    return json(emptyOwnerDecisionQueue("control_plane_not_ready", controlPlane));
  }

  const pending = controlPlane.candidates
    .filter(isOwnerDecisionCandidate)
    .filter((candidate) => candidate.freshness?.status === "fresh")
    .slice(0, OWNER_DECISION_MAX_CANDIDATES);
  const errors = [...controlPlane.errors];
  const candidates = [];
  for (const candidate of pending) {
    const candidateEvidenceSha256 = await ownerDecisionCandidateEvidenceSha256(candidate);
    const stored = await readOwnerDecisionIntent(env, candidate.candidate_id);
    if (stored.error) errors.push(stored.error);
    const intent = stored.intent?.candidate_evidence_sha256 === candidateEvidenceSha256
      ? stored.intent
      : null;
    candidates.push({
      candidate,
      candidate_evidence_sha256: candidateEvidenceSha256,
      intent,
    });
  }
  if (controlPlane.candidates.filter(isOwnerDecisionCandidate).length > OWNER_DECISION_MAX_CANDIDATES) {
    errors.push("owner_decision_queue_truncated");
  }
  return json({
    schema_version: OWNER_DECISION_QUEUE_SCHEMA_VERSION,
    data_status: "ready",
    computed_at: controlPlane.computed_at,
    candidates,
    policy: {
      admin_required: true,
      current_evidence_required: true,
      execution_authority_granted: false,
      no_order: true,
      notice: "网页只记录所有者决定意图；不会下单、变更资金或启用实盘。",
    },
    errors: uniqueStrings(errors),
  });
}

async function recordOwnerDecisionResponse(request, env) {
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "STRATEGY_SWITCH_CONFIG KV binding is required" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, 4 * 1024);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid owner decision request" }, error.status || 400);
  }

  let requested;
  try {
    requested = normalizeOwnerDecisionRequest(raw);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid owner decision request" }, 400);
  }

  const controlPlane = await currentControlPlanePayload(env);
  let candidate;
  try {
    candidate = currentOwnerDecisionCandidate(controlPlane, requested.candidate_id);
  } catch (error) {
    return json({ ok: false, error: error.message || "owner decision is not currently available" }, error.status || 409);
  }
  const candidateEvidenceSha256 = await ownerDecisionCandidateEvidenceSha256(candidate);
  if (requested.candidate_evidence_sha256 !== candidateEvidenceSha256) {
    return json({ ok: false, error: "candidate evidence changed; reload the review before deciding" }, 409);
  }

  const intent = await buildOwnerDecisionIntent({
    candidate,
    decision: requested.decision,
    decidedBy: session.login,
    candidateEvidenceSha256,
    decidedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  // Keep every intent under its immutable digest key; the small current pointer
  // only makes the active review fast to read. A changed decision never
  // erases the prior auditable record.
  await writeConfigJson(env, ownerDecisionArchiveKey(candidate.candidate_id, intent.decision_sha256), intent);
  await writeConfigJson(env, ownerDecisionCurrentKey(candidate.candidate_id), intent);
  let auditLogged = false;
  try {
    await appendAuditLog(env, {
      ts: intent.decided_at,
      login: session.login,
      action: "record_owner_decision_intent",
      candidate_id: intent.candidate_id,
      decision: intent.decision,
      candidate_evidence_sha256: intent.candidate_evidence_sha256,
      decision_sha256: intent.decision_sha256,
      no_order: true,
      execution_authority_granted: false,
    });
    auditLogged = true;
  } catch {
    // The decision remains durable, auditable by its digest, and explicitly
    // non-executable even if the rolling convenience log cannot be updated.
  }
  return json({ ok: true, intent, audit_logged: auditLogged });
}

async function syncExecutionEvidenceSourceResponse(request, env) {
  requireDedicatedExecutionEvidenceSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "execution evidence KV is not configured" }, 503);
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
  });
}

async function executionEvidenceResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyExecutionEvidencePayload("snapshot_unavailable"));
  return json(await aggregateExecutionEvidenceSources(env));
}

async function aggregateExecutionEvidenceSources(env) {
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

async function readExecutionEvidenceSources(env) {
  const store = configStore(env);
  if (!store || typeof store.list !== "function") return [];
  let listing;
  try {
    listing = await store.list({ prefix: EXECUTION_EVIDENCE_SOURCE_PREFIX, limit: EXECUTION_EVIDENCE_MAX_SOURCES });
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
      if (!stored) continue;
      sources.push(normalizeExecutionEvidenceSourceSnapshot(stored, key));
    } catch {
      sources.push(emptyExecutionEvidenceSourceSnapshot("execution_evidence_source_invalid"));
    }
  }
  return sources;
}

function executionEvidenceSourceKey(sourceId) {
  return `${EXECUTION_EVIDENCE_SOURCE_PREFIX}${sourceId}`;
}

async function syncRuntimeTargetLifecycleSourceResponse(request, env) {
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
  await writeConfigJson(env, runtimeTargetLifecycleSourceKey(source.source_id), source);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "runtime-target-lifecycle-source-sync",
      action: "sync_runtime_target_lifecycle_source",
      source_id: source.source_id,
      schema_version: source.schema_version,
      target_count: source.targets.length,
      data_status: source.data_status,
    });
  } catch {
    // A valid no-order snapshot remains useful when convenience audit retention fails.
  }
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    target_count: source.targets.length,
    generated_at: source.generated_at,
  });
}

async function runtimeTargetLifecycleResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyRuntimeTargetLifecyclePayload("snapshot_unavailable"));
  return json(await aggregateRuntimeTargetLifecycleSources(env));
}

async function aggregateRuntimeTargetLifecycleSources(env) {
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
      targets.push({ source_id: source.source_id, freshness, target });
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
      no_order: true,
      notice: "已启用目标持续监控；已停用目标持续进行无执行验证。该状态不会启用目标或提交订单。",
    },
    errors: uniqueStrings(errors),
  };
}

async function readRuntimeTargetLifecycleSources(env) {
  const store = configStore(env);
  if (!store || typeof store.list !== "function") return [];
  let listing;
  try {
    listing = await store.list({ prefix: RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX, limit: RUNTIME_TARGET_LIFECYCLE_MAX_SOURCES });
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
      if (!stored) continue;
      sources.push(normalizeRuntimeTargetLifecycleSourceSnapshot(stored, key));
    } catch {
      sources.push(emptyRuntimeTargetLifecycleSourceSnapshot("runtime_target_lifecycle_source_invalid"));
    }
  }
  return sources;
}

function runtimeTargetLifecycleSourceKey(sourceId) {
  return `${RUNTIME_TARGET_LIFECYCLE_SOURCE_PREFIX}${sourceId}`;
}

async function syncResearchTaskSourceResponse(request, env) {
  requireDedicatedResearchTaskSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "research task KV is not configured" }, 503);
  }

  let raw;
  try {
    raw = await readBoundedJson(request, RESEARCH_TASK_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid research task source payload" }, error.status || 400);
  }

  let source;
  try {
    source = await normalizeResearchTaskSourceSnapshot(raw, "research task source snapshot");
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid research task source payload" }, 400);
  }

  await writeConfigJson(env, researchTaskSourceKey(source.source_id), source);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "research-task-source-sync",
      action: "sync_research_task_source",
      source_id: source.source_id,
      schema_version: source.schema_version,
      task_count: source.tasks.length,
      data_status: source.data_status,
    });
  } catch {
    // A valid no-order task index does not depend on optional audit retention.
  }
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    task_count: source.tasks.length,
    generated_at: source.generated_at,
  });
}

async function researchTaskResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyResearchTaskPayload("snapshot_unavailable"));
  return json(await aggregateResearchTaskSources(env));
}

async function aggregateResearchTaskSources(env) {
  const sources = await readResearchTaskSources(env);
  if (!sources.length) return emptyResearchTaskPayload("snapshot_unavailable");

  const ttlSeconds = researchTaskStaleTtlSeconds(env);
  const now = Date.now();
  const taskIds = new Set();
  const duplicateTaskIds = new Set();
  const tasks = [];
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
      errors.push("research_task_source_stale");
    }
    for (const task of source.tasks) {
      if (taskIds.has(task.task_id)) {
        duplicateTaskIds.add(task.task_id);
        errors.push("research_task_duplicate_task");
        continue;
      }
      taskIds.add(task.task_id);
      tasks.push({ source_id: source.source_id, freshness, task });
    }
    errors.push(...source.errors);
  }

  const uniqueTasks = tasks.filter((entry) => !duplicateTaskIds.has(entry.task.task_id));
  const dataStatus = hasStaleSource ? "stale" : (hasReadySource ? "ready" : "unavailable");
  return {
    schema_version: RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION,
    generated_at: earliestControlPlaneTimestamp(timestamps),
    computed_at: earliestControlPlaneTimestamp(timestamps),
    data_status: dataStatus,
    summary: { task_count: uniqueTasks.length },
    tasks: uniqueTasks,
    policy: {
      research_only: true,
      no_order: true,
      size_zero_required: true,
      p4_p5_p6_authorized: false,
      notice: "研究任务只用于离线、零仓位实验；不会调参、改代码、部署或下单。",
    },
    errors: uniqueStrings(errors),
  };
}

async function readResearchTaskSources(env) {
  const store = configStore(env);
  if (!store || typeof store.list !== "function") return [];
  let listing;
  try {
    listing = await store.list({ prefix: RESEARCH_TASK_SOURCE_PREFIX, limit: RESEARCH_TASK_MAX_SOURCES });
  } catch {
    return [emptyResearchTaskSourceSnapshot("research_task_source_list_unavailable")];
  }
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const sources = [];
  for (const entry of keys.slice(0, RESEARCH_TASK_MAX_SOURCES)) {
    const key = typeof entry?.name === "string" ? entry.name : "";
    if (!key.startsWith(RESEARCH_TASK_SOURCE_PREFIX)) continue;
    try {
      const stored = await readConfigJson(env, key);
      if (!stored) continue;
      sources.push(await normalizeResearchTaskSourceSnapshot(stored, key));
    } catch {
      sources.push(emptyResearchTaskSourceSnapshot("research_task_source_invalid"));
    }
  }
  return sources;
}

function researchTaskSourceKey(sourceId) {
  return `${RESEARCH_TASK_SOURCE_PREFIX}${sourceId}`;
}

async function aggregateControlPlaneSources(env) {
  const sources = await readControlPlaneSources(env);
  if (!sources) return null;
  if (!sources.length) return null;

  const ttlSeconds = controlPlaneStaleTtlSeconds(env);
  const now = Date.now();
  const candidates = [];
  const candidateIds = new Set();
  const duplicateCandidateIds = new Set();
  const errors = [];
  const timestamps = [];
  let hasReadySource = false;
  let hasStaleSource = false;

  for (const source of sources) {
    const sourceFreshness = controlPlaneSnapshotFreshness(source, ttlSeconds, now);
    if (source.generated_at) timestamps.push(source.generated_at);
    if (source.computed_at) timestamps.push(source.computed_at);
    if (sourceFreshness.data_status === "ready") hasReadySource = true;
    if (sourceFreshness.data_status === "stale") {
      hasStaleSource = true;
      errors.push("control_plane_source_stale");
    }
    for (const candidate of source.candidates) {
      if (candidateIds.has(candidate.candidate_id)) {
        duplicateCandidateIds.add(candidate.candidate_id);
        errors.push("control_plane_duplicate_candidate");
        continue;
      }
      candidateIds.add(candidate.candidate_id);
      candidates.push({
        ...candidate,
        freshness: mergeControlPlaneFreshness(candidate.freshness, sourceFreshness),
      });
    }
    errors.push(...source.errors);
  }

  const dataStatus = hasStaleSource ? "stale" : (hasReadySource ? "ready" : "unavailable");
  const uniqueCandidates = candidates.filter((candidate) => !duplicateCandidateIds.has(candidate.candidate_id));
  const uniqueErrors = uniqueStrings(errors);
  return {
    schema_version: "qsl_control_plane_dashboard.v1",
    generated_at: earliestControlPlaneTimestamp(timestamps),
    computed_at: earliestControlPlaneTimestamp(timestamps),
    data_status: dataStatus,
    summary: normalizeControlPlaneSummary(uniqueCandidates),
    attention: normalizeControlPlaneAttention({
      dataStatus,
      candidates: uniqueCandidates,
      errors: uniqueErrors,
    }),
    candidates: uniqueCandidates,
    policy: normalizeControlPlanePolicy({
      p4_p5_automation: "not_configured",
      p6_owner_decision_required: true,
      notice: "P1–P3 自动研究已接入；P4/P5 尚未配置，live 仍需所有者明确决定。",
    }, "aggregated control plane policy"),
    errors: uniqueErrors,
  };
}

async function readControlPlaneSources(env) {
  const store = configStore(env);
  if (!store || typeof store.list !== "function") return null;
  let listing;
  try {
    listing = await store.list({ prefix: CONTROL_PLANE_SOURCE_PREFIX, limit: CONTROL_PLANE_MAX_SOURCES });
  } catch {
    return [emptyControlPlaneSourceSnapshot("control_plane_source_list_unavailable")];
  }
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const sources = [];
  for (const entry of keys.slice(0, CONTROL_PLANE_MAX_SOURCES)) {
    const key = typeof entry?.name === "string" ? entry.name : "";
    if (!key.startsWith(CONTROL_PLANE_SOURCE_PREFIX)) continue;
    try {
      const stored = await readConfigJson(env, key);
      if (!stored) continue;
      sources.push(normalizeControlPlaneSourceSnapshot(stored, key));
    } catch {
      sources.push(emptyControlPlaneSourceSnapshot("control_plane_source_invalid"));
    }
  }
  return sources;
}

function controlPlaneSourceKey(sourceId) {
  return `${CONTROL_PLANE_SOURCE_PREFIX}${sourceId}`;
}

async function syncAdaptiveSelectionSourceResponse(request, env) {
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

async function syncM0ResearchLedgerResponse(request, env) {
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

async function m0ResearchLedgerResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyM0ResearchDashboardPayload("m0_research_ledger_unavailable"));
  const record = await readCurrentM0ResearchLedgerRecord(env);
  return json(record
    ? projectM0ResearchDashboardForRead(record.envelope.ledger, record.envelope.ledger_sha256)
    : emptyM0ResearchDashboardPayload("m0_research_ledger_unavailable"));
}

function m0ResearchLedgerReplayError(current, incoming) {
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

function m0ResearchLedgerArchiveKey(ledgerSha256) {
  return `${M0_RESEARCH_ARCHIVE_PREFIX}${ledgerSha256}`;
}

async function writeM0ResearchLedgerRecord(env, key, record) {
  const store = configStore(env);
  if (!store) throw new Error("M0 research ledger KV is not configured");
  await store.put(key, JSON.stringify(record), { expirationTtl: M0_RESEARCH_RETENTION_SECONDS });
}

async function readCurrentM0ResearchLedgerRecord(env) {
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

async function adaptiveSelectionResponse(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json(emptyAdaptiveSelectionPayload("adaptive_selection_source_unavailable"));
  return json(await aggregateAdaptiveSelectionSources(env));
}

async function aggregateAdaptiveSelectionSources(env) {
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

async function readAdaptiveSelectionSources(env) {
  const store = configStore(env);
  if (!store || typeof store.list !== "function") return [];
  let listing;
  try {
    listing = await store.list({ prefix: ADAPTIVE_SELECTION_SOURCE_PREFIX, limit: ADAPTIVE_SELECTION_MAX_SOURCES });
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
      if (!stored) continue;
      sources.push(await normalizeAdaptiveSelectionSourceSnapshot(stored, key));
    } catch {
      sources.push(emptyAdaptiveSelectionSourceSnapshot("adaptive_selection_source_invalid"));
    }
  }
  return sources;
}

function adaptiveSelectionSourceKey(sourceId) {
  return `${ADAPTIVE_SELECTION_SOURCE_PREFIX}${sourceId}`;
}

function controlPlaneSnapshotFreshness(snapshot, ttlSeconds, now) {
  const timestamps = [snapshot.generated_at, snapshot.computed_at]
    .filter(Boolean)
    .map((value) => Date.parse(value));
  const freshnessAt = timestamps.length ? Math.min(...timestamps) : Number.NaN;
  const futureBeyondClockSkew = Number.isFinite(freshnessAt) && freshnessAt > now + 5 * 60 * 1000;
  const ageSeconds = futureBeyondClockSkew
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(freshnessAt)
      ? Math.max(0, Math.round((now - freshnessAt) / 1000))
      : Number.POSITIVE_INFINITY;
  const dataStatus = snapshot.data_status === "ready" && ageSeconds > ttlSeconds
    ? "stale"
    : snapshot.data_status;
  return { data_status: dataStatus, age_seconds: Number.isFinite(ageSeconds) ? ageSeconds : null };
}

function mergeControlPlaneFreshness(candidateFreshness, sourceFreshness) {
  const sourceAgeSeconds = sourceFreshness.age_seconds;
  const candidateAge = candidateFreshness.age_seconds;
  const ageSeconds = sourceAgeSeconds === null
    ? candidateAge
    : (candidateAge === null ? sourceAgeSeconds : Math.max(candidateAge, sourceAgeSeconds));
  const status = candidateFreshness.status === "stale" || sourceFreshness.data_status !== "ready"
    ? "stale"
    : candidateFreshness.status;
  return { status, age_seconds: ageSeconds };
}

function earliestControlPlaneTimestamp(values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  return timestamps[0]?.value || null;
}

async function readBoundedJson(request, maxBytes) {
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

function requireDedicatedStrategyHealthSyncToken(request, env) {
  const expected = String(env.STRATEGY_HEALTH_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("strategy health sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("strategy health sync token is invalid", 401);
}

function requireDedicatedControlPlaneSyncToken(request, env) {
  const expected = String(env.CONTROL_PLANE_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("control plane sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("control plane sync token is invalid", 401);
}

function requireDedicatedAdaptiveSelectionSyncToken(request, env) {
  const expected = String(env.ADAPTIVE_SELECTION_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("adaptive selection sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("adaptive selection sync token is invalid", 401);
}

function requireDedicatedExecutionEvidenceSyncToken(request, env) {
  const expected = String(env.EXECUTION_EVIDENCE_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("execution evidence sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("execution evidence sync token is invalid", 401);
}

function requireDedicatedResearchTaskSyncToken(request, env) {
  const expected = String(env.RESEARCH_TASK_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("research task sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("research task sync token is invalid", 401);
}

function assertExactFields(value, fields, fieldName) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`${fieldName} has invalid fields`);
  }
  return value;
}

function normalizeResearchTaskIdentity(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(text)) {
    throw new Error(`${fieldName} must be a stable identity`);
  }
  return text;
}

function normalizeResearchTaskDigest(value, fieldName, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(`${fieldName} must be a lowercase SHA-256`);
  return text;
}

function normalizeResearchTaskRevision(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${fieldName} must be a 40-character revision`);
  return text;
}

function normalizeResearchTaskTimestamp(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${fieldName} must be a UTC timestamp`);
  }
  return text;
}

function normalizeResearchTaskText(value, fieldName, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || /[<>\\]/.test(text)) throw new Error(`${fieldName} is invalid`);
  if (/\b(?:token|secret|password|credential|api[_ -]?key)\s*[:=]/i.test(text)) {
    throw new Error(`${fieldName} contains sensitive material`);
  }
  return text;
}

function assertResearchTaskHasNoUnsafeMaterial(value, fieldName = "research task") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertResearchTaskHasNoUnsafeMaterial(item, `${fieldName}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (key !== "no_order" && /(?:secret|token|password|credential|api[_-]?key|order|fill|capital|account|broker)/i.test(key)) {
      throw new Error(`${fieldName} contains forbidden execution or secret material`);
    }
    assertResearchTaskHasNoUnsafeMaterial(nested, `${fieldName}.${key}`);
  }
}

function canonicalResearchTaskJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("research task must use finite JSON values");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalResearchTaskJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("research task must use JSON values");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalResearchTaskJson(value[key])}`).join(",")}}`;
}

async function calculateResearchTaskSha256(payload) {
  const material = { ...payload };
  delete material.task_sha256;
  const raw = new TextEncoder().encode(canonicalResearchTaskJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function normalizeResearchTask(payload, fieldName) {
  const task = assertExactFields(payload, [
    "schema", "task_id", "created_at", "digest_algorithm", "task_type", "target", "evidence", "experiment", "authority", "task_sha256",
  ], fieldName);
  assertResearchTaskHasNoUnsafeMaterial(task, fieldName);
  if (task.schema !== RESEARCH_TASK_SCHEMA_VERSION) throw new Error(`${fieldName}.schema is unsupported`);
  if (task.digest_algorithm !== "sha256") throw new Error(`${fieldName}.digest_algorithm must be sha256`);
  const target = assertExactFields(task.target, ["candidate_id", "candidate_kind", "domain", "repository", "strategy_revision"], `${fieldName}.target`);
  const evidence = assertExactFields(task.evidence, ["p1_input_digest", "p2_config_digest", "p3_evidence_id", "producer_revision"], `${fieldName}.evidence`);
  const experiment = assertExactFields(task.experiment, ["objective", "hypothesis", "parameter_bounds_sha256", "max_runs", "max_wall_seconds"], `${fieldName}.experiment`);
  const authority = assertExactFields(task.authority, ["research_only", "no_order", "size_zero_required", "p4_p5_p6_authorized"], `${fieldName}.authority`);
  const normalized = {
    schema: RESEARCH_TASK_SCHEMA_VERSION,
    task_id: normalizeResearchTaskIdentity(task.task_id, `${fieldName}.task_id`),
    created_at: normalizeResearchTaskTimestamp(task.created_at, `${fieldName}.created_at`),
    digest_algorithm: "sha256",
    task_type: cleanChoice(task.task_type, RESEARCH_TASK_TYPES, `${fieldName}.task_type`),
    target: {
      candidate_id: normalizeResearchTaskIdentity(target.candidate_id, `${fieldName}.target.candidate_id`),
      candidate_kind: cleanChoice(target.candidate_kind, CONTROL_PLANE_CANDIDATE_KINDS, `${fieldName}.target.candidate_kind`),
      domain: cleanChoice(target.domain, STRATEGY_HEALTH_DOMAINS, `${fieldName}.target.domain`),
      repository: normalizeResearchTaskRepository(target.repository, `${fieldName}.target.repository`),
      strategy_revision: normalizeResearchTaskRevision(target.strategy_revision, `${fieldName}.target.strategy_revision`),
    },
    evidence: {
      p1_input_digest: normalizeResearchTaskDigest(evidence.p1_input_digest, `${fieldName}.evidence.p1_input_digest`, true),
      p2_config_digest: normalizeResearchTaskDigest(evidence.p2_config_digest, `${fieldName}.evidence.p2_config_digest`, true),
      p3_evidence_id: normalizeResearchTaskDigest(evidence.p3_evidence_id, `${fieldName}.evidence.p3_evidence_id`, true),
      producer_revision: normalizeResearchTaskRevision(evidence.producer_revision, `${fieldName}.evidence.producer_revision`),
    },
    experiment: {
      objective: cleanChoice(experiment.objective, RESEARCH_TASK_OBJECTIVES, `${fieldName}.experiment.objective`),
      hypothesis: normalizeResearchTaskText(experiment.hypothesis, `${fieldName}.experiment.hypothesis`, 800),
      parameter_bounds_sha256: normalizeResearchTaskDigest(experiment.parameter_bounds_sha256, `${fieldName}.experiment.parameter_bounds_sha256`, true),
      max_runs: normalizeResearchTaskBound(experiment.max_runs, `${fieldName}.experiment.max_runs`, 100),
      max_wall_seconds: normalizeResearchTaskBound(experiment.max_wall_seconds, `${fieldName}.experiment.max_wall_seconds`, 86400),
    },
    authority: {
      research_only: authority.research_only,
      no_order: authority.no_order,
      size_zero_required: authority.size_zero_required,
      p4_p5_p6_authorized: authority.p4_p5_p6_authorized,
    },
    task_sha256: normalizeResearchTaskDigest(task.task_sha256, `${fieldName}.task_sha256`),
  };
  if (JSON.stringify(normalized.authority) !== JSON.stringify({ research_only: true, no_order: true, size_zero_required: true, p4_p5_p6_authorized: false })) {
    throw new Error(`${fieldName}.authority must be fixed to offline research only`);
  }
  if (normalized.task_sha256 !== await calculateResearchTaskSha256(normalized)) {
    throw new Error(`${fieldName}.task_sha256 mismatch`);
  }
  return normalized;
}

function normalizeResearchTaskRepository(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(text)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return text;
}

function normalizeResearchTaskBound(value, fieldName, maximum) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${fieldName} is outside its safe bound`);
  }
  return value;
}

async function normalizeResearchTaskSourceSnapshot(payload, fieldName = "research task source snapshot") {
  const source = assertExactFields(payload, ["schema_version", "source_id", "generated_at", "computed_at", "data_status", "tasks", "errors"], fieldName);
  if (source.schema_version !== RESEARCH_TASK_SOURCE_SCHEMA_VERSION) throw new Error(`${fieldName}.schema_version is unsupported`);
  const dataStatus = cleanChoice(source.data_status, STRATEGY_HEALTH_DATA_STATUSES, `${fieldName}.data_status`);
  if (!Array.isArray(source.tasks) || source.tasks.length > 100) {
    throw new Error(`${fieldName}.tasks must be an array with at most 100 items`);
  }
  const tasks = [];
  const seen = new Set();
  for (const [index, item] of source.tasks.entries()) {
    const task = await normalizeResearchTask(item, `${fieldName}.tasks[${index}]`);
    if (seen.has(task.task_id)) throw new Error(`${fieldName}.tasks contains duplicate task_id`);
    seen.add(task.task_id);
    tasks.push(task);
  }
  if (dataStatus === "unavailable" && tasks.length) throw new Error(`${fieldName}.tasks must be empty when unavailable`);
  return {
    schema_version: RESEARCH_TASK_SOURCE_SCHEMA_VERSION,
    source_id: normalizeControlPlaneIdentifier(source.source_id, `${fieldName}.source_id`, false),
    generated_at: normalizeStrategyHealthTimestamp(source.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(source.computed_at, `${fieldName}.computed_at`, true),
    data_status: dataStatus,
    tasks,
    errors: normalizeStrategyHealthErrors(source.errors),
  };
}

function emptyResearchTaskSourceSnapshot(errorCode) {
  return {
    schema_version: RESEARCH_TASK_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    tasks: [],
    errors: [errorCode],
  };
}

function emptyResearchTaskPayload(errorCode) {
  return {
    schema_version: RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION,
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { task_count: 0 },
    tasks: [],
    policy: {
      research_only: true,
      no_order: true,
      size_zero_required: true,
      p4_p5_p6_authorized: false,
      notice: "研究任务只用于离线、零仓位实验；不会调参、改代码、部署或下单。",
    },
    errors: [errorCode],
  };
}

function researchTaskStaleTtlSeconds(env) {
  const configured = Number(env.RESEARCH_TASK_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 604800) {
    return RESEARCH_TASK_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}

function normalizeStrategyHealthSnapshot(payload, fieldName = "strategy health snapshot") {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  if (payload.schema_version !== "strategy_health_dashboard.v1") {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const status = cleanChoice(payload.data_status || "unavailable", STRATEGY_HEALTH_DATA_STATUSES, `${fieldName}.data_status`);
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

function normalizeStrategyHealthStrategies(value, fieldName) {
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

function normalizeStrategyHealthSummary(value, strategies) {
  const counts = Object.fromEntries(STRATEGY_HEALTH_STATUSES.map((status) => [status, 0]));
  for (const item of strategies) counts[item.status] += 1;
  return { strategy_count: strategies.length, ...counts };
}

function normalizeStrategyHealthComponents(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    performance: normalizeStrategyHealthScore(source.performance, `${fieldName}.performance`),
    risk: normalizeStrategyHealthScore(source.risk, `${fieldName}.risk`),
    decay: normalizeStrategyHealthScore(source.decay, `${fieldName}.decay`),
    stability: normalizeStrategyHealthScore(source.stability, `${fieldName}.stability`),
    operations: normalizeStrategyHealthScore(source.operations, `${fieldName}.operations`),
  };
}

function normalizeStrategyHealthDecision(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    code: cleanSlug(source.code || "evidence_missing", `${fieldName}.code`).toLowerCase(),
    label: sanitizeStrategyHealthText(source.label, `${fieldName}.label`, 120, false, "证据不足，保持研究态"),
    reason: sanitizeStrategyHealthText(source.reason, `${fieldName}.reason`, 240, false, "没有可用的机器检查结果。"),
  };
}

function normalizeStrategyHealthReview(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    requested_stage: sanitizeStrategyHealthText(source.requested_stage, `${fieldName}.requested_stage`, 80, true),
    evidence_package_id: sanitizeStrategyHealthText(source.evidence_package_id, `${fieldName}.evidence_package_id`, 120, true),
    validation: normalizeStrategyHealthSummaryObject(source.validation),
    risk: normalizeStrategyHealthSummaryObject(source.risk),
    kelly_readiness: normalizeStrategyHealthSummaryObject(source.kelly_readiness),
  };
}

function normalizeStrategyHealthSummaryObject(value) {
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

function normalizeStrategyHealthFreshness(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    status: cleanChoice(source.status || "unknown", ["fresh", "stale", "unknown"], `${fieldName}.status`),
    age_seconds: normalizeStrategyHealthAge(source.age_seconds, `${fieldName}.age_seconds`),
  };
}

function normalizeStrategyHealthAge(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 315360000) throw new Error(`${fieldName} is invalid`);
  return Math.round(number);
}

function normalizeStrategyHealthScore(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error(`${fieldName} must be between 0 and 100`);
  return number;
}

function normalizeStrategyHealthTimestamp(value, fieldName, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = normalizeStrategyHealthText(value, fieldName, 64);
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }
  return text;
}

function normalizeStrategyHealthText(value, fieldName, maxLength, nullable = false) {
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

function sanitizeStrategyHealthText(value, fieldName, maxLength, nullable = false, fallback = null) {
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

function normalizeStrategyHealthErrors(value) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.slice(0, 20).filter((item) => /^[a-z][a-z0-9_.-]{0,63}$/.test(String(item || ""))));
}

function normalizeStrategyHealthPolicy(value) {
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

function emptyStrategyHealthPayload(errorCode) {
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

function strategyHealthStaleTtlSeconds(env) {
  const configured = Number(env.STRATEGY_HEALTH_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 604800) {
    return STRATEGY_HEALTH_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}

function normalizeControlPlaneSnapshot(payload, fieldName = "control plane snapshot") {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  if (payload.schema_version !== "qsl_control_plane_dashboard.v1") {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  for (const required of ["generated_at", "computed_at", "data_status", "summary", "candidates", "policy", "errors"]) {
    if (!(required in payload)) throw new Error(`${fieldName}.${required} is required`);
  }
  if (!payload.summary || Array.isArray(payload.summary) || typeof payload.summary !== "object") {
    throw new Error(`${fieldName}.summary must be an object`);
  }
  const dataStatus = cleanChoice(payload.data_status || "unavailable", STRATEGY_HEALTH_DATA_STATUSES, `${fieldName}.data_status`);
  const candidates = dataStatus === "unavailable" ? [] : normalizeControlPlaneCandidates(payload.candidates, fieldName);
  const errors = normalizeStrategyHealthErrors(payload.errors);
  return {
    schema_version: "qsl_control_plane_dashboard.v1",
    generated_at: normalizeStrategyHealthTimestamp(payload.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(payload.computed_at, `${fieldName}.computed_at`, true),
    data_status: dataStatus,
    summary: normalizeControlPlaneSummary(candidates),
    attention: normalizeControlPlaneAttention({ dataStatus, candidates, errors }),
    candidates,
    policy: normalizeControlPlanePolicy(payload.policy, fieldName),
    errors,
  };
}

function normalizeControlPlaneSourceSnapshot(payload, fieldName = "control plane source snapshot") {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  if (payload.schema_version !== CONTROL_PLANE_SOURCE_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  for (const required of ["source_id", "generated_at", "computed_at", "data_status", "candidates", "errors"]) {
    if (!(required in payload)) throw new Error(`${fieldName}.${required} is required`);
  }
  const dataStatus = cleanChoice(payload.data_status || "unavailable", STRATEGY_HEALTH_DATA_STATUSES, `${fieldName}.data_status`);
  return {
    schema_version: CONTROL_PLANE_SOURCE_SCHEMA_VERSION,
    source_id: normalizeControlPlaneIdentifier(payload.source_id, `${fieldName}.source_id`, false),
    generated_at: normalizeStrategyHealthTimestamp(payload.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(payload.computed_at, `${fieldName}.computed_at`, true),
    data_status: dataStatus,
    candidates: dataStatus === "unavailable" ? [] : normalizeControlPlaneCandidates(payload.candidates, fieldName),
    errors: normalizeStrategyHealthErrors(payload.errors),
  };
}

function emptyControlPlaneSourceSnapshot(errorCode) {
  return {
    schema_version: CONTROL_PLANE_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    candidates: [],
    errors: [errorCode],
  };
}

function requireDedicatedM0ResearchSyncToken(request, env) {
  const expected = String(env.M0_RESEARCH_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("M0 research sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("M0 research sync token is invalid", 401);
}

async function normalizeM0ResearchLedgerTransport(payload, fieldName = "M0 research ledger transport") {
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

async function normalizeM0ResearchLedgerStorageRecord(payload, fieldName) {
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

function normalizeM0ResearchLedger(payload, fieldName) {
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

function normalizeM0ResearchLedgerSummary(value, fieldName) {
  const summary = assertExactFields(value, M0_RESEARCH_SUMMARY_FIELDS, fieldName);
  const result = {};
  for (const key of M0_RESEARCH_SUMMARY_FIELDS) {
    result[key] = normalizeM0ResearchCount(summary[key], `${fieldName}.${key}`);
  }
  return result;
}

function m0ResearchSummariesEqual(left, right) {
  return M0_RESEARCH_SUMMARY_FIELDS.every((field) => left[field] === right[field]);
}

function normalizeM0ResearchLedgerPolicy(value, fieldName) {
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

function normalizeM0ResearchSubject(value, fieldName, ledgerComputedAt) {
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

function normalizeM0ResearchObservation(value, fieldName, ledgerComputedAt) {
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

function normalizeM0ResearchContext(value, fieldName) {
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

function normalizeM0ResearchFreshness(value, fieldName, generatedMillis, expiresMillis, ledgerComputedMillis) {
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

function calculateM0ResearchHorizonViews(observations) {
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

function projectM0ResearchDashboardForRead(ledger, sourceLedgerSha256, now = new Date()) {
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

function projectM0ResearchObservationFreshness(observation, nowMillis) {
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

function normalizeM0ResearchHorizonView(value, fieldName, allowedStatuses, expected) {
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

function summarizeM0ResearchSubjects(subjects) {
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

function normalizeM0ResearchErrorCodes(value, fieldName) {
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

function normalizeM0ResearchRepository(value, fieldName, allowedRepository) {
  const repository = normalizeResearchTaskRepository(value, fieldName);
  if (repository !== allowedRepository) throw new Error(`${fieldName} is not an approved M0 repository`);
  return repository;
}

function normalizeM0ResearchRevision(value, fieldName) {
  return normalizeResearchTaskRevision(value, fieldName);
}

function normalizeM0ResearchProducer(value, fieldName) {
  const producer = assertExactFields(value, ["repository", "revision"], fieldName);
  return {
    repository: normalizeM0ResearchRepository(
      producer.repository, `${fieldName}.repository`, M0_RESEARCH_ALLOWED_PRODUCER_REPOSITORY,
    ),
    revision: normalizeM0ResearchRevision(producer.revision, `${fieldName}.revision`),
  };
}

function normalizeM0ResearchSourceArtifact(value, fieldName) {
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

function normalizeM0ResearchArtifactId(value, fieldName) {
  // Keep this exactly aligned with #309's generic identifier schema.  Artifact
  // IDs are provenance labels, not strategy slugs, so uppercase and `:/` are
  // valid when they satisfy the closed source-artifact contract.
  return normalizeM0ResearchIdentifier(value, fieldName);
}

function normalizeM0ResearchIdentifier(value, fieldName) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:/-]{1,128}$/.test(value)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
}

function normalizeM0ResearchTimestamp(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} must be a UTC timestamp`);
  }
  if (new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error(`${fieldName} must be a real UTC timestamp`);
  }
  return value;
}

function normalizeM0ResearchDate(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${fieldName} must be an ISO date`);
  }
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${fieldName} must be a real ISO date`);
  }
  return value;
}

function normalizeM0ResearchCount(value, fieldName, maximum = 50000) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${fieldName} is invalid`);
  return value;
}

function normalizeM0ResearchText(value, fieldName, maximum) {
  if (typeof value !== "string" || !value || value.length > maximum || /[<>\\\u0000-\u001f]/.test(value)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
}

function assertM0ResearchUnique(values, fieldName) {
  if (new Set(values).size !== values.length) throw new Error(`${fieldName} contains duplicates`);
}

function assertM0ResearchSortedUnique(values, key, fieldName) {
  let previous = null;
  for (const value of values) {
    const current = key(value);
    if (previous !== null && current <= previous) throw new Error(`${fieldName} must be sorted and unique`);
    previous = current;
  }
}

function canonicalM0ResearchLedgerJson(value) {
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

async function calculateM0ResearchLedgerSha256(ledger) {
  const raw = new TextEncoder().encode(canonicalM0ResearchLedgerJson(ledger));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function emptyM0ResearchDashboardPayload(errorCode, now = new Date()) {
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

async function normalizeAdaptiveSelectionSourceSnapshot(payload, fieldName = "adaptive selection source snapshot") {
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

async function normalizeAdaptiveSelectionDecision(payload, fieldName) {
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

function normalizeAdaptiveSelectionMarketContext(value, fieldName) {
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

function normalizeAdaptiveSelectionCandidate(value, fieldName) {
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

function normalizeAdaptiveSelectionReleaseDigest(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._:=+-]{1,160}$/.test(text) || /(token|secret|password|cookie|private|api[_-]?key)/i.test(text)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return text;
}

function normalizeAdaptiveSelectionDigest(value, fieldName) {
  const text = String(value || "");
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${fieldName} is invalid`);
  return text;
}

function isAdaptiveSelectionFloatPath(path) {
  if (path[0] === "market_context") {
    return path[1] === "regime_confidence" || path[1] === "factors";
  }
  return path[0] === "candidates"
    && ["score", "risk_multiplier", "proposed_weight"].includes(path[2]);
}

function canonicalAdaptiveSelectionNumber(value, forceFloat) {
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

function canonicalAdaptiveSelectionDecisionJson(value, path = []) {
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

async function calculateAdaptiveSelectionDecisionDigest(payload) {
  const material = { ...payload };
  delete material.decision_digest;
  const raw = new TextEncoder().encode(canonicalAdaptiveSelectionDecisionJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeAdaptiveSelectionSummary(selections) {
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

function emptyAdaptiveSelectionSourceSnapshot(errorCode) {
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

function emptyAdaptiveSelectionPayload(errorCode) {
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

function adaptiveSelectionStaleTtlSeconds(env) {
  const configured = Number(env.ADAPTIVE_SELECTION_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 604800) {
    return ADAPTIVE_SELECTION_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}

function normalizeControlPlaneCandidates(value, fieldName) {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new Error(`${fieldName}.candidates must be an array with at most 1000 items`);
  }
  const seen = new Set();
  return value.map((item, index) => {
    const prefix = `${fieldName}.candidates[${index}]`;
    if (!item || Array.isArray(item) || typeof item !== "object") throw new Error(`${prefix} must be an object`);
    const candidateId = normalizeControlPlaneIdentifier(item.candidate_id, `${prefix}.candidate_id`, false);
    if (seen.has(candidateId)) throw new Error(`${fieldName}.candidates contains duplicate candidate_id`);
    seen.add(candidateId);
    const lifecycle = normalizeControlPlaneLifecycle(item.lifecycle, prefix);
    const recommendation = normalizeControlPlaneRecommendation(item.recommendation, prefix);
    const isOwnerDecision = lifecycle.stage === "P6";
    if (isOwnerDecision && (lifecycle.status !== "owner_decision_required" || recommendation.code !== "owner_live_decision")) {
      throw new Error(`${prefix} P6 must be an owner_live_decision`);
    }
    if (!isOwnerDecision && (lifecycle.status === "owner_decision_required" || recommendation.code === "owner_live_decision")) {
      throw new Error(`${prefix} only P6 can require an owner_live_decision`);
    }
    return {
      candidate_id: candidateId,
      candidate_kind: cleanChoice(item.candidate_kind, CONTROL_PLANE_CANDIDATE_KINDS, `${prefix}.candidate_kind`),
      domain: cleanChoice(item.domain, STRATEGY_HEALTH_DOMAINS, `${prefix}.domain`),
      lifecycle,
      evidence: normalizeControlPlaneEvidence(item.evidence, prefix),
      recommendation,
      freshness: normalizeStrategyHealthFreshness(item.freshness, `${prefix}.freshness`),
    };
  });
}

function normalizeControlPlaneIdentifier(value, fieldName, nullable = true) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._=-]{1,128}$/.test(text)) throw new Error(`${fieldName} is invalid`);
  if (/(token|secret|password|cookie|private|api[_-]?key)/i.test(text)) throw new Error(`${fieldName} is sensitive`);
  return text;
}

function normalizeControlPlaneLifecycle(value, prefix) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    stage: cleanChoice(source.stage, CONTROL_PLANE_STAGES, `${prefix}.lifecycle.stage`),
    status: cleanChoice(source.status, CONTROL_PLANE_LIFECYCLE_STATUSES, `${prefix}.lifecycle.status`),
  };
}

function normalizeControlPlaneEvidence(value, prefix) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    p1_input_digest: normalizeControlPlaneIdentifier(source.p1_input_digest, `${prefix}.evidence.p1_input_digest`),
    p2_config_digest: normalizeControlPlaneIdentifier(source.p2_config_digest, `${prefix}.evidence.p2_config_digest`),
    p3_evidence_id: normalizeControlPlaneIdentifier(source.p3_evidence_id, `${prefix}.evidence.p3_evidence_id`),
    source_revision: normalizeControlPlaneIdentifier(source.source_revision, `${prefix}.evidence.source_revision`),
  };
}

function normalizeControlPlaneRecommendation(value, prefix) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    code: cleanChoice(source.code || "none", CONTROL_PLANE_RECOMMENDATIONS, `${prefix}.recommendation.code`),
    reason: sanitizeStrategyHealthText(source.reason, `${prefix}.recommendation.reason`, 240, false, "没有可用的机器建议。"),
  };
}

function normalizeControlPlaneSummary(candidates) {
  return {
    candidate_count: candidates.length,
    deferred: candidates.filter((item) => item.lifecycle.status === "deferred").length,
    parked: candidates.filter((item) => item.lifecycle.status === "parked").length,
    owner_decision_required: candidates.filter((item) => item.lifecycle.status === "owner_decision_required").length,
  };
}

function normalizeControlPlaneAttention({ dataStatus, candidates, errors }) {
  const normalizedCandidates = Array.isArray(candidates) ? candidates : [];
  const normalizedErrors = uniqueStrings(Array.isArray(errors) ? errors : []);
  const reasonCodes = new Set(normalizedErrors);
  if (dataStatus !== "ready") reasonCodes.add("control_plane_source_unavailable");
  if (!normalizedCandidates.length && dataStatus === "ready") reasonCodes.add("control_plane_candidate_missing");
  if (normalizedCandidates.some((item) => item.lifecycle?.status === "deferred")) {
    reasonCodes.add("control_plane_candidate_deferred");
  }
  if (normalizedCandidates.some((item) => item.lifecycle?.status === "parked")) {
    reasonCodes.add("control_plane_candidate_parked");
  }
  const status = dataStatus !== "ready"
    ? "unavailable"
    : (reasonCodes.size ? "attention_required" : "research_only");
  return {
    status: cleanChoice(status, CONTROL_PLANE_ATTENTION_STATUSES, "control plane attention status"),
    reason_codes: [...reasonCodes].sort(),
  };
}

function normalizeControlPlanePolicy(value, fieldName) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (source.p6_owner_decision_required !== true) {
    throw new Error(`${fieldName}.policy.p6_owner_decision_required must be true`);
  }
  return {
    p4_p5_automation: cleanChoice(
      source.p4_p5_automation || "not_configured",
      CONTROL_PLANE_AUTOMATION_STATES,
      `${fieldName}.policy.p4_p5_automation`,
    ),
    p6_owner_decision_required: true,
    notice: sanitizeStrategyHealthText(source.notice, `${fieldName}.policy.notice`, 240, false, "live 仍需所有者明确决定。"),
  };
}

function normalizeExecutionEvidenceSourceSnapshot(payload, fieldName = "execution evidence source snapshot") {
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

function normalizeExecutionEvidenceDeployment(value, fieldName) {
  const item = assertExactFields(value, [
    "deployment_id", "strategy", "target", "capabilities", "evidence", "recommendation",
  ], fieldName);
  const strategy = assertExactFields(item.strategy, [
    "candidate_id", "candidate_kind", "domain", "strategy_revision",
  ], `${fieldName}.strategy`);
  const target = assertExactFields(item.target, ["platform", "environment"], `${fieldName}.target`);
  const capabilities = assertExactFields(item.capabilities, ["shadow", "paper"], `${fieldName}.capabilities`);
  const evidence = assertExactFields(item.evidence, [
    "strategy", "target_data", "target_execution",
  ], `${fieldName}.evidence`);
  const recommendation = assertExactFields(item.recommendation, ["code", "reason_code"], `${fieldName}.recommendation`);
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
  return normalized;
}

function normalizeRuntimeTargetLifecycleSourceSnapshot(payload, fieldName = "runtime target lifecycle source snapshot") {
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

function normalizeRuntimeTargetLifecycleTarget(value, fieldName) {
  const item = assertExactFields(value, ["target_id", "target", "monitoring", "disposition", "no_order"], fieldName);
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

function normalizeExecutionEvidenceSummary(deployments) {
  return {
    deployment_count: deployments.length,
    autonomous_shadow: deployments.filter((item) => item.recommendation.code === "continue_autonomous_shadow").length,
    autonomous_paper: deployments.filter((item) => item.recommendation.code === "run_autonomous_paper").length,
    owner_canary_decision: deployments.filter((item) => item.recommendation.code === "owner_limited_live_canary_decision").length,
    parked: deployments.filter((item) => item.recommendation.code === "parked").length,
  };
}

function emptyExecutionEvidenceSourceSnapshot(errorCode) {
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

function emptyRuntimeTargetLifecycleSourceSnapshot(errorCode) {
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

function emptyRuntimeTargetLifecyclePayload(errorCode) {
  return {
    schema_version: RUNTIME_TARGET_LIFECYCLE_DASHBOARD_SCHEMA_VERSION,
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { target_count: 0, enabled: 0, disabled: 0, attention: 0 },
    targets: [],
    policy: {
      lifecycle_status_read_only: true,
      no_order: true,
      notice: "运行目标生命周期快照尚不可用；页面不会推断目标已启用。",
    },
    errors: [errorCode],
  };
}

function emptyExecutionEvidencePayload(errorCode) {
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

function executionEvidenceStaleTtlSeconds(env) {
  const configured = Number(env.EXECUTION_EVIDENCE_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 604800) {
    return EXECUTION_EVIDENCE_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}

function emptyControlPlanePayload(errorCode) {
  return {
    schema_version: "qsl_control_plane_dashboard.v1",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { candidate_count: 0, deferred: 0, parked: 0, owner_decision_required: 0 },
    attention: { status: "unavailable", reason_codes: ["control_plane_source_unavailable", errorCode] },
    candidates: [],
    policy: { p4_p5_automation: "not_configured", p6_owner_decision_required: true, notice: "live 仍需所有者明确决定。" },
    errors: [errorCode],
  };
}

function controlPlaneStaleTtlSeconds(env) {
  const configured = Number(env.CONTROL_PLANE_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 604800) {
    return CONTROL_PLANE_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}

async function syncStrategyProfilesConfig(env, session) {
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

function updateAccountOptionsDefaultStrategy(accountOptions, inputs) {
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

function normalizeSwitchInputs(raw) {
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
  const optionOverlayMode = cleanChoice(raw.option_overlay_mode || "enabled", OPTION_OVERLAY_MODES, "option_overlay_mode");
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

function normalizeLiveContinuityInputs(raw, executionMode) {
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

function assertSwitchIntent(inputs) {
  if (
    inputs.apply !== "true" ||
    inputs.trigger_platform_sync !== "true" ||
    inputs.confirm_apply !== "APPLY_AND_SYNC"
  ) {
    throw new Error("switch endpoint requires apply=true and APPLY_AND_SYNC");
  }
}

function assertConfiguredAccount(inputs, accountOptions) {
  if (!accountOptions) throw new Error("account options are not configured");
  const matched = configuredAccountForInputs(inputs, accountOptions);
  if (!matched) throw new Error("switch inputs do not match configured account options");
  return matched;
}

function configuredAccountForInputs(inputs, accountOptions) {
  if (!accountOptions) return null;
  const options = accountOptions[inputs.platform] || [];
  return options.find((option) => accountOptionMatchesInputs(option, inputs)) || null;
}

function registerLegacyContinuityAccount(env, accountOptions, inputs, strategy) {
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

function assertStrategyAllowedForAccount(inputs, accountOption, strategyProfiles) {
  const strategy = strategyProfiles.find((item) => item.profile === inputs.strategy_profile);
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
  if (executionMode === "live") {
    if (isEligibleLegacyContinuityInput(inputs, strategy)) {
      assertDcaPlatform(inputs.platform, inputs.strategy_profile);
      return;
    }
    const lifecycleStage = cleanLifecycleStage(strategy.lifecycle_stage || "research_active");
    if (
      strategy.runtime_enabled !== true ||
      strategy.can_switch_live !== true ||
      !["live_enabled", "runtime_enabled"].includes(lifecycleStage)
    ) {
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

function isEligibleLegacyContinuityInput(inputs, strategy) {
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

function resolvedVariableScope(value, inputs) {
  const text = String(value || "").trim();
  if (!text || text === "default") return defaultInputValue("variable_scope", inputs);
  return text;
}

function accountOptionMatchesInputs(option, inputs) {
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

function defaultInputValue(field, inputs) {
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

function parseAccountOptions(raw, fieldName = "account options") {
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

function normalizeAccountOptionsInput(value, fieldName) {
  if (typeof value === "string") return parseAccountOptions(value, fieldName) || {};
  return normalizeAccountOptionsPayload(value, fieldName);
}

function parseStrategyProfiles(raw, fieldName = "strategy profiles") {
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

function normalizeStrategyProfilesPayload(payload, fieldName = "strategy profiles") {
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
    entry.domain = cleanStrategyDomain(item.domain || "us_equity", `${fieldName}[${index}].domain`);
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

function normalizeLiveContinuityPolicy(value, fieldName) {
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

function rejectResearchOnlyExtraVariables(extraVariables) {
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

function incomeLayerConfigFromProfileItem(item, fieldName) {
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

function optionOverlayConfigFromProfileItem(item, fieldName) {
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

function addOptionalOptionFamilyConfig(target, item, family, fieldName) {
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

function cleanIncomeLayerAllocations(value, fieldName) {
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

function cleanProfileBoolean(value) {
  if (value === true || value === "true" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  throw new Error("runtime_enabled must be boolean");
}

function normalizeAccountOptionsPayload(payload, fieldName = "account options") {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }

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

function cleanAccountOption(item, platform, index) {
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

function shouldInferSupportedDomains(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === "";
}

function supportedDomainsForAccount(platform, option) {
  if (Array.isArray(option?.supported_domains) && option.supported_domains.length) {
    return normalizeSupportedDomains(option.supported_domains, "supported_domains");
  }
  return inferAccountSupportedDomains(platform, option || {});
}

function inferAccountSupportedDomains(platform, option) {
  void option;
  if (platform === "qmt") return ["cn_equity"];
  if (platform === "longbridge" || platform === "ibkr") return ["us_equity", "hk_equity"];
  return ["us_equity"];
}

function platformRepositories(env) {
  const repositories = { ...DEFAULT_PLATFORM_REPOSITORIES };
  const rawJson = String(
    env.STRATEGY_SWITCH_PLATFORM_REPOSITORIES_JSON ||
      env.RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON ||
      "",
  ).trim();
  if (rawJson) {
    let payload;
    try {
      payload = JSON.parse(rawJson);
    } catch (error) {
      throw new Error("platform repositories JSON must be valid JSON");
    }
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
      throw new Error("platform repositories JSON must be an object");
    }
    for (const [platform, repository] of Object.entries(payload)) {
      if (!SUPPORTED_PLATFORMS.includes(platform)) {
        throw new Error(`unsupported platform repository override: ${platform}`);
      }
      repositories[platform] = cleanRepositoryName(repository, `${platform} repository`);
    }
  }

  for (const platform of SUPPORTED_PLATFORMS) {
    for (const name of PLATFORM_REPOSITORY_ENV[platform] || []) {
      const repository = String(env[name] || "").trim();
      if (repository) repositories[platform] = cleanRepositoryName(repository, name);
    }
  }
  return repositories;
}

function normalizeSupportedDomains(value, fieldName) {
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

function cleanStrategyDomain(value, fieldName) {
  return cleanChoice(value, SUPPORTED_STRATEGY_DOMAINS, fieldName);
}

function cleanCashCurrency(value, fieldName) {
  return cleanChoice(String(value || "").trim().toUpperCase(), ["USD", "HKD", "CNY"], fieldName);
}

function addConfigOptional(target, key, value, cleaner) {
  if (value === undefined || value === null || String(value).trim() === "") return;
  target[key] = cleaner(value, key);
}

function addOptional(target, key, value, cleaner) {
  if (value === undefined || value === null || String(value).trim() === "") return;
  target[key] = cleaner(value, key);
}

function cleanChoice(value, allowed, field) {
  const text = String(value || "").trim();
  if (!allowed.includes(text)) throw new Error(`${field} is invalid`);
  return text;
}

function isDcaProfile(profile) {
  return Boolean(DCA_PROFILE_CONFIG[cleanCurrentStrategy(profile)]);
}

function assertDcaPlatform(platform, strategyProfile) {
  if (isDcaProfile(strategyProfile) && !DCA_SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(
      `DCA strategy profiles are not supported on ${platform}; got strategy_profile=${strategyProfile}`,
    );
  }
}

function cleanDcaMode(value, field = "dca_mode") {
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

function cleanBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false" || value === "" || value === undefined || value === null) return false;
  throw new Error("boolean input is invalid");
}

function cleanRatio(value, field) {
  const text = cleanNumberText(value, field);
  const numeric = Number(text);
  if (numeric < 0 || numeric > 1) throw new Error(`${field} must be between 0 and 1`);
  return text;
}

function cleanNonNegativeNumber(value, field) {
  const text = cleanNumberText(value, field);
  if (Number(text) < 0) throw new Error(`${field} must be non-negative`);
  return text;
}

function cleanPositiveNumber(value, field) {
  const text = cleanNumberText(value, field);
  if (Number(text) <= 0) throw new Error(`${field} must be greater than 0`);
  return text;
}

function cleanNumberText(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 32 || !/^(?:\d+|\d*\.\d+)$/.test(text)) {
    throw new Error(`${field} must be a finite decimal number`);
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) throw new Error(`${field} must be finite`);
  return text;
}

function cleanSlug(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 120 || !/^[A-Za-z0-9._=-]+$/.test(text)) {
    throw new Error(`${field} must use letters, numbers, dot, underscore, dash, or equals`);
  }
  return text;
}

function cleanRepositoryName(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 160 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    throw new Error(`${field} must be owner/repo`);
  }
  return text;
}

function cleanLabel(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 80 || /[<>{}]/.test(text)) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}

function cleanLifecycleStage(value, field = "lifecycle_stage") {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text.length > 80 || !/^[a-z0-9._-]+$/.test(text)) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}

function canonicalLifecycleStage(value, deployment = {}) {
  const stage = cleanLifecycleStage(value);
  if (["research_active", "shadow_active", "paper_active", "live_candidate", "live_enabled"].includes(stage)) {
    return stage;
  }
  if (["research", "research_backtest_only", "ai_monitored_candidate"].includes(stage)) return "research_active";
  if (stage === "shadow_candidate") return "shadow_active";
  if (stage === "runtime_enabled") {
    const explicitlyLive = deployment.runtimeEnabled === true
      && deployment.canSwitchLive === true
      && deployment.allowedExecutionModes?.includes("live");
    return explicitlyLive ? "live_enabled" : "live_candidate";
  }
  throw new Error(`lifecycle_stage ${stage} is unsupported`);
}

function cleanAllowedExecutionModes(value) {
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

function cleanExecutionMode(value) {
  const mode = cleanChoice(value || "live", ["live", "paper", "dry_run"], "execution_mode");
  return mode === "paper" ? "dry_run" : mode;
}

function supportedExecutionModesForPlatform(platform) {
  const modes = PLATFORM_CONFIG[platform]?.supported_execution_modes;
  if (!Array.isArray(modes)) return [];
  return modes.filter((mode) => mode === "live" || mode === "dry_run");
}

function requireSameOrigin(request, options = {}) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    if (options.requireOrigin) throw new HttpError("Origin header is required", 403);
    return;
  }
  if (origin !== new URL(request.url).origin) throw new HttpError("cross-origin request rejected", 403);
}

async function fetchGithubVariable(token, repository, scope, githubEnvironment, name) {
  const apiUrl = githubVariableUrl(repository, scope, githubEnvironment, name);
  if (!apiUrl) return "";
  try {
    const response = await fetchWithTimeout(apiUrl, {
      headers: githubHeaders(token),
    });
    if (response.status === 404 || response.status === 403) return "";
    if (!response.ok) return "";
    const payload = await response.json();
    return String(payload?.value || "");
  } catch {
    return "";
  }
}


function githubVariableUrl(repository, scope, githubEnvironment, name) {
  const [owner, repo] = String(repository || "").split("/");
  if (!owner || !repo) return "";
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const variableName = encodeURIComponent(name);
  if (scope === "environment") {
    if (!githubEnvironment) return "";
    return `${base}/environments/${encodeURIComponent(githubEnvironment)}/variables/${variableName}`;
  }
  return `${base}/actions/variables/${variableName}`;
}

function resolveVariableScope(platform, option) {
  const configured = String(option?.variable_scope || "").trim();
  if (configured && configured !== "default") return configured;
  return DEFAULT_VARIABLE_SCOPE[platform] || "repository";
}

function resolveGithubEnvironment(platform, option, variableScope) {
  if (variableScope !== "environment") return "";
  const configured = String(option?.github_environment || "").trim();
  if (configured) return configured;
  const targetName = String(option?.target_name || option?.key || "").trim();
  if (!targetName) return "";
  if (platform === "longbridge") return `longbridge-${targetName.toLowerCase()}`;
  return targetName;
}

function runtimeTargetFromServiceTargets(rawValue, platform, option) {
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
    matches.push({
      ...runtimeTarget,
      strategy_profile: runtimeTarget.strategy_profile || entry.strategy_profile,
      ...reservedCashPayloadFromObject(platform, entry),
      ...incomeLayerPayloadFromObject(entry),
      ...optionOverlayPayloadFromObject(entry),
      ...runtimeTargetEnabledPayloadFromObject(entry),
      ...dcaPayloadFromObject(entry),
      ...cashOnlyPayloadFromObject(platform, entry),
    });
  }
  return matches.length === 1 ? matches[0] : null;
}

async function readCashOnlyVariables({ platform, repository, variableScope, githubEnvironment, readVariable }) {
  const platformVariable = PLATFORM_CASH_ONLY_EXECUTION_VARIABLES[platform];
  const [platformValue, legacyValue] = await Promise.all([
    readVariable(repository, variableScope, githubEnvironment, platformVariable),
    readVariable(repository, variableScope, githubEnvironment, LEGACY_CASH_ONLY_EXECUTION_VARIABLE),
  ]);
  return cashOnlyPayloadFromValues(platformValue ?? legacyValue);
}

function cashOnlyPayloadFromObject(platform, payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return cashOnlyPayloadFromValues(
    payload[PLATFORM_CASH_ONLY_EXECUTION_VARIABLES[platform]] ??
      payload[LEGACY_CASH_ONLY_EXECUTION_VARIABLE] ??
      payload.cash_only_execution,
  );
}

function cashOnlyPayloadFromValues(value) {
  const enabled = cleanOptionalBoolean(value);
  if (enabled === null) return {};
  return { cash_only_execution: enabled };
}

async function readReservedCashVariables({ platform, repository, variableScope, githubEnvironment, readVariable }) {
  const [floorValue, ratioValue] = await Promise.all([
    readVariable(repository, variableScope, githubEnvironment, PLATFORM_MIN_RESERVED_CASH_VARIABLES[platform]),
    readVariable(repository, variableScope, githubEnvironment, PLATFORM_RESERVED_CASH_RATIO_VARIABLES[platform]),
  ]);
  return reservedCashPayloadFromValues(floorValue, ratioValue);
}

async function readIncomeLayerVariables({ repository, variableScope, githubEnvironment, readVariable }) {
  const [enabledValue, startUsdValue, maxRatioValue] = await Promise.all([
    readVariable(repository, variableScope, githubEnvironment, INCOME_LAYER_ENABLED_VARIABLE),
    readVariable(repository, variableScope, githubEnvironment, INCOME_LAYER_START_USD_VARIABLE),
    readVariable(repository, variableScope, githubEnvironment, INCOME_LAYER_MAX_RATIO_VARIABLE),
  ]);
  return incomeLayerPayloadFromValues(enabledValue, startUsdValue, maxRatioValue);
}

async function readOptionOverlayVariables({ repository, variableScope, githubEnvironment, readVariable }) {
  const enabledValue = await readVariable(repository, variableScope, githubEnvironment, OPTION_OVERLAY_ENABLED_VARIABLE);
  return optionOverlayPayloadFromValue(enabledValue);
}

async function readRuntimeTargetEnabledVariable({ repository, variableScope, githubEnvironment, readVariable }) {
  const value = await readVariable(repository, variableScope, githubEnvironment, RUNTIME_TARGET_ENABLED_VARIABLE);
  return runtimeTargetEnabledPayloadFromValue(value);
}

async function readDcaVariables({ repository, variableScope, githubEnvironment, readVariable }) {
  const [modeValue, baseInvestmentValue] = await Promise.all([
    readVariable(repository, variableScope, githubEnvironment, DCA_MODE_VARIABLE),
    readVariable(repository, variableScope, githubEnvironment, DCA_BASE_INVESTMENT_VARIABLE),
  ]);
  return dcaPayloadFromValues(modeValue, baseInvestmentValue);
}

function reservedCashPayloadFromObject(platform, payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return reservedCashPayloadFromValues(
    payload[PLATFORM_MIN_RESERVED_CASH_VARIABLES[platform]] ??
      payload.min_reserved_cash_usd ??
      payload.reserved_cash_floor_usd,
    payload[PLATFORM_RESERVED_CASH_RATIO_VARIABLES[platform]] ??
      payload.reserved_cash_ratio,
  );
}

function reservedCashPayloadFromValues(floorValue, ratioValue) {
  const result = {};
  const floor = cleanCurrentNonNegativeNumber(floorValue);
  const ratio = cleanCurrentRatio(ratioValue);
  if (floor) result.min_reserved_cash_usd = floor;
  if (ratio) result.reserved_cash_ratio = ratio;
  return result;
}

function incomeLayerPayloadFromObject(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return incomeLayerPayloadFromValues(
    payload[INCOME_LAYER_ENABLED_VARIABLE] ?? payload.income_layer_enabled,
    payload[INCOME_LAYER_START_USD_VARIABLE] ?? payload.income_layer_start_usd,
    payload[INCOME_LAYER_MAX_RATIO_VARIABLE] ?? payload.income_layer_max_ratio,
  );
}

function incomeLayerPayloadFromValues(enabledValue, startUsdValue, maxRatioValue) {
  const result = {};
  const enabled = cleanOptionalBoolean(enabledValue);
  const startUsd = cleanCurrentNonNegativeNumber(startUsdValue);
  const maxRatio = cleanCurrentRatio(maxRatioValue);
  if (enabled !== null) result.income_layer_enabled = enabled;
  if (startUsd) result.income_layer_start_usd = startUsd;
  if (maxRatio) result.income_layer_max_ratio = maxRatio;
  return result;
}

function optionOverlayPayloadFromObject(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return optionOverlayPayloadFromValue(
    payload[OPTION_OVERLAY_ENABLED_VARIABLE] ?? payload.option_overlay_enabled,
  );
}

function optionOverlayPayloadFromValue(value) {
  const enabled = cleanOptionalBoolean(value);
  return enabled === null ? {} : { option_overlay_enabled: enabled };
}

function runtimeTargetEnabledPayloadFromObject(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return runtimeTargetEnabledPayloadFromValue(
    payload[RUNTIME_TARGET_ENABLED_VARIABLE] ?? payload.runtime_target_enabled,
  );
}

function runtimeTargetEnabledPayloadFromValue(value) {
  const enabled = cleanOptionalBoolean(value);
  return enabled === null ? {} : { runtime_target_enabled: enabled };
}

function dcaPayloadFromObject(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return dcaPayloadFromValues(
    payload[DCA_MODE_VARIABLE] ?? payload.dca_mode,
    payload[DCA_BASE_INVESTMENT_VARIABLE] ??
      payload.dca_base_investment_usd ??
      payload.base_investment_usd,
  );
}

function stripLegacyIbitZscoreExitControls(payload) {
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

function dcaPayloadFromValues(modeValue, baseInvestmentValue) {
  const result = {};
  const mode = cleanCurrentDcaMode(modeValue);
  const baseInvestmentUsd = cleanCurrentPositiveNumber(baseInvestmentValue);
  if (mode) result.dca_mode = mode;
  if (baseInvestmentUsd) result.dca_base_investment_usd = baseInvestmentUsd;
  return result;
}

function dcaControlsFromInputs(inputs) {
  const payload = inputs?.extra_variables_json ? JSON.parse(inputs.extra_variables_json) : {};
  return {
    ...dcaPayloadFromObject(payload),
    ...dcaPayloadFromObject(inputs),
  };
}

function cashOnlyExecutionModeFromInputs(inputs) {
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

function dcaPayloadForProfile(profile, payload) {
  return isDcaProfile(profile) ? payload : {};
}

function runtimeModePayload(runtimeTarget) {
  const executionMode = normalizeRuntimeExecutionMode(runtimeTarget?.execution_mode, runtimeTarget?.dry_run_only);
  const payload = {};
  if (executionMode) payload.execution_mode = executionMode;
  const dryRunOnly = cleanOptionalBoolean(runtimeTarget?.dry_run_only);
  if (dryRunOnly !== null) payload.dry_run_only = dryRunOnly;
  return payload;
}

function normalizeRuntimeExecutionMode(value, dryRunOnly) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "live" || mode === "dry_run") return mode;
  if (mode === "paper" && cleanOptionalBoolean(dryRunOnly) !== true) return mode;
  const dryRun = cleanOptionalBoolean(dryRunOnly);
  if (dryRun === true) return "dry_run";
  if (dryRun === false) return "live";
  return "";
}

function cleanOptionalBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1") return true;
    if (text === "false" || text === "0") return false;
  }
  return null;
}

function cleanCurrentNonNegativeNumber(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 32 || !/^(?:\d+|\d*\.\d+)$/.test(text)) return "";
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return "";
  return text;
}

function cleanCurrentRatio(value) {
  const text = cleanCurrentNonNegativeNumber(value);
  if (!text) return "";
  const numeric = Number(text);
  if (numeric < 0 || numeric > 1) return "";
  return text;
}

function cleanCurrentPositiveNumber(value) {
  const text = cleanCurrentNonNegativeNumber(value);
  if (!text || Number(text) <= 0) return "";
  return text;
}

function cleanCurrentDcaMode(value) {
  try {
    return cleanDcaMode(value || "");
  } catch {
    return "";
  }
}

function runtimeTargetMatchesAccount(runtimeTarget, platform, option, entry = {}) {
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

function defaultCurrentServiceName(platform, targetName) {
  const normalized = String(targetName || "").trim().toLowerCase();
  if (!normalized) return "";
  if (platform === "longbridge") return `longbridge-quant-${normalized}-service`;
  if (platform === "ibkr") return `interactive-brokers-${normalized}-service`;
  if (platform === "schwab") return "charles-schwab-quant-service";
  if (platform === "firstrade") return "firstrade-quant-service";
  if (platform === "qmt") return "qmt-quant-service";
  return "";
}

function hasCandidate(expected, candidates) {
  const normalizedExpected = normalizeMatchValue(expected);
  if (!normalizedExpected) return false;
  return candidates.some((candidate) => normalizeMatchValue(candidate) === normalizedExpected);
}

function splitSelectorValues(value) {
  if (Array.isArray(value)) return value.map(normalizeMatchValue).filter(Boolean);
  return String(value || "")
    .split(/[,\s]+/)
    .map(normalizeMatchValue)
    .filter(Boolean);
}

function normalizeMatchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function parseJsonObject(value) {
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

function parseJsonValue(value) {
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

function cleanCurrentStrategy(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text.length > 120 || !/^[a-z0-9._=-]+$/.test(text)) return "";
  return text;
}

function cleanCsv(value, field) {
  const text = String(value || "").trim();
  if (text.length > 300 || !/^[A-Za-z0-9._=,\-\s]+$/.test(text)) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}

function cleanJson(value, field) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length > 8000) throw new Error(`${field} is too long`);
  JSON.parse(text);
  return text;
}

function cleanOptionalJsonObject(value, field) {
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

function looksLikeSecretName(name) {
  const upperName = String(name || "").toUpperCase();
  if (/_SECRET_(ID|NAME|REF|RESOURCE|RESOURCE_NAME|VERSION)$/.test(upperName)) return false;
  return /PASSWORD|PRIVATE_KEY|TOKEN|API_KEY|ACCESS_KEY|CLIENT_SECRET|SECRET/.test(upperName);
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "QuantRuntimeSettings-StrategySwitchConsole",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchGithubOrgLogins(token) {
  const orgs = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetchWithTimeout(`https://api.github.com/user/orgs?per_page=100&page=${page}`, {
      headers: githubHeaders(token),
    });
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

function requireEnv(env, name) {
  if (!env[name]) throw new Error(`${name} is not configured`);
}

async function loadAuthConfig(env) {
  const bootstrapAdmins = parseLoginList(env.STRATEGY_SWITCH_ADMIN_LOGINS || "", "STRATEGY_SWITCH_ADMIN_LOGINS");
  const bootstrapAdminOrgs = parseOrgList(env.STRATEGY_SWITCH_ADMIN_ORGS || "", "STRATEGY_SWITCH_ADMIN_ORGS");
  const envAllowed = parseLoginList(
    env.ALLOWED_GITHUB_LOGINS || env.ALLOWED_GITHUB_LOGIN || "",
    "ALLOWED_GITHUB_LOGINS",
  );
  const envAllowedOrgs = parseOrgList(
    env.ALLOWED_GITHUB_ORGS || env.ALLOWED_GITHUB_ORG || "",
    "ALLOWED_GITHUB_ORGS",
  );
  let storedAllowed = [];
  let storedAllowedOrgs = [];
  let storedAdmins = [];
  let storedAdminOrgs = [];
  let source = "secret";
  if (hasConfigStore(env)) {
    const stored = await readConfigJson(env, AUTH_CONFIG_KEY);
    if (stored) {
      const normalized = normalizeAuthConfigPayload(stored, AUTH_CONFIG_KEY);
      storedAllowed = normalized.allowed_logins;
      storedAllowedOrgs = normalized.allowed_orgs;
      storedAdmins = normalized.admin_logins;
      storedAdminOrgs = normalized.admin_orgs;
      source = "kv";
    }
  }
  const adminLogins = uniqueStrings([...bootstrapAdmins, ...storedAdmins]);
  const adminOrgs = uniqueStrings([...bootstrapAdminOrgs, ...storedAdminOrgs]);
  const allowedLogins = uniqueStrings([...envAllowed, ...storedAllowed, ...adminLogins]);
  const allowedOrgs = uniqueStrings([...envAllowedOrgs, ...storedAllowedOrgs]);
  return {
    allowed_logins: allowedLogins,
    allowed_orgs: allowedOrgs,
    admin_logins: adminLogins,
    admin_orgs: adminOrgs,
    bootstrap_admin_logins: bootstrapAdmins,
    bootstrap_admin_orgs: bootstrapAdminOrgs,
    env_allowed_logins: envAllowed,
    env_allowed_orgs: envAllowedOrgs,
    source,
    kv_available: hasConfigStore(env),
  };
}

function normalizeAuthConfigPayload(payload, fieldName) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  return {
    allowed_logins: normalizeLoginList(payload.allowed_logins || [], `${fieldName}.allowed_logins`),
    allowed_orgs: normalizeOrgList(payload.allowed_orgs || [], `${fieldName}.allowed_orgs`),
    admin_logins: normalizeLoginList(payload.admin_logins || [], `${fieldName}.admin_logins`),
    admin_orgs: normalizeOrgList(payload.admin_orgs || [], `${fieldName}.admin_orgs`),
  };
}

function parseLoginList(value, fieldName) {
  return normalizeLoginList(value, fieldName);
}

function normalizeLoginList(value, fieldName) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  if (items.length > 80) throw new Error(`${fieldName} supports at most 80 logins`);
  return uniqueStrings(items.map((item) => cleanGithubLogin(item, fieldName)).filter(Boolean));
}

function parseOrgList(value, fieldName) {
  return normalizeOrgList(value, fieldName);
}

function normalizeOrgList(value, fieldName) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  if (items.length > 80) throw new Error(`${fieldName} supports at most 80 orgs`);
  return uniqueStrings(items.map((item) => cleanGithubOrg(item, fieldName)).filter(Boolean));
}

function cleanGithubLogin(value, fieldName) {
  const login = String(value || "").trim().toLowerCase();
  if (!login) return "";
  if (
    login.length > 39 ||
    !/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(login) ||
    login.includes("--")
  ) {
    throw new Error(`${fieldName} contains an invalid GitHub login`);
  }
  return login;
}

function cleanGithubOrg(value, fieldName) {
  return cleanGithubLogin(value, fieldName);
}

function isAdminLogin(login, orgLogins, authConfig) {
  return authConfig.admin_logins.includes(String(login || "").toLowerCase());
}

function isAdminPrincipal(login, orgLogins, authConfig) {
  return isAdminLogin(login, orgLogins, authConfig) || hasOrgMatch(orgLogins, authConfig.admin_orgs);
}

function isAllowedPrincipal(login, orgLogins, authConfig) {
  const normalizedLogin = String(login || "").toLowerCase();
  return (
    authConfig.allowed_logins.includes(normalizedLogin) ||
    hasOrgMatch(orgLogins, authConfig.allowed_orgs) ||
    isAdminPrincipal(normalizedLogin, orgLogins, authConfig)
  );
}

function authorizedOrgLogins(orgLogins, authConfig) {
  const authorized = new Set([...authConfig.allowed_orgs, ...authConfig.admin_orgs]);
  return uniqueStrings(orgLogins).filter((org) => authorized.has(org));
}

function hasOrgMatch(orgLogins, configuredOrgs) {
  const orgs = new Set(uniqueStrings(orgLogins));
  return configuredOrgs.some((org) => orgs.has(String(org || "").toLowerCase()));
}

async function loadAccountOptionsConfig(env) {
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

async function loadStrategyProfilesConfig(env) {
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

function riskProfileScopeId(platform, targetName) {
  return `${platform}--${targetName}`;
}

function riskProfileBindingTargets(accountOptions) {
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

function utcTimestampSeconds(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function calculateRiskProfileSelectionSha256(payload) {
  const material = { ...payload };
  delete material.selection_sha256;
  const raw = new TextEncoder().encode(canonicalResearchTaskJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function normalizeRiskProfileSelection(payload, fieldName) {
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

async function calculateRiskProfileBindingSha256(payload) {
  const material = { ...payload };
  delete material.binding_sha256;
  const raw = new TextEncoder().encode(canonicalResearchTaskJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function normalizeRiskProfileBinding(payload, fieldName) {
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

async function normalizeRiskProfileBindingRegistry(payload, fieldName = RISK_PROFILE_BINDINGS_KEY) {
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

async function buildRiskProfileBindings(payload, accountOptions, updatedBy) {
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

async function loadRiskProfileBindings(env) {
  if (!hasConfigStore(env)) return { bindings: [], error: null };
  try {
    const stored = await readConfigJson(env, RISK_PROFILE_BINDINGS_KEY);
    if (!stored) return { bindings: [], error: null };
    return {
      bindings: await normalizeRiskProfileBindingRegistry(stored),
      error: null,
    };
  } catch {
    // Do not silently default malformed owner intent.  It has no runtime
    // authority, but the next control-plane adapter must see the failure.
    return { bindings: [], error: "risk_profile_bindings_invalid" };
  }
}

function hasConfigStore(env) {
  return Boolean(configStore(env));
}

function configStore(env) {
  const store = env.STRATEGY_SWITCH_CONFIG;
  if (!store || typeof store.get !== "function" || typeof store.put !== "function") return null;
  return store;
}

async function readConfigJson(env, key) {
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

async function writeConfigJson(env, key, value) {
  const store = configStore(env);
  if (!store) throw new Error("STRATEGY_SWITCH_CONFIG KV binding is required");
  await store.put(key, JSON.stringify(value, null, 2));
}

async function loadAuditLog(env) {
  if (!hasConfigStore(env)) return [];
  const payload = await readConfigJson(env, AUDIT_LOG_KEY);
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((entry) => entry && !Array.isArray(entry) && typeof entry === "object")
    .slice(0, AUDIT_LOG_LIMIT);
}

async function appendAuditLog(env, entry) {
  if (!hasConfigStore(env)) return;
  let current = [];
  try {
    current = await loadAuditLog(env);
  } catch (error) {
    current = [];
  }
  await writeConfigJson(env, AUDIT_LOG_KEY, [entry, ...current].slice(0, AUDIT_LOG_LIMIT));
}

function accountCounts(accountOptions) {
  const counts = {};
  for (const platform of SUPPORTED_PLATFORMS) {
    counts[platform] = Array.isArray(accountOptions[platform]) ? accountOptions[platform].length : 0;
  }
  return counts;
}

function uniqueStrings(items) {
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const text = String(item || "").trim().toLowerCase();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

async function makeSession(login, orgs, env) {
  const payload = base64UrlEncodeJson({
    login,
    orgs: uniqueStrings(orgs),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  const signature = await hmac(payload, env.SESSION_SECRET);
  return `${payload}.${signature}`;
}

async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies[SESSION_COOKIE];
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".", 2);
  const expected = await hmac(payload, env.SESSION_SECRET);
  if (signature !== expected) return null;
  const session = JSON.parse(base64UrlDecode(payload));
  if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
  const login = String(session.login || "").toLowerCase();
  const orgs = normalizeOrgList(session.orgs || [], "session.orgs");
  const authConfig = await loadAuthConfig(env);
  const admin = isAdminPrincipal(login, orgs, authConfig);
  return { login, orgs, allowed: isAllowedPrincipal(login, orgs, authConfig), admin };
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

function base64UrlEncodeJson(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function parseCookies(header) {
  const result = {};
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name) continue;
    result[name] = decodeURIComponent(rest.join("="));
  }
  return result;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function clearOAuthCookie() {
  return { "Set-Cookie": clearCookie(OAUTH_STATE_COOKIE) };
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: responseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }, headers),
  });
}

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: responseHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    }, headers),
  });
}

function redirect(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: responseHeaders({ Location: location }, headers),
  });
}

function responseHeaders(base = {}, extra = {}) {
  const headers = new Headers(SECURITY_HEADERS);
  appendHeaderEntries(headers, base);
  appendHeaderEntries(headers, extra);
  return headers;
}

function appendHeaderEntries(headers, values) {
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
}

function renderMessage(title, message) {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<body style="font-family:system-ui,sans-serif;margin:40px;color:#1c211d;background:#f7f8f3">
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">返回控制台</a></p></body>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const __test = {
  assertConfiguredAccount,
  accountOptionMatchesInputs,
  resolvedVariableScope,
  currentStrategiesTimeoutMs: CURRENT_STRATEGIES_TIMEOUT_MS,
  assertStrategyAllowedForAccount,
  inferAccountSupportedDomains,
  loadCurrentStrategies,
  normalizeSwitchInputs,
  normalizeAccountOptionsPayload,
  normalizeStrategyProfilesPayload,
  calculateRiskProfileSelectionSha256,
  calculateRiskProfileBindingSha256,
  normalizeRiskProfileBindingRegistry,
  buildRiskProfileBindings,
  riskProfileBindingTargets,
  platformRepositories,
  requireSameOrigin,
  responseHeaders,
  fetchWithTimeout,
  syncDefaultStrategyProfiles: syncStrategyProfilesConfig,
  syncDefaultStrategyForAccount,
  normalizeStrategyHealthSnapshot,
  emptyStrategyHealthPayload,
  normalizeControlPlaneSnapshot,
  normalizeControlPlaneSourceSnapshot,
  emptyControlPlanePayload,
  normalizeAdaptiveSelectionSourceSnapshot,
  calculateAdaptiveSelectionDecisionDigest,
  emptyAdaptiveSelectionPayload,
  normalizeM0ResearchLedgerTransport,
  calculateM0ResearchLedgerSha256,
  projectM0ResearchDashboardForRead,
  emptyM0ResearchDashboardPayload,
  normalizeExecutionEvidenceSourceSnapshot,
  emptyExecutionEvidencePayload,
  calculateResearchTaskSha256,
  normalizeResearchTask,
  normalizeResearchTaskSourceSnapshot,
  emptyResearchTaskPayload,
  makeSession,
  supportedDomainsForAccount,
  updateAccountOptionsDefaultStrategy,
  withTimeout,
};
