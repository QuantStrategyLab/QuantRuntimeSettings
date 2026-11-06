import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { Overview } from "../contract/types";
import type { DeskTranslate } from "../i18n/index.ts";
import { NeedsYouCard } from "../components/NeedsYouCard.tsx";
import { EmptyState, FreshnessChip, LoadingState, RecoverableErrorState, StalePartialBanner } from "../components/StateBlocks.tsx";
import { useDeskLoad } from "../components/useDeskLoad.ts";
import { useNarrow } from "../components/useNarrow.ts";
import { P } from "../components/deskStyles.ts";

export function OverviewPage({ api, t, language }: { api: DeskApi; t: DeskTranslate; language: Language }) {
  const overview = useDeskLoad<DeskResult<Overview>>(() => api.overview(), [api]);
  const narrow = useNarrow();

  if (overview.load.state === "loading") {
    return <LoadingState t={t} label={t("overview.title")} startedAt={overview.load.startedAt} onRetry={overview.reload} />;
  }
  if (overview.load.state === "failed") return <RecoverableErrorState t={t} onRetry={overview.reload} />;

  const data = overview.load.result.data;
  const stale = data.freshness.data_status !== "ready";
  return (
    <section style={P.page} aria-labelledby="mrd-page-title" data-page="overview">
      <div className="mrd-card" style={P.hero}>
        <span className="mrd-label">{t("overview.eyebrow")}</span>
        <h1 id="mrd-page-title" className="mrd-serif" style={P.title(narrow, language === "zh")}>{t("overview.title")}</h1>
        <p style={P.lead}>{t("overview.body")}</p>
        <FreshnessChip state={{ kind: "read", data_status: data.freshness.data_status, age_seconds: data.freshness.age_seconds }} t={t} language={language} />
      </div>

      {stale ? <StalePartialBanner t={t} language={language} ageSeconds={data.freshness.age_seconds} /> : null}
      {data.needs_you.length === 0 && stale ? (
        <section className="mrd-card" style={P.column} role="status">
          <span className="mrd-label">{t("overview.needs.title")}</span>
          <p style={P.muted}>{t("overview.needs.unknown")}</p>
        </section>
      ) : data.needs_you.length === 0 ? (
        <EmptyState t={t} title={t("overview.needs.empty")} />
      ) : (
        <NeedsYouCard items={data.needs_you} t={t} />
      )}

      {overview.load.result.source === "mock" ? <p style={P.muted}>{t("mock.title")}</p> : null}
    </section>
  );
}
