import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { AccountOption, AdminModel, ConfigPayload, ReadModel, Session, Source, UxDraft } from "./api";
import { AccessError, getJson, invalidatePrivateSession, loadAccountSettings, loadAdminModel, loadReadModel, postJson, runtimeStopQuery } from "./api";
import { createRequestGate } from "./requestGate.js";
import { normalizeThemePreference, resolveTheme, THEME_STORAGE_KEY } from "./theme.js";
import { createAccountSettingsController, type AccountSettingsOp } from "./accountSettingsState";
import { accountMatchesStatusFilter, applicationRetryAllowed, buildConfirmationFingerprint, buildHomeAttention, buildSwitchInputs, canResumeBinance, confirmationAccepted, createRequestLock, currentResearchPreview, defaultSwitchDraft, diagnosisStatusKey, diagnosisUserSummary, createHkStopController, hkStopSubmitAllowed, ownerDecisionBinding, pageFromWorkspace, presentAccountState, promotionAiExplanation, recoveryBinding, summarizeExternalResearchSubject, type SwitchDraft } from "./operations";
import { DCA_SUPPORTED_PLATFORMS, DOMAIN_LABELS, PLATFORM_CONFIG } from "../../config.js";
import { formatAccountCount, LocaleContext, renderLocaleMessage, translate, useLocale, useT, type Language, type LocaleMessage } from "./locales";
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
const PROMOTION_RISK = ["CAPITAL_PRESERVATION", "BALANCED_COMPOUNDING", "GROWTH_COMPOUNDING"];
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
function stamp(value: string | null | undefined, language: Language = "zh"): string {
    if (!value)
        return translate("未提供", language);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? translate("时间不可用", language) : new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
}
function sourceTime(value: any): string | null { return value?.computed_at || value?.generated_at || value?.viewed_at || null; }
function valueStatus(source: Source<any> | undefined): string {
    if (source?.error)
        return "读取失败";
    const status = source?.value?.data_status;
    return ({ ready: "可供核对", stale: "资料已过期", unavailable: "暂不可用", unknown: "状态未知" } as Record<string, string>)[String(status || "")] || "未提供";
}
function displayStatus(value: unknown, _translate?: (key: string) => string): string {
    const labels: Record<string, string> = { observed: "已收到心跳", healthy: "运行状态可供核对", live: "执行（live）", ready: "可供核对", stale: "资料已过期", unavailable: "暂不可用", unknown: "结果待确认", active: "运行中", paused: "已暂停", disabled: "已停用", enabled: "已启用", monitoring_only: "仅监测", not_due: "等待检查周期", attention: "需要核对", failed: "未完成", succeeded: "已完成", queued: "排队中", running: "处理中", approved: "请求已批准", rejected: "已明确拒绝", claimed: "已领取处理中", pending: "等待提交", sent: "已提交", fixed: "固定金额", current: "保持现状", none: "不启用", auto: "自动选择", smart: "智能定投", ratio: "比例", floor: "固定金额下限", max: "金额与比例取较大值", paper: "模拟账户环境", dry_run: "禁止下单验证", ready_to_apply: "可供核对" };
    const label = labels[String(value || "")];
    return label || "状态未知";
}
function decisionLabel(value: unknown, t: (key: string) => string): string {
    const labels: Record<string, string> = { approve_limited_live_canary: "有限执行观察", keep_parked: "保持暂停", retire_candidate: "退役候选", accepted: "已接受", rejected: "已明确拒绝", keep: "保持现状" };
    return labels[String(value || "")] ? t(labels[String(value)]) : t("状态未知");
}
function riskLabel(value: string, t: (key: string) => string): string {
    const labels: Record<string, string> = { CAPITAL_PRESERVATION: "保护资本", BALANCED_COMPOUNDING: "均衡复利", GROWTH_COMPOUNDING: "增长复利" };
    return labels[value] ? t(labels[value]) : t("状态未知");
}
function brokerEnvironment(value: unknown, t: (key: string) => string): string {
    return value === "paper" ? t("模拟账户环境") : value === "live" ? t("真实账户环境") : t("状态未知");
}
function domainLabel(value: unknown, t: (key: string) => string): string {
    const label = (DOMAIN_LABELS as Record<string, { zh: string; en: string }>)[String(value || "")];
    return label ? t(label.zh) : t("状态未知");
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
    for (const [platform, accounts] of Object.entries(config.accountOptions)) {
        const meta = config.platformMeta[platform];
        if (!meta || meta.console_visible === false || !Array.isArray(accounts))
            continue;
        for (const account of accounts) {
            const hits = (runtime?.targets || []).filter((record: any) => record?.target?.target_id === account.runtime_status_target_id && record?.target?.target?.platform === platform);
            rows.push({ id: `${platform}:${account.key}`, platform, platformLabel: meta.label || platform, account, current: currentFor(config, platform, account), runtime: hits.length === 1 ? hits[0] : null });
        }
    }
    return rows;
}
function statusFor(row: AccountRow) {
    return presentAccountState(row.runtime?.account_state);
}
function OptionList({ values, value, onChange, labels = {} }: {
    values: string[];
    value: string;
    onChange: (v: string) => void;
    labels?: Record<string, string>;
}) {
    const t = useT();
    return <select value={value} onChange={e => onChange(e.target.value)}>{values.map(item => <option key={item} value={item}>{labels[item] || t(displayStatus(item))}</option>)}</select>;
}
function Empty({ title, detail }: {
    title: string;
    detail: string;
}) { return <div className="empty-state"><strong>{title}</strong><p>{detail}</p></div>; }
function DetailTime({ title, value }: {
    title: string;
    value?: string | null;
}) { const language = useLocale(); return <small className="source-time">{title}：{stamp(value, language)}</small>; }
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
    const [refreshing, setRefreshing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<LocaleMessage | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [selectedId, setSelectedId] = useState("");
    const [switchDrafts, setSwitchDrafts] = useState<Record<string, SwitchDraft>>({});
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [healthFilter, setHealthFilter] = useState("attention");
    const [uxDraft, setUxDraft] = useState<UxDraft>(emptyUxDraft());
    const [uxDirty, setUxDirty] = useState(false);
    const [uxBusy, setUxBusy] = useState(false);
    const [uxError, setUxError] = useState<LocaleMessage | null>(null);
    const [uxCompare, setUxCompare] = useState(false);
    const [busy, setBusy] = useState<Busy>({});
    const [diagnosis, setDiagnosis] = useState<Record<string, any>>({});
    const [stopRecords, setStopRecords] = useState<Record<string, any>>({});
    const [promotionTicketId, setPromotionTicketId] = useState("");
    const [promotionAccountId, setPromotionAccountId] = useState("");
    const [promotionRisk, setPromotionRisk] = useState("CAPITAL_PRESERVATION");
    const [adminRisk, setAdminRisk] = useState<Record<string, string>>({});
    const [adminText, setAdminText] = useState<Record<string, string>>({});
    const [instanceDraft, setInstanceDraft] = useState<Record<string, any>>({});
    const [editingInstance, setEditingInstance] = useState<string | null>(null);
    const gate = useRef(createRequestGate());
    const hkStops = useRef(new Map<string, ReturnType<typeof createHkStopController>>());
    const switchLocks = useRef(new Set<string>());
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
    const setPageAndRoute = (next: Page) => { setAdminPath(false); setPage(next); const url = next === "overview" ? "/" : `/?workspace=${next === "strategy" ? "research" : next}`; window.history.pushState({ page: next }, "", url); };
    useEffect(() => { const pop = () => { setAdminPath(window.location.pathname === "/admin"); const w = new URLSearchParams(window.location.search).get("workspace"); setPage(pageFromWorkspace(w)); }; window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, []);
    const enterAdmin = () => { setAdminPath(true); window.history.pushState({ admin: true }, "", "/admin"); };
    const logout = async () => {
        clearPrivateState();
        try {
            await postJson("/api/logout", {});
        }
        catch { /* local state remains cleared */ }
        window.location.assign("/login");
    };
    const currentForm = (row: AccountRow | null): SwitchDraft | null => row ? switchDrafts[row.id] || defaultSwitchDraft(row.account, row.current, row.platform) : null;
    const updateForm = (row: AccountRow, patch: Partial<SwitchDraft>) => setSwitchDrafts(prev => ({ ...prev, [row.id]: { ...currentForm(row)!, ...patch, touched: { ...currentForm(row)!.touched, ...(patch.touched || {}) } } }));
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
        if (!model?.session.allowed || switchLocks.current.has(row.id))
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
            else
                switchLocks.current.add(row.id);
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
            switchLocks.current.add(row.id);
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
    const saveUxDraft = async (expectedEditEpoch = uxEditEpoch.current): Promise<UxDraft> => {
        const payload = await postJson<UxDraft>("/api/ux1/draft", { expected_revision: uxDraft.revision || 0, objective: uxDraft.draft?.objective, research_case_id: uxDraft.draft?.research_case_id, advanced_settings: uxDraft.draft?.advanced_settings || {} });
        if (uxEditEpoch.current !== expectedEditEpoch)
            throw new Error("草案在保存期间发生编辑；保留当前输入，请再次保存。");
        setUxDraft(payload);
        setUxDirty(false);
        return payload;
    };
    const runUx = async (kind: "save" | "preview" | "intent") => {
        if (!model?.session.allowed || uxBusy)
            return;
        setUxBusy(true);
        setUxError(null);
        const editEpoch = uxEditEpoch.current;
        try {
            if (kind === "save") {
                await saveUxDraft(editEpoch);
                return;
            }
            let current = uxDraft;
            if (uxDirty || !current.revision)
                current = await saveUxDraft(editEpoch);
            if (kind === "preview") {
                if (["queued", "running", "unknown"].includes(String(current.job?.status || "")))
                    return;
                const payload = await postJson<UxDraft>("/api/ux1/preview", { expected_revision: current.revision });
                if (uxEditEpoch.current === editEpoch)
                    setUxDraft(payload);
                else
                    setUxError(copy("草案已变更，未覆盖当前编辑。"));
            }
            else {
                if (!currentResearchPreview(current as any) || current.preview_stale || !current.fingerprint)
                    throw new Error("研究结果已失效或尚未就绪，不能保存意向。");
                await postJson<UxDraft>("/api/ux1/intent", { expected_revision: current.revision, fingerprint: current.fingerprint });
                const payload = await getJson<UxDraft>("/api/ux1/draft");
                if (uxEditEpoch.current === editEpoch)
                    setUxDraft(payload);
            }
        }
        catch (error) {
            if ((error as any)?.status === 409)
                setUxError(copy("版本已变化。保留当前编辑；请刷新并核对后再保存。"));
            else
                setUxError(copy(requestErrorKey(error)));
        }
        finally {
            setUxBusy(false);
        }
    };
    const decideOwner = async (candidate: Record<string, any>, decision: string) => {
        if (!model?.session.admin)
            return;
        const binding = ownerDecisionBinding({ ...candidate.candidate, candidate_evidence_sha256: candidate.candidate_evidence_sha256 }, decision);
        if (!binding)
            return;
        if (!await confirmAction({ title: t("记录所有者决定"), target: String(candidate.candidate?.candidate_id || t("候选")), summary: t("决定：{decision} · 证据：{digest}", { decision: decisionLabel(decision, t), digest: candidate.candidate_evidence_sha256 }), consequence: t("仅记录人工决定，不会直接启用策略。"), tone: "normal" }))
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
    const confirmRecovery = async (entry: Record<string, any>) => {
        if (!model?.session.admin)
            return;
        const binding = recoveryBinding(entry);
        if (!binding)
            return;
        const recovery = entry.recovery || {};
        if (!await confirmAction({ title: t("记录恢复前核对"), target: `${recovery.platform || t("未知平台")} / ${recovery.target_name || t("目标未读到")} · ${binding.recovery_id}`, summary: t("恢复目标摘要：{digest} · 双审摘要：{reviewDigest}", { digest: binding.candidate_sha256, reviewDigest: binding.dual_review_binding_sha256 }), consequence: t("只记录当前双审证据核对，不会重启目标或下单。"), tone: "danger" }))
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
    const rowsFiltered = rows.filter(row => {
        const text = `${row.platformLabel} ${row.account.label} ${row.account.key} ${row.current?.strategy_profile || ""}`.toLowerCase();
        return accountMatchesStatusFilter(filter, row.runtime?.account_state) && text.includes(search.trim().toLowerCase());
    });
    const activeForm = currentForm(active);
    const profileOptions = model?.config.value?.strategyProfiles || [];
    const allowedProfiles = profileOptions.filter(profile => !profile.domain || (platformSettings[active?.platform || ""]?.supported_domains || []).includes(profile.domain));
    const promotionRecords = model?.promotions.value?.tickets || [];
    const tickets = promotionRecords.filter((ticket: any) => ticket.state === "awaiting_human" && !ticket.source_check_required);
    const promotionNeedsReview = promotionRecords.filter((ticket: any) => ticket.state === "ready_for_review" || ticket.source_check_required);
    const selectedTicket = tickets.find((ticket: any) => ticket.ticket_id === promotionTicketId) || tickets[0] || null;
    const apps = model?.promotions.value?.applications || [];
    const selectedApp = apps.find((application: any) => application.ticket_id === (promotionTicketId || selectedTicket?.ticket_id)) || null;
    const appAccounts = selectedApp?.application_preparation?.account_options || [];
    const selectedAppAccount = appAccounts.find((account: any) => `${account.platform}:${account.key}` === promotionAccountId) || null;
    const pendingRecoveries = model?.recovery.value?.recoveries || [];
    const homeAttention = buildHomeAttention({
        control: model?.control, owners: model?.owners, promotions: model?.promotions,
        recovery: model?.recovery, runtime: model?.runtime, config: model?.config,
        accounts: rows.map(row => {
            const status = statusFor(row);
            return { id: row.id, title: `${row.platformLabel} · ${row.account.label || row.account.target_name || row.account.key}`, tone: status.tone, label: status.label, detail: status.detail };
        }),
    });
    const openHomeAttention = (item: (typeof homeAttention.decisions)[number] | (typeof homeAttention.operations)[number]) => {
        if (item.target === "accounts" && item.targetId) setSelectedId(item.targetId);
        if (item.kind === "promotion" && item.targetId) setPromotionTicketId(item.targetId);
        setPageAndRoute(item.target);
        const focusId = item.kind === "owner" ? `home-owner-${encodeURIComponent(item.targetId || "")}`
            : item.kind === "promotion" ? "home-promotions"
            : item.kind === "recovery" || item.kind === "recovery_blocked" ? `home-recovery-${encodeURIComponent(item.targetId || "")}`
            : item.kind === "account" ? "home-account-details" : null;
        if (focusId) window.setTimeout(() => document.getElementById(focusId)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    };
    const renderOverview = () => <>
    <div className="page-title-row"><div><h1>{t("账户总览")}</h1><p>{t("账户状态、重要变化与待决定事项。资产估值来源尚未接入。")}</p></div><button className="button button-secondary" onClick={() => void refresh()} disabled={refreshing} type="button">{refreshing ? t("\u8BFB\u53D6\u4E2D\u2026") : t("\u5237\u65B0\u8D44\u6599")}</button></div>
    <section className="review-banner"><span className="review-mark" aria-hidden="true">!</span><div><h2>{model?.runtime.value?.data_status === "ready" ? t("\u8FD0\u884C\u8D44\u6599\u53EF\u4F9B\u6838\u5BF9") : t("\u8FD0\u884C\u8D44\u6599\u5C1A\u5F85\u6838\u5BF9")}</h2><p>{t("\u914D\u7F6E\u542F\u7528\u4E0D\u4EE3\u8868\u5B9E\u9645\u8FD0\u884C\u6B63\u5E38\uFF1B\u7F3A\u5C11\u8BFB\u56DE\u65F6\u4FDD\u6301\u672A\u77E5\u3002")}</p></div><button className="button button-primary" onClick={() => setPageAndRoute("accounts")} type="button">{t("\u67E5\u770B\u8D26\u6237")}</button></section>
    <section className="coverage-row"><div><span>{t("\u7EB3\u5165\u8D26\u6237")}</span><strong>{model?.config.value?.accountOptions ? rows.length : "—"}</strong><small>{t("\u5F53\u524D\u914D\u7F6E\u53EF\u89C1\u8D26\u6237")}</small></div><div><span>{t("\u8FD0\u884C\u8D44\u6599")}</span><strong>{t(valueStatus(model?.runtime))}</strong><DetailTime title={t("\u6765\u6E90\u65F6\u95F4")} value={sourceTime(model?.runtime.value)}/></div><div><span>{t("\u8D44\u4EA7\u8868\u73B0")}</span><strong>{t("\u6682\u4E0D\u53EF\u8BC4\u4F30")}</strong><small>{t("\u5B8C\u6574\u4F30\u503C\u4E0E\u8D44\u91D1\u6D41\u8BB0\u5F55\u5C1A\u672A\u63A5\u5165")}</small></div></section>
    <div className="overview-grid"><section className="primary-column">
      <section className="performance-empty"><div className="performance-title"><div><h2>{t("\u8D44\u4EA7\u8868\u73B0")}</h2><p>{t("\u51C0\u503C\u5E8F\u5217\u548C\u8D44\u91D1\u6D41\u53E3\u5F84\u5C1A\u672A\u5B8C\u6574\u63A5\u5165\u3002")}</p></div><span className="metric-unavailable">{t("\u6682\u4E0D\u53EF\u8BC4\u4F30")}</span></div><div className="chart-empty"><strong>{t("\u6682\u65E0\u53EF\u9A8C\u8BC1\u7684\u8D44\u4EA7\u4F30\u503C\u5E8F\u5217")}</strong><p>{t("\u8D44\u91D1\u6D41\u7F3A\u5931\u65F6\uFF0C\u4E0D\u4EE5\u8D26\u6237\u8FD0\u884C\u6570\u636E\u4EE3\u66FF\u8D44\u4EA7\u6216\u6536\u76CA\u8868\u73B0\u3002")}</p></div><div className="source-row"><span>{t("\u6700\u8FD1\u4F30\u503C\uFF1A\u672A\u63D0\u4F9B")}</span><span>{t("\u53EF\u7528\u73B0\u91D1\uFF1A\u672A\u63A5\u5165")}</span><span>{t("\u6536\u76CA\u4E0E\u56DE\u64A4\uFF1A\u6682\u4E0D\u53EF\u8BA1\u7B97")}</span></div></section>
      <div className="section-heading"><h2>{t("\u8D26\u6237\u8FD0\u884C")}</h2><button className="text-link" type="button" onClick={() => setPageAndRoute("accounts")}>{t("\u8D26\u6237\u8BE6\u60C5 \u2192")}</button></div>
      <div className="overview-toolbar"><div className="overview-filters">{[["all", t("\u5168\u90E8")], ["normal", t("\u6B63\u5E38")], ["paused", t("\u6682\u505C")], ["abnormal", t("\u5F02\u5E38/\u672A\u77E5")]].map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div><input aria-label={t("\u641C\u7D22\u8D26\u6237\u6216\u7B56\u7565")} placeholder={t("\u641C\u7D22\u8D26\u6237\u6216\u7B56\u7565")} value={search} onChange={e => setSearch(e.target.value)}/></div>
      <AccountTable rows={rowsFiltered} model={model} onSelect={row => { setSelectedId(row.id); setPageAndRoute("accounts"); }}/>
    </section><aside className="decision-rail"><h2>{t("需要决定")}</h2>
      {homeAttention.decisions.length ? homeAttention.decisions.map(item => <div className="decision-entry" key={item.identity}><strong>{t(item.title)}</strong><p>{item.detail}</p><button type="button" className="text-link" onClick={() => openHomeAttention(item)}>{t("查看决定流程")} →</button></div>) : <p className="section-note">{homeAttention.sourceWarnings.length ? t("部分信息暂未更新；请在待办决策中查看。") : t("当前没有已确认的人工决定待办。")}</p>}
      {homeAttention.sourceWarnings.length > 0 && <details className="home-source-warning"><summary>{t("部分信息暂未更新")}</summary>{homeAttention.sourceWarnings.map(item => <p key={item.source}><strong>{t(item.source)}</strong> · {t(item.status)}</p>)}</details>}
    </aside></div>
    <section className="lower-strip"><div><h2>{t("账户设置")}</h2><p>{t("查看账户环境、当前策略与运行状态。")}</p><button className="button button-dark" type="button" onClick={() => setPageAndRoute("accounts")}>{t("查看账户设置 →")}</button></div><div><h2>{t("重要决定")}</h2><p>{t("候选和恢复确认仅在当前来源与证据有效时显示。")}</p><button className="button button-secondary" type="button" onClick={() => setPageAndRoute("strategy")}>{t("查看待办决策 →")}</button></div></section>
    {renderReports()}
  </>;
    const renderStrategy = () => {
        const valid = !uxDirty && currentResearchPreview(uxDraft as any);
        const preview = uxDraft.preview || null;
        const decision = valid ? preview?.decision_preview : null;
        const advanced = uxDraft.draft?.advanced_settings || {};
        const changeDraft = (patch: Partial<UxDraft["draft"]>, advancedPatch?: Record<string, any>) => { uxEditEpoch.current += 1; setUxDraft(prev => ({ ...prev, draft: { ...prev.draft, ...patch, advanced_settings: { ...(prev.draft?.advanced_settings || {}), ...(advancedPatch || {}) } }, preview: prev.preview, preview_stale: true })); setUxDirty(true); };
        const maybePromise = ["queued", "running", "unknown"].includes(String(uxDraft.job?.status || model?.research.value?.job?.status || ""));
        const ownerEntries = (model?.owners.value?.candidates || []).filter((entry: any) => !entry.intent);
        const recoveries = pendingRecoveries.filter((entry: any) => entry.freshness?.data_status === "ready" && entry.recovery?.readiness === "awaiting_human_confirmation" && !entry.confirmation);
        const staleRecoveries = pendingRecoveries.filter((entry: any) => entry.freshness?.data_status !== "ready" && !entry.confirmation);
        return <>
    <div className="page-title-row"><div><h1>{t("待办决策")}</h1><p>{t("查看建议，决定是否采用新策略方案或确认恢复账户。")}</p></div><DetailTime title={t("研究资料更新时间")} value={sourceTime(model?.research.value) || model?.research.value?.job?.updated_at}/></div>
      <div className="two-column-layout"><div className="page-main-column">
        <section className="content-section" id="home-promotions"><div className="section-heading"><h2>{t("新策略方案")}</h2><DetailTime title={t("\u961F\u5217\u66F4\u65B0\u65F6\u95F4")} value={sourceTime(model?.promotions.value)}/></div>
          {model?.promotions.error || model?.promotions.value?.data_status !== "ready" ? <Empty title={t("\u5019\u9009\u961F\u5217\u4E0D\u53EF\u786E\u8BA4")} detail={t("\u5F53\u524D\u65E0\u6CD5\u6838\u5BF9\u5019\u9009\u548C\u5E94\u7528\u72B6\u6001\u3002")}/> : <>
            {!tickets.length ? <Empty title={t("\u5F53\u524D\u6CA1\u6709\u5F85\u51B3\u5B9A\u5019\u9009")} detail={t("\u5DF2\u8BB0\u5F55\u7684\u5E94\u7528\u72B6\u6001\u4ECD\u4FDD\u7559\u5728\u4E0B\u65B9\u3002")}/> : <>
            <div className="field-grid"><label>{t("\u5F85\u786E\u8BA4\u5019\u9009")}<select value={selectedTicket?.ticket_id || ""} onChange={e => { setPromotionTicketId(e.target.value); setPromotionAccountId(""); }}><option value="">{t("\u9009\u62E9\u5019\u9009")}</option>{tickets.map((ticket: any) => <option key={ticket.ticket_id} value={ticket.ticket_id}>{ticket.ticket_id} · {ticket.strategy_profile}</option>)}</select></label>
              <label>{t("选择应用账户")}<select value={promotionAccountId} onChange={e => setPromotionAccountId(e.target.value)}><option value="">{t("\u9009\u62E9\u8D26\u6237")}</option>{appAccounts.map((account: any) => <option key={`${account.platform}:${account.key}`} value={`${account.platform}:${account.key}`}>{account.platform} · {account.label || account.key} · {brokerEnvironment(account.broker_environment, t)}</option>)}</select></label>
              <label>{t("风险档")}<select value={promotionRisk} onChange={e => setPromotionRisk(e.target.value)}>{PROMOTION_RISK.map(value => <option key={value} value={value}>{t(({ CAPITAL_PRESERVATION: "保守", BALANCED_COMPOUNDING: "均衡", GROWTH_COMPOUNDING: "增长" } as Record<string, string>)[value])}</option>)}</select></label></div>
            {selectedTicket && <><section className="decision-context"><h3>{t("是否接受该新策略方案？")}</h3><p>{t("策略")}: {selectedTicket.strategy_profile} · {t("研究领域")}: {domainLabel(selectedTicket.domain, t)}</p><h4>{t("影响与风险")}</h4><p>{selectedTicket.evidence_summary || selectedTicket.shadow_evidence_kind || t("候选需要结合研究证据判断。")}</p>{selectedTicket.research_summary?.limitations?.length ? <ul className="plain-list">{selectedTicket.research_summary.limitations.map((item: string, index: number) => <li key={`${index}:${item}`}>{item}</li>)}</ul> : <p>{t("暂无当前候选的额外风险说明。")}</p>}<p>{t("接受只记录意向，不授权实盘。")}</p></section>{(() => { const explanation = promotionAiExplanation(selectedTicket); return <section className="ai-explanation"><h3>{t("AI分析说明")}</h3>{explanation ? <><p>{explanation.text}</p><details><summary>{t("来源与模型")}</summary><p>{t("来源：研究候选说明")}</p><p>{t("模型")}: {explanation.model}</p><p>{t("此说明解释研究资料，不代表AI投资建议或交易授权。")}</p></details></> : <p>{t("尚无与当前候选绑定的AI说明。")}</p>}</section>; })()}</>}
            <div className="form-actions"><button type="button" className="button button-primary" disabled={!model?.session.admin || !selectedTicket || !selectedAppAccount || busy.promotion} onClick={() => void submitPromotion("accept")}>{t("\u63A5\u53D7\u610F\u5411")}</button><button type="button" className="button button-secondary" disabled={!model?.session.admin || !selectedTicket || busy.promotion} onClick={() => void submitPromotion("reject")}>{t("\u62D2\u7EDD")}</button></div>
            {!model?.session.admin && <p className="section-note">{t("\u6240\u6709\u8005\u51B3\u5B9A\u4EC5\u7BA1\u7406\u5458\u53EF\u63D0\u4EA4\u3002")}</p>}
            </>}
            {promotionNeedsReview.length > 0 && <details><summary>{t("其他候选资料尚在准备，暂不能作出决定")}</summary>{promotionNeedsReview.map((ticket: any) => <p key={ticket.ticket_id}>{ticket.strategy_profile} · {t(ticket.source_check_required ? "需要补充来源资料" : "等待审查")} · {ticket.ticket_id}</p>)}</details>}
            {apps.filter((item: any) => item.application_preparation).map((application: any) => <ApplicationCard key={application.ticket_id} application={application} selectedAccountId={promotionAccountId} busy={busy[`apply:${application.ticket_id}`] || onceLocks.current.isLocked(`apply:${application.ticket_id}`)} onSelectAccount={setPromotionAccountId} onDeploy={() => void applyPromotion(application)}/>)}
          </>}
        </section>
        <section className="content-section"><div className="section-heading"><h2>{t("策略去留")}</h2><DetailTime title={t("\u6765\u6E90\u65F6\u95F4")} value={sourceTime(model?.owners.value)}/></div>
          {model?.owners.error || model?.owners.value?.data_status !== "ready" ? <Empty title={t("\u51B3\u5B9A\u961F\u5217\u72B6\u6001\u672A\u77E5")} detail={t("\u5F53\u524D\u65E0\u6CD5\u6838\u5BF9\u6240\u6709\u8005\u51B3\u5B9A\u8D44\u6599\u3002")}/> : !ownerEntries.length ? <Empty title={t("\u6CA1\u6709\u5F85\u786E\u8BA4\u51B3\u5B9A")} detail={t("\u5F53\u524D\u6765\u6E90\u6CA1\u6709\u53EF\u786E\u8BA4\u7684\u6240\u6709\u8005\u51B3\u5B9A\u3002")}/> : ownerEntries.map((entry: any) => { const candidate = entry.candidate; const id = candidate?.candidate_id; return <div className="decision-card" id={`home-owner-${encodeURIComponent(id || "")}`} key={id}><strong>{id}</strong><p>{decisionLabel(candidate?.recommendation?.code || candidate?.lifecycle?.status, t)}</p><p>{t("尚无与当前候选绑定的AI说明。")}</p><div className="form-actions">{[["approve_limited_live_canary", t("\u6709\u9650\u6267\u884C\u89C2\u5BDF")], ["keep_parked", t("\u4FDD\u6301\u6682\u505C")], ["retire_candidate", t("\u9000\u5F79\u5019\u9009")]].map(([value, label]) => <button key={value} className="button button-secondary" disabled={!model?.session.admin || busy[`owner:${id}`]} onClick={() => void decideOwner(entry, value)} type="button">{label}</button>)}</div></div>; })}
        </section>
        <section className="content-section"><div className="section-heading"><h2>{t("\u6062\u590D\u524D\u786E\u8BA4")}</h2><DetailTime title={t("\u6765\u6E90\u65F6\u95F4")} value={sourceTime(model?.recovery.value)}/></div>
          {model?.recovery.error || model?.recovery.value?.data_status !== "ready" ? <Empty title={t("\u6062\u590D\u8D44\u6599\u5C1A\u672A\u6838\u5B9E")} detail={t("状态：{status}", { status: t(valueStatus(model?.recovery)) })}/> : recoveries.length ? recoveries.map((entry: any) => <RecoveryCard key={entry.recovery?.recovery_id} entry={entry} canConfirm={Boolean(model?.session.admin && recoveryBinding(entry))} onConfirm={() => void confirmRecovery(entry)} busy={busy[`recovery:${entry.recovery?.recovery_id}`]}/>) : <Empty title={t(staleRecoveries.length ? "恢复资料暂不可确认" : "当前无待确认恢复事项")} detail={t(staleRecoveries.length ? "部分资料尚未更新；当前不能确认恢复。" : "当前没有需要人工确认的恢复事项。")}/> }
        </section>
        <details className="supporting-research"><summary>{t("研究草案与历史结果")}</summary>        <section className="content-section ux-editor"><div className="section-heading"><h2>{t("\u7814\u7A76\u8349\u6848\u4E0E\u5386\u53F2\u7ED3\u679C")}</h2><span>{t("版本 {revision} {dirty}",{revision:uxDraft.revision ?? 0,dirty:uxDirty?t("\u00B7 \u6709\u672A\u4FDD\u5B58\u7F16\u8F91"):""})}</span></div>
          <div className="research-metrics"><div><span>{t("\u5386\u53F2\u5E74\u5316\u6536\u76CA")}</span><strong>—</strong><small>{t("\u5B8C\u6574\u51C0\u503C\u66F2\u7EBF\u4E0D\u8DB3")}</small></div><div><span>{t("\u6700\u5927\u56DE\u64A4")}</span><strong>—</strong><small>{t("\u65E0\u6CD5\u4ECE\u5355\u6B21\u9884\u89C8\u8BA1\u7B97")}</small></div><div><span>{t("\u98CE\u9669\u5224\u65AD")}</span><strong>{t("\u5F85\u8BC4\u4F30")}</strong><small>{t("\u975E\u8D26\u6237\u5B89\u5168\u5224\u65AD")}</small></div></div>
          <details className="research-settings"><summary>{t("研究参数与生成操作")}</summary>
          <div className="field-grid"><label>{t("\u7814\u7A76\u76EE\u6807")}<OptionList values={["one_step_net_log_score", "global_optimum"]} value={uxDraft.draft?.objective || "one_step_net_log_score"} labels={{ one_step_net_log_score: t("\u4E00\u6B65\u51C0\u5BF9\u6570\u8BC4\u5206"), global_optimum: t("\u5168\u5C40\u6700\u4F18\uFF08\u5F53\u524D\u4E0D\u53C2\u4E0E\u8BA1\u7B97\uFF09") }} onChange={value => changeDraft({ objective: value })}/></label>
            <label>{t("\u5386\u53F2\u6848\u4F8B")}<OptionList values={["r8_first_dynamic_2023_03_29", "original_full_v2"]} value={uxDraft.draft?.research_case_id || "r8_first_dynamic_2023_03_29"} labels={{ r8_first_dynamic_2023_03_29: "R8 · 2023-03-29", original_full_v2: t("\u539F\u5B8C\u6574 v2\uFF08\u672C\u6B21\u672A\u6620\u5C04\uFF09") }} onChange={value => changeDraft({ research_case_id: value })}/></label></div>
          <p className="section-note">{t("\u751F\u6210\u53EA\u8BFB\u53D6\u51BB\u7ED3\u5386\u53F2\u7814\u7A76\u6848\u4F8B\uFF0C\u4E0D\u4F1A\u4E0B\u5355\u3002\u7814\u7A76\u98CE\u683C\u504F\u597D\u8BA1\u7B97\u5C1A\u672A\u63A5\u5165\uFF0C\u4EE5\u4E0B\u8BBE\u7F6E\u4EC5\u662F\u73B0\u6709\u8349\u6848\u5B57\u6BB5\u3002")}</p>
          <details className="advanced-form"><summary>{t("\u4E13\u4E1A\u7814\u7A76\u8BBE\u7F6E")}</summary><div className="field-grid">
            {[["plugin_mode", t("\u63D2\u4EF6\u6A21\u5F0F"), ["none", "auto", "current"]], ["income_layer_mode", t("\u6536\u5165\u5C42"), ["enabled", "disabled", "current"]], ["option_overlay_mode", t("\u671F\u6743\u5C42"), ["current", "enabled", "disabled"]], ["reserve_policy_mode", t("\u73B0\u91D1\u9884\u7559"), ["current", "none", "ratio", "floor", "max"]], ["cash_only_execution_mode", t("\u4EC5\u73B0\u91D1\u6267\u884C"), ["current", "enabled", "disabled"]], ["dca_mode", t("\u5B9A\u6295\u6A21\u5F0F"), ["fixed", "smart"]]].map(([key, label, options]: any) => <label key={key}>{label}<OptionList values={options} value={String(advanced[key] ?? "")} labels={{ "": t("\u672A\u58F0\u660E"), none: t("无插件"), auto: t("自动选择"), current: t("保持当前设置"), enabled: t("启用"), disabled: t("停用"), fixed: t("固定金额"), smart: t("智能定投"), ratio: t("比例"), floor: t("固定金额下限"), max: t("金额与比例取较大值") }} onChange={value => changeDraft({}, { [key]: value })}/></label>)}
            {[["income_layer_start_usd", t("\u6536\u5165\u5C42\u8D77\u59CB\u91D1\u989D")], ["income_layer_max_ratio", t("\u6536\u5165\u5C42\u6700\u9AD8\u6BD4\u4F8B")], ["min_reserved_cash_usd", t("\u6700\u5C0F\u9884\u7559\u73B0\u91D1")], ["reserved_cash_ratio", t("\u9884\u7559\u73B0\u91D1\u6BD4\u4F8B")], ["dca_base_investment_usd", t("\u5B9A\u6295\u57FA\u51C6\u91D1\u989D")]].map(([key, label]) => <label key={key}>{label}<input value={String(advanced[key] ?? "")} inputMode="decimal" onChange={e => changeDraft({}, { [key]: e.target.value })}/></label>)}
          </div></details>
          <div className="form-actions"><button className="button button-secondary" type="button" disabled={uxBusy} onClick={() => void runUx("save")}>{t("\u4FDD\u5B58\u7814\u7A76\u8349\u6848")}</button><button className="button button-primary" type="button" disabled={uxBusy || maybePromise} onClick={() => void runUx("preview")}>{uxBusy ? t("\u5904\u7406\u4E2D\u2026") : maybePromise ? t("\u7814\u7A76\u4EFB\u52A1\u5904\u7406\u4E2D") : t("\u751F\u6210\u7814\u7A76\u65B9\u6848")}</button><button className="button button-secondary" type="button" disabled={uxBusy || !valid || maybePromise} onClick={() => void runUx("intent")}>{t("\u4FDD\u5B58\u4E0D\u53EF\u6267\u884C\u610F\u5411")}</button><button className="button button-secondary" type="button" onClick={() => setUxCompare(value => !value)}>{uxCompare ? t("\u9690\u85CF\u52A8\u4F5C\u5BF9\u7167") : t("\u6BD4\u8F83\u65B9\u6848")}</button></div>
          </details>
          {uxError && <p className="inline-error" role="alert">{renderLocaleMessage(uxError,language)}</p>}
          <p className="section-note">{t("研究状态：{status} · 过期或结果不明时，不会沿用旧预览。", { status: ({ queued: t("\u6392\u961F\u4E2D"), running: t("\u8FD0\u884C\u4E2D"), unknown: t("\u7ED3\u679C\u5F85\u786E\u8BA4"), stale: t("\u5DF2\u8FC7\u671F"), computed: t("\u5DF2\u5B8C\u6210") } as Record<string, string>)[String(uxDraft.job?.status || preview?.status || "")] || t("\u65E0\u5F85\u5904\u7406\u4EFB\u52A1") })}</p>
          {valid && decision ? <div className="research-result"><h3>{t("\u5F53\u524D\u6709\u6548\u5386\u53F2\u9884\u89C8")}</h3><dl className="fact-list"><div><dt>{t("\u72B6\u6001")}</dt><dd>{t(displayStatus(preview?.status))}</dd></div><div><dt>{t("\u9009\u4E2D\u52A8\u4F5C")}</dt><dd>{decisionLabel(decision.selected_action, t)}</dd></div><div><dt>{t("\u5386\u53F2\u60C5\u666F\u6570")}</dt><dd>{decision.scenario_count ?? "—"}</dd></div><div><dt>{t("\u51B3\u7B56\u65E5\u671F")}</dt><dd>{decision.decision_date || "—"}</dd></div><div><dt>{t("\u6B21\u65E5\u6838\u5BF9")}</dt><dd>{preview?.historical_execution_check?.trade_date || t("\u672A\u63D0\u4F9B")}</dd></div></dl><details><summary>{t("\u6765\u6E90\u4E0E\u9650\u5236")}</summary><pre>{JSON.stringify(preview, null, 2)}</pre></details></div> : <Empty title={maybePromise ? t("研究任务仍在处理") : model?.research.error ? t("\u7814\u7A76\u72B6\u6001\u6682\u4E0D\u53EF\u7528") : t("\u6682\u65E0\u6709\u6548\u9884\u89C8\u7ED3\u679C")} detail={t("\u5F53\u524D\u53EA\u663E\u793A\u4E0E\u672C\u8349\u6848 revision/fingerprint \u7ED1\u5B9A\u7684\u6709\u6548\u7ED3\u679C\u3002\u65E7\u7ED3\u679C\u5931\u6548\u6216\u8BFB\u53D6\u5931\u8D25\u65F6\u4E0D\u4F1A\u6CBF\u7528\u3002")}/>}
          {uxCompare && valid && <div className="compare-view"><h3>{t("\u52A8\u4F5C\u5BF9\u7167")}</h3><pre>{JSON.stringify(preview?.comparison || preview?.action_comparison || preview?.decision_preview || {}, null, 2)}</pre></div>}
          <details className="research-evidence"><summary>{t("\u67E5\u770B\u4F9D\u636E\u4E0E\u5B8C\u6574\u7ED3\u679C")}</summary><pre>{JSON.stringify(preview || uxDraft.intent || {}, null, 2)}</pre></details>
        </section></details>
      </div><aside className="editorial-rail"><h2>{t("决策边界")}</h2><p>{t("确认前查看说明；接受方案不会直接开启实盘。")}</p><details><summary>{t("查看操作说明")}</summary><p>{t("研究、候选接受、应用部署、运行启停是不同操作；各自按现有权限和版本证据执行。")} </p><div className="rail-step"><span>01</span><strong>{t("\u8BFB\u6765\u6E90\u548C\u72B6\u6001")}</strong><p>{t("\u8FC7\u671F\u6216\u672A\u77E5\u7ED3\u679C\u4E0D\u53EF\u7EE7\u7EED\u786E\u8BA4\u3002")}</p></div><div className="rail-step"><span>02</span><strong>{t("\u663E\u5F0F\u786E\u8BA4")}</strong><p>{t("敏感操作保留原角色校验和二次确认。")}</p></div></details></aside></div>
    </>;
    };
    async function submitPromotion(decision: "accept" | "reject") {
        if (!model?.session.admin || !selectedTicket || busy.promotion)
            return;
        const appAccount = selectedAppAccount;
        const mode = appAccount?.broker_environment;
        if (decision === "accept" && (!appAccount || !["live", "paper"].includes(mode) || (mode === "paper" && appAccount.platform !== "longbridge")))
            return;
        if (!await confirmAction({ title: t(decision === "accept" ? "记录候选采纳意向" : "拒绝研究候选"), target: String(selectedTicket.ticket_id || t("研究候选")), summary: t("决定：{decision} · 当前状态：{status} · 风险偏好：{risk}", { decision: decisionLabel(decision, t), status: displayStatus(selectedTicket.state), risk: decision === "accept" ? riskLabel(promotionRisk, t) : t("不适用") }), consequence: t(decision === "accept" ? "仅记录人工意向，不会启动交易或部署。" : "将记录拒绝决定，之后需重新读取候选状态。"), tone: decision === "accept" ? "normal" : "danger" }))
            return;
        setBusy(prev => ({ ...prev, promotion: true }));
        try {
            await postJson("/api/research-promotion-decisions", { ticket_id: selectedTicket.ticket_id, decision, confirmation: decision === "accept" ? { target_platform: appAccount.platform, execution_mode: mode, risk_profile: promotionRisk } : null, ...(decision === "accept" ? { selected_account: { platform: appAccount.platform, key: appAccount.key } } : {}), expected_proposed_params: selectedTicket.proposed_params || {}, expected_strategy_profile: selectedTicket.strategy_profile, expected_domain: selectedTicket.domain });
            void refresh();
        }
        catch (error) {
            setErrorMessage(copy("候选决定失败：{error}",{error:copy(requestErrorKey(error))}));
        }
        finally {
            setBusy(prev => ({ ...prev, promotion: false }));
        }
    }
    async function applyPromotion(application: Record<string, any>) {
        if (!model?.session.admin)
            return;
        if (!applicationRetryAllowed(application.application))
            return;
        const selected = (application.application_preparation?.account_options || []).find((a: any) => `${a.platform}:${a.key}` === promotionAccountId);
        if (!selected || application.application_preparation?.preflight_status !== "ready" || !application.application_preparation?.preview_request)
            return;
        if (selected.platform !== "longbridge" || selected.broker_environment !== "paper")
            return;
        if (!await confirmAction({ title: t("提交模拟账户应用请求"), target: `${selected.label || selected.key} · ${selected.platform} ${selected.broker_environment}`, summary: t("候选：{ticket} · 预检：{status}", { ticket: application.ticket_id, status: t(displayStatus(application.application_preparation?.preflight_status)) }), consequence: t("只提交模拟账户应用请求，不会自动启用策略或提交订单。"), tone: "normal" }))
            return;
        const key = `apply:${application.ticket_id}`;
        if (!beginOnce(key))
            return;
        let submitted = false;
        try {
            const instance = await getJson<any>("/api/admin/runtime-instances");
            submitted = true;
            await postJson("/api/research-promotion-applications", { ticket_id: application.ticket_id, selected_account: { platform: selected.platform, key: selected.key }, expected_revision: Number(instance.revision) });
            void refresh();
            setErrorMessage(copy("应用请求已提交；请核对读回状态后再继续。"));
        }
        catch (error) {
            setErrorMessage(copy("应用请求结果需要读回确认，避免重复提交。{detail}",{detail:error?copy(" · {error}",{error:copy(requestErrorKey(error))}):""}));
            if (submitted)
                void refresh();
        }
        finally {
            finishOnce(key, !submitted);
        }
    }
    const renderAccounts = () => <>
    <div className="page-title-row"><div><h1>{t("账户设置")}</h1><p>{t("查看账户环境、当前策略与运行状态。")}</p></div><DetailTime title={t("\u8FD0\u884C\u8D44\u6599\u65F6\u95F4")} value={sourceTime(model?.runtime.value)}/></div>
    <div className="two-column-layout"><div className="page-main-column">
      <section className="content-section"><div className="section-heading"><h2>{t("\u8D26\u6237\u6E05\u5355")}</h2><span>{model?.config.error ? t("\u8D26\u6237\u914D\u7F6E\u4E0D\u53EF\u8BFB") : formatAccountCount(rows.length, language)}</span></div>
        <div className="account-selector-row"><label>{t("\u9009\u62E9\u8D26\u6237")}<select value={active?.id || ""} onChange={e => setSelectedId(e.target.value)}>{rows.map(row => <option key={row.id} value={row.id}>{row.platformLabel} · {row.account.label || row.account.target_name}</option>)}</select></label></div>
        <AccountTable rows={rows} model={model} selected={active?.id} onSelect={row => setSelectedId(row.id)}/>
      </section>
      {active && activeForm ? <section className="content-section account-editor"><div className="section-heading"><h2>{t("{account} · 账户状态", { account: active.account.label || active.account.target_name })}</h2></div>
        <AccountFacts row={active}/>
        <AccountSettingsPanel platform={active.platform} accountKey={active.account.key} admin={Boolean(model?.session.admin)} />
        {(() => { const view = diagnosisUserSummary(diagnosis[active.id]); const refreshOnly = view.action === "refresh"; return <section className="diagnosis-panel"><h3>{t("账户检查")}</h3><strong>{t(view.status)}</strong><p>{t(view.reason)}</p><button className="button button-secondary" type="button" disabled={!model?.session.allowed || busy[`diagnosis-read:${active.id}`] || busy[`diagnosis:${active.id}`] || diagnosis[active.id]?.loading || (!refreshOnly && diagnosis[active.id]?.available !== true)} onClick={() => refreshOnly ? void readDiagnosisStatus(active) : void runDiagnosis(active)}>{busy[`diagnosis-read:${active.id}`] || busy[`diagnosis:${active.id}`] || diagnosis[active.id]?.loading ? t("正在检查…") : t(refreshOnly ? "刷新状态" : "检查账户")}</button>{diagnosis[active.id]?.available === true && diagnosis[active.id]?.task && <details><summary>{t("查看技术详情")}</summary><p>{t(diagnosisStatusKey(diagnosis[active.id]?.task))}</p><pre>{JSON.stringify(diagnosis[active.id]?.task, null, 2)}</pre></details>}</section>; })()}
        <details className="strategy-settings"><summary>{t("\u7B56\u7565\u4E0E\u8FD0\u884C\u8BBE\u7F6E")}</summary>
          <div className="field-grid"><label>{t("\u8FD0\u884C\u7B56\u7565")}<select value={activeForm.strategy} onChange={e => updateForm(active, { strategy: e.target.value })}><option value="">{t("\u9009\u62E9\u7B56\u7565")}</option>{allowedProfiles.map(profile => <option key={profile.profile} value={profile.profile}>{profile.label || profile.profile}</option>)}</select></label>
          <label>{t("\u6267\u884C\u65B9\u5F0F")}<OptionList values={(platformSettings[active.platform]?.supported_execution_modes || ["dry_run"]).filter((v: string) => v === "live" || v === "dry_run")} value={activeForm.executionMode} labels={{ live: t("\u6267\u884C\uFF08live\uFF0C\u6309\u8D26\u6237\u73AF\u5883\u8DEF\u7531\uFF09"), dry_run: t("\u7981\u6B62\u4E0B\u5355\u9A8C\u8BC1\uFF08dry_run\uFF09") }} onChange={value => updateForm(active, { executionMode: value })}/></label>
          <label>{t("\u8D26\u6237\u76EE\u6807\u542F\u505C")}<OptionList values={["current", "enabled", "disabled"]} value={activeForm.runtimeMode} labels={{ current: t("\u4FDD\u6301\u5F53\u524D\u8BBE\u7F6E"), enabled: t("\u542F\u7528\u914D\u7F6E"), disabled: t("\u505C\u7528\u76EE\u6807") }} onChange={value => updateForm(active, { runtimeMode: value as SwitchDraft["runtimeMode"] })}/></label>
          <label>{t("\u63D2\u4EF6 plugin_mode")}<OptionList values={["current", "none", "auto"]} value={activeForm.pluginMode} labels={{ current: t("保持当前设置"), none: t("无插件"), auto: t("自动选择") }} onChange={value => updateForm(active, { pluginMode: value as SwitchDraft["pluginMode"], touched: { pluginMode: true } })}/></label>
          {platformSettings[active.platform]?.income_layer && <><label>{t("\u6536\u5165\u5C42\u72B6\u6001")}<OptionList values={["current", "enabled", "disabled"]} value={activeForm.incomeMode} labels={{ current: t("保持当前设置"), enabled: t("启用"), disabled: t("停用") }} onChange={value => updateForm(active, { incomeMode: value as SwitchDraft["incomeMode"], touched: { income: true } })}/></label><label>{t("\u6536\u5165\u5C42\u8D77\u59CB\u91D1\u989D")}<input value={activeForm.incomeStart} inputMode="decimal" onChange={e => updateForm(active, { incomeStart: e.target.value, touched: { income: true } })}/></label><label>{t("\u6536\u5165\u5C42\u6700\u9AD8\u6BD4\u4F8B")}<input value={activeForm.incomeRatio} inputMode="decimal" onChange={e => updateForm(active, { incomeRatio: e.target.value, touched: { income: true } })}/></label></>}
          {platformSettings[active.platform]?.option_overlay && <label>{t("\u671F\u6743\u5C42")}<OptionList values={["current", "enabled", "disabled"]} value={activeForm.optionMode} labels={{ current: t("保持当前设置"), enabled: t("启用"), disabled: t("停用") }} onChange={value => updateForm(active, { optionMode: value as SwitchDraft["optionMode"], touched: { option: true } })}/></label>}
          {platformSettings[active.platform]?.margin_policy && <label>{t("\u4EC5\u73B0\u91D1\u4E0B\u5355")}<OptionList values={["current", "enabled", "disabled"]} value={activeForm.cashOnlyMode} labels={{ current: t("\u4FDD\u6301\u5F53\u524D\u8BBE\u7F6E"), enabled: t("\u5F00\u542F\uFF08\u4EC5\u73B0\u91D1\uFF09"), disabled: t("\u5173\u95ED\uFF08\u5141\u8BB8\u878D\u8D44\uFF0C\u53D7\u8D26\u6237\u6743\u9650\u7EA6\u675F\uFF09") }} onChange={value => updateForm(active, { cashOnlyMode: value as SwitchDraft["cashOnlyMode"], touched: { cashOnly: true } })}/></label>}
          {platformSettings[active.platform]?.reserved_cash && <><label>{t("\u9884\u7559\u73B0\u91D1\u653F\u7B56")}<OptionList values={["current", "none", "ratio", "floor", "max"]} value={activeForm.reserveMode} labels={{ current: t("\u4FDD\u6301\u5F53\u524D\u8BBE\u7F6E"), none: t("\u6E05\u9664\u9884\u7559"), ratio: t("\u6BD4\u4F8B"), floor: t("\u56FA\u5B9A\u91D1\u989D"), max: t("\u91D1\u989D\u4E0E\u6BD4\u4F8B\u53D6\u8F83\u5927\u503C") }} onChange={value => updateForm(active, { reserveMode: value as SwitchDraft["reserveMode"], touched: { reserve: true } })}/></label><label>{t("\u6700\u5C0F\u9884\u7559\u91D1\u989D")}<input value={activeForm.reserveFloor} inputMode="decimal" onChange={e => updateForm(active, { reserveFloor: e.target.value, touched: { reserve: true } })}/></label><label>{t("\u9884\u7559\u6BD4\u4F8B\uFF080\u20131\uFF09")}<input value={activeForm.reserveRatio} inputMode="decimal" onChange={e => updateForm(active, { reserveRatio: e.target.value, touched: { reserve: true } })}/></label></>}
          {platformSettings[active.platform]?.dca && DCA_SUPPORTED_PLATFORMS.has(active.platform) && <><label>{t("\u5B9A\u6295\u6A21\u5F0F")}<OptionList values={["fixed", "smart"]} value={activeForm.dcaMode} labels={{ fixed: t("固定金额"), smart: t("智能定投") }} onChange={value => updateForm(active, { dcaMode: value as SwitchDraft["dcaMode"], touched: { dca: true } })}/></label><label>{t("\u5B9A\u6295\u57FA\u51C6\u91D1\u989D")}<input value={activeForm.dcaBase} inputMode="decimal" onChange={e => updateForm(active, { dcaBase: e.target.value, touched: { dca: true } })}/></label></>}
          </div>
          <p className="section-note">{t("摘要预览：{platform} / {target} · 券商环境 {environment} · {strategy} · 执行（{execution}）· 启停 {runtime}。执行方式不会改变账户环境或权限。", { platform: active.platform, target: active.account.target_name, environment: brokerEnvironment(active.account.broker_environment, t), strategy: activeForm.strategy || t("\u672A\u9009\u62E9\u7B56\u7565"), execution: executionMode(activeForm.executionMode, t), runtime: t(displayStatus(activeForm.runtimeMode)) })}</p>
          <div className="form-actions"><button className="button button-primary" type="button" disabled={(!ACCOUNT_PLAN_SUBMISSION_AVAILABLE && activeForm.runtimeMode !== "disabled") || !model?.session.allowed || switchLocks.current.has(active.id) || busy[`switch:${active.id}`] || busy[`stop:${active.id}`] || (active.platform === "longbridge" && (active.account.target_name || active.account.key) === "hk" && activeForm.runtimeMode === "disabled" && !hkStopSubmitAllowed(stopRecords[active.id]))} onClick={() => void submitAccountPlan(active)}>{switchLocks.current.has(active.id) ? t("\u8BF7\u6C42\u5DF2\u63D0\u4EA4\uFF0C\u7B49\u5F85\u8BFB\u56DE") : !ACCOUNT_PLAN_SUBMISSION_AVAILABLE && activeForm.runtimeMode !== "disabled" ? t("设置保存暂未接通") : activeForm.runtimeMode === "disabled" ? t("\u63D0\u4EA4\u505C\u7528\u8BF7\u6C42") : t("\u63D0\u4EA4\u8BA1\u5212")}</button><button className="button button-secondary" type="button" onClick={() => void navigator.clipboard?.writeText(`${active.platform} ${active.account.label || active.account.key}\n${activeForm.strategy}\n${activeForm.executionMode}`)}>{t("\u590D\u5236\u6458\u8981")}</button></div>
          <p className="section-note">{t("账户计划提交暂未接通；当前可以查看设置，停用入口仍按原确认流程执行。")}</p>
        </details>
        <div className="account-safety-actions"><button className="button button-danger" type="button" disabled={!model?.session.allowed || switchLocks.current.has(active.id) || busy[`stop:${active.id}`] || (active.platform === "longbridge" && (active.account.target_name || active.account.key) === "hk" && !hkStopSubmitAllowed(stopRecords[active.id]))} onClick={() => void submitAccountPlan(active, true)}>{busy[`stop:${active.id}`] ? t("正在提交…") : active.platform === "longbridge" && (active.account.target_name || active.account.key) === "hk" && !hkStopSubmitAllowed(stopRecords[active.id]) ? t("停用结果未知，不能再次提交") : t("提交停用请求")}</button>{active.platform === "longbridge" && (active.account.target_name || active.account.key) === "hk" && <button className="button button-secondary" type="button" onClick={() => void refreshStopRecord(active)}>{t("刷新停用状态")}</button>}{active.platform === "binance" && canResumeBinance(active.platform, active.account, active.current) && <button type="button" className="button button-secondary" disabled={busy[`resume:${active.id}`] || onceLocks.current.isLocked(`resume:${active.id}`)} onClick={() => void resumeBinance(active)}>{t("恢复现有 Binance 目标")}</button>}</div>
        {active.platform === "longbridge" && (active.account.target_name || active.account.key) === "hk" && stopRecords[active.id]?.phase === "accepted" && <p className="section-note">{t("工作流已接受，平台是否停用仍未确认。")}</p>}
        {active.platform === "longbridge" && (active.account.target_name || active.account.key) === "hk" && ["unknown", "reserved", "unavailable", "loading"].includes(stopRecords[active.id]?.phase) && <p className="section-note">{t("停用结果未知，不能再次提交。可以只读刷新。")}</p>}
        {active.platform === "longbridge" && (active.account.target_name || active.account.key) === "hk" && stopRecords[active.id]?.phase === "rejected" && <p className="section-note">{t("停用请求已被明确拒绝。")}</p>}
        {active.platform === "longbridge" && (active.account.target_name || active.account.key) === "hk" && stopRecords[active.id]?.runtime_observation?.status === "stopped" && <p className="section-note">{t("运行目标观测为已停用，这不表示该请求已成功。")}</p>}
      </section> : <Empty title={t("\u8D26\u6237\u914D\u7F6E\u6682\u4E0D\u53EF\u7528")} detail={t("API \u672A\u8FD4\u56DE\u53EF\u7528\u8D26\u6237\uFF0C\u672A\u4F7F\u7528\u9ED8\u8BA4\u8D26\u6237\u66FF\u4EE3\u3002")}/>}
      <section className="content-section"><h2>{t("\u7B56\u7565\u5065\u5EB7")}</h2><div className="overview-filters">{[["attention", t("\u9700\u8981\u5173\u6CE8")], ["all", t("\u5168\u90E8\u7B56\u7565")]].map(([key, label]) => <button key={key} aria-pressed={healthFilter === key} onClick={() => setHealthFilter(key)} type="button">{label}</button>)}</div><SourceList source={model?.health} items={(model?.health.value?.strategies || []).filter((entry: any) => healthFilter === "all" || entry.status !== "healthy").map((entry: any) => t("{profile} · {status} · {score} · {date}", { profile: entry.profile || entry.strategy_id, status: t(displayStatus(entry.status)), score: entry.score ?? "—", date: stamp(entry.as_of, language) }))} empty={t("\u6682\u65E0\u7B56\u7565\u5065\u5EB7\u8BB0\u5F55")}/></section>
      </div><aside className="editorial-rail"><h2>{t("\u8FD0\u884C\u8FB9\u754C")}</h2><p>{t("\u505C\u7528\u65B0\u89E6\u53D1\u4E0D\u7B49\u4E8E\u64A4\u5355\u3001\u5E73\u4ED3\u6216\u6E05\u9664\u5728\u9014\u8BF7\u6C42\u3002")}</p><details><summary>{t("运行检查详情（技术信息）")}</summary>{active && <><p>{t("配置读回、运行监测和成交证据分别核对。")}</p><DetailTime title={t("\u8D26\u6237\u68C0\u67E5")} value={active.runtime?.target?.deployment?.observed_at}/></>}{(model?.runtime.value?.targets || []).filter((item: any) => item.target?.target?.platform === active?.platform).map((item: any) => <pre key={item.target.target_id}>{JSON.stringify(item, null, 2)}</pre>)}</details></aside></div>
  </>;
    const renderReports = () => {
      const reportSources: Array<[string, Source<any> | undefined, Page]> = [["账户运行检查", model?.runtime, "accounts"], ["策略健康快照", model?.health, "strategy"], ["历史研究结果", model?.research, "strategy"], ["控制平面与待办", model?.control, "strategy"], ["执行与成交证据", model?.evidence, "accounts"], ["自动化研究任务", model?.tasks, "strategy"], ["外部市场研究", model?.market, "strategy"], ["系统建议", model?.adaptive, "strategy"]];
      const needsReview = reportSources.filter(([, source]) => valueStatus(source) !== "可供核对");
      return <details className="report-details"><summary>{t("查看账户资料与历史来源")}</summary><div className="report-details-body">
      <section className="content-section"><h2>{t("报告行动摘要")}</h2><p>{t("没有已核实的账户资产表现；请查看账户运行资料。")}</p>{needsReview.length ? <ul className="plain-list">{needsReview.map(([label, source, target]) => <li key={label}><strong>{t(label)}</strong> · {t(valueStatus(source))} <button className="text-link" type="button" onClick={() => setPageAndRoute(target)}>{target === "accounts" ? t("查看账户") : t("查看资料")} →</button></li>)}</ul> : <p className="section-note">{t("现有报告来源可供核对；账户资产表现仍未接入。")}</p>}</section>
      <details className="report-details"><summary>{t("查看全部报告来源与技术细节")}</summary>
      <section className="content-section"><h2>{t("\u6765\u6E90\u72B6\u6001")}</h2><SourceCatalog model={model} onNavigate={setPageAndRoute}/></section>
      <section className="content-section"><h2>{t("\u7B56\u7565\u5065\u5EB7\u5FEB\u7167")}</h2><DetailTime title={t("计算时间")} value={sourceTime(model?.health.value)}/><SourceList source={model?.health} items={(model?.health.value?.strategies || []).map((s: any) => t("{profile} · {status} · {date}", { profile: s.profile || s.strategy_id, status: t(displayStatus(s.status)), date: stamp(s.as_of, language) }))} empty={t("\u6CA1\u6709\u7B56\u7565\u5065\u5EB7\u8BB0\u5F55")}/></section>
      <section className="content-section"><h2>{t("\u6267\u884C\u4E0E\u6210\u4EA4\u8BC1\u636E")}</h2><DetailTime title={t("\u6765\u6E90\u65F6\u95F4")} value={sourceTime(model?.evidence.value)}/><SourceList source={model?.evidence} items={(model?.evidence.value?.deployments || []).map((item: any) => t("{platform} · {strategy} · {status}", { platform: item.platform || t("\u672A\u77E5\u5E73\u53F0"), strategy: item.strategy_profile || t("\u7B56\u7565\u672A\u8BFB\u5230"), status: t(displayStatus(item.status || item.execution_status)) }))} empty={t("\u6CA1\u6709\u53EF\u5C55\u793A\u7684\u6267\u884C\u8BC1\u636E")}/></section>
      <section className="content-section"><h2>{t("\u7814\u7A76\u4EFB\u52A1")}</h2><DetailTime title={t("计算时间")} value={sourceTime(model?.tasks.value)}/><SourceList source={model?.tasks} items={(model?.tasks.value?.tasks || []).map((item: any) => t("{id} · {status} · {date}", { id: item.task_id || item.request_id, status: t(displayStatus(item.status)), date: stamp(item.updated_at, language) }))} empty={t("\u6CA1\u6709\u5DF2\u8BFB\u53D6\u7684\u7814\u7A76\u4EFB\u52A1")}/></section>
      <section className="content-section"><h2>{t("\u5916\u90E8\u7814\u7A76 / \u7CFB\u7EDF\u5EFA\u8BAE")}</h2><SourceList source={model?.market} items={(model?.market.value?.subjects || []).map((item: any) => { const subject = summarizeExternalResearchSubject(item, t("\u672A\u77E5")); return t("{subject} · {status} · {date}", { subject: subject.title, status: t(displayStatus(subject.status)), date: stamp(subject.asOf, language) }); })} empty={t("\u5C1A\u65E0\u53EF\u5C55\u793A\u7684\u5E02\u573A\u7814\u7A76\u8BB0\u5F55")}/><SourceList source={model?.adaptive} items={(model?.adaptive.value?.selections || []).map((item: any) => t("{candidate} · {status}", { candidate: item.candidate_id || item.strategy_profile || t("\u5019\u9009"), status: t(displayStatus(item.status)) }))} empty={t("\u6682\u65E0\u7CFB\u7EDF\u5EFA\u8BAE")}/></section>
      <section className="content-section"><h2>{t("\u6570\u636E\u7F3A\u53E3")}</h2><p className="section-note large-note">{t("\u5B8C\u6574\u8D44\u4EA7\u65E5\u62A5\u3001\u8D26\u6237\u51C0\u503C\u5386\u53F2\u548C\u8D44\u91D1\u6D41\u53E3\u5F84\u5C1A\u672A\u63A5\u5165\u3002\u51C0\u503C\u66F2\u7EBF\u4F1A\u53D7\u5230\u5165\u91D1\u4E0E\u51FA\u91D1\u5F71\u54CD\uFF1B\u8D44\u91D1\u6D41\u7F3A\u5931\u65F6\uFF0C\u4E0D\u8BA1\u7B97\u5E74\u5316\u6536\u76CA\u6216\u6700\u5927\u56DE\u64A4\u3002")}</p></section>
      </details>
      </div></details>;
    };
    const renderAdmin = () => <AdminPanel model={adminModel} session={model?.session} text={adminText} setText={setAdminText} risk={adminRisk} setRisk={setAdminRisk} instanceDraft={instanceDraft} setInstanceDraft={setInstanceDraft} editing={editingInstance} setEditing={setEditingInstance} busy={busy} setBusy={setBusy} onRefresh={() => void refresh()} onError={setErrorMessage} confirmAction={confirmAction}/>;
    if (bootState === "loading" && !model)
        return <LocaleContext.Provider value={language}><main className="boot-screen" aria-live="polite">{t("\u6B63\u5728\u8BFB\u53D6\u540C\u6E90\u914D\u7F6E\u3001\u8FD0\u884C\u72B6\u6001\u4E0E\u7814\u7A76\u8D44\u6599\u2026")}</main></LocaleContext.Provider>;
    if (bootState === "denied")
        return <LocaleContext.Provider value={language}><main className="access-screen"><QslIcon /><h1>{t("\u9700\u8981\u91CD\u65B0\u9A8C\u8BC1\u8BBF\u95EE")}</h1><p>{t("\u767B\u5F55\u5DF2\u5931\u6548\u6216\u5F53\u524D\u8D26\u53F7\u65E0\u6743\u67E5\u770B\u6B64\u9875\u9762\u3002\u654F\u611F\u8D44\u6599\u5DF2\u6E05\u9664\u3002")}</p><a className="button button-primary" href="/login">{t("\u91CD\u65B0\u767B\u5F55")}</a></main></LocaleContext.Provider>;
    if (bootState === "error" && !model)
        return <LocaleContext.Provider value={language}><main className="access-screen"><QslIcon /><h1>{t("\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u63A7\u5236\u53F0")}</h1><p>{t("\u540C\u6E90\u4F1A\u8BDD\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\u3002")}</p><button className="button button-primary" onClick={() => void refresh()} type="button">{t("\u91CD\u8BD5")}</button></main></LocaleContext.Provider>;
    if (adminPath && !model?.session.admin)
        return <LocaleContext.Provider value={language}><main className="access-screen"><QslIcon /><h1>{t("\u4EC5\u9650\u7BA1\u7406\u5458")}</h1><p>{t("\u6B64\u8D26\u6237\u6CA1\u6709\u7BA1\u7406\u6743\u9650\u3002")}</p><button type="button" className="button button-primary" onClick={() => { setAdminPath(false); setPageAndRoute("overview"); }}>{t("\u8FD4\u56DE\u8D44\u4EA7\u603B\u89C8")}</button></main></LocaleContext.Provider>;
    return <LocaleContext.Provider value={language}><><div className="app-shell" inert={Boolean(confirmDialog)}>
    <header className="topbar"><button className="brand" type="button" onClick={() => setPageAndRoute("overview")} aria-label={t("\u8D44\u4EA7\u603B\u89C8")}><QslIcon /><span><strong>QuantStrategyLab</strong><small>{t("\u6295\u8D44\u7EC4\u5408\u8FD0\u884C\u63A7\u5236\u53F0")}</small></span>{model?.session.synthetic && <span className="synthetic-badge">{t("\u5408\u6210\u6F14\u793A")}</span>}</button>
      <nav className="primary-nav" aria-label={language === "zh" ? t("\u4E3B\u5BFC\u822A") : "Main navigation"}>{NAV.map(item => <button key={item.id} className={!adminPath && page === item.id ? "active" : ""} aria-current={!adminPath && page === item.id ? "page" : undefined} onClick={() => setPageAndRoute(item.id)} type="button">{t(item.label)}</button>)}</nav>
      <div className="top-controls"><span className="signed-in">{model?.session.login || (language === "zh" ? t("\u5DF2\u767B\u5F55") : "Signed in")}</span>{model?.session.admin && <button className={`text-link admin-shortcut ${adminPath ? "active" : ""}`} aria-current={adminPath ? "page" : undefined} type="button" onClick={enterAdmin}>{language === "zh" ? t("\u7BA1\u7406\u8BBE\u7F6E") : "Admin"}</button>}<label className="theme-control"><span>{language === "zh" ? t("\u4E3B\u9898") : "Theme"}</span><select aria-label={language === "zh" ? t("\u4E3B\u9898") : "Theme"} value={theme} onChange={e => setTheme(normalizeThemePreference(e.target.value))}><option value="system">{language === "zh" ? t("\u7CFB\u7EDF") : "System"}</option><option value="light">{language === "zh" ? t("\u6D45\u8272") : "Light"}</option><option value="dark">{language === "zh" ? t("\u6DF1\u8272") : "Dark"}</option></select></label><label className="language-control"><span>{language === "zh" ? t("\u8BED\u8A00") : "Language"}</span><select aria-label={language === "zh" ? t("\u8BED\u8A00") : "Language"} value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="zh">{t("\u4E2D\u6587")}</option><option value="en">English</option></select></label><button className="refresh-top" type="button" onClick={() => void refresh()} disabled={refreshing} aria-label={language === "zh" ? t("\u5237\u65B0\u8D44\u6599") : "Refresh data"}>↻</button><button className="button button-secondary" type="button" onClick={() => void logout()}>{language === "zh" ? t("\u9000\u51FA") : "Sign out"}</button></div>
    </header>
    {errorMessage && <div className="global-notice" role="status"><span>{renderLocaleMessage(errorMessage,language)}</span><button type="button" onClick={() => setErrorMessage(null)} aria-label={t("\u5173\u95ED\u63D0\u793A")}>{t("\u5173\u95ED")}</button></div>}
    <main className="main-content" key={adminPath ? "admin" : page}>{adminPath ? renderAdmin() : page === "overview" ? renderOverview() : page === "strategy" ? renderStrategy() : renderAccounts()}</main>
    <footer className="page-footer"><span>QuantStrategyLab</span><span>{t("\u53EA\u663E\u793A\u73B0\u6709\u8D44\u6599\uFF1B\u6743\u9650\u7531\u670D\u52A1\u7AEF\u4F1A\u8BDD\u51B3\u5B9A\u3002")}</span><DetailTime title={t("最近刷新")} value={model?.runtime.value?.computed_at}/></footer>
  </div>{confirmDialog && <ConfirmationDialog dialog={confirmDialog} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)}/>}</></LocaleContext.Provider>;
    async function runDiagnosis(row: AccountRow) {
        if (!model?.session.allowed || !row.account.key || diagnosis[row.id]?.available !== true || !beginOnce(`diagnosis:${row.id}`))
            return;
        try {
            const platform = row.platform;
            const key = row.account.key;
            const current = await getJson<any>(`/api/account-diagnosis?platform=${encodeURIComponent(platform)}&key=${encodeURIComponent(key)}`);
            const existing = current.task || null;
            setDiagnosis(prev => ({ ...prev, [row.id]: { available: true, loading: false, task: existing } }));
            if (["queued", "running", "unknown"].includes(String(existing?.status || "")) || (existing?.status === "succeeded" && existing?.recheck_status === "sent"))
                return;
            const trigger = row.runtime?.freshness?.data_status === "ready" && (row.runtime?.execution_observation?.code === "attention" || row.runtime?.target?.monitoring?.runtime_guard === "attention") ? "incident" : "manual_check";
            const result = await postJson<any>("/api/account-diagnosis", { platform, key, trigger });
            setDiagnosis(prev => ({ ...prev, [row.id]: { available: true, loading: false, task: result.task || null } }));
        }
        catch (error) {
            if (error instanceof AccessError)
                clearPrivateState(false);
            else
                setDiagnosis(prev => ({ ...prev, [row.id]: { ...prev[row.id], available: false, loading: false } }));
            setErrorMessage(copy("诊断请求未完成：{error}",{error:copy(requestErrorKey(error))}));
        }
        finally {
            finishOnce(`diagnosis:${row.id}`);
        }
    }
    async function readDiagnosisStatus(row: AccountRow) {
        if (!model?.session.allowed || !row.account.key || busy[`diagnosis-read:${row.id}`])
            return;
        setBusy(prev => ({ ...prev, [`diagnosis-read:${row.id}`]: true }));
        try {
            const result = await getJson<any>(`/api/account-diagnosis?platform=${encodeURIComponent(row.platform)}&key=${encodeURIComponent(row.account.key)}`);
            setDiagnosis(prev => ({ ...prev, [row.id]: { available: true, loading: false, task: result.task || null } }));
        }
        catch (error) {
            if (error instanceof AccessError)
                clearPrivateState(false);
            else
                setDiagnosis(prev => ({ ...prev, [row.id]: { ...prev[row.id], available: false, loading: false } }));
        }
        finally {
            setBusy(prev => ({ ...prev, [`diagnosis-read:${row.id}`]: false }));
        }
    }
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
      <p className={`confirm-consequence ${dialog.tone}`}>{dialog.consequence}</p>
      <div className="confirm-actions"><button ref={cancelRef} className="button button-secondary" type="button" onClick={onCancel}>{t("\u53D6\u6D88")}</button><button className={`button ${dialog.tone === "danger" ? "button-danger" : "button-primary"}`} type="button" onClick={onConfirm}>{t("\u786E\u8BA4\u7EE7\u7EED")}</button></div>
    </div>
  </div>;
}
function AccountTable({ rows, model, selected, onSelect }: {
    rows: AccountRow[];
    model: ReadModel | null;
    selected?: string;
    onSelect: (row: AccountRow) => void;
}) {
    const t = useT();
    const language = useLocale();
    if (model?.config.error || !model?.config.value?.accountOptions)
        return <Empty title={t("\u8D26\u6237\u6E05\u5355\u6682\u4E0D\u53EF\u7528")} detail={t("\u6CA1\u6709\u53EF\u9760\u8D26\u6237\u914D\u7F6E\u8BFB\u56DE\uFF1B\u4E0D\u4F1A\u4EE5\u6837\u4F8B\u6216\u9ED8\u8BA4\u8D26\u6237\u4EE3\u66FF\u3002")}/>;
    if (!rows.length)
        return <Empty title={t("\u6CA1\u6709\u5339\u914D\u8D26\u6237")} detail={t("\u8BF7\u8C03\u6574\u641C\u7D22\u6761\u4EF6\u6216\u7B5B\u9009\u3002")}/>;
    return <div className="table-scroll"><table className="account-table"><thead><tr><th>{t("\u8D26\u6237")}</th><th>{t("当前策略")}</th><th>{t("\u8FD0\u884C\u72B6\u6001")}</th><th>{t("\u6700\u8FD1\u68C0\u67E5")}</th><th /></tr></thead><tbody>{rows.map(row => { const status = statusFor(row); return <tr key={row.id} className={selected === row.id ? "selected-row" : undefined}><td><strong>{row.account.label || row.account.target_name}</strong><small>{row.platformLabel}{row.account.account_selector ? ` · ${row.account.account_selector}` : ""}</small></td><td><small>{row.current?.strategy_profile || t("\u7B56\u7565\u672A\u8BFB\u5230")}</small></td><td><span className={`status-text ${status.tone}`}><i aria-hidden="true"/>{t(status.label)}</span><small>{t(status.detail)}</small></td><td>{stamp(row.runtime?.target?.deployment?.observed_at, language)}<small>{t(displayStatus(row.runtime?.deployment_freshness?.data_status || row.runtime?.freshness?.data_status || model?.runtime.value?.data_status))}</small></td><td><button type="button" className="text-link" onClick={() => onSelect(row)}>{t("\u67E5\u770B \u2192")}</button></td></tr>; })}</tbody></table></div>;
}
function AccountFacts({ row }: {
    row: AccountRow;
}) {
    const t = useT();
    const status = statusFor(row);
    const target = row.runtime?.target;
    const facts: Array<[
        string,
        string
    ]> = [[t("当前策略"), row.current?.strategy_profile || t("未读取")], [t("券商环境"), brokerEnvironment(row.account.broker_environment, t)]];
    return <><p className="detail-status"><span className={`status-text ${status.tone}`}>{t(status.label)}</span><span>{t(status.detail)}</span></p><dl className="fact-list">{facts.map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl><details><summary>{t("查看运行状态详情")}</summary><dl className="fact-list"><div><dt>{t("配置状态")}</dt><dd>{row.current?.runtime_target_enabled === true ? t("已配置启用") : row.current?.runtime_target_enabled === false ? t("已配置停用") : t("未知")}</dd></div><div><dt>{t("监测状态")}</dt><dd>{t(displayStatus(target?.monitoring?.runtime_guard))}</dd></div><div><dt>{t("执行心跳")}</dt><dd>{t(displayStatus(target?.monitoring?.execution_heartbeat))}</dd></div><div><dt>{t("目标编号")}</dt><dd>{row.account.runtime_status_target_id || t("未绑定")}</dd></div><div><dt>{t("调度状态")}</dt><dd>{t(displayStatus(target?.deployment?.scheduler_state))}</dd></div><div><dt>{t("执行方式")}</dt><dd>{executionMode(target?.deployment?.execution_mode,t)}</dd></div></dl><DetailTime title={t("\u8FD0\u884C\u68C0\u67E5\u65F6\u95F4")} value={target?.deployment?.observed_at}/>{row.runtime && <p className="section-note">{t("\u8FD0\u884C\u68C0\u67E5\u4E0D\u5305\u542B\u8BA2\u5355\u6216\u6210\u4EA4\u56DE\u62A5\u3002")}</p>}</details></>;
}
function SourceList({ source, items, empty }: {
    source?: Source<any>;
    items: string[];
    empty: string;
}) {
    const t = useT();
    if (source?.error || !source?.value)
        return <Empty title={t("\u6765\u6E90\u6682\u4E0D\u53EF\u7528")} detail={source?.error || t("\u6CA1\u6709\u8BFB\u56DE\u6570\u636E\u3002")}/>;
    if (source.value.data_status && source.value.data_status !== "ready")
        return <Empty title={t("来源状态：{status}", { status: t(displayStatus(source.value.data_status)) })} detail={t("尚未核实来源时，不能按没有记录处理。")}/>;
    return items.length ? <ul className="plain-list">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="section-note">{empty}</p>;
}
function SourceCatalog({ model, onNavigate }: {
    model: ReadModel | null;
    onNavigate: (page: Page) => void;
}) {
    const t = useT();
    const items: [
        string,
        Source<any> | undefined,
        Page
    ][] = [["账户运行检查", model?.runtime, "accounts"], ["策略健康快照", model?.health, "strategy"], ["历史研究结果", model?.research, "strategy"], ["控制平面与待办", model?.control, "strategy"], ["执行与成交证据", model?.evidence, "accounts"], ["自动化研究任务", model?.tasks, "strategy"], ["外部市场研究", model?.market, "strategy"], ["系统建议", model?.adaptive, "strategy"]];
    return <div className="source-list">{items.map(([title, source, page]) => <div className="source-row-item" key={title}><strong>{t(title)}</strong><span className={`source-state ${source?.value?.data_status === "ready" ? "" : "unknown"}`}>{t(valueStatus(source))}</span><DetailTime title={t("\u66F4\u65B0\u65F6\u95F4")} value={sourceTime(source?.value)}/><button className="text-link" type="button" onClick={() => onNavigate(page)}>{page === "accounts" ? t("\u67E5\u770B\u8D26\u6237") : t("\u67E5\u770B\u8D44\u6599")} →</button></div>)}</div>;
}
function ApplicationCard({ application, busy, selectedAccountId, onSelectAccount, onDeploy }: {
    application: Record<string, any>;
    busy?: boolean;
    selectedAccountId: string;
    onSelectAccount: (value: string) => void;
    onDeploy: () => void;
}) {
    const t = useT();
    const prep = application.application_preparation || {};
    const previous = application.application || null;
    const retryAllowed = applicationRetryAllowed(previous);
    const accounts = (prep.account_options || []).filter((account: any) => account.platform === "longbridge" && account.broker_environment === "paper");
    const selected = accounts.find((account: any) => `${account.platform}:${account.key}` === selectedAccountId);
    const status = previous ? `${t(displayStatus(previous.status))} · ${t(displayStatus(previous.dispatch_state))}` : t("尚无应用记录");
    return <article className="application-card"><strong>{t("模拟账户应用 · {ticket}", { ticket: application.ticket_id })}</strong>
        <p>{t("预检：{preflight} · 应用：{status}", { preflight: t(displayStatus(prep.preflight_status)), status })}</p>
        {prep.blocker_codes?.length > 0 && <p>{t("{count} 项需核对", { count: prep.blocker_codes.length })}</p>}
        <label className="application-account">{t("目标账户")}<select value={selected ? selectedAccountId : ""} onChange={event => onSelectAccount(event.target.value)}>
            <option value="">{t("请明确选择 LongBridge 模拟账户")}</option>
            {accounts.map((account: any) => <option key={`${account.platform}:${account.key}`} value={`${account.platform}:${account.key}`}>{t("{account} · 券商模拟环境", { account: account.label || account.key })}</option>)}
        </select></label>
        <button className="button button-secondary" type="button" disabled={busy || !retryAllowed || !selected || prep.preflight_status !== "ready" || !prep.preview_request} onClick={onDeploy}>{busy ? t("正在提交…") : retryAllowed ? previous ? t("重试已明确拒绝的请求") : t("提交模拟账户应用请求") : t("已有请求，等待读回确认")}</button>
        <p className="section-note">{t(retryAllowed ? "仅对明确选择且通过现有预检的 LongBridge 模拟账户开放；应用、启用与下单权限相互独立。" : "服务端已有应用记录；仅明确拒绝后允许重新提交，状态未知或处理中时保持锁定。")}</p>
    </article>;
}
function RecoveryCard({ entry, canConfirm, onConfirm, busy }: {
    entry: Record<string, any>;
    canConfirm: boolean;
    onConfirm: () => void;
    busy?: boolean;
}) {
    const t = useT();
    const r = entry.recovery || {};
    return <article className="decision-card"><strong>{r.platform || t("未知平台")} · {r.strategy_profile || t("策略未读到")}</strong>
        <p>{t("确认只表示已检查恢复材料，不会直接启用账户。")}</p>
        {entry.confirmation ? <span>{t("已记录恢复前确认")}</span> : canConfirm ? <button className="button button-secondary" disabled={busy} type="button" onClick={onConfirm}>{t("确认已核对")}</button> : null}
        <details><summary>{t("查看恢复检查详情")}</summary><p>{t("准备状态：{readiness} · 对账：{reconciliation}", { readiness: t(displayStatus(r.readiness)), reconciliation: t(displayStatus(r.reconciliation_state)) })}</p><p>{t("阻塞项：{blockers} · 双审：{review}", { blockers: Array.isArray(r.blocker_codes) && r.blocker_codes.length ? t("{count} 项需核对", { count: r.blocker_codes.length }) : t("无"), review: t(displayStatus(r.dual_review?.outcome)) })}</p>{!canConfirm && !entry.confirmation && <p className="section-note">{t("当前资料不满足双审绑定、freshness 或管理员条件，不能确认。")}</p>}<pre>{JSON.stringify({ recovery_id: r.recovery_id, candidate_sha256: r.candidate_sha256, dual_review: r.dual_review, last_observed_at: r.last_observed_at }, null, 2)}</pre></details>
    </article>;
}
function AccountSettingsPanel({ platform, accountKey, admin }: { platform: string; accountKey: string; admin: boolean }) {
    const t = useT();
    const controller = useRef(createAccountSettingsController()).current;
    const pendingRead = useRef<AccountSettingsOp | null>(null);
    const [, setTick] = useState(0);
    const sync = () => setTick((value) => value + 1);
    const selectedId = `${platform}:${accountKey}`;
    if (controller.selectedId() !== selectedId) pendingRead.current = controller.select({ platform, key: accountKey });
    const view = controller.view();
    const settings = view.settings;
    useEffect(() => {
        const op = pendingRead.current ?? controller.start("read");
        pendingRead.current = null;
        void (async () => {
            try {
                const payload = await loadAccountSettings(platform, accountKey);
                if (controller.applyRead(op, payload)) sync();
            } catch (error) {
                if (controller.applyUnavailable(op, error instanceof Error ? error.message : "account_settings_unavailable")) sync();
            }
        })();
        return () => { controller.abandon(op); };
    }, [platform, accountKey, controller]);
    const refreshAfterFailure = async (op: AccountSettingsOp) => {
        const refresh = controller.start("refresh");
        try {
            const payload = await loadAccountSettings(op.account.platform, op.account.key);
            if (controller.applyRefresh(refresh, payload)) sync();
        } catch {
            controller.abandon(refresh);
        }
    };
    const saveDraft = async () => {
        if (!admin || view.saving) return;
        const started = controller.startSave("draft");
        const body = controller.requestBody(started);
        if (!started || !body || !controller.markSaving(started, "draft")) return;
        sync();
        try {
            const currentBody = controller.requestBody(started);
            if (!currentBody) return;
            const saved = await postJson<Record<string, any>>("/api/account-settings", currentBody);
            if (!controller.isCurrent(started)) return;
            if (controller.applySave(started, saved, t("草案已保存，尚未改变实际运行。"))) sync();
        } catch (error) {
            const status = (error as { status?: number })?.status;
            if (!controller.fail(started, status === 409 ? t("版本已变化，未覆盖已保存内容。") : t("账户设置暂不可用。"))) return;
            sync();
            await refreshAfterFailure(started);
        } finally {
            if (controller.finish(started)) sync();
        }
    };
    const savePreference = async () => {
        if (!admin || view.saving) return;
        const started = controller.startSave("risk");
        const body = controller.requestBody(started);
        if (!started || !body || !controller.markSaving(started, "risk")) return;
        sync();
        try {
            const currentBody = controller.requestBody(started);
            if (!currentBody) return;
            const saved = await postJson<Record<string, any>>("/api/account-settings", currentBody);
            if (!controller.isCurrent(started)) return;
            if (controller.applySave(started, saved, t("风险偏好已保存，不改变执行限额或启用状态。"))) sync();
        } catch (error) {
            const status = (error as { status?: number })?.status;
            if (!controller.fail(started, status === 409 ? t("版本已变化，未覆盖已保存内容。") : t("账户设置暂不可用。"))) return;
            sync();
            await refreshAfterFailure(started);
        } finally {
            if (controller.finish(started)) sync();
        }
    };
    const effectiveStrategy = settings?.effective?.strategy_profile?.status === "known" ? settings.effective.strategy_profile.value : t("有效策略尚未读回，保持未知。");
    const broker = settings?.effective?.broker_environment?.status === "known" ? settings.effective.broker_environment.value : t("未知");
    return <section className="content-section account-settings-draft"><div className="section-heading"><h2>{t("有效配置")}</h2></div>
      {view.unavailable ? <p className="section-note">{t("账户设置暂不可用。")}</p> : <>
        <p className="section-note">{effectiveStrategy}</p>
        <p className="section-note">{t("券商环境只读。")} {broker}</p>
        {settings?.draft?.status === "identity_conflict" && <p className="section-note">{t("账户身份已变化，保留的旧草案不会当作当前设置。")}</p>}
        {settings?.operations?.apply_strategy === false && <p className="section-note">{t("策略应用尚未接通，保存不会生效。")}</p>}
        <div className="field-grid">
          <label>{t("策略覆盖")}<input value={view.draft.strategy} onChange={event => { controller.edit({ strategy: event.target.value, strategyTouched: true, clearStrategy: false }); sync(); }} /></label>
          <label>{t("收入层覆盖")}<select value={view.draft.income} onChange={event => { controller.edit({ income: event.target.value, incomeTouched: true }); sync(); }}><option value="">{t("不修改")}</option><option value="true">{t("开启")}</option><option value="false">{t("关闭覆盖")}</option><option value="clear">{t("清除覆盖")}</option></select></label>
          <label>{t("预留现金覆盖")}<input value={view.draft.floor} onChange={event => { controller.edit({ floor: event.target.value, floorTouched: true, clearFloor: false }); sync(); }} /></label>
          <label>{t("组合风险偏好")}<select value={view.preference} onChange={event => { controller.edit({ preference: event.target.value }); sync(); }}><option value="">{t("清除覆盖")}</option>{RISK_PROFILES.map(item => <option key={item} value={item}>{({ CAPITAL_PRESERVATION: t("保护资本"), BALANCED_COMPOUNDING: t("均衡复利"), GROWTH_COMPOUNDING: t("增长复利") } as Record<string, string>)[item]}</option>)}</select></label>
        </div>
        {settings?.draft?.status === "identity_conflict" && <label><input type="checkbox" checked={view.draft.acknowledge} onChange={event => { controller.edit({ acknowledge: event.target.checked }); sync(); }} />{t("确认替换已失效草案")}</label>}
        {admin && settings?.operations?.save_draft && <div className="form-actions"><button className="button button-secondary" type="button" disabled={Boolean(view.saving)} onClick={() => void saveDraft()}>{t("保存草案")}</button><button className="button button-secondary" type="button" disabled={Boolean(view.saving) || !Number.isSafeInteger(settings?.risk?.revision)} onClick={() => { controller.edit({ clearStrategy: true, strategyTouched: false }); sync(); }}>{t("清除策略覆盖")}</button><button className="button button-secondary" type="button" disabled={Boolean(view.saving)} onClick={() => { controller.edit({ clearFloor: true, floorTouched: false }); sync(); }}>{t("清除预留覆盖")}</button><button className="button button-secondary" type="button" disabled={Boolean(view.saving) || !Number.isSafeInteger(settings?.risk?.revision)} onClick={() => void savePreference()}>{t("保存风险偏好")}</button></div>}
        {view.notice && <p className="section-note" role="status">{view.notice}</p>}
      </>}
    </section>;
}

function AdminPanel({ model, session, text, setText, risk, setRisk, instanceDraft, setInstanceDraft, editing, setEditing, busy, setBusy, onRefresh, onError, confirmAction }: {
    model: AdminModel | null;
    session?: Session;
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
    return <><div className="page-title-row"><div><h1>{t("\u7BA1\u7406\u8BBE\u7F6E")}</h1><p>{t("\u7BA1\u7406\u8FD0\u884C\u5B9E\u4F8B\u3001\u767B\u5F55\u6743\u9650\u3001\u8D26\u6237\u8DEF\u7531\u4E0E\u98CE\u9669\u504F\u597D\uFF1B\u89D2\u8272\u6743\u9650\u4ECD\u7531 Worker \u6821\u9A8C\u3002")}</p></div><button type="button" className="button button-secondary" onClick={onRefresh}>{t("\u5237\u65B0\u7BA1\u7406\u8D44\u6599")}</button></div>
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
