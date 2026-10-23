export type Level = "conservative" | "balanced" | "growth";
export type Value = number | string | string[] | Record<string, number>;
export interface Parameter {
  unit: string; defaults_by_level: Record<Level, Value>;
  hard_limits: { type?: string; minimum?: number; maximum?: number; enum?: Value[]; maxItems?: number };
  user_override_allowed: boolean; risk_increase_when: string;
}
export interface Catalog {
  definition_version: string; levels: Level[]; parameters: Record<string, Parameter>;
}
export interface RiskRequest {
  status: string; cooldown_until_utc: string | null; final_confirmation_deadline_utc: string | null;
  token_expiry_utc?: string | null;
}
export interface AuditGap { event_id: string; event_status: string; backfill_blocked: string | null }
export interface RiskRead {
  contract_version: "web-risk-console.readonly.v1"; server_time: string; readonly: true;
  capabilities: { can_preview: false; can_confirm: false; can_cancel: false };
  legacy_preference: { value: string | null; mapped_level: Level | null; revision: number | null; source: string };
  record: null; effective: Record<string, Value> | null; effective_observed_at_utc: string | null;
  request: RiskRequest | null; confirmation_state: string; unavailable_reasons: string[];
  audit: { event_status: string; gaps_discovery: "complete" | "partial"; outstanding_gaps: AuditGap[]; events: unknown[] };
}
export interface CatalogRead { catalog: Catalog; definition_sha256: string; server_time: string }
