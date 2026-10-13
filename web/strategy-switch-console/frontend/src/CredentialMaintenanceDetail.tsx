import { useEffect, useState } from "react";
import type { CredentialMaintenance } from "./api";
import { useT } from "./locales";

export function CredentialMaintenanceDetail({ value, error, admin, busy, onSave, onReload }: {
  value: CredentialMaintenance | null; error: string | null; admin: boolean; busy: boolean;
  onSave?: (expiry: string, revision: number) => Promise<CredentialMaintenance>; onReload?: () => Promise<CredentialMaintenance>;
}) {
  const t = useT();
  const [expiry, setExpiry] = useState(value?.expires_at || "");
  const [editingRevision, setEditingRevision] = useState(value?.metadata_revision ?? null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (editingRevision === null && value) {
      setEditingRevision(value.metadata_revision);
      if (!expiry) setExpiry(value.expires_at || "");
    }
  }, [value, editingRevision, expiry]);
  const heading = error || !value ? "到期时间读取失败" : value.phase === "unknown" ? "登记到期时间" : value.phase === "expired" ? "已到登记到期时间" : value.phase === "not_due" ? "管理到期记录" : "即将到登记到期时间";
  async function reload() {
    if (!admin || busy || !onReload) return;
    try {
      const fresh = await onReload();
      setExpiry(fresh.expires_at || "");
      setEditingRevision(fresh.metadata_revision);
      setStatus(null);
    } catch { setStatus("到期时间读取失败"); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!admin || busy || !onSave || !value || editingRevision === null) return;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(expiry)) { setStatus("到期时间格式无效"); return; }
    setStatus(null);
    try { const saved = await onSave(expiry, editingRevision); setExpiry(saved.expires_at || ""); setEditingRevision(saved.metadata_revision); setStatus("到期记录已保存"); }
    catch { setStatus("到期记录未确认保存"); }
  }
  return <section className="credential-maintenance">
    <p className="kicker">{t("凭据维护")}</p><h2>{t(heading)}</h2>
    <dl className="decision-facts"><div><dt>IBKR Flex</dt><dd>{value?.expires_at || t("到期时间未知")}</dd></div></dl>
    {value?.delivery === "delivered" ? <p role="status">{t("提醒已发送")}</p> : value?.delivery === "reserved" ? <p role="status">{t("提醒已预留")}</p> : value?.delivery === "unknown" ? <p role="status">{t("提醒发送未确认")}</p> : null}
    {admin && <form onSubmit={event => void save(event)}><label>{t("到期时刻（含时区）")}<input type="text" value={expiry} onChange={event => { setExpiry(event.target.value); setStatus(null); }} disabled={busy} autoComplete="off" spellCheck={false} /></label><div className="form-actions"><button type="submit" className="button button-primary" disabled={busy || !value || !onSave}>{t("保存到期记录")}</button>{onReload && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void reload()}>{t("重新读取待办")}</button>}</div></form>}
    {status && <p role="status">{t(status)}</p>}
  </section>;
}
