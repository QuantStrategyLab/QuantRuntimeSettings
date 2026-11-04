import type { CSSProperties } from "react";
import type { DeskTranslate } from "../i18n/index.ts";

export type AuthKind = "unauthorized" | "forbidden" | "error";

const page: CSSProperties = { maxWidth: 560, padding: "30px 32px", display: "flex", flexDirection: "column", gap: 12 };
const note: CSSProperties = { margin: 0, color: "var(--mrd-ink-3)", fontSize: 12.5 };

/**
 * Full-page 401 / 403 / read-failure. The 403 copy talks about the current sign-in,
 * never a broker account: the two are different concepts on the desk.
 */
export function AuthPage({ kind, t, onRetry, onSignOut }: {
  kind: AuthKind;
  t: DeskTranslate;
  onRetry?: () => void;
  onSignOut?: () => void;
}) {
  const title = kind === "unauthorized" ? t("access.title") : kind === "forbidden" ? t("access.denied_title") : t("access.error_title");
  const body = kind === "unauthorized" ? t("access.body") : kind === "forbidden" ? t("access.denied") : t("access.error");
  const bullets = (kind === "unauthorized" ? t("access.login.list") : kind === "forbidden" ? t("access.forbidden.list") : "").split("|").filter(Boolean);
  return (
    <section className="mrd-card mrd-access" style={page} role="alert" data-auth={kind}>
      <span className="mrd-label">{t("access.eyebrow")}</span>
      <h1 className="mrd-serif" style={{ margin: 0, fontSize: 34, lineHeight: 1.15 }}>{title}</h1>
      <p style={{ margin: 0, color: "var(--mrd-ink-2)" }}>{body}</p>
      {bullets.length ? (
        <ul style={{ ...note, display: "flex", flexDirection: "column", gap: 4, paddingLeft: 18, listStyle: "disc" }}>
          {bullets.map(bullet => <li key={bullet}>{bullet}</li>)}
        </ul>
      ) : null}
      {kind === "unauthorized" ? <a className="mrd-button" href="/login">{t("access.login")}</a> : null}
      {kind === "forbidden" && onSignOut ? (
        <button type="button" className="mrd-button" onClick={onSignOut} data-action="sign-out">{t("access.signout")}</button>
      ) : null}
      {kind === "error" && onRetry ? (
        <button type="button" className="mrd-button" onClick={onRetry}>{t("access.retry")}</button>
      ) : null}
    </section>
  );
}

/** Action-level 403 inside a page; it never replaces the page content. */
export function InlineForbidden({ t, reason }: { t: DeskTranslate; reason?: string | null }) {
  return (
    <div role="alert" data-inline-forbidden="true" style={{ ...note, display: "flex", flexDirection: "column", gap: 3, padding: "9px 11px", borderRadius: 12, border: "1px solid var(--mrd-line)", background: "var(--mrd-panel)" }}>
      <b style={{ color: "var(--mrd-coral)", fontSize: 12.5 }}>{t("access.action_denied_title")}</b>
      <span>{t("access.action_denied")}</span>
      {reason ? <span>{t("access.action_denied_reason", { reason })}</span> : null}
    </div>
  );
}
