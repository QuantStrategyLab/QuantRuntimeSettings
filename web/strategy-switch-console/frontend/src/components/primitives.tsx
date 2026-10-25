import type { ReactNode } from "react";
import { useLanguage, useT, type MessageKey } from "../i18n";
import { usePrefs } from "../app/context";
import { formatDate, formatDateTime, formatMoney, formatPercent } from "../lib/format";
import type { Status } from "../api/contracts";

/* ---------- status badges (icon + text, never color alone) ---------- */

type Tone = "ok" | "warn" | "error" | "unknown";

function ToneIcon({ tone, size = 10 }: { tone: Tone; size?: number }) {
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
  review: "warn",
  watch: "warn",
  critical: "error",
  fresh: "ok",
  blocked: "error",
  failed: "error",
  read_incomplete: "error",
  insufficient: "warn",
  previewed: "unknown",
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

/**
 * Statuses that only describe data availability, not an operational outcome.
 * They must not tile the pages with small error text: the amount, as-of stamp
 * or empty state already says what is known, and the exact state plus reason
 * stay in a hidden marker for API debugging. Operational outcomes
 * (failed/blocked/critical/watch/review, ...) keep their visible badge.
 */
const DIAGNOSTIC_STATUSES = new Set([
  "partial",
  "stale",
  "no_data",
  "not_connected",
  "unavailable",
  "unknown",
  "read_failed",
  "read_incomplete",
  "insufficient",
]);

export function StatusBadge({ status, reason }: { status: string | null | undefined; reason?: string | null }) {
  const t = useT();
  const value = status || "unknown";
  // A hidden element takes no space and stays out of the accessibility tree;
  // the attributes keep the exact diagnostic available to interface debugging.
  if (DIAGNOSTIC_STATUSES.has(value)) {
    return <span hidden data-status={value} data-reason={reason ?? undefined} />;
  }
  const key = `state.${value}`;
  const reasonKey = reason ? `reason.${reason}` : null;
  const title = reasonKey ? t(reasonKey as MessageKey) : undefined;
  return <Badge tone={statusTone(value)} title={title}>{t(key as MessageKey)}</Badge>;
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
  // Keep the value in its own element so flex rows can place the label left
  // and the date right instead of letting auto margins move the only span.
  return <span className="account-row-value">{formatDate(value, language)}</span>;
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

/**
 * Compact placeholder: one short state and an em dash stay visible. Extra
 * explanation is a single short line, not an audit-style disclosure.
 */
export function EmptyState({
  title,
  body,
  action,
  state = "no_data",
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  state?: string;
}) {
  return (
    <div className="empty-state" data-state={state}>
      <span className="state-icon" aria-hidden="true"><ToneIcon tone="unknown" size={14} /></span>
      <div className="state-copy">
        <div className="empty-title">{title}</div>
        {body && <p className="state-short">{body}</p>}
      </div>
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="error-state" role="alert" data-state="read_failed">
      <span className="state-icon state-icon-error" aria-hidden="true"><ToneIcon tone="error" size={14} /></span>
      <div className="state-copy">
        <div className="error-title">{t("state.load_failed")}</div>
      </div>
      {/* A retry control exists only when the caller has a real reload callback. */}
      {onRetry && (
        <div className="state-action">
          <button type="button" className="button button-secondary button-sm" onClick={onRetry}>{t("common.retry")}</button>
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
    const reasonText = reason ? t(`reason.${reason}` as MessageKey) : null;
    return (
      <>
        {children}
        {(status !== "ok" || asOf || reasonText) && (
          <div className="state-inline" data-state={status}>
            {status !== "ok" && <StatusBadge status={status} reason={reason} />}
            {/* Coverage/freshness reason is shown once, next to the time it qualifies. */}
            {reasonText && <span className="state-short">{reasonText}</span>}
            {asOf && <AsOfStamp value={asOf} />}
          </div>
        )}
      </>
    );
  }
  const reasonText = reason ? t(`reason.${reason}` as MessageKey) : undefined;
  return (
    <EmptyState
      title={emptyTitle || t(`state.${status || "no_data"}` as MessageKey)}
      body={reasonText}
      state={status || "no_data"}
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
