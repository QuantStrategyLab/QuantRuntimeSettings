import type { CredentialExpiryReminder, CredentialExpirySeverity } from "../../api/contracts";
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
    ? raw.severity as CredentialExpirySeverity : "unknown";
  const days = raw.days_remaining === undefined || raw.days_remaining === null || !Number.isSafeInteger(raw.days_remaining) || raw.days_remaining < 0
    ? null : raw.days_remaining;
  const expires = typeof raw.expires_at === "string" && Number.isFinite(Date.parse(raw.expires_at)) ? raw.expires_at : null;
  return { expires_at: expires, days_remaining: days, severity };
}

const SEVERITY_TONE: Record<CredentialExpirySeverity, "ok" | "accent" | "warn" | "error" | "unknown"> = {
  none: "ok",
  notice: "accent",
  warning: "warn",
  urgent: "error",
  expired: "error",
  unknown: "unknown",
};

export function CredentialExpiry({ expiry, variant }: { expiry: unknown; variant: "list" | "detail" }) {
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
  const badge = (
    <>
      <Badge tone={SEVERITY_TONE[data.severity]}>{t(`decisions.credential_expiry.severity.${data.severity}`)}</Badge>
      <span className="credential-expiry-days">{daysText}</span>
    </>
  );
  // The list row nests inside a span, so it stays inline; only the detail block
  // may be a div with the paragraph of guidance.
  if (variant === "list") {
    return <span className="credential-expiry" data-severity={data.severity} data-variant="list">{badge}</span>;
  }
  return (
    <div className="credential-expiry" data-severity={data.severity} data-variant="detail">
      <span className="credential-expiry-head">{badge}</span>
      <span className="credential-expiry-expires">{expiryText}</span>
      <p className="credential-expiry-notice">{t("decisions.credential_expiry.manual_notice")}</p>
    </div>
  );
}
