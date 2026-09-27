export type Session = { authenticated: boolean; login: string | null; allowed: boolean; admin: boolean; synthetic?: boolean };
export type Freshness = { data_status: "ready" | "stale" | "unavailable"; age_seconds: number | null };
export type AccountStateProjection = {
  scope: "monitoring_only";
  limit: "not_trading_or_books";
  health: "normal" | "abnormal" | "unknown";
  activation: "enabled" | "disabled" | "unknown";
  reason: string;
};
export type LifecycleRecord = {
  source_id: string;
  freshness?: Freshness;
  deployment_freshness?: Freshness;
  account_state?: AccountStateProjection;
  execution_observation?: { code?: string; order_or_fill_evidence?: string };
  target: {
    target_id: string;
    target: { platform: string; configured_state: string; execution_mode: string };
    monitoring: { runtime_guard: string; execution_heartbeat: string };
    deployment?: { runtime_enabled: boolean | null; scheduler_state: string; strategy_profile: string | null; execution_mode: string | null; observed_at?: string };
    disposition: { code: string; reason_code: string };
    no_order: true;
  };
};
export type RuntimeSnapshot = {
  data_status: string; generated_at?: string | null; computed_at?: string | null;
  summary?: Record<string, number>; targets?: LifecycleRecord[];
  policy?: Record<string, unknown>; errors?: string[];
};
export type AccountOption = {
  key: string; label: string; target_name: string; account_selector?: string;
  broker_environment?: string; execution_environment?: string; deployment_selector?: string;
  account_scope?: string; service_name?: string; github_environment?: string;
  variable_scope?: string; runtime_status_target_id?: string;
  [key: string]: unknown;
};
export type CurrentStrategy = {
  strategy_profile?: string; runtime_target_enabled?: boolean | null;
  execution_mode?: string; execution_environment?: string; [key: string]: unknown;
};
export type StrategyProfile = { profile: string; label?: string; domain?: string; [key: string]: unknown };
export type ConfigPayload = {
  accountOptions?: Record<string, AccountOption[]> | null;
  platformMeta?: Record<string, { label?: string; console_visible?: boolean; [key: string]: unknown }>;
  currentStrategies?: Record<string, Record<string, CurrentStrategy>>;
  strategyProfiles?: StrategyProfile[];
  platformRepositories?: Record<string, unknown>;
};
export type ControlPlane = {
  data_status: string; generated_at?: string | null; computed_at?: string | null;
  summary?: Record<string, unknown>;
  candidates?: Array<Record<string, any>>; policy?: Record<string, unknown>; errors?: string[];
};
export type HealthSnapshot = {
  data_status: string; generated_at?: string | null; computed_at?: string | null;
  summary?: Record<string, number>; strategies?: Array<Record<string, any>>; errors?: string[];
};
export type UxDraft = {
  revision?: number; fingerprint?: string; custom_draft?: boolean;
  preview?: Record<string, any> | null; preview_stale?: boolean;
  draft?: { objective?: string; research_case_id?: string; advanced_settings?: Record<string, unknown> };
  job?: Record<string, any> | null; intent?: unknown;
};
export type Source<T> = { value: T | null; error: string | null };
export type ReadModel = {
  session: Session;
  config: Source<ConfigPayload>; runtime: Source<RuntimeSnapshot>;
  control: Source<ControlPlane>; health: Source<HealthSnapshot>; research: Source<UxDraft>;
  owners: Source<Record<string, any>>; recovery: Source<Record<string, any>>;
  privateScope: Source<Record<string, any>>; evidence: Source<Record<string, any>>;
  tasks: Source<Record<string, any>>; promotions: Source<Record<string, any>>;
  market: Source<Record<string, any>>; adaptive: Source<Record<string, any>>;
  catalog: Source<Record<string, any>>;
};
export type AdminModel = {
  config: Source<Record<string, any>>; instances: Source<Record<string, any>>;
  risk: Source<Record<string, any>>;
};

export class AccessError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 401 ? "session_expired" : "access_denied");
    this.status = status;
  }
}

let privateRequestEpoch = 0;
export function invalidatePrivateSession(): void {
  privateRequestEpoch += 1;
  window.dispatchEvent(new Event("qsl-private-session-invalid"));
}
function assertPrivateRequestCurrent(epoch: number): void {
  if (epoch !== privateRequestEpoch) throw new Error("session_invalidated");
}

export async function getJson<T>(path: string): Promise<T> {
  const epoch = privateRequestEpoch;
  const response = await fetch(path, {
    method: "GET", credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) { invalidatePrivateSession(); throw new AccessError(response.status); }
  assertPrivateRequestCurrent(epoch);
  if (!response.ok) throw new Error(`http_${response.status}`);
  const payload = await response.json() as T;
  assertPrivateRequestCurrent(epoch);
  return payload;
}

export async function postJson<T = Record<string, any>>(path: string, body: unknown): Promise<T> {
  const epoch = privateRequestEpoch;
  const response = await fetch(path, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403) { invalidatePrivateSession(); throw new AccessError(response.status); }
  assertPrivateRequestCurrent(epoch);
  const payload = await response.json().catch(() => ({}));
  assertPrivateRequestCurrent(epoch);
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error || `http_${response.status}`) as Error & { status?: number; payload?: unknown };
    error.status = response.status; error.payload = payload; throw error;
  }
  return payload as T;
}

async function source<T>(request: Promise<T>): Promise<Source<T>> {
  try { return { value: await request, error: null }; }
  catch (error) {
    if (error instanceof AccessError) throw error;
    return { value: null, error: error instanceof Error ? error.message : "request_failed" };
  }
}

export async function loadReadModel(): Promise<ReadModel | { session: Session; denied: true }> {
  const session = await getJson<Session>("/api/session");
  if (!session.allowed) return { session, denied: true };
  const [config, runtime, control, health, research, owners, recovery, privateScope, evidence, tasks, promotions, catalog, market, adaptive] = await Promise.all([
    source(getJson<ConfigPayload>("/api/config")),
    source(getJson<RuntimeSnapshot>("/api/runtime-target-lifecycle")),
    source(getJson<ControlPlane>("/api/control-plane")),
    source(getJson<HealthSnapshot>("/api/strategy-health")),
    source(getJson<UxDraft>("/api/ux1/draft")),
    source(getJson<Record<string, any>>("/api/owner-decisions")),
    source(getJson<Record<string, any>>("/api/reconciliation-recovery")),
    source(getJson<Record<string, any>>("/api/binance-private-scope")),
    source(getJson<Record<string, any>>("/api/execution-evidence")),
    source(getJson<Record<string, any>>("/api/research-tasks")),
    source(getJson<Record<string, any>>("/api/research-promotion-tickets")),
    source(getJson<Record<string, any>>("/api/runtime-catalog")),
    source(getJson<Record<string, any>>("/api/m0-research")),
    source(getJson<Record<string, any>>("/api/adaptive-selection")),
  ]);
  return { session, config, runtime, control, health, research, owners, recovery, privateScope, evidence, tasks, promotions, catalog, market, adaptive };
}

export function runtimeStopQuery(platform: string, targetName: string): string {
  return `/api/runtime-stop?platform=${encodeURIComponent(platform)}&target_name=${encodeURIComponent(targetName)}`;
}

export function accountSettingsPath(platform: string, key: string): string {
  return `/api/account-settings?platform=${encodeURIComponent(platform)}&key=${encodeURIComponent(key)}`;
}

export async function loadAccountSettings(platform: string, key: string): Promise<Record<string, any>> {
  return getJson<Record<string, any>>(accountSettingsPath(platform, key));
}

export async function loadAdminModel(): Promise<AdminModel> {
  const [config, instances, risk] = await Promise.all([
    source(getJson<Record<string, any>>("/api/admin/config")),
    source(getJson<Record<string, any>>("/api/admin/runtime-instances")),
    source(getJson<Record<string, any>>("/api/risk-profiles")),
  ]);
  return { config, instances, risk };
}
