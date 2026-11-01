import type { CredentialExpiryReminder, CredentialExpirySeverity, InboxItem } from "../../api/contracts";
import { useLanguage, useT } from "../../i18n";
import { formatDateTime } from "../../lib/format";
import { Badge } from "../../components/primitives";

const SEVERITIES: readonly CredentialExpirySeverity[] = ["none", "unknown", "notice", "warning", "urgent", "expired"];

/**
 * Reduce an older or malformed response to an honest unknown state. Severity and
 * days come from the server only; the browser never derives them from its clock.
 */
export function readCredentialExpiry(value: unknown): CredentialExpiryReminder {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { expires_at: null, days_remaining: null, severity: "unknown" };
  }
  const raw = value as Partial<CredentialExpiryReminder>;
  const severity = SEVERITIES.includes(raw.severity as CredentialExpirySeverity)
    ? raw.severity as CredentialExpirySeverity
    : "unknown";
  const days = raw.days_remaining === undefined || raw.days_remaining === null
    || !Number.isSafeInteger(raw.days_remaining) || raw.days_remaining < 0
    ? null
    : raw.days_remaining;
  const expires = typeof raw.expires_at === "string" && Number.isFinite(Date.parse(raw.expires_at))
    ? raw.expires_at
    : null;
  return { expires_at: expires, days_remaining: days, severity };
}

/**
 * Expired-row treatment keys off server fields only: the item status computed at
 * read time and, for credential maintenance, the projection's severity. The
 * browser never compares clocks to dim a row.
 */
export function isExpiredRow(item: Pick<InboxItem, "status" | "category" | "credential_expiry">): boolean {
  if (item.status === "expired") return true;
  if (item.category === "credential_maintenance") return readCredentialExpiry(item.credential_expiry).severity === "expired";
  return false;
}

// Reminder severities (30/14/7 days out) all read warn, matching the Health page's
// phase tones; only a passed expiry escalates to error.
export const SEVERITY_TONE: Record<CredentialExpirySeverity, "ok" | "warn" | "error" | "unknown"> = {
  none: "ok",
  notice: "warn",
  warning: "warn",
  urgent: "warn",
  expired: "error",
  unknown: "unknown",
};

/** Renewal reminder block for a credential_maintenance item's detail view. */
export function CredentialExpiry({ expiry }: { expiry: unknown }) {
  const t = useT();
  const language = useLanguage();
  const data = readCredentialExpiry(expiry);
  const daysText = data.severity === "expired"
    ? t("decisions.credential_expiry.expired")
    : data.days_remaining === null
      ? t("decisions.credential_expiry.days_unknown")
      : t("decisions.credential_expiry.days", { count: data.days_remaining });
  const stamp = data.expires_at ? formatDateTime(data.expires_at, language, true) : null;
  const expiryText = !stamp
    ? t("decisions.credential_expiry.expiry_unknown")
    : t("decisions.credential_expiry.expires_at", { value: stamp.zone ? `${stamp.text} (${stamp.zone})` : stamp.text });
  return (
    <div className="credential-expiry" data-severity={data.severity}>
      <span className="credential-expiry-head">
        <Badge tone={SEVERITY_TONE[data.severity]}>{t(`decisions.credential_expiry.severity.${data.severity}`)}</Badge>
        <span className="credential-expiry-days">{daysText}</span>
      </span>
      <span className="credential-expiry-expires">{expiryText}</span>
      <p className="credential-expiry-notice">{t("decisions.credential_expiry.manual_notice")}</p>
    </div>
  );
}
