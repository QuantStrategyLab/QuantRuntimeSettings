import type { ReactNode } from "react";
import { useLanguage, useT, type MessageKey } from "../i18n";
import { usePrefs } from "../app/context";
import { formatDate, formatDateTime, formatMoney, formatPercent } from "../lib/format";
import type { Status } from "../api/contracts";

/* ---------- status badges (icon + text, never color alone) ---------- */

type Tone = "ok" | "warn" | "error" | "unknown";

function ToneIcon({ tone }: { tone: Tone }) {
  const size = 10;
  if (tone === "ok")
    return (
      <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1.5 5.5 L4 8 L8.5 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (tone === "warn")
    return (
      <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 1 L9.5 9 H0.5 Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <line x1="5" y1="4" x2="5" y2="6.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="5" cy="7.8" r="0.7" fill="currentColor" />
      </svg>
    );
  if (tone === "error")
    return (
      <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
        <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3.2 3.2 L6.8 6.8 M6.8 3.2 L3.2 6.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.4" />
    </svg>
  );
}

export function Badge({ tone, children, title }: { tone: Tone | "accent"; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {tone !== "accent" && <ToneIcon tone={tone} />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  healthy: "ok",
  no_signal: "ok",
  ok: "ok",
  partial: "warn",
  stale: "warn",
  no_data: "unknown",
  not_connected: "unknown",
  unavailable: "unknown",
  read_failed: "error",
};

export function statusTone(status: string | null | undefined): Tone {
  return STATUS_TONE[status || ""] || "unknown";
}

export function StatusBadge({ status, reason }: { status: string | null | undefined; reason?: string | null }) {
  const t = useT();
  const key = `state.${status || "unknown"}`;
  const reasonKey = reason ? `reason.${reason}` : null;
  const title = reasonKey ? t(reasonKey as MessageKey) : undefined;
  return <Badge tone={statusTone(status)} title={title}>{t(key as MessageKey)}</Badge>;
}

/* ---------- as-of stamp ---------- */

export function AsOfStamp({ value, prefix = "common.as_of" }: { value: string | null | undefined; prefix?: MessageKey }) {
  const t = useT();
  const language = useLanguage();
  if (!value) return <span className="asof">{t(prefix, { value: t("common.na") })}</span>;
  const { text, zone } = formatDateTime(value, language);
  return <span className="asof">{t(prefix, { value: zone ? `${text} (${zone})` : text })}</span>;
}

export function DateText({ value }: { value: string | null | undefined }) {
  const language = useLanguage();
  return <>{formatDate(value, language)}</>;
}

/* ---------- money / percent ---------- */

export function Money({ value, currency, signed = false }: { value: number | null | undefined; currency?: string | null; signed?: boolean }) {
  const language = useLanguage();
  const { prefs } = usePrefs();
  if (prefs.hideAmounts) return <span className="money">•••</span>;
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="money flat">—</span>;
  const text = formatMoney(signed ? Math.abs(value) : value, currency, language);
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : "";
  const tone = !signed || value === 0 ? "flat" : value > 0 ? "up" : "down";
  return <span className={`money ${tone}`}>{sign}{text}</span>;
}

export function Percent({ value, digits = 2 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="percent flat">—</span>;
  const language = useLanguage();
  const tone = value === 0 ? "flat" : value > 0 ? "up" : "down";
  return <span className={`percent ${tone}`}>{formatPercent(value, language, digits)}</span>;
}

/* ---------- state wrappers ---------- */

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {body && <div>{body}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="error-state" role="alert">
      <div className="error-title">{t("state.read_failed")}</div>
      <div>{t("error.generic")}</div>
      {onRetry && (
        <div style={{ marginTop: 12 }}>
          <button type="button" className="button button-secondary" onClick={onRetry}>{t("common.retry")}</button>
        </div>
      )}
    </div>
  );
}

/**
 * Renders a data block honoring its status: non-ok statuses replace the content
 * with an honest state (never fabricated data); ok renders children plus a badge when partial/stale.
 */
export function DataBlock({
  status,
  reason,
  asOf,
  children,
  emptyTitle,
}: {
  status: Status | "read_failed" | string | null | undefined;
  reason?: string | null;
  asOf?: string | null;
  children: ReactNode;
  emptyTitle?: string;
}) {
  const t = useT();
  if (status === "ok" || status === "partial" || status === "stale") {
    return (
      <>
        {children}
        <div className="kpi-foot">
          {status !== "ok" && <StatusBadge status={status} reason={reason} />}
          {asOf && <AsOfStamp value={asOf} />}
        </div>
      </>
    );
  }
  const reasonText = reason ? t(`reason.${reason}` as MessageKey) : undefined;
  return (
    <EmptyState
      title={emptyTitle || t(`state.${status || "no_data"}` as MessageKey)}
      body={reasonText}
    />
  );
}

/* ---------- method note (如何计算) ---------- */

export function MethodNote({ titleKey, bodyKey }: { titleKey: MessageKey; bodyKey: MessageKey }) {
  const t = useT();
  return (
    <details className="method-note">
      <summary>{t(titleKey)}</summary>
      <p className="card-note">{t(bodyKey)}</p>
    </details>
  );
}
