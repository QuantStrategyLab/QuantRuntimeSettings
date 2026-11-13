import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  HUMAN_DECISION_DO_ACTIONS,
  RESEARCH_PROMOTION_REVIEW_INVALID,
} from "../web/strategy-switch-console/application/human_decisions/constants.js";
import {
  ResearchPromotionReviewMaterialError,
  humanDecisionRequestKey,
  researchPromotionMaterialKey,
  researchPromotionReviewMaterial,
  researchPromotionReviewBinding,
  promotionReviewBindingsMatch,
  promotionMaterialReviewBinding,
  recoveryDecisionMaterialKey,
  humanDecisionTimestamp,
  recoveryMaterialEligible,
  humanDecisionAuthorityView,
  overlayPromotionDecision,
  humanDecisionReceipt,
  humanDecisionMaterialSha256,
} from "../web/strategy-switch-console/application/human_decisions/helpers.js";
import {
  publishHumanOwnerMaterials,
  publishHumanRecoveryMaterials,
  publishHumanPromotionMaterial,
  exactHumanDecisionResponse,
  readHumanDecisionAuthority,
  promotionTicketWithAuthority,
} from "../web/strategy-switch-console/application/human_decisions/materials.js";
import { HttpError } from "../web/strategy-switch-console/application/http_error.js";
import {
  loadWorkerSurface,
  stripComments,
  surfaceDefinesFunction,
  surfaceImportsModule,
} from "./helpers/worker_surface.mjs";

const humanDecisionModules = [
  "application/human_decisions/constants.js",
  "application/human_decisions/helpers.js",
  "application/human_decisions/materials.js",
];

const surface = await loadWorkerSurface({
  includeDurableObject: true,
  applicationModules: humanDecisionModules,
});
const { supportSource, durableSource, wiredSource } = surface;

const constantsSource = await readFile(
  new URL("../web/strategy-switch-console/application/human_decisions/constants.js", import.meta.url),
  "utf8",
);
const helpersSource = await readFile(
  new URL("../web/strategy-switch-console/application/human_decisions/helpers.js", import.meta.url),
  "utf8",
);
const materialsSource = await readFile(
  new URL("../web/strategy-switch-console/application/human_decisions/materials.js", import.meta.url),
  "utf8",
);

assert.equal(surfaceImportsModule(surface, "human_decisions/constants.js"), true);
assert.equal(surfaceImportsModule(surface, "human_decisions/helpers.js"), true);
assert.equal(surfaceImportsModule(surface, "human_decisions/materials.js"), true);

for (const name of [
  "publishHumanOwnerMaterials",
  "publishHumanRecoveryMaterials",
  "publishHumanPromotionMaterial",
  "humanDecisionReceipt",
  "exactHumanDecisionResponse",
  "readHumanDecisionAuthority",
  "overlayPromotionDecision",
  "promotionTicketWithAuthority",
  "humanDecisionRequestKey",
  "researchPromotionMaterialKey",
  "researchPromotionReviewBinding",
  "recoveryDecisionMaterialKey",
  "humanDecisionTimestamp",
  "humanDecisionAuthorityView",
]) {
  assert.equal(surfaceDefinesFunction(surface, name), true, name);
}

assert.match(supportSource, /publishHumanOwnerMaterialsImpl/);
assert.match(supportSource, /publishHumanRecoveryMaterialsImpl/);
assert.match(supportSource, /publishHumanPromotionMaterialImpl/);
assert.match(supportSource, /humanDecisionReceiptImpl/);
assert.match(supportSource, /exactHumanDecisionResponseImpl/);
assert.match(supportSource, /readHumanDecisionAuthorityImpl/);
assert.match(supportSource, /overlayPromotionDecisionImpl/);
assert.match(supportSource, /promotionTicketWithAuthorityImpl/);
assert.match(supportSource, /humanDecisionOwnerMaterialDeps/);
assert.match(supportSource, /humanDecisionRecoveryMaterialDeps/);
assert.match(supportSource, /humanDecisionReceiptDeps/);
assert.match(supportSource, /humanDecisionPromotionDeps/);
assert.match(wiredSource, /HUMAN_DECISION_DO_ACTIONS/);
assert.match(durableSource, /HUMAN_DECISION_DO_ACTIONS/);
assert.match(durableSource, /promotionMaterialReviewBinding/);
assert.match(durableSource, /promotionReviewBindingsMatch/);

assert.equal(HUMAN_DECISION_DO_ACTIONS.has("owner_decide"), true);
assert.equal(HUMAN_DECISION_DO_ACTIONS.has("promotion_read"), true);
assert.equal(RESEARCH_PROMOTION_REVIEW_INVALID, "research_promotion_review_material_invalid");
assert.equal(new ResearchPromotionReviewMaterialError().status, 400);
assert.equal(new ResearchPromotionReviewMaterialError().message, RESEARCH_PROMOTION_REVIEW_INVALID);

assert.equal(humanDecisionTimestamp("2026-11-14T12:00:00.123Z"), "2026-11-14T12:00:00Z");
assert.equal(humanDecisionAuthorityView(null), null);
assert.deepEqual(
  humanDecisionAuthorityView({
    material_key: "a".repeat(64),
    expires_at: "2026-11-14T12:00:00Z",
    eligible: true,
    blocked: false,
    migrated: true,
  }),
  {
    material_sha256: "a".repeat(64),
    expires_at: "2026-11-14T12:00:00Z",
    eligible: true,
    blocked: false,
    unavailable: false,
    source: "durable_human_decision_material",
  },
);

const ticket = {
  ticket_id: "rpt_" + "1".repeat(64),
  strategy_profile: "demo_profile",
  domain: "us_equity",
  proposed_params: { a: 1 },
  shadow_passed: true,
  shadow_evidence_kind: "paper",
  drift_status: "ok",
  drift_score: 0,
  budget: 1,
  search_iterations: 1,
  suggested_risk_profile: "BALANCED_COMPOUNDING",
  notification_subject: "s",
  notification_body: "b",
  notes: [],
  research_summary: null,
};
const material = researchPromotionReviewMaterial(ticket);
assert.equal(material.schema_version, "qsl_promotion_review_material.v2");
assert.equal(material.ticket_id, ticket.ticket_id);

const key = await researchPromotionMaterialKey(ticket);
assert.match(key, /^[0-9a-f]{64}$/);
assert.equal(await humanDecisionMaterialSha256({
  ticket_id: ticket.ticket_id,
  strategy_profile: ticket.strategy_profile,
  domain: ticket.domain,
  proposed_params: ticket.proposed_params,
  shadow_passed: ticket.shadow_passed,
  shadow_evidence_kind: ticket.shadow_evidence_kind,
}), key);

const review = await researchPromotionReviewBinding(ticket);
assert.equal(review.schema_version, "qsl_promotion_review_binding.v2");
assert.match(review.review_sha256, /^[0-9a-f]{64}$/);
assert.equal(promotionReviewBindingsMatch(review, review), true);
assert.equal(promotionReviewBindingsMatch(review, { ...review, review_sha256: "b".repeat(64) }), false);
assert.deepEqual(
  promotionMaterialReviewBinding({ summary_json: JSON.stringify({ review_binding: review }) }),
  review,
);
assert.equal(promotionMaterialReviewBinding({ summary_json: "{" }), null);

const requestKey = await humanDecisionRequestKey({
  requestId: "req-1",
  kind: "promotion",
  actor: "a",
  subjectId: "s",
  materialKey: key,
  action: "accept",
  target: null,
});
assert.equal(requestKey, "id:promotion:req-1");
await assert.rejects(
  () => humanDecisionRequestKey({
    requestId: "bad id",
    kind: "promotion",
    actor: "a",
    subjectId: "s",
    materialKey: key,
    action: "accept",
    target: null,
  }),
  (error) => error instanceof HttpError && error.status === 400,
);

const recoveryKey = await recoveryDecisionMaterialKey({
  recovery_id: "rec_1",
  candidate_sha256: "c".repeat(64),
  dual_review: { evidence_binding_sha256: "c".repeat(64) },
});
assert.match(recoveryKey, /^[0-9a-f]{64}$/);

assert.equal(
  recoveryMaterialEligible(
    {
      readiness: "awaiting_human_confirmation",
      reconciliation_state: "RECONCILE_ONLY",
      blocker_codes: [],
      dual_review: { evidence_binding_sha256: "c".repeat(64) },
      candidate_sha256: "c".repeat(64),
      evidence_sample_count: 1,
    },
    { data_status: "ready" },
    { data_status: "ready" },
  ),
  true,
);

assert.equal(typeof publishHumanOwnerMaterials, "function");
assert.equal(typeof publishHumanRecoveryMaterials, "function");
assert.equal(typeof publishHumanPromotionMaterial, "function");
assert.equal(typeof exactHumanDecisionResponse, "function");
assert.equal(typeof readHumanDecisionAuthority, "function");
assert.equal(typeof promotionTicketWithAuthority, "function");
assert.equal(typeof overlayPromotionDecision, "function");
assert.equal(typeof humanDecisionReceipt, "function");

for (const sourceText of [constantsSource, helpersSource, materialsSource]) {
  const noComments = stripComments(sourceText);
  assert.equal(
    /from\s+["'][^"']*runtime_support\.js["']/.test(noComments),
    false,
    "human_decisions modules must not import runtime_support",
  );
  assert.equal(
    sourceText.includes('from "./worker.js"')
      || sourceText.includes("from '../worker.js'")
      || sourceText.includes('from "../../worker.js"'),
    false,
    "human_decisions modules must not import worker.js",
  );
}

assert.match(materialsSource, /ownerDecisionCandidateEvidenceSha256/, "owner publish injects evidence hash via DI");
assert.match(materialsSource, /normalizeReconciliationRecoveryConfirmation/, "recovery publish injects confirmation normalize via DI");
assert.match(materialsSource, /calculateReconciliationRecoveryConfirmationSha256/, "receipt injects recovery confirmation hash via DI");
assert.match(helpersSource, /normalizeResearchPromotionTicket/, "overlay injects ticket normalize via DI");

assert.equal(
  /(?:export )?(?:async )?function (?:calculateOwnerDecisionSha256|ownerDecisionCurrentKey|normalizeOwnerDecisionIntent)\(/.test(
    helpersSource + materialsSource + constantsSource,
  ),
  false,
  "human_decisions extract must leave owner-decision normalize/hash ownership in runtime_support",
);

console.log("human_decisions_extract_validation: ok");
