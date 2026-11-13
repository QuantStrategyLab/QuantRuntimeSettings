import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RESEARCH_PROMOTION_TICKET_PREFIX,
  RESEARCH_PROMOTION_TICKET_SCHEMA,
  RESEARCH_PROMOTION_QUEUE_SCHEMA,
  RESEARCH_PROMOTION_MAX_TICKETS,
  RESEARCH_PROMOTION_MAX_BODY_BYTES,
  RESEARCH_PROMOTION_STATES,
  RESEARCH_PROMOTION_RISK_PROFILES,
  RESEARCH_PROMOTION_EXECUTION_MODES,
  DEFAULT_RESEARCH_PROMOTION_RISK_PROFILE,
} from "../web/strategy-switch-console/application/research_promotion/constants.js";
import {
  requireDedicatedResearchPromotionSyncToken,
  researchPromotionTicketKey,
  platformSupportsBrokerPaperMode,
  supportedBrokerEnvironmentsForPlatform,
  normalizeResearchPromotionRiskProfile,
  normalizePromotionConfirmation,
  validateResearchPromotionSelectedAccount,
  normalizeResearchPromotionTicket,
  attachPromotionQueueReadMetadata,
  RESEARCH_SUMMARY_HIDDEN,
} from "../web/strategy-switch-console/application/research_promotion/tickets.js";
import {
  syncResearchPromotionTicketResponse,
  fetchResearchPromotionTicketResponse,
  listResearchPromotionTickets,
  researchPromotionTicketsResponse,
} from "../web/strategy-switch-console/application/research_promotion/http.js";
import { HttpError } from "../web/strategy-switch-console/application/http_error.js";
import {
  loadWorkerSurface,
  stripComments,
  surfaceDefinesFunction,
  surfaceImportsModule,
} from "./helpers/worker_surface.mjs";

const ticketModules = [
  "application/research_promotion/constants.js",
  "application/research_promotion/tickets.js",
  "application/research_promotion/http.js",
];

const surface = await loadWorkerSurface({
  applicationModules: ticketModules,
});
const { supportSource } = surface;

const constantsSource = await readFile(
  new URL("../web/strategy-switch-console/application/research_promotion/constants.js", import.meta.url),
  "utf8",
);
const ticketsSource = await readFile(
  new URL("../web/strategy-switch-console/application/research_promotion/tickets.js", import.meta.url),
  "utf8",
);
const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/research_promotion/http.js", import.meta.url),
  "utf8",
);

assert.equal(surfaceImportsModule(surface, "research_promotion/constants.js"), true);
assert.equal(surfaceImportsModule(surface, "research_promotion/tickets.js"), true);
assert.equal(surfaceImportsModule(surface, "research_promotion/http.js"), true);

for (const name of [
  "requireDedicatedResearchPromotionSyncToken",
  "researchPromotionTicketKey",
  "normalizeResearchPromotionTicket",
  "attachPromotionQueueReadMetadata",
  "syncResearchPromotionTicketResponse",
  "fetchResearchPromotionTicketResponse",
  "listResearchPromotionTickets",
  "researchPromotionTicketsResponse",
  "validateResearchPromotionSelectedAccount",
]) {
  assert.equal(surfaceDefinesFunction(surface, name), true, name);
}

assert.match(supportSource, /syncResearchPromotionTicketResponseImpl/);
assert.match(supportSource, /fetchResearchPromotionTicketResponseImpl/);
assert.match(supportSource, /listResearchPromotionTicketsImpl/);
assert.match(supportSource, /researchPromotionTicketsResponseImpl/);
assert.match(supportSource, /validateResearchPromotionSelectedAccountImpl/);

assert.equal(RESEARCH_PROMOTION_TICKET_PREFIX, "research_promotion_ticket:");
assert.equal(RESEARCH_PROMOTION_TICKET_SCHEMA, "qsl.research_promotion_ticket.v1");
assert.equal(RESEARCH_PROMOTION_QUEUE_SCHEMA, "qsl.research_promotion_ticket_queue.v1");
assert.equal(RESEARCH_PROMOTION_MAX_TICKETS, 100);
assert.equal(RESEARCH_PROMOTION_MAX_BODY_BYTES, 64 * 1024);
assert.equal(DEFAULT_RESEARCH_PROMOTION_RISK_PROFILE, "CAPITAL_PRESERVATION");
assert.deepEqual([...RESEARCH_PROMOTION_EXECUTION_MODES], ["live", "paper"]);
assert.equal(RESEARCH_PROMOTION_STATES.includes("awaiting_human"), true);
assert.equal(RESEARCH_PROMOTION_RISK_PROFILES.includes("CAPITAL_PRESERVATION"), true);

assert.equal(researchPromotionTicketKey("rpt_abc"), "research_promotion_ticket:rpt_abc");
assert.equal(platformSupportsBrokerPaperMode("longbridge"), true);
assert.equal(platformSupportsBrokerPaperMode("ibkr"), false);
assert.deepEqual(supportedBrokerEnvironmentsForPlatform("longbridge"), ["live", "paper"]);
assert.deepEqual(supportedBrokerEnvironmentsForPlatform("ibkr"), ["live"]);
assert.equal(normalizeResearchPromotionRiskProfile("balanced_compounding", "risk"), "BALANCED_COMPOUNDING");
assert.throws(() => normalizeResearchPromotionRiskProfile("NOPE", "risk"));

assert.deepEqual(
  normalizePromotionConfirmation(
    { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
    "confirmation",
    { paperSupported: true },
  ),
  { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
);
assert.throws(
  () => normalizePromotionConfirmation(
    { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
    "confirmation",
    { paperSupported: false },
  ),
  /paper is unavailable/,
);

const ticket = normalizeResearchPromotionTicket({
  ticket_id: "rpt_extract",
  strategy_profile: "synthetic",
  domain: "us_equity",
  state: "awaiting_human",
  proposed_params: { threshold: 1 },
  shadow_passed: true,
  shadow_evidence_kind: "synthetic",
  suggested_risk_profile: "CAPITAL_PRESERVATION",
});
assert.equal(ticket.schema, RESEARCH_PROMOTION_TICKET_SCHEMA);
assert.equal(ticket.live_authority_granted, false);
assert.equal(ticket.state, "awaiting_human");

const meta = attachPromotionQueueReadMetadata(ticket, ticket, {
  migrated: true,
  eligible: true,
  blocked: false,
  review_binding: null,
});
assert.deepEqual(meta.decision_material, {
  migrated: true,
  eligible: true,
  blocked: false,
  blocker_codes: [],
});
assert.equal(meta.ticket_record_timestamps.created_at, null);

assert.deepEqual(RESEARCH_SUMMARY_HIDDEN, {
  status: "unavailable",
  text: "",
  provider: "",
  model: "",
});

{
  const request = new Request("https://console.example/api/internal/research-promotion-tickets/sync", {
    method: "POST",
    headers: { Authorization: "Bearer bad" },
  });
  assert.throws(
    () => requireDedicatedResearchPromotionSyncToken(request, { RESEARCH_PROMOTION_SYNC_TOKEN: "expected" }),
    (error) => error instanceof HttpError && error.status === 401,
  );
}

{
  const validated = validateResearchPromotionSelectedAccount({
    ticket,
    selectedAccount: { platform: "longbridge", key: "paper" },
    confirmation: { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" },
    accountOptions: {
      longbridge: [{
        key: "paper",
        broker_environment: "paper",
        default_execution_mode: "live",
      }],
    },
    strategyProfiles: [{
      profile: "synthetic",
      domain: "us_equity",
      allowed_execution_modes: ["paper", "live"],
    }],
  }, {
    cleanChoice: (value, allowed) => {
      if (!allowed.includes(value)) throw new Error("invalid");
      return value;
    },
    cleanSlug: (value) => value,
    SUPPORTED_PLATFORMS: ["longbridge"],
    BROKER_ENVIRONMENTS: ["live", "paper"],
    supportedDomainsForAccount: () => ["us_equity"],
    PLATFORM_CONFIG: { longbridge: { dry_run_only: false, default_execution_mode: "live" } },
    assertDcaPlatform: () => {},
    cleanExecutionMode: (value) => (value === "paper" ? "dry_run" : value),
  });
  assert.deepEqual(validated, { platform: "longbridge", key: "paper", broker_environment: "paper" });
}

assert.equal(typeof syncResearchPromotionTicketResponse, "function");
assert.equal(typeof fetchResearchPromotionTicketResponse, "function");
assert.equal(typeof listResearchPromotionTickets, "function");
assert.equal(typeof researchPromotionTicketsResponse, "function");

for (const source of [constantsSource, ticketsSource, httpSource]) {
  const noComments = stripComments(source);
  assert.equal(
    /from\s+["'][^"']*runtime_support\.js["']/.test(noComments),
    false,
    "research_promotion ticket modules must not import runtime_support",
  );
  assert.equal(
    source.includes('from "./worker.js"')
      || source.includes("from '../worker.js'")
      || source.includes('from "../../worker.js"'),
    false,
    "research_promotion ticket modules must not import worker.js",
  );
}

assert.equal(
  /(?:export )?(?:async )?function (?:recordResearchPromotionDecisionResponse|publishHumanPromotionMaterial|researchPromotionReviewMaterial)\(/.test(
    stripComments(httpSource),
  ),
  false,
  "ticket HTTP extract must not own decision/review material publishers",
);
assert.match(httpSource, /publishHumanPromotionMaterial/, "sync path injects publishHumanPromotionMaterial via DI");

assert.equal(
  /FIRSTRADE|LONGPORT_HK|LB-HK/i.test(ticketsSource + httpSource + constantsSource),
  false,
  "ticket extract must not touch LB-HK / Firstrade env",
);

console.log("research_promotion ticket extract validation passed");
