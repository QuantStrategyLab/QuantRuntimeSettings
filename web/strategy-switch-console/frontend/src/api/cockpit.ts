import { AccessError, HttpError, getJson, postJson } from "./client";
import type { Category, InboxItem, InboxResponse, NotificationSendLog, StrategySummary } from "./contracts";

/**
 * Decision-cockpit contracts and adapters.
 *
 * The backend paths are proposed in ARCHITECTURE.md and may not be deployed
 * yet. Every adapter distinguishes "the server said no" from "the endpoint is
 * not available": a 404/501 becomes `not_ready`, never fabricated data. Only a
 * session explicitly marked synthetic may render the labeled fixtures below.
 */

export type RiskTier = "CAPITAL_PRESERVATION" | "BALANCED_COMPOUNDING" | "GROWTH_COMPOUNDING";
export type ProductStage = "research" | "paper" | "small_live" | "full_live";
export type StageAxis = ProductStage | "unclassified";
export type DecisionState = "pending" | "approved" | "rejected" | "expired" | "superseded" | "withdrawn";
export type DecisionAction = "approve" | "reject" | "withdraw";
export type EvidenceState = "current" | "stale" | "missing" | "expired" | "unavailable";
export type Qualification = "qualified" | "unqualified" | "unknown";
export type OperatingState = "running" | "paused" | "reduction_only" | "reconcile_only" | "unknown";
export type ApplicationState = "pending" | "applying" | "applied" | "rejected" | "failed" | "unknown";

export interface EvidenceSummary {
  evidence_id: string | null;
  label_key: string | null;
  observed_at: string | null;
  valid_until: string | null;
  state: EvidenceState;
  qualification: Qualification;
  limitations: string[];
}

export interface PolicyValue {
  key: string;
  label_key: string | null;
  value: number | string | null;
  unit: string | null;
  status: "known" | "unknown" | "unavailable";
  source: string | null;
}

export interface PolicyBinding {
  scope: string;
  selected_tier: RiskTier | null;
  selection_revision: number | null;
  approved_tier: RiskTier | null;
  approved_policy_id: string | null;
  approved_policy_revision: string | null;
  effective_tier: RiskTier | null;
  effective_policy_id: string | null;
  effective_policy_revision: string | null;
  effective_observed_at: string | null;
  temporary_restriction: { active: boolean; reason: string | null; until: string | null } | null;
  values: PolicyValue[];
}

export interface DecisionDetail {
  decision_id: string;
  short_id: string;
  category: Category;
  revision: number;
  state: DecisionState;
  title_key: string;
  account_alias: string | null;
  platform: string | null;
  release_id: string | null;
  target_id: string | null;
  from_stage: ProductStage | null;
  to_stage: ProductStage | null;
  evidence: EvidenceSummary | null;
  policy: {
    selected_tier: RiskTier | null;
    policy_id: string | null;
    policy_revision: string | null;
    summary: string | null;
    values: PolicyValue[];
  } | null;
  created_at: string | null;
  expires_at: string | null;
  server_time: string | null;
  allowed_actions: DecisionAction[];
  blocking_reasons: string[];
  operation_id: string | null;
  receipt: { recorded_at: string | null; revision: number | null } | null;
}

export interface OperationRecord {
  operation_id: string;
  request_id: string;
  decision_id: string | null;
  decision_revision: number | null;
  action: DecisionAction | null;
  title_key: string | null;
  account_alias: string | null;
  platform: string | null;
  release_id: string | null;
  target_id: string | null;
  state: ApplicationState;
  recorded_at: string | null;
  dispatched_at: string | null;
  applied_at: string | null;
  applied_by: "platform" | null;
  runtime_confirmed_at: string | null;
  runtime_state: OperatingState;
  failure_reason: string | null;
  unknown_reason: string | null;
  readback_available: boolean | null;
  server_time: string | null;
}

export interface LifecycleBinding {
  profile: string;
  account_alias: string | null;
  platform: string | null;
  target_id: string | null;
  release_id: string | null;
  /** False when the payload carried no lifecycle record; axes are then not inferred. */
  present: boolean;
  research_stage: StageAxis;
  authorized_stage: StageAxis;
  effective_stage: StageAxis;
  operating_state: OperatingState;
  application_state: ApplicationState;
  observed_at: string | null;
  evidence: EvidenceSummary | null;
  regime_effect: string | null;
}

export interface DigestTargetCount {
  label: string;
  known: boolean;
}

export interface DigestStatus {
  business_day: string | null;
  timezone: string | null;
  expected_targets: number | null;
  covered_targets: number | null;
  unavailable_targets: number | null;
  delivery_state: "accepted" | "delivered" | "failed" | "unknown" | "unavailable";
  accepted_at: string | null;
  acknowledged_at: string | null;
  source_as_of: string | null;
  legacy_receipts: boolean;
  targets: DigestTargetCount[];
}

export interface AuditEvent {
  event_id: string;
  occurred_at: string;
  actor: string | null;
  action: string;
  subject: string | null;
  revision: number | null;
  decision_id: string | null;
  operation_id: string | null;
  outcome: string | null;
}

export type CockpitRead<T> =
  | { status: "ready"; data: T; synthetic: boolean }
  | { status: "not_ready" };

export class MutationOutcomeUnknown extends Error {
  readonly requestId: string;
  readonly operationId: string | null;
  constructor(requestId: string, operationId: string | null) {
    super("mutation_outcome_unknown");
    this.requestId = requestId;
    this.operationId = operationId;
  }
}

export interface DecisionActionRequest {
  decision_id: string;
  action: DecisionAction;
  expected_revision: number;
  request_id: string;
  /** The exact server-bound policy the confirmation displayed, never a client choice. */
  selected_tier: RiskTier | null;
  policy_revision: string | null;
  note?: string;
}

export interface DecisionActionResponse {
  operation: OperationRecord | null;
  state: DecisionState | null;
  revision: number | null;
}

export function isRiskTier(value: unknown): value is RiskTier {
  return value === "CAPITAL_PRESERVATION" || value === "BALANCED_COMPOUNDING" || value === "GROWTH_COMPOUNDING";
}

export function isProductStage(value: unknown): value is ProductStage {
  return value === "research" || value === "paper" || value === "small_live" || value === "full_live";
}

export function asStage(value: unknown): StageAxis {
  return isProductStage(value) ? value : "unclassified";
}

export function asDecisionAction(value: unknown): DecisionAction | null {
  return value === "approve" || value === "reject" || value === "withdraw" ? value : null;
}

export function newRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Approval stays unavailable until the server says the action is allowed, the
 * displayed revision is current, and the evidence is current and qualified.
 * This is a presentation check only; the server remains authoritative.
 */
export function actionBlockers(
  decision: Pick<DecisionDetail, "state" | "allowed_actions" | "expires_at" | "evidence" | "revision" | "policy">,
  view: { serverTime: string | null; receivedAt: string; now: number },
): string[] {
  const blockers: string[] = [];
  const expiry = expiryState(decision.expires_at, view.serverTime, view.receivedAt, view.now);
  if (decision.state !== "pending") blockers.push(`state_${decision.state}`);
  if (expiry.state === "expired") blockers.push("decision_expired");
  if (expiry.state === "unknown" && decision.expires_at) blockers.push("expiry_unverified");
  if (!decision.allowed_actions.includes("approve")) blockers.push("approval_not_allowed");
  if (!decision.evidence) blockers.push("evidence_missing");
  else if (decision.evidence.state !== "current") blockers.push(`evidence_${decision.evidence.state}`);
  else if (decision.evidence.qualification !== "qualified") blockers.push("evidence_unqualified");
  if (!decision.policy) blockers.push("policy_unavailable");
  else if (!decision.policy.selected_tier || !decision.policy.policy_revision) blockers.push("policy_binding_missing");
  if (!Number.isSafeInteger(decision.revision) || decision.revision < 0) blockers.push("revision_invalid");
  return blockers;
}

export type ExpiryState =
  | { state: "none" }
  | { state: "unknown"; expiresAt: string }
  | { state: "expired"; expiresAt: string; serverNow: number }
  | { state: "open"; expiresAt: string; remainingMs: number };

/**
 * Expiry is evaluated against the server clock plus only the elapsed time
 * since the bundle was received. A wrong local clock can make the warning
 * later, never earlier; it can never extend the server-enforced window.
 */
export function expiryState(
  expiresAt: string | null,
  serverTime: string | null,
  receivedAt: string,
  now: number,
): ExpiryState {
  if (!expiresAt) return { state: "none" };
  const expiry = Date.parse(expiresAt);
  const server = serverTime ? Date.parse(serverTime) : Number.NaN;
  const received = Date.parse(receivedAt);
  if (!Number.isFinite(expiry) || !Number.isFinite(server) || !Number.isFinite(received)) {
    return { state: "unknown", expiresAt };
  }
  const serverNow = server + Math.max(0, now - received);
  if (serverNow >= expiry) return { state: "expired", expiresAt, serverNow };
  return { state: "open", expiresAt, remainingMs: expiry - serverNow };
}

function notReady(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 404 || error.status === 501);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeEvidence(value: unknown): EvidenceSummary | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const state = raw.state === "current" || raw.state === "stale" || raw.state === "missing"
    || raw.state === "expired" || raw.state === "unavailable" ? raw.state : "unavailable";
  const qualification = raw.qualification === "qualified" || raw.qualification === "unqualified"
    ? raw.qualification : "unknown";
  const limitations = Array.isArray(raw.limitations)
    ? raw.limitations.filter((item): item is string => typeof item === "string") : [];
  return {
    evidence_id: asString(raw.evidence_id),
    label_key: asString(raw.label_key),
    observed_at: asString(raw.observed_at),
    valid_until: asString(raw.valid_until),
    state,
    qualification,
    limitations,
  };
}

function normalizeValues(value: unknown): PolicyValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PolicyValue[] => {
    const raw = asRecord(item);
    if (!raw || typeof raw.key !== "string") return [];
    const status = raw.status === "known" || raw.status === "unknown" || raw.status === "unavailable" ? raw.status : "unknown";
    return [{
      key: raw.key,
      label_key: asString(raw.label_key),
      value: typeof raw.value === "number" || typeof raw.value === "string" ? raw.value : null,
      unit: asString(raw.unit),
      status,
      source: asString(raw.source),
    }];
  });
}

function normalizeOperation(value: unknown): OperationRecord | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const applicationStates: ApplicationState[] = ["pending", "applying", "applied", "rejected", "failed", "unknown"];
  const operatingStates: OperatingState[] = ["running", "paused", "reduction_only", "reconcile_only", "unknown"];
  const state = applicationStates.includes(raw.state as ApplicationState) ? raw.state as ApplicationState : "unknown";
  const runtimeState = operatingStates.includes(raw.runtime_state as OperatingState) ? raw.runtime_state as OperatingState : "unknown";
  return {
    operation_id: asString(raw.operation_id) ?? "",
    request_id: asString(raw.request_id) ?? "",
    decision_id: asString(raw.decision_id),
    decision_revision: asNumber(raw.decision_revision),
    action: asDecisionAction(raw.action),
    title_key: asString(raw.title_key),
    account_alias: asString(raw.account_alias),
    platform: asString(raw.platform),
    release_id: asString(raw.release_id),
    target_id: asString(raw.target_id),
    state,
    recorded_at: asString(raw.recorded_at),
    dispatched_at: asString(raw.dispatched_at),
    applied_at: asString(raw.applied_at),
    applied_by: raw.applied_by === "platform" ? "platform" : null,
    runtime_confirmed_at: asString(raw.runtime_confirmed_at),
    runtime_state: runtimeState,
    failure_reason: asString(raw.failure_reason),
    unknown_reason: asString(raw.unknown_reason),
    readback_available: asBoolean(raw.readback_available),
    server_time: asString(raw.server_time),
  };
}

function normalizeDecision(value: unknown, fallback: { id: string; shortId: string; category: Category; titleKey: string }): DecisionDetail {
  const raw = asRecord(value) ?? {};
  const states: DecisionState[] = ["pending", "approved", "rejected", "expired", "superseded", "withdrawn"];
  const state = states.includes(raw.state as DecisionState) ? raw.state as DecisionState : "pending";
  const allowed = Array.isArray(raw.allowed_actions)
    ? raw.allowed_actions.map(asDecisionAction).filter((item): item is DecisionAction => item !== null)
    : [];
  const policy = asRecord(raw.policy);
  const receipt = asRecord(raw.receipt);
  const expiry = raw.expires_at === null || typeof raw.expires_at === "string" ? raw.expires_at : null;
  return {
    decision_id: asString(raw.decision_id) ?? fallback.id,
    short_id: asString(raw.short_id) ?? fallback.shortId,
    category: (typeof raw.category === "string" ? raw.category : fallback.category) as Category,
    revision: asNumber(raw.revision) ?? -1,
    state,
    title_key: asString(raw.title_key) ?? fallback.titleKey,
    account_alias: asString(raw.account_alias),
    platform: asString(raw.platform),
    release_id: asString(raw.release_id),
    target_id: asString(raw.target_id),
    from_stage: isProductStage(raw.from_stage) ? raw.from_stage : null,
    to_stage: isProductStage(raw.to_stage) ? raw.to_stage : null,
    evidence: normalizeEvidence(raw.evidence),
    policy: policy ? {
      selected_tier: isRiskTier(policy.selected_tier) ? policy.selected_tier : null,
      policy_id: asString(policy.policy_id),
      policy_revision: asString(policy.policy_revision),
      summary: asString(policy.summary),
      values: normalizeValues(policy.values),
    } : null,
    created_at: asString(raw.created_at),
    expires_at: expiry,
    server_time: asString(raw.server_time),
    allowed_actions: allowed,
    blocking_reasons: Array.isArray(raw.blocking_reasons)
      ? raw.blocking_reasons.filter((item): item is string => typeof item === "string") : [],
    operation_id: asString(raw.operation_id),
    receipt: receipt ? { recorded_at: asString(receipt.recorded_at), revision: asNumber(receipt.revision) } : null,
  };
}

type ExpandedInboxItem = InboxItem & {
  revision?: unknown;
  allowed_actions?: unknown;
  from_stage?: unknown;
  to_stage?: unknown;
  risk_impact?: unknown;
  evidence?: unknown;
  operation_id?: unknown;
  application_state?: unknown;
};

/** One authoritative bundle per decision. Synthetic data is produced only for a labeled synthetic session. */
export async function loadDecisionDetail(
  decisionId: string,
  options: { synthetic?: boolean; inbox?: InboxResponse | null } = {},
): Promise<CockpitRead<DecisionDetail>> {
  if (options.synthetic) {
    const fromInbox = options.inbox?.items.find(item => item.id === decisionId) as ExpandedInboxItem | undefined;
    return { status: "ready", synthetic: true, data: syntheticDecision(fromInbox) };
  }
  try {
    const payload = await getJson<unknown>(`/api/decisions/${encodeURIComponent(decisionId)}`);
    const item = options.inbox?.items.find(entry => entry.id === decisionId);
    return {
      status: "ready",
      synthetic: false,
      data: normalizeDecision(payload, {
        id: decisionId,
        shortId: item?.short_id ?? decisionId,
        category: item?.category ?? "owner_decision",
        titleKey: item?.title_key ?? "decision.unknown",
      }),
    };
  } catch (error) {
    if (notReady(error)) return { status: "not_ready" };
    throw error;
  }
}

/**
 * Submit an owner action bound to the displayed revision and a stable request
 * identity. A timeout or transport failure is an unknown outcome, not a
 * failure: the caller keeps the identity and reconciles, never resubmits.
 */
export async function submitDecisionAction(request: DecisionActionRequest): Promise<DecisionActionResponse> {
  try {
    const payload = await postJson<unknown>(`/api/decisions/${encodeURIComponent(request.decision_id)}/actions`, {
      action: request.action,
      expected_revision: request.expected_revision,
      request_id: request.request_id,
      selected_tier: request.selected_tier,
      policy_revision: request.policy_revision,
      ...(request.note ? { note: request.note } : {}),
    });
    const raw = asRecord(payload) ?? {};
    const states: DecisionState[] = ["pending", "approved", "rejected", "expired", "superseded", "withdrawn"];
    return {
      operation: normalizeOperation(raw.operation),
      state: states.includes(raw.state as DecisionState) ? raw.state as DecisionState : null,
      revision: asNumber(raw.revision),
    };
  } catch (error) {
    if (error instanceof AccessError || error instanceof HttpError) throw error;
    throw new MutationOutcomeUnknown(request.request_id, null);
  }
}

export async function loadOperation(operationId: string, synthetic = false): Promise<CockpitRead<OperationRecord>> {
  if (synthetic) return { status: "ready", synthetic: true, data: syntheticOperation(operationId) };
  try {
    const payload = await getJson<unknown>(`/api/operations/${encodeURIComponent(operationId)}`);
    const operation = normalizeOperation(payload);
    return operation ? { status: "ready", data: operation, synthetic: false } : { status: "not_ready" };
  } catch (error) {
    if (notReady(error)) return { status: "not_ready" };
    throw error;
  }
}

function normalizeBinding(raw: Record<string, unknown>, scope: string): PolicyBinding {
  const restriction = asRecord(raw.temporary_restriction);
  return {
    scope,
    selected_tier: isRiskTier(raw.selected_tier) ? raw.selected_tier : null,
    selection_revision: asNumber(raw.selection_revision),
    approved_tier: isRiskTier(raw.approved_tier) ? raw.approved_tier : null,
    approved_policy_id: asString(raw.approved_policy_id),
    approved_policy_revision: asString(raw.approved_policy_revision),
    effective_tier: isRiskTier(raw.effective_tier) ? raw.effective_tier : null,
    effective_policy_id: asString(raw.effective_policy_id),
    effective_policy_revision: asString(raw.effective_policy_revision),
    effective_observed_at: asString(raw.effective_observed_at),
    temporary_restriction: restriction ? {
      active: restriction.active === true,
      reason: asString(restriction.reason),
      until: asString(restriction.until),
    } : null,
    values: normalizeValues(raw.values ?? raw.limits),
  };
}

/** Selected, approved and effective policy stay separate; missing parts stay null. */
export async function loadPolicyBinding(scope: string, synthetic = false): Promise<CockpitRead<PolicyBinding>> {
  if (synthetic) return { status: "ready", synthetic: true, data: syntheticBinding(scope) };
  try {
    const params = new URLSearchParams({ scope });
    const payload = await getJson<unknown>(`/api/risk-profiles?${params}`);
    const raw = asRecord(payload);
    const binding = asRecord(raw?.binding) ?? asRecord(raw?.policy_binding);
    if (!binding) return { status: "not_ready" };
    return { status: "ready", data: normalizeBinding(binding, scope), synthetic: false };
  } catch (error) {
    if (notReady(error)) return { status: "not_ready" };
    throw error;
  }
}

/** Per-release lifecycle axes; absent axes stay unclassified rather than inferred. */
export async function loadLifecycles(summary: StrategySummary, synthetic = false): Promise<CockpitRead<LifecycleBinding[]>> {
  if (synthetic) return { status: "ready", synthetic: true, data: syntheticLifecycles() };
  const lifecycles: LifecycleBinding[] = [];
  for (const strategy of summary.strategies) {
    const raw = asRecord((strategy as unknown as Record<string, unknown>).lifecycle);
    for (const account of strategy.configured_accounts) {
      const perTarget = asRecord((account as unknown as Record<string, unknown>).lifecycle) ?? raw;
      lifecycles.push({
        profile: strategy.profile,
        account_alias: account.account_alias,
        platform: account.platform,
        target_id: asString(perTarget?.target_id),
        release_id: asString(perTarget?.release_id),
        present: Boolean(perTarget),
        research_stage: asStage(perTarget?.research_stage),
        authorized_stage: asStage(perTarget?.authorized_stage),
        effective_stage: asStage(perTarget?.effective_stage),
        operating_state: ["running", "paused", "reduction_only", "reconcile_only", "unknown"]
          .includes(perTarget?.operating_state as string) ? perTarget?.operating_state as OperatingState : "unknown",
        application_state: ["pending", "applying", "applied", "rejected", "failed", "unknown"]
          .includes(perTarget?.application_state as string) ? perTarget?.application_state as ApplicationState : "unknown",
        observed_at: asString(perTarget?.observed_at),
        evidence: normalizeEvidence(perTarget?.evidence),
        regime_effect: asString(perTarget?.regime_effect),
      });
    }
  }
  return { status: "ready", data: lifecycles, synthetic: false };
}

/** Production digest projection; legacy GitHub Actions receipts are labeled, not merged. */
export async function loadDigestStatus(log: NotificationSendLog, synthetic = false): Promise<CockpitRead<DigestStatus>> {
  if (synthetic) return { status: "ready", synthetic: true, data: syntheticDigest() };
  const raw = asRecord((log as unknown as Record<string, unknown>).digest);
  if (!raw) {
    return {
      status: "ready",
      synthetic: false,
      data: {
        business_day: null,
        timezone: null,
        expected_targets: null,
        covered_targets: null,
        unavailable_targets: null,
        delivery_state: "unavailable",
        accepted_at: null,
        acknowledged_at: null,
        source_as_of: log.as_of,
        legacy_receipts: true,
        targets: [],
      },
    };
  }
  const state = raw.delivery_state;
  const delivery = state === "accepted" || state === "delivered" || state === "failed" || state === "unknown"
    ? state : "unavailable";
  return {
    status: "ready",
    synthetic: false,
    data: {
      business_day: asString(raw.business_day),
      timezone: asString(raw.timezone),
      expected_targets: asNumber(raw.expected_targets),
      covered_targets: asNumber(raw.covered_targets),
      unavailable_targets: asNumber(raw.unavailable_targets),
      delivery_state: delivery,
      accepted_at: asString(raw.accepted_at),
      acknowledged_at: asString(raw.acknowledged_at),
      source_as_of: asString(raw.source_as_of),
      legacy_receipts: false,
      targets: [],
    },
  };
}

export async function loadAuditEvents(cursor: string | null = null, synthetic = false): Promise<CockpitRead<AuditEvent[]>> {
  if (synthetic) return { status: "ready", synthetic: true, data: syntheticAudit() };
  try {
    const params = new URLSearchParams({ limit: "25" });
    if (cursor) params.set("cursor", cursor);
    const payload = await getJson<unknown>(`/api/audit-events?${params}`);
    const raw = asRecord(payload);
    const items = Array.isArray(raw?.events) ? raw.events : Array.isArray(raw?.items) ? raw.items : [];
    const events = items.flatMap((item): AuditEvent[] => {
      const event = asRecord(item);
      if (!event) return [];
      return [{
        event_id: asString(event.event_id) ?? "",
        occurred_at: asString(event.occurred_at) ?? "",
        actor: asString(event.actor),
        action: asString(event.action) ?? "unknown",
        subject: asString(event.subject),
        revision: asNumber(event.revision),
        decision_id: asString(event.decision_id),
        operation_id: asString(event.operation_id),
        outcome: asString(event.outcome),
      }];
    });
    return { status: "ready", data: events, synthetic: false };
  } catch (error) {
    if (notReady(error)) return { status: "not_ready" };
    throw error;
  }
}

/* ---------- synthetic fixtures: fictional, labeled, never production ---------- */

function syntheticDecision(item?: ExpandedInboxItem): DecisionDetail {
  const id = item?.id ?? "synthetic-decision-001";
  return normalizeDecision({
    decision_id: id,
    short_id: item?.short_id ?? "S-DEMO-1",
    category: item?.category ?? "strategy_promotion",
    revision: 3,
    state: "pending",
    title_key: "decision.promotion_title",
    account_alias: "demo_account",
    platform: "ibkr",
    release_id: "demo-release-2026.10",
    target_id: "demo-target",
    from_stage: "paper",
    to_stage: "small_live",
    evidence: {
      evidence_id: "synthetic-evidence",
      observed_at: "2026-10-31T13:00:00Z",
      valid_until: "2026-11-02T13:00:00Z",
      state: "current",
      qualification: "qualified",
      limitations: [],
    },
    policy: {
      selected_tier: "BALANCED_COMPOUNDING",
      policy_id: "synthetic-policy",
      policy_revision: "r7",
      summary: null,
      values: [
        { key: "max_gross_exposure", value: 45, unit: "percent", status: "known", source: "server" },
        { key: "cash_floor", value: 20, unit: "percent", status: "known", source: "server" },
      ],
    },
    created_at: "2026-11-01T09:00:00Z",
    expires_at: "2026-11-02T09:00:00Z",
    server_time: new Date().toISOString(),
    allowed_actions: ["approve", "reject"],
    blocking_reasons: [],
    operation_id: null,
    receipt: null,
  }, { id, shortId: item?.short_id ?? "S-DEMO-1", category: item?.category ?? "strategy_promotion", titleKey: "decision.promotion_title" });
}

function syntheticOperation(id: string): OperationRecord {
  return {
    operation_id: id,
    request_id: "synthetic-request",
    decision_id: "synthetic-decision-001",
    decision_revision: 3,
    action: "approve",
    title_key: "decision.promotion_title",
    account_alias: "demo_account",
    platform: "ibkr",
    release_id: "demo-release-2026.10",
    target_id: "demo-target",
    state: "applying",
    recorded_at: "2026-11-01T10:00:00Z",
    dispatched_at: "2026-11-01T10:00:05Z",
    applied_at: null,
    applied_by: null,
    runtime_confirmed_at: null,
    runtime_state: "unknown",
    failure_reason: null,
    unknown_reason: null,
    readback_available: null,
    server_time: new Date().toISOString(),
  };
}

function syntheticBinding(scope: string): PolicyBinding {
  return {
    scope,
    selected_tier: "BALANCED_COMPOUNDING",
    selection_revision: 2,
    approved_tier: "BALANCED_COMPOUNDING",
    approved_policy_id: "synthetic-policy",
    approved_policy_revision: "r7",
    effective_tier: "BALANCED_COMPOUNDING",
    effective_policy_id: "synthetic-policy",
    effective_policy_revision: "r7",
    effective_observed_at: "2026-11-01T09:30:00Z",
    temporary_restriction: null,
    values: [
      { key: "max_gross_exposure", label_key: null, value: 45, unit: "percent", status: "known", source: "server" },
      { key: "cash_floor", label_key: null, value: 20, unit: "percent", status: "known", source: "server" },
    ],
  };
}

function syntheticLifecycles(): LifecycleBinding[] {
  return [{
    profile: "demo_trend",
    account_alias: "demo_account",
    platform: "ibkr",
    target_id: "demo-target",
    release_id: "demo-release-2026.10",
    present: true,
    research_stage: "paper",
    authorized_stage: "paper",
    effective_stage: "paper",
    operating_state: "running",
    application_state: "applied",
    observed_at: "2026-11-01T09:30:00Z",
    evidence: {
      evidence_id: "synthetic-evidence",
      label_key: null,
      observed_at: "2026-10-31T13:00:00Z",
      valid_until: "2026-11-02T13:00:00Z",
      state: "current",
      qualification: "qualified",
      limitations: [],
    },
    regime_effect: "risk_reduction_only",
  }];
}

function syntheticDigest(): DigestStatus {
  return {
    business_day: "2026-11-01",
    timezone: "America/New_York",
    expected_targets: 4,
    covered_targets: 3,
    unavailable_targets: 1,
    delivery_state: "accepted",
    accepted_at: "2026-11-01T13:05:00Z",
    acknowledged_at: null,
    source_as_of: "2026-11-01T13:00:00Z",
    legacy_receipts: false,
    targets: [],
  };
}

function syntheticAudit(): AuditEvent[] {
  return [
    { event_id: "synthetic-event-1", occurred_at: "2026-11-01T10:00:00Z", actor: "owner", action: "approval_recorded", subject: "synthetic-decision-001", revision: 3, decision_id: "synthetic-decision-001", operation_id: "synthetic-operation-1", outcome: "recorded" },
    { event_id: "synthetic-event-2", occurred_at: "2026-11-01T10:00:05Z", actor: "platform", action: "application_dispatched", subject: "demo-target", revision: 3, decision_id: "synthetic-decision-001", operation_id: "synthetic-operation-1", outcome: "applying" },
  ];
}
