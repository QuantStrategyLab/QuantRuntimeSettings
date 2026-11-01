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
export type DecisionState = "pending" | "approved" | "rejected" | "expired" | "superseded" | "withdrawn" | "unknown";
/** The server owns this vocabulary; action ids are opaque strings bounded by the API. */
export type DecisionAction = string;
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
  /** Opaque server revision string matching DECISION_REVISION_PATTERN, never a number. */
  revision: string | null;
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
  /** True when the server marked an allowed action as requiring a selection payload. */
  selection_required: boolean;
  blocking_reasons: string[];
  operation_id: string | null;
  receipt: { recorded_at: string | null; revision: string | null } | null;
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

export interface AuditSubject {
  kind: string;
  id: string;
}

export interface AuditEvent {
  event_id: string;
  occurred_at: string;
  actor: string | null;
  action: string;
  subject: AuditSubject | null;
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

export interface DecisionActionSelection {
  confirmation: Record<string, unknown>;
  selected_account: Record<string, unknown>;
}

/**
 * The POST body whitelist enforced by `POST /api/decisions/:id/actions`: any
 * other key is a 400, so this type is the request, not a superset of one.
 */
export interface DecisionActionRequest {
  decision_id: string;
  category: Category;
  action: DecisionAction;
  expected_revision: string;
  expected_expires_at?: string | null;
  request_id: string;
  /** Names the intent; when present it must equal `request_id` (the retry id). */
  operation_id?: string | null;
  selection?: DecisionActionSelection | null;
}

export interface DecisionActionResponse {
  operation: OperationRecord | null;
  state: DecisionState | null;
  revision: string | null;
  receipt: { recorded_at: string | null; revision: string | null } | null;
  replayed: boolean;
}

/** Server-side revision format: `^rev[0-9]-[0-9a-z-]{1,64}$`, never a number. */
export const DECISION_REVIEW_SCHEMA_VERSION = "qsl.decision_review.v1";
export const OPERATION_SCHEMA_VERSION = "qsl.operation.v1";
export const DECISION_REVISION_PATTERN = /^rev[0-9]-[0-9a-z-]{1,64}$/;
/** Server-side id format for request_id / operation_id. */
export const DECISION_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function isDecisionRevision(value: unknown): value is string {
  return typeof value === "string" && DECISION_REVISION_PATTERN.test(value);
}

export function isApprovalAction(action: DecisionAction): boolean {
  return action === "approve" || action === "accept" || action === "approve_limited_live_canary";
}

/** From `decision_state` (GET detail, inbox and POST result share the shape). */
export function decisionStateFromRecord(
  status: unknown,
  action: unknown,
  expired: unknown,
): DecisionState {
  if (status === "decided") {
    if (action === "reject" || action === "keep_parked" || action === "withdraw") return "rejected";
    return isApprovalAction(String(action ?? "")) ? "approved" : "unknown";
  }
  if (status === "pending") return expired === true ? "expired" : "pending";
  return "unknown";
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
  return typeof value === "string" && value.length > 0 && value.length <= 64 && /^[a-z][a-z0-9_]*$/.test(value)
    ? value
    : null;
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
  if (!decision.allowed_actions.some(isApprovalAction)) blockers.push("approval_not_allowed");
  if (!decision.evidence) blockers.push("evidence_missing");
  else if (decision.evidence.state !== "current") blockers.push(`evidence_${decision.evidence.state}`);
  else if (decision.evidence.qualification !== "qualified") blockers.push("evidence_unqualified");
  if (!decision.policy) blockers.push("policy_unavailable");
  else if (!decision.policy.selected_tier || !decision.policy.policy_revision) blockers.push("policy_binding_missing");
  if (!isDecisionRevision(decision.revision)) blockers.push("revision_invalid");
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

/** Audit subjects stay structured: kind is translated and id labeled separately at render. */
function asAuditSubject(value: unknown): AuditSubject | null {
  const raw = asRecord(value);
  if (raw) {
    const kind = asString(raw.kind);
    const id = asString(raw.id);
    if (kind === null && id === null) return null;
    return { kind: kind ?? "unknown", id: id ?? "" };
  }
  const text = asString(value);
  if (text === null) return null;
  const separator = text.indexOf(":");
  if (separator < 0) return { kind: "unknown", id: text };
  return { kind: text.slice(0, separator).trim() || "unknown", id: text.slice(separator + 1).trim() };
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

/**
 * Backend operation objects: the full `qsl.operation.v1` payload and the
 * compact `operation` reference inside action results share this shape.
 * `unaccepted`/`unapplied` stay "unknown": the UI never shows progress the
 * server has not recorded. The durable idempotency id is the request id, so
 * `request_id` mirrors `operation_id`.
 */
function normalizeOperation(
  value: unknown,
  context: { serverTime?: string | null; decision?: Record<string, unknown> | null } = {},
): OperationRecord | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = asString(raw.id) ?? asString(raw.operation_id) ?? "";
  const statusByApplication: Record<string, ApplicationState> = {
    applying: "applying",
    applied: "applied",
    failed: "failed",
    rejected: "rejected",
    accepted: "pending",
    unaccepted: "unknown",
    unapplied: "unknown",
    unknown: "unknown",
  };
  const status = asString(raw.status);
  const state = status ? statusByApplication[status] ?? "unknown" : "unknown";
  const reasonCode = asString(raw.reason_code);
  const dispatch = asRecord(raw.dispatch);
  const application = asRecord(raw.application);
  const decidedAt = asString(context.decision?.decided_at);
  const updatedAt = asString(raw.updated_at);
  return {
    operation_id: id,
    request_id: id,
    decision_id: asString(raw.decision_id),
    decision_revision: null,
    action: asDecisionAction(context.decision?.action),
    title_key: null,
    account_alias: asString(application?.account_alias),
    platform: asString(application?.platform),
    release_id: asString(application?.release_id),
    target_id: asString(application?.target_id),
    state,
    recorded_at: decidedAt ?? updatedAt,
    dispatched_at: asString(dispatch?.updated_at),
    applied_at: state === "applied" ? updatedAt : null,
    applied_by: application ? "platform" : null,
    runtime_confirmed_at: null,
    runtime_state: "unknown",
    failure_reason: state === "failed" ? reasonCode : null,
    unknown_reason: state === "unknown" ? reasonCode : null,
    readback_available: asString(raw.activation_status) === "not_connected" ? false : null,
    server_time: context.serverTime ?? null,
  };
}

/** Backend `evidence_summary`; absent freshness or shadow never becomes qualified. */
function normalizeEvidenceSummary(value: unknown): EvidenceSummary | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const freshness = asString(raw.freshness);
  const state: EvidenceState = freshness === "current" || freshness === "ok" ? "current"
    : freshness === "stale" ? "stale"
      : freshness === "expired" ? "expired"
        : freshness === "missing" ? "missing" : "unavailable";
  const shadow = asRecord(raw.shadow);
  const qualification: Qualification = typeof shadow?.passed === "boolean"
    ? shadow.passed ? "qualified" : "unqualified" : "unknown";
  return {
    evidence_id: asString(raw.source_id) ?? asString(raw.material_sha256),
    label_key: null,
    observed_at: asString(raw.observed_at),
    valid_until: null,
    state,
    qualification,
    limitations: [],
  };
}

/**
 * `GET /api/decisions/:id` returns a `qsl.decision_review.v1` envelope; the
 * decision itself is the inbox item in `decision`, the tier constants live in
 * `tier_policies` and the readable policy is `policy`. Flat payloads are not a
 * supported shape.
 */
function normalizeDecision(value: unknown, fallback: { id: string; shortId: string; category: Category; titleKey: string }): DecisionDetail {
  const envelope = asRecord(value) ?? {};
  const item = asRecord(envelope.decision) ?? {};
  const eligibility = asRecord(envelope.current_eligibility);
  const receipt = asRecord(envelope.decision_receipt);
  const operationRef = asRecord(envelope.operation) ?? asRecord(item.operation_reference);
  const decisionState = asRecord(item.decision_state);
  const transition = asRecord(item.transition);
  const riskImpact = asRecord(item.risk_impact);
  const tierPolicy = asRecord(riskImpact?.policy);
  const allowedEntries = Array.isArray(item.allowed_actions) ? item.allowed_actions : [];
  const allowed = [...new Set(allowedEntries.flatMap((entry): DecisionAction[] => {
    const action = asDecisionAction(asRecord(entry)?.action ?? entry);
    return action ? [action] : [];
  }))];
  const blockingReasons = [...new Set(
    [item.blocking_reason_codes, eligibility?.reason_codes]
      .flatMap(list => Array.isArray(list) ? list.filter((code): code is string => typeof code === "string") : []),
  )];
  const expiry = item.expires_at === null || typeof item.expires_at === "string" ? item.expires_at : null;
  return {
    decision_id: asString(envelope.decision_id) ?? asString(item.decision_id) ?? asString(item.id) ?? fallback.id,
    short_id: asString(item.short_id) ?? fallback.shortId,
    category: (typeof item.category === "string" ? item.category : fallback.category) as Category,
    revision: isDecisionRevision(item.revision) ? item.revision : null,
    state: decisionStateFromRecord(decisionState?.status, decisionState?.action, item.status === "expired"),
    title_key: asString(item.title_key) ?? fallback.titleKey,
    account_alias: asString(item.account_alias),
    platform: asString(item.platform),
    release_id: asString(item.release_id),
    target_id: asString(item.target_id),
    from_stage: isProductStage(transition?.from) ? transition?.from : null,
    to_stage: isProductStage(transition?.to) ? transition?.to : null,
    evidence: normalizeEvidenceSummary(item.evidence_summary),
    policy: riskImpact ? {
      selected_tier: isRiskTier(riskImpact.tier) ? riskImpact.tier : null,
      policy_id: asString(tierPolicy?.policy_id),
      policy_revision: null,
      summary: null,
      values: ["composer_mdd_multiple", "promotion_size_scale"].flatMap((key): PolicyValue[] => {
        const value = tierPolicy?.[key];
        return typeof value === "number" && Number.isFinite(value)
          ? [{ key, label_key: null, value, unit: null, status: "known", source: "server" }]
          : [];
      }),
    } : null,
    created_at: asString(item.created_at),
    expires_at: expiry,
    server_time: asString(envelope.server_time),
    allowed_actions: allowed,
    selection_required: allowedEntries.some(entry => asRecord(entry)?.requires_selection === true),
    blocking_reasons: blockingReasons,
    operation_id: asString(operationRef?.id),
    receipt: receipt ? { recorded_at: asString(receipt.decided_at), revision: null } : null,
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
    if (asString(asRecord(payload)?.schema_version) !== DECISION_REVIEW_SCHEMA_VERSION) return { status: "not_ready" };
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
 * Submit an owner action bound to the displayed revision string and a stable
 * request identity. The server rejects any body key outside its whitelist, so
 * nothing else is sent. A timeout or transport failure is an unknown outcome,
 * not a failure: the caller keeps the identity and reconciles, never resubmits.
 */
export async function submitDecisionAction(request: DecisionActionRequest): Promise<DecisionActionResponse> {
  if (!isDecisionRevision(request.expected_revision)) throw new Error("decision_revision_required");
  if (!DECISION_REQUEST_ID_PATTERN.test(request.request_id)) throw new Error("decision_request_id_invalid");
  if (request.operation_id !== undefined && request.operation_id !== null && request.operation_id !== request.request_id) {
    throw new Error("decision_operation_id_invalid");
  }
  if ((request.category === "strategy_promotion" || request.category === "paper_account_application")
    && request.action === "accept"
    && !(request.selection?.confirmation && request.selection?.selected_account)) {
    throw new Error("decision_selection_required");
  }
  const body: Record<string, unknown> = {
    action: request.action,
    expected_revision: request.expected_revision,
    request_id: request.request_id,
  };
  if (request.expected_expires_at) body.expected_expires_at = request.expected_expires_at;
  if (request.operation_id) body.operation_id = request.operation_id;
  if (request.selection) body.selection = request.selection;
  try {
    const payload = await postJson<unknown>(`/api/decisions/${encodeURIComponent(request.decision_id)}/actions`, body);
    const raw = asRecord(payload) ?? {};
    const stateRecord = asRecord(raw.decision_state);
    const status = asString(stateRecord?.status);
    const action = asString(stateRecord?.action) ?? asString(raw.action);
    const receipt = asRecord(raw.decision_receipt);
    return {
      operation: normalizeOperation(asRecord(raw.operation), { serverTime: asString(raw.server_time) }),
      state: status === null ? null : decisionStateFromRecord(status, action, false),
      revision: isDecisionRevision(raw.revision) ? raw.revision : null,
      receipt: receipt ? { recorded_at: asString(receipt.decided_at), revision: null } : null,
      replayed: raw.replayed === true,
    };
  } catch (error) {
    if (error instanceof AccessError || error instanceof HttpError) throw error;
    throw new MutationOutcomeUnknown(request.request_id, request.operation_id ?? request.request_id);
  }
}

export async function loadOperation(operationId: string, synthetic = false): Promise<CockpitRead<OperationRecord>> {
  if (synthetic) return { status: "ready", synthetic: true, data: syntheticOperation(operationId) };
  try {
    const payload = await getJson<unknown>(`/api/operations/${encodeURIComponent(operationId)}`);
    const envelope = asRecord(payload);
    if (asString(envelope?.schema_version) !== OPERATION_SCHEMA_VERSION) return { status: "not_ready" };
    const operation = normalizeOperation(envelope?.operation, {
      serverTime: asString(envelope?.server_time),
      decision: asRecord(envelope?.decision),
    });
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
        subject: asAuditSubject(event.subject),
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
    schema_version: DECISION_REVIEW_SCHEMA_VERSION,
    server_time: new Date().toISOString(),
    data_status: "ready",
    decision_id: id,
    decision: {
      id,
      short_id: item?.short_id ?? "S-DEMO-1",
      category: item?.category ?? "strategy_promotion",
      title_key: "decision.promotion_title",
      account_alias: "demo_account",
      platform: "ibkr",
      revision: "rev1-0123456789abcdef",
      status: "pending",
      created_at: "2026-11-01T09:00:00Z",
      expires_at: "2026-11-02T09:00:00Z",
      transition: { axis: "authorized_stage", from: "paper", to: "small_live" },
      actionable: true,
      blocking_reason_codes: [],
      allowed_actions: [
        { action: "accept", label_key: "decisions.action.accept", requires_selection: true },
        { action: "reject", label_key: "decisions.action.reject", requires_selection: false },
      ],
      decision_state: { status: "pending", action: null, decided_at: null },
      risk_impact: {
        affects_live: false,
        tier: "BALANCED_COMPOUNDING",
        policy: {
          schema_version: "qsl.risk_tier_policy.v1",
          tier: "BALANCED_COMPOUNDING",
          policy_id: "balanced_compounding_v1",
          composer_mdd_multiple: 1.25,
          promotion_size_scale: 0.75,
          executable: false,
          activation_status: "not_connected",
        },
      },
      evidence_summary: {
        source_id: "synthetic-evidence",
        observed_at: "2026-10-31T13:00:00Z",
        sample_count: 42,
        freshness: "current",
        shadow: { passed: true, evidence_kind: "synthetic" },
      },
      operation_reference: null,
    },
    current_eligibility: { eligible: true, material_matches: true, expired: false, blocked: false, reason_codes: [] },
    decision_authority: null,
    decision_receipt: null,
    operation: null,
    policy: { no_order: true, execution_authority_granted: false },
    tier_policies: [],
    errors: [],
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
    { event_id: "synthetic-event-1", occurred_at: "2026-11-01T10:00:00Z", actor: "owner", action: "approval_recorded", subject: { kind: "owner_decision", id: "synthetic-decision-001" }, revision: 3, decision_id: "synthetic-decision-001", operation_id: "synthetic-operation-1", outcome: "recorded" },
    { event_id: "synthetic-event-2", occurred_at: "2026-11-01T10:00:05Z", actor: "platform", action: "application_dispatched", subject: { kind: "paper_account_application", id: "demo-target" }, revision: 3, decision_id: "synthetic-decision-001", operation_id: "synthetic-operation-1", outcome: "applying" },
  ];
}
