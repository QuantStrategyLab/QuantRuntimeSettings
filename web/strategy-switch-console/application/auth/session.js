import { HttpError } from "../http_error.js";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  AUTH_CONFIG_KEY,
} from "./constants.js";
import { parseCookies, base64UrlEncodeJson, base64UrlEncodeBytes, base64UrlDecode } from "./cookies.js";
import { loadAuthConfig, isAllowedPrincipal, isAdminPrincipal } from "./principals.js";
import { normalizeOrgList, uniqueStrings } from "./identity_lists.js";

export async function makeSession(login, orgs, env) {
  const payload = base64UrlEncodeJson({
    login,
    orgs: uniqueStrings(orgs),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  const signature = await hmac(payload, env.SESSION_SECRET);
  return `${payload}.${signature}`;
}

export async function readSession(request, env) {
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
export async function hmac(value, secret) {
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
