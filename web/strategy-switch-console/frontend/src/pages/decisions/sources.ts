import type { MessageKey } from "../../i18n";

/**
 * The inbox sources the API can report as degraded (see
 * application/console_api/inbox.js). Their user-facing names reuse the existing
 * category labels, so the filter row and the partial-source list say the same
 * thing. The raw source code stays diagnostic data (`data-source`), never the
 * primary label: "owner" is not a phrase a reader should have to decode.
 */
const SOURCE_CATEGORY: Record<string, string> = {
  owner: "owner_decision",
  promotion: "strategy_promotion",
  recovery: "reconciliation_recovery",
  credential: "credential_maintenance",
};

/** Localized label key for a source code; unknown codes fall back honestly. */
export function sourceLabelKey(source: string): MessageKey {
  const category = SOURCE_CATEGORY[source];
  return category ? (`category.${category}` as MessageKey) : "decisions.unknown_source";
}
