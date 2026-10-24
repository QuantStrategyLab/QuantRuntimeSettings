import type { InboxResponse } from "../api/contracts";
import { inboxFailureState } from "../lib/inboxFailure";
import { formatDateTime } from "../lib/format";
import { useLanguage, useT } from "../i18n";

export function InboxReadFailed({ data, error, onRetry }: {
  data?: InboxResponse | null;
  error?: Error | null;
  onRetry?: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const state = inboxFailureState(data, error);
  const failed = data?.sources.filter(source => source.status === "read_failed") || [];
  const retryAt = data?.directory?.complete === false ? data.directory.retry_at : null;
  return (
    <div className="error-state" role="alert">
      <span className="state-icon state-icon-error" aria-hidden="true">
        <svg width={14} height={14} viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3.2 3.2 L6.8 6.8 M6.8 3.2 L3.2 6.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </span>
      <div className="state-copy">
        <div className="error-title">{t(`inbox.error.${state}.title`)}</div>
        <p className="state-short">{t("inbox.count_unknown")}</p>
        <details className="state-details">
          <summary>{t("common.details")}</summary>
          <p>{t(`inbox.error.${state}.detail`)}</p>
          {failed.length > 0 && <ul>{failed.map(source => (
            <li key={source.source}>{t(`decisions.source.${source.source}`)}: {t(`inbox.error.${source.error_state || "unknown"}.title`)}</li>
          ))}</ul>}
          {retryAt != null && Number.isFinite(retryAt) && retryAt > 0 && (
            <p>{t("inbox.retry_at", { value: formatDateTime(new Date(retryAt).toISOString(), language).text })}</p>
          )}
          <p>{t(state === "unauthorized" ? "inbox.auth_hint" : "inbox.retry_hint")}</p>
        </details>
      </div>
      {onRetry && state !== "unauthorized" && (
        <div className="state-action">
          <button type="button" className="button button-secondary button-sm" onClick={onRetry}>{t("inbox.retry")}</button>
        </div>
      )}
    </div>
  );
}
