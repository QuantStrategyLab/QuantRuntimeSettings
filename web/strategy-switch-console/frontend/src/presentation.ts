import { applicationRetryAllowed, ownerDecisionBinding, presentAccountState, promotionSuggestion, recoveryBinding } from "./operations.ts";

export type ChartMode = "return" | "assets" | "cash";

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

export function chartUnavailable(mode: ChartMode): "收益数据积累中" | "资产数据暂不可用" {
  return mode === "return" ? "收益数据积累中" : "资产数据暂不可用";
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

export function chartRangeNote(range: ChartRange): { key: "至今从首条有效记录算起，当前没有记录。" | "{range}内还没有可绘制的记录。"; rangeLabel: "3个月" | "半年" | "1年" | "3年" | "5年" | "10年" | "至今" } {
  const option = CHART_RANGE_OPTIONS.find(item => item.id === range) || CHART_RANGE_OPTIONS[2];
  if (range === "all") return { key: "至今从首条有效记录算起，当前没有记录。", rangeLabel: option.label };
  return { key: "{range}内还没有可绘制的记录。", rangeLabel: option.label };
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

function singleBrokerTail(selector: unknown): string {
  const text = identityText(selector);
  if (!text) return "";
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length !== 1 || !/^U\d{5,}$/i.test(tokens[0])) return "";
  return tokens[0].slice(-4);
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
  const selectorTail = ibkr ? singleBrokerTail(account.account_selector) : "";
  const labelIsNumber = fullAccountNumber(label);
  const tail = selectorTail || (ibkr && !identityText(account.account_selector) && labelIsNumber ? label.slice(-4) : "");
  const base = { text: "", tail: "", alias: "", platform, environment };
  const legacyStrategyLabel = Boolean(selectorTail) && LEGACY_IBKR_STRATEGY_ALIASES.has(identityFold(label));
  const occupiedLabel = Boolean(label) && (occupied.has(identityFold(label)) || identityFold(label) === identityFold(platform) || legacyStrategyLabel);
  if (label && !occupiedLabel && !labelIsNumber && !ROUTE_ALIASES.has(identityFold(label))) return { ...base, kind: "nickname", text: label };
  if (tail && (occupiedLabel || labelIsNumber || !label)) return { ...base, kind: "masked", tail };
  const alias = routeAlias(labelIsNumber ? "" : label, key);
  if (alias) return { ...base, kind: "alias", alias };
  return { ...base, kind: "generic" };
}

export function formatAccountIdentity(identity: AccountIdentity, translate: (key: string, values?: Record<string, string>) => string): string {
  if (identity.kind === "masked") return translate("账户 ••••{tail}", { tail: identity.tail });
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

export function paperApplicationReady(application: { application?: Record<string, any> | null; application_preparation?: { preflight_status?: unknown; preview_request?: unknown; account_options?: Array<Record<string, unknown>> } } | null | undefined, selectedAccountId: string): boolean {
  if (!application || !applicationRetryAllowed(application.application)) return false;
  const prep = application.application_preparation || {};
  if (prep.preflight_status !== "ready" || !prep.preview_request) return false;
  return paperApplicationAccounts(application).some(account => account.id === selectedAccountId);
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

export function cashDraftDirty(draft: { floorTouched?: boolean; clearFloor?: boolean } | null | undefined): boolean {
  return draft?.floorTouched === true || draft?.clearFloor === true;
}

export function readOnlyLayerState(field: unknown): "on" | "off" | "unknown" {
  if (!field || typeof field !== "object" || Array.isArray(field)) return "unknown";
  const record = field as { status?: unknown; value?: unknown };
  if (record.status !== "known" || typeof record.value !== "boolean") return "unknown";
  return record.value ? "on" : "off";
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

export function accountStatusView(projection: unknown): { label: string; detail: string } {
  const view = presentAccountState(projection as any);
  return { label: view.label, detail: view.detail };
}
