import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { AccountOption, AdminModel, ConfigPayload, ReadModel, Session, UxDraft } from "./api";
import { AccessError, getJson, invalidatePrivateSession, loadAdminModel, loadReadModel, postJson, runtimeStopQuery } from "./api";
import { createRequestGate } from "./requestGate.js";
import { nextExplicitTheme, normalizeThemePreference, resolveTheme, THEME_STORAGE_KEY } from "./theme.js";
import { applicationRetryAllowed, beginNonHkStop, buildConfirmationFingerprint, buildSwitchInputs, canResumeBinance, confirmationAccepted, createRequestLock, createUnknownSubmitLock, defaultSwitchDraft, createHkStopController, hkStopSubmitAllowed, ownerDecisionBinding, pageFromWorkspace, recoveryBinding, type SwitchDraft } from "./operations";
import { PLATFORM_CONFIG } from "../../config.js";
import { LocaleContext, renderLocaleMessage, translate, useT, type Language, type LocaleMessage } from "./locales";
import { AccountsPage, type AccountListItem } from "./AccountsPage";
import { DecisionsPage } from "./DecisionsPage";
import { OverviewPage, type OverviewAccount } from "./OverviewPage";
import { accountIdentity, accountStatusView, activationFromProjection, formatAccountIdentity, knownAccountLabel, listDailyDecisions, paperApplicationAccounts, paperApplicationReady, strategyDisplayName, strategyNote, strategyOccupiedNames, type DailyDecision } from "./presentation";
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
    return value === "paper" ? t("模拟账户环境") : value === "live" ? t("真实账户环境") : t("环境未标明");
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
    const userMenuRef = useRef<HTMLDetailsElement>(null);
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
    const accountTitle = (account: { label?: unknown; key?: unknown; account_selector?: unknown }, platformLabel: string, currentProfile?: unknown) => formatAccountIdentity(accountIdentity(account, platformLabel, "", strategyOccupiedNames(model?.config.value?.strategyProfiles || [], currentProfile)), t);
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
    useEffect(() => { if (userMenuRef.current) userMenuRef.current.open = false; }, [page, adminPath]);
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
        const accepted = await confirmAction({ title: t("放弃未保存的修改？"), target: active ? accountTitle(active.account, active.platformLabel, active.current?.strategy_profile) : t("账户"), summary: t("未保存的预留现金和风险偏好会丢弃。"), consequence: t("未保存的预留现金和风险偏好会丢弃。"), tone: "normal" });
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
            setErrorMessage(copy("账户计划提交暂未接通；当前可以查看设置，停用入口仍按原确认流程执行。"));
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
        const recoveryOptions = model?.config.value?.accountOptions;
        const knownRecovery = knownAccountLabel(recoveryOptions, recovery.platform, recovery.target_name);
        const recoveryAccounts = recoveryOptions && typeof recovery.platform === "string" ? recoveryOptions[recovery.platform] : undefined;
        const recoveryMatches = Array.isArray(recoveryAccounts) ? recoveryAccounts.filter(account => account && (account.target_name === recovery.target_name || account.key === recovery.target_name)) : [];
        const accountLabel = knownRecovery && recoveryMatches.length === 1 ? accountTitle(recoveryMatches[0], String(recovery.platform || ""), recovery.strategy_profile) : "";
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
        const name = strategyDisplayName(found, language);
        return name === "未命名策略" ? t(name) : name;
    };
    const overviewAccounts: OverviewAccount[] = rows.map(row => {
        const status = accountStatusView(row.runtime?.account_state);
        const preference = row.current?.risk_preference;
        return {
            id: row.id,
            title: accountTitle(row.account, row.platformLabel, row.current?.strategy_profile),
            platform: row.platformLabel,
            environment: brokerEnvironment(row.account.broker_environment, t),
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
            title: accountTitle(row.account, row.platformLabel, row.current?.strategy_profile),
            platformLabel: row.platformLabel,
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
    const renderOverview = () => <OverviewPage accounts={overviewAccounts} decisions={decisions.items.length} decisionsBlocked={decisions.blocked} onOpenAccount={id => void requestPage("accounts", id)} onOpenDecisions={() => void requestPage("strategy")} />;
    const renderStrategy = () => <DecisionsPage blocked={decisions.blocked} items={decisions.items} admin={Boolean(model?.session.admin)} busy={Boolean(busy.promotion) || onceLocks.current.hasAnyWithPrefixes(["owner:", "recovery:"])} selectedAccountId={promotionAccountId} onSelectAccount={setPromotionAccountId} onDecide={(item, action) => void decideDaily(item, action)} />;
    const renderAccounts = () => <AccountsPage rows={accountItems} selectedId={selectedAccount?.id || ""} detailOpen={accountDetailOpen} admin={Boolean(model?.session.admin)} settingsEpoch={settingsEpoch} stopAllowed={stopAllowed} stopLabel={stopLabel} stopRefreshVisible={hkStop} resumeVisible={Boolean(selectedRow && canResumeBinance(selectedRow.platform, selectedRow.account, selectedRow.current) && !busy[`resume:${selectedRow.id}`] && !onceLocks.current.isLocked(`resume:${selectedRow.id}`))} onSelect={id => void requestPage("accounts", id)} onBack={() => void (async () => { if (!await discardUnsaved()) return; setAccountDetailOpen(false); })()} onDirty={dirty => { settingsDirty.current = dirty; }} onStop={() => { if (selectedRow) void submitAccountPlan(selectedRow, true); }} onRefreshStop={() => { if (selectedRow) void refreshStopRecord(selectedRow); }} onResume={() => { if (selectedRow) void resumeBinance(selectedRow); }} />;
    const renderAdmin = () => <AdminPanel model={adminModel} session={model?.session} applications={model?.promotions.value?.applications || []} onApply={(application, accountId) => void applyPromotion(application, accountId)} onOpenAccounts={() => { void (async () => { if (!await discardUnsaved()) return; setAdminPath(false); setPageAndRoute("accounts"); })(); }} text={adminText} setText={setAdminText} instanceDraft={instanceDraft} setInstanceDraft={setInstanceDraft} editing={editingInstance} setEditing={setEditingInstance} busy={busy} setBusy={setBusy} onRefresh={() => void refresh()} onError={setErrorMessage} confirmAction={confirmAction} />;
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
      <div className="top-controls"><button className="theme-button" type="button" aria-label={t(resolvedTheme === "dark" ? "切换到浅色" : "切换到深色")} title={t(resolvedTheme === "dark" ? "切换到浅色" : "切换到深色")} onClick={() => setTheme(nextExplicitTheme(resolvedTheme))}>{resolvedTheme === "dark" ? "☾" : "☀"}</button><label className="language-control"><span className="sr-only">{t("语言")}</span><select aria-label={t("语言")} value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="zh">{t("中文")}</option><option value="en">English</option></select></label><details className="user-menu" ref={userMenuRef}><summary aria-label={t("用户")}>{(model?.session.login || "U").slice(0, 1).toUpperCase()}</summary><div><span>{model?.session.login || t("已登录")}</span>{model?.session.admin && <button type="button" className="admin-shortcut" onClick={enterAdmin}>{t("管理设置")}</button>}<button type="button" onClick={() => void logout()}>{t("退出")}</button></div></details></div>
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
function AdminPanel({ model, session, applications = [], onApply, onOpenAccounts, text, setText, instanceDraft, setInstanceDraft, editing, setEditing, busy, setBusy, onRefresh, onError, confirmAction }: {
    model: AdminModel | null;
    session?: Session;
    applications?: any[];
    onApply: (application: Record<string, any>, accountId: string) => void;
    onOpenAccounts: () => void;
    text: Record<string, string>;
    setText: (value: Record<string, string> | ((previous: Record<string, string>) => Record<string, string>)) => void;
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
    const kvAvailable = Boolean(cfg.kvAvailable);
    const bound = Boolean(instanceState.instances || instanceState.initialized !== undefined);
    const strategies = cfg.runtimeInstanceStrategies || cfg.strategyProfiles || [];
    const [recordFormOpen, setRecordFormOpen] = useState(false);
    const [applicationFold, setApplicationFold] = useState<boolean | null>(null);
    useEffect(() => { if (editing) setRecordFormOpen(true); }, [editing]);
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
    const updateInstance = async (change: Record<string, any>, message: string) => {
        if (!session?.admin || busy.instanceSave)
            return;
        setBusy(prev => ({ ...prev, instanceSave: true }));
        try {
            await postJson("/api/admin/runtime-instances", { ...change, expected_revision: Number(instanceState.revision || 0) });
            onError(copy(message));
            setEditing(null);
            setInstanceDraft(blankDraft());
            setRecordFormOpen(false);
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
    const pendingApplications = applications.filter((item: any) => applicationRetryAllowed(item?.application || null)).length;
    const unresolvedApplications = applications.length - pendingApplications;
    const applicationsOpen = applicationFold === null ? applications.length > 0 : applicationFold;
    return <div className="admin-page"><div className="page-title-row"><div><h1>{t("管理设置")}</h1><p>{t("管理账户记录、访问权限与风险偏好。")}</p></div><button type="button" className="button button-secondary" onClick={onRefresh}>{t("刷新管理资料")}</button></div>
      <details className="admin-fold" open={applicationsOpen} onToggle={event => setApplicationFold(event.currentTarget.open)}><summary>{t("模拟账户应用 · {pending} 待处理 · {unresolved} 未决", { pending: pendingApplications, unresolved: unresolvedApplications })}</summary>
        {applications.length === 0 ? <p className="section-note">{t("当前没有待处理的模拟账户应用。")}</p> : applications.map((application: any) => <ApplicationCard key={String(application.ticket_id)} application={application} busy={Boolean(busy[`apply:${application.ticket_id}`])} onDeploy={accountId => onApply(application, accountId)} />)}
      </details>
      <section className="content-section"><div className="section-heading"><h2>{t("账户记录")}</h2>{instanceState.initialized === false && <span>{t("尚未初始化")}</span>}</div>
        {model?.instances.error ? <Empty title={t("\u5B9E\u4F8B\u5B58\u50A8\u6682\u4E0D\u53EF\u7528")} detail={t("\u65E0\u6CD5\u8BFB\u53D6\u5B9E\u4F8B\u6216\u5176\u7248\u672C\uFF1B\u5199\u64CD\u4F5C\u505C\u6B62\u3002")}/> : !bound ? <Empty title={t("\u5B9E\u4F8B\u7BA1\u7406\u672A\u63A5\u5165")} detail={t("\u5F53\u524D\u6CA1\u6709\u5B9E\u4F8B\u5B58\u50A8\u7ED1\u5B9A\u3002")}/> : null}
        {!instanceState.initialized && bound && <div className="warning-note"><p>{t("\u521D\u59CB\u5316\u4F1A\u628A\u73B0\u6709\u8D26\u6237\u914D\u7F6E\u5BFC\u5165\u5B9E\u4F8B\u7BA1\u7406\u3002\u8BF7\u6838\u5BF9\u73B0\u6709\u914D\u7F6E\u5E76\u6682\u505C\u5176\u4ED6\u5199\u5165\u540E\u518D\u64CD\u4F5C\u3002")}</p><button className="button button-secondary" type="button" disabled={!session?.admin || busy.instanceSave} onClick={importConfig}>{t("\u5BFC\u5165\u73B0\u6709\u914D\u7F6E")}</button></div>}
        <div className="instance-list">{(instanceState.instances || []).map((item: any) => <article className="admin-record" key={`${item.platform}:${item.key}`}><strong>{item.config?.label || item.key}</strong><span>{item.platform}</span><span>{item.config?.broker_environment ? brokerEnvironment(item.config.broker_environment, t) : t("未设置")}</span><span>{item.kind === "draft" ? t("草稿记录") : t("已有记录")}{item.retirement_status === "requested" ? t(" · 已申请退役") : ""}</span><details className="admin-fold admin-manage"><summary>{t("管理")}</summary>
          {item.kind === "existing" && <EnvironmentControl item={item} busy={busy} onSave={env => void updateInstance({ action: "set_broker_environment", platform: item.platform, key: item.key, broker_environment: env }, "环境标记已保存；未改变启用、应用或路由状态。")}/>}
          {item.kind === "draft" && item.retirement_status === "none" && <button className="button button-secondary" type="button" onClick={() => { setEditing(`${item.platform}:${item.key}`); setInstanceDraft({ ...blankDraft(), ...item.config, platform: item.platform }); setRecordFormOpen(true); }}>{t("编辑草稿")}</button>}
          {item.retirement_status !== "requested" && <button className="button button-secondary" type="button" disabled={!session?.admin || busy.instanceSave} onClick={() => void updateInstance({ action: "request_retirement", platform: item.platform, key: item.key }, "已保存退役申请；账户配置仍保留。")}>{t("申请退役")}</button>}
        </details></article>)}</div>
        {instanceState.initialized && <details className="admin-fold" open={recordFormOpen} onToggle={event => setRecordFormOpen(event.currentTarget.open)}><summary>{editing ? t("编辑账户记录") : t("新增账户记录")}</summary><form onSubmit={submitInstance}><div className="field-grid"><label>{t("平台")}<select value={instanceDraft.platform || "longbridge"} disabled={Boolean(editing)} onChange={e => updateDraft({ platform: e.target.value })}>{Object.keys(PLATFORM_CONFIG).filter(platform => !platformSettings[platform].dry_run_only).map(platform => <option key={platform} value={platform}>{platform}</option>)}</select></label>{fieldNames.map(field => <label key={field}>{({ label: t("实例名称"), key: t("实例标识"), target_name: t("运行目标"), account_selector: t("已有账户引用"), deployment_selector: t("已有部署引用"), service_name: t("服务名称"), account_scope: t("账户组引用（选填）"), github_environment: t("GitHub 环境引用（选填）") } as Record<string, string>)[field]}<input required={!['account_scope', 'github_environment'].includes(field)} readOnly={field === "key" && Boolean(editing)} value={String(instanceDraft[field] || "")} onChange={e => updateDraft({ [field]: e.target.value })}/></label>)}
          <label>{t("环境标记")}<select value={instanceDraft.broker_environment || ""} onChange={e => updateDraft({ broker_environment: e.target.value })}><option value="">{t("未知 / 未设置")}</option><option value="live">{brokerEnvironment("live", t)}</option><option value="paper">{brokerEnvironment("paper", t)}</option></select></label><label>{t("默认策略")}<select value={instanceDraft.default_strategy_profile || ""} onChange={e => updateDraft({ default_strategy_profile: e.target.value })}>{strategies.map((p: any) => <option key={p.profile} value={p.profile}>{p.label || p.profile}</option>)}</select></label><label>{t("默认执行模式")}<select value={instanceDraft.default_execution_mode || "dry_run"} onChange={e => updateDraft({ default_execution_mode: e.target.value })}><option value="dry_run">{executionMode("dry_run", t)}</option><option value="live">{executionMode("live", t)}</option></select></label></div><p className="section-note">{t("只填写配置引用，不填写密钥。创建或编辑保存为草稿，不部署、不启用、不接管账户。")}</p><div className="form-actions"><button className="button button-primary" disabled={!session?.admin || !strategies.length || busy.instanceSave} type="submit">{t("保存草稿")}</button><button className="button button-secondary" type="button" onClick={() => { setEditing(null); setInstanceDraft(blankDraft()); }}>{t("取消编辑")}</button></div></form></details>}
      </section>
      <section className="content-section">{model?.config.error ? <Empty title={t("管理配置不可用")} detail={t("没有成功读取管理员配置。")}/> : <>
        <details className="admin-fold"><summary>{t("访问权限")}</summary><div className="field-grid">{[["allowed_logins", t("可切换用户，每行一个")], ["allowed_orgs", t("可切换组织，每行一个")], ["admin_logins", t("管理员用户，每行一个")], ["admin_orgs", t("管理员组织，每行一个")]].map(([key, label]) => <label key={key}>{label}<textarea rows={4} value={text[key] || ""} onChange={e => setText(prev => ({ ...prev, [key]: e.target.value }))}/></label>)}</div><div className="form-actions"><button type="button" className="button button-primary" disabled={!kvAvailable || busy.adminConfig || !session?.admin} onClick={() => void saveAdmin()}>{t("保存登录与账户配置")}</button><span>{kvAvailable ? t("保存后写入审计记录") : t("KV 未绑定，只能查看")}</span></div></details>
        <details className="admin-fold"><summary>{t("技术详情")}</summary><label>{t("账户选项 JSON")}<textarea className="json-textarea" rows={12} readOnly={Boolean(instanceState.initialized)} value={text.account_options || ""} onChange={e => setText(prev => ({ ...prev, account_options: e.target.value }))}/></label></details>
      </>}</section>
      <section className="content-section"><h2>{t("风险偏好")}</h2><p className="section-note">{t("单个账户的风险偏好在账户设置中修改。")}</p><button type="button" className="button button-secondary" onClick={onOpenAccounts}>{t("前往账户设置")}</button></section>
      <details className="admin-fold"><summary>{t("变更记录")}</summary><h3>{t("账户记录变更")}</h3>{(instanceState.history || []).length === 0 ? <p>{t("没有账户记录变更")}</p> : (instanceState.history || []).map((item: any, index: number) => <p key={`${item.ts}-${index}`}>{item.ts} · {item.login} · {item.action}</p>)}<h3>{t("访问配置变更")}</h3>{(cfg.auditLog || []).length === 0 ? <p>{t("没有访问配置变更")}</p> : (cfg.auditLog || []).map((entry: any, index: number) => <p key={`${entry.ts}-${index}`}>{entry.ts} · {entry.login} · {entry.action}</p>)}</details>
    </div>;
}
function EnvironmentControl({ item, busy, onSave }: {
    item: Record<string, any>;
    busy: Busy;
    onSave: (value: string) => void;
}) { const t = useT(); const values = Array.isArray(item.supported_broker_environments) ? item.supported_broker_environments : ["live", "paper"]; const [environment, setEnvironment] = useState(item.config?.broker_environment || ""); return <div className="instance-environment"><select aria-label={t("环境标记")} value={environment} onChange={e => setEnvironment(e.target.value)}><option value="">{t("未知 / 未设置")}</option>{values.map((value: string) => <option key={value} value={value}>{brokerEnvironment(value, t)}</option>)}</select><button type="button" className="button button-secondary" disabled={!environment || busy.instanceSave} onClick={() => onSave(environment)}>{t("保存环境标记")}</button></div>; }
export default App;
