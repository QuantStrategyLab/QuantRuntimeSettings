import { getJson, postJson, readRevision } from "./client";
import type {
  AccountsResponse,
  AssetsResponse,
  CalendarResponse,
  CombinedDraftRequest,
  CombinedDraftResponse,
  DecisionHistoryResponse,
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
  TradeStatsResponse,
} from "./contracts";

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
    .then(value => { inboxCached = { value, until: Date.now() + inboxTtl(value.status === "read_failed"), revision }; return value; })
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
  const params = new URLSearchParams({ scope, range });
  if (platform) params.set("platform", platform);
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

export function loadPerformanceTrades(scope: string, range: Range, platform?: string): Promise<TradeStatsResponse> {
  return getJson<TradeStatsResponse>(`/api/performance/trades?${performanceQuery(scope, range, platform)}`);
}

export function loadPerformanceCalendar(scope: string, range: Range, year: number, month?: number | null, platform?: string): Promise<CalendarResponse> {
  const params = new URLSearchParams({ scope, range, year: String(year) });
  if (month !== null && month !== undefined) params.set("month", String(month));
  if (platform) params.set("platform", platform);
  return getJson<CalendarResponse>(`/api/performance/calendar?${params}`);
}

export interface RuntimeDailyRecord {
  target_key: string;
  service?: string;
  strategy_profile?: string;
  status: string;
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
  account_key?: string;
  data_status: "fresh" | "stale" | "historical" | "unavailable";
  record: RuntimeDailyRecord | null;
}

export interface RuntimeDailyBinding {
  platform: string;
  target_key: string;
  account_key: string | null;
  status: "bound" | "unresolved";
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
  phase: "unknown" | "not_due" | "30" | "7" | "1" | "expired";
  requires_action: boolean;
  delivery: string;
}

export function loadCredentialMaintenance(): Promise<CredentialMaintenance> {
  return getJson<CredentialMaintenance>("/api/credential-maintenance");
}
