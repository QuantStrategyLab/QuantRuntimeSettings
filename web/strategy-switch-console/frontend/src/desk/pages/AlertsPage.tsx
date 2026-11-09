import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../../lib/format";
import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { AlertDelivery, Alerts } from "../contract/types";
import { deskText } from "../i18n/index.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { alertWhen, filterCounts, sortAlerts, type SeverityFilter } from "../alerts/model.ts";

type Loaded<T> = { state: "loading" } | { state: "failed" } | { state: "ready"; result: DeskResult<T> };
type Filter = SeverityFilter;

const SEVERITY_FILTERS: Filter[] = ["all", "critical", "warning", "info"];
const FILTER_KEYS: Record<Filter, DeskKey> = {
  all: "alerts.filter.all",
  critical: "alerts.filter.critical",
  warning: "alerts.filter.warning",
  info: "alerts.filter.info",
};
const clockUtc = (time: string): string => `${time} UTC`;

export function AlertsPage({ api, t, language }: { api: DeskApi; t: DeskTranslate; language: Language }) {
  const [alerts, setAlerts] = useState<Loaded<Alerts>>({ state: "loading" });
  const [delivery, setDelivery] = useState<Loaded<AlertDelivery>>({ state: "loading" });
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let alive = true;
    setAlerts({ state: "loading" });
    api.alerts().then(
      result => alive && setAlerts({ state: "ready", result }),
      () => alive && setAlerts({ state: "failed" }),
    );
    return () => { alive = false; };
  }, [api]);

  useEffect(() => {
    let alive = true;
    setDelivery({ state: "loading" });
    api.alertDelivery().then(
      result => alive && setDelivery({ state: "ready", result }),
      () => alive && setDelivery({ state: "failed" }),
    );
    return () => { alive = false; };
  }, [api]);

  const loaded = alerts.state === "ready" ? alerts.result : null;
  const counts = useMemo(() => filterCounts(loaded?.data.items ?? []), [loaded]);
  const visible = useMemo(() => {
    const items = loaded ? sortAlerts(loaded.data.items) : [];
    return filter === "all" ? items : items.filter(item => item.severity === filter);
  }, [loaded, filter]);

  const summary = loaded
    ? loaded.data.counts.open > 0
      ? t("alerts.summary", { open: loaded.data.counts.open, critical: loaded.data.counts.critical })
      : t("alerts.summary.none")
    : t("states.loading");

  const body = alerts.state === "loading" ? <section className="mrd-card" aria-busy="true"><p>{t("states.loading")}</p></section>
    : alerts.state === "failed" || !loaded ? <section className="mrd-card" role="status"><p>{t("states.error")}</p></section>
    : (
      <div className="mrd-alerts">
        <section className="mrd-card mrd-alerts-list" aria-labelledby="mrd-page-title">
          <div className="mrd-alerts-head">
            <span className="mrd-label">{t("alerts.eyebrow")}</span>
            <h1 id="mrd-page-title" className="mrd-serif mrd-alerts-title">{summary}</h1>
            <span className="mrd-note">{t("alerts.meta", { total: loaded.data.counts.last_7d_total })}</span>
          </div>
          <div className="mrd-seg mrd-severity-filter" role="group" aria-label={t("alerts.filter.label")}>
            {SEVERITY_FILTERS.map(key => (
              <button
                key={key}
                type="button"
                className="mrd-chip mrd-severity-chip"
                aria-pressed={filter === key}
                data-severity={key}
                onClick={() => setFilter(key)}
              >
                {t(FILTER_KEYS[key], { count: counts[key] })}
              </button>
            ))}
          </div>
          {visible.length === 0 ? <p className="mrd-note mrd-alerts-empty">{t("alerts.empty")}</p> : (
            <ul className="mrd-alert-rows">
              {visible.map(item => (
                <li key={item.id} className="mrd-alert-row" data-severity={item.severity} data-status={item.status}>
                  <div className="mrd-alert-meta">
                    <span className={`mrd-badge mrd-severity-${item.severity}`}>{t(`severity.${item.severity}`)}</span>
                    <span className="mrd-alert-target">{item.target_id ?? item.source}</span>
                    <span className="mrd-alert-time">
                      {(() => {
                        const when = alertWhen(item);
                        if (when.kind === "resolved") return t("alerts.resolved");
                        if (when.kind === "once") return when.first;
                        return t("alerts.first_last", { first: when.first, last: when.last });
                      })()}
                    </span>
                  </div>
                  <h2 className="mrd-alert-title">{deskText(language, item.title)}</h2>
                  <p className="mrd-alert-detail">{deskText(language, item.detail)}</p>
                  {item.route ? <a className="mrd-alert-action" href={item.route}>{t("alerts.action")}</a> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="mrd-card mrd-delivery" aria-label={t("alerts.delivery.title")}>
          <span className="mrd-label">{t("alerts.delivery.title")}</span>
          <DeliveryBody state={delivery} t={t} language={language} />
          <ul className="mrd-delivery-notes">
            <li>{t("alerts.note.readonly")}</li>
            <li>{t("alerts.note.auto_close")}</li>
            <li>{t("alerts.note.unknown")}</li>
          </ul>
        </aside>
      </div>
    );

  return (
    <section className="mrd-alerts-page" aria-labelledby="mrd-page-title">
      {loaded?.source === "mock" || (delivery.state === "ready" && delivery.result.source === "mock")
        ? <p className="mrd-note mrd-page-note" title={t("mock.title")}>{t("mock.badge")}</p> : null}
      {body}
    </section>
  );
}

function DeliveryBody({ state, t, language }: { state: Loaded<AlertDelivery>; t: DeskTranslate; language: Language }) {
  if (state.state === "loading") return <p className="mrd-note">{t("states.loading")}</p>;
  if (state.state === "failed") return <p className="mrd-note">{t("states.error")}</p>;
  const data = state.result.data;
  const status = data.channel.status.status === "known"
    ? t(data.channel.status.value === "ok" ? "alerts.delivery.status.ok" : "alerts.delivery.status.failing")
    : t("alerts.delivery.unknown");
  return (
    <>
      <p className="mrd-delivery-name">{data.channel.name}</p>
      <span className="mrd-badge" data-status={data.channel.status.status === "known" ? data.channel.status.value : "unknown"}>
        {status}
      </span>
      <dl className="mrd-delivery-grid">
        <dt>{t("alerts.delivery.last")}</dt>
        <dd>{data.last_delivery ? formatDateTime(data.last_delivery.at, language).text : t("alerts.delivery.unknown")}</dd>
        <dt>{t("alerts.delivery.recipients")}</dt>
        <dd>{data.last_delivery ? data.last_delivery.recipients : t("alerts.delivery.unknown")}</dd>
        <dt>{t("alerts.delivery.digest")}</dt>
        <dd>{data.digest ? clockUtc(data.digest.schedule_utc) : t("alerts.delivery.unknown")}</dd>
        <dt>{t("alerts.delivery.digest_last")}</dt>
        <dd>{data.digest ? t("alerts.delivery.digest_targets", { targets: data.digest.targets, runs: data.digest.runs }) : t("alerts.delivery.unknown")}</dd>
      </dl>
    </>
  );
}
