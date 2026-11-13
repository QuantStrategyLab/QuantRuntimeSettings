/**
 * Research-promotion ticket / queue constants.
 * Extracted from runtime_support for Wave4 Strangler Batch B.
 */

// Research promotion tickets mirror QPK research_promotion_cycle.to_dict().
// Console may record human intent only; live_authority_granted stays false.
export const RESEARCH_PROMOTION_TICKET_PREFIX = "research_promotion_ticket:";
export const RESEARCH_PROMOTION_TICKET_SCHEMA = "qsl.research_promotion_ticket.v1";
export const RESEARCH_PROMOTION_QUEUE_SCHEMA = "qsl.research_promotion_ticket_queue.v1";
export const RESEARCH_PROMOTION_MAX_TICKETS = 100;
export const RESEARCH_PROMOTION_MAX_BODY_BYTES = 64 * 1024;
export const RESEARCH_PROMOTION_STATES = Object.freeze([
  "parked",
  "bounded_reopt",
  "shadow_recorded",
  "awaiting_human",
  "human_accepted",
  "human_rejected",
]);
export const RESEARCH_PROMOTION_RISK_PROFILES = Object.freeze([
  "CAPITAL_PRESERVATION",
  "BALANCED_COMPOUNDING",
  "GROWTH_COMPOUNDING",
]);
export const RESEARCH_PROMOTION_EXECUTION_MODES = Object.freeze(["live", "paper"]);
export const DEFAULT_RESEARCH_PROMOTION_RISK_PROFILE = "CAPITAL_PRESERVATION";
