import { fetchWithTimeout } from "./fetch.js";
import { GITHUB_API_TIMEOUT_MS } from "./constants.js";
import { cleanGithubOrg, uniqueStrings } from "./identity_lists.js";

export function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "QuantRuntimeSettings-StrategySwitchConsole",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function fetchGithubOrgLogins(token, timeoutMs = GITHUB_API_TIMEOUT_MS) {
  const orgs = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetchWithTimeout(`https://api.github.com/user/orgs?per_page=100&page=${page}`, {
      headers: githubHeaders(token),
    }, timeoutMs);
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
