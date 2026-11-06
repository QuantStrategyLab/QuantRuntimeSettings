import type { Language } from "../../lib/prefs";
import type { CredentialSummary } from "../contract/types";
import { credentialExpiryView, phaseLabel } from "../credentials/model.ts";
import type { DeskTranslate } from "../i18n/index.ts";
import { P } from "./deskStyles.ts";

/** The credential-expiry row embedded in each Accounts broker card. */
export function CredentialExpiryRow({ credential, t, language, onManage }: {
  credential: CredentialSummary;
  t: DeskTranslate;
  language: Language;
  onManage?: () => void;
}) {
  const view = credentialExpiryView(credential.expiry, credential.phase, t, language);
  return (
    <div style={P.rowBetween} data-credential-row="true" data-credential-phase={view.phase} data-unknown={view.unknown ? "true" : "false"}>
      <div style={P.column}>
        <span className="mrd-label">{t("credential.expiry.label")}</span>
        <span style={{ fontSize: 13 }}>{view.mark}</span>
        <span style={P.muted}>{view.detail}</span>
      </div>
      <div style={P.row}>
        <span style={P.badge(view.tone)}>{phaseLabel(view.phase, t)}</span>
        {onManage ? (
          <button type="button" className="mrd-chip" onClick={onManage}>{t("credential.expiry.manage")}</button>
        ) : null}
      </div>
    </div>
  );
}
