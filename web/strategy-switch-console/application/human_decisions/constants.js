/**
 * Human-decision + promotion-review durable action / error constants.
 * Extracted from runtime_support for Wave5 Strangler Batch B.
 */

export const HUMAN_DECISION_DO_ACTIONS = new Set([
  "owner_sync_materials", "recovery_sync_materials", "promotion_sync_materials",
  "owner_decide", "recovery_decide", "promotion_decide",
  "owner_read", "recovery_read", "promotion_read",
]);

export const RESEARCH_PROMOTION_REVIEW_INVALID = "research_promotion_review_material_invalid";
