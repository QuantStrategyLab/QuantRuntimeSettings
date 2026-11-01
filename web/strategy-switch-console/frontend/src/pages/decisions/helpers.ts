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
