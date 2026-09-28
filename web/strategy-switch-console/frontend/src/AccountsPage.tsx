import { useEffect, useRef, useState } from "react";
import { loadAccountSettings, postJson } from "./api";
import { createAccountSettingsController } from "./accountSettingsState";
import { useT } from "./locales";
import { cashDraftDirty, readOnlyLayerState, reservedCashAmount, safeActionVisibility } from "./presentation";

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

export function AccountsPage({ rows, selectedId, detailOpen, admin, settingsEpoch, refreshToken, stopAllowed, stopLabel, stopRefreshVisible, resumeVisible, onSelect, onBack, onDirty, onStop, onRefreshStop, onResume, onSettingsRead, resolveStrategy }: {
  rows: AccountListItem[];
  selectedId: string;
  detailOpen: boolean;
  admin: boolean;
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
            <td className="account-identity"><button type="button" className="table-link" onClick={event => { event.stopPropagation(); onSelect(row.id); }}><strong>{row.title}</strong></button><small>{row.platformLabel}</small><small>{row.environment}</small></td>
            <td>{row.strategy === "未命名策略" ? t(row.strategy) : row.strategy}</td>
            <td>{row.statusLabel === "—" ? "—" : t(row.statusLabel)}</td>
            <td>{row.activation === "—" ? "—" : t(row.activation)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {selected && <DailyAccountSettings key={`${selected.id}:${settingsEpoch}`} row={selected} admin={admin} refreshToken={refreshToken} stopAllowed={stopAllowed} stopLabel={stopLabel} stopRefreshVisible={stopRefreshVisible} resumeVisible={resumeVisible} onBack={onBack} onDirty={onDirty} onStop={onStop} onRefreshStop={onRefreshStop} onResume={onResume} onSettingsRead={onSettingsRead} resolveStrategy={resolveStrategy} />}
    </div>
  </section>;
}

function observedProfile(settings: Record<string, any> | null): string | null {
  const raw = settings?.effective?.strategy_profile;
  return raw?.status === "known" && typeof raw.value === "string" && raw.value.trim() ? raw.value.trim() : null;
}

function DailyAccountSettings({ row, admin, refreshToken, stopAllowed, stopLabel, stopRefreshVisible, resumeVisible, onBack, onDirty, onStop, onRefreshStop, onResume, onSettingsRead, resolveStrategy }: {
  row: AccountListItem;
  admin: boolean;
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
  const draftDirty = cashDirty || incomeDirty;
  const riskDirty = controller.riskDirty();
  const dirty = draftDirty || riskDirty;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    const accountId = `${row.platform}:${row.key}`;
    const same = controller.selectedId() === accountId;
    if (same && controller.view().saving) return;
    const op = same ? controller.start("refresh") : controller.select({ platform: row.platform, key: row.key });
    if (!same) setReadState("loading");
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
        if (cancelled || !controller.applyUnavailable(op, message)) return;
        onSettingsRead(accountId, null);
        setReadState("failed");
        sync();
      }
    })();
    return () => { cancelled = true; controller.abandon(op); };
  }, [row.platform, row.key, readAttempt, refreshToken, controller, onSettingsRead]);
  const savePreference = async () => {
    if (!admin || view.saving || view.review.risk) return;
    const started = controller.startSave("risk");
    const body = controller.requestBody(started);
    if (!started || !body || !controller.markSaving(started, "risk")) return;
    sync();
    try {
      const currentBody = controller.requestBody(started);
      if (!currentBody) return;
      const saved = await postJson<Record<string, any>>("/api/account-settings", currentBody);
      if (!controller.isCurrent(started)) return;
      if (controller.applySave(started, saved, "风险偏好已保存，不改变执行限额或启用状态。")) sync();
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
  const saveCash = async () => {
    if (!admin || view.saving || !draftDirty || view.review.draft) return;
    const started = controller.startSave("draft");
    const body = controller.requestBody(started);
    if (!started || !body || !controller.markSaving(started, "draft")) return;
    sync();
    try {
      const currentBody = controller.requestBody(started);
      if (!currentBody) return;
      const saved = await postJson<Record<string, any>>("/api/account-settings", currentBody);
      if (!controller.isCurrent(started)) return;
      if (controller.applySave(started, saved, "已保存，尚未应用")) sync();
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
  const canSaveRisk = readState === "ready" && Boolean(admin && identityReady && Number.isSafeInteger(settings?.risk?.revision));
  const canSaveCash = canSaveRisk && !identityBlocked && Number.isSafeInteger(settings?.draft?.revision);
  const savedFloor = typeof settings?.draft?.overrides?.reserved_cash_floor === "string" ? settings.draft.overrides.reserved_cash_floor : "";
  const savedIncome = settings?.draft?.overrides?.income_layer_enabled === true ? "true" : settings?.draft?.overrides?.income_layer_enabled === false ? "false" : "";
  const incomeValue = view.draft.incomeTouched ? (view.draft.income === "clear" ? "" : view.draft.income) : savedIncome;
  const currentCash = reservedCashAmount(settings?.effective?.reserved_cash_floor);
  const pendingCash = view.draft.clearFloor ? "" : (view.draft.floorTouched ? view.draft.floor : savedFloor);
  const layerText = (field: unknown) => {
    const state = readOnlyLayerState(field);
    return state === "on" ? t("开") : state === "off" ? t("关") : t("未知");
  };
  const actions = safeActionVisibility({ settingsUnavailable: Boolean(view.unavailable), activation: row.activation, refreshSupported: stopRefreshVisible, resumeSupported: resumeVisible });
  const strategy = resolveStrategy(observedProfile(settings));
  const selectedNote = PREFERENCES.find(([value]) => value === view.preference)?.[2] || "";
  const cashNotice = view.notice === "已保存，尚未应用";
  const riskNotice = view.notice === "风险偏好已保存，不改变执行限额或启用状态。";
  const otherNotice = view.notice && !cashNotice && !riskNotice ? view.notice : "";
  return <aside className="account-detail">
    <button type="button" className="text-link mobile-back" onClick={onBack}>{t("返回账户列表")}</button>
    <h2>{row.title}</h2>
    <p className="account-identity"><small>{row.platformLabel}</small><small>{row.environment}</small></p>
    {readState === "loading" ? <p role="status">{t("正在读取账户设置")}</p> : readState === "failed" ? <p>{t(view.unavailable || "账户设置暂时读不到。")}<button type="button" className="text-link" onClick={() => setReadAttempt(value => value + 1)}>{t("重新读取")}</button></p> : <>
      <section className="detail-group">
        <h3>{t("当前策略")}</h3>
        <p className="readonly-strategy"><strong>{strategy.name}</strong></p>
        <p className="section-note">{t("暂不能修改")}</p>
        {strategy.note ? <p>{strategy.note}</p> : null}
      </section>
      <section className="detail-group">
        <h3>{t("资金预留")}</h3>
        <div className="setting-facts">
          <p><span>{t("当前预留现金（美元）")}</span><strong>{currentCash === null ? t("未知") : currentCash}</strong></p>
          <p><span>{t("待应用预留现金")}</span><strong>{pendingCash === "" ? t("沿用当前") : pendingCash}</strong></p>
          {!cashDirty && savedFloor !== "" && !cashNotice && <p role="status">{t("已保存，尚未应用")}</p>}
        </div>
        <label className="cash-floor-field">{t("预留现金金额")}
          <input value={view.draft.clearFloor ? "" : view.draft.floor} inputMode="decimal" disabled={!canSaveCash} onChange={event => { controller.edit({ floor: event.target.value, floorTouched: true, clearFloor: false }); sync(); }} />
        </label>
        {identityBlocked && <p>{t("请重新读取并确认当前账户来源。")}</p>}
        {!identityReady && <p>{t("缺少账户来源，不能保存。")}</p>}
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveCash || !draftDirty || view.review.draft || Boolean(view.saving)} onClick={() => void saveCash()}>{t("保存待应用草案")}</button>
          {pendingCash !== "" && <button type="button" className="button button-secondary" disabled={!canSaveCash} onClick={() => { controller.edit({ floor: "", floorTouched: false, clearFloor: true }); sync(); }}>{t("清除待应用金额")}</button>}
          {cashDirty && !view.review.draft && <button type="button" className="button button-secondary" onClick={() => { controller.edit({ floor: savedFloor, floorTouched: false, clearFloor: false }); sync(); }}>{t("取消")}</button>}
          {view.review.draft && <button type="button" className="button button-secondary" onClick={() => { controller.revertDraft(); sync(); }}>{t("取消")}</button>}
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
        <p className="section-note">{t("选择风险偏好不会立即切换策略或提高额度。")}</p>
        {!admin ? <p className="section-note">{t("当前登录不能保存风险偏好。")}</p> : !canSaveRisk ? <p className="section-note">{t("这项保存由服务端关闭，页面不能打开。")}</p> : null}
        <div className="form-actions">
          <button type="button" className="button button-primary" disabled={!canSaveRisk || !riskDirty || view.review.risk || Boolean(view.saving)} onClick={() => void savePreference()}>{t("保存风险偏好")}</button>
          {(savedPreference || view.preference) && <button type="button" className="button button-secondary" disabled={!canSaveRisk} onClick={() => { controller.edit({ preference: "" }); sync(); }}>{t("清除偏好")}</button>}
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
        <p className="section-note">{t("此草案尚未应用。")}</p>
        {incomeDirty && !view.review.draft && <button type="button" className="button button-secondary" onClick={() => { controller.edit({ income: savedIncome, incomeTouched: false }); sync(); }}>{t("取消")}</button>}
        <p className="section-note">{t("期权层暂不支持修改。")}</p>
        {otherNotice && <p role="status">{t(otherNotice)}</p>}
      </section>
    </>}
    <section className="detail-group"><div className="activation-row"><span>{t("运行控制")}</span><strong>{row.activation === "已启用" || row.activation === "已停用" ? t(row.activation) : t("未知")}</strong></div>
    <div className="form-actions">
      <button type="button" className="button button-secondary" disabled aria-describedby="activation-unavailable">{t("启用")}</button>
      {actions.stop && <button type="button" className="button button-secondary" disabled={!stopAllowed} onClick={onStop}>{t(stopLabel)}</button>}
      {actions.resume && <button type="button" className="button button-secondary" onClick={onResume}>{t("恢复现有 Binance 目标")}</button>}
    </div>
    <p id="activation-unavailable" className="section-note">{t("暂不支持在此启用账户。")}</p>
    {actions.refresh && <button type="button" className="text-link" onClick={onRefreshStop}>{t("刷新停用状态")}</button>}
    </section>
  </aside>;
}
