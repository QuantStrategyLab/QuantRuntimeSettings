import { useState } from "react";
import { usePrefs, useScope } from "../../app/context";
import { useLanguage, useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { formatPercent } from "../../lib/format";
import { RangeSelector } from "../../components/RangeSelector";
import { loadPerformanceReturns, loadPerformanceSummary } from "../../api/endpoints";
import type { Range } from "../../api/contracts";
import { SummaryCards } from "./SummaryCards";
import { ReturnsCard, accountDailyPoints } from "./ReturnsCard";
import { AssetsCard } from "./AssetsCard";
import { CalendarCard } from "./CalendarCard";
import { PerformanceTabs } from "./PerformanceTabs";
import { renderableStatus } from "./shared";
import { useScopeLabel } from "../../lib/useScopeLabel";
import "./performance.css";

export default function PerformancePage() {
  const t = useT();
  const language = useLanguage();
  const { prefs } = usePrefs();
  const { scope, options } = useScope();
  const scopeLabel = useScopeLabel(scope);
  const platform = scope === "all" ? undefined : options.find(option => `${option.platform}:${option.alias}` === scope)?.platform;
  const [range, setRange] = useState<Range>(prefs.defaultRange);
  const [epoch, setEpoch] = useState(0);
  const reloadAll = () => setEpoch(value => value + 1);

  // One summary read for the current range feeds both the cards and the range
  // buttons; other ranges are read only after selection, never in parallel and
  // never cached.
  const summary = useApi(() => loadPerformanceSummary(scope, range, platform), [scope, platform, range, epoch]);
  const returns = useApi(() => loadPerformanceReturns(scope, range, platform), [scope, platform, range, epoch]);
  const chartAvailable = scope === "all" && returns.phase === "ready" && (returns.data.per_account ?? []).some(account =>
    renderableStatus(account.status) && account.return_kind === "twr" && accountDailyPoints(account.points).length > 0);
  const currentReturn = summary.phase === "ready" && renderableStatus(summary.data.status) && summary.data.twr_return_percent !== null
    ? formatPercent(summary.data.twr_return_percent, language)
    : null;
  const rangeReturns: Partial<Record<Range, string | null>> | undefined =
    summary.phase === "ready" ? { [range]: currentReturn } : undefined;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("nav.performance")}</h1>
        <div className="page-header-actions">
          <RangeSelector value={range} onChange={setRange} returns={rangeReturns} />
          <button type="button" className="button button-secondary" onClick={reloadAll}>
            {t("common.refresh")}
          </button>
        </div>
      </div>
      <p className="page-subtitle">{scopeLabel} · {t(`perf.range.${range}`)}</p>
      <SummaryCards scope={scope} platform={platform} state={summary} chartAvailable={chartAvailable} />
      <ReturnsCard scope={scope} platform={platform} state={returns} />
      <div className="perf-duo-grid">
        <AssetsCard scope={scope} platform={platform} range={range} epoch={epoch} />
        <CalendarCard scope={scope} platform={platform} range={range} epoch={epoch} />
      </div>
      <PerformanceTabs scope={scope} platform={platform} range={range} epoch={epoch} />
    </div>
  );
}
