/** Statuses that render their data (with a badge); everything else renders an honest empty state. */
export function renderableStatus(status: string | null | undefined): boolean {
  return status === "ok" || status === "partial" || status === "stale";
}
