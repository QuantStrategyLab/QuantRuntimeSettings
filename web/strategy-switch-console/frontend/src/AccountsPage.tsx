import { useContext, useEffect, useRef, useState } from "react";
import { loadAccountSettings, postJson } from "./api";
import { pendingDraftOverrides, createAccountSettingsController, refreshAccountSettingsReadback } from "./accountSettingsState";
import { LocaleContext, useT } from "./locales";
import { StrategyIdentity } from "./StrategyIdentity";
import { statusTone } from "./statusTone";
import type { StrategyIdentityView } from "./presentation";
import type { AccountFactsAccount } from "./types";
import { accountNativeReadout, accountSettingsOperationReason, accountSettingsSaveBlockReason, scheduleBinancePrivateScopeExpiry, cashDraftDirty, dcaSettingsReadout, overviewActivationLabel, percentTextToRatio, ratioTextToPercent, readOnlyLayerState, reservedCashAmount, reservedCashEditor, safeActionVisibility, strategySelectionName } from "./presentation";

export type AccountListItem = {
  id: string;
  platform: string;
  key: string;
  title: string;
  platformLabel: string;
  environment: string;
  facts?: AccountFactsAccount | null;
  binanceReport?: Record<string, any> | null;
  strategy: string;
  strategyNote: string;
  statusLabel: string;
  activation: string;
};

export function AccountsPage({ unresolvedSaves, rows, selectedId, detailOpen, settingsEpoch, refreshToken, stopAllowed, stopLabel, stopRefreshVisible, resumeVisible, onSelect, onBack, onDirty, onStop, onRefreshStop, onResume, onSettingsRead, resolveStrategy }: {
  unresolvedSaves: Parameters<typeof createAccountSettingsController>[0];
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
  resolveStrategy: (profileId: string | null) => { name: string; note: string; identity?: StrategyIdentityView };
}) {
  const t = useT();
  const selected = rows.find(row => row.id === selectedId) || null;
  const [factsNow, setFactsNow] = useState(() => Date.now());
  useEffect(() => {
    setFactsNow(Date.now());
    const cancel = rows.flatMap(row => [row.binanceReport?.observed_finished_at, row.binanceReport?.provider_product_type?.observed_at]
      .map(at => scheduleBinancePrivateScopeExpiry(at, () => setFactsNow(Date.now()), Date.now(), window, 36 * 60 * 60 * 1000)));
    return () => cancel.forEach(stop => stop());
  }, [rows]);
  return <section className={`daily-page accounts-page settings-home${detailOpen ? " show-detail" : ""}`}>
    <div className="daily-heading"><h1>{t("账户设置")}</h1></div>
    <div className="accounts-layout">
      <div className="account-list">
        <table className="daily-table">
          <thead><tr><th>{t("账户")}</th><th>{t("当前策略")}</th><th>{t("平台监测")}</th><th>{t("运行控制")}</th></tr></thead>
          <tbody>{rows.map(row => {
            const native = accountNativeReadout(row.platform, row.key, row.facts, row.binanceReport, Math.max(factsNow, Date.now()));
            return <tr key={row.id} className={row.id === selectedId ? "selected" : ""} tabIndex={0} aria-selected={row.id === selectedId} onClick={() => onSelect(row.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.id); } }}>
            <td className="account-identity"><button type="button" className="table-link" onClick={event => { event.stopPropagation(); onSelect(row.id); }}><strong>{row.title}</strong></button><span className="account-field-label account-fact-label">{t("配置环境")}</span><small className="account-environment">{row.environment}</small><span className="account-field-label account-fact-label">{t("原生类别")}</span><small className="account-native-type">{native.nativeType || t("未核实")}</small><span className="account-field-label account-fact-label">{t("身份可信度")}</span><small className="account-identity-confidence">{t(native.identityLabel)}</small></td>
            <td><span className="account-field-label">{t("当前策略")}</span><span className="account-field-value">{row.strategy === "未命名策略" ? t(row.strategy) : row.strategy}</span></td>
            <td><span className="account-field-label">{t("平台监测")}</span><span className="account-field-value" data-tone={statusTone(row.statusLabel)}>{t(row.statusLabel === "—" || row.statusLabel === "待确认" ? "异常" : row.statusLabel)}</span></td>
            <td><span className="account-field-label">{t("启用")}</span><span className="account-field-value" data-tone={statusTone(row.activation)}>{t(overviewActivationLabel(row.activation))}</span></td>
          </tr>; })}</tbody>
        </table>
      </div>
      {selected && <DailyAccountSettings key={`${selected.id}:${settingsEpoch}`} row={selected} unresolvedSaves={unresolvedSaves} refreshToken={refreshToken} stopAllowed={stopAllowed} stopLabel={stopLabel} stopRefreshVisible={stopRefreshVisible} resumeVisible={resumeVisible} onBack={onBack} onDirty={onDirty} onStop={onStop} onRefreshStop={onRefreshStop} onResume={onResume} onSettingsRead={onSettingsRead} resolveStrategy={resolveStrategy} />}
    </div>
  </section>;
}

function observedProfile(settings: Record<string, any> | null): string | null {
  const raw = settings?.effective?.strategy_profile;
  return raw?.status === "known" && typeof raw.value === "string" && raw.value.trim() ? raw.value.trim() : null;
}

function readBoolChoice(field: unknown): "" | "true" | "false" {
  const state = readOnlyLayerState(field);
  return state === "on" ? "true" : state === "off" ? "false" : "";
}

function effectiveReservedMode(floor: string | null, ratio: string | null): "" | "floor" | "ratio" | "both" {
  if (floor === null || ratio === null) return "";
  const floorValue = Number(floor);
  const ratioValue = Number(ratio);
  if (!Number.isFinite(floorValue) || !Number.isFinite(ratioValue)) return "";
  if (ratioValue === 0 && floorValue !== 0) return "floor";
  if (floorValue === 0 && ratioValue !== 0) return "ratio";
  return "both";
}

function validDcaAmount(value: string): boolean {
  return value.length <= 32 && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;
}

function DailyAccountSettings({ row, unresolvedSaves, refreshToken, stopAllowed, stopLabel, stopRefreshVisible, resumeVisible, onBack, onDirty, onStop, onRefreshStop, onResume, onSettingsRead, resolveStrategy }: {
  row: AccountListItem;
  unresolvedSaves: Parameters<typeof createAccountSettingsController>[0];
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
  resolveStrategy: (profileId: string | null) => { name: string; note: string; identity?: StrategyIdentityView };
}) {
  const t = useT();
  const language = useContext(LocaleContext);
  const controller = useRef(createAccountSettingsController(unresolvedSaves)).current;
  const [, setTick] = useState(0);
  const [readAttempt, setReadAttempt] = useState(0);
  const [readState, setReadState] = useState<"loading" | "refreshing" | "ready" | "stale" | "failed">("loading");
  const [readError, setReadError] = useState("");
  const sync = () => setTick(value => value + 1);
  const view = controller.view();
  const settings = view.settings;
  const cashDirty = cashDraftDirty(view.draft);
  const incomeDirty = view.draft.incomeTouched === true;
  const optionDirty = view.draft.optionTouched === true;
  const strategyDirty = view.draft.strategyTouched === true || view.draft.dcaTouched === true || view.draft.clearDca === true;
  const draftDirty = cashDirty || incomeDirty || optionDirty || strategyDirty;
  const dirty = draftDirty;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    const accountId = `${row.platform}:${row.key}`;
    const same = controller.selectedId() === accountId;
    if (same && controller.view().saving) return;
    const kept = same && Boolean(controller.view().settings);
    const op = same ? controller.start("refresh") : controller.select({ platform: row.platform, key: row.key });
    setReadState(kept ? "refreshing" : "loading");
    setReadError("");
    let cancelled = false;
    void (async () => {
      try {
        const payload = await loadAccountSettings(row.platform, row.key);
        if (cancelled) return;
        const applied = same ? controller.applyRefresh(op, payload) : controller.applyRead(op, payload);
        if (!applied) {
          if (controller.isCurrent(op)) throw new Error("account_settings_readback_mismatch");
          return;
        }
        onSettingsRead(accountId, observedProfile(controller.view().settings));
        setReadState("ready");
        sync();
      } catch (error) {
        const status = Number((error as { status?: number })?.status || 0);
        const message = status === 401 || status === 403 ? "没有权限读取这项设置。" : (error as { message?: string })?.message === "account_settings_readback_mismatch" ? "设置读回与所选账户不一致，请重新读取。" : "账户设置暂时读不到。";
        if (cancelled) return;
        if (kept) {
          if (!controller.isCurrent(op)) return;
          controller.abandon(op);
          setReadError(message);
          setReadState("stale");
          sync();
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
  const saveScoped = async (kind: "cash" | "income" | "option" | "strategy", ready: boolean) => {
    if (readState !== "ready" || view.saving || !ready || view.review.draft || settings?.operations?.save_draft !== true) return;
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
      if (!controller.fail(started, status === 409 ? "版本已变化，未覆盖已保存内容。" : "账户设置暂不可用。", status !== 409)) return;
      sync();
      const refresh = controller.start("refresh");
      setReadState("refreshing");
      setReadError("");
      const result = await refreshAccountSettingsReadback(controller, refresh, () => loadAccountSettings(started.account.platform, started.account.key));
      if (result.status === "superseded") return;
      if (result.status === "ready") setReadState("ready");
      else { setReadError(result.message); setReadState("stale"); }
      sync();
    } finally {
      if (controller.finish(started)) sync();
    }
  };
  const draftSaveReason = accountSettingsSaveBlockReason(settings, readState, "draft");
  const canSaveCash = draftSaveReason === null;
  const savedIncome = settings?.draft?.overrides?.income_layer_enabled === true ? "true" : settings?.draft?.overrides?.income_layer_enabled === false ? "false" : "";
  const effectiveIncome = readBoolChoice(settings?.effective?.income_layer_enabled);
  const incomeValue = view.draft.incomeTouched ? (view.draft.income === "clear" ? effectiveIncome : view.draft.income) : (savedIncome || effectiveIncome);
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
    return strategySelectionName(choice, strategyOptions, language);
  };
  const currentProfile = observedProfile(settings) || "";
  const strategyChoice = strategyDirty ? (view.draft.clearStrategy ? currentProfile : view.draft.strategy) : (savedStrategy || currentProfile);
  const savedBound = savedStrategy || currentProfile;
  const localBound = strategyDirty ? (view.draft.clearStrategy ? observedProfile(settings) || "" : view.draft.strategy) : savedBound;
  const strategyPending = strategyDirty && localBound !== savedBound;
  const optionDefined = (profileId: string) => strategyOptions.some((item: { profile?: string; option_overlay_enabled?: boolean }) => item.profile === profileId && item.option_overlay_enabled === true);
  const boundSupports = !strategyPending && settings?.operations?.save_option_draft === true && optionDefined(localBound);
  const savedOption = settings?.draft?.overrides?.option_overlay_enabled === true ? "true" : settings?.draft?.overrides?.option_overlay_enabled === false ? "false" : "";
  const effectiveOption = readBoolChoice(settings?.effective?.option_overlay_enabled);
  const optionValue = optionDirty ? (view.draft.option === "clear" ? effectiveOption : view.draft.option) : (savedOption || effectiveOption);
  const optionConcrete = optionDirty ? view.draft.option === "true" || view.draft.option === "false" : savedOption === "true" || savedOption === "false";
  const nextStrategy = strategyValue || currentProfile;
  const dcaChoice = strategyOptions.find((item: { profile?: string }) => item.profile === nextStrategy);
  const dcaSupported = dcaChoice?.dca_supported === true || (settings?.current_dca_supported === true && nextStrategy === currentProfile);
  const savedDcaProfile = savedStrategy || (settings?.current_dca_supported === true ? currentProfile : "");
  const effectiveDcaMode = settings?.effective?.dca_mode?.status === "known" && (settings.effective.dca_mode.value === "fixed" || settings.effective.dca_mode.value === "smart") ? settings.effective.dca_mode.value : "";
  const effectiveDcaAmount = settings?.effective?.dca_base_investment_usd?.status === "known" && typeof settings.effective.dca_base_investment_usd.value === "string" ? settings.effective.dca_base_investment_usd.value : "";
  const savedDcaMode = settings?.draft?.overrides?.dca_mode === "fixed" || settings?.draft?.overrides?.dca_mode === "smart" ? settings.draft.overrides.dca_mode : (savedDcaProfile === currentProfile ? effectiveDcaMode : "");
  const savedDcaAmount = typeof settings?.draft?.overrides?.dca_base_investment_usd === "string" ? settings.draft.overrides.dca_base_investment_usd : (savedDcaProfile === currentProfile ? effectiveDcaAmount : "");
  const dcaMode = view.draft.dcaTouched && view.draft.dcaProfile === nextStrategy ? view.draft.dcaMode : (savedDcaProfile === nextStrategy ? savedDcaMode : "");
  const dcaAmount = view.draft.dcaTouched && view.draft.dcaProfile === nextStrategy ? view.draft.dcaAmount : (savedDcaProfile === nextStrategy ? savedDcaAmount : "");
  const dcaTouched = view.draft.dcaTouched === true;
  const selectStrategy = (next: string) => {
    if (next === (savedStrategy || currentProfile)) {
      controller.revertStrategy();
      sync();
      return;
    }
    const targetProfile = next || currentProfile;
    const targetChoice = strategyOptions.find((item: { profile?: string }) => item.profile === targetProfile);
    const targetDca = targetChoice?.dca_supported === true || (settings?.current_dca_supported === true && targetProfile === currentProfile);
    const wasDca = strategyOptions.some((item: { profile?: string; dca_supported?: boolean }) => item.profile === nextStrategy && item.dca_supported === true)
      || (settings?.current_dca_supported === true && nextStrategy === currentProfile);
    const strategySame = next === savedStrategy;
    const sameDcaProfile = targetProfile === savedDcaProfile;
    controller.edit({
      strategy: next,
      strategyTouched: !strategySame,
      clearStrategy: !next && !strategySame,
      dcaProfile: targetDca ? targetProfile : "",
      dcaMode: targetDca ? (sameDcaProfile ? savedDcaMode : "") : "",
      dcaAmount: targetDca ? (sameDcaProfile ? savedDcaAmount : "") : "",
      dcaTouched: targetDca && !sameDcaProfile,
      clearDca: Boolean(savedDcaProfile && targetProfile !== savedDcaProfile && (wasDca || savedStrategy === savedDcaProfile)),
    });
    sync();
  };
  const strategyBlocked = strategyDirty && optionConcrete && !optionDefined(nextStrategy) && !(view.draft.optionTouched && view.draft.option === "clear");
  const optionSubmittable = Boolean(optionDirty && optionBody && Object.keys(optionBody).length && (optionBody.option_overlay_enabled === null || boundSupports));
  const strategySubmittable = Boolean(strategyDirty && strategyBody && Object.prototype.hasOwnProperty.call(strategyBody, "strategy_profile") && !strategyBlocked);
  const savedCashEditor = reservedCashEditor(settings?.draft?.overrides, {});
  const effectiveMode = effectiveReservedMode(currentCash, currentRatio);
  const shownFloor = editor.mode === "inherit" ? (currentCash ?? "") : editor.floor;
  const shownRatio = editor.mode === "inherit" ? (currentRatio ?? "") : editor.ratio;
  const shownPercent = editor.mode === "inherit" ? (currentRatio === null ? "" : ratioTextToPercent(currentRatio)) : editor.percent;
  const displayCashMode = selectMode === "inherit" ? effectiveMode : selectMode;
  const chooseMode = (next: "floor" | "ratio" | "both") => {
    if (savedCashEditor.mode === "inherit" && next === effectiveMode) {
      controller.revertCash();
      sync();
      return;
    }
    if (!view.draft.cashMode && editor.mode === next) return;
    const sourceMode = view.draft.cashMode || editor.mode;
    const floorBase = savedCashEditor.mode === "inherit" && !view.draft.cashMode ? shownFloor : editor.floor;
    const ratioBase = savedCashEditor.mode === "inherit" && !view.draft.cashMode ? shownRatio : editor.ratio;
    const percentBase = savedCashEditor.mode === "inherit" && !view.draft.cashMode ? shownPercent : (view.draft.percent || editor.percent);
    if (next === "floor") controller.edit({ cashMode: "floor", floor: sourceMode === "ratio" ? "" : floorBase, ratio: "0", percent: "0", floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false });
    else if (next === "ratio") controller.edit({ cashMode: "ratio", floor: "0", ratio: sourceMode === "floor" ? "" : ratioBase, percent: sourceMode === "floor" ? "" : percentBase, floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false });
    else controller.edit({ cashMode: "both", floor: sourceMode === "ratio" ? "" : floorBase, ratio: sourceMode === "floor" ? "" : ratioBase, percent: sourceMode === "floor" ? "" : percentBase, floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false });
    sync();
  };
  const readPercent = currentRatio === null ? "" : ratioTextToPercent(currentRatio);
  const cashMatchesRead = (mode: "floor" | "ratio" | "both", floor: string, percent: string) => savedCashEditor.mode === "inherit" && mode === effectiveMode && (mode === "ratio" || floor === (currentCash ?? "")) && (mode === "floor" || percent === readPercent);
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
  const cashNotice = view.noticeGroup === "cash" && view.notice === "草案已保存";
  const incomeNotice = view.noticeGroup === "income" && view.notice === "草案已保存";
  const optionNotice = view.noticeGroup === "option" && view.notice === "草案已保存";
  const strategyNotice = view.noticeGroup === "strategy" && view.notice === "草案已保存";
  const otherNotice = view.notice && !cashNotice && !incomeNotice && !optionNotice && !strategyNotice && view.noticeGroup !== "risk" ? view.notice : "";
  const reading = readState === "loading";
  return <aside className={`account-detail${reading ? " is-loading" : ""}`} aria-busy={reading}>
    {reading ? <div className="settings-progress" role="progressbar" aria-label={t("正在读取账户设置")}><span className="settings-progress-bar" /><p className="settings-progress-hint" aria-hidden="true">{t("正在读取账户设置")}</p></div> : null}
    <button type="button" className="text-link mobile-back" onClick={onBack}>{t("返回账户列表")}</button>
    <h2>{row.title}</h2>
    {reading ? null : <p className="account-identity"><small className="account-environment">{row.environment}</small></p>}
    {readState === "refreshing" && <p className="workflow-note" role="status">{t("正在重新读取设置，显示上次读回值；草案会保留。")}</p>}
    {readState === "stale" && <div className="workflow-note" role="status"><p>{t(readError)} {t("显示上次成功读回的设置，当前状态未重新确认；未保存草案已保留。")}</p><button type="button" className="text-link" onClick={() => setReadAttempt(value => value + 1)}>{t("重新读取")}</button></div>}
    {reading ? null : readState === "failed" ? <p>{t(view.unavailable || "账户设置暂时读不到。")}<button type="button" className="text-link" onClick={() => setReadAttempt(value => value + 1)}>{t("重新读取")}</button></p> : <fieldset className="settings-fields">
      {draftSaveReason && <p className="section-note">{t(draftSaveReason)}{readState === "ready" && <button type="button" className="text-link" onClick={() => setReadAttempt(value => value + 1)}>{t("重新读取")}</button>}</p>}
      <section className="detail-group">
        <h3>{t("当前配置策略")}</h3>
        <p className="current-strategy"><strong>{strategy.name}</strong></p>
        {strategy.note ? <p>{strategy.note}</p> : null}
        <StrategyIdentity value={strategy.identity} />
        {dca ? <div className="setting-facts"><p><span>{t("定投计划")}</span><strong>{t(dca.label)}</strong></p><p><span>{t("配置模式")}</span><strong>{t(dca.mode)}</strong></p><p><span>{t("基准金额（美元）")}</span><strong>{dca.amount === "未核实" ? t(dca.amount) : dca.amount}</strong></p></div> : null}
        {savedStrategy && <p className="section-note">{t("已保存策略草案")}：{strategyName(savedStrategy)}</p>}
        {(strategyDirty || savedStrategy) && <div className="setting-facts"><p><span>{t("策略草案")}</span><strong>{strategyValue ? strategyName(strategyValue) : (currentProfile ? strategyName(currentProfile) : t("未知"))}</strong></p></div>}
        <label className="cash-floor-field">{t("策略草案")}
          <select value={strategyChoice} disabled={!canSaveCash} onChange={event => {
            selectStrategy(event.target.value);
          }}>
            {!strategyChoice && <option value="" hidden disabled>{t("未读到配置")}</option>}
            {currentProfile && !strategyOptions.some((item: { profile?: string }) => item.profile === currentProfile) && <option value={currentProfile}>{strategyName(currentProfile)}</option>}
            {savedStrategy && savedStrategy !== currentProfile && !strategyOptions.some((item: { profile?: string }) => item.profile === savedStrategy) && <option value={savedStrategy}>{strategyName(savedStrategy)}</option>}
            {strategyOptions.map((item: { profile: string }) => <option key={item.profile} value={item.profile}>{strategyName(item.profile)}</option>)}
          </select>
        </label>
        {strategyValue && strategyValue !== currentProfile && <StrategyIdentity key={strategyValue} value={resolveStrategy(strategyValue).identity} />}
        {dcaSupported && <div className="detail-subgroup">
          <h4>{t("定投设置")}</h4>
          <label className="cash-floor-field">{t("定投模式")}
            <select value={dcaMode} disabled={!canSaveCash} onChange={event => { controller.edit({ dcaMode: event.target.value as "fixed" | "smart", dcaAmount, dcaProfile: nextStrategy, dcaTouched: true, strategyTouched: true, strategy: strategyValue || nextStrategy, clearStrategy: false, clearDca: false }); sync(); }}>
              <option value="">{t("请选择定投模式")}</option>
              <option value="fixed">{t("定额定投")}</option>
              <option value="smart">{t("智能定投")}</option>
            </select>
          </label>
          <label className="cash-floor-field">{t(dcaMode === "smart" ? "基准金额（美元）" : "每期金额（美元）")}
            <input value={dcaAmount} inputMode="decimal" maxLength={32} disabled={!canSaveCash} onChange={event => { controller.edit({ dcaAmount: event.target.value, dcaMode, dcaProfile: nextStrategy, dcaTouched: true, strategyTouched: true, strategy: strategyValue || nextStrategy, clearStrategy: false, clearDca: false }); sync(); }} />
          </label>
          {dcaMode === "smart" && <p className="section-note">{t("智能定投按既定规则调整本期金额。")}</p>}
          {dcaTouched && dcaAmount !== "" && !validDcaAmount(dcaAmount) && <p className="section-note">{t("定投金额需为正的有限数字，最多 32 个字符。")}</p>}
        </div>}
        {strategyBlocked && <p className="section-note">{t("请先清除期权层草案，再保存这个策略草案。")}</p>}
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveCash || !strategySubmittable || view.review.draft || Boolean(view.saving)} onClick={() => void saveScoped("strategy", strategySubmittable)}>{t("保存策略草案")}</button>
          {strategyDirty && <button type="button" className="button button-secondary" onClick={() => { controller.revertStrategy(); sync(); }}>{t("取消")}</button>}
        </div>
        {strategyNotice && <p role="status">{t("草案已保存，运行端生效尚未验证。")}</p>}
      </section>
      <section className="detail-group">
        <h3>{t("资金预留")}</h3>
        <div className="setting-facts">
          <p><span>{t("配置最低预留额（美元）")}</span><strong>{currentCash === null ? t("未知") : currentCash}</strong></p>
          <p><span>{t("配置预留比例")}</span><strong>{currentRatio === null ? t("未知") : shareText(currentRatio)}</strong></p>
          {showPendingFloor && <p><span>{t(cashDirty ? "未保存草案最低预留额" : "已保存草案最低预留额")}</span><strong>{pendingFloor}</strong></p>}
          {showPendingRatio && <p><span>{t(cashDirty ? "未保存草案预留比例" : "已保存草案预留比例")}</span><strong>{shareText(pendingRatio)}</strong></p>}
        </div>
        <label className="cash-floor-field">{t("资金预留")}
          <select value={displayCashMode} disabled={!canSaveCash} onChange={event => { if (event.target.value === "saved") return; chooseMode(event.target.value as "floor" | "ratio" | "both"); }}>
            {!displayCashMode && <option value="" hidden disabled>{t("未读到配置")}</option>}
            {displayCashMode === "saved" && <option value="saved">{t("已保存的预留覆盖")}</option>}
            <option value="floor">{t("固定金额")}</option>
            <option value="ratio">{t("资产比例")}</option>
            <option value="both">{t("比例与最低金额")}</option>
          </select>
        </label>
        {displayCashMode === "both" ? <div className="cash-pair">
          <label className="cash-floor-field">{t("预留现金金额")}
            <input value={view.draft.cashMode ? view.draft.floor : shownFloor} inputMode="decimal" disabled={!canSaveCash} onChange={event => { const floor = event.target.value; const percent = view.draft.cashMode ? view.draft.percent : shownPercent; if (cashMatchesRead("both", floor, percent)) { controller.revertCash(); sync(); return; } controller.edit({ cashMode: "both", floor, ratio: view.draft.ratio || shownRatio, percent, floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false }); sync(); }} />
          </label>
          <label className="cash-floor-field">{t("比例（%）")}
            <input value={view.draft.cashMode ? view.draft.percent : shownPercent} inputMode="decimal" disabled={!canSaveCash} onChange={event => { const percent = event.target.value; const floor = view.draft.cashMode ? view.draft.floor : shownFloor; if (cashMatchesRead("both", floor, percent)) { controller.revertCash(); sync(); return; } controller.edit({ cashMode: "both", percent, ratio: percentTextToRatio(percent) || "", floor, floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false }); sync(); }} />
          </label>
        </div> : <>
          {(displayCashMode === "floor") && <label className="cash-floor-field">{t("预留现金金额")}
            <input value={view.draft.cashMode ? view.draft.floor : shownFloor} inputMode="decimal" disabled={!canSaveCash} onChange={event => { const floor = event.target.value; if (cashMatchesRead("floor", floor, "0")) { controller.revertCash(); sync(); return; } controller.edit({ cashMode: "floor", floor, ratio: "0", percent: "0", floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false }); sync(); }} />
          </label>}
          {(displayCashMode === "ratio") && <label className="cash-floor-field">{t("比例（%）")}
            <input value={view.draft.cashMode ? view.draft.percent : shownPercent} inputMode="decimal" disabled={!canSaveCash} onChange={event => { const percent = event.target.value; if (cashMatchesRead("ratio", "0", percent)) { controller.revertCash(); sync(); return; } controller.edit({ cashMode: "ratio", percent, ratio: percentTextToRatio(percent) || "", floor: "0", floorTouched: true, ratioTouched: true, clearFloor: false, clearRatio: false }); sync(); }} />
          </label>}
        </>}
        {displayCashMode === "both" && <p className="section-note">{t("按比例预留，且不少于固定金额")}</p>}
        {amountInvalid && <p className="section-note">{t("金额需要是大于或等于 0 的数字。")}</p>}
        {shareInvalid && <p className="section-note">{t("比例需要在 0 到 100 之间。")}</p>}
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveCash || !cashSubmittable || view.review.draft || Boolean(view.saving)} onClick={() => void saveScoped("cash", cashSubmittable)}>{t("保存预留草案")}</button>
          {cashDirty && !view.review.draft && <button type="button" className="button button-secondary" onClick={() => { controller.revertCash(); sync(); }}>{t("取消")}</button>}
          {view.review.draft && cashDirty && <button type="button" className="button button-secondary" onClick={() => { controller.revertCash(); sync(); }}>{t("取消")}</button>}
          {view.review.draft && <button type="button" className="button button-secondary" onClick={() => { if (!controller.acknowledgeReview("draft")) setReadAttempt(value => value + 1); sync(); }}>{t("重新核对")}</button>}
        </div>
        {view.review.draft && <p className="section-note" role="status">{t("草案版本或账户来源已变化，请取消或核对后再保存。")}</p>}
        {cashNotice && <p role="status">{t("草案已保存，运行端生效尚未验证。")}</p>}
      </section>
      <section className="detail-group">
        <h3>{t("附加功能")}</h3>
        <div className="setting-facts">
          <p><span>{t("收入层")}</span><strong>{layerText(settings?.effective?.income_layer_enabled)}</strong></p>
          <p><span>{t("期权层")}</span><strong>{layerText(settings?.effective?.option_overlay_enabled)}</strong></p>
        </div>
        <label className="cash-floor-field">{t("收入层草案")}
          <select value={incomeValue} disabled={!canSaveCash} onChange={event => {
            const next = event.target.value;
            if (!savedIncome && next === effectiveIncome) controller.edit({ income: "", incomeTouched: false });
            else if (next === savedIncome) controller.edit({ income: savedIncome, incomeTouched: false });
            else controller.edit({ income: next, incomeTouched: true });
            sync();
          }}>
            {!incomeValue && <option value="" hidden disabled>{t("未读到配置")}</option>}
            <option value="true">{t("开启")}</option>
            <option value="false">{t("关闭")}</option>
          </select>
        </label>
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveCash || !incomeSubmittable || view.review.draft || Boolean(view.saving)} onClick={() => void saveScoped("income", incomeSubmittable)}>{t("保存收入层草案")}</button>
          {incomeDirty && !view.review.draft && <button type="button" className="button button-secondary" onClick={() => { controller.edit({ income: savedIncome, incomeTouched: false }); sync(); }}>{t("取消")}</button>}
          {view.review.draft && incomeDirty && <button type="button" className="button button-secondary" onClick={() => { controller.edit({ income: savedIncome, incomeTouched: false }); sync(); }}>{t("取消")}</button>}
          {view.review.draft && incomeDirty && <button type="button" className="button button-secondary" onClick={() => { if (!controller.acknowledgeReview("draft")) setReadAttempt(value => value + 1); sync(); }}>{t("重新核对")}</button>}
        </div>
        {view.review.draft && incomeDirty && <p className="section-note" role="status">{t("草案版本或账户来源已变化，请取消或核对后再保存。")}</p>}
        {incomeNotice && <p role="status">{t("草案已保存，运行端生效尚未验证。")}</p>}
        <label className="cash-floor-field">{t("期权层草案")}
          <select value={optionValue} disabled={!canSaveCash} onChange={event => {
            const next = event.target.value;
            if ((next === "true" || next === "false") && !boundSupports) return;
            if (!savedOption && next === effectiveOption) controller.edit({ option: "", optionTouched: false });
            else if (next === savedOption) controller.edit({ option: savedOption, optionTouched: false });
            else controller.edit({ option: next, optionTouched: true });
            sync();
          }}>
            {!optionValue && <option value="" hidden disabled>{t("未读到配置")}</option>}
            <option value="true" disabled={!boundSupports}>{t("开启")}</option>
            <option value="false" disabled={!boundSupports}>{t("关闭")}</option>
          </select>
        </label>
        {!boundSupports && <p className="section-note">{t(strategyPending ? "请先保存策略草案，再核对期权层支持。" : (settings?.operations?.save_option_draft_reason === "option_overlay_not_defined" || settings?.operations?.save_option_draft_reason === "admin_required" ? accountSettingsOperationReason(settings?.operations?.save_option_draft_reason) : "这项操作暂不可用。"))}</p>}
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveCash || !optionSubmittable || view.review.draft || Boolean(view.saving)} onClick={() => void saveScoped("option", optionSubmittable)}>{t("保存期权层草案")}</button>
          {optionDirty && <button type="button" className="button button-secondary" onClick={() => { controller.revertOption(); sync(); }}>{t("取消")}</button>}
        </div>
        {optionNotice && <p role="status">{t("草案已保存，运行端生效尚未验证。")}</p>}
        {otherNotice && <p role="status">{t(otherNotice)}</p>}
      </section>
    </fieldset>}
    <section className="detail-group runtime-controls"><div className="activation-row"><span>{t("运行控制")}</span><strong>{t(overviewActivationLabel(row.activation))}</strong></div>
    <div className="form-actions">
      {readState === "ready" && <>
        <button type="button" className="button button-secondary" aria-describedby="activation-not-wired" disabled>{t("启用")}</button>
        <p id="activation-not-wired" className="field-note" role="note">{t("启用流程尚未接通，此按钮不会提交。")}</p>
      </>}
      {actions.stop && <button type="button" className="button button-secondary" disabled={!stopAllowed} onClick={onStop}>{t(stopLabel)}</button>}
      {readState === "ready" && actions.resume && <button type="button" className="button button-secondary" onClick={onResume}>{t("恢复现有 Binance 目标")}</button>}
    </div>
    {readState === "ready" && settings?.operations?.activation_reason === "admin_required" && <p className="section-note" id="activation-unavailable">{t(accountSettingsOperationReason(settings?.operations?.activation_reason))}</p>}
    {actions.refresh && <button type="button" className="text-link" onClick={onRefreshStop}>{t("刷新停用状态")}</button>}
    </section>
  </aside>;
}
