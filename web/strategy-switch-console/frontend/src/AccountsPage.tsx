import { useEffect, useRef, useState } from "react";
import { loadAccountSettings, postJson } from "./api";
import { createAccountSettingsController } from "./accountSettingsState";
import { useT } from "./locales";
import { preferenceDirty, safeActionVisibility } from "./presentation";

const PREFERENCES = [
  ["CAPITAL_PRESERVATION", "保守"],
  ["BALANCED_COMPOUNDING", "均衡"],
  ["GROWTH_COMPOUNDING", "增长"],
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

export function AccountsPage({ rows, selectedId, detailOpen, admin, settingsEpoch, stopAllowed, stopLabel, stopRefreshVisible, resumeVisible, onSelect, onBack, onDirty, onStop, onRefreshStop, onResume }: {
  rows: AccountListItem[];
  selectedId: string;
  detailOpen: boolean;
  admin: boolean;
  settingsEpoch: number;
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
}) {
  const t = useT();
  const selected = rows.find(row => row.id === selectedId) || null;
  return <section className={`daily-page accounts-page${detailOpen ? " show-detail" : ""}`}>
    <div className="daily-heading"><h1>{t("账户设置")}</h1></div>
    <div className="accounts-layout">
      <div className="account-list">
        <table className="daily-table">
          <thead><tr><th>{t("账户")}</th><th>{t("当前策略")}</th><th>{t("状态")}</th><th>{t("启用策略")}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className={row.id === selectedId ? "selected" : ""}>
            <td className="account-identity"><button type="button" className="table-link" onClick={() => onSelect(row.id)}><strong>{row.title}</strong></button><small>{row.platformLabel}</small><small>{row.environment}</small></td>
            <td>{row.strategy === "未命名策略" ? t(row.strategy) : row.strategy}</td>
            <td>{row.statusLabel === "—" ? "—" : t(row.statusLabel)}</td>
            <td>{row.activation === "—" ? "—" : t(row.activation)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {selected && <DailyAccountSettings key={`${selected.id}:${settingsEpoch}`} row={selected} admin={admin} stopAllowed={stopAllowed} stopLabel={stopLabel} stopRefreshVisible={stopRefreshVisible} resumeVisible={resumeVisible} onBack={onBack} onDirty={onDirty} onStop={onStop} onRefreshStop={onRefreshStop} onResume={onResume} />}
    </div>
  </section>;
}

function DailyAccountSettings({ row, admin, stopAllowed, stopLabel, stopRefreshVisible, resumeVisible, onBack, onDirty, onStop, onRefreshStop, onResume }: {
  row: AccountListItem;
  admin: boolean;
  stopAllowed: boolean;
  stopLabel: string;
  stopRefreshVisible: boolean;
  resumeVisible: boolean;
  onBack: () => void;
  onDirty: (dirty: boolean) => void;
  onStop: () => void;
  onRefreshStop: () => void;
  onResume: () => void;
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
  const dirty = preferenceDirty(savedPreference, view.preference);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    const accountId = `${row.platform}:${row.key}`;
    const previous = controller.view();
    const previousSaved = typeof previous.settings?.risk?.preference === "string" ? previous.settings.risk.preference : "";
    const keepPreference = controller.selectedId() === accountId && preferenceDirty(previousSaved, previous.preference) ? previous.preference : "";
    const op = controller.select({ platform: row.platform, key: row.key });
    setReadState("loading");
    let cancelled = false;
    void (async () => {
      try {
        const payload = await loadAccountSettings(row.platform, row.key);
        if (cancelled || !controller.applyRead(op, payload)) return;
        if (keepPreference) controller.edit({ preference: keepPreference });
        setReadState("ready");
        sync();
      } catch (error) {
        const status = Number((error as { status?: number })?.status || 0);
        const message = status === 401 || status === 403 ? "没有权限读取这项设置。" : "账户设置暂时读不到。";
        if (cancelled || !controller.applyUnavailable(op, message)) return;
        setReadState("failed");
        sync();
      }
    })();
    return () => { cancelled = true; controller.abandon(op); };
  }, [row.platform, row.key, readAttempt, controller]);
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
  const canSaveRisk = readState === "ready" && Boolean(admin && Number.isSafeInteger(settings?.risk?.revision));
  const actions = safeActionVisibility({ settingsUnavailable: Boolean(view.unavailable), activation: row.activation, refreshSupported: stopRefreshVisible, resumeSupported: resumeVisible });
  const strategyText = row.strategy === "未命名策略" ? t(row.strategy) : row.strategy;
  return <aside className="account-detail">
    <button type="button" className="text-link mobile-back" onClick={onBack}>{t("返回账户列表")}</button>
    <h2>{row.title}</h2>
    <p className="account-identity"><small>{row.platformLabel}</small><small>{row.environment}</small></p>
    {readState === "loading" ? <p role="status">{t("正在读取账户设置")}</p> : readState === "failed" ? <p>{t(view.unavailable || "账户设置暂时读不到。")}<button type="button" className="text-link" onClick={() => setReadAttempt(value => value + 1)}>{t("重新读取")}</button></p> : <>
      <div className="readonly-strategy"><span>{t("当前策略")}</span><strong>{strategyText}</strong></div>
      <p className="section-note">{t("暂不能修改")}</p>
      <h3>{t("策略说明")}</h3>
      <p>{row.strategyNote || t("策略说明暂不可用。")}</p>
      <div className="preference-choices" role="group" aria-label={t("风险偏好")}>
        {PREFERENCES.map(([value, label]) => <button key={value} type="button" aria-pressed={view.preference === value} disabled={!canSaveRisk} onClick={() => { controller.edit({ preference: value }); sync(); }}>{t(label)}</button>)}
      </div>
      <p className="section-note">{!admin ? t("当前登录不能保存风险偏好。") : canSaveRisk ? t("只保存风险偏好，不会启用策略或提交订单。") : t("这项保存由服务端关闭，页面不能打开。")}</p>
      <div className="form-actions">
        <button type="button" className="button button-primary" disabled={!canSaveRisk || !dirty || Boolean(view.saving)} onClick={() => void savePreference()}>{t("保存风险偏好")}</button>
        <button type="button" className="button button-secondary" disabled={!dirty || !canSaveRisk} onClick={() => { controller.edit({ preference: savedPreference }); sync(); }}>{t("取消")}</button>
      </div>
      {view.notice && <p role="status">{view.notice}</p>}
    </>}
    <div className="activation-row"><span>{t("启用策略")}</span><strong>{row.activation === "—" ? "—" : t(row.activation)}</strong></div>
    {actions.stop && <button type="button" className="button button-secondary" disabled={!stopAllowed} onClick={onStop}>{t(stopLabel)}</button>}
    {actions.refresh && <button type="button" className="text-link" onClick={onRefreshStop}>{t("刷新停用状态")}</button>}
    {actions.resume && <button type="button" className="button button-secondary" onClick={onResume}>{t("恢复现有 Binance 目标")}</button>}
  </aside>;
}
