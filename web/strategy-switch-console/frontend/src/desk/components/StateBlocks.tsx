import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskTranslate } from "../i18n/index.ts";
import { freshnessView, isReadExpired, readGeneration, readTimedOut, READ_TIMEOUT_MS } from "./stateModel.ts";
import type { FreshnessChipState } from "./stateModel.ts";

const col: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, minWidth: 0 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };
const note: CSSProperties = { margin: 0, color: "var(--mrd-ink-3)", fontSize: 12 };

export function SkeletonBlock({ width = "100%", height = 16 }: { width?: number | string; height?: number | string }) {
  return <span className="mrd-skeleton" style={{ width, height }} aria-hidden="true" />;
}

export interface LoadingStateProps {
  t: DeskTranslate;
  /** Accessible label for the busy region. */
  label?: string;
  /** When the read started; the skeleton becomes a read failure after 10 s. */
  startedAt?: number;
  timeoutMs?: number;
  onRetry?: () => void;
}

/**
 * Skeleton loading never shows 0, $0 or an old number: it only draws placeholder
 * bars. After the timeout it becomes an honest, recoverable read failure.
 */
export function LoadingState({ t, label, startedAt = Date.now(), timeoutMs = READ_TIMEOUT_MS, onRetry }: LoadingStateProps) {
  const generation = readGeneration(startedAt, timeoutMs);
  const [expiredGeneration, setExpiredGeneration] = useState<string | null>(() =>
    readTimedOut(startedAt, Date.now(), timeoutMs) ? generation : null,
  );
  const timedOut = isReadExpired(expiredGeneration, generation);

  useEffect(() => {
    if (timedOut) return;
    const remaining = Math.max(0, startedAt + timeoutMs - Date.now());
    const timer = window.setTimeout(() => setExpiredGeneration(generation), remaining);
    return () => window.clearTimeout(timer);
  }, [startedAt, timeoutMs, generation, timedOut]);

  if (timedOut) return <RecoverableErrorState t={t} message={t("states.read_failed_after")} onRetry={onRetry} />;

  return (
    <section className="mrd-card" style={{ ...col, gap: 12 }} aria-busy="true" aria-label={label ?? t("states.loading_skeleton")} data-state="loading">
      <SkeletonBlock width={140} height={12} />
      <SkeletonBlock width="72%" height={22} />
      <SkeletonBlock width="100%" height={12} />
      <SkeletonBlock width="88%" height={12} />
      <SkeletonBlock width="54%" height={12} />
    </section>
  );
}

export function EmptyState({ t, title, body }: { t: DeskTranslate; title?: string; body?: string }) {
  return (
    <section className="mrd-card" style={col} data-state="empty" role="status">
      <span className="mrd-label">{t("states.empty_title")}</span>
      <p style={{ margin: 0 }}>{title ?? t("states.empty")}</p>
      {body ? <p style={note}>{body}</p> : null}
    </section>
  );
}

export function RecoverableErrorState({ t, message, onRetry }: { t: DeskTranslate; message?: string; onRetry?: () => void }) {
  return (
    <section className="mrd-card" style={col} data-state="error" role="alert">
      <span className="mrd-label">{t("states.error_title")}</span>
      <p style={{ margin: 0 }}>{message ?? t("states.error")}</p>
      {onRetry ? (
        <div style={row}>
          <button type="button" className="mrd-button" onClick={onRetry}>{t("states.retry")}</button>
        </div>
      ) : null}
    </section>
  );
}

export interface StalePartialBannerProps {
  t: DeskTranslate;
  language: Language;
  ageSeconds?: number | null;
  included?: number | null;
  total?: number | null;
}

/** Stale or partial data keeps its own wording; it never turns green. */
export function StalePartialBanner({ t, language, ageSeconds, included, total }: StalePartialBannerProps) {
  const age = freshnessView({ kind: "read", data_status: "stale", age_seconds: ageSeconds ?? null }, language).age;
  const partial = typeof included === "number" && typeof total === "number" && included < total
    ? t("states.partial_detail", { included, total })
    : null;
  return (
    <div className="mrd-chip" data-tone="unknown" role="status" style={{ whiteSpace: "normal", alignItems: "flex-start" }}>
      <i aria-hidden="true" />
      <span>
        {t("states.stale", { age: age ?? "—" })}
        {partial ? ` · ${partial}` : ""}
      </span>
    </div>
  );
}

export function FreshnessChip({ state, t, language }: { state: FreshnessChipState; t: DeskTranslate; language: Language }) {
  const view = freshnessView(state, language);
  return (
    <span className="mrd-chip" data-tone={view.tone} role="status" data-freshness={state.kind === "read" ? state.data_status : state.kind}>
      <i aria-hidden="true" />
      {t(view.key, { age: view.age ?? "—" })}
    </span>
  );
}
