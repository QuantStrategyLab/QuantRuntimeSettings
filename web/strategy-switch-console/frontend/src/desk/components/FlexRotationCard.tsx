import { lazy, Suspense, useMemo } from "react";
import type { Language } from "../../lib/prefs";
import type { CredentialMaintenance } from "../../api/endpoints";
import { CREDENTIAL_ROTATION_SCHEMA_VERSION } from "../../api/contracts";
import type { CredentialRotationEnvelope } from "../../api/contracts";
import { I18nProvider } from "../../i18n";
import type { RotationRead } from "../../pages/health/CredentialRotationPanel";
import type { DeskTranslate } from "../i18n/index.ts";
import { P } from "./deskStyles.ts";

const RotationPanel = lazy(() => import("../../pages/health/CredentialRotationPanel"));

/** Synthetic metadata only: no value, mask, version name or digest is present. */
const ROTATION: CredentialRotationEnvelope = {
  schema_version: CREDENTIAL_ROTATION_SCHEMA_VERSION,
  ok: true,
  server_time: "2026-11-02T14:32:07Z",
  metadata: {
    name: "ibkr_flex",
    last_rotated_at: "2026-08-09T17:30:00Z",
    expires_at: "2026-11-09T17:30:00Z",
  },
  operation: null,
  allowed_actions: [],
};

/** 14 is mapped to 30: the desk reminder enum has no 14 segment. */
const REMINDER: CredentialMaintenance = {
  id: "ibkr_flex",
  expires_at: "2026-11-09T17:30:00Z",
  phase: "30",
  requires_action: true,
  delivery: "not_reserved",
};

/**
 * Embeds the existing IBKR Flex rotation panel without rewriting it. The mock reads
 * expose no operation and no allowed action, so the panel renders metadata and the
 * write-only note only; it cannot submit anything from the desk preview.
 */
export function FlexRotationCard({ t, language }: { t: DeskTranslate; language: Language }) {
  const rotation = useMemo<RotationRead<CredentialRotationEnvelope>>(
    () => ({ phase: "ready", data: ROTATION, error: null, reload: () => {} }),
    [],
  );
  const reminder = useMemo<RotationRead<CredentialMaintenance>>(
    () => ({ phase: "ready", data: REMINDER, error: null, reload: () => {} }),
    [],
  );
  return (
    <section className="mrd-card" style={P.column} aria-labelledby="mrd-flex-title">
      <span className="mrd-label" id="mrd-flex-title">{t("credentials.flex.title")}</span>
      <p style={P.muted}>{t("credentials.flex.note")}</p>
      <div className="mrd-rotation" data-write-only="true">
        <I18nProvider language={language}>
          <Suspense fallback={<p style={P.muted}>{t("credentials.flex.loading")}</p>}>
            <RotationPanel rotation={rotation} reminder={reminder} confirm={async () => false} onRotated={() => {}} />
          </Suspense>
        </I18nProvider>
      </div>
    </section>
  );
}
