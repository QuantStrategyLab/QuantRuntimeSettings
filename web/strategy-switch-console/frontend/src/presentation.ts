import { applicationRetryAllowed, ownerDecisionBinding, presentAccountState, promotionSuggestion, promotionDecisionReady, type HumanDecisionState, recoveryBinding } from "./operations.ts";
import { accountFactsForDisplay, binanceProviderProductTypeForDisplay } from "./types.ts";
import type { AccountFactsAccount, BinancePrivateScopeAsset, BinancePrivateScopeDisplay, BinanceWalletHistoryPoint } from "./types";
import type { LifecycleRecord } from "./api";
import { DEFAULT_STRATEGY_PROFILES } from "../../strategy_profiles_asset.js";
import { RUNTIME_DAILY_TARGET, runtimeDailyTarget, runtimeDailyRecordMatchesTarget, runtimeDailyRunIssue } from "../../runtime_daily_contract.js";
export { runtimeDailySelectionBinding } from "../../runtime_daily_contract.js";

const BINANCE_SCOPE_MAX_ASSETS = 5000;
const BINANCE_SCOPE_MAX_DECIMAL_LENGTH = 128;
const BINANCE_SCOPE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BINANCE_WALLET_VALUATION_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const BINANCE_SCOPE_FUTURE_SKEW_MS = 60 * 1000;

function validBinanceScopeInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  if (Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) return false;
  if (offsetHourText && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function isZeroFixedDecimal(value: string): boolean {
  return /^0+(?:\.0+)?$/.test(value);
}

function validBinanceScopeAsset(value: unknown): value is BinancePrivateScopeAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "asset,free,locked") return false;
  if (typeof row.asset !== "string" || !/^[\p{L}\p{N}]{1,20}$/u.test(row.asset)) return false;
  for (const field of ["free", "locked"] as const) {
    const amount = row[field];
    if (typeof amount !== "string" || amount.length > BINANCE_SCOPE_MAX_DECIMAL_LENGTH || !/^\d+(?:\.\d+)?$/.test(amount)) return false;
  }
  return !isZeroFixedDecimal(row.free as string) || !isZeroFixedDecimal(row.locked as string);
}

export function presentBinancePrivateScope(
  value: unknown,
  options: { admin: boolean; allAccounts: boolean; now?: number },
): BinancePrivateScopeDisplay | null {
  if (!options.admin || !options.allAccounts || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (response.ok !== true || !response.report || typeof response.report !== "object" || Array.isArray(response.report)) return null;
  const report = response.report as Record<string, unknown>;
  if (report.platform !== "binance" || report.historical_difference_unresolved !== true || report.no_order !== true || report.execution_authority_granted !== false) return null;
  if (!validBinanceScopeInstant(report.observed_at) || !Array.isArray(report.assets) || report.assets.length > BINANCE_SCOPE_MAX_ASSETS) return null;
  const age = (options.now ?? Date.now()) - Date.parse(report.observed_at);
  if (age > BINANCE_SCOPE_MAX_AGE_MS || age < -BINANCE_SCOPE_FUTURE_SKEW_MS) return null;
  const seen = new Set<string>();
  const assets: BinancePrivateScopeAsset[] = [];
  for (const value of report.assets) {
    if (!validBinanceScopeAsset(value) || seen.has(value.asset)) return null;
    seen.add(value.asset);
    assets.push({ asset: value.asset, free: value.free, locked: value.locked });
  }
  return { observed_at: report.observed_at, assets };
}

export function presentBinanceWalletValuation(report: unknown, now = Date.now()): {
  amount: string;
  currency: "USDT";
  observed_at: string;
} | null {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  const facts = report as Record<string, unknown>;
  const valuation = facts.wallet_valuation;
  if (!valuation || typeof valuation !== "object" || Array.isArray(valuation)) return null;
  const summary = valuation as Record<string, unknown>;
  if (summary.status !== "available"
      || summary.currency !== "USDT"
      || summary.source !== "GET /sapi/v1/asset/wallet/balance"
      || summary.scope !== "provider_returned_wallet_rows"
      || typeof summary.amount !== "string"
      || !/^(?:0|[1-9]\d{0,29})(?:\.\d{0,29}[1-9])?(?![\s\S])/.test(summary.amount)
      || !Number.isInteger(summary.wallet_count) || (summary.wallet_count as number) < 1
      || (summary.wallet_count as number) > 32
      || typeof summary.observed_at !== "string" || !summary.observed_at.endsWith("Z")
      || !validBinanceScopeInstant(summary.observed_at)
      || !validBinanceScopeInstant(facts.observed_finished_at)) return null;
  const observed = Date.parse(summary.observed_at);
  const reportFinished = Date.parse(facts.observed_finished_at as string);
  const age = now - observed;
  if (observed > reportFinished || age > BINANCE_WALLET_VALUATION_MAX_AGE_MS
      || age < -BINANCE_SCOPE_FUTURE_SKEW_MS) return null;
  return { amount: summary.amount, currency: "USDT", observed_at: summary.observed_at };
}

export function presentBinanceWalletValuationForAccount(
  accountId: string,
  walletAccountId: string | null | undefined,
  report: unknown,
  now = Date.now(),
): { amount: string; currency: "USDT"; observed_at: string } | null {
  if (!walletAccountId || accountId !== walletAccountId) return null;
  return presentBinanceWalletValuation(report, now);
}

const BINANCE_WALLET_FAILURE_DETAILS: Record<string, string> = {
  wallet_read_failed: "钱包余额读取失败",
  wallet_response_invalid: "钱包返回资料无效",
  wallet_row_invalid: "钱包行资料未确认",
  wallet_duplicate_name: "钱包名称重复，估值无法确认",
  wallet_inactive_nonzero: "未启用钱包存在余额，估值待确认",
  wallet_balance_invalid: "钱包余额格式未确认",
};

/** Returns fixed, user-safe copy; never forwards provider or transport errors. */
export function binanceWalletStatusDetail(
  response: unknown,
  now = Date.now(),
): string {
  if (!response || typeof response !== "object" || Array.isArray(response)) return "钱包报告读取失败";
  const result = response as Record<string, unknown>;
  if (result.error) return "钱包报告读取失败";
  const reportStatus = result.report_status;
  const report = result.report;
  if (reportStatus === "missing") return "尚未取得钱包报告";
  if (reportStatus === "expired") return "钱包报告已过期";
  if (reportStatus === "unavailable") return "钱包报告读取失败";
  if (reportStatus !== "available" || !report || typeof report !== "object" || Array.isArray(report)) {
    return "钱包报告读取失败";
  }
  const facts = report as Record<string, unknown>;
  const valuation = facts.wallet_valuation;
  if (valuation && typeof valuation === "object" && !Array.isArray(valuation)) {
    const summary = valuation as Record<string, unknown>;
    if (summary.status === "unavailable") {
      return BINANCE_WALLET_FAILURE_DETAILS[String(summary.reason_code)] || "钱包估值原因待确认";
    }
    if (summary.status === "available") {
      const observedAt = typeof summary.observed_at === "string" && validBinanceScopeInstant(summary.observed_at)
        ? Date.parse(summary.observed_at) : NaN;
      if (Number.isFinite(observedAt) && now - observedAt > BINANCE_WALLET_VALUATION_MAX_AGE_MS) {
        return "钱包估值已过期";
      }
      return presentBinanceWalletValuation(report, now) ? "钱包估值已取得" : "钱包估值资料未确认";
    }
  }
  return "报告未包含钱包估值";
}

function roundedDecimalString(value: string, places: number): { display: string; nonzero: boolean } | null {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const [, sign, integer, fraction = ""] = match;
  const nonzero = /[1-9]/.test(integer + fraction);
  const kept = fraction.padEnd(places, "0").slice(0, places);
  const shouldRoundUp = fraction.length > places && fraction[places] >= "5";
  const digits = `${integer}${kept}`.split("").map(Number);
  if (shouldRoundUp) {
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      digits[index] += 1;
      if (digits[index] < 10) break;
      digits[index] = 0;
      if (index === 0) digits.unshift(1);
    }
  }
  const padded = digits.join("").padStart(places + 1, "0");
  const whole = padded.slice(0, -places);
  const decimal = places ? `.${padded.slice(-places)}` : "";
  const roundedToZero = !/[1-9]/.test(whole + decimal);
  return { display: `${sign === "-" && nonzero ? "-" : ""}${whole}${decimal}`, nonzero: nonzero && !roundedToZero };
}

export function formatBinanceWalletAmount(value: string): string {
  const rounded = roundedDecimalString(value, 2);
  if (!rounded) return value;
  if (rounded.nonzero) return rounded.display;
  if (/^-?0(?:\.0*)?$/.test(value)) return rounded.display;
  return value.startsWith("-") ? ">-0.01" : "<0.01";
}

export function formatBinanceNativeQuantity(value: string): string {
  const rounded = roundedDecimalString(value, 8);
  if (!rounded) return value;
  if (rounded.nonzero) return rounded.display.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (/^-?0(?:\.0*)?$/.test(value)) return rounded.display.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return value.startsWith("-") ? ">-0.00000001" : "<0.00000001";
}

export function scheduleBinancePrivateScopeExpiry(
  observedAt: unknown,
  onExpiry: () => void,
  now = Date.now(),
  timers: Pick<Window, "setTimeout" | "clearTimeout"> = window,
  maxAgeMs = BINANCE_SCOPE_MAX_AGE_MS,
): () => void {
  if (!validBinanceScopeInstant(observedAt)) return () => {};
  const expiresAfter = Date.parse(observedAt) + maxAgeMs + 1;
  const timer = timers.setTimeout(onExpiry, Math.max(0, expiresAfter - now));
  return () => timers.clearTimeout(timer);
}

export type ChartMode = "return" | "assets";

export type OverviewChartAccountCandidate = {
  id: string;
  brokerEnvironment: string | null;
  facts: {
    binding_status: string;
    identity_mismatch?: boolean;
    data_status: string;
    broker_environment?: string | null;
    account_scope?: string | null;
    balances: Array<{ currency: string; net_assets?: string | null }>;
  } | null;
};

export function defaultOverviewChartAccountId(accounts: OverviewChartAccountCandidate[]): string | null {
  return accounts.find((account) => {
    const facts = account.facts;
    if (account.brokerEnvironment === "paper" || !facts || facts.binding_status !== "bound"
        || facts.data_status !== "fresh" || facts.identity_mismatch === true
        || facts.broker_environment === "paper" || facts.account_scope === "paper") return false;
    return facts.balances.some((balance) => /^[A-Z0-9]{3,10}$/.test(balance.currency)
      && typeof balance.net_assets === "string" && balance.net_assets.length > 0);
  })?.id ?? null;
}

export function resolveOverviewChartAccount<T extends { id: string }>(
  accounts: T[],
  primaryAccountId: string,
  chartAccountId: string | null,
): T | null {
  if (primaryAccountId !== "all") return accounts.find((account) => account.id === primaryAccountId) ?? null;
  return accounts.find((account) => account.id === chartAccountId) ?? null;
}

export const RETURN_INDEX_LEGEND = ["标普500", "纳斯达克100", "道琼斯工业平均指数", "罗素2000"] as const;

export type OverviewFigures = {
  assets: null;
  cash: null;
  accountCount: number | null;
  annualReturn: null;
  maxDrawdown: null;
  riskPreference: string | null;
  series: null;
};

export function overviewFigures(accountCount: number | null, preferences: Array<string | null | undefined>): OverviewFigures {
  const known = preferences.filter((item): item is string => typeof item === "string" && item.length > 0);
  const unique = [...new Set(known)];
  const incomplete = preferences.some(item => typeof item !== "string" || item.length === 0);
  return {
    assets: null,
    cash: null,
    accountCount: typeof accountCount === "number" && Number.isFinite(accountCount) ? accountCount : null,
    annualReturn: null,
    maxDrawdown: null,
    riskPreference: !incomplete && unique.length === 1 ? unique[0] : null,
    series: null,
  };
}

export function chartUnavailable(mode: ChartMode): "暂无资产记录" | "暂不可用" {
  if (mode === "return") return "暂不可用";
  return "暂无资产记录";
}

export type ChartRange = "3m" | "6m" | "1y" | "3y" | "5y" | "10y" | "all";

export const CHART_RANGE_OPTIONS: Array<{ id: ChartRange; label: "3个月" | "半年" | "1年" | "3年" | "5年" | "10年" | "至今" }> = [
  { id: "3m", label: "3个月" },
  { id: "6m", label: "半年" },
  { id: "1y", label: "1年" },
  { id: "3y", label: "3年" },
  { id: "5y", label: "5年" },
  { id: "10y", label: "10年" },
  { id: "all", label: "至今" },
];

export const DEFAULT_CHART_RANGE: ChartRange = "1y";

const CHART_RANGE_DAYS: Record<Exclude<ChartRange, "all">, number> = {
  "3m": 92,
  "6m": 183,
  "1y": 366,
  "3y": 366 * 3,
  "5y": 366 * 5,
  "10y": 366 * 10,
};

export function chartRangeNote(range: ChartRange): { key: "暂无资产记录" | "{range}内暂无资产记录"; rangeLabel: "3个月" | "半年" | "1年" | "3年" | "5年" | "10年" | "至今" } {
  const option = CHART_RANGE_OPTIONS.find(item => item.id === range) || CHART_RANGE_OPTIONS[2];
  if (range === "all") return { key: "暂无资产记录", rangeLabel: option.label };
  return { key: "{range}内暂无资产记录", rangeLabel: option.label };
}

export function chartRangeEmptyNote(range: ChartRange): { key: "暂无资产记录" | "{range}内暂无资产记录"; rangeLabel: "3个月" | "半年" | "1年" | "3年" | "5年" | "10年" | "至今" } {
  return chartRangeNote(range);
}

export const RUNTIME_DAILY_TIMEZONE = "America/New_York";

export function runtimeBusinessDate(now: number | Date = Date.now()): string {
  const instant = typeof now === "number" ? now : now.getTime();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RUNTIME_DAILY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export type AssetHistoryPoint = {
  observation_date: string;
  observed_finished_at: string;
  currency: string;
  net_assets: string;
  total_cash: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CHART_VALUE_ABS_MAX = 1e12;

function utcDayMs(dateText: string): number | null {
  if (!DATE_RE.test(dateText)) return null;
  const ms = Date.parse(`${dateText}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === dateText ? ms : null;
}

function addUtcDays(dateText: string, delta: number): string | null {
  const ms = utcDayMs(dateText);
  if (ms === null) return null;
  return new Date(ms + delta * 86400000).toISOString().slice(0, 10);
}

export function runtimeDateBounds(now: number | Date = Date.now()): { min: string; max: string } {
  const max = runtimeBusinessDate(now);
  return { min: addUtcDays(max, -89)!, max };
}

export function runtimeDateSelectable(date: string, now: number | Date = Date.now()): boolean {
  const bounds = runtimeDateBounds(now);
  return utcDayMs(date) !== null && date >= bounds.min && date <= bounds.max;
}

export function parseMoneyForChart(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !MONEY_RE.test(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > CHART_VALUE_ABS_MAX) return null;
  return n;
}

export function filterAssetHistoryByRange<T extends { observation_date: string }>(points: T[], range: ChartRange, now = Date.now()): T[] {
  if (!Array.isArray(points) || !points.length) return [];
  const sorted = [...points].filter((item) => item && DATE_RE.test(item.observation_date)).sort((a, b) => a.observation_date.localeCompare(b.observation_date));
  if (range === "all") return sorted;
  const days = CHART_RANGE_DAYS[range];
  const end = new Date(now).toISOString().slice(0, 10);
  const start = addUtcDays(end, -(days - 1));
  if (!start) return sorted;
  return sorted.filter((item) => item.observation_date >= start && item.observation_date <= end);
}

export type AssetChartGeometry = {
  width: number;
  height: number;
  segments: string[];
  dots: Array<{ x: number; y: number; date: string; amount: string }>;
  minLabel: string | null;
  maxLabel: string | null;
};

function buildChartValueGeometry(points: Array<{ observation_date: string; amount: string; break_before?: boolean }>, width = 640, height = 220): AssetChartGeometry {
  const usable: Array<{ observation_date: string; amount: string; value: number; day: number; break_before?: boolean }> = [];
  for (const point of points) {
    const value = parseMoneyForChart(point.amount);
    const day = utcDayMs(point.observation_date);
    if (value !== null && day !== null) usable.push({ ...point, value, day });
  }
  if (!usable.length) {
    return { width, height, segments: [], dots: [], minLabel: null, maxLabel: null };
  }
  const padX = 16;
  const padY = 18;
  const minX = usable[0].day;
  const maxX = usable[usable.length - 1].day;
  const values = usable.map((item) => item.value);
  let minY = Math.min(...values);
  let maxY = Math.max(...values);
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const spanX = Math.max(maxX - minX, 86400000);
  const spanY = maxY - minY;
  const xAt = (day: number) => padX + ((day - minX) / spanX) * (width - padX * 2);
  const yAt = (value: number) => height - padY - ((value - minY) / spanY) * (height - padY * 2);
  const dots = usable.map((item) => ({
    x: xAt(item.day),
    y: yAt(item.value),
    date: item.observation_date,
    amount: item.amount,
  }));
  const segments: string[] = [];
  let current: string[] = [];
  for (let index = 0; index < usable.length; index += 1) {
    const point = usable[index];
    const command = `${current.length ? "L" : "M"}${xAt(point.day).toFixed(2)} ${yAt(point.value).toFixed(2)}`;
    if (!current.length) current.push(command);
    else {
      const prev = usable[index - 1];
      const expected = addUtcDays(prev.observation_date, 1);
      if (expected === point.observation_date && !point.break_before) current.push(command);
      else {
        if (current.length >= 2) segments.push(current.join(" "));
        current = [`M${xAt(point.day).toFixed(2)} ${yAt(point.value).toFixed(2)}`];
      }
    }
  }
  if (current.length >= 2) segments.push(current.join(" "));
  return {
    width,
    height,
    segments,
    dots,
    minLabel: usable.reduce((best, item) => item.value <= (parseMoneyForChart(best) ?? Infinity) ? item.amount : best, usable[0].amount),
    maxLabel: usable.reduce((best, item) => item.value >= (parseMoneyForChart(best) ?? -Infinity) ? item.amount : best, usable[0].amount),
  };
}

export function buildAssetChartGeometry(points: AssetHistoryPoint[], width = 640, height = 220): AssetChartGeometry {
  return buildChartValueGeometry(points.map((point) => ({
    observation_date: point.observation_date,
    amount: point.net_assets,
  })), width, height);
}

export function buildBinanceWalletHistoryChartGeometry(
  points: BinanceWalletHistoryPoint[], width = 640, height = 220,
): AssetChartGeometry {
  return buildChartValueGeometry(points, width, height);
}

export type RuntimeDailySnapshot = {
  ok: true;
  platform?: string;
  target_key?: string;
  date: string;
  timezone: string;
  account_key: string;
  data_status: "fresh" | "stale" | "historical" | "unavailable";
  record: {
    target_key: string;
    service: string;
    strategy_profile: string;
    account_scope: string;
    status: string;
    kind: string;
    execution_lane: string;
    business_date: string;
    observed_at: string;
    completeness?: string;
    schedule?: { state?: string; business_date?: string; timezone?: string; expected_window?: string; reason?: string | null; latest_due_at?: string | null; next_due_at?: string | null; grace_ends_at?: string | null; publication_grace_ended?: boolean | null };
    runs?: Array<{ run_id: string | null; started_at: string | null; finished_at: string | null; activity: string; execution_lane: string; errors_present: boolean; issue?: "failure" | "unconfirmed" | null }>;
    conflict_count?: number;
  } | null;
  fills: { source: "not_connected"; records: []; count: null } | null;
  read_error_count?: number;
  unmatched_count?: number;
  history?: {
    available_from: string | null;
    available_through: string | null;
    stored_days: number;
    truncated: boolean;
  };
};

export type RuntimeDailyPresentation = {
  available: boolean;
  accountMatched: boolean;
  title: string;
  statusLabel: string;
  statusDetails: string[];
  runStartedAt: string | null;
  runFinishedAt: string | null;
  dryRun: boolean;
  fillsLabel: string;
  dataStatusLabel: string;
  updatedAt: string | null;
  historyFrom: string | null;
  historyThrough: string | null;
  historyDays: number;
  historyTruncated: boolean;
};

const RUNTIME_DAILY_STATUS_LABELS: Record<string, string> = {
  no_submission: "无交易",
  no_signal: "无交易",
  no_rebalance: "无交易",
  submitted: "已提交",
  broker_acknowledged: "券商已确认",
  partially_filled: "部分成交",
  filled: "已成交",
  reconciliation_required: "结果待确认",
  unknown: "结果待确认",
  failed: "异常",
  blocked: "已阻断",
  dry_run: "只读演练",
  shadow: "模拟观察",
  validation: "验证",
  not_due: "未到期",
  market_closed: "休市",
  outside_window: "窗口外",
  within_grace: "宽限内",
  missing_report: "暂无数据",
  read_incomplete: "暂不可用",
  insufficient: "暂不可用",
  conflict: "结果待确认",
};

export const RUNTIME_DAILY_PLATFORM = RUNTIME_DAILY_TARGET.platform;

export type RuntimeDailyBinding = "bound" | "not_applicable" | "unresolved";

export type RuntimeDailySelection = {
  platform: string | null | undefined;
  accountKey: string | null | undefined;
  dailyBinding: RuntimeDailyBinding;
};

export function runtimeDailySelectionEligible(selection: RuntimeDailySelection | null | undefined): boolean {
  if (!selection) return false;
  if (typeof selection.platform !== "string" || !selection.platform) return false;
  if (typeof selection.accountKey !== "string" || !selection.accountKey) return false;
  return Boolean(runtimeDailyTarget(selection.platform)) && selection.dailyBinding === "bound";
}

export function runtimeDailyAccountDateKey(platform: string, accountKey: string, date: string): string {
  return JSON.stringify([platform, accountKey, date]);
}

export function runtimeDailySnapshotMatchesSelection(snapshot: RuntimeDailySnapshot, selection: RuntimeDailySelection, date?: string): boolean {
  const target = runtimeDailyTarget(selection.platform);
  if (!target || snapshot.ok !== true || snapshot.account_key !== selection.accountKey) return false;
  // Old PAPER read fixtures remain compatible; Schwab always requires explicit identity.
  if ((snapshot.platform !== undefined && snapshot.platform !== target.platform)
    || (snapshot.target_key !== undefined && snapshot.target_key !== target.target_key)
    || (target.platform === "schwab" && (snapshot.platform !== "schwab" || snapshot.target_key !== target.target_key))) return false;
  return (!snapshot.record || runtimeDailyRecordMatchesTarget(snapshot.record, target.platform))
    && (!date || (snapshot.date === date && (!snapshot.record || snapshot.record.business_date === date)));
}

export function presentRuntimeDaily(
  snapshot: RuntimeDailySnapshot | null | undefined,
  selection: RuntimeDailySelection | null | undefined,
  date?: string,
): RuntimeDailyPresentation {
  const empty: RuntimeDailyPresentation = {
    available: false,
    accountMatched: false,
    title: "每日运行记录",
    statusLabel: "—",
    statusDetails: ["请选择账户"],
    runStartedAt: null,
    runFinishedAt: null,
    dryRun: false,
    fillsLabel: "—",
    dataStatusLabel: "—",
    updatedAt: null,
    historyFrom: null,
    historyThrough: null,
    historyDays: 0,
    historyTruncated: false,
  };
  if (!selection || typeof selection.accountKey !== "string" || !selection.accountKey) return empty;
  // Eligibility is the unique configured source binding, not a platform or lane guess.
  if (!runtimeDailySelectionEligible(selection)) {
    const unresolved = selection.dailyBinding !== "not_applicable" || typeof selection.platform !== "string" || !selection.platform;
    return {
      ...empty,
      accountMatched: false,
      statusLabel: unresolved ? "待确认" : "未接入",
      statusDetails: [unresolved ? "周期记录目标绑定未确认" : "该账户尚未接入此日报来源"],
      fillsLabel: unresolved ? "暂无数据" : "未接入",
      dataStatusLabel: "—",
    };
  }
  if (!snapshot || snapshot.ok !== true) {
    return {
      ...empty,
      accountMatched: false,
      statusDetails: [],
      fillsLabel: "暂无数据",
      dataStatusLabel: "暂不可用",
    };
  }
  if (!runtimeDailySnapshotMatchesSelection(snapshot, selection, date)) {
    return {
      ...empty,
      accountMatched: false,
      statusLabel: "无记录",
      statusDetails: ["该账户暂无可用运行记录"],
      fillsLabel: "暂无数据",
      dataStatusLabel: "暂无数据",
    };
  }
  const observedAt = typeof snapshot.record?.observed_at === "string" ? snapshot.record.observed_at : null;
  const fillsLabel = snapshot.fills?.source === "not_connected" ? "未接入" : "暂无数据";
  const dataStatusLabel = snapshot.data_status === "stale"
    ? "数据暂不可用"
    : snapshot.data_status === "unavailable"
      ? "暂不可用"
      : "—";
  const history = snapshot.history;
  const historyDays = history && Number.isInteger(history.stored_days) && history.stored_days >= 0 ? history.stored_days : 0;
  const historyFields = {
    historyFrom: history && typeof history.available_from === "string" ? history.available_from : null,
    historyThrough: history && typeof history.available_through === "string" ? history.available_through : null,
    historyDays,
    historyTruncated: history?.truncated === true,
  };
  if (!snapshot.record) {
    const unavailable = snapshot.data_status === "unavailable";
    return {
      available: true,
      accountMatched: true,
      title: "每日运行记录",
      statusLabel: unavailable ? "未取得" : "无记录",
      statusDetails: [unavailable
        ? "未取得该日记录；不能据此判断是否运行。"
        : "该日没有匹配记录；这不能证明账户未运行。"],
      runStartedAt: null,
      runFinishedAt: null,
      dryRun: false,
      fillsLabel,
      dataStatusLabel,
      updatedAt: null,
      ...historyFields,
    };
  }
  const record = snapshot.record;
  const status = typeof record.status === "string" ? record.status : "unknown";
  const runIssues = (record.runs || []).map(run => runtimeDailyRunIssue(run));
  const runIssue = runIssues.includes("failure") ? "failure" : runIssues.find(issue => issue !== null);
  const conflictingRun = ["no_submission", "no_signal", "no_rebalance", "filled", "not_due", "market_closed", "outside_window", "within_grace"].includes(status) ? runIssue : null;
  const statusLabel = conflictingRun ? conflictingRun === "failure" ? "异常" : "结果待确认" : RUNTIME_DAILY_STATUS_LABELS[status] || status;
  const statusDetails = conflictingRun ? [conflictingRun === "failure" ? "异常" : "结果待确认"] : [];
  if (record.schedule?.state === "unevaluable") statusDetails.push("运行计划资料未确认");
  if (record.completeness !== undefined && record.completeness !== "complete") statusDetails.push("周期记录不完整，结果待确认");
  if ((snapshot.read_error_count || 0) > 0) statusDetails.push("部分来源读取失败");
  if ((snapshot.unmatched_count || 0) > 0) statusDetails.push("存在未匹配的来源报告");
  if ((record.conflict_count || 0) > 0) statusDetails.push("存在冲突运行记录");
  const dryRun = record.execution_lane === "dry_run" || status === "dry_run" || (record.runs || []).some((run) => run.execution_lane === "dry_run");
  const run = (record.runs || []).find((item) => item.started_at || item.finished_at) || null;
  return {
    available: true,
    accountMatched: true,
    title: "每日运行记录",
    statusLabel,
    statusDetails: conflictingRun ? ["周期记录明细未确认或与汇总冲突", ...statusDetails.slice(1)] : statusDetails,
    runStartedAt: typeof run?.started_at === "string" ? run.started_at : null,
    runFinishedAt: typeof run?.finished_at === "string" ? run.finished_at : null,
    dryRun,
    fillsLabel,
    dataStatusLabel,
    updatedAt: snapshot.data_status === "stale" ? observedAt : null,
    ...historyFields,
  };
}

/** Monitoring proves freshness and activation; the matched daily record proves a cycle. */
export function overviewRuntimeHealth(
  runtime: LifecycleRecord | null | undefined,
  snapshot: RuntimeDailySnapshot | null | undefined,
  selection: RuntimeDailySelection,
  identityMismatch = false,
  now = Date.now(),
): { label: "健康" | "异常"; detail: string; observedAt: string | null; nextDueAt: string | null; lastSuccessAt: string | null } {
  const result = { label: "异常" as "健康" | "异常", detail: "运行证据未取得", observedAt: runtime?.observed_at || null, nextDueAt: null as string | null, lastSuccessAt: null as string | null };
  const fail = (detail: string) => ({ ...result, detail });
  const healthy = (detail: string) => ({ ...result, label: "健康" as const, detail });
  const dailyIssue = (detail: string) => ({ ...result, label: "健康" as const, detail });
  if (identityMismatch) return fail("账户身份不匹配");
  if (!runtime) return fail("运行证据未取得");
  const activation = runtime.account_state?.activation;
  const observed = validBinanceScopeInstant(runtime.observed_at) ? Date.parse(runtime.observed_at) : NaN;
  const ttl = runtime.evidence_valid_for_seconds;
  if (!Number.isFinite(observed) || typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0) return fail("运行证据时间未取得");
  if (observed > now) return fail("运行证据时间异常");
  if (runtime.freshness?.data_status !== "ready" || now - observed > ttl * 1000) return fail("运行证据已过期");
  const deployment = runtime.target.deployment;
  if (runtime.account_state?.health === "abnormal") {
    const monitoring = runtime.target?.monitoring;
    const retainedAttentionDetails = runtime.account_state.reason === "retained_attention"
      && runtime.target?.disposition?.code !== "parked"
      ? [
        monitoring?.runtime_guard === "attention" ? "近期运行检查失败" : null,
        monitoring?.execution_heartbeat === "attention" ? "近期执行报告检查失败" : null,
      ].filter((detail): detail is string => detail !== null)
      : [];
    if (retainedAttentionDetails.length) return fail(retainedAttentionDetails.join("；"));
    const state = presentAccountState(runtime.account_state, runtime.freshness?.data_status);
    return fail(state.detail === "暂未取得状态" ? "账户运行异常" : state.detail);
  }
  const deployedAt = validBinanceScopeInstant(deployment?.observed_at) ? Date.parse(deployment.observed_at) : NaN;
  if (!Number.isFinite(deployedAt) || deployedAt > now) return fail("启用证据时间未确认");
  if (runtime.deployment_freshness?.data_status !== "ready" || now - deployedAt > ttl * 1000) return fail("启用证据已过期");
  if (activation !== "enabled" && activation !== "disabled") return fail("启用状态未确认");
  const configuredState = runtime.target.target?.configured_state;
  const monitoring = runtime.target.monitoring;
  const disposition = runtime.target.disposition?.code;
  const disabledAgrees = activation === "disabled"
    && runtime.account_state?.health === "normal"
    && configuredState === "disabled"
    && deployment?.runtime_enabled === false
    && deployment.scheduler_state === "paused"
    && monitoring?.runtime_guard === "pass"
    && monitoring.execution_heartbeat === "not_applicable"
    && disposition === "continue_disabled_validation";
  if (activation === "disabled") {
    return disabledAgrees ? healthy("运行监测正常，已停用。") : fail("运行监测未确认");
  }
  if (deployment?.runtime_enabled !== true || deployment.scheduler_state !== "enabled" || configuredState !== "enabled") return fail("启用状态未确认");
  const enabledMonitoringAgrees = runtime.account_state?.health === "normal"
    && monitoring?.runtime_guard === "pass"
    && monitoring.execution_heartbeat === "pass"
    && disposition === "continue_enabled_monitoring";
  const platformCheckNotDue = runtime.account_state?.health === "unknown"
    && runtime.account_state.reason === "check_not_due"
    && monitoring?.runtime_guard === "pass"
    && monitoring.execution_heartbeat === "not_due"
    && disposition === "continue_enabled_monitoring";
  if (runtime.account_state?.health !== "normal" && !platformCheckNotDue) return fail("运行监测未确认");
  if (runtime.account_state?.health === "normal" && !enabledMonitoringAgrees) return fail("运行监测未确认");
  const dailyTarget = runtimeDailyTarget(selection.platform);
  if (dailyTarget && selection.dailyBinding !== "bound" && selection.dailyBinding !== "not_applicable") return dailyIssue("周期记录目标绑定未确认");
  // Each platform owns its lifecycle cadence. Do not require another target's daily feed
  // to assess another platform, and never infer a due time from this evidence's freshness TTL.
  if (!runtimeDailySelectionEligible(selection)) {
    return platformCheckNotDue ? healthy("尚未到检查时间") : healthy("运行监测正常，已启用。");
  }
  if (!snapshot || snapshot.ok !== true || snapshot.account_key !== selection.accountKey) return dailyIssue("周期记录未取得");
  const record = snapshot.record;
  if (!runtimeDailySnapshotMatchesSelection(snapshot, selection)) return dailyIssue("周期记录目标不匹配");
  if (snapshot.date !== runtimeBusinessDate(now) || record?.business_date !== snapshot.date || snapshot.timezone !== RUNTIME_DAILY_TIMEZONE) return dailyIssue("今日周期记录未取得");
  if (snapshot.data_status !== "fresh") return dailyIssue("周期记录已过期");
  if (!validBinanceScopeInstant(record.observed_at) || Date.parse(record.observed_at) > now) return dailyIssue("周期记录时间异常");
  if (record.completeness !== "complete" || !Array.isArray(record.runs) || (snapshot.read_error_count || 0) > 0 || (snapshot.unmatched_count || 0) > 0 || (record.conflict_count || 0) > 0) return dailyIssue("周期记录不完整");
  if ((record.runs || []).some(run => runtimeDailyRunIssue(run) !== null)) return dailyIssue("周期记录明细未确认或与汇总冲突");
  // A no-run schedule from the exact bound target may honestly have no observed
  // execution lane. This does not turn any observed dry-run/live lane into PAPER.
  const scheduleWithoutRun = record.kind === "schedule" && record.runs.length === 0
    && ["not_due", "market_closed", "outside_window", "within_grace"].includes(record.status);
  const expectedLane = dailyTarget?.platform === "schwab" ? "live" : "paper";
  if ((record.execution_lane !== expectedLane && !(scheduleWithoutRun && record.execution_lane === "insufficient"))
    || record.runs.some(run => run.execution_lane !== expectedLane)) return dailyIssue("真实账户周期未确认");
  const schedule = record.schedule;
  const nextDue = validBinanceScopeInstant(schedule?.next_due_at) ? Date.parse(schedule.next_due_at) : NaN;
  const graceEnds = validBinanceScopeInstant(schedule?.grace_ends_at) ? Date.parse(schedule.grace_ends_at) : NaN;
  result.nextDueAt = Number.isFinite(nextDue) ? schedule!.next_due_at! : null;
  if (record.kind === "schedule" && ["not_due", "market_closed", "outside_window"].includes(record.status)) {
    // The validated Schwab producer can explicitly have no further run today.
    // Keep this source- and date-bound; a weekend or null due time proves nothing.
    const latestDue = validBinanceScopeInstant(schedule?.latest_due_at) ? Date.parse(schedule.latest_due_at) : NaN;
    const closedToday = dailyTarget?.platform === "schwab" && schedule?.state === record.status
      && schedule.business_date === snapshot.date && schedule.timezone === RUNTIME_DAILY_TIMEZONE
      && runtimeBusinessDate(Date.parse(record.observed_at)) === snapshot.date
      && schedule.next_due_at === null && schedule.grace_ends_at === null && schedule.publication_grace_ended === null
      && ((record.status === "not_due" && schedule.reason === "no_cron_on_business_date" && schedule.latest_due_at === null
          && ["unspecified", "inside"].includes(schedule.expected_window || ""))
        || (record.status === "market_closed" && schedule.reason === "market_closed" && Number.isFinite(latestDue)
          && latestDue <= Date.parse(record.observed_at) && runtimeBusinessDate(latestDue) === snapshot.date));
    if (closedToday) return healthy(RUNTIME_DAILY_STATUS_LABELS[record.status]);
    return Number.isFinite(nextDue) && nextDue > now && schedule?.state === record.status
      ? healthy("已启用，尚未到运行时间") : dailyIssue("运行时间未确认或已到期");
  }
  if (record.kind === "schedule" && record.status === "within_grace") {
    return Number.isFinite(graceEnds) && graceEnds > now && schedule?.state === "within_grace" && schedule.publication_grace_ended === false
      ? healthy("已启用，仍在允许延迟内") : dailyIssue("周期报告已到期");
  }
  if (["failed", "blocked"].includes(record.status)) return dailyIssue("周期失败或已阻断");
  if (["unknown", "reconciliation_required", "conflict", "submitted", "broker_acknowledged", "partially_filled"].includes(record.status)) return dailyIssue("运行结果待确认");
  if (!['no_submission', 'no_signal', 'no_rebalance', 'filled'].includes(record.status) || record.kind !== "run") return dailyIssue("周期报告未取得");
  const finished = (record.runs || []).filter(run => validBinanceScopeInstant(run.finished_at) && Date.parse(run.finished_at!) <= now
    && validBinanceScopeInstant(run.started_at) && Date.parse(run.started_at!) <= Date.parse(run.finished_at!));
  if (!finished.length) return dailyIssue("完整周期时间未取得");
  const latest = finished.map(run => run.finished_at!).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)!;
  result.lastSuccessAt = latest;
  const latestDue = validBinanceScopeInstant(schedule?.latest_due_at) ? Date.parse(schedule.latest_due_at) : NaN;
  if (!["due", "within_grace", "not_due", "market_closed", "outside_window"].includes(schedule?.state || "")
    || (!Number.isFinite(nextDue) && !Number.isFinite(latestDue))
    || (Number.isFinite(latestDue) && latestDue > now)) return dailyIssue("运行时间未确认或已到期");
  if (Number.isFinite(nextDue) && nextDue <= now && Date.parse(latest) < nextDue) {
    return Number.isFinite(graceEnds) && graceEnds > now && graceEnds >= nextDue && schedule?.publication_grace_ended === false
      ? healthy("已启用，仍在允许延迟内") : dailyIssue("周期报告已到期");
  }
  if (Number.isFinite(latestDue) && Date.parse(latest) < latestDue) {
    return Number.isFinite(graceEnds) && graceEnds > now && graceEnds >= latestDue && schedule?.publication_grace_ended === false
      ? healthy("已启用，仍在允许延迟内") : dailyIssue("周期报告已到期");
  }
  return healthy("最近完整周期正常");
}

export function knownAccountLabel(options: Record<string, Array<{ key?: unknown; target_name?: unknown; label?: unknown }> | undefined> | null | undefined, platform: unknown, targetName: unknown): string {
  if (!options || typeof platform !== "string" || !platform || typeof targetName !== "string" || !targetName) return "";
  const accounts = options[platform];
  if (!Array.isArray(accounts)) return "";
  const matches = accounts.filter((account) => account && (account.target_name === targetName || account.key === targetName));
  if (matches.length !== 1) return "";
  return typeof matches[0].label === "string" ? matches[0].label.trim() : "";
}

const ROUTE_ALIASES = new Set(["paper", "sg", "hk", "live", "firstrade", "crypto_combo"]);
const LEGACY_IBKR_STRATEGY_ALIASES = new Set(["soxl", "tqqq", "global etf", "russell top 50"]);

export type AccountIdentity = {
  kind: "nickname" | "masked" | "alias" | "generic";
  text: string;
  tail: string;
  alias: string;
  platform: string;
  environment: string;
};

function identityText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function identityFold(value: string): string {
  return value.trim().toLowerCase();
}

function singleBrokerNumber(selector: unknown): string {
  const text = identityText(selector);
  if (!text) return "";
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length !== 1 || !/^U\d{5,}$/i.test(tokens[0])) return "";
  return tokens[0];
}

function fullAccountNumber(value: string): boolean {
  return /^U\d{5,}$/i.test(value);
}

function routeAlias(label: string, key: string): string {
  if (label && ROUTE_ALIASES.has(identityFold(label))) return label;
  if (key && ROUTE_ALIASES.has(identityFold(key))) return key;
  return "";
}

export function strategyOccupiedNames(profiles: Array<Record<string, unknown> | null | undefined>, currentProfile?: unknown, currentName?: unknown): string[] {
  const names: string[] = [];
  if (typeof currentProfile === "string" && currentProfile.trim()) names.push(currentProfile.trim());
  if (typeof currentName === "string" && currentName.trim()) names.push(currentName.trim());
  for (const profile of profiles) {
    if (!profile) continue;
    if (NORMALIZED_DISPLAY_IDS.has(catalogText(profile, "profile"))) names.push(strategyDisplayName(profile, "zh"), strategyDisplayName(profile, "en"));
    for (const field of ["profile", "label", "label_zh", "label_en"]) {
      const value = profile[field];
      if (typeof value === "string" && value.trim()) names.push(value.trim());
    }
  }
  return names;
}

export function accountIdentity(account: { label?: unknown; key?: unknown; account_selector?: unknown }, platformLabel: string, environmentLabel: string, occupiedNames: string[] = []): AccountIdentity {
  const label = identityText(account.label);
  const key = identityText(account.key);
  const platform = identityText(platformLabel);
  const environment = identityText(environmentLabel);
  const occupied = new Set(occupiedNames.map(identityFold).filter(Boolean));
  const ibkr = identityFold(platform) === "ibkr";
  const accountNumber = ibkr ? singleBrokerNumber(account.account_selector) : "";
  const labelIsNumber = fullAccountNumber(label);
  const base = { text: "", tail: "", alias: "", platform, environment };
  const legacyStrategyLabel = Boolean(accountNumber) && LEGACY_IBKR_STRATEGY_ALIASES.has(identityFold(label));
  const occupiedLabel = Boolean(label) && (occupied.has(identityFold(label)) || identityFold(label) === identityFold(platform) || legacyStrategyLabel);
  if (label && !occupiedLabel && !labelIsNumber && !ROUTE_ALIASES.has(identityFold(label))) return { ...base, kind: "nickname", text: label };
  if (accountNumber && (occupiedLabel || labelIsNumber || !label)) return { ...base, kind: "masked", tail: accountNumber };
  const alias = routeAlias(labelIsNumber ? "" : label, key);
  if (alias) return { ...base, kind: "alias", alias: identityFold(platform) === "binance" && identityFold(alias) === "crypto_combo" ? "live" : alias };
  return { ...base, kind: "generic" };
}

export function formatAccountIdentity(identity: AccountIdentity, translate: (key: string, values?: Record<string, string>) => string): string {
  if (identity.kind === "masked") return identity.tail;
  if (identity.kind === "alias") return translate("账户 · {alias}", { alias: identity.alias });
  if (identity.kind === "generic") return translate("账户");
  return identity.text;
}

export function accountDisplayTitle(account: { label?: unknown; key?: unknown; account_selector?: unknown }, platformLabel: string, environmentLabel: string, occupiedNames: string[] = []): string {
  return formatAccountIdentity(accountIdentity(account, platformLabel, environmentLabel, occupiedNames), (key, values = {}) => key.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name: string) => values[name] || ""));
}

export function unnamedDecisionOrdinal(items: Array<{ id: string; title: string }>, item: { id: string; title: string }): number {
  if (item.title !== "未命名策略") return 0;
  const same = items.filter(entry => entry.title === "未命名策略");
  if (same.length < 2) return 0;
  const index = same.findIndex(entry => entry.id === item.id);
  return index < 0 ? 0 : index + 1;
}

function catalogText(profile: object | null | undefined, key: string): string {
  const value = profile && key in profile ? (profile as Record<string, unknown>)[key] : "";
  return typeof value === "string" ? value.trim() : "";
}

// Label-only releases deliberately do not sync the private catalog. Normalize only
// these four reviewed display identities from the existing generated label authority.
// No gate, parameter, source/config identity or observed state is read from this map.
const NORMALIZED_DISPLAY_IDS = new Set([
  "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve", "us_equity_combo",
  "us_equity_combo_core", "crypto_live_pool_rotation",
]);
const NORMALIZED_DISPLAY_LABELS = new Map(DEFAULT_STRATEGY_PROFILES
  .filter(profile => NORMALIZED_DISPLAY_IDS.has(profile.profile))
  .map(profile => [profile.profile, { label_zh: profile.label_zh, label_en: profile.label_en }]));

export function strategyDisplayName(profile: object | null | undefined, language: "zh" | "en"): string {
  const labels = NORMALIZED_DISPLAY_LABELS.get(catalogText(profile, "profile")) || profile;
  return catalogText(labels, language === "zh" ? "label_zh" : "label_en") || "未命名策略";
}

export function strategyNote(profile: object | null | undefined, language: "zh" | "en"): string {
  return catalogText(profile, language === "zh" ? "description_zh" : "description_en");
}

// Exact frozen research identities, not runtime observations. Sources are indexed in
// docs/console_information_design.zh-CN.md; never derive these axes from ID suffixes.
const FROZEN_RESEARCH_NAMES: Record<string, { zh: string; en: string; version: string; configHash: string; sourceRevision: string; runtimeRevision: string | null; noteZh: string; noteEn: string }> = {
  soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve: {
    zh: "SOXL/SOXX 核心复利（现金保留）", en: "SOXL/SOXX Core Compounding (Cash Reserve)", version: "V7",
    configHash: "843ab4e93e81985c2b3becc61a2f0b971508ccf25afa59acf402e75f574514d1",
    sourceRevision: "07b164d95f2ab4d4c54fd993f6f2040bd207d664", runtimeRevision: "f30e7b1910df8da22fdcedc347ab847df5adcd76",
    noteZh: "冻结候选实际保留 3% 现金，修正现金保留的源码行为，沿用 V6 预注册参数；V7 不表示 AI 优化次数。",
    noteEn: "Frozen source-correctness candidate with an actual 3% cash reserve and unchanged V6 pre-registered parameters. V7 is not an AI optimization count.",
  },
  tqqq_core_only_p2_v5: {
    zh: "TQQQ 核心趋势", en: "TQQQ Core Trend", version: "V5",
    configHash: "e6422cf7c3819734ec300a7bfa3d936d5273993c0ce865dfe0218d7b7f8426e2",
    sourceRevision: "5f0c30cdcaf3ee0f3f1c050acbe172580ea40c81", runtimeRevision: "730ad9f3983bd90cd75adecb67fcf483ffb96736",
    noteZh: "冻结核心研究候选；版本标识不表示采用、运行通道或 AI 来源。",
    noteEn: "Frozen core research candidate. Its version does not establish adoption, execution lane or AI provenance.",
  },
  tqqq_core_only_p2_v9_benchmark_drawdown_guard: {
    zh: "TQQQ 基准回撤防护", en: "TQQQ Benchmark Drawdown Guard", version: "V9",
    configHash: "c2c3d7ce1333f8f1675f40cd4c45ffa89d83f0dcf99b2a475840d0f87ab64dce",
    sourceRevision: "fe5c0377faa11b0010243e3ef32f8b7256d63992", runtimeRevision: null,
    noteZh: "独立冻结的 QQQ 基准回撤防护研究候选；不能继承 V5 证据或交易权限。",
    noteEn: "Separate frozen QQQ benchmark drawdown-guard research candidate. V5 evidence and trading authority do not transfer.",
  },
};
function frozenResearchIdentity(candidateId: unknown) {
  return typeof candidateId === "string" && Object.prototype.hasOwnProperty.call(FROZEN_RESEARCH_NAMES, candidateId) ? FROZEN_RESEARCH_NAMES[candidateId] : null;
}
const SOXL_R6_STUDY = "soxl_v7_twelve_basic_split_close_development_v1";

export function candidateDisplayName(candidateId: unknown, language: "zh" | "en"): string {
  const known = frozenResearchIdentity(candidateId);
  return known?.[language] || (language === "zh" ? "未命名策略" : "Unnamed strategy");
}

export function strategySelectionName(profile: object | null | undefined, profiles: object[], language: "zh" | "en"): string {
  const name = strategyDisplayName(profile, language);
  const label = name === "未命名策略" && language === "en" ? "Unnamed strategy" : name;
  const id = catalogText(profile, "profile");
  const sameIds = new Set(profiles.filter(item => strategyDisplayName(item, language) === name).map(item => catalogText(item, "profile")).filter(Boolean));
  return id && sameIds.size > 1 ? `${label} · ${id}` : label;
}

export type StrategyIdentityRecord = {
  candidateId?: unknown; configHash?: unknown; sourceRevision?: unknown; studyId?: unknown;
  role?: unknown; lane?: unknown; evidenceAt?: unknown;
};
export type StrategyIdentityView = {
  basis: "策略目录" | "研究票据" | "候选材料" | "应用记录";
  profileId: string | null; candidateId: string | null; candidateVersion: string | null;
  configHash: string | null; sourceRevision: string | null; studyId: string | null; studyLabel: string | null;
  role: string | null; lane: string | null; evidenceAt: string | null;
  frozenResearch: { sourceRevision: string; runtimeRevision: string | null; configHash: string; noteZh: string; noteEn: string } | null;
};

function strategyIdentityText(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length <= 256 ? value : null;
}

export function strategyIdentityView(input: { profile?: object | null; profileId?: unknown; basis: StrategyIdentityView["basis"]; record?: StrategyIdentityRecord }): StrategyIdentityView {
  const profile = input.profile as Record<string, any> | null | undefined;
  const profileId = strategyIdentityText(input.profileId) || strategyIdentityText(profile?.profile);
  const boundProfile = profile?.profile === profileId ? profile : null;
  // An explicit record must stand on its own: never repair historical gaps from today's catalog.
  const record: StrategyIdentityRecord = input.record ?? { candidateId: boundProfile?.research_candidate_identity?.candidate_id, configHash: boundProfile?.research_candidate_identity?.config_sha256 };
  const candidateId = strategyIdentityText(record.candidateId);
  const hashText = strategyIdentityText(record.configHash);
  const configHash = hashText && /^(?:sha256:)?[a-fA-F0-9]{64}$/.test(hashText) ? hashText : null;
  const frozen = frozenResearchIdentity(candidateId);
  const boundFrozen = frozen && configHash?.replace(/^sha256:/, "").toLowerCase() === frozen.configHash ? frozen : null;
  const studyId = strategyIdentityText(record.studyId);
  const evidenceAt = strategyIdentityText(record.evidenceAt);
  return {
    basis: input.basis,
    profileId,
    candidateId,
    candidateVersion: frozen?.version || null,
    configHash,
    sourceRevision: strategyIdentityText(record.sourceRevision),
    studyId,
    studyLabel: studyId === SOXL_R6_STUDY ? "R6" : null,
    role: typeof record.role === "string" && ["candidate", "challenger", "champion"].includes(record.role) ? record.role : null,
    lane: typeof record.lane === "string" && ["research", "shadow", "paper", "live", "dry_run"].includes(record.lane) ? record.lane : null,
    evidenceAt: evidenceAt && /^\d{4}-\d{2}-\d{2}T/.test(evidenceAt) && Number.isFinite(Date.parse(evidenceAt)) ? evidenceAt : null,
    frozenResearch: boundFrozen ? { sourceRevision: boundFrozen.sourceRevision, runtimeRevision: boundFrozen.runtimeRevision, configHash: boundFrozen.configHash, noteZh: boundFrozen.noteZh, noteEn: boundFrozen.noteEn } : null,
  };
}

export function decisionActionState(item: { canAdopt: boolean; canReject: boolean; accountChoices: Array<{ id: string }> }, input: { admin: boolean; busy: boolean; selectedAccountId: string }): { adoptEnabled: boolean; rejectEnabled: boolean } {
  const accountReady = item.accountChoices.length <= 1 || item.accountChoices.some(account => account.id === input.selectedAccountId);
  const allowed = input.admin === true && input.busy !== true;
  return {
    adoptEnabled: allowed && item.canAdopt === true && accountReady,
    rejectEnabled: allowed && item.canReject === true,
  };
}

export function routeAfterDirtyPrompt(dirty: boolean, discardConfirmed: boolean): "stay" | "leave" {
  if (dirty !== true) return "leave";
  return discardConfirmed === true ? "leave" : "stay";
}

export function safeActionVisibility(input: { settingsUnavailable: boolean; activation: string; refreshSupported: boolean; resumeSupported: boolean }): { stop: boolean; refresh: boolean; resume: boolean } {
  const stop = (input.settingsUnavailable === true || input.settingsUnavailable === false) && typeof input.activation === "string";
  return {
    stop,
    refresh: input.refreshSupported === true,
    resume: input.resumeSupported === true,
  };
}

export function accountSettingsOperationReason(reason: unknown): string {
  if (reason === "admin_required") return "当前登录不能保存这项设置。";
  if (reason === "option_overlay_not_defined") return "该策略尚未定义期权层。";
  if (reason === "strategy_application_not_connected") return "策略应用与账户启用流程尚未接通。";
  return "这项操作暂不可用。";
}

export function accountSettingsSaveBlockReason(settings: Record<string, any> | null | undefined, readState: string, kind: "draft" | "risk"): string | null {
  if (readState === "refreshing") return "正在重新读取设置，完成后可保存。";
  if (readState !== "ready") return "请重新读取成功后再保存。";
  if (!settings?.identity || typeof settings.identity !== "object" || Array.isArray(settings.identity)) return "缺少账户来源，不能保存。";
  if (kind === "draft" && settings?.draft?.status === "identity_conflict") return "请重新读取并确认当前账户来源。";
  const operation = kind === "draft" ? "save_draft" : "save_risk_preference";
  if (settings?.operations?.[operation] !== true) return accountSettingsOperationReason(settings?.operations?.[`${operation}_reason`]);
  if (!Number.isSafeInteger(settings?.[kind]?.revision)) return "设置版本未确认，请重新读取后再保存。";
  return null;
}

export function paperApplicationAccounts(application: { application_preparation?: { account_options?: Array<Record<string, unknown>> } } | null | undefined): Array<{ id: string; label: string }> {
  return (application?.application_preparation?.account_options || [])
    .filter(account => account?.platform === "longbridge" && account?.broker_environment === "paper" && typeof account.key === "string" && account.key.trim())
    .map(account => ({
      id: `${account.platform}:${account.key}`,
      label: typeof account.label === "string" && account.label.trim() ? account.label : String(account.key),
    }));
}

type PaperApplicationItem = {
  application?: Record<string, any> | null;
  application_preparation?: {
    preflight_status?: unknown;
    preview_request?: unknown;
    blocker_codes?: unknown;
    account_options?: Array<Record<string, unknown>>;
  };
} | null | undefined;

function paperApplicationBlocked(application: PaperApplicationItem): boolean {
  const blockers = application?.application_preparation?.blocker_codes;
  return Array.isArray(blockers) && blockers.length > 0;
}

export function paperApplicationReady(application: PaperApplicationItem, selectedAccountId: string): boolean {
  if (!application || !applicationRetryAllowed(application.application)) return false;
  const prep = application.application_preparation || {};
  if (paperApplicationBlocked(application) || prep.preflight_status !== "ready" || !prep.preview_request) return false;
  return paperApplicationAccounts(application).some(account => account.id === selectedAccountId);
}

export function mergeAdminFields(previous: Record<string, string>, next: Record<string, string>, dirty: Record<string, boolean>, readonlyKeys: string[] = []): { text: Record<string, string>; kept: boolean } {
  if (!Object.keys(previous).length) return { text: { ...next }, kept: false };
  const text = { ...next };
  let kept = false;
  for (const key of Object.keys(next)) {
    if (readonlyKeys.includes(key)) continue;
    if (!dirty[key]) continue;
    if ((previous[key] || "") !== (next[key] || "")) kept = true;
    text[key] = previous[key] || "";
  }
  return { text, kept };
}

export function environmentEditState(baseline: string, local: string, server: string): { value: string; conflict: boolean } {
  if (local === baseline || local === server) return { value: server, conflict: false };
  return { value: local, conflict: server !== baseline };
}

/** Configuration labels never establish a native Cash/Margin/SPOT identity. */
export function brokerAccountType(value: unknown): "配置 paper 环境" | "配置 live 环境" | "配置环境待确认" {
  if (value === "paper") return "配置 paper 环境";
  if (value === "live") return "配置 live 环境";
  return "配置环境待确认";
}

export function accountNativeReadout(
  platform: string,
  accountKey: string,
  facts: AccountFactsAccount | null | undefined,
  binanceReport: Record<string, any> | null | undefined,
  now = Date.now(),
): { nativeType: string | null; identityLabel: string } {
  const unknown = { nativeType: null, identityLabel: "身份待确认" };
  if (platform === "binance") {
    if (binanceReport?.platform !== platform || binanceReport.account_key !== accountKey
        || !validBinanceScopeInstant(binanceReport.observed_finished_at)) return unknown;
    const age = now - Date.parse(binanceReport.observed_finished_at);
    if (age > BINANCE_WALLET_VALUATION_MAX_AGE_MS) return { nativeType: null, identityLabel: "身份资料已过期" };
    if (age < -BINANCE_SCOPE_FUTURE_SKEW_MS) return unknown;
    const product = binanceProviderProductTypeForDisplay(binanceReport, true);
    const observed = product && validBinanceScopeInstant(product.observed_at) ? Date.parse(product.observed_at) : null;
    const nativeType = observed !== null && observed <= Date.parse(binanceReport.observed_finished_at)
      && now - observed <= BINANCE_WALLET_VALUATION_MAX_AGE_MS
      && now - observed >= -BINANCE_SCOPE_FUTURE_SKEW_MS ? product!.value : null;
    return { nativeType, identityLabel: "身份部分核验" };
  }
  if (!facts || facts.platform !== platform || facts.account_key !== accountKey) return unknown;
  facts = accountFactsForDisplay(facts, now);
  if (!facts) return unknown;
  if (facts.identity_mismatch === true) return { nativeType: null, identityLabel: "账户身份不匹配" };
  if (facts.binding_status !== "bound" || facts.identity_status !== "partial_identity") return unknown;
  if (facts.data_status === "stale") return { nativeType: null, identityLabel: "身份资料已过期" };
  if (facts.data_status !== "fresh") return unknown;
  return {
    nativeType: verifiedSchwabAccountTypeToken(platform, facts.data_status, facts.broker_account_type),
    identityLabel: "身份部分核验",
  };
}

export function adminDirectoryTitle(account: { label?: unknown; key?: unknown; account_selector?: unknown }, platformLabel: string, occupiedNames: string[] = []): string {
  const identity = accountIdentity(account, platformLabel, "", occupiedNames);
  const platform = identity.platform;
  const name = identity.kind === "masked" ? identity.tail : identity.kind === "nickname" ? identity.text : identity.kind === "alias" ? identity.alias : "";
  if (!name || name === "账户" || name === "Account") return platform;
  return platform ? `${platform} · ${name}` : name;
}

export type UserChange = { at: number; actor: string; action: string; actions?: string[]; target: string; platform?: string; accountKey?: string };

const ACCOUNT_SETTING_CHANGE_LABELS: Record<string, string> = {
  cash_draft: "现金草案已保存",
  income_draft: "收入层草案已保存",
  risk_saved: "风险偏好已保存",
  risk_cleared: "风险偏好已清除",
};

const USER_CHANGE_ACTIONS: Record<string, string> = {
  create: "新增了账户资料",
  edit: "更新了账户资料",
  request_retirement: "提交了退役申请",
  set_broker_environment: "更新了配置环境标记",
  initialize: "导入了账户配置",
  save_config: "更新了访问设置",
  save_risk_profile_bindings: "保存了风险偏好",
};

function changeTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordTarget(record: Record<string, unknown>): string {
  const nested = [record.after, record.before].find(item => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown> | undefined;
  const source = nested || record;
  const platform = typeof source.platform === "string" ? source.platform : "";
  const key = typeof source.key === "string" ? source.key : "";
  if (platform && key) return `${platform} · ${key}`;
  if (typeof record.target === "string" && record.target.trim()) return record.target.trim();
  return "账户资料";
}

function savedApplicationChange(item: unknown): UserChange | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const ticket = item as Record<string, unknown>;
  const saved = ticket.application;
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
  const application = saved as Record<string, unknown>;
  const at = changeTimestamp(application.updated_at ?? application.created_at ?? application.ts);
  if (at === null) return null;
  const actor = typeof application.login === "string" && application.login.trim() ? application.login : typeof application.actor === "string" && application.actor.trim() ? application.actor : "未知操作者";
  const ticketId = typeof ticket.ticket_id === "string" && ticket.ticket_id.trim() ? ticket.ticket_id : "申请";
  return { at, actor, action: "变更记录", target: ticketId };
}

export function recentUserChanges(sources: { history?: unknown; audit?: unknown; applications?: unknown }, limit = 5): UserChange[] {
  const rows: UserChange[] = [];
  const take = (list: unknown, kind: "history" | "audit") => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const action = typeof record.action === "string" ? record.action : "";
      if (!action || action.startsWith("sync_")) continue;
      const at = changeTimestamp(record.ts ?? record.updated_at);
      if (at === null) continue;
      const actor = typeof record.login === "string" && record.login.trim() ? record.login : "未知操作者";
      const settingActions = action === "save_account_settings" && Array.isArray(record.changes)
        ? record.changes.map(item => ACCOUNT_SETTING_CHANGE_LABELS[String(item)]).filter((item): item is string => Boolean(item))
        : [];
      rows.push({
        at,
        actor,
        action: settingActions[0] || USER_CHANGE_ACTIONS[action] || "设置已更新",
        actions: settingActions.length ? settingActions : undefined,
        target: settingActions.length ? "账户" : kind === "audit" && action === "save_config" ? "访问设置" : recordTarget(record),
        platform: settingActions.length && typeof record.platform === "string" ? record.platform : undefined,
        accountKey: settingActions.length && typeof record.key === "string" ? record.key : undefined,
      });
    }
  };
  take(sources.history, "history");
  take(sources.audit, "audit");
  if (Array.isArray(sources.applications)) {
    for (const item of sources.applications) {
      const change = savedApplicationChange(item);
      if (change) rows.push(change);
    }
  }
  return rows.sort((left, right) => right.at - left.at).slice(0, limit);
}

export function changeAccountName(account: { label?: unknown; key?: unknown; account_selector?: unknown } | null, platformLabel: string, occupiedNames: string[] = []): string {
  if (!account) return "";
  const identity = accountIdentity(account, platformLabel, "", occupiedNames);
  if (identity.kind === "masked") return identity.tail;
  if (identity.kind === "alias") return identity.alias;
  if (identity.kind === "nickname") return identity.text;
  return "";
}

export function formatLocalChangeTime(epochMs: number, language: "zh" | "en", timeZone?: string): string {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const formatted = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone, timeZoneName: "short",
  }).format(new Date(epochMs));
  return formatted.includes(zone) ? formatted : `${formatted} (${zone})`;
}

export function formatOverviewInstant(value: string | null | undefined, language: "zh" | "en", timeZone = RUNTIME_DAILY_TIMEZONE): string | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return formatLocalChangeTime(ms, language, timeZone);
}

export function formatOverviewShortInstant(value: string | null | undefined, language: "zh" | "en", timeZone = RUNTIME_DAILY_TIMEZONE): string | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    timeZone, timeZoneName: "short",
  }).format(new Date(ms));
}

/** Fallback for accounts without fresh, validated native broker-type data. */
export function overviewAccountTypeLabel(): "账户类型待确认" {
  return "账户类型待确认";
}

export function verifiedSchwabAccountTypeToken(
  platform: string,
  dataStatus: string | null | undefined,
  accountType: unknown,
): string | null {
  if (platform !== "schwab" || dataStatus !== "fresh" || !accountType || typeof accountType !== "object") {
    return null;
  }
  const type = accountType as { value?: unknown; source_tag?: unknown };
  if (Object.keys(type).length !== 2
      || !Object.prototype.hasOwnProperty.call(type, "value")
      || !Object.prototype.hasOwnProperty.call(type, "source_tag")) return null;
  const value = type.value;
  const sourceTag = type.source_tag;
  if (sourceTag !== "securitiesAccount.type" || typeof value !== "string"
      || value.length < 1 || value.length > 32) return null;
  for (const character of value) {
    if (!((character >= "A" && character <= "Z")
        || (character >= "a" && character <= "z")
        || character === "_")) return null;
  }
  return value;
}

const OVERVIEW_SUPPRESSED_STATUS_DETAILS = new Set([
  "账户尚未绑定运行目标",
  "运行目标映射重复，无法唯一匹配",
  "运行状态接口读取失败",
  "运行状态来源已过期",
  "运行状态来源暂不可用",
  "未取得对应运行目标记录",
  "来源包含重复运行目标",
  "运行状态来源已过期或不可用",
  "尚未取得该目标的部署读回",
  "部署状态读回已过期",
  "运行启用状态尚未确认",
  "尚未到检查时间",
  "现有证据不足以确认运行状态",
  "暂未取得状态",
  "运行监测正常，已启用。",
  "运行监测正常，已停用。",
]);

const OVERVIEW_BUSINESS_STATUS_DETAILS = new Set([
  "账户运行异常",
  "设置尚未生效",
]);

/** Keep brief business exceptions only; mapping/API/source internals stay off the Overview card. */
export function overviewCardStatusDetail(detail: string | null | undefined): string | null {
  if (typeof detail !== "string" || !detail) return null;
  if (OVERVIEW_BUSINESS_STATUS_DETAILS.has(detail)) return detail;
  if (OVERVIEW_SUPPRESSED_STATUS_DETAILS.has(detail)) return null;
  return null;
}

export function paperApplicationActionable(application: PaperApplicationItem): boolean {
  return paperApplicationAccounts(application).some(account => paperApplicationReady(application, account.id));
}

export function paperApplicationUnresolved(application: PaperApplicationItem): boolean {
  const record = application?.application;
  if (!record || typeof record !== "object" || paperApplicationActionable(application)) return false;
  const status = typeof record.status === "string" ? record.status : "";
  return status !== "applied_paused" && status !== "rejected";
}

export function activationLabel(activation: unknown): "已启用" | "已停用" | "—" {
  if (activation === "enabled" || activation === true) return "已启用";
  if (activation === "disabled" || activation === false) return "已停用";
  return "—";
}

export type DailyDecision = {
  id: string;
  kind: "promotion" | "owner_observation" | "owner_retire" | "recovery";
  title: string;
  kicker: string;
  question: string;
  accountLine: string;
  currentName: string;
  proposedName: string;
  explanationKind: "ai" | "system" | "none";
  explanation: { question: string; basis: string; limits: string; suggestion: string; provider: string; model: string } | null;
  reasons: string[];
  impact: string;
  technical: string;
  reference: string;
  materialNotes: string[];
  identity?: StrategyIdentityView;
  canAdopt: boolean;
  canReject: boolean;
  adoptDecision: string | null;
  rejectDecision: string | null;
  accountChoices: Array<{ id: string; label: string }>;
};

type SourceState = { data_status?: unknown; value?: any; error?: unknown };

function ready(source: SourceState | null | undefined): boolean {
  return Boolean(source && !source.error && source.value && source.value.data_status === "ready");
}

// This one partial contract isolates invalid review material. It never makes
// the source ready: listDailyDecisions still shows its existing partial warning.
function readablePromotionQueue(source: SourceState | null | undefined): boolean {
  if (ready(source)) return true;
  const value = source?.value;
  const code = "research_promotion_review_material_invalid";
  const onlyCode = (codes: unknown) => Array.isArray(codes) && codes.length === 1 && codes[0] === code;
  if (source?.error || value?.schema_version !== "qsl.research_promotion_ticket_queue.v1"
    || value.data_status !== "partial" || !onlyCode(value.errors)) return false;
  const count = value.summary?.invalid_review_count;
  const invalid = value.invalid_tickets;
  const tickets = value.tickets;
  if (!Number.isSafeInteger(count) || count < 1 || count > 100
    || !Array.isArray(invalid) || invalid.length !== count
    || !Array.isArray(tickets) || tickets.length + count > 100
    || value.summary.ticket_count !== tickets.length) return false;
  const ids = new Set<string>();
  for (const ticket of invalid) {
    if (typeof ticket?.ticket_id !== "string" || !ticket.ticket_id || ids.has(ticket.ticket_id)
      || ticket.decision_binding !== null || ticket.decision_material?.eligible !== false
      || ticket.decision_material?.blocked !== true || !onlyCode(ticket.decision_material?.blocker_codes)
      || ticket.live_authority_granted !== false || ticket.no_order !== true) return false;
    ids.add(ticket.ticket_id);
  }
  for (const ticket of tickets) {
    const binding = ticket?.decision_binding;
    const review = binding?.review_binding;
    if (typeof ticket?.ticket_id !== "string" || !ticket.ticket_id || ids.has(ticket.ticket_id)
      || ticket.state !== "awaiting_human" || ticket.live_authority_granted !== false
      || binding?.kind !== "promotion" || binding.subject_id !== ticket.ticket_id
      || typeof binding.material_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(binding.material_sha256)
      || (review !== null && (review?.schema_version !== "qsl_promotion_review_binding.v2"
        || typeof review.review_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(review.review_sha256)))) return false;
    ids.add(ticket.ticket_id);
  }
  return true;
}

function profileName(profiles: any[], id: unknown, language: "zh" | "en"): string {
  const found = profiles.find(item => item?.profile === id);
  return found ? strategySelectionName(found, profiles, language) : candidateDisplayName(id, language);
}

export function promotionMaterialNotes(summary: Record<string, any> | null | undefined): string[] {
  const comparison = summary?.comparison;
  const comparisonNote = comparison == null
    ? "未提供比较材料，无法核对方案差异。"
    : comparison?.status === "comparable"
      ? "比较材料已提供，详情见方案。"
      : comparison?.status === "unavailable"
        ? "比较结果暂不可用，无法核对方案差异。"
        : "比较材料状态未确认。";
  const limitations = summary?.limitations;
  const limitationsNote = !Array.isArray(limitations) || limitations.some(item => typeof item !== "string")
    ? "未提供限制材料，请先核对原始方案。"
    : limitations.some(item => item.trim())
      ? "限制材料已提供，详情见方案。"
      : "材料未列出限制条件，请先核对原始方案。";
  return [comparisonNote, limitationsNote];
}

export function listDailyDecisions(input: {
  language: "zh" | "en";
  profiles: any[];
  promotions: SourceState | null | undefined;
  owners: SourceState | null | undefined;
  recovery: SourceState | null | undefined;
  accountsFor: (ticket: any) => Array<{ platform: string; key: string; label: string }>;
  decisionStates?: HumanDecisionState[];
}): { blocked: boolean; items: DailyDecision[] } {
  const blocked = !ready(input.promotions) || !ready(input.owners) || !ready(input.recovery);
  const items: DailyDecision[] = [];
  if (readablePromotionQueue(input.promotions)) {
    for (const ticket of input.promotions?.value?.tickets || []) {
      if (!ticket?.ticket_id || ticket.state !== "awaiting_human" || ticket.source_check_required) continue;
      const summary = ticket.research_summary || {};
      const suggestion = promotionSuggestion(ticket, input.language);
      const accounts = input.accountsFor(ticket).filter(account => account.label.trim());
      const name = profileName(input.profiles, ticket.strategy_profile || summary.strategy_profile, input.language);
      items.push({
        id: `promotion:${ticket.ticket_id}`,
        kind: "promotion",
        title: name,
        kicker: "新策略方案",
        question: "是否采用这项方案？",
        accountLine: accounts.length === 1 ? accounts[0].label : accounts.length ? "多个账户可选" : "",
        currentName: "当前策略",
        proposedName: name,
        explanationKind: suggestion ? "ai" : "system",
        explanation: suggestion,
        reasons: [],
        impact: "采用只记录你的意向，账户策略和交易权限保持不变。",
        technical: JSON.stringify({ ticket_id: ticket.ticket_id, proposed_params: ticket.proposed_params ?? null, comparison: summary.comparison ?? null, limitations: summary.limitations ?? null }, null, 2),
        reference: ticket.ticket_id,
        materialNotes: promotionMaterialNotes(ticket.research_summary),
        identity: strategyIdentityView({ profileId: ticket.strategy_profile, basis: "研究票据", record: {
          candidateId: ticket.proposed_params?.candidate_id, configHash: ticket.proposed_params?.config_sha256,
        } }),
        canAdopt: accounts.length > 0 && promotionDecisionReady(ticket),
        canReject: promotionDecisionReady(ticket),
        adoptDecision: "accept",
        rejectDecision: "reject",
        accountChoices: accounts.map(account => ({ id: `${account.platform}:${account.key}`, label: account.label })),
      });
    }
  }
  if (ready(input.owners)) {
    for (const entry of input.owners?.value?.candidates || []) {
      if (entry?.intent || !entry?.candidate?.candidate_id) continue;
      const candidate = { ...entry.candidate, candidate_evidence_sha256: entry.candidate_evidence_sha256 };
      const adopt = ownerDecisionBinding(candidate, "approve_limited_live_canary");
      const reject = ownerDecisionBinding(candidate, "keep_parked");
      if (!adopt || !reject || ownerDecisionBinding(candidate, "retire_candidate")) continue;
      items.push({
        id: `owner:${entry.candidate.candidate_id}`,
        kind: "owner_observation",
        title: frozenResearchIdentity(entry.candidate.candidate_id) ? candidateDisplayName(entry.candidate.candidate_id, input.language) : "有限执行观察",
        kicker: "有限执行观察",
        question: "是否进行有限执行观察？",
        accountLine: "",
        currentName: "保持暂停",
        proposedName: "有限观察",
        explanationKind: "system",
        explanation: null,
        reasons: [],
        impact: "有限观察只记录意向，不授予交易权限。不采用会保持暂停，不会退役候选。",
        technical: JSON.stringify({ candidate_id: entry.candidate.candidate_id, recommendation: entry.candidate.recommendation?.code ?? null }, null, 2),
        reference: entry.candidate.candidate_id,
        identity: strategyIdentityView({ basis: "候选材料", record: {
          candidateId: entry.candidate.candidate_id, configHash: entry.candidate.evidence?.p2_config_digest,
          sourceRevision: entry.candidate.evidence?.source_revision,
        } }),
        materialNotes: [],
        canAdopt: true,
        canReject: true,
        adoptDecision: "approve_limited_live_canary",
        rejectDecision: "keep_parked",
        accountChoices: [],
      });
    }
  }
  if (ready(input.recovery)) {
    for (const entry of input.recovery?.value?.recoveries || []) {
      const adopt = recoveryBinding(entry, "approve");
      const reject = recoveryBinding(entry, "reject");
      if (!adopt || !reject || adopt.decision !== "approve" || reject.decision !== "reject") continue;
      const recovery = entry.recovery || {};
      items.push({
        id: `recovery:${recovery.recovery_id}`,
        kind: "recovery",
        title: "恢复核对",
        kicker: "恢复核对",
        question: "是否确认这份恢复核对？",
        accountLine: "",
        currentName: "待确认材料",
        proposedName: "确认材料",
        explanationKind: "system",
        explanation: null,
        reasons: [],
        impact: "确认后只留下核对记录，账户不会因此重新启用。",
        technical: JSON.stringify({ recovery_id: recovery.recovery_id, platform: recovery.platform ?? null, candidate_sha256: recovery.candidate_sha256 ?? null, dual_review_binding_sha256: recovery.dual_review?.evidence_binding_sha256 ?? null }, null, 2),
        reference: recovery.recovery_id,
        materialNotes: [],
        canAdopt: true,
        canReject: true,
        adoptDecision: "approve",
        rejectDecision: "reject",
        accountChoices: [],
      });
    }
  }
  return { blocked, items: items.filter(item => {
    const kind = item.kind === "owner_observation" ? "owner" : item.kind;
    const source = kind === "promotion" ? input.promotions?.value?.tickets?.find((t: any) => t.ticket_id === item.reference)
      : kind === "owner" ? input.owners?.value?.candidates?.find((e: any) => e.candidate?.candidate_id === item.reference)
      : input.recovery?.value?.recoveries?.find((e: any) => e.recovery?.recovery_id === item.reference);
    const state = input.decisionStates?.find(s => s.expected.kind === kind && s.expected.subject_id === item.reference
      && s.expected.material_sha256 === source?.decision_binding?.material_sha256);
    if (!state) return true;
    if (state.status === "recorded") return false;
    item.canAdopt = false; item.canReject = false;
    return true;
  }) };
}

export function preferenceDirty(saved: unknown, draft: unknown): boolean {
  const left = typeof saved === "string" ? saved : "";
  const right = typeof draft === "string" ? draft : "";
  return left !== right;
}

export function cashDraftDirty(draft: { floorTouched?: boolean; clearFloor?: boolean; ratioTouched?: boolean; clearRatio?: boolean; cashMode?: string } | null | undefined): boolean {
  return draft?.floorTouched === true || draft?.clearFloor === true || draft?.ratioTouched === true || draft?.clearRatio === true || (typeof draft?.cashMode === "string" && draft.cashMode !== "");
}

export function decimalUnitRatio(value: string): string | null {
  if (typeof value !== "string" || value.length > 32 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  if (whole === "0") return value;
  if (whole === "1" && (frac === "" || /^0+$/.test(frac))) return value;
  return null;
}

export function percentTextToRatio(text: string): string | null {
  const trimmed = text.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const wholeNorm = whole.replace(/^0+(?=\d)/, "") || "0";
  if (wholeNorm.length > 3 || (wholeNorm.length === 3 && wholeNorm !== "100")) return null;
  if (wholeNorm === "100" && /[1-9]/.test(frac)) return null;
  const digits = `${wholeNorm}${frac}`.replace(/^0+(?=\d)/, "") || "0";
  const places = frac.length + 2;
  const padded = digits.padStart(places + 1, "0");
  const point = padded.length - places;
  const head = padded.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const tail = padded.slice(point).replace(/0+$/, "");
  return decimalUnitRatio(tail ? `${head}.${tail}` : head);
}

export function ratioTextToPercent(ratio: string): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(ratio)) return "";
  const [whole, frac = ""] = ratio.split(".");
  const digits = `${whole}${frac}`;
  const point = whole.length + 2;
  const padded = digits.padEnd(point, "0");
  const head = padded.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const tail = padded.slice(point).replace(/0+$/, "");
  return tail ? `${head}.${tail}` : head;
}

export type ReservedCashMode = "inherit" | "floor" | "ratio" | "both" | "saved";

export function reservedCashEditor(
  overrides: Record<string, unknown> | null | undefined,
  draft: { cashMode?: string; floor?: string; clearFloor?: boolean; percent?: string; ratio?: string },
): { mode: ReservedCashMode; floor: string; ratio: string; percent: string } {
  const chosen = draft?.cashMode;
  if (chosen === "inherit" || chosen === "floor" || chosen === "ratio" || chosen === "both") {
    return {
      mode: chosen,
      floor: draft.clearFloor ? "" : (draft.floor || ""),
      ratio: draft.ratio || "",
      percent: draft.percent || ratioTextToPercent(draft.ratio || ""),
    };
  }
  const source = overrides || {};
  const hasFloor = Object.prototype.hasOwnProperty.call(source, "reserved_cash_floor");
  const hasRatio = Object.prototype.hasOwnProperty.call(source, "reserved_cash_ratio");
  const floor = typeof source.reserved_cash_floor === "string" ? source.reserved_cash_floor : "";
  const ratio = typeof source.reserved_cash_ratio === "string" ? source.reserved_cash_ratio : "";
  const percent = hasRatio ? ratioTextToPercent(ratio) : "";
  if (!hasFloor && !hasRatio) return { mode: "inherit", floor: "", ratio: "", percent: "" };
  if (hasFloor && hasRatio && ratio === "0" && floor !== "0") return { mode: "floor", floor, ratio, percent: "0" };
  if (hasFloor && hasRatio && floor === "0" && ratio !== "0") return { mode: "ratio", floor, ratio, percent };
  if (hasFloor && hasRatio && floor !== "0" && ratio !== "0") return { mode: "both", floor, ratio, percent };
  return { mode: "saved", floor: hasFloor ? floor : "", ratio: hasRatio ? ratio : "", percent };
}

export function readOnlyLayerState(field: unknown): "on" | "off" | "unknown" {
  if (!field || typeof field !== "object" || Array.isArray(field)) return "unknown";
  const record = field as { status?: unknown; value?: unknown };
  if (record.status !== "known" || typeof record.value !== "boolean") return "unknown";
  return record.value ? "on" : "off";
}

export function dcaSettingsReadout(effective: unknown): null | { label: "当前设置"; mode: "定额定投" | "智能定投" | "未核实"; amount: string } {
  if (!effective || typeof effective !== "object" || Array.isArray(effective)) return null;
  const record = effective as { dca_mode?: unknown; dca_base_investment_usd?: unknown };
  if (!record.dca_mode && !record.dca_base_investment_usd) return null;
  const mode = knownText(record.dca_mode);
  const amount = knownText(record.dca_base_investment_usd);
  const numeric = Number(amount);
  return {
    label: "当前设置",
    mode: mode === "fixed" ? "定额定投" : mode === "smart" ? "智能定投" : "未核实",
    amount: amount && Number.isFinite(numeric) && numeric > 0 ? amount : "未核实",
  };
}

function knownText(field: unknown): string {
  if (!field || typeof field !== "object" || Array.isArray(field)) return "";
  const record = field as { status?: unknown; value?: unknown };
  if (record.status !== "known" || typeof record.value !== "string") return "";
  return record.value.trim();
}

export function reservedCashAmount(field: unknown): string | null {
  if (!field || typeof field !== "object" || Array.isArray(field)) return null;
  const record = field as { status?: unknown; value?: unknown };
  if (record.status !== "known" || typeof record.value !== "string" || record.value === "") return null;
  return record.value;
}

export function accountRouteId(platform: string, key: string): string {
  return `${platform}:${key}`;
}

export function activationFromProjection(projection: unknown): "已启用" | "已停用" | "—" {
  const view = presentAccountState(projection as any);
  if (view.detail === "暂未取得状态") return "—";
  const activation = projection && typeof projection === "object" ? (projection as { activation?: unknown }).activation : null;
  return activationLabel(activation);
}

export function accountStatusView(projection: unknown, sourceFreshness?: string | null): { label: string; detail: string } {
  const view = presentAccountState(projection as any, sourceFreshness);
  return { label: view.label, detail: view.detail };
}

export function overviewRuntimeStatusLabel(projection: unknown, sourceFreshness?: string | null): "已停用" | "监测正常" | "异常" | "待确认" | "等待周期" {
  const view = presentAccountState(projection as any, sourceFreshness);
  const activation = projection && typeof projection === "object" ? (projection as { activation?: unknown }).activation : null;
  if (view.label === "—") {
    return view.detail === "尚未到检查时间" && activation === "enabled" && sourceFreshness === "ready"
      ? "等待周期" : "待确认";
  }
  if (view.label === "异常") return "异常";
  if (activation === "disabled") return "已停用";
  return activation === "enabled" ? "监测正常" : "待确认";
}
