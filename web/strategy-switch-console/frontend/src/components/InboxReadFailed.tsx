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
      <div className="error-title">{t(`inbox.error.${state}.title`)}</div>
      <p>{t(`inbox.error.${state}.detail`)}</p>
      {failed.length > 0 && <ul style={{ textAlign: "left" }}>{failed.map(source => (
        <li key={source.source}>{t(`decisions.source.${source.source}`)}: {t(`inbox.error.${source.error_state || "unknown"}.title`)}</li>
      ))}</ul>}
      {retryAt != null && Number.isFinite(retryAt) && retryAt > 0 && (
        <p>{t("inbox.retry_at", { value: formatDateTime(new Date(retryAt).toISOString(), language).text })}</p>
      )}
      <p>{t("inbox.count_unknown")}</p>
      <p>{t(state === "unauthorized" ? "inbox.auth_hint" : "inbox.retry_hint")}</p>
      {onRetry && state !== "unauthorized" && <button type="button" className="button button-secondary" onClick={onRetry}>{t("inbox.retry")}</button>}
    </div>
  );
}
