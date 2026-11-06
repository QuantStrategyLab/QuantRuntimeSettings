/**
 * The Credentials table model: urgency ordering, summary chips and the per-row
 * action set. Pure, so the rules are testable without a DOM.
 *
 * Ordering is "most urgent first" and never hides an item: credentials with a
 * readable expiry sort by the instant they expire (earliest first), then the ones
 * that could not be read, then the ones the platform says never expire. The sort is
 * stable, so items that tie keep the backend's order.
 */
import type { CredentialItem } from "../contract/types";

export type UrgencyGroup = "known" | "unreadable" | "none";

export interface UrgencyKey {
  group: UrgencyGroup;
  /** Expiry instant in ms for a readable expiry; null otherwise. */
  at: number | null;
}

export function urgencyKey(item: CredentialItem): UrgencyKey {
  if (item.expiry.status === "none") return { group: "none", at: null };
  if (item.expiry.status === "unknown") return { group: "unreadable", at: null };
  const at = Date.parse(item.expiry.at);
  // An expiry that claims to be known but carries no usable instant is unreadable, not distant.
  return Number.isFinite(at) ? { group: "known", at } : { group: "unreadable", at: null };
}

const GROUP_ORDER: Record<UrgencyGroup, number> = { known: 0, unreadable: 1, "none": 2 };

/** Stable most-urgent-first sort; the input array is never mutated. */
export function sortCredentials(items: readonly CredentialItem[]): CredentialItem[] {
  return items
    .map((item, index) => ({ item, index, key: urgencyKey(item) }))
    .sort((left, right) => {
      const group = GROUP_ORDER[left.key.group] - GROUP_ORDER[right.key.group];
      if (group !== 0) return group;
      if (left.key.at !== null && right.key.at !== null && left.key.at !== right.key.at) return left.key.at - right.key.at;
      return left.index - right.index;
    })
    .map(entry => entry.item);
}

export interface CredentialSummary {
  brokers: number;
  total: number;
  /** 7, 1 and expired: the phases that raise a Needs-you item. */
  due: number;
  known: number;
  none: number;
  unknown: number;
}

export function credentialSummary(items: readonly CredentialItem[]): CredentialSummary {
  const platforms = new Set<string>();
  const summary: CredentialSummary = { brokers: 0, total: items.length, due: 0, known: 0, none: 0, unknown: 0 };
  for (const item of items) {
    platforms.add(item.platform);
    if (item.phase === "7" || item.phase === "1" || item.phase === "expired") summary.due += 1;
    if (item.expiry.status === "known") summary.known += 1;
    else if (item.expiry.status === "none") summary.none += 1;
    else summary.unknown += 1;
  }
  summary.brokers = platforms.size;
  return summary;
}

/** Why a row has no usable rotation action. */
export type RotationBlock = "nothing_to_rotate" | "no_route";

export type CredentialAction =
  | { kind: "rotate"; label: "credentials.action.rotate" }
  | { kind: "blocked"; reason: RotationBlock };

/**
 * C5: an offered rotation route, or the reason the row cannot be rotated. A credential
 * the platform says never expires has nothing to rotate; anything else without a route
 * reports `rotation.supported=false` rather than silently showing no control.
 */
export function credentialAction(item: CredentialItem): CredentialAction {
  if (item.rotation.supported && item.rotation.route) return { kind: "rotate", label: "credentials.action.rotate" };
  return { kind: "blocked", reason: item.expiry.status === "none" ? "nothing_to_rotate" : "no_route" };
}

/** The Flex credential the embedded rotation panel belongs to, or null when this read has none. */
export function flexCredential(items: readonly CredentialItem[]): CredentialItem | null {
  return items.find(item => item.kind === "flex_token") ?? null;
}
