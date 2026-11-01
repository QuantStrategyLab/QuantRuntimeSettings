import { useRef, useState } from "react";
import { loadAuditEvents, type AuditEvent } from "../api/cockpit";
import { useApi } from "../lib/hooks";
import { useT } from "../i18n";
import { AuditTimeline } from "./cockpit";

export function mergeAuditEvents(previous: AuditEvent[], incoming: AuditEvent[]): AuditEvent[] {
  const seen = new Set(previous.map(event => event.event_id));
  return [...previous, ...incoming.filter(event => !seen.has(event.event_id))];
}

/** Remount on refresh; useApi discards responses from previous pages/unmounts. */
export function AuditHistory() {
  const t = useT();
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<AuditEvent[]>([]);
  const requested = useRef<string | null>(null);
  const read = useApi(() => loadAuditEvents(cursor), [cursor]);
  const page = read.phase === "ready" && read.data.status === "ready" ? read.data.data : null;
  const events = page ? mergeAuditEvents(previous, page.events) : previous;
  const unavailable = read.phase === "ready" && read.data.status === "not_ready";
  const status = events.length ? "ready" : read.phase === "loading" ? "loading"
    : read.phase === "error" ? "error" : unavailable ? "not_ready" : "ready";
  function more() {
    if (!page?.next_cursor || requested.current === page.next_cursor) return;
    requested.current = page.next_cursor;
    setPrevious(events);
    setCursor(page.next_cursor);
  }
  return <>
    <AuditTimeline events={events} status={status} hasMore={Boolean(page?.next_cursor)}
      loadingMore={read.phase === "loading"} onMore={more} />
    {read.phase === "loading" && previous.length > 0 && <p role="status">{t("common.loading")}</p>}
    {(read.phase === "error" || unavailable) && <>
      {previous.length > 0 && <p role="alert">{t("cockpit.change_log.load_failed")}</p>}
      <button className="button button-secondary button-sm" type="button" onClick={read.reload}>{t("common.retry")}</button>
    </>}
    {page && <p className="cockpit-note">{t("cockpit.change_log.coverage")}</p>}
  </>;
}
