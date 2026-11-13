import {
  AUTH_CONFIG_KEY,
} from "./constants.js";
import { hasConfigStore, readConfigJson } from "../config_kv.js";
import { uniqueStrings, parseLoginList, parseOrgList, normalizeLoginList, normalizeOrgList, cleanGithubLogin, cleanGithubOrg } from "./identity_lists.js";

export async function loadAuthConfig(env) {
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

export function normalizeAuthConfigPayload(payload, fieldName) {
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
export function isAdminLogin(login, orgLogins, authConfig) {
  return authConfig.admin_logins.includes(String(login || "").toLowerCase());
}

export function isAdminPrincipal(login, orgLogins, authConfig) {
  return isAdminLogin(login, orgLogins, authConfig) || hasOrgMatch(orgLogins, authConfig.admin_orgs);
}

export function isAllowedPrincipal(login, orgLogins, authConfig) {
  const normalizedLogin = String(login || "").toLowerCase();
  return (
    authConfig.allowed_logins.includes(normalizedLogin) ||
    hasOrgMatch(orgLogins, authConfig.allowed_orgs) ||
    isAdminPrincipal(normalizedLogin, orgLogins, authConfig)
  );
}

export function authorizedOrgLogins(orgLogins, authConfig) {
  const authorized = new Set([...authConfig.allowed_orgs, ...authConfig.admin_orgs]);
  return uniqueStrings(orgLogins).filter((org) => authorized.has(org));
}

export function hasOrgMatch(orgLogins, configuredOrgs) {
  const orgs = new Set(uniqueStrings(orgLogins));
  return configuredOrgs.some((org) => orgs.has(String(org || "").toLowerCase()));
}
