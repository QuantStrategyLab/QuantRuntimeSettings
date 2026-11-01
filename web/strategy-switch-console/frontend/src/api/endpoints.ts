import { performanceScope } from "../lib/accountDirectory";
import { AccessError, HttpError, getJson, postJson, readRevision } from "./client";
import { MutationOutcomeUnknown } from "./cockpit";
import type {
  AccountFactsResponse,
  AccountsResponse,
  AssetsResponse,
  BinanceAccountFactsResponse,
  CalendarResponse,
  CombinedDraftRequest,
  CombinedDraftResponse,
  CredentialRotationCancelRequest,
  CredentialRotationEnvelope,
  CredentialRotationErrorCode,
  CredentialRotationFinalizeRequest,
  CredentialRotationMetadata,
  CredentialRotationOperation,
  CredentialRotationOperationAction,
  CredentialRotationReasonCode,
  CredentialRotationStageRequest,
  CredentialRotationState,
  CredentialRotationStepUp,
  DecisionHistoryResponse,
  ExecutionsResponse,
  HoldingsResponse,
  InboxResponse,
  NotificationSendLog,
  Range,
  ReturnsResponse,
  RunControlAvailability,
  SettingsDiffResponse,
  SettingsHistoryResponse,
  StrategySummary,
  SummaryResponse,
  TodayRunSummary,
} from "./contracts";
import { CREDENTIAL_ROTATION_CREDENTIAL, CREDENTIAL_ROTATION_SCHEMA_VERSION } from "./contracts";

export interface Session {
  authenticated: boolean;
  login: string | null;
  allowed: boolean;
  admin: boolean;
  synthetic?: boolean;
}

export function loadSession(): Promise<Session> {
  return getJson<Session>("/api/session");
}

let inboxRead: Promise<InboxResponse> | null = null;
let inboxCached: { value: InboxResponse; until: number; revision: number } | null = null;
const inboxListeners = new Set<() => void>();
/** Subscribe to every fresh inbox read, so the shell badge and the pages share one request. */
export function onInboxRead(listener: () => void): () => void {
  inboxListeners.add(listener);
  return () => { inboxListeners.delete(listener); };
}
function inboxTtl(failed: boolean): number {
  const configured = Number(failed ? import.meta.env?.VITE_INBOX_FAILURE_BACKOFF_MS : import.meta.env?.VITE_INBOX_CACHE_MS);
  return Number.isFinite(configured) && configured >= 1000 && configured <= 300_000 ? configured : failed ? 60_000 : 15_000;
}
export function loadInbox(force = false): Promise<InboxResponse> {
  const revision = readRevision();
  // Explicit refresh skips successful cached data. Failed reads retain a short
  // cooldown so repeated clicks cannot turn an outage into a request storm.
  if (inboxCached && inboxCached.revision === revision && Date.now() < inboxCached.until
    && (!force || inboxCached.value.status === "read_failed")) return Promise.resolve(inboxCached.value);
  if (!inboxRead) inboxRead = getJson<InboxResponse>("/api/decisions-inbox")
    .then(value => { inboxCached = { value, until: Date.now() + inboxTtl(value.status === "read_failed"), revision }; for (const listener of [...inboxListeners]) listener(); return value; })
    .finally(() => { inboxRead = null; });
  return inboxRead;
}

export function loadDecisionHistory(limit = 25, cursor?: string | null): Promise<DecisionHistoryResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return getJson<DecisionHistoryResponse>(`/api/owner-decisions/history?${params}`);
}

export function loadAccounts(): Promise<AccountsResponse> {
  return getJson<AccountsResponse>("/api/accounts");
}

/** Read-only broker-reported facts. Amounts stay decimal strings; a failed read rejects. */
export function loadAccountFacts(): Promise<AccountFactsResponse> {
  return getJson<AccountFactsResponse>("/api/account-facts");
}

/**
 * Dedicated Binance wallet facts for the one protected-configuration account.
 * The read stays independent of /api/account-facts so its failure only affects
 * Binance cards; the card still matches the report by platform + account_key.
 */
export function loadBinanceAccountFacts(): Promise<BinanceAccountFactsResponse> {
  return getJson<BinanceAccountFactsResponse>("/api/binance-account-facts");
}

export function loadSettingsDiff(account: string, platform?: string): Promise<SettingsDiffResponse> {
  const params = new URLSearchParams({ account });
  if (platform) params.set("platform", platform);
  return getJson<SettingsDiffResponse>(`/api/account-settings/diff?${params}`);
}

export function loadSettingsHistory(account: string, platform?: string, limit = 25, cursor?: string | null): Promise<SettingsHistoryResponse> {
  const params = new URLSearchParams({ account, limit: String(limit) });
  if (platform) params.set("platform", platform);
  if (cursor) params.set("cursor", cursor);
  return getJson<SettingsHistoryResponse>(`/api/account-settings/history?${params}`);
}

export function saveCombinedDraft(request: CombinedDraftRequest): Promise<CombinedDraftResponse> {
  return postJson<CombinedDraftResponse>("/api/account-settings/draft", request);
}

/** Legacy settings read: source of the complete identity and revision required by the combined save. */
export function loadAccountSettings(platform: string, key: string): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ platform, key });
  return getJson<Record<string, unknown>>(`/api/account-settings?${params}`);
}

export function loadTodayRuns(): Promise<TodayRunSummary> {
  return getJson<TodayRunSummary>("/api/runtime/today");
}

export function loadStrategySummary(): Promise<StrategySummary> {
  return getJson<StrategySummary>("/api/strategies/summary");
}

export function loadNotificationLog(limit = 25, cursor?: string | null): Promise<NotificationSendLog> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return getJson<NotificationSendLog>(`/api/notifications/send-log?${params}`);
}

export function loadRunControls(account: string, platform?: string): Promise<RunControlAvailability> {
  const params = new URLSearchParams({ account });
  if (platform) params.set("platform", platform);
  return getJson<RunControlAvailability>(`/api/accounts/run-controls?${params}`);
}

function performanceQuery(scope: string, range: Range, platform?: string): string {
  const selected = performanceScope(scope, platform);
  const params = new URLSearchParams({ scope: selected.scope, range });
  if (selected.platform) params.set("platform", selected.platform);
  return String(params);
}

export function loadPerformanceSummary(scope: string, range: Range, platform?: string): Promise<SummaryResponse> {
  return getJson<SummaryResponse>(`/api/performance/summary?${performanceQuery(scope, range, platform)}`);
}

export function loadPerformanceReturns(scope: string, range: Range, platform?: string): Promise<ReturnsResponse> {
  return getJson<ReturnsResponse>(`/api/performance/returns?${performanceQuery(scope, range, platform)}`);
}

export function loadPerformanceAssets(scope: string, range: Range, platform?: string): Promise<AssetsResponse> {
  return getJson<AssetsResponse>(`/api/performance/assets?${performanceQuery(scope, range, platform)}`);
}

export function loadPerformanceHoldings(scope: string, range: Range, platform?: string): Promise<HoldingsResponse> {
  return getJson<HoldingsResponse>(`/api/performance/holdings?${performanceQuery(scope, range, platform)}`);
}

export function loadPerformanceTrades(scope: string, range: Range, platform?: string): Promise<ExecutionsResponse> {
  return getJson<ExecutionsResponse>(`/api/performance/trades?${performanceQuery(scope, range, platform)}`);
}

export function loadPerformanceCalendar(scope: string, range: Range, year: number, month?: number | null, platform?: string, currency?: string): Promise<CalendarResponse> {
  const selected = performanceScope(scope, platform);
  const params = new URLSearchParams({ scope: selected.scope, range, year: String(year) });
  if (month !== null && month !== undefined) params.set("month", String(month));
  if (selected.platform) params.set("platform", selected.platform);
  if (currency) params.set("currency", currency);
  return getJson<CalendarResponse>(`/api/performance/calendar?${params}`);
}

export interface RuntimeDailyRecord {
  target_key: string;
  service?: string;
  strategy_profile?: string;
  status: string;
  block_reason_code?: string;
  kind?: string;
  execution_lane?: string;
  business_date?: string;
  observed_at?: string;
  completeness?: string;
  runs?: { run_id: string | null; started_at: string | null; finished_at: string | null; activity: string; execution_lane: string; errors_present: boolean }[];
}

export interface RuntimeDailySnapshot {
  ok: true;
  date: string;
  timezone: string;
  platform?: string;
  account_key?: string;
  read_error_count?: number;
  read_error_codes?: string[];
  unmatched_count?: number;
  history?: unknown;
  data_status: "fresh" | "stale" | "historical" | "unavailable";
  record: RuntimeDailyRecord | null;
}

export interface RuntimeDailyBinding {
  platform: string;
  target_key: string;
  account_key: string | null;
  status: "bound" | "unresolved" | "read_failed" | "conflict";
}

export async function loadRuntimeDailyBindings(): Promise<RuntimeDailyBinding[]> {
  const config = await getJson<{ runtimeDailyBindings?: RuntimeDailyBinding[] }>("/api/config");
  return config.runtimeDailyBindings ?? [];
}

/** Legacy per-date daily snapshot used by the 14-day run grid on the health page. */
export function loadRuntimeDaily(date: string, platform?: string, accountKey?: string, includeHistory = true): Promise<RuntimeDailySnapshot> {
  const params = new URLSearchParams({ date });
  if (platform) params.set("platform", platform);
  if (accountKey) params.set("account_key", accountKey);
  if (!includeHistory) params.set("include_history", "false");
  return getJson<RuntimeDailySnapshot>(`/api/runtime-daily?${params}`);
}

export interface CredentialMaintenance {
  id: string;
  expires_at: string | null;
  phase: "unknown" | "not_due" | "30" | "14" | "7" | "expired";
  requires_action: boolean;
  delivery: string;
}

export function loadCredentialMaintenance(): Promise<CredentialMaintenance> {
  return getJson<CredentialMaintenance>("/api/credential-maintenance");
}

/* ---------- Credential rotation ----------
 * `ibkr_flex` is the only supported credential, so the path is fixed and there
 * is no credential, project or version parameter. Every read is validated
 * against a key allowlist: an unexpected key is rejected, never stored. */

export const ROTATION_CREDENTIAL_PATH = `/api/credential-rotation/${CREDENTIAL_ROTATION_CREDENTIAL}`;

/** Timestamps must carry an explicit offset; a naive local time is not accepted. */
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
/** The bounded opaque id shape already used for request and operation identity. */
const ROTATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const ROTATION_STATES: CredentialRotationState[] = [
  "adding_version", "staged", "finalizing", "finalized", "canceling", "canceled",
  "add_unknown", "finalize_unknown", "cancel_unknown", "failed",
];
const ROTATION_REASONS: CredentialRotationReasonCode[] = [
  "proxy_unconfirmed", "maintenance_revision_conflict", "provider_failed",
];
const ROTATION_ERRORS: CredentialRotationErrorCode[] = [
  "invalid_credential_rotation_request", "invalid_credential_expiry", "origin_required",
  "cross_origin_rejected", "rotation_owner_required", "step_up_invalid", "step_up_rate_limited",
  "credential_rotation_operation_not_found", "credential_rotation_request_conflict",
  "credential_rotation_state_conflict", "credential_maintenance_revision_conflict",
  "credential_rotation_unavailable",
];
/** Fixed codes the rotation routes may return; anything else is not rendered. */
export const ROTATION_ERROR_CODES: readonly string[] = ROTATION_ERRORS;

const ROTATION_METADATA_KEYS = ["name", "last_rotated_at", "expires_at"];
const ROTATION_OPERATION_KEYS = [
  "operation_id", "state", "requested_expires_at", "created_at", "updated_at",
  "allowed_actions", "reason_code",
];
const ROTATION_ENVELOPE_KEYS = [
  "schema_version", "ok", "server_time", "metadata", "operation", "allowed_actions", "replayed",
];
/** A response carrying any of these is a contract violation, not a display problem. */
const ROTATION_FORBIDDEN_KEYS = [
  "value", "new_value", "masked_value", "old_value", "token", "secret", "code",
  "step_up", "version", "version_name", "resource_name", "fingerprint", "digest",
  "provider", "provider_response", "response", "body", "payload",
];

class RotationContractError extends Error {
  constructor() { super("invalid_credential_rotation_response"); }
}

function asRecordValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new RotationContractError();
  return value as Record<string, unknown>;
}

function assertNoForbiddenKey(raw: Record<string, unknown>): void {
  for (const key of Object.keys(raw)) {
    if (ROTATION_FORBIDDEN_KEYS.includes(key.toLowerCase())) throw new RotationContractError();
  }
}

function requireKeys(raw: Record<string, unknown>, allowed: readonly string[], optional: readonly string[] = []): void {
  assertNoForbiddenKey(raw);
  if (allowed.some(key => !optional.includes(key) && !Object.hasOwn(raw, key))) throw new RotationContractError();
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) throw new RotationContractError();
  }
}

function asRotationString(value: unknown, maxLength = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) throw new RotationContractError();
  return value;
}

/** A timestamp is either an explicit-offset RFC 3339 value or genuinely absent. */
export function asRotationTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !RFC3339_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new RotationContractError();
  }
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.slice(0, 8).split(":").map(Number);
  const zone = value.endsWith("Z") ? null : value.slice(-6);
  if (year < 1970 || month < 1 || month > 12 || day < 1
    || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59
    || (zone && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    throw new RotationContractError();
  }
  return value;
}

function requiredRotationTimestamp(value: unknown): string {
  const result = asRotationTimestamp(value);
  if (result === null) throw new RotationContractError();
  return result;
}

export function isRotationTimestamp(value: unknown): boolean {
  try {
    return asRotationTimestamp(value) !== null;
  } catch {
    return false;
  }
}

function normalizeMetadata(value: unknown): CredentialRotationMetadata {
  const raw = asRecordValue(value);
  requireKeys(raw, ROTATION_METADATA_KEYS);
  return {
    name: asRotationString(raw.name, 128),
    last_rotated_at: asRotationTimestamp(raw.last_rotated_at),
    expires_at: asRotationTimestamp(raw.expires_at),
  };
}

function normalizeOperation(value: unknown): CredentialRotationOperation | null {
  if (value === null) return null;
  const raw = asRecordValue(value);
  requireKeys(raw, ROTATION_OPERATION_KEYS);
  const state = asRotationString(raw.state, 32);
  if (!ROTATION_STATES.includes(state as CredentialRotationState)) throw new RotationContractError();
  const reason = raw.reason_code;
  if (reason !== null && (typeof reason !== "string" || !ROTATION_REASONS.includes(reason as CredentialRotationReasonCode))) {
    throw new RotationContractError();
  }
  const actions = raw.allowed_actions;
  if (!Array.isArray(actions) || !actions.every(action => action === "finalize" || action === "cancel")) throw new RotationContractError();
  if (typeof raw.operation_id !== "string" || !ROTATION_ID_PATTERN.test(raw.operation_id)) throw new RotationContractError();
  return {
    operation_id: asRotationString(raw.operation_id, 128),
    state: state as CredentialRotationState,
    requested_expires_at: requiredRotationTimestamp(raw.requested_expires_at),
    created_at: requiredRotationTimestamp(raw.created_at),
    updated_at: requiredRotationTimestamp(raw.updated_at),
    allowed_actions: actions as CredentialRotationOperationAction[],
    reason_code: (reason ?? null) as CredentialRotationReasonCode | null,
  };
}

function normalizeEnvelope(value: unknown): CredentialRotationEnvelope {
  const raw = asRecordValue(value);
  requireKeys(raw, ROTATION_ENVELOPE_KEYS, ["replayed"]);
  if (raw.ok !== true || raw.schema_version !== CREDENTIAL_ROTATION_SCHEMA_VERSION) throw new RotationContractError();
  const actions = Array.isArray(raw.allowed_actions) ? raw.allowed_actions : null;
  if (!actions || !actions.every(action => action === "stage")) throw new RotationContractError();
  const replayed = raw.replayed;
  if (replayed !== undefined && typeof replayed !== "boolean") throw new RotationContractError();
  return {
    schema_version: CREDENTIAL_ROTATION_SCHEMA_VERSION,
    ok: true,
    server_time: requiredRotationTimestamp(raw.server_time),
    metadata: normalizeMetadata(raw.metadata),
    operation: normalizeOperation(raw.operation),
    allowed_actions: actions as ["stage"],
    ...(replayed === undefined ? {} : { replayed }),
  };
}

/** Fixed codes this client raises itself, before a request leaves the browser. */
const ROTATION_CLIENT_CODES: readonly string[] = [
  "request_id_invalid", "credential_value_length_invalid", "step_up_method_invalid", "step_up_code_required",
];

/** Fixed-code lookup for the rotation routes: errors are a code source, never text to render. */
export function rotationErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return [...ROTATION_ERROR_CODES, ...ROTATION_CLIENT_CODES].includes(error.message) ? error.message : null;
}

export function loadCredentialRotation(): Promise<CredentialRotationEnvelope> {
  return getJson<unknown>(ROTATION_CREDENTIAL_PATH).then(normalizeEnvelope);
}

export function loadCredentialRotationOperation(operationId: string): Promise<CredentialRotationEnvelope> {
  if (!ROTATION_ID_PATTERN.test(operationId)) return Promise.reject(new RotationContractError());
  return getJson<unknown>(`${ROTATION_CREDENTIAL_PATH}/operations/${encodeURIComponent(operationId)}`)
    .then(normalizeEnvelope);
}

function normalizeStepUp(stepUp: CredentialRotationStepUp): CredentialRotationStepUp {
  if (stepUp.method !== "totp" && stepUp.method !== "recovery") throw new Error("step_up_method_invalid");
  if (typeof stepUp.code !== "string" || stepUp.code.length === 0 || stepUp.code.length > 128) {
    throw new Error("step_up_code_required");
  }
  return { method: stepUp.method, code: stepUp.code };
}

/** A transport failure after a possible write is an unknown outcome, never a retry. */
async function postRotation(
  path: string,
  body: Record<string, unknown>,
  requestId: string,
  operationId: string | null,
): Promise<CredentialRotationEnvelope> {
  try {
    return normalizeEnvelope(await postJson<unknown>(path, body));
  } catch (error) {
    if (error instanceof HttpError || error instanceof AccessError) throw error;
    throw new MutationOutcomeUnknown(requestId, operationId);
  }
}

/**
 * Stage carries the new value for one request only. Nothing here retains it:
 * it is serialised into the body and dropped when the call settles.
 */
export function stageCredentialRotation(request: CredentialRotationStageRequest): Promise<CredentialRotationEnvelope> {
  if (!ROTATION_ID_PATTERN.test(request.request_id)) return Promise.reject(new Error("request_id_invalid"));
  const bytes = new TextEncoder().encode(request.new_value).length;
  if (bytes < 1 || bytes > 1024) return Promise.reject(new Error("credential_value_length_invalid"));
  if (!isRotationTimestamp(request.expires_at)) return Promise.reject(new Error("invalid_credential_expiry"));
  return postRotation(`${ROTATION_CREDENTIAL_PATH}/stage`, {
    request_id: request.request_id,
    new_value: request.new_value,
    expires_at: request.expires_at,
    step_up: normalizeStepUp(request.step_up),
  }, request.request_id, null);
}

export function finalizeCredentialRotation(
  request: CredentialRotationFinalizeRequest,
): Promise<CredentialRotationEnvelope> {
  if (!ROTATION_ID_PATTERN.test(request.operation_id)) return Promise.reject(new Error("operation_id_invalid"));
  if (!ROTATION_ID_PATTERN.test(request.request_id)) return Promise.reject(new Error("request_id_invalid"));
  if (request.downstream_verified !== true) return Promise.reject(new Error("downstream_verification_required"));
  return postRotation(
    `${ROTATION_CREDENTIAL_PATH}/operations/${encodeURIComponent(request.operation_id)}/finalize`,
    {
      request_id: request.request_id,
      downstream_verified: true,
      step_up: normalizeStepUp(request.step_up),
    },
    request.request_id,
    request.operation_id,
  );
}

export function cancelCredentialRotation(
  request: CredentialRotationCancelRequest,
): Promise<CredentialRotationEnvelope> {
  if (!ROTATION_ID_PATTERN.test(request.operation_id)) return Promise.reject(new Error("operation_id_invalid"));
  if (!ROTATION_ID_PATTERN.test(request.request_id)) return Promise.reject(new Error("request_id_invalid"));
  return postRotation(
    `${ROTATION_CREDENTIAL_PATH}/operations/${encodeURIComponent(request.operation_id)}/cancel`,
    { request_id: request.request_id, step_up: normalizeStepUp(request.step_up) },
    request.request_id,
    request.operation_id,
  );
}
