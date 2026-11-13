/**
 * Research-promotion ticket keying, sync-token gate, and normalize/validate helpers.
 *
 * Pure ticket surface extracted from runtime_support. Platform/account helpers used
 * by validateResearchPromotionSelectedAccount are injected so this module never
 * imports runtime_support (avoids cycles).
 */

import { HttpError } from "../http_error.js";
import { BROKER_ENVIRONMENTS } from "../../account_options_schema.js";
import {
  DEFAULT_RESEARCH_PROMOTION_RISK_PROFILE,
  RESEARCH_PROMOTION_EXECUTION_MODES,
  RESEARCH_PROMOTION_RISK_PROFILES,
  RESEARCH_PROMOTION_STATES,
  RESEARCH_PROMOTION_TICKET_PREFIX,
  RESEARCH_PROMOTION_TICKET_SCHEMA,
} from "./constants.js";

export function requireDedicatedResearchPromotionSyncToken(request, env) {
  const expected = String(env.RESEARCH_PROMOTION_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("research promotion sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("research promotion sync token is invalid", 401);
}

export function researchPromotionTicketKey(ticketId) {
  return `${RESEARCH_PROMOTION_TICKET_PREFIX}${ticketId}`;
}

export function platformSupportsBrokerPaperMode(platform) {
  // Broker paper/sim is distinct from the local dry_run adapter. LongBridge's
  // paper account is currently the only configured broker simulation route.
  return platform === "longbridge";
}

export function supportedBrokerEnvironmentsForPlatform(platform) {
  return platformSupportsBrokerPaperMode(platform) ? [...BROKER_ENVIRONMENTS] : ["live"];
}

function assertExactFields(value, fields, fieldName) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`${fieldName} has invalid fields`);
  }
  return value;
}

function canonicalResearchTaskJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("research task must use finite JSON values");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalResearchTaskJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("research task must use JSON values");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalResearchTaskJson(value[key])}`).join(",")}}`;
}

export function normalizeResearchPromotionRiskProfile(value, fieldName) {
  const profile = String(value || "").trim().toUpperCase();
  if (!RESEARCH_PROMOTION_RISK_PROFILES.includes(profile)) {
    throw new Error(
      `${fieldName} must be CAPITAL_PRESERVATION, BALANCED_COMPOUNDING, or GROWTH_COMPOUNDING`,
    );
  }
  return profile;
}

export function normalizePromotionConfirmation(value, fieldName, { paperSupported }) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  // Keep exact QPK PromotionConfirmation.to_dict() fields.
  assertExactFields(value, ["target_platform", "execution_mode", "risk_profile"], fieldName);
  const targetPlatform = String(value.target_platform || "").trim();
  const executionMode = String(value.execution_mode || "").trim().toLowerCase();
  const riskProfile = normalizeResearchPromotionRiskProfile(
    value.risk_profile,
    `${fieldName}.risk_profile`,
  );
  if (!targetPlatform) throw new Error(`${fieldName}.target_platform is required`);
  if (!RESEARCH_PROMOTION_EXECUTION_MODES.includes(executionMode)) {
    throw new Error(`${fieldName}.execution_mode must be live or paper`);
  }
  if (executionMode === "paper" && !paperSupported) {
    throw new Error("paper is unavailable for this platform; synthetic matching is not supported");
  }
  return {
    target_platform: targetPlatform,
    execution_mode: executionMode,
    risk_profile: riskProfile,
  };
}

/**
 * @param {{
 *   ticket: any,
 *   selectedAccount: any,
 *   confirmation: any,
 *   accountOptions: any,
 *   strategyProfiles: any,
 * }} args
 * @param {{
 *   cleanChoice: Function,
 *   cleanSlug: Function,
 *   SUPPORTED_PLATFORMS: string[],
 *   BROKER_ENVIRONMENTS: string[],
 *   supportedBrokerEnvironmentsForPlatform?: Function,
 *   supportedDomainsForAccount: Function,
 *   PLATFORM_CONFIG: Record<string, any>,
 *   assertDcaPlatform: Function,
 *   cleanExecutionMode: Function,
 * }} deps
 */
export function validateResearchPromotionSelectedAccount({
  ticket,
  selectedAccount,
  confirmation,
  accountOptions,
  strategyProfiles,
}, deps) {
  const {
    cleanChoice,
    cleanSlug,
    SUPPORTED_PLATFORMS,
    BROKER_ENVIRONMENTS: brokerEnvironments,
    supportedBrokerEnvironmentsForPlatform: supportedBrokerEnvs = supportedBrokerEnvironmentsForPlatform,
    supportedDomainsForAccount,
    PLATFORM_CONFIG,
    assertDcaPlatform,
    cleanExecutionMode,
  } = deps;
  assertExactFields(selectedAccount, ["platform", "key"], "selected_account");
  const platform = cleanChoice(selectedAccount.platform, SUPPORTED_PLATFORMS, "selected_account.platform");
  const key = cleanSlug(selectedAccount.key, "selected_account.key");
  const targetPlatform = String(confirmation?.target_platform || "").trim();
  if (targetPlatform !== platform) {
    throw new HttpError("selected_account platform does not match confirmation target_platform", 409);
  }
  const option = (accountOptions?.[platform] || []).find((item) => item.key === key);
  if (!option) throw new HttpError("selected_account does not match configured account", 409);
  const brokerEnvironment = String(option.broker_environment || "").trim();
  if (!brokerEnvironments.includes(brokerEnvironment)) {
    throw new HttpError("selected account broker environment is unknown", 409);
  }
  if (!supportedBrokerEnvs(platform).includes(brokerEnvironment)) {
    throw new HttpError(`${platform} does not support broker environment ${brokerEnvironment}`, 400);
  }
  if (String(confirmation?.execution_mode || "").trim().toLowerCase() !== brokerEnvironment) {
    throw new HttpError("selected account broker environment does not match confirmation execution_mode", 409);
  }
  const strategy = (Array.isArray(strategyProfiles) ? strategyProfiles : [])
    .find((item) => item.profile === ticket?.strategy_profile);
  if (!strategy) throw new HttpError("selected candidate strategy profile is not configured", 409);
  if (strategy.domain !== ticket?.domain) {
    throw new HttpError("selected candidate strategy domain does not match ticket domain", 409);
  }
  if (!supportedDomainsForAccount(platform, option).includes(ticket.domain)) {
    throw new HttpError("selected account does not support candidate domain", 409);
  }
  if (PLATFORM_CONFIG[platform]?.dry_run_only) {
    throw new HttpError(`${platform} does not support broker execution`, 400);
  }
  assertDcaPlatform(platform, ticket.strategy_profile);
  if (!(strategy.allowed_execution_modes || []).includes(brokerEnvironment)) {
    throw new HttpError(`strategy ${strategy.profile} does not support broker environment ${brokerEnvironment}`, 400);
  }
  // A broker paper/live selection still needs the real adapter path. The
  // account's dry_run default is not an implicit paper capability.
  const adapterMode = cleanExecutionMode(
    option.default_execution_mode || PLATFORM_CONFIG[platform]?.default_execution_mode || "live",
  );
  if (adapterMode !== "live") {
    throw new HttpError("selected account adapter is not configured for broker execution", 400);
  }
  return { platform, key, broker_environment: brokerEnvironment };
}

export const RESEARCH_SUMMARY_HAN = /[\u4e00-\u9fff]/;
export const RESEARCH_SUMMARY_LATIN = /[A-Za-z]/;
export const RESEARCH_SUMMARY_DIGIT = /[0-9\uff10-\uff19]/;
export const RESEARCH_SUMMARY_LOCALE_FIELDS = ["question", "basis", "limits", "suggestion"];
const RESEARCH_SUMMARY_BINDING_FIELDS = [
  "ticket_id", "strategy_profile", "domain", "proposed_params", "comparison",
  "shadow_evidence_kind", "shadow_passed", "notes",
];
export const RESEARCH_SUMMARY_NEW_KEYS = ["status", "provider", "model", "scope", "locales", "binding"];
export const RESEARCH_SUMMARY_OLD_KEYS = ["status", "provider", "model", "text"];
export const RESEARCH_SUMMARY_HIDDEN = { status: "unavailable", text: "", provider: "", model: "" };

export function researchSummaryExactKeys(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function researchSummaryCodePointLength(text) {
  return Array.from(text).length;
}

export function researchSummarySegment(text, chinese) {
  if (typeof text !== "string" || !text.trim() || researchSummaryCodePointLength(text) > 240) return null;
  if (RESEARCH_SUMMARY_DIGIT.test(text)) return null;
  const hasHan = RESEARCH_SUMMARY_HAN.test(text);
  if (chinese) return hasHan ? text : null;
  if (hasHan || !RESEARCH_SUMMARY_LATIN.test(text)) return null;
  return text;
}

export function sameResearchSummaryMaterial(left, right) {
  return canonicalResearchTaskJson(left) === canonicalResearchTaskJson(right);
}

export function readBilingualResearchPromotionExplanation(ai, material) {
  if (ai.status !== "available" || (ai.provider !== "codex" && ai.provider !== "cursor")) return null;
  if (typeof ai.model !== "string" || !ai.model.trim() || ai.scope !== "candidate") return null;
  const locales = ai.locales;
  if (!researchSummaryExactKeys(locales, ["zh-CN", "en"])) return null;
  const savedLocales = {};
  for (const [name, chinese] of [["zh-CN", true], ["en", false]]) {
    const section = locales[name];
    if (!researchSummaryExactKeys(section, RESEARCH_SUMMARY_LOCALE_FIELDS)) return null;
    const saved = {};
    for (const field of RESEARCH_SUMMARY_LOCALE_FIELDS) {
      const segment = researchSummarySegment(section[field], chinese);
      if (segment == null) return null;
      saved[field] = segment;
    }
    savedLocales[name] = saved;
  }
  if (!researchSummaryExactKeys(ai.binding, RESEARCH_SUMMARY_BINDING_FIELDS)) return null;
  if (!sameResearchSummaryMaterial(ai.binding, material)) return null;
  return {
    status: "available",
    provider: ai.provider,
    model: ai.model,
    scope: "candidate",
    locales: savedLocales,
    binding: JSON.parse(canonicalResearchTaskJson(material)),
  };
}

export function readLegacyResearchPromotionExplanation(ai) {
  const status = String(ai.status || "").trim();
  if (status !== "available" && status !== "unavailable") return null;
  if (typeof ai.text !== "string" || typeof ai.provider !== "string" || typeof ai.model !== "string") return null;
  if (ai.text.length > 2000 || ai.model.length > 120) return null;
  if (status === "available" && (ai.provider !== "codex" || !ai.text.trim())) return null;
  if (status === "unavailable" && ai.provider !== "") return null;
  return {
    status,
    text: ai.text.trim(),
    provider: ai.provider,
    model: ai.model.trim(),
  };
}

export function normalizeSavedResearchPromotionExplanation(ai, material) {
  try {
    if (ai == null) return { ...RESEARCH_SUMMARY_HIDDEN };
    if (researchSummaryExactKeys(ai, RESEARCH_SUMMARY_NEW_KEYS)) {
      return readBilingualResearchPromotionExplanation(ai, material) || { ...RESEARCH_SUMMARY_HIDDEN };
    }
    if (researchSummaryExactKeys(ai, RESEARCH_SUMMARY_OLD_KEYS)) {
      return readLegacyResearchPromotionExplanation(ai) || { ...RESEARCH_SUMMARY_HIDDEN };
    }
    return { ...RESEARCH_SUMMARY_HIDDEN };
  } catch {
    return { ...RESEARCH_SUMMARY_HIDDEN };
  }
}

export function normalizeResearchPromotionSummary(raw, ticket, fieldName = "research_summary") {
  if (raw == null) return null;
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return null;
  try {
    const comparisonForBinding = raw.comparison;
    const identity = raw.identity;
    if (!identity || Array.isArray(identity) || typeof identity !== "object") return null;
    const identityParams = identity.proposed_params;
    if (
      String(identity.strategy_profile || "").trim() !== ticket.strategy_profile
      || String(identity.domain || "").trim() !== ticket.domain
      || !identityParams || Array.isArray(identityParams)
      || canonicalResearchTaskJson(identityParams) !== canonicalResearchTaskJson(ticket.proposed_params || {})
    ) return null;

    if (raw.strategy_description != null && typeof raw.strategy_description !== "string") return null;
    const strategyDescription = String(raw.strategy_description || "").trim();
    if (strategyDescription.length > 500) return null;

    let plugins = null;
    if (raw.plugins === null) {
      plugins = null;
    } else if (Array.isArray(raw.plugins)) {
      plugins = raw.plugins.map((plugin, index) => {
        if (!plugin || Array.isArray(plugin) || typeof plugin !== "object") {
          throw new Error(`${fieldName}.plugins[${index}] must be an object`);
        }
        if (typeof plugin.id !== "string" || typeof plugin.description !== "string") {
          throw new Error(`${fieldName}.plugins[${index}] must include text fields`);
        }
        const id = plugin.id.trim();
        const description = plugin.description.trim();
        if (id.length > 120 || description.length > 300) throw new Error(`${fieldName}.plugins[${index}] is too long`);
        return { id, description };
      });
    } else if (raw.plugins == null) {
      plugins = null;
    } else {
      return null;
    }

    const comparison = raw.comparison == null ? { status: "unavailable" } : raw.comparison;
    if (!comparison || Array.isArray(comparison) || typeof comparison !== "object") return null;
    const comparisonStatus = String(comparison.status || "").trim();
    if (comparisonStatus !== "comparable" && comparisonStatus !== "unavailable") return null;
    const optionalText = (value, name) => {
      if (value == null) return null;
      if (typeof value !== "string") throw new Error(`${fieldName}.${name} must be text or null`);
      const text = value.trim();
      if (text.length > 120) throw new Error(`${fieldName}.${name} is too long`);
      return text;
    };
    const exactCostModel = (value, name) => {
      if (value == null) return null;
      if (typeof value !== "string") throw new Error(`${fieldName}.${name} must be text or null`);
      if (value.length > 120) throw new Error(`${fieldName}.${name} is too long`);
      return value;
    };
    const normalizeMetrics = (value, name) => {
      if (!value || Array.isArray(value) || typeof value !== "object") {
        throw new Error(`${fieldName}.${name} must be an object`);
      }
      const cagr = value.cagr;
      const maxDrawdown = value.max_drawdown;
      if (typeof cagr !== "number" || typeof maxDrawdown !== "number"
        || !Number.isFinite(cagr) || !Number.isFinite(maxDrawdown)
        || cagr < -1 || maxDrawdown < -1 || maxDrawdown > 0) {
        throw new Error(`${fieldName}.${name} must use finite numbers`);
      }
      return { cagr, max_drawdown: maxDrawdown };
    };
    const normalizedComparison = {
      status: comparisonStatus,
      start_date: optionalText(comparison.start_date, "comparison.start_date"),
      end_date: optionalText(comparison.end_date, "comparison.end_date"),
      cost_model: exactCostModel(comparison.cost_model, "comparison.cost_model"),
      baseline: null,
      candidate: null,
    };
    if (comparisonStatus === "comparable") {
      if (!normalizedComparison.start_date || !normalizedComparison.end_date || !normalizedComparison.cost_model?.trim()) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedComparison.start_date)
        || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedComparison.end_date)) return null;
      const startMillis = Date.parse(`${normalizedComparison.start_date}T00:00:00Z`);
      const endMillis = Date.parse(`${normalizedComparison.end_date}T00:00:00Z`);
      if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis) || startMillis > endMillis) return null;
      normalizedComparison.baseline = normalizeMetrics(comparison.baseline, "comparison.baseline");
      normalizedComparison.candidate = normalizeMetrics(comparison.candidate, "comparison.candidate");
    } else {
      if (comparison.baseline != null) normalizeMetrics(comparison.baseline, "comparison.baseline");
      if (comparison.candidate != null) normalizeMetrics(comparison.candidate, "comparison.candidate");
    }

    if (!Array.isArray(raw.limitations) || raw.limitations.length > 8 || raw.limitations.some((item) => typeof item !== "string" || item.length > 300)) return null;
    const aiExplanation = normalizeSavedResearchPromotionExplanation(raw.ai_explanation, {
      ticket_id: ticket.ticket_id,
      strategy_profile: ticket.strategy_profile,
      domain: ticket.domain,
      proposed_params: ticket.proposed_params || {},
      comparison: comparisonForBinding,
      shadow_evidence_kind: ticket.shadow_evidence_kind,
      shadow_passed: ticket.shadow_passed,
      notes: Array.isArray(ticket.notes) ? ticket.notes : [],
    });

    return {
      identity: {
        strategy_profile: ticket.strategy_profile,
        domain: ticket.domain,
        proposed_params: ticket.proposed_params || {},
      },
      strategy_description: strategyDescription,
      plugins,
      comparison: normalizedComparison,
      limitations: raw.limitations.map((item) => item.trim()),
      ai_explanation: aiExplanation,
    };
  } catch {
    return null;
  }
}

export function normalizeResearchPromotionTicket(raw, fieldName = "research promotion ticket") {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  const ticketId = String(raw.ticket_id || "").trim();
  const strategyProfile = String(raw.strategy_profile || "").trim();
  const domain = String(raw.domain || "").trim();
  const state = String(raw.state || "").trim();
  if (!ticketId) throw new Error(`${fieldName}.ticket_id is required`);
  if (!strategyProfile) throw new Error(`${fieldName}.strategy_profile is required`);
  if (!domain) throw new Error(`${fieldName}.domain is required`);
  if (!RESEARCH_PROMOTION_STATES.includes(state)) {
    throw new Error(`${fieldName}.state is unsupported`);
  }
  if (raw.live_authority_granted === true) {
    throw new Error(`${fieldName}.live_authority_granted must remain false`);
  }
  const suggested = normalizeResearchPromotionRiskProfile(
    raw.suggested_risk_profile || DEFAULT_RESEARCH_PROMOTION_RISK_PROFILE,
    `${fieldName}.suggested_risk_profile`,
  );
  const driftStatus = String(raw.drift_status || "");
  const normalizedTicket = {
    schema: RESEARCH_PROMOTION_TICKET_SCHEMA,
    ticket_id: ticketId,
    strategy_profile: strategyProfile,
    domain,
    state,
    drift_status: driftStatus,
    drift_score: driftStatus === "new_research" && raw.drift_score === null
      ? null
      : Number(raw.drift_score || 0),
    created_at: String(raw.created_at || ""),
    updated_at: String(raw.updated_at || ""),
    budget: raw.budget && typeof raw.budget === "object" && !Array.isArray(raw.budget) ? raw.budget : {},
    proposed_params:
      raw.proposed_params && typeof raw.proposed_params === "object" && !Array.isArray(raw.proposed_params)
        ? raw.proposed_params
        : {},
    search_iterations: Number(raw.search_iterations || 0),
    shadow_evidence_kind: String(raw.shadow_evidence_kind || ""),
    // Qualification must never treat string values such as "false" as a
    // passed observation. Keep malformed legacy values unknown and let the
    // application gate reject them.
    shadow_passed: raw.shadow_passed === true ? true : raw.shadow_passed === false ? false : null,
    notification_subject: String(raw.notification_subject || ""),
    notification_body: String(raw.notification_body || ""),
    human_decision: String(raw.human_decision || ""),
    human_decided_at: String(raw.human_decided_at || ""),
    live_authority_granted: false,
    suggested_risk_profile: suggested,
    confirmation_target_platform: String(raw.confirmation_target_platform || ""),
    confirmation_execution_mode: String(raw.confirmation_execution_mode || ""),
    confirmation_risk_profile: String(raw.confirmation_risk_profile || ""),
    notes: Array.isArray(raw.notes) ? raw.notes.map((item) => String(item)) : [],
  };
  const researchSummary = normalizeResearchPromotionSummary(raw.research_summary, normalizedTicket, `${fieldName}.research_summary`);
  if (researchSummary) normalizedTicket.research_summary = researchSummary;
  return normalizedTicket;
}

export function attachPromotionQueueReadMetadata(record, ticket, authority) {
  // Reuse the queue's existing material observation. Unknown is not permission;
  // these fixed reasons describe stored intent material flags, not full decision
  // permission, ticket-hash validation, or account application gates.
  const migrated = typeof authority?.migrated === "boolean" ? authority.migrated : null;
  const eligible = migrated === true && typeof authority?.eligible === "boolean" ? authority.eligible : null;
  const blocked = migrated === true && typeof authority?.blocked === "boolean" ? authority.blocked : null;
  const blockerCodes = migrated !== true ? null
    : blocked === true ? ["human_decision_legacy_blocked"]
    : eligible === false ? ["human_decision_material_conflict"]
    : eligible === true && blocked === false ? [] : null;
  return {
    ...ticket,
    decision_material: { migrated, eligible, blocked, blocker_codes: blockerCodes },
    decision_review_binding: authority?.review_binding || null,
    // Timestamps of the already-read KV ticket record, not producer-observed
    // time, freshness, a validity window, or evidence of actual execution.
    ticket_record_timestamps: {
      created_at: typeof record?.created_at === "string" && record.created_at ? record.created_at : null,
      updated_at: typeof record?.updated_at === "string" && record.updated_at ? record.updated_at : null,
    },
  };
}
