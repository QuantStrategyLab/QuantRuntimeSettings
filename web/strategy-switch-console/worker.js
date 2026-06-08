import { PAGE_HTML } from "./page_asset.js";

const DEFAULT_REPOSITORY = "QuantStrategyLab/QuantRuntimeSettings";
const DEFAULT_WORKFLOW = "manual-strategy-switch.yml";
const SESSION_COOKIE = "qsl_switch_session";
const OAUTH_STATE_COOKIE = "qsl_switch_oauth_state";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

const SUPPORTED_PLATFORMS = ["longbridge", "ibkr", "schwab", "firstrade"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/login") return startLogin(request, env);
      if (url.pathname === "/callback") return finishLogin(request, env);
      if (url.pathname === "/admin") return adminPage(request, env);
      if (url.pathname === "/api/session") return json(await sessionPayload(request, env));
      if (url.pathname === "/api/config") return json(await configPayload(request, env));
      if (url.pathname === "/api/logout" && request.method === "POST") return logout(request);
      if (url.pathname === "/api/switch" && request.method === "POST") return dispatchSwitch(request, env);
      return html(PAGE_HTML);
    } catch (error) {
      return json({ ok: false, error: error.message || "unexpected error" }, 500);
    }
  },
};

async function startLogin(request, env) {
  requireEnv(env, "GITHUB_CLIENT_ID");
  const url = new URL(request.url);
  const state = randomToken();
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);
  authorizeUrl.searchParams.set("scope", "read:user");
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

  if (!isAllowedLogin(login, env)) {
    return html(renderMessage("没有权限", `${login} 不在允许登录名单中。`), 403, clearOAuthCookie());
  }

  const session = await makeSession(login, env);
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
  const session = await readSession(request, env);
  if (!session) return redirect("/login");
  if (!session.admin) {
    return html(renderMessage("没有管理权限", `${session.login} 不在 STRATEGY_SWITCH_ADMIN_LOGINS 中。`), 403);
  }

  const configuredPlatforms = parseAccountOptions(env.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON || "") || {};
  const accountRows = SUPPORTED_PLATFORMS.map((platform) => {
    const count = Array.isArray(configuredPlatforms[platform]) ? configuredPlatforms[platform].length : 0;
    return `<tr><td>${escapeHtml(platform)}</td><td>${count}</td></tr>`;
  }).join("");
  return html(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Strategy Switch Admin</title>
<body style="font-family:system-ui,sans-serif;margin:32px;color:#16191f;background:#f5f6f8">
<main style="max-width:760px;margin:auto;background:white;border:1px solid #dce1e7;border-radius:8px;padding:24px">
<h1 style="margin:0 0 8px">Strategy Switch Admin</h1>
<p style="margin:0 0 18px;color:#66707c">Signed in as ${escapeHtml(session.login)}. Admin permission is verified by STRATEGY_SWITCH_ADMIN_LOGINS.</p>
<h2 style="font-size:16px">Account options</h2>
<table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Platform</th><th align="left">Configured accounts</th></tr></thead><tbody>${accountRows}</tbody></table>
<p style="color:#66707c;margin-top:18px">Next step: connect Cloudflare KV to edit allowlist and account options here. Current version verifies admin access and shows loaded private account config counts.</p>
<p><a href="/">Back to switch console</a></p>
</main>
</body>`);
}

async function configPayload(request, env) {
  const session = await readSession(request, env);
  if (!session?.allowed) return { accountOptions: null };
  return {
    accountOptions: parseAccountOptions(env.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON || ""),
  };
}

function logout(request) {
  requireSameOrigin(request);
  return json({ ok: true }, 200, {
    "Set-Cookie": clearCookie(SESSION_COOKIE),
  });
}

async function dispatchSwitch(request, env) {
  requireEnv(env, "RUNTIME_SETTINGS_DISPATCH_TOKEN");
  requireSameOrigin(request);
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);

  const rawInput = await request.json();
  const inputs = normalizeSwitchInputs(rawInput);
  assertSwitchIntent(inputs);
  assertConfiguredAccount(inputs, parseAccountOptions(env.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON || ""));
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

  return json({
    ok: true,
    repository,
    workflow,
    actions_url: `https://github.com/${repository}/actions/workflows/${workflow}`,
    inputs,
  });
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
  if (!accountOptions) throw new Error("private account options are not configured");
  const options = accountOptions[inputs.platform] || [];
  if (!options.length) throw new Error(`no account options configured for ${inputs.platform}`);
  const matched = options.some((option) => accountOptionMatchesInputs(option, inputs));
  if (!matched) throw new Error("switch inputs do not match configured account options");
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
    if (!expected && actual && !["default", "auto"].includes(actual)) return false;
  }
  return true;
}

function parseAccountOptions(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error("STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON must be valid JSON");
  }
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON must be an object");
  }

  const result = {};
  for (const platform of SUPPORTED_PLATFORMS) {
    const items = payload[platform];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.length > 20) {
      throw new Error(`account options for ${platform} must be an array with at most 20 items`);
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
  addConfigOptional(option, "github_environment", item.github_environment, cleanSlug);
  addConfigOptional(option, "variable_scope", item.variable_scope, (value, field) =>
    cleanChoice(value || "default", ["default", "repository", "environment"], field),
  );
  addConfigOptional(option, "plugin_mode", item.plugin_mode, (value, field) =>
    cleanChoice(value || "auto", ["auto", "none"], field),
  );
  return option;
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

function cleanLabel(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 80 || /[<>{}]/.test(text)) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}

function requireSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return;
  if (origin !== new URL(request.url).origin) throw new Error("cross-origin request rejected");
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

function requireEnv(env, name) {
  if (!env[name]) throw new Error(`${name} is not configured`);
}

function allowedLogins(env) {
  return String(env.ALLOWED_GITHUB_LOGINS || env.ALLOWED_GITHUB_LOGIN || "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean);
}

function adminLogins(env) {
  return String(env.STRATEGY_SWITCH_ADMIN_LOGINS || "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminLogin(login, env) {
  return adminLogins(env).includes(String(login || "").toLowerCase());
}

function isAllowedLogin(login, env) {
  const normalized = String(login || "").toLowerCase();
  return allowedLogins(env).includes(normalized) || isAdminLogin(normalized, env);
}

async function makeSession(login, env) {
  const payload = base64UrlEncodeJson({
    login,
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
  const admin = isAdminLogin(login, env);
  return { login, allowed: admin || allowedLogins(env).includes(login), admin };
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

function responseHeaders(base, extra) {
  const headers = new Headers(base);
  for (const [name, value] of Object.entries(extra)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
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
