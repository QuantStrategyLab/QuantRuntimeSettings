/**
 * Research-promotion ticket HTTP use cases (sync / fetch / list / queue).
 *
 * Inject runtime_support-owned helpers (publish material, authority overlay,
 * review binding, account/strategy loaders) so this module never imports
 * runtime_support and cannot form a cycle.
 */

import { directoryList } from "../../kv_directory.js";
import { sourceListFailure } from "../console_api/read_failures.js";
import { decorateQueue } from "../console_api/presentation.js";
import { hasConfigStore, readConfigJson, writeConfigJson } from "../config_kv.js";
import { HttpError } from "../http_error.js";
import { json } from "../http_response.js";
import { attachRiskEnvelopeView } from "../risk_envelope.js";
import { hasRuntimeInstanceStore, runtimeInstanceCommand } from "../runtime_instances/command.js";
import { readSession } from "../auth/session.js";
import {
  RESEARCH_PROMOTION_MAX_BODY_BYTES,
  RESEARCH_PROMOTION_MAX_TICKETS,
  RESEARCH_PROMOTION_QUEUE_SCHEMA,
  RESEARCH_PROMOTION_TICKET_PREFIX,
} from "./constants.js";
import {
  attachPromotionQueueReadMetadata,
  normalizeResearchPromotionTicket,
  requireDedicatedResearchPromotionSyncToken,
  researchPromotionTicketKey,
} from "./tickets.js";

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   readBoundedJson: Function,
 *   publishHumanPromotionMaterial: Function,
 *   appendAuditLog: Function,
 * }} deps
 */
export async function syncResearchPromotionTicketResponse(request, env, deps) {
  const { readBoundedJson, publishHumanPromotionMaterial, appendAuditLog } = deps;
  requireDedicatedResearchPromotionSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "research promotion KV is not configured" }, 503);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, RESEARCH_PROMOTION_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid research promotion ticket" }, error.status || 400);
  }
  let ticket;
  try {
    ticket = normalizeResearchPromotionTicket(raw);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid research promotion ticket" }, 400);
  }
  if (ticket.state !== "awaiting_human") {
    return json(
      { ok: false, error: "research promotion sync only accepts awaiting_human tickets" },
      400,
    );
  }
  const existingRaw = await readConfigJson(env, researchPromotionTicketKey(ticket.ticket_id));
  let existing = null;
  if (existingRaw) {
    try {
      existing = normalizeResearchPromotionTicket(existingRaw, "stored research promotion ticket");
    } catch (error) {
      return json(
        { ok: false, error: error.message || "invalid stored research promotion ticket" },
        400,
      );
    }
  }
  let material;
  try {
    material = await publishHumanPromotionMaterial(env, ticket, existing);
  } catch (error) {
    return json({ ok: false, error: error.message || "research promotion material unavailable" }, error.status || 503);
  }
  if (material.identity_conflict) {
    return json(
      { ok: false, error: "refusing to overwrite awaiting_human research promotion ticket with mismatched candidate identity" },
      409,
    );
  }
  if (material.terminal || material.legacy_blocked) {
    return json(
      { ok: false, error: `refusing to overwrite terminal research promotion ticket state=${material.terminal_state || existing?.state || "human_accepted"}` },
      409,
    );
  }
  await writeConfigJson(env, researchPromotionTicketKey(ticket.ticket_id), ticket);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "research-promotion-ticket-sync",
      action: "sync_research_promotion_ticket",
      ticket_id: ticket.ticket_id,
      state: ticket.state,
      suggested_risk_profile: ticket.suggested_risk_profile,
      live_authority_granted: false,
    });
  } catch {
    // Intent sync must not depend on optional audit retention.
  }
  return json({
    ok: true,
    ticket_id: ticket.ticket_id,
    state: ticket.state,
    suggested_risk_profile: ticket.suggested_risk_profile,
    live_authority_granted: false,
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{ promotionTicketWithAuthority: Function }} deps
 */
export async function fetchResearchPromotionTicketResponse(request, env, deps) {
  const { promotionTicketWithAuthority } = deps;
  requireDedicatedResearchPromotionSyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "research promotion KV is not configured" }, 503);
  }
  const ticketId = String(new URL(request.url).searchParams.get("ticket_id") || "").trim();
  if (!ticketId) return json({ ok: false, error: "ticket_id is required" }, 400);
  const stored = await readConfigJson(env, researchPromotionTicketKey(ticketId));
  if (!stored) return json({ ok: false, error: "research promotion ticket not found" }, 404);
  let ticket;
  try {
    ticket = normalizeResearchPromotionTicket(stored);
    ticket = await promotionTicketWithAuthority(env, ticket);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid stored research promotion ticket" }, error.status || 400);
  }
  if (ticket.live_authority_granted) {
    return json({ ok: false, error: "refusing to expose live_authority_granted=true" }, 500);
  }
  return json({
    ok: true,
    ticket: attachRiskEnvelopeView(ticket),
    live_authority_granted: false,
  });
}

/**
 * @param {any} env
 * @param {{
 *   readHumanDecisionAuthority: Function,
 *   overlayPromotionDecision: Function,
 *   humanDecisionAuthorityView: Function,
 * }} deps
 */
export async function listResearchPromotionTickets(env, deps) {
  const {
    readHumanDecisionAuthority,
    overlayPromotionDecision,
    humanDecisionAuthorityView,
  } = deps;
  if (!hasConfigStore(env)) return [];
  let listing;
  try {
    listing = await directoryList(env, RESEARCH_PROMOTION_TICKET_PREFIX, RESEARCH_PROMOTION_MAX_TICKETS);
  } catch (error) {
    throw new HttpError(sourceListFailure(error, "research_promotion_source_list_unavailable"), 503);
  }
  const keys = listing?.keys || [];
  const tickets = [];
  for (const entry of keys) {
    const key = entry.name || entry;
    if (!String(key).startsWith(RESEARCH_PROMOTION_TICKET_PREFIX)) continue;
    const stored = await readConfigJson(env, key);
    if (!stored) throw new HttpError("kv_directory_record_unavailable", 503);
    try {
      const record = normalizeResearchPromotionTicket(stored, key);
      const authority = await readHumanDecisionAuthority(env, "promotion", record.ticket_id);
      const ticket = attachPromotionQueueReadMetadata(record, overlayPromotionDecision(record, authority), authority);
      if (ticket.live_authority_granted) continue;
      if (ticket.state === "awaiting_human") {
        // Project the same durable observation used by the decision metadata.
        ticket.decision_authority = humanDecisionAuthorityView(authority);
      }
      tickets.push(ticket);
    } catch (error) {
      if (error instanceof HttpError && error.status === 503) throw error;
      // Skip corrupt tickets rather than failing the whole queue.
    }
  }
  tickets.sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
  return tickets.slice(0, RESEARCH_PROMOTION_MAX_TICKETS);
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   exactHumanDecisionResponse: Function,
 *   listResearchPromotionTickets: Function,
 *   researchPromotionReviewBinding: Function,
 *   ResearchPromotionReviewMaterialError: Function,
 *   RESEARCH_PROMOTION_REVIEW_INVALID: string,
 *   researchPromotionMaterialKey: Function,
 *   promotionReviewBindingsMatch: Function,
 *   attachResearchPromotionApplicationPreparation: Function,
 *   loadAccountOptionsConfig: Function,
 *   loadStrategyProfilesConfig: Function,
 *   publicResearchPromotionApplication: Function,
 * }} deps
 */
export async function researchPromotionTicketsResponse(request, env, deps) {
  const {
    exactHumanDecisionResponse,
    listResearchPromotionTickets: listTickets,
    researchPromotionReviewBinding,
    ResearchPromotionReviewMaterialError,
    RESEARCH_PROMOTION_REVIEW_INVALID,
    researchPromotionMaterialKey,
    promotionReviewBindingsMatch,
    attachResearchPromotionApplicationPreparation,
    loadAccountOptionsConfig,
    loadStrategyProfilesConfig,
    publicResearchPromotionApplication,
  } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  const exact = await exactHumanDecisionResponse(request, env, session, "promotion");
  if (exact) return exact;
  const tickets = [];
  const invalidTickets = [];
  for (const ticket of await listTickets(env)) {
    let reviewBinding;
    try {
      reviewBinding = await researchPromotionReviewBinding(ticket);
    } catch (error) {
      if (!(error instanceof ResearchPromotionReviewMaterialError)) throw error;
      // Keep a bounded, explicit non-actionable diagnosis; never serialize the
      // invalid numbers as fake zero/null or certify this ticket with a digest.
      invalidTickets.push({
        ticket_id: ticket.ticket_id, strategy_profile: ticket.strategy_profile, state: ticket.state,
        decision_material: { eligible: false, blocked: true, blocker_codes: [RESEARCH_PROMOTION_REVIEW_INVALID] },
        decision_binding: null, live_authority_granted: false, no_order: true,
      });
      continue;
    }
    tickets.push({ ...ticket, decision_binding: {
      kind: "promotion", subject_id: ticket.ticket_id, material_sha256: await researchPromotionMaterialKey(ticket),
      review_binding: promotionReviewBindingsMatch(reviewBinding, ticket.decision_review_binding) ? reviewBinding : null,
    } });
  }
  const awaiting = tickets.filter((ticket) => ticket.state === "awaiting_human");
  const applicationTickets = tickets.filter((ticket) =>
    ticket.state === "awaiting_human" || ticket.state === "human_accepted");
  const accountConfig = await loadAccountOptionsConfig(env);
  const strategyProfiles = await loadStrategyProfilesConfig(env);
  const applications = [];
  for (const ticket of applicationTickets) {
    const preparation = attachResearchPromotionApplicationPreparation(ticket, accountConfig.options, strategyProfiles);
    let application = null;
    if (hasRuntimeInstanceStore(env)) {
      try {
        const stored = await runtimeInstanceCommand(env, { action: "application_latest", actor: session.login, ticket_id: ticket.ticket_id });
        application = publicResearchPromotionApplication(stored.application);
      } catch {
        // Application storage is optional for the research-only queue view.
      }
    }
    applications.push({ ...preparation, application });
  }
  return json({
    schema_version: RESEARCH_PROMOTION_QUEUE_SCHEMA,
    data_status: hasConfigStore(env) ? (invalidTickets.length ? "partial" : "ready") : "unavailable",
    computed_at: new Date().toISOString(),
    tickets: decorateQueue({ tickets: awaiting.map(attachRiskEnvelopeView) }, "tickets", "strategy_promotion").tickets,
    applications,
    ...(invalidTickets.length ? { invalid_tickets: invalidTickets } : {}),
    summary: {
      ticket_count: awaiting.length,
      awaiting_human: awaiting.length,
      application_count: applications.length,
      ...(invalidTickets.length ? { invalid_review_count: invalidTickets.length } : {}),
    },
    policy: {
      admin_required_to_decide: true,
      live_authority_granted: false,
      no_order: true,
      application_dispatch_allowed: false,
      activation_status: "not_connected",
      notice: "网页只记录晋级人工意图；确认不授予实盘权限，也不下单。",
    },
    errors: invalidTickets.length ? [RESEARCH_PROMOTION_REVIEW_INVALID] : [],
  });
}
