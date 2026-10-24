import { useEffect, useState } from "react";
import { getJson } from "../../../api/client";
import { useApi } from "../../../lib/hooks";
import { useT } from "../../../i18n";
import { Badge, ErrorState, Skeleton } from "../../../components/primitives";
import { ConfirmationDialog } from "../../../components/Dialog";
import type { Catalog, CatalogRead, Level, Parameter, RiskRead, Value } from "./contracts";
import { definitionVersion, displaySteps, formatValue, isPercent, parseOverride, requestPhase, validateOverrides } from "./model";
import "./risk.css";

/** Read-only source contract. No account save/confirm/cancel API is called here. */
export default function RiskSettings({ platform, accountKey }: { platform: string; accountKey: string }) {
  const state = useApi(async () => {
    const [catalog, settings] = await Promise.all([
      getJson<CatalogRead>("/api/risk-levels/catalog"),
      getJson<RiskRead>(`/api/accounts/${encodeURIComponent(platform)}/${encodeURIComponent(accountKey)}/risk-settings`),
    ]);
    if (settings.contract_version !== "web-risk-console.readonly.v1" || settings.readonly !== true
      || catalog.catalog.definition_version !== definitionVersion) throw new Error("unsupported_risk_contract");
    return { catalog: catalog.catalog, settings };
  }, [platform, accountKey]);
  if (state.phase === "loading") return <Skeleton height={180} />;
  if (state.phase === "error") return <ErrorState onRetry={state.reload} />;
  return <RiskSettingsView catalog={state.data.catalog} settings={state.data.settings} reload={state.reload} />;
}

export function ParameterRow({ name, parameter, level, effective, draft, onEdit, onReset, error, readonly }: {
  name: string; parameter: Parameter; level: Level; effective: Value | null; draft?: string;
  onEdit: (value: string) => void; onReset: () => void; error?: string; readonly: boolean;
}) {
  const t = useT();
  const hasMapping = Object.hasOwn(displaySteps, name);
  const list = ["strategy_ids", "strategy_weights"].includes(name);
  const locked = readonly || !parameter.user_override_allowed || !hasMapping || list;
  const h = parameter.hard_limits;
  const recommended = parameter.defaults_by_level[level];
  const text = formatValue(name, recommended, parameter) ?? t("risk.unknown");
  const id = `risk-param-${name}`;
  const input = draft ?? (typeof recommended === "number" ? String(isPercent(parameter) ? Number((recommended * 100).toPrecision(12)) : recommended) : String(recommended));
  return <div className="risk-parameter" data-parameter={name}>
    <label htmlFor={id}>{t(`risk.param.${name}`)}</label>
    <dl className="risk-values">
      <div><dt>{t("risk.recommended")} · {t("risk.suggestion")}</dt><dd>{text}</dd></div>
      <div><dt>{t("risk.effective")}</dt><dd>{formatValue(name, effective, parameter) ?? t("risk.unknown")}</dd></div>
    </dl>
    <div className="risk-input-row">
      {h.enum ? <select id={id} className="input" disabled={locked} value={input} onChange={e => onEdit(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}>
        {h.enum.map(value => <option key={String(value)} value={String(typeof value === "number" && isPercent(parameter) ? value * 100 : value)}>{formatValue(name, value, parameter)}</option>)}
      </select> : list ? <span id={id}>{text}</span> : <input id={id} className="input" type="text" inputMode="decimal" disabled={locked} value={input} onChange={e => onEdit(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />}
      {locked && <Badge tone="unknown">{t(list ? "risk.strategy_missing" : !hasMapping ? "risk.map_missing" : "risk.locked")}</Badge>}
      {draft !== undefined && <><Badge tone="warn">{t("risk.custom")}</Badge><button className="button button-secondary button-sm" type="button" onClick={onReset}>{t("risk.restore")}</button></>}
    </div>
    {h.minimum !== undefined && <p className="card-note">{t("risk.range")}: {formatValue(name, h.minimum, parameter)} – {formatValue(name, h.maximum, parameter)}</p>}
    {error && <p className="risk-error" id={`${id}-error`} role="alert">{t(`risk.error.${error}`)}</p>}
    <details className="risk-wire"><summary>{t("risk.param_id")}</summary><code>{name}</code><p>{parameter.unit}</p></details>
  </div>;
}

export function RiskAudit({ audit }: { audit: RiskRead["audit"] }) {
  const t = useT();
  const statuses = ["RECORDED", "COMPENSATED", "PENDING_BACKFILL", "MISSING_TIMEOUT", "UNRECOVERABLE"];
  return <section className="card section-stack">
    <h3 className="card-title">{t("risk.audit")}</h3>
    <p>{t(`risk.audit.${statuses.includes(audit.event_status) ? audit.event_status : "UNKNOWN"}`)}</p>
    {audit.gaps_discovery !== "complete" && <p className="card-note">{t("risk.audit_partial")}</p>}
    {audit.outstanding_gaps.map(gap => <div className="risk-gap" key={gap.event_id}>
      <Badge tone="warn">{t(`risk.audit.${statuses.includes(gap.event_status) ? gap.event_status : "UNKNOWN"}`)}</Badge>
      {gap.backfill_blocked && <p>{["PAYLOAD_FIELD_MISSING", "PAYLOAD_HASH_MISMATCH", "PAYLOAD_SOURCE_MISSING"].includes(gap.backfill_blocked) ? t(`risk.blocked.${gap.backfill_blocked}`) : t("risk.audit_unknown")}</p>}
      <details><summary>{t("risk.event_ref")}</summary><code>{gap.event_id}</code></details>
    </div>)}
  </section>;
}

export function RiskSettingsView({ catalog, settings, reload }: { catalog: Catalog; settings: RiskRead; reload: () => void }) {
  const t = useT();
  const [level, setLevel] = useState<Level | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [showRequirements, setShowRequirements] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // A monotonic elapsed clock updates display only, never enables any mutation.
    setElapsed(0);
    const start = performance.now();
    const timer = window.setInterval(() => {
      const delta = performance.now() - start;
      setElapsed(delta);
      if (settings.request && delta >= 60000) { window.clearInterval(timer); reload(); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [settings, reload]);
  const overrides: Record<string, Value> = {};
  const parseErrors: Record<string, string> = {};
  for (const [key, value] of Object.entries(drafts)) {
    try { overrides[key] = parseOverride(value, catalog.parameters[key]); }
    catch { parseErrors[key] = "INVALID_REQUEST"; }
  }
  const errors = level ? { ...validateOverrides(catalog, level, overrides), ...parseErrors } : {};
  const phase = settings.request && elapsed >= 60000 ? "TIME_UNSYNCED" : requestPhase(settings.request, settings.server_time, elapsed);
  const phases = ["COOLDOWN", "AWAITING_FINAL", "REQUEST_EXPIRED", "CONFIRMED_NOT_APPLIED", "CANCELLED", "TIME_UNSYNCED"];
  const update = (name: string, value?: string) => {
    setChecked(false);
    setDrafts(previous => { const next = { ...previous }; if (value === undefined) delete next[name]; else next[name] = value; return next; });
  };
  const mapped = settings.legacy_preference.mapped_level;
  return <div className="section-stack risk-settings">
    <section className="card section-stack">
      <div className="risk-heading"><h2 className="card-title">{t("risk.title")}</h2><Badge tone="warn">{t("risk.suggestion")}</Badge></div>
      <p>{t("risk.readonly")}</p>
      <p className="card-note">{t("risk.write_blocked")}</p>
      <dl className="risk-values"><div><dt>{t("risk.legacy")}</dt><dd>{mapped ? t(`risk.${mapped}`) : settings.legacy_preference.value ? t("risk.unknown") : t("risk.no_preference")}</dd></div>
        <div><dt>{t("risk.effective")}</dt><dd>{t("risk.unknown")}</dd></div></dl>
      <p className="card-note">{t("risk.local")}</p>
      <div className="risk-levels" role="group" aria-label={t("risk.browse")}>
        {catalog.levels.map(candidate => <button type="button" key={candidate} className={`risk-level${candidate === level ? " selected" : ""}`} aria-pressed={level === candidate} onClick={() => { setLevel(candidate); setDrafts({}); setChecked(false); }}>
          <strong>{t(`risk.${candidate}`)}</strong><span className="badge badge-warn">{t("risk.suggestion")}</span>
          {["kelly_fraction", "target_annual_volatility", "max_drawdown_tolerance", "cash_floor_ratio"].map(name => <span key={name}>{t(`risk.param.${name}`)}: {formatValue(name, catalog.parameters[name].defaults_by_level[candidate], catalog.parameters[name])}</span>)}
        </button>)}
      </div>
      <details className="risk-advanced"><summary>{t("risk.advanced")} · {t("risk.suggestion")}</summary>
        {!level ? <p>{t("risk.choose")}</p> : <>
          <p className="card-note">{t("risk.readonly")}</p>
          <div className="risk-parameters">{Object.entries(catalog.parameters).map(([name, parameter]) => <ParameterRow key={name} name={name} parameter={parameter} level={level} effective={settings.effective?.[name] ?? null} draft={drafts[name]} onEdit={value => update(name, value)} onReset={() => update(name)} error={errors[name]} readonly={settings.readonly || catalog.definition_version !== definitionVersion} />)}</div>
          <div className="risk-actions"><button type="button" className="button button-secondary" disabled={settings.readonly} onClick={() => { setDrafts({}); setChecked(false); }}>{t("risk.restore")}</button>
            <button type="button" className="button button-secondary" disabled={settings.readonly || !!Object.keys(errors).length} onClick={() => setChecked(true)}>{t("risk.check")}</button></div>
          {checked && <p role="status">{t("risk.valid")}</p>}
        </>}
      </details>
      <p>{t(`risk.phase.${phases.includes(phase) ? phase : "UNKNOWN"}`)}</p>
      {settings.request?.cooldown_until_utc && <p>{t("risk.until")}: <time>{settings.request.cooldown_until_utc}</time></p>}
      {settings.request?.final_confirmation_deadline_utc && <p>{t("risk.deadline")}: <time>{settings.request.final_confirmation_deadline_utc}</time></p>}
      <p className="card-note">{t("risk.server_time")}: <time>{settings.server_time}</time></p>
      <div className="risk-actions"><button className="button button-secondary" type="button" onClick={() => setShowRequirements(true)}>{t("risk.confirm")}</button><button className="button button-secondary" type="button" onClick={reload}>{t("risk.refresh")}</button></div>
    </section>
    <section className="card"><h3 className="card-title">{t("risk.disclosure")}</h3><p>{t("risk.disclosure_body")}</p></section>
    <RiskAudit audit={settings.audit} />
    {showRequirements && <ConfirmationDialog request={{ title: t("risk.confirm_title"), summary: t("risk.confirm_note"), body: <p role="note">{t("risk.disclosure")}<br />{t("risk.disclosure_body")}</p>, ackLabel: t("risk.ack"), confirmDisabled: true, confirmLabel: t("risk.submit_unavailable") }} onResolve={() => setShowRequirements(false)} />}
  </div>;
}
