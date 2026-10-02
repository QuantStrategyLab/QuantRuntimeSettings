import { applicationRetryAllowed, ownerDecisionBinding, presentAccountState, promotionSuggestion, recoveryBinding } from "./operations.ts";
import type { BinancePrivateScopeAsset, BinancePrivateScopeDisplay } from "./types";

const BINANCE_SCOPE_MAX_ASSETS = 5000;
const BINANCE_SCOPE_MAX_DECIMAL_LENGTH = 128;
const BINANCE_SCOPE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
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

export function scheduleBinancePrivateScopeExpiry(
  observedAt: unknown,
  onExpiry: () => void,
  now = Date.now(),
  timers: Pick<Window, "setTimeout" | "clearTimeout"> = window,
): () => void {
  if (!validBinanceScopeInstant(observedAt)) return () => {};
  const expiresAfter = Date.parse(observedAt) + BINANCE_SCOPE_MAX_AGE_MS + 1;
  const timer = timers.setTimeout(onExpiry, Math.max(0, expiresAfter - now));
  return () => timers.clearTimeout(timer);
}

export type ChartMode = "return" | "assets";

export const RETURN_INDEX_LEGEND = ["标普500", "纳斯达克", "道琼斯", "罗素"] as const;

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
  return Number.isFinite(ms) ? ms : null;
}

function addUtcDays(dateText: string, delta: number): string | null {
  const ms = utcDayMs(dateText);
  if (ms === null) return null;
  return new Date(ms + delta * 86400000).toISOString().slice(0, 10);
}

export function parseMoneyForChart(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !MONEY_RE.test(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > CHART_VALUE_ABS_MAX) return null;
  return n;
}

export function filterAssetHistoryByRange(points: AssetHistoryPoint[], range: ChartRange, now = Date.now()): AssetHistoryPoint[] {
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

export function buildAssetChartGeometry(points: AssetHistoryPoint[], width = 640, height = 220): AssetChartGeometry {
  const usable = points
    .map((point) => {
      const value = parseMoneyForChart(point.net_assets);
      const day = utcDayMs(point.observation_date);
      if (value === null || day === null) return null;
      return { ...point, value, day };
    })
    .filter((item): item is AssetHistoryPoint & { value: number; day: number } => Boolean(item));
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
    amount: item.net_assets,
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
      if (expected === point.observation_date) current.push(command);
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
    minLabel: usable.reduce((best, item) => item.value <= (parseMoneyForChart(best) ?? Infinity) ? item.net_assets : best, usable[0].net_assets),
    maxLabel: usable.reduce((best, item) => item.value >= (parseMoneyForChart(best) ?? -Infinity) ? item.net_assets : best, usable[0].net_assets),
  };
}

export type RuntimeDailySnapshot = {
  ok: true;
  date: string;
  timezone: string;
  account_key: string;
  data_status: "fresh" | "stale" | "historical" | "unavailable";
  record: {
    status: string;
    kind: string;
    execution_lane: string;
    business_date: string;
    observed_at: string;
    schedule?: { state?: string; expected_window?: string; reason?: string | null };
    runs?: Array<{ run_id: string | null; started_at: string | null; finished_at: string | null; activity: string; execution_lane: string }>;
    conflict_count?: number;
  } | null;
  fills: { source: "not_connected"; records: []; count: null } | null;
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

export const RUNTIME_DAILY_PLATFORM = "longbridge";

export type RuntimeDailySelection = {
  platform: string | null | undefined;
  accountKey: string | null | undefined;
};

export function runtimeDailySelectionEligible(selection: RuntimeDailySelection | null | undefined): boolean {
  if (!selection) return false;
  if (typeof selection.platform !== "string" || !selection.platform) return false;
  if (typeof selection.accountKey !== "string" || !selection.accountKey) return false;
  return selection.platform === RUNTIME_DAILY_PLATFORM;
}

export function presentRuntimeDaily(
  snapshot: RuntimeDailySnapshot | null | undefined,
  selection: RuntimeDailySelection | null | undefined,
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
  };
  if (!selection || typeof selection.accountKey !== "string" || !selection.accountKey) return empty;
  // Connected runtime-daily is LongBridge-only. Missing platform must not default to LongBridge.
  if (!runtimeDailySelectionEligible(selection)) {
    return {
      ...empty,
      accountMatched: false,
      statusDetails: [],
      fillsLabel: "暂无数据",
      dataStatusLabel: "暂无数据",
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
  if (snapshot.account_key !== selection.accountKey) {
    return {
      ...empty,
      accountMatched: false,
      statusDetails: [],
      fillsLabel: "暂无数据",
      dataStatusLabel: "暂无数据",
    };
  }
  const observedAt = typeof snapshot.record?.observed_at === "string" ? snapshot.record.observed_at : null;
  const dataStatusLabel = snapshot.data_status === "stale"
    ? "数据暂不可用"
    : snapshot.data_status === "unavailable"
      ? "暂不可用"
      : "—";
  if (!snapshot.record) {
    return {
      available: true,
      accountMatched: true,
      title: "每日运行记录",
      statusLabel: "—",
      statusDetails: [],
      runStartedAt: null,
      runFinishedAt: null,
      dryRun: false,
      fillsLabel: "暂无数据",
      dataStatusLabel: snapshot.data_status === "unavailable" ? "暂无数据" : dataStatusLabel,
      updatedAt: null,
    };
  }
  const record = snapshot.record;
  const status = typeof record.status === "string" ? record.status : "unknown";
  const statusLabel = RUNTIME_DAILY_STATUS_LABELS[status] || status;
  const dryRun = record.execution_lane === "dry_run" || status === "dry_run" || (record.runs || []).some((run) => run.execution_lane === "dry_run");
  const run = (record.runs || []).find((item) => item.started_at || item.finished_at) || null;
  return {
    available: true,
    accountMatched: true,
    title: "每日运行记录",
    statusLabel,
    statusDetails: [],
    runStartedAt: typeof run?.started_at === "string" ? run.started_at : null,
    runFinishedAt: typeof run?.finished_at === "string" ? run.finished_at : null,
    dryRun,
    fillsLabel: "暂无数据",
    dataStatusLabel,
    updatedAt: snapshot.data_status === "stale" ? observedAt : null,
  };
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

export function strategyDisplayName(profile: object | null | undefined, language: "zh" | "en"): string {
  return catalogText(profile, language === "zh" ? "label_zh" : "label_en") || "未命名策略";
}

export function strategyNote(profile: object | null | undefined, language: "zh" | "en"): string {
  return catalogText(profile, language === "zh" ? "description_zh" : "description_en");
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

export function brokerAccountType(value: unknown): "模拟交易账户" | "真实交易账户" | "账户类型待确认" {
  if (value === "paper") return "模拟交易账户";
  if (value === "live") return "真实交易账户";
  return "账户类型待确认";
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
  set_broker_environment: "更新了账户类型标记",
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

function profileName(profiles: any[], id: unknown, language: "zh" | "en"): string {
  const found = profiles.find(item => item?.profile === id);
  return strategyDisplayName(found, language);
}

export function listDailyDecisions(input: {
  language: "zh" | "en";
  profiles: any[];
  promotions: SourceState | null | undefined;
  owners: SourceState | null | undefined;
  recovery: SourceState | null | undefined;
  accountsFor: (ticket: any) => Array<{ platform: string; key: string; label: string }>;
}): { blocked: boolean; items: DailyDecision[] } {
  const blocked = !ready(input.promotions) || !ready(input.owners) || !ready(input.recovery);
  const items: DailyDecision[] = [];
  if (ready(input.promotions)) {
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
        canAdopt: accounts.length > 0,
        canReject: true,
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
        title: "有限执行观察",
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
        canAdopt: true,
        canReject: true,
        adoptDecision: "approve",
        rejectDecision: "reject",
        accountChoices: [],
      });
    }
  }
  return { blocked, items };
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

export function overviewRuntimeStatusLabel(projection: unknown, sourceFreshness?: string | null): "已停用" | "监测正常" | "异常" | "待确认" {
  const view = presentAccountState(projection as any, sourceFreshness);
  if (view.label === "—") return "待确认";
  if (view.label === "异常") return "异常";
  const activation = projection && typeof projection === "object" ? (projection as { activation?: unknown }).activation : null;
  if (activation === "disabled") return "已停用";
  return activation === "enabled" ? "监测正常" : "待确认";
}
