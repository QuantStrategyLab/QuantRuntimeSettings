import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { AccountOption, AdminModel, ConfigPayload, ReadModel, Session, UxDraft } from "./api";
import { AccessError, getJson, invalidatePrivateSession, loadAdminModel, loadReadModel, postJson, runtimeStopQuery } from "./api";
import { createRequestGate } from "./requestGate.js";
import { normalizeThemePreference, resolveTheme, THEME_STORAGE_KEY } from "./theme.js";
import { applicationRetryAllowed, beginNonHkStop, buildConfirmationFingerprint, buildSwitchInputs, canResumeBinance, confirmationAccepted, createRequestLock, createUnknownSubmitLock, defaultSwitchDraft, createHkStopController, hkStopSubmitAllowed, ownerDecisionBinding, pageFromWorkspace, recoveryBinding, type SwitchDraft } from "./operations";
import { PLATFORM_CONFIG } from "../../config.js";
import { LocaleContext, renderLocaleMessage, translate, useT, type Language, type LocaleMessage } from "./locales";
import { AccountsPage, type AccountListItem } from "./AccountsPage";
import { DecisionsPage } from "./DecisionsPage";
import { OverviewPage, type OverviewAccount } from "./OverviewPage";
import { accountDisplayTitle, accountStatusView, activationFromProjection, knownAccountLabel, listDailyDecisions, paperApplicationAccounts, paperApplicationReady, strategyDisplayName, strategyNote, type DailyDecision } from "./presentation";
type Page = "overview" | "strategy" | "accounts";
type Theme = "light" | "dark" | "system";
type AccountRow = {
    id: string;
    platform: string;
    platformLabel: string;
    account: AccountOption;
    current: Record<string, any> | null;
    runtime: Record<string, any> | null;
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
const RISK_PROFILES = ["CAPITAL_PRESERVATION", "BALANCED_COMPOUNDING", "GROWTH_COMPOUNDING"];
const platformSettings = PLATFORM_CONFIG as Record<string, any>;
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
    const labels: Record<string, string> = { observed: "已收到心跳", healthy: "运行状态可供核对", live: "执行（live）", ready: "可供核对", stale: "资料已过期", unavailable: "暂不可用", unknown: "结果待确认", active: "运行中", paused: "已暂停", disabled: "已停用", enabled: "已启用", monitoring_only: "仅监测", not_due: "等待检查周期", attention: "需要核对", failed: "未完成", succeeded: "已完成", queued: "排队中", running: "处理中", approved: "请求已批准", rejected: "已明确拒绝", claimed: "已领取处理中", pending: "等待提交", sent: "已提交", fixed: "固定金额", current: "保持现状", none: "不启用", auto: "自动选择", smart: "智能定投", ratio: "比例", floor: "固定金额下限", max: "金额与比例取较大值", paper: "模拟账户环境", dry_run: "禁止下单验证", ready_to_apply: "可供核对" };
    const label = labels[String(value || "")];
    return label || "状态未知";
}
function decisionLabel(value: unknown, t: (key: string) => string): string {
    const labels: Record<string, string> = { approve_limited_live_canary: "有限执行观察", keep_parked: "保持暂停", retire_candidate: "退役候选", accepted: "已接受", rejected: "已明确拒绝", keep: "保持现状" };
    return labels[String(value || "")] ? t(labels[String(value)]) : t("状态未知");
}
function brokerEnvironment(value: unknown, t: (key: string) => string): string {
    return value === "paper" ? t("模拟账户环境") : value === "live" ? t("真实账户环境") : t("状态未知");
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
            rows.push({ id: `${platform}:${account.key}`, platform, platformLabel: meta.label || platform, account, current: currentFor(config, platform, account), runtime: unique ? hits[0] : null });
        }
    }
    return rows;
}
function Empty({ title, detail }: { title: string; detail: string }) {
    return <div className="empty-state"><strong>{title}</strong><p>{detail}</p></div>;
}
function QslIcon({ className = "brand-mark" }: {
    className?: string;
}) { return <img className={className} src="/v2/assets/qsl-brand-icon.png" alt="" aria-hidden="true"/>; }
function App() {
    const initialPage = new URLSearchParams(window.location.search).get("workspace");
    const [page, setPage] = useState<Page>(pageFromWorkspace(initialPage));
    const [adminPath, setAdminPath] = useState(window.location.pathname === "/admin");
    const [theme, setTheme] = useState<Theme>(() => normalizeThemePreference(safeGet(THEME_STORAGE_KEY)));
    const [language, setLanguage] = useState<Language>(initialLanguage);
    const t = (key: string, values: Record<string, string | number> = {}) => translate(key, language, values);
    const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
    const [model, setModel] = useState<ReadModel | null>(null);
    const [adminModel, setAdminModel] = useState<AdminModel | null>(null);
    const [bootState, setBootState] = useState<"loading" | "ready" | "denied" | "error">("loading");
    const [, setRefreshing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<LocaleMessage | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("account") || "");
    const [accountDetailOpen, setAccountDetailOpen] = useState(() => Boolean(new URLSearchParams(window.location.search).get("account")));
    const settingsDirty = useRef(false);
    const [settingsEpoch, setSettingsEpoch] = useState(0);
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
    const [adminRisk, setAdminRisk] = useState<Record<string, string>>({});
    const [adminText, setAdminText] = useState<Record<string, string>>({});
    const [instanceDraft, setInstanceDraft] = useState<Record<string, any>>({});
    const [editingInstance, setEditingInstance] = useState<string | null>(null);
    const gate = useRef(createRequestGate());
    const hkStops = useRef(new Map<string, ReturnType<typeof createHkStopController>>());
    const switchLocks = useRef(createUnknownSubmitLock());
    const onceLocks = useRef(createRequestLock());
    const uxEditEpoch = useRef(0);
    const confirmResolver = useRef<((confirmed: boolean) => void) | null>(null);
    const confirmReturnFocus = useRef<HTMLElement | null>(null);
    const confirmationFingerprint = () => buildConfirmationFingerprint({ session: model?.session, selectedId, selectedAccount: active?.account, currentStrategy: active?.current, runtimeAt: model?.runtime.value?.computed_at, controlAt: model?.control.value?.computed_at, ownerCandidates: model?.owners.value?.candidates, recoveries: model?.recovery.value?.recoveries, promotionTickets: model?.promotions.value?.tickets, promotionApplications: model?.promotions.value?.applications, switchDrafts, uxDraft: { revision: uxDraft.revision, draft: uxDraft.draft, fingerprint: uxDraft.fingerprint, job: uxDraft.job?.status }, uxDirty, promotionTicketId, promotionAccountId, promotionRisk, adminRevision: adminModel?.instances.value?.revision, adminRisk, adminText, instanceDraft, editingInstance });
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
    const resolvedTheme = resolveTheme(theme, systemDark);
    const clearPrivateState = (invalidate = true) => {
        resolveConfirmation(false);
        if (invalidate)
            invalidatePrivateSession();
        gate.current.invalidate();
        switchLocks.current.clear();
        onceLocks.current.clear();
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
        setAdminRisk({});
        setAdminText({});
        setInstanceDraft({});
        setEditingInstance(null);
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
    }, [confirmDialog, model, adminModel, selectedId, switchDrafts, uxDraft, uxDirty, diagnosis, promotionTicketId, promotionAccountId, promotionRisk, adminRisk, adminText, instanceDraft, editingInstance]);
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
            setBootState("ready");
            if (!selectedId && next.config.value?.accountOptions) {
                const first = Object.entries(next.config.value.accountOptions).flatMap(([p, list]) => list.map(a => `${p}:${a.key}`))[0];
                if (first)
                    setSelectedId(first);
            }
            if (!uxDirty && next.research.value)
                setUxDraft(next.research.value);
            if (adminPath && next.session.admin) {
                const admin = await loadAdminModel();
                if (!gate.current.isCurrent(token))
                    return;
                setAdminModel(admin);
                const cfg = admin.config.value || {};
                setAdminText(prev => Object.keys(prev).length ? prev : {
                    allowed_logins: (cfg.authConfig?.allowed_logins || []).join("\n"), allowed_orgs: (cfg.authConfig?.allowed_orgs || []).join("\n"),
                    admin_logins: (cfg.authConfig?.admin_logins || []).join("\n"), admin_orgs: (cfg.authConfig?.admin_orgs || []).join("\n"),
                    account_options: JSON.stringify(cfg.accountOptions || {}, null, 2),
                });
                const bindings = admin.risk.value?.bindings || [];
                setAdminRisk(prev => Object.keys(prev).length ? prev : Object.fromEntries(bindings.map((entry: any) => [`${entry.platform}:${entry.target_name}`, entry.profile_selection?.risk_preference || ""])));
            }
            else if (!next.session.admin) {
                setAdminModel(null);
                if (adminPath)
                    setBootState("denied");
            }
        }
        catch (error) {
            if (!gate.current.isCurrent(token))
                return;
            if (error instanceof AccessError) {
                clearPrivateState(false);
            }
            else {
                setErrorMessage(copy(requestErrorKey(error)));
                if (!model)
                    setBootState("error");
            }
        }
        finally {
            if (gate.current.isCurrent(token))
                setRefreshing(false);
        }
    }, [adminPath, model, selectedId, uxDirty]);
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
    useEffect(() => { safeSet("qsl-switch-lang", language); document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; document.title = adminPath ? `${t("管理设置")} · QuantStrategyLab` : `${t(NAV.find(item => item.id === page)?.label || "资产总览")} · QuantStrategyLab`; }, [language, page, adminPath]);
    useEffect(() => {
        if (adminPath && model?.session.admin)
            void refresh();
    }, [adminPath]);
    useEffect(() => {
        if (!model?.session.allowed || page !== "strategy")
            return;
        const status = uxDraft.job?.status;
        if (!["queued", "running", "unknown"].includes(String(status || "")))
            return;
        let alive = true;
        const timer = window.setInterval(async () => {
            try {
                const next = await getJson<UxDraft>("/api/ux1/draft");
                if (alive && !uxDirty)
                    setUxDraft(next);
            }
            catch (error) {
                if (error instanceof AccessError)
                    clearPrivateState(false);
            }
        }, 3000);
        return () => { alive = false; window.clearInterval(timer); };
    }, [model?.session.allowed, page, uxDraft.job?.status, uxDirty]);
    useEffect(() => {
        if (!model?.session.allowed || !active?.account.key)
            return;
        let alive = true;
        setDiagnosis(prev => ({ ...prev, [active.id]: { ...prev[active.id], loading: true } }));
        getJson<any>(`/api/account-diagnosis?platform=${encodeURIComponent(active.platform)}&key=${encodeURIComponent(active.account.key)}`)
            .then(result => {
            if (alive)
                setDiagnosis(prev => ({ ...prev, [active.id]: { available: true, loading: false, task: result.task || null } }));
        })
            .catch(error => {
            if (error instanceof AccessError)
                clearPrivateState(false);
            else if (alive)
                setDiagnosis(prev => ({ ...prev, [active.id]: { available: false, loading: false, task: null } }));
        });
        return () => { alive = false; };
    }, [model?.session.allowed, active?.id]);
    useEffect(() => {
        const current = active ? diagnosis[active.id] : null;
        const task = current?.task;
        if (!model?.session.allowed || page !== "accounts" || !active || current?.available !== true
            || !["queued", "running"].includes(String(task?.status || "")) && task?.recheck_status !== "sent")
            return;
        let alive = true;
        let attempts = 0;
        const timer = window.setInterval(async () => {
            if (document.visibilityState === "hidden" || attempts >= 5) {
                window.clearInterval(timer);
                return;
            }
            attempts += 1;
            try {
                const result = await getJson<any>(`/api/account-diagnosis?platform=${encodeURIComponent(active.platform)}&key=${encodeURIComponent(active.account.key)}`);
                if (alive)
                    setDiagnosis(prev => ({ ...prev, [active.id]: { available: true, loading: false, task: result.task || null } }));
            }
            catch (error) {
                if (error instanceof AccessError)
                    clearPrivateState(false);
                else if (alive)
                    setDiagnosis(prev => ({ ...prev, [active.id]: { ...prev[active.id], available: false, loading: false } }));
                window.clearInterval(timer);
            }
        }, 3000);
        return () => { alive = false; window.clearInterval(timer); };
    }, [model?.session.allowed, page, active?.id, diagnosis[active?.id || ""]?.task?.status, diagnosis[active?.id || ""]?.task?.recheck_status, diagnosis[active?.id || ""]?.available]);
    const setPageAndRoute = (next: Page, accountId?: string) => {
        setAdminPath(false);
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
        const accepted = await confirmAction({ title: t("放弃未保存的风险偏好？"), target: active?.account.label || t("账户"), summary: t("未保存的风险偏好会丢弃。"), consequence: t("未保存的风险偏好会丢弃。"), tone: "normal" });
        if (!accepted) return false;
        settingsDirty.current = false;
        setSettingsEpoch(value => value + 1);
        return true;
    };
    discardRef.current = discardUnsaved;
    const applyLocation = () => {
        setAdminPath(window.location.pathname === "/admin");
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
    const enterAdmin = () => { void (async () => { if (!await discardRef.current()) return; setAdminPath(true); window.history.pushState({ admin: true }, "", "/admin"); routeGuard.current.url = "/admin"; })(); };
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
            if (!await confirmAction({ title: t("确认停用运行目标"), target: `${row.platformLabel} / ${row.account.label || row.account.key} · ${row.account.target_name || row.account.key}`, summary: t("当前策略：{strategy}", { strategy: row.current?.strategy_profile || form.strategy || t("未读取") }), consequence: t("停用只阻止新的触发，不会撤单、平仓或清除在途请求。"), tone: "danger" }))
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
                    if (phase === "rejected")
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
            setErrorMessage(copy("账户计划提交暂未接通；当前可以查看设置，停用入口仍按原确认流程执行。"));
            return;
        }
        try {
            const body = buildSwitchInputs(row.platform, row.account, form);
            const summary = t("账户：{account}\n券商环境：{environment}\n策略：{strategy}\n执行方式：{execution}\n启停：{runtime}\n提交后仍需运行读回确认。", { account: `${row.platformLabel} / ${row.account.label || row.account.key}`, environment: brokerEnvironment(row.account.broker_environment, t), strategy: form.strategy, execution: executionMode(form.executionMode, t), runtime: t(displayStatus(form.runtimeMode)) });
            if (!await confirmAction({ title: t("核对账户变更计划"), target: `${row.platformLabel} / ${row.account.label || row.account.key}`, summary, consequence: t("将提交配置计划；不代表配置已应用、运行正常或已有成交。"), tone: "normal" }))
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
        if (!await confirmAction({ title: t("确认恢复现有目标"), target: `${row.platformLabel} / ${row.account.label || row.account.key} · ${row.account.target_name}`, summary: t("策略：{strategy}；目标摘要：{digest}", { strategy: row.current?.strategy_profile || t("未读取"), digest }), consequence: t("请先核对现有对账记录。此操作不修改策略或资金参数。"), tone: "danger" }))
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
    const decideOwner = async (candidate: Record<string, any>, decision: string) => {
        if (!model?.session.admin)
            return;
        const binding = ownerDecisionBinding({ ...candidate.candidate, candidate_evidence_sha256: candidate.candidate_evidence_sha256 }, decision);
        if (!binding)
            return;
        if (!await confirmAction({ title: t("记录所有者决定"), target: String(candidate.candidate?.candidate_id || t("候选")), summary: t("决定：{decision} · 证据：{digest}", { decision: decisionLabel(decision, t), digest: candidate.candidate_evidence_sha256 }), consequence: t("仅记录人工决定，不会直接启用策略。"), tone: "normal", confirmLabel: decision === "keep_parked" ? "确认不采用" : "确认采用" }))
            return;
        const key = `owner:${candidate.candidate?.candidate_id}`;
        if (!beginOnce(key))
            return;
        try {
            await postJson("/api/owner-decisions", binding);
            await refresh();
        }
        catch (error) {
            setErrorMessage(copy("所有者决定未确认：{error}",{error:copy(requestErrorKey(error))}));
        }
        finally {
            finishOnce(key);
        }
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
        const accountLabel = knownAccountLabel(model?.config.value?.accountOptions, recovery.platform, recovery.target_name);
        const summary = t(decision === "reject" ? "不采用这份恢复方案，账户不会因此启用" : "采用这份恢复方案只留下核对记录，账户不会因此启用");
        if (!await confirmAction({ title: t(decision === "reject" ? "确认不采用这项方案？" : "确认采用这项方案？"), target: accountLabel ? `${accountLabel} · ${planText}` : planText, summary, consequence: summary, tone: "danger", confirmLabel: decision === "reject" ? "确认不采用" : "确认采用" }))
            return;
        const key = `recovery:${binding.recovery_id}`;
        if (!beginOnce(key))
            return;
        try {
            await postJson("/api/reconciliation-recovery-confirmations", binding);
            await refresh();
        }
        catch (error) {
            setErrorMessage(copy("恢复确认未完成：{error}",{error:copy(requestErrorKey(error))}));
        }
        finally {
            finishOnce(key);
        }
    };
    async function submitPromotion(decision: "accept" | "reject", ticket: any, appAccount: any) {
        if (!model?.session.admin || !ticket || busy.promotion) return;
        const mode = appAccount?.broker_environment;
        if (decision === "accept" && (!appAccount || !["live", "paper"].includes(mode) || (mode === "paper" && appAccount.platform !== "longbridge"))) return;
        const strategyName = strategyDisplayName((model?.config.value?.strategyProfiles || []).find((profile: any) => profile?.profile === ticket.strategy_profile), language);
        const accountName = appAccount?.label || (appAccount ? `${appAccount.platform}:${appAccount.key}` : "");
        const planName = strategyName === "未命名策略" ? t(strategyName) : strategyName;
        if (!await confirmAction({ title: t(decision === "accept" ? "确认采用这项方案？" : "确认不采用这项方案？"), target: accountName ? `${accountName} · ${planName}` : planName, summary: t(decision === "accept" ? "采用只记录你的意向，账户策略和交易权限保持不变。" : "本次只记录决定，不会提交订单或改变交易权限。"), consequence: t("本次只记录决定，不会提交订单或改变交易权限。"), tone: decision === "accept" ? "normal" : "danger", confirmLabel: decision === "accept" ? "确认采用" : "确认不采用" })) return;
        setBusy(prev => ({ ...prev, promotion: true }));
        try {
            await postJson("/api/research-promotion-decisions", { ticket_id: ticket.ticket_id, decision, confirmation: decision === "accept" ? { target_platform: appAccount.platform, execution_mode: mode, risk_profile: promotionRisk } : null, ...(decision === "accept" ? { selected_account: { platform: appAccount.platform, key: appAccount.key } } : {}), expected_proposed_params: ticket.proposed_params || {}, expected_strategy_profile: ticket.strategy_profile, expected_domain: ticket.domain });
            void refresh();
        } catch (error) {
            setErrorMessage(copy("候选决定失败：{error}", { error: copy(requestErrorKey(error)) }));
        } finally {
            setBusy(prev => ({ ...prev, promotion: false }));
        }
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
        if (!await confirmAction({ title: t("提交模拟账户应用请求"), target: `${selected.label || selected.key} · ${selected.platform} ${selected.broker_environment}`, summary: t("候选：{ticket} · 预检：{status}", { ticket: application.ticket_id, status: t(displayStatus(application.application_preparation?.preflight_status)) }), consequence: t("只提交模拟账户应用请求，不会自动启用策略或提交订单。"), tone: "normal", confirmLabel: "确认采用" })) return;
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
        const name = strategyDisplayName(found, language);
        return name === "未命名策略" ? t(name) : name;
    };
    const overviewAccounts: OverviewAccount[] = rows.map(row => {
        const status = accountStatusView(row.runtime?.account_state);
        const preference = row.current?.risk_preference;
        return {
            id: row.id,
            title: accountDisplayTitle(row.account, row.platformLabel, brokerEnvironment(row.account.broker_environment, t)),
            strategy: namedStrategy(row.current?.strategy_profile),
            statusLabel: status.label,
            statusDetail: status.detail,
            activation: activationFromProjection(row.runtime?.account_state),
            preference: typeof preference === "string" ? preference : null,
        };
    });
    const accountItems: AccountListItem[] = rows.map(row => {
        const profile = profileOptions.find((item: any) => item?.profile === row.current?.strategy_profile);
        return {
            id: row.id,
            platform: row.platform,
            key: row.account.key,
            title: accountDisplayTitle(row.account, row.platformLabel, brokerEnvironment(row.account.broker_environment, t)),
            environment: brokerEnvironment(row.account.broker_environment, t),
            strategy: namedStrategy(row.current?.strategy_profile),
            strategyNote: strategyNote(profile, language),
            statusLabel: accountStatusView(row.runtime?.account_state).label,
            activation: activationFromProjection(row.runtime?.account_state),
        };
    });
    const decisions = listDailyDecisions({
        language,
        profiles: profileOptions,
        promotions: model?.promotions,
        owners: model?.owners,
        recovery: model?.recovery,
        accountsFor: (ticket) => {
            const application = (model?.promotions.value?.applications || []).find((item: any) => item.ticket_id === ticket?.ticket_id);
            return (application?.application_preparation?.account_options || []).filter((account: any) => account?.broker_environment === "live" || (account?.broker_environment === "paper" && account?.platform === "longbridge")).map((account: any) => ({
                platform: String(account.platform || ""),
                key: String(account.key || ""),
                label: accountDisplayTitle(account, String(account.platform || ""), brokerEnvironment(account.broker_environment, t)),
            }));
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
    const stopLabel = !selectedRow ? "提交停用请求" : busy[`stop:${selectedRow.id}`] ? "正在提交…" : hkStop && !hkStopSubmitAllowed(stopRecords[selectedRow.id]) ? "停用结果未知，不能再次提交" : "提交停用请求";
    const renderOverview = () => <OverviewPage accounts={overviewAccounts} decisions={decisions.items.length} decisionsBlocked={decisions.blocked} onOpenAccount={id => void requestPage("accounts", id)} onOpenDecisions={() => void requestPage("strategy")} />;
    const renderStrategy = () => <DecisionsPage blocked={decisions.blocked} items={decisions.items} admin={Boolean(model?.session.admin)} busy={Boolean(busy.promotion) || onceLocks.current.hasAnyWithPrefixes(["owner:", "recovery:"])} selectedAccountId={promotionAccountId} onSelectAccount={setPromotionAccountId} onDecide={(item, action) => void decideDaily(item, action)} />;
    const renderAccounts = () => <AccountsPage rows={accountItems} selectedId={selectedAccount?.id || ""} detailOpen={accountDetailOpen} admin={Boolean(model?.session.admin)} settingsEpoch={settingsEpoch} stopAllowed={stopAllowed} stopLabel={stopLabel} stopRefreshVisible={hkStop} resumeVisible={Boolean(selectedRow && canResumeBinance(selectedRow.platform, selectedRow.account, selectedRow.current) && !busy[`resume:${selectedRow.id}`] && !onceLocks.current.isLocked(`resume:${selectedRow.id}`))} onSelect={id => void requestPage("accounts", id)} onBack={() => void (async () => { if (!await discardUnsaved()) return; setAccountDetailOpen(false); })()} onDirty={dirty => { settingsDirty.current = dirty; }} onStop={() => { if (selectedRow) void submitAccountPlan(selectedRow, true); }} onRefreshStop={() => { if (selectedRow) void refreshStopRecord(selectedRow); }} onResume={() => { if (selectedRow) void resumeBinance(selectedRow); }} />;
    const renderAdmin = () => <AdminPanel model={adminModel} session={model?.session} applications={model?.promotions.value?.applications || []} onApply={(application, accountId) => void applyPromotion(application, accountId)} text={adminText} setText={setAdminText} risk={adminRisk} setRisk={setAdminRisk} instanceDraft={instanceDraft} setInstanceDraft={setInstanceDraft} editing={editingInstance} setEditing={setEditingInstance} busy={busy} setBusy={setBusy} onRefresh={() => void refresh()} onError={setErrorMessage} confirmAction={confirmAction} />;
    if (bootState === "loading" && !model)
        return <LocaleContext.Provider value={language}><main className="boot-screen" aria-live="polite">{t("\u6B63\u5728\u8BFB\u53D6\u540C\u6E90\u914D\u7F6E\u3001\u8FD0\u884C\u72B6\u6001\u4E0E\u7814\u7A76\u8D44\u6599\u2026")}</main></LocaleContext.Provider>;
    if (bootState === "denied")
        return <LocaleContext.Provider value={language}><main className="access-screen"><QslIcon /><h1>{t("\u9700\u8981\u91CD\u65B0\u9A8C\u8BC1\u8BBF\u95EE")}</h1><p>{t("\u767B\u5F55\u5DF2\u5931\u6548\u6216\u5F53\u524D\u8D26\u53F7\u65E0\u6743\u67E5\u770B\u6B64\u9875\u9762\u3002\u654F\u611F\u8D44\u6599\u5DF2\u6E05\u9664\u3002")}</p><a className="button button-primary" href="/login">{t("\u91CD\u65B0\u767B\u5F55")}</a></main></LocaleContext.Provider>;
    if (bootState === "error" && !model)
        return <LocaleContext.Provider value={language}><main className="access-screen"><QslIcon /><h1>{t("\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u63A7\u5236\u53F0")}</h1><p>{t("\u540C\u6E90\u4F1A\u8BDD\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\u3002")}</p><button className="button button-primary" onClick={() => void refresh()} type="button">{t("\u91CD\u8BD5")}</button></main></LocaleContext.Provider>;
    if (adminPath && !model?.session.admin)
        return <LocaleContext.Provider value={language}><main className="access-screen"><QslIcon /><h1>{t("\u4EC5\u9650\u7BA1\u7406\u5458")}</h1><p>{t("\u6B64\u8D26\u6237\u6CA1\u6709\u7BA1\u7406\u6743\u9650\u3002")}</p><button type="button" className="button button-primary" onClick={() => { setAdminPath(false); setPageAndRoute("overview"); }}>{t("\u8FD4\u56DE\u8D44\u4EA7\u603B\u89C8")}</button></main></LocaleContext.Provider>;
    return <LocaleContext.Provider value={language}><><div className="app-shell" inert={Boolean(confirmDialog)}>
    <header className="topbar"><button className="brand" type="button" onClick={() => void requestPage("overview")} aria-label={t("账户总览")}><QslIcon /><span><strong>QSL</strong><em>QuantStrategyLab</em></span>{model?.session.synthetic && <span className="synthetic-badge">{t("合成演示")}</span>}</button>
      <nav className="primary-nav" aria-label={t("主导航")}>{NAV.map(item => <button key={item.id} className={!adminPath && page === item.id ? "active" : ""} aria-current={!adminPath && page === item.id ? "page" : undefined} onClick={() => void requestPage(item.id)} type="button">{t(item.label)}</button>)}</nav>
      <div className="top-controls"><button className="theme-button" type="button" aria-label={t("主题")} onClick={() => setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light")}>{theme === "dark" ? "☾" : "☀"}</button><label className="language-control"><span className="sr-only">{t("语言")}</span><select aria-label={t("语言")} value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="zh">{t("中文")}</option><option value="en">English</option></select></label><details className="user-menu"><summary aria-label={t("用户")}>{(model?.session.login || "U").slice(0, 1).toUpperCase()}</summary><div><span>{model?.session.login || t("已登录")}</span>{model?.session.admin && <button type="button" className="admin-shortcut" onClick={enterAdmin}>{t("管理设置")}</button>}<button type="button" onClick={() => void logout()}>{t("退出")}</button></div></details></div>
    </header>
    {errorMessage && <div className="global-notice" role="status"><span>{renderLocaleMessage(errorMessage,language)}</span><button type="button" onClick={() => setErrorMessage(null)} aria-label={t("\u5173\u95ED\u63D0\u793A")}>{t("\u5173\u95ED")}</button></div>}
    <main className="main-content" key={adminPath ? "admin" : page}>{adminPath ? renderAdmin() : page === "overview" ? renderOverview() : page === "strategy" ? renderStrategy() : renderAccounts()}</main>
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

function ApplicationCard({ application, busy, onDeploy }: {
    application: Record<string, any>;
    busy?: boolean;
    onDeploy: (accountId: string) => void;
}) {
    const t = useT();
    const prep = application.application_preparation || {};
    const previous = application.application || null;
    const retryAllowed = applicationRetryAllowed(previous);
    const accounts = paperApplicationAccounts(application);
    const [selectedAccountId, setSelectedAccountId] = useState("");
    const selected = accounts.some(account => account.id === selectedAccountId) ? selectedAccountId : (accounts.length === 1 ? accounts[0].id : "");
    const ready = paperApplicationReady({ ...application, application: previous }, selected);
    const status = previous ? `${t(displayStatus(previous.status))} · ${t(displayStatus(previous.dispatch_state))}` : t("尚无应用记录");
    return <article className="application-card"><strong>{t("模拟账户应用 · {ticket}", { ticket: application.ticket_id })}</strong>
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
function AdminPanel({ model, session, applications = [], onApply, text, setText, risk, setRisk, instanceDraft, setInstanceDraft, editing, setEditing, busy, setBusy, onRefresh, onError, confirmAction }: {
    model: AdminModel | null;
    session?: Session;
    applications?: any[];
    onApply: (application: Record<string, any>, accountId: string) => void;
    text: Record<string, string>;
    setText: (value: Record<string, string> | ((previous: Record<string, string>) => Record<string, string>)) => void;
    risk: Record<string, string>;
    setRisk: (value: Record<string, string> | ((previous: Record<string, string>) => Record<string, string>)) => void;
    instanceDraft: Record<string, any>;
    setInstanceDraft: (value: Record<string, any> | ((previous: Record<string, any>) => Record<string, any>)) => void;
    editing: string | null;
    setEditing: (id: string | null) => void;
    busy: Busy;
    setBusy: (value: Busy | ((previous: Busy) => Busy)) => void;
    onRefresh: () => void;
    onError: (value: LocaleMessage) => void;
    confirmAction: (dialog: Omit<ConfirmDialogState, "fingerprint">) => Promise<boolean>;
}) {
    const t = useT();
    const cfg = model?.config.value || {};
    const instanceState = model?.instances.value || {};
    const riskState = model?.risk.value || {};
    const kvAvailable = Boolean(cfg.kvAvailable);
    const bound = Boolean(instanceState.instances || instanceState.initialized !== undefined);
    const strategies = cfg.runtimeInstanceStrategies || cfg.strategyProfiles || [];
    const fieldNames = ["label", "key", "target_name", "account_selector", "deployment_selector", "service_name", "account_scope", "github_environment"];
    const blankDraft = (): Record<string, any> => ({ platform: "longbridge", label: "", key: "", target_name: "", account_selector: "", deployment_selector: "", service_name: "", account_scope: "", github_environment: "", broker_environment: "", default_strategy_profile: strategies[0]?.profile || "", default_execution_mode: "dry_run" });
    const updateDraft = (patch: Record<string, any>) => setInstanceDraft(prev => ({ ...prev, ...patch }));
    const parseLines = (value: string) => value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
    const saveAdmin = async () => {
        if (!session?.admin || !kvAvailable || busy.adminConfig)
            return;
        let accountOptions: unknown;
        try {
            accountOptions = JSON.parse(text.account_options || "{}");
        }
        catch {
            onError(copy("账号配置 JSON 无效；输入内容已保留。"));
            return;
        }
        setBusy(prev => ({ ...prev, adminConfig: true }));
        try {
            await postJson("/api/admin/config", { allowed_logins: parseLines(text.allowed_logins || ""), allowed_orgs: parseLines(text.allowed_orgs || ""), admin_logins: parseLines(text.admin_logins || ""), admin_orgs: parseLines(text.admin_orgs || ""), account_options: accountOptions });
            onError(copy("管理配置已保存。当前管理员身份由服务端保护并保留。"));
            onRefresh();
        }
        catch (error) {
            onError(copy("管理配置保存失败；保留当前编辑。{detail}",{detail:error?copy(" · {error}",{error:copy(requestErrorKey(error))}):""}));
        }
        finally {
            setBusy(prev => ({ ...prev, adminConfig: false }));
        }
    };
    const saveRisk = async () => {
        if (!session?.admin || busy.riskSave)
            return;
        if (!Number.isSafeInteger(riskState.revision)) {
            onError(copy("没有可核对的风险偏好版本，未保存。"));
            return;
        }
        const bindings = Array.from(riskState.configured_targets || []).map((target: any) => ({ platform: target.platform, target_name: target.target_name, risk_preference: risk[`${target.platform}:${target.target_name}`] || "" })).filter((entry: any) => entry.risk_preference);
        setBusy(prev => ({ ...prev, riskSave: true }));
        try {
            await postJson("/api/risk-profiles", { bindings, expected_revision: riskState.revision });
            onError(copy("风险偏好已保存为不可执行意向；不改变策略、仓位或实盘权限。"));
            onRefresh();
        }
        catch (error) {
            onError(copy("风险偏好保存失败：{error}",{error:copy(requestErrorKey(error))}));
        }
        finally {
            setBusy(prev => ({ ...prev, riskSave: false }));
        }
    };
    const updateInstance = async (change: Record<string, any>, message: string) => {
        if (!session?.admin || busy.instanceSave)
            return;
        setBusy(prev => ({ ...prev, instanceSave: true }));
        try {
            await postJson("/api/admin/runtime-instances", { ...change, expected_revision: Number(instanceState.revision || 0) });
            onError(copy(message));
            setEditing(null);
            setInstanceDraft(blankDraft());
            onRefresh();
        }
        catch (error) {
            onError(copy("实例操作失败；草稿输入已保留。{detail}",{detail:error?copy(" · {error}",{error:copy(requestErrorKey(error))}):""}));
            if ((error as any)?.status === 409)
                onRefresh();
        }
        finally {
            setBusy(prev => ({ ...prev, instanceSave: false }));
        }
    };
    const submitInstance = (event: FormEvent) => {
        event.preventDefault();
        if (!instanceState.initialized || !strategies.length)
            return;
        const draft = { ...blankDraft(), ...instanceDraft };
        const editingParts = editing?.split(":") || [];
        const config = { ...(editing ? instanceState.instances?.find((x: any) => x.platform === editingParts[0] && x.key === editingParts.slice(1).join(":"))?.config || {} : {}) };
        for (const field of fieldNames) {
            const value = String(draft[field] || "").trim();
            if (value)
                config[field] = value;
            else
                delete config[field];
        }
        config.broker_environment = draft.broker_environment || undefined;
        config.default_strategy_profile = draft.default_strategy_profile;
        config.default_execution_mode = draft.default_execution_mode || "dry_run";
        const profile = strategies.find((item: any) => item.profile === config.default_strategy_profile);
        if (profile)
            config.supported_domains = [profile.domain];
        const action = editing ? "edit" : "create";
        void updateInstance({ action, platform: draft.platform, key: editingParts.length > 1 ? editingParts.slice(1).join(":") : undefined, config }, "实例草稿已保存；未部署、未启用或应用。");
    };
    const importConfig = () => {
        void confirmAction({ title: t("导入现有账户配置"), target: t("实例管理初始化"), summary: t("将按当前配置初始化实例记录（版本 {revision}）。", { revision: instanceState.revision ?? 0 }), consequence: t("请先核对当前账户配置并暂停其他配置写入。本操作不改变运行状态。"), tone: "danger" }).then(confirmed => {
            if (confirmed)
                void updateInstance({ action: "initialize", confirm: "IMPORT_EXISTING_CONFIG" }, "已导入现有配置；实际运行状态仍须单独读回。");
        });
    };
    const countEntries = Object.entries(cfg.accountOptions || {}).map(([platform, accounts]: any) => [platform, Array.isArray(accounts) ? accounts.length : 0] as [
        string,
        number
    ]);
    return <>{applications.length > 0 && <details className="supporting-research" open><summary>{t("提交模拟账户应用请求")}</summary>{applications.map((application: any) => <ApplicationCard key={String(application.ticket_id)} application={application} busy={Boolean(busy[`apply:${application.ticket_id}`])} onDeploy={accountId => onApply(application, accountId)} />)}</details>}<div className="page-title-row"><div><h1>{t("\u7BA1\u7406\u8BBE\u7F6E")}</h1><p>{t("\u7BA1\u7406\u8FD0\u884C\u5B9E\u4F8B\u3001\u767B\u5F55\u6743\u9650\u3001\u8D26\u6237\u8DEF\u7531\u4E0E\u98CE\u9669\u504F\u597D\uFF1B\u89D2\u8272\u6743\u9650\u4ECD\u7531 Worker \u6821\u9A8C\u3002")}</p></div><button type="button" className="button button-secondary" onClick={onRefresh}>{t("\u5237\u65B0\u7BA1\u7406\u8D44\u6599")}</button></div>
    <div className="two-column-layout"><div className="page-main-column">
      <section className="content-section"><div className="section-heading"><h2>{t("\u8FD0\u884C\u5B9E\u4F8B")}</h2><span>{instanceState.initialized ? `revision ${instanceState.revision ?? 0}` : instanceState.initialized === false ? t("\u5C1A\u672A\u521D\u59CB\u5316") : t("\u4E0D\u53EF\u7528")}</span></div>
        {model?.instances.error ? <Empty title={t("\u5B9E\u4F8B\u5B58\u50A8\u6682\u4E0D\u53EF\u7528")} detail={t("\u65E0\u6CD5\u8BFB\u53D6\u5B9E\u4F8B\u6216\u5176\u7248\u672C\uFF1B\u5199\u64CD\u4F5C\u505C\u6B62\u3002")}/> : !bound ? <Empty title={t("\u5B9E\u4F8B\u7BA1\u7406\u672A\u63A5\u5165")} detail={t("\u5F53\u524D\u6CA1\u6709\u5B9E\u4F8B\u5B58\u50A8\u7ED1\u5B9A\u3002")}/> : null}
        {!instanceState.initialized && bound && <div className="warning-note"><p>{t("\u521D\u59CB\u5316\u4F1A\u628A\u73B0\u6709\u8D26\u6237\u914D\u7F6E\u5BFC\u5165\u5B9E\u4F8B\u7BA1\u7406\u3002\u8BF7\u6838\u5BF9\u73B0\u6709\u914D\u7F6E\u5E76\u6682\u505C\u5176\u4ED6\u5199\u5165\u540E\u518D\u64CD\u4F5C\u3002")}</p><button className="button button-secondary" type="button" disabled={!session?.admin || busy.instanceSave} onClick={importConfig}>{t("\u5BFC\u5165\u73B0\u6709\u914D\u7F6E")}</button></div>}
        <div className="instance-list">{(instanceState.instances || []).map((item: any) => <article className="instance-row" key={`${item.platform}:${item.key}`}><div><strong>{item.config?.label || item.key} · {item.platform}</strong><p>{item.key} / {item.config?.target_name}</p><span className="status-text unknown">{item.kind === "draft" ? t("\u8349\u7A3F \u00B7 \u672A\u542F\u7528 \u00B7 \u672A\u5E94\u7528") : t("\u5DF2\u6709\u914D\u7F6E \u00B7 \u5B9E\u9645\u8FD0\u884C\u72B6\u6001\u987B\u5728\u8FD0\u884C\u68C0\u67E5\u4E2D\u6838\u5BF9")}{item.retirement_status === "requested" ? t(" \u00B7 \u5DF2\u8BF7\u6C42\u9000\u5F79\uFF0C\u5C1A\u672A\u505C\u673A") : ""}</span></div><div className="instance-actions">
          {item.kind === "existing" && <EnvironmentControl item={item} busy={busy} onSave={env => void updateInstance({ action: "set_broker_environment", platform: item.platform, key: item.key, broker_environment: env }, t("\u5238\u5546\u73AF\u5883\u5DF2\u4FDD\u5B58\uFF1B\u672A\u6539\u53D8\u542F\u7528\u3001\u5E94\u7528\u6216\u8DEF\u7531\u72B6\u6001\u3002"))}/>}
          {item.kind === "draft" && item.retirement_status === "none" && <button className="button button-secondary" type="button" onClick={() => { setEditing(`${item.platform}:${item.key}`); setInstanceDraft({ ...blankDraft(), ...item.config, platform: item.platform }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{t("\u7F16\u8F91\u8349\u7A3F")}</button>}
          {item.retirement_status !== "requested" && <button className="button button-secondary" type="button" disabled={busy.instanceSave} onClick={() => void updateInstance({ action: "request_retirement", platform: item.platform, key: item.key }, t("\u5DF2\u4FDD\u5B58\u9000\u5F79\u8BF7\u6C42\uFF1B\u6CA1\u6709\u505C\u673A\u6216\u79FB\u9664\u8D26\u6237\u914D\u7F6E\u3002"))}>{t("\u8BF7\u6C42\u9000\u5F79")}</button>}
        </div></article>)}</div>
        {instanceState.initialized && <details className="instance-editor" open><summary>{editing ? t("\u7F16\u8F91\u5B9E\u4F8B\u8349\u7A3F") : t("\u65B0\u589E\u5B9E\u4F8B\u8349\u7A3F")}</summary><form onSubmit={submitInstance}><div className="field-grid"><label>{t("\u5E73\u53F0")}<select value={instanceDraft.platform || "longbridge"} disabled={Boolean(editing)} onChange={e => updateDraft({ platform: e.target.value })}>{Object.keys(PLATFORM_CONFIG).filter(platform => !platformSettings[platform].dry_run_only).map(platform => <option key={platform} value={platform}>{platform}</option>)}</select></label>{fieldNames.map(field => <label key={field}>{({ label: t("\u5B9E\u4F8B\u540D\u79F0"), key: t("\u5B9E\u4F8B\u6807\u8BC6"), target_name: t("\u8FD0\u884C\u76EE\u6807"), account_selector: t("\u5DF2\u6709\u8D26\u6237\u5F15\u7528"), deployment_selector: t("\u5DF2\u6709\u90E8\u7F72\u5F15\u7528"), service_name: t("\u670D\u52A1\u540D\u79F0"), account_scope: t("\u8D26\u6237\u7EC4\u5F15\u7528\uFF08\u9009\u586B\uFF09"), github_environment: t("GitHub \u73AF\u5883\u5F15\u7528\uFF08\u9009\u586B\uFF09") } as Record<string, string>)[field]}<input required={!['account_scope', 'github_environment'].includes(field)} readOnly={field === "key" && Boolean(editing)} value={String(instanceDraft[field] || "")} onChange={e => updateDraft({ [field]: e.target.value })}/></label>)}
          <label>{t("\u5238\u5546\u73AF\u5883")}<select value={instanceDraft.broker_environment || ""} onChange={e => updateDraft({ broker_environment: e.target.value })}><option value="">{t("\u672A\u77E5 / \u672A\u8BBE\u7F6E")}</option><option value="live">live</option><option value="paper">paper</option></select></label><label>{t("\u9ED8\u8BA4\u7B56\u7565")}<select value={instanceDraft.default_strategy_profile || ""} onChange={e => updateDraft({ default_strategy_profile: e.target.value })}>{strategies.map((p: any) => <option key={p.profile} value={p.profile}>{p.label || p.profile}</option>)}</select></label><label>{t("\u9ED8\u8BA4\u6267\u884C\u6A21\u5F0F")}<select value={instanceDraft.default_execution_mode || "dry_run"} onChange={e => updateDraft({ default_execution_mode: e.target.value })}><option value="dry_run">dry_run</option><option value="live">live</option></select></label></div><p className="section-note">{t("\u53EA\u586B\u5199\u914D\u7F6E\u5F15\u7528\uFF0C\u4E0D\u586B\u5199\u5BC6\u94A5\u3002\u521B\u5EFA\u6216\u7F16\u8F91\u4FDD\u5B58\u4E3A\u8349\u7A3F\uFF0C\u4E0D\u90E8\u7F72\u3001\u4E0D\u542F\u7528\u3001\u4E0D\u63A5\u7BA1\u8D26\u6237\u3002")}</p><div className="form-actions"><button className="button button-primary" disabled={!session?.admin || !strategies.length || busy.instanceSave} type="submit">{t("\u4FDD\u5B58\u8349\u7A3F")}</button><button className="button button-secondary" type="button" onClick={() => { setEditing(null); setInstanceDraft(blankDraft()); }}>{t("\u53D6\u6D88\u7F16\u8F91")}</button></div></form></details>}
        <details><summary>{t("\u5B9E\u4F8B\u53D8\u66F4\u8BB0\u5F55")}</summary>{(instanceState.history || []).map((item: any, index: number) => <p key={`${item.ts}-${index}`}>{item.ts} · {item.login} · {item.action}</p>)}</details>
      </section>
      <section className="content-section"><h2>{t("\u767B\u5F55\u6743\u9650\u4E0E\u8D26\u6237\u8DEF\u7531")}</h2>{model?.config.error ? <Empty title={t("管理配置不可用")} detail={t("\u6CA1\u6709\u6210\u529F\u8BFB\u53D6\u7BA1\u7406\u5458\u914D\u7F6E\u3002")}/> : <><p className="section-note">{t("\u7BA1\u7406\u5458\u5FC5\u987B\u4FDD\u7559\u5F53\u524D\u7BA1\u7406\u5458\u8EAB\u4EFD\uFF1B\u8D26\u6237\u8DEF\u7531\u4EC5\u5B58\u6807\u8BC6\u5F15\u7528\uFF0C\u4E0D\u5B58\u5BC6\u7801\u3001token \u6216 API key\u3002\u5B9E\u4F8B\u7BA1\u7406\u63A5\u7BA1\u540E\u8D26\u6237 JSON \u4E3A\u53EA\u8BFB\u3002")}</p><div className="field-grid">{[["allowed_logins", t("\u53EF\u5207\u6362\u7528\u6237\uFF0C\u6BCF\u884C\u4E00\u4E2A")], ["allowed_orgs", t("\u53EF\u5207\u6362\u7EC4\u7EC7\uFF0C\u6BCF\u884C\u4E00\u4E2A")], ["admin_logins", t("\u7BA1\u7406\u5458\u7528\u6237\uFF0C\u6BCF\u884C\u4E00\u4E2A")], ["admin_orgs", t("\u7BA1\u7406\u5458\u7EC4\u7EC7\uFF0C\u6BCF\u884C\u4E00\u4E2A")]].map(([key, label]) => <label key={key}>{label}<textarea rows={4} value={text[key] || ""} onChange={e => setText(prev => ({ ...prev, [key]: e.target.value }))}/></label>)}</div><label>{t("\u8D26\u6237\u9009\u9879 JSON")}<textarea className="json-textarea" rows={15} readOnly={Boolean(instanceState.initialized)} value={text.account_options || ""} onChange={e => setText(prev => ({ ...prev, account_options: e.target.value }))}/></label><div className="form-actions"><button type="button" className="button button-primary" disabled={!kvAvailable || busy.adminConfig || !session?.admin} onClick={() => void saveAdmin()}>{t("\u4FDD\u5B58\u767B\u5F55\u4E0E\u8D26\u6237\u914D\u7F6E")}</button><span>{kvAvailable ? t("\u4FDD\u5B58\u540E\u5199\u5165\u5BA1\u8BA1\u8BB0\u5F55") : t("KV \u672A\u7ED1\u5B9A\uFF0C\u53EA\u80FD\u67E5\u770B")}</span></div></>}</section>
      <section className="content-section"><h2>{t("\u7EC4\u5408\u98CE\u9669\u504F\u597D")}</h2><p className="section-note">{t("\u4EC5\u4FDD\u5B58\u4E0D\u53EF\u6267\u884C\u7684\u504F\u597D\u610F\u56FE\uFF1B\u4E0D\u6539\u7B56\u7565\u3001\u4ED3\u4F4D\u3001\u53C2\u6570\uFF0C\u4E0D\u751F\u6210\u8BA2\u5355\uFF0C\u4E0D\u6388\u4E88\u5B9E\u76D8\u6743\u9650\u3002")}</p>{model?.risk.error ? <Empty title={t("风险偏好记录不可用")} detail={t("\u5F53\u524D\u6CA1\u6709\u6210\u529F\u8BFB\u53D6\u8BB0\u5F55\uFF1B\u65E0\u6CD5\u5B89\u5168\u8986\u76D6\u3002")}/> : <><div className="risk-table">{(riskState.configured_targets || []).map((target: any) => <label key={`${target.platform}:${target.target_name}`}>{target.platform} · {target.target_name}<select value={risk[`${target.platform}:${target.target_name}`] || ""} onChange={e => setRisk(prev => ({ ...prev, [`${target.platform}:${target.target_name}`]: e.target.value }))}><option value="">{t("\u4E0D\u4FEE\u6539 / \u6E05\u9664\u9009\u62E9")}</option>{RISK_PROFILES.map(profile => <option key={profile} value={profile}>{({ CAPITAL_PRESERVATION: t("保护资本"), BALANCED_COMPOUNDING: t("均衡复利"), GROWTH_COMPOUNDING: t("增长复利") } as Record<string, string>)[profile] || t("状态未知")}</option>)}</select></label>)}</div><button type="button" className="button button-primary" disabled={!session?.admin || busy.riskSave} onClick={() => void saveRisk()}>{t("\u4FDD\u5B58\u98CE\u9669\u504F\u597D")}</button></>}</section>
      <section className="content-section"><h2>{t("\u8D26\u53F7\u6570\u91CF\u4E0E\u6700\u8FD1\u4FEE\u6539")}</h2><div className="source-list">{countEntries.map(([platform, count]) => <div className="source-row-item" key={platform}><strong>{platform}</strong><span>{t("{count} 个账户", { count })}</span></div>)}</div><details><summary>{t("\u5BA1\u8BA1\u8BB0\u5F55")}</summary>{(cfg.auditLog || []).map((entry: any, index: number) => <p key={`${entry.ts}-${index}`}>{entry.ts} · {entry.login} · {entry.action}</p>)}</details></section>
    </div><aside className="editorial-rail"><h2>{t("\u7BA1\u7406\u8FB9\u754C")}</h2><p>{t("\u7BA1\u7406\u89D2\u8272\u7531 `/api/session` \u4E0E\u670D\u52A1\u7AEF handler \u518D\u6B21\u6821\u9A8C\u3002\u6D4F\u89C8\u5668\u9690\u85CF\u5165\u53E3\u4E0D\u6784\u6210\u6388\u6743\u3002")}</p><div className="warning-note"><strong>{t("\u7248\u672C\u51B2\u7A81\u65F6\u4FDD\u7559\u8349\u7A3F")}</strong><p>{t("\u5B9E\u4F8B\u53D8\u66F4\u5E26 expected_revision\uFF1B409 \u540E\u5237\u65B0\u72B6\u6001\u5E76\u7531\u7BA1\u7406\u5458\u68C0\u67E5\uFF0C\u4E0D\u81EA\u52A8\u91CD\u53D1\u3002")}</p></div><div className="rail-step"><span>01</span><strong>{t("\u8FD0\u884C\u5B9E\u4F8B\u8349\u7A3F")}</strong><p>{t("\u8349\u7A3F\u4FDD\u5B58\u4E0D\u4EE3\u8868\u90E8\u7F72\u6216\u542F\u7528\u3002")}</p></div></aside></div></>;
}
function EnvironmentControl({ item, busy, onSave }: {
    item: Record<string, any>;
    busy: Busy;
    onSave: (value: string) => void;
}) { const t = useT(); const values = Array.isArray(item.supported_broker_environments) ? item.supported_broker_environments : ["live", "paper"]; const [environment, setEnvironment] = useState(item.config?.broker_environment || ""); return <div className="instance-environment"><select aria-label={t("\u5238\u5546\u73AF\u5883")} value={environment} onChange={e => setEnvironment(e.target.value)}><option value="">{t("\u672A\u77E5 / \u672A\u8BBE\u7F6E")}</option>{values.map((value: string) => <option key={value}>{value}</option>)}</select><button type="button" className="button button-secondary" disabled={!environment || busy.instanceSave} onClick={() => onSave(environment)}>{t("\u4FDD\u5B58\u5238\u5546\u73AF\u5883")}</button></div>; }
export default App;
