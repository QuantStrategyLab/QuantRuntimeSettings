import { lazy, Suspense, useMemo } from "react";
import type { Language } from "../../lib/prefs";
import type { CredentialMaintenance } from "../../api/endpoints";
import type { CredentialRotationEnvelope } from "../../api/contracts";
import { I18nProvider } from "../../i18n";
import type { RotationRead } from "../../pages/health/CredentialRotationPanel";
import type { CredentialItem } from "../contract/types";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { flexPanelRead } from "../credentials/rotation.ts";
import { P } from "./deskStyles.ts";
import "../../pages/health/health.css";

const RotationPanel = lazy(() => import("../../pages/health/CredentialRotationPanel"));

/**
 * The Flex rotation entry, docked beside the credential table (frame C4). It embeds the
 * existing panel without rewriting it, and feeds it from the same credentials read as the
 * card above it: one source, so the expiry date and the reminder phase cannot disagree.
 */
export function FlexRotationCard({ t, language, items, generatedAt }: {
  t: DeskTranslate;
  language: Language;
  items: readonly CredentialItem[];
  generatedAt: string;
}) {
  const read = useMemo(() => flexPanelRead(items, generatedAt), [items, generatedAt]);
  const item = read.kind === "ready" || read.kind === "unreadable" ? read.item : null;
  const rotation = useMemo<RotationRead<CredentialRotationEnvelope> | null>(
    () => (read.kind === "ready" ? { phase: "ready", data: read.envelope, error: null, reload: () => {} } : null),
    [read],
  );
  const reminder = useMemo<RotationRead<CredentialMaintenance> | null>(
    () => (read.kind === "ready" ? { phase: "ready", data: read.maintenance, error: null, reload: () => {} } : null),
    [read],
  );
  const reason = read.kind === "unreadable" && read.item.expiry.status === "unknown"
    ? t(`read.reason.${read.item.expiry.reason}` as DeskKey)
    : null;

  return (
    <section className="mrd-card" style={P.column} aria-labelledby="mrd-flex-title">
      <span className="mrd-embed-label">{t("credentials.panel.embed")}</span>
      <div style={P.row}>
        <span className="mrd-label" id="mrd-flex-title">{t("credentials.flex.title")}</span>
        {item ? (
          <span className="mrd-chip" data-tone={read.kind === "ready" ? "ok" : "unknown"} data-flex-credential={item.id}>
            {t("credentials.panel.credential", { platform: item.platform, kind: t(`credential.kind.${item.kind}` as DeskKey) })}
          </span>
        ) : null}
      </div>
      {read.kind === "absent" ? <p style={P.muted} role="status">{t("credentials.panel.absent")}</p> : null}
      {read.kind === "unreadable" ? (
        <p style={P.muted} role="status">
          {t("credentials.panel.unreadable")}
          {reason ? ` · ${reason}` : ""}
        </p>
      ) : null}
      {rotation && reminder ? (
        <>
          <p style={P.muted}>{t("credentials.flex.note")}</p>
          <div className="mrd-rotation" data-write-only="true">
            <I18nProvider language={language}>
              <Suspense fallback={<p style={P.muted}>{t("credentials.flex.loading")}</p>}>
                <RotationPanel rotation={rotation} reminder={reminder} confirm={async () => false} onRotated={() => {}} />
              </Suspense>
            </I18nProvider>
          </div>
        </>
      ) : null}
    </section>
  );
}
