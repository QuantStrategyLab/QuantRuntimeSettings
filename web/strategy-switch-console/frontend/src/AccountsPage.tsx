import { useContext, useEffect, useRef, useState } from "react";
import { loadAccountSettings, postJson } from "./api";
import { pendingDraftOverrides, createAccountSettingsController } from "./accountSettingsState";
import { LocaleContext, useT } from "./locales";
import { cashDraftDirty, dcaSettingsReadout, percentTextToRatio, ratioTextToPercent, readOnlyLayerState, reservedCashAmount, reservedCashEditor, safeActionVisibility } from "./presentation";

const PREFERENCES = [
  ["CAPITAL_PRESERVATION", "保守", "优先控制波动和亏损，接受较低的增长潜力。"],
  ["BALANCED_COMPOUNDING", "均衡", "兼顾长期增长与风险控制，接受一定波动。"],
  ["GROWTH_COMPOUNDING", "增长", "更看重长期增长，愿意承受较大的波动和回撤。"],
] as const;

export type AccountListItem = {
  id: string;
  platform: string;
  key: string;
  title: string;
  platformLabel: string;
  environment: string;
  strategy: string;
  strategyNote: string;
  statusLabel: string;
  activation: string;
};

export function AccountsPage({ rows, selectedId, detailOpen, settingsEpoch, refreshToken, stopAllowed, stopLabel, stopRefreshVisible, resumeVisible, onSelect, onBack, onDirty, onStop, onRefreshStop, onResume, onSettingsRead, resolveStrategy }: {
  rows: AccountListItem[];
  selectedId: string;
  detailOpen: boolean;
  settingsEpoch: number;
  refreshToken: number;
  stopAllowed: boolean;
  stopLabel: string;
  stopRefreshVisible: boolean;
  resumeVisible: boolean;
  onSelect: (id: string) => void;
  onBack: () => void;
  onDirty: (dirty: boolean) => void;
  onStop: () => void;
  onRefreshStop: () => void;
  onResume: () => void;
  onSettingsRead: (id: string, profile: string | null) => void;
  resolveStrategy: (profileId: string | null) => { name: string; note: string };
}) {
  const t = useT();
  const selected = rows.find(row => row.id === selectedId) || null;
  return <section className={`daily-page accounts-page${detailOpen ? " show-detail" : ""}`}>
    <div className="daily-heading"><h1>{t("账户设置")}</h1></div>
    <div className="accounts-layout">
      <div className="account-list">
        <table className="daily-table">
          <thead><tr><th>{t("账户")}</th><th>{t("当前策略")}</th><th>{t("状态")}</th><th>{t("运行控制")}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className={row.id === selectedId ? "selected" : ""} tabIndex={0} aria-selected={row.id === selectedId} onClick={() => onSelect(row.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.id); } }}>
            <td className="account-identity"><button type="button" className="table-link" onClick={event => { event.stopPropagation(); onSelect(row.id); }}><strong>{row.title}</strong></button><span className="account-field-label">{t("账户类型")}</span><small className="account-environment">{row.environment}</small></td>
            <td><span className="account-field-label">{t("当前策略")}</span><span className="account-field-value">{row.strategy === "未命名策略" ? t(row.strategy) : row.strategy}</span></td>
            <td><span className="account-field-label">{t("健康")}</span><span className="account-field-value">{t(row.statusLabel === "—" ? "待确认" : row.statusLabel)}</span></td>
            <td><span className="account-field-label">{t("启用")}</span><span className="account-field-value">{t(row.activation === "—" ? "待确认" : row.activation)}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      {selected && <DailyAccountSettings key={`${selected.id}:${settingsEpoch}`} row={selected} refreshToken={refreshToken} stopAllowed={stopAllowed} stopLabel={stopLabel} stopRefreshVisible={stopRefreshVisible} resumeVisible={resumeVisible} onBack={onBack} onDirty={onDirty} onStop={onStop} onRefreshStop={onRefreshStop} onResume={onResume} onSettingsRead={onSettingsRead} resolveStrategy={resolveStrategy} />}
    </div>
  </section>;
}

function observedProfile(settings: Record<string, any> | null): string | null {
  const raw = settings?.effective?.strategy_profile;
  return raw?.status === "known" && typeof raw.value === "string" && raw.value.trim() ? raw.value.trim() : null;
}

function DailyAccountSettings({ row, refreshToken, stopAllowed, stopLabel, stopRefreshVisible, resumeVisible, onBack, onDirty, onStop, onRefreshStop, onResume, onSettingsRead, resolveStrategy }: {
  row: AccountListItem;
  refreshToken: number;
  stopAllowed: boolean;
  stopLabel: string;
  stopRefreshVisible: boolean;
  resumeVisible: boolean;
  onBack: () => void;
  onDirty: (dirty: boolean) => void;
  onStop: () => void;
  onRefreshStop: () => void;
  onResume: () => void;
  onSettingsRead: (id: string, profile: string | null) => void;
  resolveStrategy: (profileId: string | null) => { name: string; note: string };
}) {
  const t = useT();
  const language = useContext(LocaleContext);
  const controller = useRef(createAccountSettingsController()).current;
  const [, setTick] = useState(0);
  const [readAttempt, setReadAttempt] = useState(0);
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">("loading");
  const sync = () => setTick(value => value + 1);
  const view = controller.view();
  const settings = view.settings;
  const savedPreference = typeof settings?.risk?.preference === "string" ? settings.risk.preference : "";
  const cashDirty = cashDraftDirty(view.draft);
  const incomeDirty = view.draft.incomeTouched === true;
  const optionDirty = view.draft.optionTouched === true;
  const strategyDirty = view.draft.strategyTouched === true;
  const draftDirty = cashDirty || incomeDirty || optionDirty || strategyDirty;
  const riskDirty = controller.riskDirty();
  const dirty = draftDirty || riskDirty;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    const accountId = `${row.platform}:${row.key}`;
    const same = controller.selectedId() === accountId;
    if (same && controller.view().saving) return;
    const kept = same && Boolean(controller.view().settings);
    const op = same ? controller.start("refresh") : controller.select({ platform: row.platform, key: row.key });
    if (!kept) setReadState("loading");
    let cancelled = false;
    void (async () => {
      try {
        const payload = await loadAccountSettings(row.platform, row.key);
        if (cancelled) return;
        const applied = same ? controller.applyRefresh(op, payload) : controller.applyRead(op, payload);
        if (!applied) return;
        onSettingsRead(accountId, observedProfile(controller.view().settings));
        setReadState("ready");
        sync();
      } catch (error) {
        const status = Number((error as { status?: number })?.status || 0);
        const message = status === 401 || status === 403 ? "没有权限读取这项设置。" : "账户设置暂时读不到。";
        if (cancelled) return;
        if (kept) {
          controller.abandon(op);
          return;
        }
        if (!controller.applyUnavailable(op, message)) return;
        onSettingsRead(accountId, null);
        setReadState("failed");
        sync();
      }
    })();
    return () => { cancelled = true; controller.abandon(op); };
  }, [row.platform, row.key, readAttempt, refreshToken, controller, onSettingsRead]);
  const savePreference = async () => {
    if (view.saving || view.review.risk || settings?.operations?.save_risk_preference !== true) return;
    const started = controller.startSave("risk");
    const body = controller.requestBody(started);
    if (!started || !body || !controller.markSaving(started, "risk")) return;
    sync();
    try {
      const currentBody = controller.requestBody(started);
      if (!currentBody) return;
      const saved = await postJson<Record<string, any>>("/api/account-settings", currentBody);
      if (!controller.isCurrent(started)) return;
      if (controller.applySave(started, saved, "偏好已保存")) sync();
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (!controller.fail(started, status === 409 ? "版本已变化，未覆盖已保存内容。" : "账户设置暂不可用。")) return;
      sync();
      const refresh = controller.start("refresh");
      try {
        const payload = await loadAccountSettings(started.account.platform, started.account.key);
        if (controller.applyRefresh(refresh, payload)) sync();
      } catch {
        controller.abandon(refresh);
      }
    } finally {
      if (controller.finish(started)) sync();
    }
  };
  const saveScoped = async (kind: "cash" | "income" | "option" | "strategy", ready: boolean) => {
    if (view.saving || !ready || view.review.draft || settings?.operations?.save_draft !== true) return;
    const started = controller.startSave(kind);
    const body = controller.requestBody(started);
    if (!started || !body || !controller.markSaving(started, "draft")) return;
    sync();
    try {
      const currentBody = controller.requestBody(started);
      if (!currentBody) return;
      const saved = await postJson<Record<string, any>>("/api/account-settings", currentBody);
      if (!controller.isCurrent(started)) return;
      if (controller.applySave(started, saved, "草案已保存")) sync();
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (!controller.fail(started, status === 409 ? "版本已变化，未覆盖已保存内容。" : "账户设置暂不可用。")) return;
      sync();
      const refresh = controller.start("refresh");
      try {
        const payload = await loadAccountSettings(started.account.platform, started.account.key);
        if (controller.applyRefresh(refresh, payload)) sync();
      } catch {
        controller.abandon(refresh);
      }
    } finally {
      if (controller.finish(started)) sync();
    }
  };
  const identityReady = Boolean(settings?.identity && !Array.isArray(settings.identity));
  const identityBlocked = settings?.draft?.status === "identity_conflict";
  const draftOpen = settings?.operations?.save_draft === true;
  const riskOpen = settings?.operations?.save_risk_preference === true;
  const canSaveRisk = readState === "ready" && riskOpen && identityReady && Number.isSafeInteger(settings?.risk?.revision);
  const canSaveCash = readState === "ready" && draftOpen && identityReady && !identityBlocked && Number.isSafeInteger(settings?.draft?.revision);
  const savedIncome = settings?.draft?.overrides?.income_layer_enabled === true ? "true" : settings?.draft?.overrides?.income_layer_enabled === false ? "false" : "";
  const incomeValue = view.draft.incomeTouched ? (view.draft.income === "clear" ? "" : view.draft.income) : savedIncome;
  const editor = reservedCashEditor(settings?.draft?.overrides, view.draft);
  const selectMode = view.draft.cashMode || editor.mode;
  const cashBody = pendingDraftOverrides(view.draft, "cash");
  const incomeBody = pendingDraftOverrides(view.draft, "income");
  const optionBody = pendingDraftOverrides(view.draft, "option");
  const strategyBody = pendingDraftOverrides(view.draft, "strategy");
  const cashSubmittable = Boolean(cashDirty && cashBody && Object.keys(cashBody).length);
  const incomeSubmittable = Boolean(incomeDirty && incomeBody && Object.keys(incomeBody).length);
  const currentCash = reservedCashAmount(settings?.effective?.reserved_cash_floor);
  const currentRatio = reservedCashAmount(settings?.effective?.reserved_cash_ratio);
  const pendingFloor = editor.mode === "inherit" || (editor.mode === "saved" && editor.floor === "") ? "" : editor.mode === "ratio" ? "0" : editor.floor;
  const pendingRatio = editor.mode === "inherit" || (editor.mode === "saved" && editor.ratio === "") ? "" : editor.mode === "floor" ? "0" : editor.ratio;
  const savedCash = Boolean(settings?.draft?.overrides && (Object.prototype.hasOwnProperty.call(settings.draft.overrides, "reserved_cash_floor") || Object.prototype.hasOwnProperty.call(settings.draft.overrides, "reserved_cash_ratio")));
  const showPendingFloor = selectMode !== "inherit" && pendingFloor !== "" && (cashDirty || savedCash);
  const showPendingRatio = selectMode !== "inherit" && pendingRatio !== "" && (cashDirty || savedCash);
  const typedFloor = view.draft.cashMode ? view.draft.floor : "";
  const typedPercent = view.draft.cashMode ? view.draft.percent : "";
  const amountInvalid = cashDirty && (selectMode === "floor" || selectMode === "both") && typedFloor !== "" && !/^\d+(?:\.\d+)?$/.test(typedFloor);
  const shareInvalid = cashDirty && (selectMode === "ratio" || selectMode === "both") && typedPercent !== "" && percentTextToRatio(typedPercent) === null;
  const strategyOptions = Array.isArray(settings?.strategy_options) ? settings.strategy_options : [];
  const savedStrategy = typeof settings?.draft?.overrides?.strategy_profile === "string" ? settings.draft.overrides.strategy_profile : "";
  const strategyValue = strategyDirty ? (view.draft.clearStrategy ? "" : view.draft.strategy) : savedStrategy;
  const strategyName = (profileId: string) => {
    const choice = strategyOptions.find((item: { profile?: string }) => item.profile === profileId);
    if (!choice) return resolveStrategy(profileId || null).name;
    const label = language === "en" ? choice.label_en : choice.label_zh;
    return typeof label === "string" && label ? label : choice.profile;
  };
  const savedBound = savedStrategy || observedProfile(settings) || "";
  const localBound = strategyDirty ? (view.draft.clearStrategy ? observedProfile(settings) || "" : view.draft.strategy) : savedBound;
  const strategyPending = strategyDirty && localBound !== savedBound;
  const optionDefined = (profileId: string) => strategyOptions.some((item: { profile?: string; option_overlay_enabled?: boolean }) => item.profile === profileId && item.option_overlay_enabled === true);
  const boundSupports = !strategyPending && settings?.operations?.save_option_draft === true && optionDefined(localBound);
  const savedOption = settings?.draft?.overrides?.option_overlay_enabled === true ? "true" : settings?.draft?.overrides?.option_overlay_enabled === false ? "false" : "";
  const optionValue = optionDirty ? (view.draft.option === "clear" ? "" : view.draft.option) : savedOption;
  const optionConcrete = optionDirty ? view.draft.option === "true" || view.draft.option === "false" : savedOption === "true" || savedOption === "false";
  const nextStrategy = strategyValue || observedProfile(settings) || "";
  const strategyBlocked = strategyDirty && optionConcrete && !optionDefined(nextStrategy) && !(view.draft.optionTouched && view.draft.option === "clear");
  const optionSubmittable = Boolean(optionDirty && optionBody && Object.keys(optionBody).length && (optionBody.option_overlay_enabled === null || boundSupports));
  const strategySubmittable = Boolean(strategyDirty && strategyBody && Object.prototype.hasOwnProperty.call(strategyBody, "strategy_profile") && !strategyBlocked);
  const chooseMode = (next: "inherit" | "floor" | "ratio" | "both") => {
    if (!view.draft.cashMode && editor.mode === next) return;
    if (next === "inherit") controller.edit({ cashMode: "inherit", floor: "", ratio: "", percent: "", floorTouched: true, ratioTouched: true, clearFloor: true, clearRatio: true });
    else if (next === "floor") controller.edit({ cashMode: "floor", floor: editor.mode === "ratio" ? "" : editor.floor, ratio: "0", percent: "0", floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false });
    else if (next === "ratio") controller.edit({ cashMode: "ratio", floor: "0", ratio: editor.mode === "floor" ? "" : editor.ratio, percent: editor.mode === "floor" ? "" : (view.draft.percent || editor.percent), floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false });
    else controller.edit({ cashMode: "both", floor: editor.mode === "ratio" ? "" : editor.floor, ratio: editor.mode === "floor" ? "" : editor.ratio, percent: editor.mode === "floor" ? "" : (view.draft.percent || editor.percent), floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false });
    sync();
  };
  const shareText = (value: string) => {
    const percent = ratioTextToPercent(value);
    return percent === "" ? t("未知") : `${percent}%`;
  };
  const layerText = (field: unknown) => {
    const state = readOnlyLayerState(field);
    return state === "on" ? t("开") : state === "off" ? t("关") : t("未知");
  };
  const actions = safeActionVisibility({ settingsUnavailable: Boolean(view.unavailable), activation: row.activation, refreshSupported: stopRefreshVisible, resumeSupported: resumeVisible });
  const strategy = resolveStrategy(observedProfile(settings));
  const dca = dcaSettingsReadout(settings?.effective);
  const selectedNote = PREFERENCES.find(([value]) => value === view.preference)?.[2] || "";
  const cashNotice = view.noticeGroup === "cash" && view.notice === "草案已保存";
  const incomeNotice = view.noticeGroup === "income" && view.notice === "草案已保存";
  const optionNotice = view.noticeGroup === "option" && view.notice === "草案已保存";
  const strategyNotice = view.noticeGroup === "strategy" && view.notice === "草案已保存";
  const riskNotice = view.noticeGroup === "risk" && view.notice === "偏好已保存";
  const otherNotice = view.notice && !cashNotice && !incomeNotice && !optionNotice && !strategyNotice && !riskNotice ? view.notice : "";
  const reading = readState === "loading";
  return <aside className={`account-detail${reading ? " is-loading" : ""}`} aria-busy={reading}>
    {reading ? <div className="settings-progress" role="progressbar" aria-label={t("正在读取账户设置")}><span className="settings-progress-bar" /><p className="settings-progress-hint" aria-hidden="true">{t("正在读取账户设置")}</p></div> : null}
    <button type="button" className="text-link mobile-back" onClick={onBack}>{t("返回账户列表")}</button>
    <h2>{row.title}</h2>
    {reading ? null : <p className="account-identity"><small className="account-environment">{row.environment}</small></p>}
    {reading ? null : readState === "failed" ? <p>{t(view.unavailable || "账户设置暂时读不到。")}<button type="button" className="text-link" onClick={() => setReadAttempt(value => value + 1)}>{t("重新读取")}</button></p> : <fieldset className="settings-fields">
      <section className="detail-group">
        <h3>{t("当前策略")}</h3>
        <p className="current-strategy"><strong>{strategy.name}</strong></p>
        {strategy.note ? <p>{strategy.note}</p> : null}
        {dca ? <div className="setting-facts"><p><span>{t("定投计划")}</span><strong>{t(dca.label)}</strong></p><p><span>{t("配置模式")}</span><strong>{t(dca.mode)}</strong></p><p><span>{t("基准金额（美元）")}</span><strong>{dca.amount === "未核实" ? t(dca.amount) : dca.amount}</strong></p></div> : null}
        {(strategyDirty || savedStrategy) && <div className="setting-facts"><p><span>{t("待应用策略")}</span><strong>{strategyValue === "" ? t("沿用当前") : strategyName(strategyValue)}</strong></p></div>}
        <label className="cash-floor-field">{t("待应用策略")}
          <select value={strategyValue} disabled={!canSaveCash} onChange={event => {
            const next = event.target.value;
            controller.edit(next === savedStrategy ? { strategy: savedStrategy, strategyTouched: false, clearStrategy: false } : next === "" ? { strategy: "", strategyTouched: true, clearStrategy: true } : { strategy: next, strategyTouched: true, clearStrategy: false });
            sync();
          }}>
            <option value="">{t("沿用当前")}</option>
            {strategyOptions.map((item: { profile: string }) => <option key={item.profile} value={item.profile}>{strategyName(item.profile)}</option>)}
          </select>
        </label>
        {strategyBlocked && <p className="section-note">{t("请先清除期权层草案，再保存这个策略草案。")}</p>}
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveCash || !strategySubmittable || view.review.draft || Boolean(view.saving)} onClick={() => void saveScoped("strategy", strategySubmittable)}>{t("保存策略草案")}</button>
          {strategyDirty && <button type="button" className="button button-secondary" onClick={() => { controller.revertStrategy(); sync(); }}>{t("取消")}</button>}
        </div>
        {strategyNotice && <p role="status">{t(view.notice)}</p>}
      </section>
      <section className="detail-group">
        <h3>{t("资金预留")}</h3>
        <div className="setting-facts">
          <p><span>{t("当前预留金额（美元）")}</span><strong>{currentCash === null ? t("未知") : currentCash}</strong></p>
          <p><span>{t("当前预留比例")}</span><strong>{currentRatio === null ? t("未知") : shareText(currentRatio)}</strong></p>
          {showPendingFloor && <p><span>{t("待应用预留现金")}</span><strong>{pendingFloor}</strong></p>}
          {showPendingRatio && <p><span>{t("待应用比例")}</span><strong>{shareText(pendingRatio)}</strong></p>}
        </div>
        <label className="cash-floor-field">{t("资金预留")}
          <select value={selectMode} disabled={!canSaveCash} onChange={event => { if (event.target.value === "saved") return; chooseMode(event.target.value as "inherit" | "floor" | "ratio" | "both"); }}>
            {selectMode === "saved" && <option value="saved">{t("已保存的预留覆盖")}</option>}
            <option value="inherit">{t("沿用当前")}</option>
            <option value="floor">{t("固定金额")}</option>
            <option value="ratio">{t("资产比例")}</option>
            <option value="both">{t("比例与最低金额")}</option>
          </select>
        </label>
        {selectMode === "both" ? <div className="cash-pair">
          <label className="cash-floor-field">{t("预留现金金额")}
            <input value={view.draft.cashMode ? view.draft.floor : editor.floor} inputMode="decimal" disabled={!canSaveCash} onChange={event => { controller.edit({ cashMode: "both", floor: event.target.value, ratio: view.draft.ratio || editor.ratio, percent: view.draft.percent || editor.percent, floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false }); sync(); }} />
          </label>
          <label className="cash-floor-field">{t("比例（%）")}
            <input value={view.draft.cashMode ? view.draft.percent : editor.percent} inputMode="decimal" disabled={!canSaveCash} onChange={event => { const percent = event.target.value; controller.edit({ cashMode: "both", percent, ratio: percentTextToRatio(percent) || "", floor: view.draft.cashMode ? view.draft.floor : editor.floor, floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false }); sync(); }} />
          </label>
        </div> : <>
          {(selectMode === "floor") && <label className="cash-floor-field">{t("预留现金金额")}
            <input value={view.draft.cashMode ? view.draft.floor : editor.floor} inputMode="decimal" disabled={!canSaveCash} onChange={event => { controller.edit({ cashMode: "floor", floor: event.target.value, ratio: "0", percent: "0", floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false }); sync(); }} />
          </label>}
          {(selectMode === "ratio") && <label className="cash-floor-field">{t("比例（%）")}
            <input value={view.draft.cashMode ? view.draft.percent : editor.percent} inputMode="decimal" disabled={!canSaveCash} onChange={event => { const percent = event.target.value; controller.edit({ cashMode: "ratio", percent, ratio: percentTextToRatio(percent) || "", floor: "0", floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false }); sync(); }} />
          </label>}
        </>}
        {selectMode === "both" && <p className="section-note">{t("按比例预留，且不少于固定金额")}</p>}
        {amountInvalid && <p className="section-note">{t("金额需要是大于或等于 0 的数字。")}</p>}
        {shareInvalid && <p className="section-note">{t("比例需要在 0 到 100 之间。")}</p>}
        {readState === "ready" && identityBlocked && <p>{t("请重新读取并确认当前账户来源。")}</p>}
        {readState === "ready" && !identityReady && <p>{t("缺少账户来源，不能保存。")}</p>}
        {readState === "ready" && !draftOpen && <p className="section-note">{t("暂时无法保存")}</p>}
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveCash || !cashSubmittable || view.review.draft || Boolean(view.saving)} onClick={() => void saveScoped("cash", cashSubmittable)}>{t("保存待应用草案")}</button>
          {cashDirty && !view.review.draft && <button type="button" className="button button-secondary" onClick={() => { controller.revertCash(); sync(); }}>{t("取消")}</button>}
          {view.review.draft && cashDirty && <button type="button" className="button button-secondary" onClick={() => { controller.revertCash(); sync(); }}>{t("取消")}</button>}
          {view.review.draft && <button type="button" className="button button-secondary" onClick={() => { controller.acknowledgeReview("draft"); sync(); }}>{t("重新核对")}</button>}
        </div>
        {view.review.draft && <p className="section-note" role="status">{t("草案版本或账户来源已变化，请取消或核对后再保存。")}</p>}
        {cashNotice && <p role="status">{t(view.notice)}</p>}
      </section>
      <section className="detail-group">
        <h3>{t("风险偏好")}</h3>
        <div className="preference-choices" role="group" aria-label={t("风险偏好")}>
          {PREFERENCES.map(([value, label, note]) => <button key={value} type="button" className="preference-choice" aria-pressed={view.preference === value} disabled={!canSaveRisk} onClick={() => { controller.edit({ preference: value }); sync(); }}>{t(label)}<span className="preference-hint" role="tooltip">{t(note)}</span></button>)}
        </div>
        {selectedNote ? <p className="preference-selected-note">{t(selectedNote)}</p> : null}
        {readState === "ready" && !riskOpen && <p className="section-note">{t("暂时无法保存")}</p>}
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveRisk || !riskDirty || view.review.risk || Boolean(view.saving)} onClick={() => void savePreference()}>{t("保存风险偏好")}</button>
          {riskDirty && !view.review.risk && <button type="button" className="button button-secondary" disabled={!canSaveRisk} onClick={() => { controller.edit({ preference: savedPreference }); sync(); }}>{t("取消")}</button>}
          {view.review.risk && <button type="button" className="button button-secondary" onClick={() => { controller.revertRisk(); sync(); }}>{t("取消")}</button>}
          {view.review.risk && <button type="button" className="button button-secondary" onClick={() => { controller.acknowledgeReview("risk"); sync(); }}>{t("重新核对")}</button>}
        </div>
        {view.review.risk && <p className="section-note" role="status">{t("风险版本或账户来源已变化，请取消或核对后再保存。")}</p>}
        {riskNotice && <p role="status">{t(view.notice)}</p>}
      </section>
      <section className="detail-group">
        <h3>{t("附加功能")}</h3>
        <div className="setting-facts">
          <p><span>{t("收入层")}</span><strong>{layerText(settings?.effective?.income_layer_enabled)}</strong></p>
          <p><span>{t("期权层")}</span><strong>{layerText(settings?.effective?.option_overlay_enabled)}</strong></p>
        </div>
        <label className="cash-floor-field">{t("待应用收入层")}
          <select value={incomeValue} disabled={!canSaveCash} onChange={event => {
            const next = event.target.value;
            controller.edit(next === savedIncome ? { income: savedIncome, incomeTouched: false } : { income: next === "" ? "clear" : next, incomeTouched: true });
            sync();
          }}>
            <option value="">{t("沿用当前收入设置")}</option>
            <option value="true">{t("开启收入层")}</option>
            <option value="false">{t("关闭收入层")}</option>
          </select>
        </label>
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveCash || !incomeSubmittable || view.review.draft || Boolean(view.saving)} onClick={() => void saveScoped("income", incomeSubmittable)}>{t("保存收入层草案")}</button>
          {incomeDirty && !view.review.draft && <button type="button" className="button button-secondary" onClick={() => { controller.edit({ income: savedIncome, incomeTouched: false }); sync(); }}>{t("取消")}</button>}
          {view.review.draft && incomeDirty && <button type="button" className="button button-secondary" onClick={() => { controller.edit({ income: savedIncome, incomeTouched: false }); sync(); }}>{t("取消")}</button>}
          {view.review.draft && incomeDirty && <button type="button" className="button button-secondary" onClick={() => { controller.acknowledgeReview("draft"); sync(); }}>{t("重新核对")}</button>}
        </div>
        {view.review.draft && incomeDirty && <p className="section-note" role="status">{t("草案版本或账户来源已变化，请取消或核对后再保存。")}</p>}
        {incomeNotice && <p role="status">{t(view.notice)}</p>}
        {(optionDirty || savedOption) && <div className="setting-facts"><p><span>{t("待应用期权层")}</span><strong>{optionValue === "" ? t("沿用当前") : optionValue === "true" ? t("开") : t("关")}</strong></p></div>}
        <label className="cash-floor-field">{t("待应用期权层")}
          <select value={optionValue} disabled={!canSaveCash} onChange={event => {
            const next = event.target.value;
            if ((next === "true" || next === "false") && !boundSupports) return;
            controller.edit(next === savedOption ? { option: savedOption, optionTouched: false } : { option: next === "" ? "clear" : next, optionTouched: true });
            sync();
          }}>
            <option value="">{t("沿用当前期权设置")}</option>
            <option value="true" disabled={!boundSupports}>{t("开启期权层")}</option>
            <option value="false" disabled={!boundSupports}>{t("关闭期权层")}</option>
          </select>
        </label>
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveCash || !optionSubmittable || view.review.draft || Boolean(view.saving)} onClick={() => void saveScoped("option", optionSubmittable)}>{t("保存期权层草案")}</button>
          {optionDirty && <button type="button" className="button button-secondary" onClick={() => { controller.revertOption(); sync(); }}>{t("取消")}</button>}
        </div>
        {optionNotice && <p role="status">{t(view.notice)}</p>}
        {otherNotice && <p role="status">{t(otherNotice)}</p>}
      </section>
    </fieldset>}
    {readState === "ready" ? <section className="detail-group"><div className="activation-row"><span>{t("运行控制")}</span><strong>{row.activation === "已启用" || row.activation === "已停用" ? t(row.activation) : t("待确认")}</strong></div>
    <div className="form-actions">
      <button type="button" className="button button-secondary" disabled>{t("启用")}</button>
      {actions.stop && <button type="button" className="button button-secondary" disabled={!stopAllowed} onClick={onStop}>{t(stopLabel)}</button>}
      {actions.resume && <button type="button" className="button button-secondary" onClick={onResume}>{t("恢复现有 Binance 目标")}</button>}
    </div>
    {actions.refresh && <button type="button" className="text-link" onClick={onRefreshStop}>{t("刷新停用状态")}</button>}
    </section> : null}
  </aside>;
}
