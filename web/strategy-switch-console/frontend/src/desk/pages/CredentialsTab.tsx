import type { Language } from "../../lib/prefs";
import type { DeskResult } from "../api/endpoints.ts";
import type { Credentials } from "../contract/types";
import { formatUtcHms } from "../format.ts";
import { credentialSummary } from "../credentials/table.ts";
import { CredentialLegend, CredentialSummaryChips, CredentialTable } from "../credentials/CredentialTable.tsx";
import type { DeskTranslate } from "../i18n/index.ts";
import { CredentialsReminder } from "../components/CredentialsReminderStrip.tsx";
import { FlexRotationCard } from "../components/FlexRotationCard.tsx";
import { EmptyState, LoadingState, RecoverableErrorState } from "../components/StateBlocks.tsx";
import type { Loadable } from "../components/useDeskLoad.ts";
import { useNarrow } from "../components/useNarrow.ts";
import { P } from "../components/deskStyles.ts";

export function CredentialsTab({ load, t, language, reload }: {
  load: Loadable<DeskResult<Credentials>>;
  t: DeskTranslate;
  language: Language;
  reload: () => void;
}) {
  if (load.state === "loading") return <LoadingState t={t} label={t("credentials.title")} startedAt={load.startedAt} onRetry={reload} />;
  if (load.state === "failed") return <RecoverableErrorState t={t} onRetry={reload} />;

  const result = load.result;
  const data = result.data;
  if (data.items.length === 0) return <EmptyState t={t} title={t("credentials.list.empty")} body={t("credentials.body")} />;

  return <CredentialsBody data={data} mock={result.source === "mock"} t={t} language={language} reload={reload} />;
}

/** Frames C1–C6, rendered from a single credentials read. */
export function CredentialsBody({ data, mock, t, language, reload }: {
  data: Credentials;
  mock: boolean;
  t: DeskTranslate;
  language: Language;
  reload: () => void;
}) {
  const narrow = useNarrow();
  const summary = credentialSummary(data.items);
  return (
    <div style={P.page} data-credentials-count={data.items.length}>
      <div className="mrd-card" style={P.hero}>
        <span className="mrd-label">{t("credentials.summary.meta", { brokers: summary.brokers, total: summary.total })}</span>
        <div style={P.rowBetween}>
          <h1 className="mrd-serif" style={P.title(narrow, language === "zh")}>
            {summary.due > 0 ? (
              <>
                {t("credentials.headline.pre", { total: summary.total })}
                <em>{t("credentials.headline.due", { due: summary.due })}</em>
                {t("credentials.headline.post")}
              </>
            ) : t("credentials.headline.clear", { total: summary.total })}
          </h1>
          <button type="button" className="mrd-chip" onClick={reload}>{t("credentials.reread")}</button>
        </div>
        <p style={P.lead}>{t("credentials.body")}</p>
      </div>

      <div className="mrd-split">
        <section className="mrd-card" style={P.column} aria-labelledby="mrd-credential-table">
          <div style={P.rowBetween}>
            <span className="mrd-label" id="mrd-credential-table">{t("credentials.table.title")}</span>
            <CredentialSummaryChips summary={summary} t={t} />
          </div>
          <CredentialTable items={data.items} generatedAt={data.generated_at} t={t} language={language} />
          <CredentialsReminder items={data.items} t={t} />
          <CredentialLegend t={t} />
          <p style={P.muted}>{t("credentials.foot", { time: formatUtcHms(data.generated_at) ?? "—" })}</p>
        </section>

        <FlexRotationCard t={t} language={language} items={data.items} generatedAt={data.generated_at} />
      </div>

      {mock ? <p style={P.muted}>{t("credentials.mock_note")}</p> : null}
    </div>
  );
}
