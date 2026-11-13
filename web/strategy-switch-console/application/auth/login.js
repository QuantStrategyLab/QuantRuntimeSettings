import { SESSION_COOKIE, OAUTH_STATE_COOKIE, GITHUB_LOGIN_REQUEST_TIMEOUT_MS, SESSION_TTL_SECONDS } from "./constants.js";
import { requireEnv } from "./require_env.js";
import { randomToken, cookie, clearOAuthCookie, parseCookies, clearCookie } from "./cookies.js";
import { redirect, html } from "../http_response.js";
import { renderMessage, escapeHtml } from "../html_message.js";
import { fetchWithTimeout } from "./fetch.js";
import { githubHeaders, fetchGithubOrgLogins } from "./github.js";
import { loadAuthConfig, isAllowedPrincipal, authorizedOrgLogins } from "./principals.js";
import { makeSession } from "./session.js";

export async function startLogin(request, env) {
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

export async function finishLogin(request, env) {
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

  const tokenStage = await runLoginGithubStage("token_exchange", () => fetchWithTimeout("https://github.com/login/oauth/access_token", {
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
  }, GITHUB_LOGIN_REQUEST_TIMEOUT_MS));
  if (tokenStage.timedOut) return loginTimeoutResponse("token_exchange");
  const tokenResponse = tokenStage.value;
  const tokenPayload = await tokenResponse.json();
  const tokenPayloadIsObject = tokenPayload !== null && typeof tokenPayload === "object";
  if (!tokenResponse.ok || !tokenPayloadIsObject || !tokenPayload.access_token) {
    const status = Number.isSafeInteger(tokenResponse?.status) ? tokenResponse.status : null;
    const allowedOauthErrors = new Set([
      "incorrect_client_credentials",
      "redirect_uri_mismatch",
      "bad_verification_code",
      "unverified_user_email",
    ]);
    const errorCategory = tokenPayloadIsObject && typeof tokenPayload.error === "string"
      && allowedOauthErrors.has(tokenPayload.error)
      ? tokenPayload.error
      : "unknown";
    console.warn("github_token_exchange_failed", {
      http_status: status,
      error_category: errorCategory,
    });
    const statusLabel = status === null ? "不可用" : String(status);
    return html(
      renderMessage("登录失败", `GitHub 凭证交换未成功（HTTP ${statusLabel}，类别：${errorCategory}）。请从登录入口重新开始。`),
      502,
      clearOAuthCookie(),
    );
  }

  const userStage = await runLoginGithubStage("user_lookup", () => fetchWithTimeout("https://api.github.com/user", {
    headers: githubHeaders(tokenPayload.access_token),
  }, GITHUB_LOGIN_REQUEST_TIMEOUT_MS));
  if (userStage.timedOut) return loginTimeoutResponse("user_lookup");
  const userResponse = userStage.value;
  const user = await userResponse.json();
  const login = String(user.login || "").toLowerCase();
  if (!userResponse.ok || !login) {
    return html(renderMessage("登录失败", "无法读取 GitHub 用户。"), 502, clearOAuthCookie());
  }

  const authConfig = await loadAuthConfig(env);
  const orgStage = await runLoginGithubStage("organization_lookup", () => fetchGithubOrgLogins(
    tokenPayload.access_token,
    GITHUB_LOGIN_REQUEST_TIMEOUT_MS,
  ));
  if (orgStage.timedOut) return loginTimeoutResponse("organization_lookup");
  const orgLogins = orgStage.value;
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

export async function runLoginGithubStage(stage, operation) {
  const startedAt = Date.now();
  try {
    return { timedOut: false, value: await operation() };
  } catch (error) {
    if (error?.message !== "GitHub request timed out") throw error;
    console.warn("github_login_request_timed_out", {
      stage,
      timeout_ms: GITHUB_LOGIN_REQUEST_TIMEOUT_MS,
      elapsed_ms: Math.max(0, Date.now() - startedAt),
    });
    return { timedOut: true };
  }
}

export function loginTimeoutResponse(stage) {
  const stageLabels = {
    token_exchange: "登录凭证交换",
    user_lookup: "读取用户身份",
    organization_lookup: "核对组织权限",
  };
  const stageLabel = stageLabels[stage] || "登录请求处理";
  return html(
    renderMessage("登录超时", `${stageLabel}超时，请从登录入口重新开始。此回调链接已失效，请勿复用。`),
    504,
    clearOAuthCookie(),
  );
}
