/** Check only the static shell; never refresh private data or interrupt edits. */
export async function consoleBuildChanged(current: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(current)) return false;
  const response = await fetcher("/", { method: "HEAD", cache: "no-store", credentials: "omit" });
  const latest = response.headers.get("X-Console-Build");
  return response.ok && /^[a-f0-9]{64}$/.test(latest || "") && latest !== current;
}
