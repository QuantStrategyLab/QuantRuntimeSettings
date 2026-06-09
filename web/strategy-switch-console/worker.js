import { PAGE_HTML } from "./page_asset.js";
import { DEFAULT_STRATEGY_PROFILES } from "./strategy_profiles_asset.js";

const DEFAULT_REPOSITORY = "QuantStrategyLab/QuantRuntimeSettings";
const DEFAULT_WORKFLOW = "manual-strategy-switch.yml";
const SESSION_COOKIE = "qsl_switch_session";
const OAUTH_STATE_COOKIE = "qsl_switch_oauth_state";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const AUTH_CONFIG_KEY = "auth_config";
const ACCOUNT_OPTIONS_KEY = "account_options";
const STRATEGY_PROFILES_KEY = "strategy_profiles";
const AUDIT_LOG_KEY = "audit_log";
const AUDIT_LOG_LIMIT = 50;
const CURRENT_STRATEGIES_TIMEOUT_MS = 3500;

const SUPPORTED_PLATFORMS = ["longbridge", "ibkr", "schwab", "firstrade"];
const SUPPORTED_STRATEGY_DOMAINS = ["us_equity", "hk_equity"];
const DEFAULT_PLATFORM_REPOSITORIES = {
  longbridge: "QuantStrategyLab/LongBridgePlatform",
  ibkr: "QuantStrategyLab/InteractiveBrokersPlatform",
  schwab: "QuantStrategyLab/CharlesSchwabPlatform",
  firstrade: "QuantStrategyLab/FirstradePlatform",
};
const PLATFORM_REPOSITORY_ENV = {
  longbridge: ["STRATEGY_SWITCH_LONGBRIDGE_REPO", "RUNTIME_SETTINGS_LONGBRIDGE_REPO"],
  ibkr: ["STRATEGY_SWITCH_IBKR_REPO", "RUNTIME_SETTINGS_IBKR_REPO"],
  schwab: ["STRATEGY_SWITCH_SCHWAB_REPO", "RUNTIME_SETTINGS_SCHWAB_REPO"],
  firstrade: ["STRATEGY_SWITCH_FIRSTRADE_REPO", "RUNTIME_SETTINGS_FIRSTRADE_REPO"],
};
const DEFAULT_VARIABLE_SCOPE = {
  longbridge: "environment",
  ibkr: "repository",
  schwab: "repository",
  firstrade: "repository",
};
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
  ].join("; "),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/login") return await startLogin(request, env);
      if (url.pathname === "/callback") return await finishLogin(request, env);
      if (url.pathname === "/admin") return await adminPage(request, env);
      if (url.pathname === "/api/session") return json(await sessionPayload(request, env));
      if (url.pathname === "/api/strategy-profiles") return json(await strategyProfilesPayload(env));
      if (url.pathname === "/api/config") return json(await configPayload(request, env));
      if (url.pathname === "/api/admin/config" && request.method === "GET") {
        return await adminConfigResponse(request, env);
      }
      if (url.pathname === "/api/admin/config" && request.method === "POST") {
        return await saveAdminConfig(request, env);
      }
      if (url.pathname === "/api/internal/sync-account-default" && request.method === "POST") {
        return await syncAccountDefaultResponse(request, env);
      }
      if (url.pathname === "/api/logout" && request.method === "POST") return logout(request);
      if (url.pathname === "/api/switch" && request.method === "POST") return await dispatchSwitch(request, env);
      return html(PAGE_HTML);
    } catch (error) {
      return json({ ok: false, error: error.message || "unexpected error" }, error.status || 500);
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

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
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

  const userResponse = await fetch("https://api.github.com/user", {
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
  return {
    ok: true,
    session: { login: session.login, admin: true },
    kvAvailable: hasConfigStore(env),
    authConfig,
    accountOptions: accountConfig.options || {},
    accountOptionSource: accountConfig.source,
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
    button, textarea { font: inherit; letter-spacing: 0; }
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
  </script>
</body>
</html>`;
}

async function configPayload(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return { accountOptions: null };
  const accountConfig = await loadAccountOptionsConfig(env);
  const strategyProfiles = await loadStrategyProfilesConfig(env);
  return {
    accountOptions: accountConfig.options,
    platformRepositories: platformRepositories(env),
    strategyProfiles,
    currentStrategies: await loadCurrentStrategiesSafely(accountConfig.options, env),
  };
}

async function strategyProfilesPayload(env) {
  return {
    strategyProfiles: await loadStrategyProfilesConfig(env),
  };
}

async function loadCurrentStrategies(accountOptions, env) {
  const token = env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
  if (!token || !accountOptions) return {};
  const repositories = platformRepositories(env);

  const variableCache = new Map();
  const readVariable = (repository, scope, githubEnvironment, name) => {
    const cacheKey = [repository, scope, githubEnvironment || "", name].join("|");
    if (!variableCache.has(cacheKey)) {
      variableCache.set(cacheKey, fetchGithubVariable(token, repository, scope, githubEnvironment, name));
    }
    return variableCache.get(cacheKey);
  };

  const currentStrategies = {};
  const platformResults = await Promise.all(SUPPORTED_PLATFORMS.map(async (platform) => {
    const options = Array.isArray(accountOptions[platform]) ? accountOptions[platform] : [];
    if (!options.length) return [platform, {}];
    const repository = repositories[platform];
    if (!repository) return [platform, {}];

    const optionResults = await Promise.all(options.map(async (option) => {
      const current = await resolveCurrentStrategyForAccount({
        platform,
        option,
        optionsCount: options.length,
        repository,
        readVariable,
      });
      return [option.key, current];
    }));

    const platformStrategies = {};
    for (const [key, current] of optionResults) {
      if (current) platformStrategies[key] = current;
    }
    return [platform, platformStrategies];
  }));

  for (const [platform, platformStrategies] of platformResults) {
    if (Object.keys(platformStrategies).length) currentStrategies[platform] = platformStrategies;
  }
  return currentStrategies;
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

async function resolveCurrentStrategyForAccount({ platform, option, optionsCount, repository, readVariable }) {
  const serviceTargetsValue = await readVariable(repository, "repository", "", "CLOUD_RUN_SERVICE_TARGETS_JSON");
  const serviceTarget = runtimeTargetFromServiceTargets(serviceTargetsValue, platform, option);
  const serviceTargetProfile = cleanCurrentStrategy(serviceTarget?.strategy_profile);
  if (serviceTargetProfile) {
    return {
      strategy_profile: serviceTargetProfile,
      ...runtimeModePayload(serviceTarget),
      source: "CLOUD_RUN_SERVICE_TARGETS_JSON",
      variable_scope: "repository",
    };
  }

  const variableScope = resolveVariableScope(platform, option);
  const githubEnvironment = resolveGithubEnvironment(platform, option, variableScope);
  const runtimeTargetValue = await readVariable(repository, variableScope, githubEnvironment, "RUNTIME_TARGET_JSON");
  const runtimeTarget = parseJsonObject(runtimeTargetValue);
  const runtimeTargetMatches = runtimeTarget && runtimeTargetMatchesAccount(runtimeTarget, platform, option);
  const runtimeTargetProfile = runtimeTargetMatches ? cleanCurrentStrategy(runtimeTarget.strategy_profile) : "";
  if (runtimeTargetProfile) {
    return {
      strategy_profile: runtimeTargetProfile,
      ...runtimeModePayload(runtimeTarget),
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

  return null;
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
  const response = await fetch(apiUrl, {
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

  const accountOptionsSync = await syncDefaultStrategyForAccount(env, accountConfig.options, inputs, session);
  return json({
    ok: true,
    repository,
    workflow,
    actions_url: `https://github.com/${repository}/actions/workflows/${workflow}`,
    account_options_synced: accountOptionsSync.synced,
    account_options_sync: accountOptionsSync,
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
  const accountOption = assertConfiguredAccount(inputs, accountConfig.options);
  assertStrategyAllowedForAccount(inputs, accountOption, await loadStrategyProfilesConfig(env));
  const result = await syncDefaultStrategyForAccount(env, accountConfig.options, inputs, {
    login: "github-actions",
  });
  return json({ ok: result.synced, account_options_sync: result }, result.synced ? 200 : 500);
}

function requireInternalSyncToken(request, env) {
  const expected = env.STRATEGY_SWITCH_SYNC_TOKEN || env.RUNTIME_SETTINGS_DISPATCH_TOKEN;
  if (!expected) throw new HttpError("internal sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("internal sync token is invalid", 401);
}

function updateAccountOptionsDefaultStrategy(accountOptions, inputs) {
  const options = normalizeAccountOptionsPayload(accountOptions || {}, ACCOUNT_OPTIONS_KEY);
  const platformOptions = options[inputs.platform] || [];
  let matched = false;
  let changed = false;
  const updatedPlatformOptions = platformOptions.map((option) => {
    if (!accountOptionMatchesInputs(option, inputs)) return option;
    matched = true;
    if (option.default_strategy_profile === inputs.strategy_profile) return option;
    changed = true;
    return { ...option, default_strategy_profile: inputs.strategy_profile };
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
  const executionMode = cleanChoice(raw.execution_mode || "live", ["live", "paper"], "execution_mode");
  const pluginMode = cleanChoice(raw.plugin_mode || "auto", ["auto", "none", "custom"], "plugin_mode");
  const variableScope = cleanChoice(
    raw.variable_scope || "default",
    ["default", "repository", "environment"],
    "variable_scope",
  );
  const apply = cleanBoolean(raw.apply);
  const triggerPlatformSync = cleanBoolean(raw.trigger_platform_sync) && apply;
  const extraVariablesJson = cleanOptionalJsonObject(raw.extra_variables_json || "", "extra_variables_json");

  const inputs = {
    platform,
    target_name: targetName,
    strategy_profile: strategyProfile,
    execution_mode: executionMode,
    variable_scope: variableScope,
    plugin_mode: pluginMode,
    service_targets_mode: "auto",
    apply: apply ? "true" : "false",
    trigger_platform_sync: triggerPlatformSync ? "true" : "false",
    confirm_apply: apply ? (triggerPlatformSync ? "APPLY_AND_SYNC" : "APPLY") : "",
    platform_sync_workflow: "sync-cloud-run-env.yml",
  };

  addOptional(inputs, "github_environment", raw.github_environment, cleanSlug);
  addOptional(inputs, "deployment_selector", raw.deployment_selector, cleanSlug);
  addOptional(inputs, "account_selector", raw.account_selector, cleanCsv);
  addOptional(inputs, "account_scope", raw.account_scope, cleanSlug);
  addOptional(inputs, "service_name", raw.service_name, cleanSlug);
  addOptional(inputs, "custom_plugin_mounts_json", raw.custom_plugin_mounts_json, cleanJson);
  if (extraVariablesJson) inputs.extra_variables_json = extraVariablesJson;
  return inputs;
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
  const options = accountOptions[inputs.platform] || [];
  if (!options.length) throw new Error(`no account options configured for ${inputs.platform}`);
  const matched = options.find((option) => accountOptionMatchesInputs(option, inputs));
  if (!matched) throw new Error("switch inputs do not match configured account options");
  return matched;
}

function assertStrategyAllowedForAccount(inputs, accountOption, strategyProfiles) {
  const strategy = strategyProfiles.find((item) => item.profile === inputs.strategy_profile);
  if (!strategy || strategy.runtime_enabled !== true) {
    throw new Error(`strategy ${inputs.strategy_profile} is not live-enabled`);
  }
  const supportedDomains = supportedDomainsForAccount(inputs.platform, accountOption);
  if (!supportedDomains.includes(strategy.domain)) {
    throw new Error(
      `strategy domain ${strategy.domain} is not supported by ${inputs.platform}/${accountOption.key}`,
    );
  }
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
    "plugin_mode",
  ];
  for (const field of fields) {
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
  if (field === "plugin_mode") return "auto";
  if (field === "deployment_selector") {
    if (platform === "firstrade") return "firstrade";
    return ["sg", "hk", "paper"].includes(targetName.toLowerCase()) ? targetName.toUpperCase() : targetName;
  }
  if (field === "account_scope") {
    if (platform === "firstrade") return "US";
    return inputs.deployment_selector || defaultInputValue("deployment_selector", inputs);
  }
  if (field === "account_selector") {
    if (platform === "firstrade") return "firstrade";
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
      runtime_enabled: cleanProfileBoolean(item.runtime_enabled ?? item.live_enabled ?? true),
    };
    entry.domain = cleanStrategyDomain(item.domain || "us_equity", `${fieldName}[${index}].domain`);
    result.push(entry);
  }
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
  addConfigOptional(option, "default_strategy_profile", item.default_strategy_profile || item.strategy_profile, cleanSlug);
  addConfigOptional(option, "github_environment", item.github_environment, cleanSlug);
  addConfigOptional(option, "variable_scope", item.variable_scope, (value, field) =>
    cleanChoice(value || "default", ["default", "repository", "environment"], field),
  );
  addConfigOptional(option, "plugin_mode", item.plugin_mode, (value, field) =>
    cleanChoice(value || "auto", ["auto", "none"], field),
  );
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

function cleanBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false" || value === "" || value === undefined || value === null) return false;
  throw new Error("boolean input is invalid");
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
    const response = await fetch(apiUrl, {
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
  const payload = parseJsonObject(rawValue);
  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  for (const entry of targets) {
    if (!entry || Array.isArray(entry) || typeof entry !== "object") continue;
    const runtimeTarget = entry.runtime_target && typeof entry.runtime_target === "object"
      ? entry.runtime_target
      : {};
    if (!runtimeTargetMatchesAccount(runtimeTarget, platform, option, entry)) continue;
    return {
      ...runtimeTarget,
      strategy_profile: runtimeTarget.strategy_profile || entry.strategy_profile,
    };
  }
  return null;
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
  if (mode === "live" || mode === "paper") return mode;
  const dryRun = cleanOptionalBoolean(dryRunOnly);
  if (dryRun === true) return "paper";
  if (dryRun === false) return "live";
  return "";
}

function cleanOptionalBoolean(value) {
  if (value === true || value === "true" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  return null;
}

function runtimeTargetMatchesAccount(runtimeTarget, platform, option, entry = {}) {
  const runtimePlatform = String(runtimeTarget?.platform_id || "").trim().toLowerCase();
  if (runtimePlatform && runtimePlatform !== platform) return false;

  const serviceName = String(option?.service_name || defaultCurrentServiceName(platform, option?.target_name || option?.key) || "");
  if (serviceName && hasCandidate(serviceName, [
    runtimeTarget?.service_name,
    entry?.service,
    entry?.service_name,
  ])) return true;

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
    const response = await fetch(`https://api.github.com/user/orgs?per_page=100&page=${page}`, {
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
  assertStrategyAllowedForAccount,
  inferAccountSupportedDomains,
  loadCurrentStrategies,
  normalizeAccountOptionsPayload,
  normalizeStrategyProfilesPayload,
  platformRepositories,
  requireSameOrigin,
  responseHeaders,
  syncDefaultStrategyForAccount,
  supportedDomainsForAccount,
  updateAccountOptionsDefaultStrategy,
  withTimeout,
};
