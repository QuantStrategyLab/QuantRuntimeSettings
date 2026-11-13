import { GITHUB_API_TIMEOUT_MS } from "./constants.js";

export async function fetchWithTimeout(resource, init = {}, timeoutMs = GITHUB_API_TIMEOUT_MS, fetchImpl = fetch) {
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
