/**
 * Synthetic data shared by desk fixtures. Account refs are fake (•••0001–•••0006), times
 * are pinned to a fixed synthetic "now", amounts are invented and add up.
 */
export const NOW = "2026-11-02T14:32:07Z";

/** Deterministic NAV path, oldest to newest, as decimal strings (no randomness at runtime). */
export function navPath(start: number, end: number, count: number, wobble: number, phase = 0): string[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 1 : i / (count - 1);
    const trend = start + (end - start) * t;
    const swing = Math.sin(i * 0.9 + phase) * wobble + Math.sin(i * 0.37 + phase * 2) * wobble * 0.6;
    return (i === count - 1 ? end : trend + swing).toFixed(2);
  });
}

/** Calendar days from `from`, inclusive, as YYYY-MM-DD. */
export function days(from: string, count: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}
