/**
 * Feeds the embedded IBKR Flex rotation panel from the desk credentials read.
 *
 * The panel used to carry its own invented metadata, so the card above it and the
 * panel below it could disagree about the same credential. Both now come from one
 * `CredentialItem`: same expiry, same last-rotation instant, same phase.
 *
 * The panel's vocabulary cannot express "could not be read" (`expires_at: null` means
 * "does not expire"), so an unknown expiry does not get a fabricated value: the caller
 * gets an unavailable state and renders it explicitly.
 */
import type { CredentialRotationEnvelope } from "../../api/contracts";
import { CREDENTIAL_ROTATION_SCHEMA_VERSION } from "../../api/contracts.ts";
import type { CredentialMaintenance } from "../../api/endpoints";
import type { CredentialItem, CredentialPhase } from "../contract/types";

export type FlexPanelRead =
  | { kind: "absent" }
  | { kind: "unreadable"; item: CredentialItem }
  | { kind: "ready"; item: CredentialItem; envelope: CredentialRotationEnvelope; maintenance: CredentialMaintenance };

/**
 * `CredentialMaintenance` has no 1-day bucket. One day is inside seven days, so the
 * wider bucket stays true; the desk's own card keeps the precise phase label.
 */
export function maintenancePhase(phase: CredentialPhase): CredentialMaintenance["phase"] {
  return phase === "1" ? "7" : phase;
}

export function flexPanelRead(items: readonly CredentialItem[], generatedAt: string): FlexPanelRead {
  const item = items.find(entry => entry.kind === "flex_token");
  if (!item) return { kind: "absent" };
  if (item.expiry.status === "unknown") return { kind: "unreadable", item };
  return {
    kind: "ready",
    item,
    envelope: {
      schema_version: CREDENTIAL_ROTATION_SCHEMA_VERSION,
      ok: true,
      server_time: generatedAt,
      metadata: {
        name: item.id,
        last_rotated_at: item.last_rotated_at,
        expires_at: item.expiry.status === "known" ? item.expiry.at : null,
      },
      // The desk offers no rotation write: no operation and no allowed action.
      operation: null,
      allowed_actions: [],
    },
    maintenance: {
      id: item.id,
      expires_at: item.expiry.status === "known" ? item.expiry.at : null,
      phase: maintenancePhase(item.phase),
      requires_action: item.requires_action,
      // The credentials read has no delivery dimension; unknown is not "not_reserved".
      delivery: "unknown",
    },
  };
}
