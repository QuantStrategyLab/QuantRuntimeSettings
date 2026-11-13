export function parseLoginList(value, fieldName) {
  return normalizeLoginList(value, fieldName);
}

export function normalizeLoginList(value, fieldName) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  if (items.length > 80) throw new Error(`${fieldName} supports at most 80 logins`);
  return uniqueStrings(items.map((item) => cleanGithubLogin(item, fieldName)).filter(Boolean));
}

export function parseOrgList(value, fieldName) {
  return normalizeOrgList(value, fieldName);
}

export function normalizeOrgList(value, fieldName) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  if (items.length > 80) throw new Error(`${fieldName} supports at most 80 orgs`);
  return uniqueStrings(items.map((item) => cleanGithubOrg(item, fieldName)).filter(Boolean));
}

export function cleanGithubLogin(value, fieldName) {
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

export function cleanGithubOrg(value, fieldName) {
  return cleanGithubLogin(value, fieldName);
}

export function uniqueStrings(items) {
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
