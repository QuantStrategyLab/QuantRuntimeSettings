import { loadRuntimeReadback, type RuntimeReadback } from "../api/cockpit";
import { useApi } from "../lib/hooks";
import { useT } from "../i18n";
import { AsOfStamp, ErrorState, Skeleton } from "./primitives";

export function RuntimeReadbackDetails({ value }: { value: RuntimeReadback }) {
  const t = useT();
  return <>
    {value.data_status !== "ready" && <p role="status">{t(`cockpit.freshness.${value.data_status}`)}</p>}
    <dl className="cockpit-meta">
      <dt>{t("cockpit.runtime.switch")}</dt>
      <dd>{t(value.runtime_enabled === null ? "cockpit.unknown" : value.runtime_enabled ? "cockpit.runtime.enabled" : "cockpit.runtime.disabled")}</dd>
      <dt>{t("cockpit.runtime.scheduler")}</dt>
      <dd>{t(`cockpit.runtime.scheduler.${value.scheduler_state}`)}</dd>
    </dl>
    {value.observed_at && <AsOfStamp value={value.observed_at} />}
  </>;
}

export function RuntimeReadbackPanel({ scope }: { scope: string }) {
  const t = useT();
  const read = useApi(() => loadRuntimeReadback(scope), [scope]);
  return <section className="card">
    <h3>{t("cockpit.runtime.title")}</h3>
    {read.phase === "loading" ? <Skeleton height={64} /> : read.phase === "error"
      ? <ErrorState onRetry={read.reload} /> : read.data.status === "not_ready"
        ? <p>{t("cockpit.freshness.unavailable")}</p> : <RuntimeReadbackDetails value={read.data.data} />}
    <p className="cockpit-note">{t("cockpit.runtime.boundary")}</p>
  </section>;
}
