export function resolveAccountChoice<T extends { id: string }>(options: T[], selected: string | null | undefined): T | null {
  return options.find(option => option.id === selected) ?? (options.length === 1 ? options[0] : null);
}

const ADOPT_ACTIONS = new Set(["approve", "accept", "approve_limited_live_canary"]);
const DECLINE_ACTIONS = new Set(["reject", "keep_parked"]);

/** Server `allowed_actions` holds strings or `{action,...}` entries; anything else is not a whitelist. */
export function allowedActionIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.flatMap((entry): string[] => {
    const action = typeof entry === "string" ? entry
      : entry && typeof entry === "object" && typeof (entry as { action?: unknown }).action === "string"
        ? (entry as { action: string }).action
        : null;
    return action ? [action] : [];
  }))];
}

/**
 * Gating from the server action whitelist: a missing field keeps the legacy
 * allow, an empty list allows nothing, adopt/decline map to the category's
 * concrete action ids.
 */
export function decisionActionAllowed(item: unknown, kind: "adopt" | "decline"): boolean {
  // A server blocker closes both actions, whatever `allowed_actions` says.
  if (inboxBlockers(item)?.blocked) return false;
  const raw = item && typeof item === "object" && "allowed_actions" in item
    ? (item as { allowed_actions?: unknown }).allowed_actions
    : undefined;
  const ids = allowedActionIds(raw);
  if (ids === null) return true;
  const names = kind === "adopt" ? ADOPT_ACTIONS : DECLINE_ACTIONS;
  return ids.some(id => names.has(id));
}

/**
 * `POST /api/research-promotion-decisions` body. The backend asserts the
 * confirmation field set exactly, so no policy revision may be added here.
 */
export function promotionDecisionBody(input: {
  ticketId: string;
  accept: boolean;
  account: { platform: string; key: string; mode: string } | null;
  riskProfile: string | null;
  proposedParams: unknown;
  strategyProfile: unknown;
  domain: unknown;
}): Record<string, unknown> {
  return {
    ticket_id: input.ticketId,
    decision: input.accept ? "accept" : "reject",
    confirmation: input.account && input.riskProfile ? {
      target_platform: input.account.platform,
      execution_mode: input.account.mode,
      risk_profile: input.riskProfile,
    } : null,
    ...(input.account ? { selected_account: { platform: input.account.platform, key: input.account.key } } : {}),
    expected_proposed_params: input.proposedParams || {},
    expected_strategy_profile: input.strategyProfile,
    expected_domain: input.domain,
  };
}

/** Inbox `blocking_reason_codes` (decision_contract.js) mapped to existing cockpit blocker copy. */
const BLOCKER_COPY: Record<string, string> = {
  decision_expired: "cockpit.blocker.expired",
  decision_expiry_unavailable: "cockpit.blocker.expiry",
  decision_evidence_stale: "cockpit.blocker.support_stale",
  decision_source_unavailable: "cockpit.blocker.support_unavailable",
  decision_authority_unavailable: "cockpit.blocker.state_unknown",
  decision_already_decided: "cockpit.blocker.state",
  decision_material_ineligible: "cockpit.blocker.unqualified",
  decision_material_changed: "cockpit.blocker.revision",
  decision_not_actionable: "cockpit.blocker.not_allowed",
  decision_legacy_blocked: "cockpit.blocker.not_allowed",
  recovery_blocked: "cockpit.blocker.other",
  recovery_not_awaiting_confirmation: "cockpit.blocker.other",
};
const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** `code` is set only for an unmapped, well-formed code shown verbatim next to the generic copy. */
export interface InboxBlocker { key: string; code: string | null }

/**
 * Server actionability for an inbox item. `null` means the item carries neither
 * field (legacy behaviour). Fail-closed: a non-boolean `actionable`, a
 * non-array code list or any code at all blocks the item; malformed entries
 * become the generic line and are never shown raw.
 */
export function inboxBlockers(item: unknown): { blocked: boolean; blockers: InboxBlocker[] } | null {
  if (!item || typeof item !== "object") return null;
  const record = item as { actionable?: unknown; blocking_reason_codes?: unknown };
  const hasFlag = "actionable" in record && record.actionable !== undefined;
  const hasCodes = "blocking_reason_codes" in record && record.blocking_reason_codes !== undefined;
  if (!hasFlag && !hasCodes) return null;
  const blockers: InboxBlocker[] = [];
  const add = (key: string, code: string | null) => {
    if (!blockers.some(entry => entry.key === key && entry.code === code)) blockers.push({ key, code });
  };
  if (hasCodes) {
    if (!Array.isArray(record.blocking_reason_codes)) add("cockpit.blocker.other", null);
    else for (const code of record.blocking_reason_codes) {
      if (typeof code === "string" && Object.hasOwn(BLOCKER_COPY, code)) add(BLOCKER_COPY[code], null);
      else if (typeof code === "string" && SAFE_CODE.test(code)) add("cockpit.blocker.other_code_label", code);
      else add("cockpit.blocker.other", null);
    }
  }
  if (hasFlag && record.actionable !== true && blockers.length === 0) {
    add(record.actionable === false ? "cockpit.blocker.not_allowed" : "cockpit.blocker.other", null);
  }
  return { blocked: blockers.length > 0, blockers };
}

export type DecisionStatusKey = "pending" | "expired" | "decided" | "approved" | "rejected";

/**
 * Badge state. A recorded `decision_state` wins and its action splits approved
 * from rejected; an absent or unknown action stays "decided". Without a
 * recorded state the legacy expired-then-status order is unchanged.
 */
export function decisionStatusKey(item: { status?: unknown; decision_state?: unknown }, expired: boolean): DecisionStatusKey {
  const state = item.decision_state && typeof item.decision_state === "object"
    ? item.decision_state as { status?: unknown; action?: unknown } : null;
  if (state?.status === "decided") {
    const action = typeof state.action === "string" ? state.action : "";
    return ADOPT_ACTIONS.has(action) ? "approved" : DECLINE_ACTIONS.has(action) ? "rejected" : "decided";
  }
  if (expired) return "expired";
  return item.status as DecisionStatusKey;
}

/**
 * The `?page=decisions&decision=<id>` target to apply now: only once the inbox
 * is ready, only for an id it contains, and only once per id.
 */
export function deepLinkTarget(
  decision: string | null,
  consumed: string | null,
  ready: boolean,
  items: ReadonlyArray<{ id: string }>,
): string | null {
  if (!decision || consumed === decision || !ready) return null;
  return items.some(item => item.id === decision) ? decision : null;
}
