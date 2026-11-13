/**
 * Account-settings profile-application OIDC / JWT / JWKS helpers.
 * Never import runtime_support.
 */

import { HttpError } from "../http_error.js";
import { readLimitedUtf8Body } from "../ux1/research.js";
import {
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_AUDIENCE,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_JWKS_URL,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_JWKS_BYTES,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_TOKEN_BYTES,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_REF,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_REPOSITORY,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_TIMEOUT_MS,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_WORKFLOW_REF,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_MAX_BODY_BYTES,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_TIMEOUT_MS,
} from "./constants.js";
import { decodeProfileApplicationJwtPart } from "./helpers.js";

export async function readGitHubProfileApplicationJwks() {
  const controller = new AbortController();
  let rejectAbort = () => {};
  const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
  abortPromise.catch(() => {});
  const onAbort = () => rejectAbort(new HttpError("github_oidc_jwks_unavailable", 503));
  controller.signal.addEventListener("abort", onAbort);
  const timeout = setTimeout(() => controller.abort(), ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_TIMEOUT_MS);
  let response;
  try {
    response = await Promise.race([
      fetch(ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_JWKS_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: controller.signal,
      }),
      abortPromise,
    ]);
    if (response.status !== 200 || response.redirected) throw new HttpError("github_oidc_jwks_unavailable", 503);
    const contentLength = response.headers.get("Content-Length");
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_JWKS_BYTES)) {
      throw new HttpError("github_oidc_jwks_unavailable", 503);
    }
    const contentType = response.headers.get("Content-Type") || "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new HttpError("github_oidc_jwks_unavailable", 503);
    const text = await readLimitedUtf8Body(response, ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_JWKS_BYTES, controller, abortPromise);
    const jwks = JSON.parse(text);
    if (!jwks || Array.isArray(jwks) || typeof jwks !== "object" || !Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 16) {
      throw new HttpError("github_oidc_jwks_unavailable", 503);
    }
    return jwks.keys;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError("github_oidc_jwks_unavailable", 503);
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

export async function verifyGitHubProfileApplicationToken(request, env) {
  const workflowSha = env.ACCOUNT_SETTINGS_PROFILE_APPLICATION_WORKFLOW_SHA;
  if (typeof workflowSha !== "string" || !/^[a-f0-9]{40}$/.test(workflowSha)) {
    throw new HttpError("github_oidc_workflow_sha_not_configured", 503);
  }
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
  if (!match || match[1].length > ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_MAX_TOKEN_BYTES) {
    throw new HttpError("github_oidc_token_invalid", 401);
  }
  const parts = match[1].split(".");
  if (parts.length !== 3) throw new HttpError("github_oidc_token_invalid", 401);
  const header = decodeProfileApplicationJwtPart(parts[0], 2048).value;
  const claims = decodeProfileApplicationJwtPart(parts[1], 4096).value;
  const signature = decodeProfileApplicationJwtPart(parts[2], 1024, false).bytes;
  if (!header || Array.isArray(header) || typeof header !== "object"
    || header.alg !== "RS256" || header.typ !== "JWT"
    || typeof header.kid !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(header.kid)
    || Object.hasOwn(header, "jku") || Object.hasOwn(header, "x5u") || Object.hasOwn(header, "crit")) {
    throw new HttpError("github_oidc_token_invalid", 401);
  }
  if (!claims || Array.isArray(claims) || typeof claims !== "object"
    || claims.iss !== "https://token.actions.githubusercontent.com"
    || claims.aud !== ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_AUDIENCE
    || claims.repository !== ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_REPOSITORY
    || claims.ref !== ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_REF
    || claims.workflow_ref !== ACCOUNT_SETTINGS_PROFILE_APPLICATION_OIDC_WORKFLOW_REF
    || claims.workflow_sha !== workflowSha
    || Object.hasOwn(claims, "job_workflow_ref") || Object.hasOwn(claims, "job_workflow_sha")
    || claims.event_name !== "workflow_dispatch"
    || typeof claims.run_id !== "string" || !/^[1-9]\d{0,19}$/.test(claims.run_id)
    || typeof claims.run_attempt !== "string" || !/^[1-9]\d{0,5}$/.test(claims.run_attempt)) {
    throw new HttpError("github_oidc_token_invalid", 401);
  }
  const now = Math.floor(Date.now() / 1000);
  if (![claims.iat, claims.nbf, claims.exp].every(Number.isSafeInteger)
    || claims.iat > now + 30 || claims.iat < now - 600
    || claims.nbf > now + 30 || claims.nbf > claims.exp
    || claims.exp <= now || claims.exp <= claims.iat || claims.exp - claims.iat > 600) {
    throw new HttpError("github_oidc_token_invalid", 401);
  }
  const keys = await readGitHubProfileApplicationJwks();
  const matches = keys.filter((key) => key?.kid === header.kid);
  if (matches.length !== 1) throw new HttpError("github_oidc_token_invalid", 401);
  const jwk = matches[0];
  if (jwk.kty !== "RSA" || jwk.use !== "sig" || (jwk.alg && jwk.alg !== "RS256")
    || (jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes("verify")))
    || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
    throw new HttpError("github_oidc_token_invalid", 401);
  }
  let valid = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", publicKey, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch { throw new HttpError("github_oidc_token_invalid", 401); }
  if (!valid) throw new HttpError("github_oidc_token_invalid", 401);
  return { runId: claims.run_id, runAttempt: claims.run_attempt };
}

export async function readGitHubProfileApplicationRequestBody(request) {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > ACCOUNT_SETTINGS_PROFILE_APPLICATION_MAX_BODY_BYTES)) {
    throw new HttpError("account_settings_profile_application_body_too_large", 413);
  }
  const controller = new AbortController();
  let rejectAbort = () => {};
  const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
  abortPromise.catch(() => {});
  const onAbort = () => rejectAbort(new HttpError("account_settings_profile_application_body_timeout", 408));
  controller.signal.addEventListener("abort", onAbort);
  const timeout = setTimeout(() => controller.abort(), ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_TIMEOUT_MS);
  try {
    const text = await readLimitedUtf8Body(request, ACCOUNT_SETTINGS_PROFILE_APPLICATION_MAX_BODY_BYTES, controller, abortPromise);
    try { return JSON.parse(text); } catch { throw new HttpError("request body must be valid JSON", 400); }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (String(error?.message || "") === "ux1_calculator_body_limit") {
      throw new HttpError("account_settings_profile_application_body_too_large", 413);
    }
    throw new HttpError("account_settings_profile_application_body_invalid", 400);
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
