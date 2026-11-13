/**
 * N1 boundary for the five Desk read projections.
 *
 * Live: only a strict `qsl.desk.*.v2` payload is accepted. Every object is closed,
 * every Read carries coverage, unknown never carries a value, and a known Read must
 * have evidenced (complete or verified-empty) coverage. A v1 live payload is a
 * contract mismatch, never silently upgraded.
 *
 * Mock: a fixture that already passed its v1 guard is normalised into the N1 shape.
 * Fixture counts become known values observed at the fixture's generated_at; this is
 * only allowed under source=mock and the page keeps its fixture label.
 */
import type {
  Accounts, BookRow, BrokerHealth, Freshness, Overview, Performance, Read, Ribbon, StrategyOption, SwitchStrategies,
} from "../contract/types";
import type {
  N1Accounts, N1BookRow, N1BrokerHealth, N1Coverage, N1Overview, N1Performance, N1Read, N1Reason, N1Ribbon,
  N1StrategyRow, N1SwitchStrategies,
} from "../contract/n1";
import type { DeskKey } from "../i18n/index.ts";

type Guard<T> = (value: unknown) => value is T;
type Check = (value: unknown) => boolean;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isIso = (value: unknown): value is string => {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 19) === value.slice(0, 19);
};
const isDate = (value: unknown): value is string => isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && isIso(`${value}T00:00:00Z`);
const isClock = (value: unknown): boolean => isString(value) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const isDecimal = (value: unknown): value is string => isString(value) && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isTargetId = (value: unknown): boolean => isString(value) && /^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(value);
const oneOf = (...values: string[]) => (value: unknown): boolean => values.includes(value as string);
const nullable = (check: Check) => (value: unknown): boolean => value === null || check(value);
const arrayOf = (check: Check) => (value: unknown): boolean => Array.isArray(value) && value.every(check);

/** Closed object: exactly the required keys plus any of the optional ones, each checked. */
function closed(value: unknown, required: Record<string, Check>, optional: Record<string, Check> = {}): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  for (const key of Object.keys(value)) if (!(key in required) && !(key in optional)) return false;
  for (const [key, check] of Object.entries(required)) if (!(key in value) || !check(value[key])) return false;
  for (const [key, check] of Object.entries(optional)) if (key in value && !check(value[key])) return false;
  return true;
}

export const N1_REASONS: readonly N1Reason[] = [
  "never_read", "read_failed", "source_unavailable", "identity_unverified", "not_supported",
  "insufficient_history", "coverage_incomplete", "mixed_currency", "time_basis_unavailable",
];
const isReason = oneOf(...N1_REASONS);
const V1_REASONS = oneOf("never_read", "read_failed", "source_unavailable", "identity_unverified", "not_supported");

function isCoverage(value: unknown, states: string[]): value is N1Coverage {
  if (!closed(value, { state: oneOf(...states), included: isCount, total: nullable(isCount), reasons: arrayOf(isReason) })) return false;
  const reasons = value.reasons as string[];
  return new Set(reasons).size === reasons.length && (value.total === null || (value.total as number) >= (value.included as number));
}

/** Strict N1 Read. Known requires evidenced coverage; partial requires partial coverage. */
export function isN1Read<T>(value: unknown, check: Check = () => true): value is N1Read<T> {
  if (!isObject(value)) return false;
  const any = ["complete", "partial", "unavailable", "verified_empty"];
  if (value.status === "known") {
    return closed(value, { status: () => true, value: check, observed_at: isIso, coverage: v => isCoverage(v, ["complete", "verified_empty"]) });
  }
  if (value.status === "stale") {
    return closed(value, { status: () => true, value: check, observed_at: isIso, age_seconds: isCount, coverage: v => isCoverage(v, any) });
  }
  if (value.status === "partial") {
    return closed(value, { status: () => true, value: check, observed_at: isIso, coverage: v => isCoverage(v, ["partial"]) });
  }
  if (value.status === "unknown") {
    return closed(value, { status: () => true, reason: isReason, coverage: v => isCoverage(v, ["unavailable", "partial"]) },
      { observed_at: nullable(isIso) });
  }
  return false;
}
const read = (check: Check) => (value: unknown) => isN1Read(value, check);

/** v1 Read (gateways keep the v1 shape). */
const isV1Read = (check: Check) => (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (value.status === "known") return closed(value, { status: () => true, value: check, observed_at: isIso });
  if (value.status === "stale") return closed(value, { status: () => true, value: check, observed_at: isIso, age_seconds: isCount });
  if (value.status === "unknown") return closed(value, { status: () => true, reason: V1_REASONS }, { observed_at: nullable(isIso) });
  return false;
};

const isTimeBasis = (value: unknown) => closed(value, {
  view_timezone: v => isString(v) && v.length > 0,
  source_domains: arrayOf(v => closed(v, { source_key: s => isString(s) && /^[a-z][a-z0-9_]{0,63}$/.test(s), timezone: s => isString(s) && s.length > 0 })),
});
const isFreshness = (value: unknown) => closed(value, { data_status: oneOf("ready", "stale", "unavailable"), age_seconds: nullable(isCount) });
const envelope = (version: string) => ({
  ok: (v: unknown) => v === true, schema_version: (v: unknown) => v === version, generated_at: isIso, time_basis: isTimeBasis,
});
const MODE = oneOf("dry_run", "paper", "live");
const OUTCOME = nullable(oneOf("filled", "orders_submitted", "no_op", "drift", "error", "skipped"));

// ---------------------------------------------------------------- ribbon

const isSession = (value: unknown) => closed(value, {
  market: oneOf("US", "HK", "CN"), state: oneOf("open", "closed", "pre", "post", "unknown"),
  open_utc: nullable(isClock), close_utc: nullable(isClock), next_change_at: nullable(isIso), holiday: nullable(isString),
});
const isTape = (value: unknown) => closed(value, {
  id: isString, at: isIso, target_id: isTargetId, label: isString, kind: isString, outcome: OUTCOME,
  outcome_detail: nullable(isString), state: oneOf("done", "running", "scheduled", "missed", "unknown"),
  source_business_date: isDate, source_timezone: v => isString(v) && v.length > 0,
});

export function isN1Ribbon(value: unknown): value is N1Ribbon {
  return closed(value, {
    ...envelope("qsl.desk.ribbon.v2"),
    date: isDate,
    date_basis: v => v === "utc_day",
    freshness: isFreshness,
    console_state: v => closed(v, { mode: read(MODE), gateways: isV1Read(oneOf("all_reachable", "degraded", "down")) }),
    alert_badge: read(v => closed(v, { open_count: isCount, critical_count: isCount })),
    sessions: arrayOf(isSession),
    next_run: read(nullable(v => closed(v, { target_id: isTargetId, kind: isString, due_at: isIso }))),
    tape: read(v => Array.isArray(v) && v.length <= 100 && v.every(isTape)),
  });
}

// ---------------------------------------------------------------- overview

const isNav = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  const base = { status: () => true, currency: (v: unknown) => isString(v) && /^[A-Z]{3,4}$/.test(v), amount: isDecimal, usd: nullable(isDecimal), observed_at: isIso };
  if (value.status === "known") return closed(value, base);
  if (value.status === "stale") return closed(value, { ...base, age_seconds: isCount });
  if (value.status === "unknown") return closed(value, { status: () => true, reason: V1_REASONS }, { observed_at: nullable(isIso) });
  return false;
};
const isBookRow = (value: unknown) => closed(value, {
  target_id: isTargetId, platform: isString, platform_label: isString, account_ref: isString, account_suffix: isString,
  strategy: isV1Read(v => closed(v, { profile: isString, label: isString })),
  mode: isV1Read(MODE), runtime: isV1Read(oneOf("running", "stopped", "unknown")), nav: isNav,
  day_change: nullable(v => closed(v, { ratio: isDecimal, amount: isDecimal, currency: isString })),
  sparkline_30d: v => closed(v, { points: arrayOf(isDecimal), dates_from: nullable(isDate), dates_to: nullable(isDate), gap_dates: arrayOf(isDate) }),
  drawdown: v => closed(v, { ratio: nullable(isDecimal), limit_ratio: nullable(isDecimal), state: oneOf("ok", "near_limit", "breached", "unknown") }),
  config: v => closed(v, { state: oneOf("synced", "drift", "unknown"), drift_count: read(isCount), checked_at: nullable(isIso) }),
  last_run: nullable(v => closed(v, { at: isIso, outcome: OUTCOME })),
  return_basis: oneOf("native_ibkr_twr", "nav_change_unadjusted", "unavailable"),
});
const isNeed = (value: unknown) => closed(value, {
  id: isString, kind: oneOf("config_drift", "credential_expiring", "decision_pending", "drawdown_near_limit", "run_missed", "data_stale", "other"),
  severity: oneOf("critical", "warning", "info"), target_id: nullable(isTargetId), title: isString, detail: isString,
  action: v => closed(v, { label: isString, route: isString }),
});
/** A known count read may not hide an unknown member. */
const knownMembers = (members: string[]) => (value: unknown): boolean =>
  !isObject(value) || value.status !== "known" || members.every(key => isObject(value.value) && value.value[key] !== null);
const isPending = arrayOf(v => closed(v, { target_id: isTargetId, due_at: isIso }));

export function isN1Overview(value: unknown): value is N1Overview {
  return closed(value, {
    ...envelope("qsl.desk.overview.v2"),
    snapshot_at: nullable(isIso),
    freshness: isFreshness,
    reporting_currency: v => isString(v) && /^[A-Z]{3,4}$/.test(v),
    totals: v => closed(v, {
      status: oneOf("complete", "partial", "unavailable"),
      excluded_reasons: arrayOf(oneOf("physical_identity_unverified", "coverage_incomplete", "no_non_paper_accounts", "fx_unavailable", "paper_excluded")),
      coverage: c => isCoverage(c, ["complete", "partial", "unavailable", "verified_empty"]),
      fx: f => closed(f, { status: s => s === "known", as_of: isIso, source: isString }) || closed(f, { status: s => s === "unknown", reason: V1_REASONS }),
      nav: nullable(isDecimal),
      day_change: nullable(d => closed(d, { amount: isDecimal, ratio: isDecimal })),
      drawdown: nullable(d => closed(d, { ratio: isDecimal, limit_ratio: isDecimal, peak_date: isDate })),
      gross_exposure_ratio: nullable(isDecimal),
      leveraged_etf_exposure_ratio: nullable(isDecimal),
      runs_today: r => isN1Read(r, x => closed(x, {
        done: nullable(isCount), expected: nullable(isCount), pending: nullable(isPending), source_business_date: isDate, source_timezone: isString,
      })) && knownMembers(["done", "expected", "pending"])(r),
      config_drift: r => isN1Read(r, x => closed(x, { count: nullable(isCount), target_ids: nullable(arrayOf(isTargetId)) }))
        && knownMembers(["count", "target_ids"])(r),
      data_age_seconds: nullable(isCount),
    }),
    book: read(arrayOf(isBookRow)),
    equity_curve: read(v => closed(v, {
      range: oneOf("1M", "3M", "6M", "YTD", "1Y", "ALL"),
      portfolio: p => closed(p, { dates: arrayOf(isDate), indexed: arrayOf(isDecimal) }) && (p as { dates: unknown[]; indexed: unknown[] }).dates.length === (p as { indexed: unknown[] }).indexed.length,
      drawdown: arrayOf(isDecimal), history_starts: nullable(isDate),
      return_basis: oneOf("native_ibkr_twr", "nav_change_unadjusted", "mixed", "unavailable"),
    })),
    needs_you: read(v => Array.isArray(v) && v.length <= 5 && v.every(isNeed)),
  });
}

// ---------------------------------------------------------------- accounts

const PHASES = oneOf("unknown", "not_due", "30", "7", "1", "expired");
const isExpiry = (value: unknown) => closed(value, { status: s => s === "known", at: isIso, source: isString })
  || closed(value, { status: s => s === "none" }) || closed(value, { status: s => s === "unknown", reason: V1_REASONS });
const isCredential = (value: unknown) => closed(value, {
  kind: oneOf("oauth_refresh", "flex_token", "access_token", "api_key", "password", "session", "other"),
  expiry: isExpiry, phase: PHASES, requires_action: v => typeof v === "boolean",
}, { note: isString }) && (value as { requires_action: boolean }).requires_action === ["30", "7", "1", "expired"].includes((value as { phase: string }).phase);
const isBroker = (value: unknown) => closed(value, {
  platform: isString, label: isString,
  targets: arrayOf(v => closed(v, { target_id: isTargetId, account_ref: isString })),
  connectivity: read(oneOf("up", "degraded", "down")),
  connectivity_detail: nullable(isString),
  heartbeat: read(v => closed(v, { at: isIso })),
  data_freshness: isFreshness,
  config: v => closed(v, { state: oneOf("synced", "drift", "unknown"), drift_count: read(isCount), checked_at: nullable(isIso) }),
  credential: isCredential,
  last_order: read(v => closed(v, { at: isIso, count: isCount })),
});

export function isN1Accounts(value: unknown): value is N1Accounts {
  return closed(value, { ...envelope("qsl.desk.accounts.v2"), brokers: read(arrayOf(isBroker)) });
}

// ---------------------------------------------------------------- switch strategies

const isStrategyRow = (value: unknown) => closed(value, {
  profile: isString, label: isString, domain: isString, allowed_execution_modes: arrayOf(MODE), lifecycle_stage: isString,
  eligibility: read(oneOf("eligible", "no_live", "blocked")),
  reason: nullable(oneOf("domain_not_supported", "strategy_frozen", "platform_live_not_supported", "catalog_not_live_enabled")),
});

export function isN1SwitchStrategies(value: unknown): value is N1SwitchStrategies {
  return closed(value, {
    ...envelope("qsl.desk.switch_strategies.v2"),
    target_id: isTargetId,
    domain: read(isString),
    switchable: v => closed(v, { allowed: a => a === false, reason_code: r => r === "switch_not_connected" }),
    catalog_revision: read(v => closed(v, { kind: k => k === "projection_fingerprint", algorithm: a => a === "sha256", value: h => isString(h) && /^[0-9a-f]{64}$/.test(h) })),
    strategies: read(arrayOf(isStrategyRow)),
  });
}

// ---------------------------------------------------------------- performance

const RISK_KEYS = ["return_ratio", "vs_benchmark_pts", "volatility_ann_ratio", "sharpe", "sortino", "max_drawdown_ratio",
  "time_under_water_days", "best_day_ratio", "worst_day_ratio"] as const;

export function isN1Performance(value: unknown): value is N1Performance {
  return closed(value, {
    ...envelope("qsl.desk.performance.v2"),
    range: oneOf("1M", "3M", "6M", "YTD", "1Y", "ALL"),
    scope: v => v === "all",
    history: v => closed(v, { first_date: nullable(isDate), requested_from: nullable(isDate), truncated_by: nullable(oneOf("retention", "inception")), retention_days: d => d === 366 }),
    return_basis: v => closed(v, {
      kind: oneOf("native_ibkr_twr", "nav_change_unadjusted", "mixed", "unavailable"),
      per_target: p => isObject(p) && Object.entries(p).every(([key, basis]) => isTargetId(key) && oneOf("native_ibkr_twr", "nav_change_unadjusted", "unavailable")(basis)),
    }),
    equity: read(v => closed(v, {
      dates: arrayOf(isDate), portfolio_indexed: arrayOf(isDecimal), drawdown_ratio: arrayOf(isDecimal), gap_dates: arrayOf(isDate),
      gap_semantics: s => s === "break_before_observation",
    }) && (v as { dates: unknown[] }).dates.length === (v as { portfolio_indexed: unknown[] }).portfolio_indexed.length
      && (v as { dates: unknown[] }).dates.length === (v as { drawdown_ratio: unknown[] }).drawdown_ratio.length),
    risk: v => closed(v, Object.fromEntries(RISK_KEYS.map(key => [key, read(key === "time_under_water_days" ? isCount : isDecimal)]))),
    // Not rendered by this package; their payload shape is not trusted for display.
    scorecard: read(Array.isArray),
    contribution: read(isObject),
    monthly: read(isObject),
  });
}

// ---------------------------------------------------------------- reading helpers for pages

/** Copy key for an N1 reason; codes from a newer backend fall back to a generic label. */
export function n1ReasonKey(reason: string): DeskKey {
  return ((N1_REASONS as readonly string[]).includes(reason) ? `read.reason.${reason}` : "read.reason.other") as DeskKey;
}

/** "3/5" for partial coverage; an unknown total is "?", never the included count. */
export function coverageText(coverage: N1Coverage, unknownMark = "?"): string {
  return `${coverage.included}/${coverage.total ?? unknownMark}`;
}

/** The value a page may show: known, stale (greyed) or partial (verified subset); otherwise null. */
export function readValue<T>(value: N1Read<T>): T | null {
  return value.status === "unknown" ? null : value.value;
}

/** True only for a complete, non-stale read: the only case a full count or total may be shown. */
export const isComplete = <T,>(value: N1Read<T>): value is Extract<N1Read<T>, { status: "known" }> => value.status === "known";

// ---------------------------------------------------------------- mock-only v1 → N1 normalisation

const complete = (included: number): N1Coverage => included === 0
  ? { state: "verified_empty", included: 0, total: 0, reasons: [] }
  : { state: "complete", included, total: included, reasons: [] };
const unknownCover: N1Coverage = { state: "unavailable", included: 0, total: null, reasons: [] };
const mockKnown = <T,>(value: T, at: string, count = 1): N1Read<T> => ({ status: "known", value, observed_at: at, coverage: complete(count) });
function fromV1<T>(value: Read<T>): N1Read<T> {
  if (value.status === "known") return { status: "known", value: value.value, observed_at: value.observed_at, coverage: complete(1) };
  if (value.status === "stale") return { status: "stale", value: value.value, observed_at: value.observed_at, age_seconds: value.age_seconds, coverage: complete(1) };
  return { status: "unknown", reason: value.reason, observed_at: value.observed_at ?? null, coverage: { ...unknownCover, reasons: [value.reason] } };
}
const notSupported = <T,>(): N1Read<T> => ({ status: "unknown", reason: "not_supported", observed_at: null, coverage: { ...unknownCover, reasons: ["not_supported"] } });
const MOCK_BASIS = { view_timezone: "UTC", source_domains: [{ source_key: "fixture", timezone: "UTC" }] };

export function ribbonFromMock(v1: Ribbon): N1Ribbon {
  const at = v1.generated_at;
  return {
    ok: true, schema_version: "qsl.desk.ribbon.v2", generated_at: at, time_basis: MOCK_BASIS,
    date: v1.date, date_basis: "utc_day", freshness: { data_status: "ready", age_seconds: 0 },
    console_state: { mode: mockKnown(v1.console_state.mode, at), gateways: v1.console_state.gateways },
    alert_badge: mockKnown({ ...v1.alert_badge }, at),
    sessions: v1.sessions,
    next_run: mockKnown(v1.next_run, at),
    tape: mockKnown(v1.tape.map(entry => ({ ...entry, source_business_date: entry.at.slice(0, 10), source_timezone: "UTC" })), at, v1.tape.length),
  };
}

function bookFromMock(row: BookRow, at: string): N1BookRow {
  return { ...row, config: { state: row.config.state, drift_count: mockKnown(row.config.drift_count, at), checked_at: row.config.checked_at ?? null } };
}

export function overviewFromMock(v1: Overview): N1Overview {
  const at = v1.generated_at;
  const { coverage, runs_today: runs, config_drift: drift, ...totals } = v1.totals;
  const state: N1Coverage["state"] = v1.totals.status === "complete" ? "complete" : coverage.included > 0 ? "partial" : "unavailable";
  const { benchmark: _benchmark, ...curve } = v1.equity_curve;
  void _benchmark;
  return {
    ok: true, schema_version: "qsl.desk.overview.v2", generated_at: at, time_basis: MOCK_BASIS,
    snapshot_at: v1.snapshot_at, freshness: v1.freshness, reporting_currency: v1.reporting_currency,
    totals: {
      ...totals,
      excluded_reasons: coverage.excluded_reasons,
      coverage: { state: coverage.total === 0 ? "verified_empty" : state, included: coverage.included, total: coverage.total,
        reasons: state === "complete" || coverage.total === 0 ? [] : ["coverage_incomplete"] },
      runs_today: mockKnown({ ...runs, source_business_date: v1.generated_at.slice(0, 10), source_timezone: "UTC" }, at),
      config_drift: mockKnown(drift, at),
    },
    book: mockKnown(v1.book.map(row => bookFromMock(row, at)), at, v1.book.length),
    equity_curve: mockKnown(curve, at),
    needs_you: mockKnown(v1.needs_you, at, v1.needs_you.length),
  };
}

function brokerFromMock(broker: BrokerHealth, at: string): N1BrokerHealth {
  return {
    ...broker,
    connectivity: fromV1(broker.connectivity),
    heartbeat: fromV1(broker.heartbeat),
    last_order: fromV1(broker.last_order),
    config: { state: broker.config.state, drift_count: mockKnown(broker.config.drift_count, at), checked_at: broker.config.checked_at ?? null },
  };
}

export function accountsFromMock(v1: Accounts): N1Accounts {
  const at = v1.generated_at;
  return {
    ok: true, schema_version: "qsl.desk.accounts.v2", generated_at: at, time_basis: MOCK_BASIS,
    brokers: mockKnown(v1.brokers.map(broker => brokerFromMock(broker, at)), at, v1.brokers.length),
  };
}

const ELIGIBILITY_REASONS = ["domain_not_supported", "strategy_frozen", "platform_live_not_supported", "catalog_not_live_enabled"] as const;
function strategyFromMock(option: StrategyOption, at: string): N1StrategyRow {
  const reason = (ELIGIBILITY_REASONS as readonly string[]).includes(option.reason ?? "") ? option.reason as N1StrategyRow["reason"] : null;
  return {
    profile: option.profile, label: option.label, domain: option.domain, allowed_execution_modes: option.allowed_execution_modes,
    lifecycle_stage: option.lifecycle_stage, eligibility: mockKnown(option.eligibility, at), reason,
  };
}

export function switchStrategiesFromMock(v1: SwitchStrategies): N1SwitchStrategies {
  const at = v1.generated_at;
  return {
    ok: true, schema_version: "qsl.desk.switch_strategies.v2", generated_at: at, time_basis: MOCK_BASIS,
    target_id: v1.target_id, domain: mockKnown(v1.domain, at),
    switchable: { allowed: false, reason_code: "switch_not_connected" },
    // A fixture label is not a projection fingerprint.
    catalog_revision: notSupported(),
    strategies: mockKnown(v1.strategies.map(option => strategyFromMock(option, at)), at, v1.strategies.length),
  };
}

export function performanceFromMock(v1: Performance): N1Performance {
  const at = v1.generated_at;
  const { benchmark: _benchmark, ...equity } = v1.equity;
  void _benchmark;
  const risk = Object.fromEntries(Object.entries(v1.risk).map(([key, value]) => [key, fromV1(value as Read<unknown>)])) as N1Performance["risk"];
  return {
    ok: true, schema_version: "qsl.desk.performance.v2", generated_at: at, time_basis: MOCK_BASIS,
    range: v1.range, scope: "all",
    history: { ...v1.history, truncated_by: v1.history.truncated_by === "retention" || v1.history.truncated_by === "inception" ? v1.history.truncated_by : null, retention_days: 366 },
    return_basis: v1.return_basis,
    equity: mockKnown({ ...equity, gap_semantics: "break_before_observation" }, at),
    risk,
    // Not part of N1 (no calculation, no UI panel): unknown even for a fixture.
    scorecard: notSupported(),
    contribution: notSupported(),
    monthly: notSupported(),
  };
}

export type { Freshness, Guard };
