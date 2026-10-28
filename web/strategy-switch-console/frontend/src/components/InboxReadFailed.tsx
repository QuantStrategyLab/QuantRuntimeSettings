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
  const retryAt = data?.directory?.complete === false ? data.directory.retry_at : null;
  return (
    <div className="error-state" role="alert" data-state={state}>
      <span className="state-icon state-icon-error" aria-hidden="true">
        <svg width={14} height={14} viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3.2 3.2 L6.8 6.8 M6.8 3.2 L3.2 6.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </span>
      <div className="state-copy">
        <div className="error-title">{t(`inbox.error.${state}.title`)}</div>
        {/* Never turn an unreadable inbox into an empty or zero-count inbox. */}
        <p className="state-short">{t("inbox.count_unknown")}</p>
        {state === "unauthorized" && <p className="state-short">{t("inbox.auth_hint")}</p>}
        {retryAt != null && Number.isFinite(retryAt) && retryAt > 0 && (
          <p className="state-short">{t("inbox.retry_at", { value: formatDateTime(new Date(retryAt).toISOString(), language).text })}</p>
        )}
      </div>
      {onRetry && state !== "unauthorized" && (
        <div className="state-action">
          <button type="button" className="button button-secondary button-sm" onClick={onRetry}>{t("inbox.retry")}</button>
        </div>
      )}
    </div>
  );
}
