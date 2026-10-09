import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { AccountOption, AdminModel, ConfigPayload, LifecycleRecord, ReadModel, UxDraft } from "./api";
import { AccessError, getJson, invalidatePrivateSession, loadAdminModel, loadReadModel, loadHumanDecisionReceipt, postJson, runtimeStopQuery } from "./api";
import { createRequestGate } from "./requestGate.js";
import { nextExplicitTheme, normalizeThemePreference, resolveTheme, THEME_STORAGE_KEY } from "./theme.js";
import { accountEnvironmentSourceDetail, accountRuntimeLinkDetail, applicationRetryAllowed, beginNonHkStop, buildConfirmationFingerprint, buildSwitchInputs, canResumeBinance, confirmationAccepted, createHumanDecisionController, humanDecisionExpectation, type HumanDecisionKind, type HumanDecisionState, createRequestLock, createUnknownSubmitLock, defaultSwitchDraft, createHkStopController, hkStopSubmitAllowed, ownerDecisionBinding, pageFromWorkspace, recoveryBinding, type SwitchDraft } from "./operations";
import { LocaleContext, renderLocaleMessage, translate, useT, type Language, type LocaleMessage } from "./locales";
import { AccountsPage, type AccountListItem } from "./AccountsPage";
import { DecisionCount, DecisionsPage } from "./DecisionsPage";
import { OverviewPage, type OverviewAccount } from "./OverviewPage";
import { StrategyIdentity } from "./StrategyIdentity";
import { accountStatusView, overviewActivationLabelFromProjection, adminDirectoryTitle, brokerAccountType, knownAccountLabel, humanDecisionQueue, listDailyDecisions, overviewRuntimeStatusLabel, paperApplicationAccounts, paperApplicationActionable, paperApplicationReady, paperApplicationUnresolved, strategyDisplayName, strategySelectionName, strategyIdentityView, candidateDisplayName, strategyNote, strategyOccupiedNames, type DailyDecision } from "./presentation";
import { accountFactsForRow } from "./types";
import { resolveRuntimeDailyTarget, runtimeDailySelectionBinding } from "./presentation";
type Page = "overview" | "strategy" | "accounts";
type Theme = "light" | "dark" | "system";
type AccountRow = {
    id: string;
    platform: string;
    platformLabel: string;
    account: AccountOption;
    current: Record<string, any> | null;
    runtime: LifecycleRecord | null;
    runtimeDetail: string | null;
};
type Busy = Record<string, boolean>;
type ConfirmDialogState = {
    title: string;
    target: string;
    summary: string;
    consequence: string;
    tone: "normal" | "danger";
    confirmLabel?: string;
    fingerprint: string;
};
const NAV: Array<{
    id: Page;
    label: string;
}> = [
    { id: "overview", label: "账户总览" }, { id: "strategy", label: "待办决策" },
    { id: "accounts", label: "账户设置" },
];
const ACCOUNT_PLAN_SUBMISSION_AVAILABLE = false;
const emptyUxDraft = (): UxDraft => ({ draft: { objective: "one_step_net_log_score", research_case_id: "r8_first_dynamic_2023_03_29", advanced_settings: {} }, revision: 0, preview: null, intent: null });
function safeGet(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    }
    catch {
        return null;
    }
}
function safeSet(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    }
    catch { /* optional preference */ }
}
function copy(key: string, values: Record<string, string | number | LocaleMessage> = {}): LocaleMessage { return {key,values}; }
function initialLanguage(): Language { const stored = safeGet("qsl-switch-lang"); return stored === "zh" || stored === "en" ? stored : "zh"; }
function displayStatus(value: unknown, _translate?: (key: string) => string): string {
    const labels: Record<string, string> = { observed: "已收到心跳", healthy: "运行状态可供核对", live: "执行（live）", ready: "可供核对", stale: "资料已过期", unavailable: "暂不可用", unknown: "结果待确认", active: "运行中", paused: "已暂停", disabled: "已停用", enabled: "已启用", monitoring_only: "仅监测", not_due: "等待检查周期", attention: "需要核对", failed: "未完成", succeeded: "已完成", queued: "排队中", running: "处理中", approved: "请求已批准", rejected: "已明确拒绝", claimed: "已领取处理中", applied_paused: "已完成", pending: "等待提交", sent: "已提交", fixed: "固定金额", current: "保持现状", none: "不启用", auto: "自动选择", smart: "智能定投", ratio: "比例", floor: "固定金额下限", max: "金额与比例取较大值", paper: "模拟账户环境", dry_run: "禁止下单验证", ready_to_apply: "可供核对" };
    const label = labels[String(value || "")];
    return label || "状态未知";
}
function decisionLabel(value: unknown, t: (key: string) => string): string {
    const labels: Record<string, string> = { approve_limited_live_canary: "有限执行观察", keep_parked: "保持暂停", retire_candidate: "退役候选", accepted: "已接受", rejected: "已明确拒绝", keep: "保持现状" };
    return labels[String(value || "")] ? t(labels[String(value)]) : t("状态未知");
}
function brokerEnvironment(value: unknown, t: (key: string) => string): string {
    return t(brokerAccountType(value));
}
function executionMode(value: unknown, t: (key: string) => string): string {
    return value === "live" ? t("执行（live）") : value === "dry_run" ? t("执行（dry_run）") : value === "paper" ? t("执行（paper）") : t("状态未知");
}
function requestErrorKey(error: unknown): string {
    const status = Number((error as any)?.status || 0);
    if (status === 401 || status === 403)
        return "会话已失效，请重新登录。";
    if (status === 409)
        return "版本冲突；当前编辑已保留，请刷新核对。";
    return "请求未完成；请刷新并核对当前状态。";
}
function currentFor(config: ConfigPayload | null, platform: string, account: AccountOption): Record<string, any> | null {
    const entries = config?.currentStrategies?.[platform] || {};
    for (const key of [account.key, account.target_name, account.label])
        if (key && entries[key])
            return entries[key];
    return null;
}
function makeRows(model: ReadModel | null): AccountRow[] {
    const config = model?.config.value;
    const runtime = model?.runtime.value;
    if (!config?.accountOptions || !config.platformMeta)
        return [];
    const rows: AccountRow[] = [];
    const monitoringUses = new Map<string, number>();
    for (const [platform, accounts] of Object.entries(config.accountOptions)) {
        if (!Array.isArray(accounts))
            continue;
        for (const account of accounts) {
            const reference = typeof account?.runtime_status_target_id === "string" ? account.runtime_status_target_id : "";
            if (!reference)
                continue;
            const link = `${platform}:${reference}`;
            monitoringUses.set(link, (monitoringUses.get(link) || 0) + 1);
        }
    }
    for (const [platform, accounts] of Object.entries(config.accountOptions)) {
        const meta = config.platformMeta[platform];
        if (!meta || meta.console_visible === false || !Array.isArray(accounts))
            continue;
        for (const account of accounts) {
            const reference = typeof account?.runtime_status_target_id === "string" ? account.runtime_status_target_id : "";
            const hits = (runtime?.targets || []).filter((record: any) => record?.target?.target_id === reference && record?.target?.target?.platform === platform);
            const unique = Boolean(reference) && hits.length === 1 && monitoringUses.get(`${platform}:${reference}`) === 1;
            const runtimeDetail = accountRuntimeLinkDetail({
                reference,
                referenceUseCount: reference ? monitoringUses.get(`${platform}:${reference}`) : 0,
                runtimeError: model?.runtime.error,
                runtimeDataStatus: runtime?.data_status,
                targetMatchCount: hits.length,
            });
            rows.push({ id: `${platform}:${account.key}`, platform, platformLabel: meta.label || platform, account, current: currentFor(config, platform, account), runtime: unique ? hits[0] : null, runtimeDetail });
        }
    }
    return rows;
}
function QslIcon({ className = "brand-mark" }: {
    className?: string;
}) { return <img className={className} src="/v2/assets/qsl-brand-icon.png" alt="" aria-hidden="true"/>; }
function App() {
    const [page, setPage] = useState<Page>(() => pageFromWorkspace(new URLSearchParams(window.location.search).get("workspace")));
    const [applicationFold, setApplicationFold] = useState<boolean | null>(null);
    const [theme, setTheme] = useState<Theme>(() => normalizeThemePreference(safeGet(THEME_STORAGE_KEY)));
    const [language, setLanguage] = useState<Language>(initialLanguage);
    const t = (key: string, values: Record<string, string | number> = {}) => translate(key, language, values);
    const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
    const [model, setModel] = useState<ReadModel | null>(null);
    const [overviewReadModelRefreshVersion, setOverviewReadModelRefreshVersion] = useState(0);
    const [adminModel, setAdminModel] = useState<AdminModel | null>(null);
    const [bootState, setBootState] = useState<"loading" | "ready" | "denied" | "error">("loading");
    const [, setRefreshing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<LocaleMessage | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("account") || "");
    const [accountDetailOpen, setAccountDetailOpen] = useState(() => Boolean(new URLSearchParams(window.location.search).get("account")));
    const settingsDirty = useRef(false);
    const userMenuRef = useRef<HTMLDetailsElement>(null);
    const [settingsEpoch, setSettingsEpoch] = useState(0);
    const [settingsRefresh, setSettingsRefresh] = useState(0);
    const [observedStrategy, setObservedStrategy] = useState<{ id: string; profile: string | null } | null>(null);
    const routeGuard = useRef({ url: `${window.location.pathname}${window.location.search}` });
    const discardRef = useRef<() => Promise<boolean>>(async () => true);
    const [switchDrafts, setSwitchDrafts] = useState<Record<string, SwitchDraft>>({});
    const [uxDraft, setUxDraft] = useState<UxDraft>(emptyUxDraft());
    const [uxDirty, setUxDirty] = useState(false);
    const [, setUxBusy] = useState(false);
    const [, setUxError] = useState<LocaleMessage | null>(null);
    const [busy, setBusy] = useState<Busy>({});
    const [diagnosis, setDiagnosis] = useState<Record<string, any>>({});
    const [stopRecords, setStopRecords] = useState<Record<string, any>>({});
    const [promotionTicketId, setPromotionTicketId] = useState("");
    const [promotionAccountId, setPromotionAccountId] = useState("");
    const [promotionRisk] = useState("CAPITAL_PRESERVATION");
    const gate = useRef(createRequestGate());
    const hkStops = useRef(new Map<string, ReturnType<typeof createHkStopController>>());
    const switchLocks = useRef(createUnknownSubmitLock());
    const onceLocks = useRef(createRequestLock());
    const humanDecisions = useRef(createHumanDecisionController());
    const unresolvedSettingsSaves = useRef(new Map());
    const uxEditEpoch = useRef(0);
    const confirmResolver = useRef<((confirmed: boolean) => void) | null>(null);
    const confirmReturnFocus = useRef<HTMLElement | null>(null);
    const confirmationFingerprint = () => buildConfirmationFingerprint({ session: model?.session, selectedId, selectedAccount: active?.account, currentStrategy: active?.current, runtimeAt: model?.runtime.value?.computed_at, controlAt: model?.control.value?.computed_at, ownerCandidates: model?.owners.value?.candidates, recoveries: model?.recovery.value?.recoveries, promotionTickets: model?.promotions.value?.tickets, promotionApplications: model?.promotions.value?.applications, switchDrafts, uxDraft: { revision: uxDraft.revision, draft: uxDraft.draft, fingerprint: uxDraft.fingerprint, job: uxDraft.job?.status }, uxDirty, promotionTicketId, promotionAccountId, promotionRisk, adminRevision: adminModel?.instances.value?.revision });
    const resolveConfirmation = (confirmed: boolean) => {
        const resolve = confirmResolver.current;
        const accepted = !confirmed || Boolean(confirmDialog && confirmationAccepted(true, confirmDialog.fingerprint, confirmationFingerprint()));
        confirmResolver.current = null;
        setConfirmDialog(null);
        if (confirmed && !accepted)
            setErrorMessage(copy("确认期间相关资料已变化，操作已取消；请刷新并重新核对。"));
        resolve?.(confirmed && accepted);
        requestAnimationFrame(() => {
            if (confirmReturnFocus.current?.isConnected)
                confirmReturnFocus.current.focus();
            confirmReturnFocus.current = null;
        });
    };
    const confirmAction = (dialog: Omit<ConfirmDialogState, "fingerprint">): Promise<boolean> => new Promise(resolve => {
        if (confirmResolver.current)
            resolveConfirmation(false);
        confirmReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        confirmResolver.current = resolve;
        setConfirmDialog({ ...dialog, fingerprint: confirmationFingerprint() });
    });
    const rows = useMemo(() => makeRows(model), [model]);
    const active = rows.find(row => row.id === selectedId) || rows[0] || null;
    const accountTitle = (account: { label?: unknown; key?: unknown; account_selector?: unknown }, platformLabel: string, currentProfile?: unknown) => adminDirectoryTitle(account, platformLabel, strategyOccupiedNames(model?.config.value?.strategyProfiles || [], currentProfile));
    const resolvedTheme = resolveTheme(theme, systemDark);
    const clearPrivateState = (invalidate = true) => {
        resolveConfirmation(false);
        if (invalidate)
            invalidatePrivateSession();
        gate.current.invalidate();
        switchLocks.current.clear();
        onceLocks.current.clear();
        humanDecisions.current.clear();
        unresolvedSettingsSaves.current = new Map();
        uxEditEpoch.current += 1;
        setModel(null);
        setAdminModel(null);
        setSwitchDrafts({});
        setDiagnosis({});
        hkStops.current = new Map();
        setStopRecords({});
        setUxDraft(emptyUxDraft());
        setUxDirty(false);
        setUxBusy(false);
        setUxError(null);
        setObservedStrategy(null);
        setPromotionTicketId("");
        setPromotionAccountId("");
        setSelectedId("");
        setBusy({});
        setErrorMessage(null);
        setBootState("denied");
        setRefreshing(false);
    };
    // Any refreshed evidence or edited form invalidates an open confirmation snapshot.
    useEffect(() => {
        if (confirmDialog && confirmDialog.fingerprint !== confirmationFingerprint())
            resolveConfirmation(false);
    }, [confirmDialog, model, adminModel, selectedId, switchDrafts, uxDraft, uxDirty, diagnosis, promotionTicketId, promotionAccountId, promotionRisk]);
    const decisionNotice = (states: HumanDecisionState[]) => {
        const latest = states.filter(s => s.receipt).at(-1);
        const unresolved = states.some(s => s.status === "unresolved");
        if (latest) setErrorMessage(copy("决定已记录：{time}。{detail}", { time: latest.receipt!.decided_at,
            detail: copy(unresolved ? "最新资料未确认；请刷新核对，避免重复提交。" : "本次只记录决定，不会提交订单或改变交易权限。") }));
        else if (unresolved) setErrorMessage(copy("最新资料未确认；请刷新核对，避免重复提交。"));
    };
    const refresh = useCallback(async () => {
        const token = gate.current.begin();
        setRefreshing(true);
        setErrorMessage(null);
        try {
            const next = await loadReadModel();
            if (!gate.current.isCurrent(token))
                return;
            if ("denied" in next) {
                clearPrivateState(false);
                return;
            }
            setModel(next);
            setOverviewReadModelRefreshVersion(value => value + 1);
            setBootState("ready");
            if (!selectedId && next.config.value?.accountOptions) {
                const first = Object.entries(next.config.value.accountOptions).flatMap(([p, list]) => list.map(a => `${p}:${a.key}`))[0];
                if (first)
                    setSelectedId(first);
            }
            if (!uxDirty && next.research.value)
                setUxDraft(next.research.value);
            if (next.session.admin) {
                const admin = await loadAdminModel();
                if (!gate.current.isCurrent(token))
                    return;
                setAdminModel(admin);
            }
            else setAdminModel(null);
            if (gate.current.isCurrent(token))
                setSettingsRefresh(value => value + 1);
            // Refresh is an explicit read; it never retries a decision POST.
            await Promise.all(humanDecisions.current.entries().map(async state => {
                const op = humanDecisions.current.beginRead(state.expected);
                const source = state.expected.kind === "owner" ? next.owners : state.expected.kind === "recovery" ? next.recovery : next.promotions;
                try {
                    const payload = await loadHumanDecisionReceipt(state.expected);
                    if (!gate.current.isCurrent(token)) return;
                    await humanDecisions.current.readback(op, payload, !source.error && source.value?.data_status === "ready");
                } catch (error) {
                    if (error instanceof AccessError) { clearPrivateState(false); return; }
                    if (gate.current.isCurrent(token)) humanDecisions.current.readFailed(op);
                }
            }));
            if (gate.current.isCurrent(token)) decisionNotice(humanDecisions.current.entries());
        }
        catch (error) {
            if (!gate.current.isCurrent(token))
                return;
            if (error instanceof AccessError) {
                clearPrivateState(false);
            }
            else {
                for (const state of humanDecisions.current.entries()) humanDecisions.current.readFailed(humanDecisions.current.beginRead(state.expected));
                if (humanDecisions.current.entries().length) decisionNotice(humanDecisions.current.entries());
                else setErrorMessage(copy(requestErrorKey(error)));
                if (!model)
                    setBootState("error");
            }
        }
        finally {
            if (gate.current.isCurrent(token)) {
                setRefreshing(false);
            }
        }
    }, [model, selectedId, uxDirty]);
    useEffect(() => { void refresh(); }, []);
    useEffect(() => { const invalid = () => clearPrivateState(false); window.addEventListener("qsl-private-session-invalid", invalid); return () => window.removeEventListener("qsl-private-session-invalid", invalid); }, []);
    useEffect(() => {
        const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
        if (!mq)
            return;
        const update = (e: MediaQueryListEvent) => setSystemDark(e.matches);
        mq.addEventListener?.("change", update);
        return () => mq.removeEventListener?.("change", update);
    }, []);
    useEffect(() => { document.documentElement.dataset.theme = resolvedTheme; }, [resolvedTheme]);
    useEffect(() => { safeSet(THEME_STORAGE_KEY, theme); }, [theme]);
    useEffect(() => { if (userMenuRef.current) userMenuRef.current.open = false; }, [page]);
    useEffect(() => {
        const closeIfOutside = (event: PointerEvent) => {
            const menu = userMenuRef.current;
            if (!menu?.open || menu.contains(event.target as Node)) return;
            menu.open = false;
        };
        const closeOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key === "Escape" && userMenuRef.current) userMenuRef.current.open = false;
        };
        document.addEventListener("pointerdown", closeIfOutside);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeIfOutside);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, []);
    useEffect(() => { safeSet("qsl-switch-lang", language); document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; document.title = `${t(NAV.find(item => item.id === page)?.label || "资产总览")} · QuantStrategyLab`; }, [language, page]);
    useEffect(() => {
        setObservedStrategy(current => current?.id === selectedId ? current : null);
    }, [selectedId]);
    useEffect(() => {
        if (!model?.session.allowed || !active?.account.key)
            return;
        let alive = true;
        setDiagnosis(prev => ({ ...prev, [active.id]: { ...prev[active.id], loading: true } }));
        getJson<any>(`/api/account-diagnosis?platform=${encodeURIComponent(active.platform)}&key=${encodeURIComponent(active.account.key)}`)
            .then(result => {
            if (alive)
                setDiagnosis(prev => ({ ...prev, [active.id]: { available: true, loading: false, reason_code: null, reason: null, task: result.task || null } }));
        })
            .catch(error => {
            if (error instanceof AccessError)
                clearPrivateState(false);
            else if (alive)
                setDiagnosis(prev => ({
                    ...prev,
                    [active.id]: {
                        available: false,
                        loading: false,
                        reason_code: (error as any)?.reason_code || (error as any)?.payload?.reason_code || null,
                        reason: (error as any)?.reason || (error as any)?.payload?.reason || null,
                        task: null,
                    },
                }));
        });
        return () => { alive = false; };
    }, [model?.session.allowed, active?.id]);
    const setPageAndRoute = (next: Page, accountId?: string) => {
        setPage(next);
        if (accountId) {
            setSelectedId(accountId);
            setAccountDetailOpen(true);
        }
        const params = new URLSearchParams();
        if (next !== "overview") params.set("workspace", next === "strategy" ? "research" : next);
        const account = next === "accounts" ? (accountId || selectedId) : "";
        if (account) params.set("account", account);
        const query = params.toString();
        const url = query ? `/?${query}` : "/";
        window.history.pushState({ page: next, account }, "", url);
        routeGuard.current.url = url;
    };
    const discardUnsaved = async () => {
        if (!settingsDirty.current) return true;
        const accepted = await confirmAction({ title: t("放弃未保存的修改？"), target: active ? accountTitle(active.account, active.platformLabel, active.current?.strategy_profile) : t("账户"), summary: t("未保存的预留现金和收入层草案会丢弃。"), consequence: t("未保存的预留现金和收入层草案会丢弃。"), tone: "normal" });
        if (!accepted) return false;
        settingsDirty.current = false;
        setSettingsEpoch(value => value + 1);
        return true;
    };
    discardRef.current = discardUnsaved;
    const applyLocation = () => {
        const params = new URLSearchParams(window.location.search);
        setPage(pageFromWorkspace(params.get("workspace")));
        const account = params.get("account") || "";
        if (account) setSelectedId(account);
        setAccountDetailOpen(Boolean(account));
        routeGuard.current.url = `${window.location.pathname}${window.location.search}`;
    };
    useEffect(() => {
        const pop = () => {
            const nextUrl = `${window.location.pathname}${window.location.search}`;
            const previousUrl = routeGuard.current.url;
            if (!settingsDirty.current) {
                applyLocation();
                return;
            }
            window.history.pushState({ guard: true }, "", previousUrl);
            void discardRef.current().then(accepted => {
                if (!accepted) return;
                window.history.pushState({ guard: true }, "", nextUrl);
                applyLocation();
            });
        };
        window.addEventListener("popstate", pop);
        return () => window.removeEventListener("popstate", pop);
    }, []);
    const logout = async () => {
        clearPrivateState();
        try {
            await postJson("/api/logout", {});
        }
        catch { /* local state remains cleared */ }
        window.location.assign("/login");
    };
    const currentForm = (row: AccountRow | null): SwitchDraft | null => row ? switchDrafts[row.id] || defaultSwitchDraft(row.account, row.current, row.platform) : null;
    const beginOnce = (key: string) => {
        if (!onceLocks.current.acquire(key))
            return false;
        setBusy(prev => ({ ...prev, [key]: true }));
        return true;
    };
    const finishOnce = (key: string, unlock = true) => {
        if (unlock)
            onceLocks.current.release(key);
        setBusy(prev => ({ ...prev, [key]: false }));
    };
    const isHkStop = (row: AccountRow) => row.platform === "longbridge" && (row.account.target_name || row.account.key) === "hk";
    const hkStopFor = (accountId: string) => {
        let controller = hkStops.current.get(accountId);
        if (!controller) {
            controller = createHkStopController();
            hkStops.current.set(accountId, controller);
        }
        return controller;
    };
    const publishHkStop = (accountId: string) => {
        const controller = hkStops.current.get(accountId);
        if (!controller) return;
        setStopRecords(prev => ({ ...prev, [accountId]: controller.snapshot() }));
    };
    const refreshStopRecord = useCallback(async (row: AccountRow) => {
        if (row.platform !== "longbridge" || (row.account.target_name || row.account.key) !== "hk")
            return;
        const controller = hkStopFor(row.id);
        const token = controller.beginRead();
        try {
            const payload = await getJson<any>(runtimeStopQuery(row.platform, row.account.target_name || row.account.key));
            controller.completeRead(token, payload);
        }
        catch {
            controller.failRead(token);
        }
        publishHkStop(row.id);
    }, []);
    useEffect(() => {
        if (!active || active.platform !== "longbridge" || (active.account.target_name || active.account.key) !== "hk")
            return;
        const accountId = active.id;
        const controller = hkStopFor(accountId);
        setStopRecords(prev => prev[accountId] ? prev : { ...prev, [accountId]: controller.snapshot() });
        const token = controller.beginRead();
        let cancelled = false;
        void getJson<any>(runtimeStopQuery(active.platform, active.account.target_name || active.account.key))
            .then(payload => { if (!cancelled) { controller.completeRead(token, payload); publishHkStop(accountId); } })
            .catch(() => { if (!cancelled) { controller.failRead(token); publishHkStop(accountId); } });
        return () => { cancelled = true; };
    }, [active?.id, active?.platform, active?.account?.target_name, active?.account?.key]);
    const submitAccountPlan = async (row: AccountRow, stopOnly = false) => {
        if (!model?.session.allowed || switchLocks.current.blocked(row.id))
            return;
        const form = currentForm(row);
        if (!form)
            return;
        if (stopOnly || form.runtimeMode === "disabled") {
            if (isHkStop(row) && !hkStopSubmitAllowed(stopRecords[row.id])) {
                setErrorMessage(copy("停用结果未知，不能再次提交。可以只读刷新。"));
                return;
            }
            if (!await confirmAction({ title: t("确认停用运行目标"), target: accountTitle(row.account, row.platformLabel, row.current?.strategy_profile), summary: t("当前策略：{strategy}", { strategy: row.current?.strategy_profile || form.strategy || t("未读取") }), consequence: t("停用只阻止新的触发，不会撤单、平仓或清除在途请求。"), tone: "danger" }))
                return;
            let hkRequestId = "";
            if (isHkStop(row)) {
                hkRequestId = hkStopFor(row.id).beginSubmit();
                publishHkStop(row.id);
            }
            else if (!beginNonHkStop(switchLocks.current, row.id, Boolean(model?.session.allowed), true))
                return;
            setBusy(prev => ({ ...prev, [`stop:${row.id}`]: true }));
            try {
                const result = await postJson<any>("/api/runtime-stop", {
                    platform: row.platform,
                    target_name: row.account.target_name || row.account.key,
                    confirm: "STOP_ONLY",
                    ...(hkRequestId ? { request_id: hkRequestId } : {}),
                });
                if (isHkStop(row)) {
                    hkStopFor(row.id).completePost(result);
                    publishHkStop(row.id);
                    const phase = hkStopFor(row.id).snapshot().phase;
                    if (phase === "stopped")
                        setErrorMessage(copy("这次停用已确认。这不是当前运行状态，也不说明在途请求已经结束。"));
                    else if (phase === "rejected")
                        setErrorMessage(copy("停用请求已被明确拒绝。"));
                    else if (phase === "accepted")
                        setErrorMessage(copy("工作流已接受，平台是否停用仍未确认。"));
                    else
                        setErrorMessage(copy("停用结果未知，不能再次提交。可以只读刷新。"));
                }
                else {
                    if (result.actions_url)
                        window.open(result.actions_url, "_blank", "noopener,noreferrer");
                    setErrorMessage(copy("停用请求已提交；请核对现有 workflow 结果后再刷新，避免重复提交。"));
                }
            }
            catch (error) {
                if (isHkStop(row)) {
                    await refreshStopRecord(row);
                    setErrorMessage(copy("停用结果未知，不能再次提交。可以只读刷新。"));
                }
                else
                    setErrorMessage(copy("停用结果未确认。请先检查现有 workflow，不要盲目重试。{detail}", {detail:error?copy(" · {error}",{error:copy(requestErrorKey(error))}):""}));
            }
            finally {
                setBusy(prev => ({ ...prev, [`stop:${row.id}`]: false }));
            }
            return;
        }
        if (!ACCOUNT_PLAN_SUBMISSION_AVAILABLE) {
            setErrorMessage(copy("暂不可用"));
            return;
        }
        try {
            const body = buildSwitchInputs(row.platform, row.account, form);
            const summary = t("账户：{account}\n券商环境：{environment}\n策略：{strategy}\n执行方式：{execution}\n启停：{runtime}\n提交后仍需运行读回确认。", { account: accountTitle(row.account, row.platformLabel, form.strategy), environment: brokerEnvironment(row.account.broker_environment, t), strategy: form.strategy, execution: executionMode(form.executionMode, t), runtime: t(displayStatus(form.runtimeMode)) });
            if (!await confirmAction({ title: t("核对账户变更计划"), target: accountTitle(row.account, row.platformLabel, form.strategy), summary, consequence: t("将提交配置计划；不代表配置已应用、运行正常或已有成交。"), tone: "normal" }))
                return;
            if (!beginOnce(`switch:${row.id}`))
                return;
            switchLocks.current.hold(row.id);
            const result = await postJson<any>("/api/switch", body);
            if (result.actions_url)
                window.open(result.actions_url, "_blank", "noopener,noreferrer");
            setErrorMessage(copy("计划已提交；配置读回与运行状态需另行核对。本账户操作已锁定，完成读回前不能重复提交。"));
            void refresh();
        }
        catch (error) {
            setErrorMessage(copy(requestErrorKey(error)));
        }
        finally {
            finishOnce(`switch:${row.id}`, false);
        }
    };
    const resumeBinance = async (row: AccountRow) => {
        const digest = row.current?.binance_resume_target_sha256;
        if (!canResumeBinance(row.platform, row.account, row.current) || typeof digest !== "string")
            return;
        const key = `resume:${row.id}`;
        if (!await confirmAction({ title: t("确认恢复现有目标"), target: accountTitle(row.account, row.platformLabel, row.current?.strategy_profile), summary: t("策略：{strategy}；目标摘要：{digest}", { strategy: row.current?.strategy_profile || t("未读取"), digest }), consequence: t("请先核对现有对账记录。此操作不修改策略或资金参数。"), tone: "danger" }))
            return;
        if (!beginOnce(key))
            return;
        try {
            const result = await postJson<any>("/api/runtime-resume", { platform: "binance", target_name: row.account.target_name, runtime_target_sha256: digest, confirm: "RESUME_EXISTING" });
            if (result.actions_url)
                window.open(result.actions_url, "_blank", "noopener,noreferrer");
            setErrorMessage(copy("恢复请求已提交，结果需检查既有 workflow；此按钮已锁定避免重复提交。"));
            finishOnce(key, false);
        }
        catch (error) {
            setErrorMessage(copy("恢复请求结果未知；检查现有 workflow 后再决定后续操作。{detail}", {detail:error?copy(" · {error}",{error:copy(requestErrorKey(error))}):""}));
            finishOnce(key, false);
        }
    };
    const recordHumanDecision = async (kind: HumanDecisionKind, source: any, body: any, path: string, busyKey: string) => {
        const sessionEpoch = humanDecisions.current.epoch();
        const expected = await humanDecisionExpectation(kind, source, body);
        if (sessionEpoch !== humanDecisions.current.epoch()) return;
        if (!expected) { setErrorMessage(copy("复核状态未确认；刷新资料后再决定是否继续。")); return; }
        const op = humanDecisions.current.start(expected);
        if (!op) { decisionNotice(humanDecisions.current.entries()); return; }
        setBusy(prev => ({ ...prev, [busyKey]: true }));
        try {
            const result = await postJson<Record<string, any>>(path, { ...body,
                expected_material_sha256: expected.material_sha256,
                ...(expected.review_sha256 ? { expected_review_sha256: expected.review_sha256 } : {}) });
            if (!humanDecisions.current.current(op)) return;
            await humanDecisions.current.receive(op, result.decision_receipt);
        } catch (error) {
            if (error instanceof AccessError) { clearPrivateState(false); return; }
            // A failed or missing response cannot establish that the write did not commit.
        } finally {
            if (humanDecisions.current.current(op)) {
                setBusy(prev => ({ ...prev, [busyKey]: false }));
                await refresh();
                if (humanDecisions.current.current(op)) decisionNotice(humanDecisions.current.entries());
            }
        }
    };
    const decideOwner = async (candidate: Record<string, any>, decision: string) => {
        if (!model?.session.admin)
            return;
        const binding = ownerDecisionBinding({ ...candidate.candidate, candidate_evidence_sha256: candidate.candidate_evidence_sha256 }, decision);
        if (!binding)
            return;
        if (!await confirmAction({ title: t("记录所有者决定"), target: String(candidate.candidate?.candidate_id || t("候选")), summary: t("决定：{decision} · 证据：{digest}", { decision: decisionLabel(decision, t), digest: candidate.candidate_evidence_sha256 }), consequence: t("仅记录人工决定，不会直接启用策略。"), tone: "normal", confirmLabel: decision === "keep_parked" ? "确认不采用" : "确认采用" }))
            return;
        await recordHumanDecision("owner", candidate, binding, "/api/owner-decisions", `owner:${binding.candidate_id}`);
    };
    const confirmRecovery = async (entry: Record<string, any>, decision: "approve" | "reject" = "approve") => {
        if (!model?.session.admin)
            return;
        const binding = recoveryBinding(entry, decision);
        if (!binding)
            return;
        const recovery = entry.recovery || {};
        const plan = strategyDisplayName((model?.config.value?.strategyProfiles || []).find((profile: any) => profile?.profile === recovery.strategy_profile), language);
        const planText = plan === "未命名策略" ? t(plan) : plan;
        const recoveryOptions = model?.config.value?.accountOptions;
        const knownRecovery = knownAccountLabel(recoveryOptions, recovery.platform, recovery.target_name);
        const recoveryAccounts = recoveryOptions && typeof recovery.platform === "string" ? recoveryOptions[recovery.platform] : undefined;
        const recoveryMatches = Array.isArray(recoveryAccounts) ? recoveryAccounts.filter(account => account && (account.target_name === recovery.target_name || account.key === recovery.target_name)) : [];
        const accountLabel = knownRecovery && recoveryMatches.length === 1 ? accountTitle(recoveryMatches[0], String(recovery.platform || ""), recovery.strategy_profile) : "";
        const summary = t(decision === "reject" ? "不采用这份恢复方案，账户不会因此启用" : "采用这份恢复方案只留下核对记录，账户不会因此启用");
        if (!await confirmAction({ title: t(decision === "reject" ? "确认不采用这项方案？" : "确认采用这项方案？"), target: accountLabel ? `${accountLabel} · ${planText}` : planText, summary, consequence: summary, tone: "danger", confirmLabel: decision === "reject" ? "确认不采用" : "确认采用" }))
            return;
        await recordHumanDecision("recovery", entry, binding, "/api/reconciliation-recovery-confirmations", `recovery:${binding.recovery_id}`);
    };
    async function submitPromotion(decision: "accept" | "reject", ticket: any, appAccount: any) {
        if (!model?.session.admin || !ticket || busy.promotion) return;
        const mode = appAccount?.broker_environment;
        if (decision === "accept" && (!appAccount || !["live", "paper"].includes(mode) || (mode === "paper" && appAccount.platform !== "longbridge"))) return;
        const strategyName = strategyDisplayName((model?.config.value?.strategyProfiles || []).find((profile: any) => profile?.profile === ticket.strategy_profile), language);
        const accountName = appAccount?.label || (appAccount ? `${appAccount.platform}:${appAccount.key}` : "");
        const planName = strategyName === "未命名策略" ? t(strategyName) : strategyName;
        if (!await confirmAction({ title: t(decision === "accept" ? "确认采用这项方案？" : "确认不采用这项方案？"), target: accountName ? `${accountName} · ${planName}` : planName, summary: t(decision === "accept" ? "采用只记录你的意向，账户策略和交易权限保持不变。" : "本次只记录决定，不会提交订单或改变交易权限。"), consequence: t("本次只记录决定，不会提交订单或改变交易权限。"), tone: decision === "accept" ? "normal" : "danger", confirmLabel: decision === "accept" ? "确认采用" : "确认不采用" })) return;
        await recordHumanDecision("promotion", ticket, { ticket_id: ticket.ticket_id, decision,
            confirmation: decision === "accept" ? { target_platform: appAccount.platform, execution_mode: mode, risk_profile: promotionRisk } : null,
            ...(decision === "accept" ? { selected_account: { platform: appAccount.platform, key: appAccount.key } } : {}),
            expected_proposed_params: ticket.proposed_params || {}, expected_strategy_profile: ticket.strategy_profile, expected_domain: ticket.domain,
        }, "/api/research-promotion-decisions", "promotion");
    }
    async function decideDaily(item: DailyDecision, action: "adopt" | "reject") {
        if (item.kind === "promotion") {
            const ticket = (model?.promotions.value?.tickets || []).find((entry: any) => item.id === `promotion:${entry.ticket_id}`);
            if (!ticket) return;
            const choice = item.accountChoices.length === 1 ? item.accountChoices[0].id : promotionAccountId;
            const application = (model?.promotions.value?.applications || []).find((entry: any) => entry.ticket_id === ticket.ticket_id);
            const appAccount = (application?.application_preparation?.account_options || []).find((account: any) => `${account.platform}:${account.key}` === choice) || null;
            await submitPromotion(action === "adopt" ? "accept" : "reject", ticket, action === "adopt" ? appAccount : null);
            return;
        }
        if (item.kind === "owner_observation") {
            const entry = (model?.owners.value?.candidates || []).find((candidate: any) => item.id === `owner:${candidate?.candidate?.candidate_id}`);
            if (!entry) return;
            await decideOwner(entry, action === "adopt" ? "approve_limited_live_canary" : "keep_parked");
            return;
        }
        if (item.kind === "recovery") {
            const entry = (model?.recovery.value?.recoveries || []).find((candidate: any) => item.id === `recovery:${candidate?.recovery?.recovery_id}`);
            if (entry) await confirmRecovery(entry, action === "adopt" ? "approve" : "reject");
        }
    }
    async function applyPromotion(application: Record<string, any>, selectedAccountId: string) {
        if (!model?.session.admin) return;
        if (!paperApplicationReady(application, selectedAccountId)) return;
        const selected = (application.application_preparation?.account_options || []).find((account: any) => `${account.platform}:${account.key}` === selectedAccountId);
        if (!selected) return;
        if (!await confirmAction({ title: t("提交模拟账户应用请求"), target: accountTitle(selected, String(selected.platform || ""), selected.default_strategy_profile), summary: t("候选：{ticket} · 预检：{status}", { ticket: application.ticket_id, status: t(displayStatus(application.application_preparation?.preflight_status)) }), consequence: t("只提交模拟账户应用请求，不会自动启用策略或提交订单。"), tone: "normal", confirmLabel: "确认采用" })) return;
        const key = `apply:${application.ticket_id}`;
        if (!beginOnce(key)) return;
        let submitted = false;
        try {
            const instance = await getJson<any>("/api/admin/runtime-instances");
            submitted = true;
            await postJson("/api/research-promotion-applications", { ticket_id: application.ticket_id, selected_account: { platform: selected.platform, key: selected.key }, expected_revision: Number(instance.revision) });
            void refresh();
            setErrorMessage(copy("应用请求已提交；请核对读回状态后再继续。"));
        } catch (error) {
            setErrorMessage(copy("应用请求结果需要读回确认，避免重复提交。{detail}", { detail: error ? copy(" · {error}", { error: copy(requestErrorKey(error)) }) : "" }));
            if (submitted) void refresh();
        } finally {
            finishOnce(key, !submitted);
        }
    }
    const profileOptions = model?.config.value?.strategyProfiles || [];
    const namedStrategy = (profileId: unknown) => {
        const found = profileOptions.find((profile: any) => profile?.profile === profileId);
        return strategySelectionName(found || { profile: profileId }, profileOptions, language);
    };
    const strategyFields = (row: AccountRow) => {
        const overlay = observedStrategy?.id === row.id ? observedStrategy : null;
        const profileId = overlay ? overlay.profile : row.current?.strategy_profile;
        const profile = profileOptions.find((item: any) => item?.profile === profileId);
        return {
            strategy: overlay && !overlay.profile ? t("未知") : namedStrategy(profileId),
            note: overlay && !overlay.profile ? "" : strategyNote(profile, language),
        };
    };
    const overviewAccounts: OverviewAccount[] = rows.map(row => {
        const status = accountStatusView(row.runtime?.account_state, row.runtime?.freshness?.data_status);
        const preference = row.current?.risk_preference;
        return {
            id: row.id,
            platformKey: row.platform,
            accountKey: row.account.key,
            runtimeDailyBinding: runtimeDailySelectionBinding(model?.config.value?.accountOptions, row.platform, row.account.key, model?.config.value?.runtimeDailyBindings),
            runtimeDailyTarget: resolveRuntimeDailyTarget({
                platform: row.platform,
                accountKey: row.account.key,
                accountOptions: model?.config.value?.accountOptions,
                trustedBindings: model?.config.value?.runtimeDailyBindings,
            }),
            title: accountTitle(row.account, row.platformLabel, row.current?.strategy_profile),
            platform: row.platformLabel,
            environment: brokerEnvironment(row.account.broker_environment, t),
            brokerEnvironment: typeof row.account.broker_environment === "string" ? row.account.broker_environment : null,
            environmentSource: accountEnvironmentSourceDetail(row.account.broker_environment),
            strategy: strategyFields(row).strategy,
            statusLabel: overviewRuntimeStatusLabel(row.runtime?.account_state, row.runtime?.freshness?.data_status),
            statusDetail: row.runtimeDetail || status.detail,
            activation: overviewActivationLabelFromProjection(row.runtime?.account_state),
            runtimeTargetEnabled: typeof row.current?.runtime_target_enabled === "boolean"
                ? row.current.runtime_target_enabled : null,
            preference: typeof preference === "string" ? preference : null,
            facts: accountFactsForRow(model?.accountFacts.value, row.platform, row.account.key),
            runtime: row.runtime,
        };
    });
    const accountItems: AccountListItem[] = rows.map(row => {
        const fields = strategyFields(row);
        const monitoring = accountStatusView(row.runtime?.account_state, row.runtime?.freshness?.data_status);
        return {
            id: row.id,
            platform: row.platform,
            key: row.account.key,
            title: accountTitle(row.account, row.platformLabel, row.current?.strategy_profile),
            platformLabel: row.platformLabel,
            environment: brokerEnvironment(row.account.broker_environment, t),
            facts: model?.accountFacts.error ? null : accountFactsForRow(model?.accountFacts.value, row.platform, row.account.key),
            binanceReport: row.platform === "binance" && !model?.binanceFacts.error ? model?.binanceFacts.value?.report : null,
            strategy: fields.strategy,
            strategyNote: fields.note,
            statusLabel: monitoring.label,
            activation: overviewActivationLabelFromProjection(row.runtime?.account_state),
        };
    });
    const decisions = listDailyDecisions({
        language,
        profiles: profileOptions,
        promotions: model?.promotions,
        owners: model?.owners,
        recovery: model?.recovery,
        decisionStates: humanDecisions.current.entries(),
        accountsFor: (ticket) => {
            const application = (model?.promotions.value?.applications || []).find((item: any) => item.ticket_id === ticket?.ticket_id);
            const choices = (application?.application_preparation?.account_options || []).filter((account: any) => account?.broker_environment === "live" || (account?.broker_environment === "paper" && account?.platform === "longbridge")).map((account: any) => {
                const platform = String(account.platform || "");
                const platformLabel = String(model?.config.value?.platformMeta?.[platform]?.label || platform);
                return {
                    platform,
                    key: String(account.key || ""),
                    label: accountTitle(account, platformLabel, account.default_strategy_profile || ticket?.strategy_profile),
                };
            });
            return choices.map((choice: { platform: string; key: string; label: string }) => ({ ...choice, label: choices.filter((item: { label: string }) => item.label === choice.label).length > 1 ? `${choice.label} · ${choice.platform}` : choice.label }));
        },
    });
    const requestPage = async (next: Page, accountId?: string) => {
        const changingAccount = Boolean(accountId && accountId !== selectedId);
        const leavingSettings = page === "accounts" && next !== "accounts";
        if ((changingAccount || leavingSettings) && !await discardUnsaved()) return;
        setPageAndRoute(next, accountId);
    };
    const selectedAccount = accountItems.find(item => item.id === selectedId) || accountItems[0] || null;
    const selectedRow = rows.find(row => row.id === selectedAccount?.id) || null;
    const hkStop = Boolean(selectedRow && selectedRow.platform === "longbridge" && (selectedRow.account.target_name || selectedRow.account.key) === "hk");
    const stopAllowed = Boolean(selectedRow && model?.session.allowed && !switchLocks.current.blocked(selectedRow.id) && !busy[`stop:${selectedRow.id}`] && (!hkStop || hkStopSubmitAllowed(stopRecords[selectedRow.id])));
    const stopLabel = !selectedRow ? "停用" : busy[`stop:${selectedRow.id}`] ? "正在提交…" : hkStop && stopRecords[selectedRow.id]?.phase === "stopped" ? "这次停用已确认" : hkStop && !hkStopSubmitAllowed(stopRecords[selectedRow.id]) ? "停用结果未知，不能再次提交" : "停用";
    const renderOverview = () => <OverviewPage accounts={overviewAccounts} accountFacts={model?.accountFacts.value || null} accountOptionsRevision={model?.config.value?.accountOptionsRevision} binanceFacts={model?.binanceFacts || null} isAdmin={model?.session.admin === true} privateScope={model?.privateScope || null} readModelRefreshVersion={overviewReadModelRefreshVersion} onOpenAccount={id => void requestPage("accounts", id)} />;
    const renderStrategy = () => {
        const applications = model?.promotions.value?.applications || [];
        const queue = applications.filter((item: any) => {
            const options = item?.application_preparation?.account_options || [];
            const humanDecision = options.some((account: any) => account?.broker_environment === "paper" || account?.broker_environment === "live");
            return humanDecision && (paperApplicationActionable(item) || paperApplicationUnresolved(item));
        });
        const pendingApplications = queue.filter((item: any) => paperApplicationActionable(item)).length;
        const unresolvedApplications = queue.filter((item: any) => paperApplicationUnresolved(item)).length;
        const applicationsOpen = applicationFold === null ? pendingApplications + unresolvedApplications > 0 : applicationFold;
        return <>
            {(pendingApplications > 0 || unresolvedApplications > 0) && <details className="decision-fold" open={applicationsOpen} onToggle={event => setApplicationFold(event.currentTarget.open)}><summary>{t("模拟账户应用 · {pending} 待处理 · {unresolved} 未决", { pending: pendingApplications, unresolved: unresolvedApplications })}</summary>
                {queue.map((application: any) => <ApplicationCard key={String(application.ticket_id)} application={application} profiles={profileOptions} language={language} busy={Boolean(busy[`apply:${application.ticket_id}`])} onDeploy={accountId => void applyPromotion(application, accountId)} />)}
            </details>}
            <DecisionsPage blocked={decisions.blocked} sources={decisions.sources} items={humanDecisionQueue(decisions.items)} admin={Boolean(model?.session.admin)} busy={Boolean(busy.promotion) || onceLocks.current.hasAnyWithPrefixes(["owner:", "recovery:"])} selectedAccountId={promotionAccountId} onSelectAccount={setPromotionAccountId} onDecide={(item, action) => void decideDaily(item, action)} />
        </>;
    };
    const onSettingsRead = useCallback((id: string, profile: string | null) => {
        setObservedStrategy(current => current?.id === id && current.profile === profile ? current : { id, profile });
    }, []);
    const resolveStrategy = useCallback((profileId: string | null) => {
        const profiles = model?.config.value?.strategyProfiles || [];
        const profile = profiles.find((item: any) => item?.profile === profileId);
        const name = profileId ? strategySelectionName(profile || { profile: profileId }, profiles, language) : t("未知");
        return { name, note: strategyNote(profile, language), identity: strategyIdentityView({ profile, profileId, basis: "策略目录" }) };
    }, [language, model?.config.value?.strategyProfiles]);
    const renderAccounts = () => <AccountsPage unresolvedSaves={unresolvedSettingsSaves.current} rows={accountItems} selectedId={selectedAccount?.id || ""} detailOpen={accountDetailOpen} settingsEpoch={settingsEpoch} refreshToken={settingsRefresh} stopAllowed={stopAllowed} stopLabel={stopLabel} stopRefreshVisible={hkStop} resumeVisible={Boolean(selectedRow && canResumeBinance(selectedRow.platform, selectedRow.account, selectedRow.current) && !busy[`resume:${selectedRow.id}`] && !onceLocks.current.isLocked(`resume:${selectedRow.id}`))} onSelect={id => void requestPage("accounts", id)} onBack={() => void (async () => { if (!await discardUnsaved()) return; setAccountDetailOpen(false); })()} onDirty={dirty => { settingsDirty.current = dirty; }} onStop={() => { if (selectedRow) void submitAccountPlan(selectedRow, true); }} onRefreshStop={() => { if (selectedRow) void refreshStopRecord(selectedRow); }} onResume={() => { if (selectedRow) void resumeBinance(selectedRow); }} onSettingsRead={onSettingsRead} resolveStrategy={resolveStrategy} />;
    if (bootState === "loading" && !model)
        return <LocaleContext.Provider value={language}><main className="boot-screen" aria-live="polite">{t("\u6B63\u5728\u8BFB\u53D6\u540C\u6E90\u914D\u7F6E\u3001\u8FD0\u884C\u72B6\u6001\u4E0E\u7814\u7A76\u8D44\u6599\u2026")}</main></LocaleContext.Provider>;
    if (bootState === "denied")
        return <LocaleContext.Provider value={language}><main className="access-screen"><QslIcon /><h1>QuantStrategyLab</h1><p>{t("登录后可查看账户总览、待办决策与账户设置。")}</p><a className="button button-primary" href="/login">{t("登录")}</a></main></LocaleContext.Provider>;
    if (bootState === "error" && !model)
        return <LocaleContext.Provider value={language}><main className="access-screen"><QslIcon /><h1>{t("\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u63A7\u5236\u53F0")}</h1><p>{t("\u540C\u6E90\u4F1A\u8BDD\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\u3002")}</p><button className="button button-primary" onClick={() => void refresh()} type="button">{t("\u91CD\u8BD5")}</button></main></LocaleContext.Provider>;
    return <LocaleContext.Provider value={language}><><div className="app-shell" inert={Boolean(confirmDialog)}>
    <header className="topbar"><button className="brand" type="button" onClick={() => void requestPage("overview")} aria-label={t("账户总览")}><QslIcon /><span><strong>QSL</strong><em>QuantStrategyLab</em></span>{model?.session.synthetic && <span className="synthetic-badge">{t("合成演示")}</span>}</button>
      <nav className="primary-nav" aria-label={t("主导航")}>{NAV.map(item => <button key={item.id} className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined} onClick={() => void requestPage(item.id)} type="button"><span className="nav-label">{t(item.label)}</span>{item.id === "strategy" && <DecisionCount count={humanDecisionQueue(decisions.items).length} />}</button>)}</nav>
      <div className="top-controls"><button className="theme-button" type="button" aria-label={t(resolvedTheme === "dark" ? "切换到浅色" : "切换到深色")} title={t(resolvedTheme === "dark" ? "切换到浅色" : "切换到深色")} onClick={() => setTheme(nextExplicitTheme(resolvedTheme))}>{resolvedTheme === "dark" ? "☾" : "☀"}</button><label className="language-control"><span className="sr-only">{t("语言")}</span><select aria-label={t("语言")} value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="zh">{t("中文")}</option><option value="en">English</option></select></label><details className="user-menu" ref={userMenuRef}><summary aria-label={t("用户")}>{(model?.session.login || "U").slice(0, 1).toUpperCase()}</summary><div className="user-menu-panel"><strong className="user-menu-name">{model?.session.login || t("已登录")}</strong><button type="button" onClick={() => void logout()}>{t("退出")}</button></div></details></div>
    </header>
    {errorMessage && <div className="global-notice" role="status"><span>{renderLocaleMessage(errorMessage,language)}</span><button type="button" onClick={() => setErrorMessage(null)} aria-label={t("\u5173\u95ED\u63D0\u793A")}>{t("\u5173\u95ED")}</button></div>}
    <main className="main-content" key={page}>{page === "overview" ? renderOverview() : page === "strategy" ? renderStrategy() : renderAccounts()}</main>
  </div>{confirmDialog && <ConfirmationDialog dialog={confirmDialog} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)}/>}</></LocaleContext.Provider>;
}
function ConfirmationDialog({ dialog, onCancel, onConfirm }: {
    dialog: ConfirmDialogState;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const t = useT();
    const dialogRef = useRef<HTMLDivElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    useEffect(() => { cancelRef.current?.focus(); }, []);
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
        }
        if (event.key !== "Tab")
            return;
        const items = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
        if (!items?.length)
            return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };
    return <div className="confirm-backdrop" onMouseDown={event => {
            if (event.target === event.currentTarget)
                onCancel();
        }}>
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" ref={dialogRef} onKeyDown={onKeyDown}>
      <div className="confirm-kicker">{t("\u8BF7\u6838\u5BF9\u540E\u7EE7\u7EED")}</div><h2 id="confirm-title">{dialog.title}</h2>
      <p className="confirm-target">{dialog.target}</p><p id="confirm-description" className="confirm-summary">{dialog.summary}</p>
      {dialog.consequence !== dialog.summary && <p className={`confirm-consequence ${dialog.tone}`}>{dialog.consequence}</p>}
      <div className="confirm-actions"><button ref={cancelRef} className="button button-secondary" type="button" onClick={onCancel}>{t("\u53D6\u6D88")}</button><button className={`button ${dialog.tone === "danger" ? "button-danger" : "button-primary"}`} type="button" onClick={onConfirm}>{t(dialog.confirmLabel || "\u786E\u8BA4\u7EE7\u7EED")}</button></div>
    </div>
  </div>;
}

function ApplicationCard({ application, profiles, language, busy, onDeploy }: {
    application: Record<string, any>;
    profiles: object[];
    language: Language;
    busy?: boolean;
    onDeploy: (accountId: string) => void;
}) {
    const t = useT();
    const prep = application.application_preparation || {};
    const previous = application.application || null;
    const profileId = previous ? previous.strategy_profile : application.strategy_profile;
    const candidateId = previous ? previous.candidate_id : application.proposed_params?.candidate_id;
    const profile = profiles.find((item: any) => item?.profile === profileId);
    const strategyName = profile ? strategySelectionName(profile, profiles, language) : candidateDisplayName(candidateId, language);
    const identity = strategyIdentityView({ profileId, basis: previous ? "应用记录" : "研究票据", record: previous ? {
        candidateId: previous.candidate_id, configHash: previous.config_sha256,
        sourceRevision: previous.readback?.ues_revision,
    } : { candidateId: application.proposed_params?.candidate_id, configHash: application.proposed_params?.config_sha256 } });
    const retryAllowed = applicationRetryAllowed(previous);
    const accounts = paperApplicationAccounts(application);
    const [selectedAccountId, setSelectedAccountId] = useState("");
    const selected = accounts.some(account => account.id === selectedAccountId) ? selectedAccountId : (accounts.length === 1 ? accounts[0].id : "");
    const ready = paperApplicationReady({ ...application, application: previous }, selected);
    const status = previous ? `${t(displayStatus(previous.status))} · ${t(displayStatus(previous.dispatch_state))}` : t("尚无应用记录");
    return <article className="application-card"><strong>{strategyName}</strong>
        <p>{t("模拟账户应用 · {ticket}", { ticket: application.ticket_id })}</p>
        <StrategyIdentity value={identity} />
        <p>{t("预检：{preflight} · 应用：{status}", { preflight: t(displayStatus(prep.preflight_status)), status })}</p>
        {prep.blocker_codes?.length > 0 && <p>{t("{count} 项需核对", { count: prep.blocker_codes.length })}</p>}
        <label className="application-account">{t("目标账户")}<select value={selected} onChange={event => setSelectedAccountId(event.target.value)}>
            <option value="">{t("请明确选择 LongBridge 模拟账户")}</option>
            {accounts.map(account => <option key={account.id} value={account.id}>{t("{account} · 券商模拟环境", { account: account.label })}</option>)}
        </select></label>
        <button className="button button-secondary" type="button" disabled={busy || !ready} onClick={() => onDeploy(selected)}>{busy ? t("正在提交…") : retryAllowed ? previous ? t("重试已明确拒绝的请求") : t("提交模拟账户应用请求") : t("已有请求，等待读回确认")}</button>
        <p className="section-note">{t(retryAllowed ? "仅对明确选择且通过现有预检的 LongBridge 模拟账户开放；应用、启用与下单权限相互独立。" : "服务端已有应用记录；仅明确拒绝后允许重新提交，状态未知或处理中时保持锁定。")}</p>
    </article>;
}
export default App;
