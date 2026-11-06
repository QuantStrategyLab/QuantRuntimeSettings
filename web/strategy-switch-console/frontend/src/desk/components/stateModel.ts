/**
 * Pure state helpers shared by the desk's loading / empty / error / freshness blocks.
 * Kept out of the React file so the timeout and freshness rules are testable without a DOM.
 */
import type { Language } from "../../lib/prefs";
import { formatAge } from "../format.ts";
import type { DeskKey } from "../i18n/index.ts";

export type FreshnessChipState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "read"; data_status: "ready" | "stale" | "unavailable"; age_seconds: number | null };

export interface FreshnessView {
  key: DeskKey;
  tone: "ok" | "muted" | "unknown";
  age: string | null;
}

/**
 * The top-bar freshness chip never prints a number when the age is unknown, and a
 * stale or unavailable read never borrows the "fresh" wording.
 */
export function freshnessView(state: FreshnessChipState, language: Language): FreshnessView {
  if (state.kind === "loading") return { key: "states.freshness.loading", tone: "muted", age: null };
  if (state.kind === "failed") return { key: "states.freshness.failed", tone: "unknown", age: null };
  const age = formatAge(state.age_seconds, language);
  if (state.data_status === "unavailable") return { key: "states.freshness.unavailable", tone: "unknown", age: null };
  if (state.data_status === "stale") return { key: "states.freshness.stale", tone: "unknown", age };
  return { key: "states.freshness.ready", tone: "ok", age };
}

/** Skeleton loading becomes "read failed" after this long without an answer. */
export const READ_TIMEOUT_MS = 10_000;

export function readTimedOut(startedAtMs: number, nowMs: number, timeoutMs = READ_TIMEOUT_MS): boolean {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(timeoutMs)) return true;
  if (timeoutMs <= 0) return true;
  return nowMs - startedAtMs >= timeoutMs;
}

/**
 * Identity of one read attempt. A retry passes a fresh `startedAt`, so its
 * generation differs and an expired flag from the previous attempt cannot
 * suppress the new loading state.
 */
export function readGeneration(startedAtMs: number, timeoutMs = READ_TIMEOUT_MS): string {
  return `${startedAtMs}:${timeoutMs}`;
}

/** True only when the expired marker belongs to the read currently awaited. */
export function isReadExpired(expiredGeneration: string | null, generation: string): boolean {
  return expiredGeneration !== null && expiredGeneration === generation;
}

/** Age above this is stale in the top-bar chip; the backend remains the source of truth. */
export const FRESHNESS_STALE_SECONDS = 900;

export function freshnessFromAge(ageSeconds: number | null): FreshnessChipState {
  if (ageSeconds === null || !Number.isFinite(ageSeconds) || ageSeconds < 0) {
    return { kind: "read", data_status: "unavailable", age_seconds: null };
  }
  return { kind: "read", data_status: ageSeconds > FRESHNESS_STALE_SECONDS ? "stale" : "ready", age_seconds: ageSeconds };
}

/** Old console routes in mock items are mapped onto the desk hash routes. */
export function deskRoute(route: string): string {
  if (route.startsWith("#/desk")) return route;
  const [rawPath, query = ""] = route.replace(/^#?\/?/, "").split("?", 2);
  const page = ["overview", "accounts", "switch", "performance", "alerts", "logs"].includes(rawPath) ? rawPath : "overview";
  return `#/desk/${page}${query ? `?${query}` : ""}`;
}
