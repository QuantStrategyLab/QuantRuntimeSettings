import { useState } from "react";
import { usePrefs, useScope } from "../../app/context";
import { useLanguage, useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { formatPercent } from "../../lib/format";
import { RangeSelector, RANGES } from "../../components/RangeSelector";
import { loadPerformanceSummary } from "../../api/endpoints";
import type { Range } from "../../api/contracts";
import { SummaryCards } from "./SummaryCards";
import { ReturnsCard } from "./ReturnsCard";
import { AssetsCard } from "./AssetsCard";
import { CalendarCard } from "./CalendarCard";
import { PerformanceTabs } from "./PerformanceTabs";
import { renderableStatus } from "./shared";
import "./performance.css";

export default function PerformancePage() {
  const t = useT();
  const language = useLanguage();
  const { prefs } = usePrefs();
  const { scope, options } = useScope();
  const platform = scope === "all" ? undefined : options.find(option => option.alias === scope)?.platform;
  const [range, setRange] = useState<Range>(prefs.defaultRange);
  const [epoch, setEpoch] = useState(0);
  const reloadAll = () => setEpoch(value => value + 1);

  // Per-range return figures under the range buttons; one fetch per scope, never fabricated.
  const rangeReturns = useApi(async () => {
    const results = await Promise.allSettled(RANGES.map(item => loadPerformanceSummary(scope, item, platform)));
    const map: Partial<Record<Range, string | null>> = {};
    results.forEach((result, index) => {
      const key = RANGES[index]!;
      map[key] =
        result.status === "fulfilled" && renderableStatus(result.value.status) && result.value.twr_return_percent !== null
          ? formatPercent(result.value.twr_return_percent, language)
          : null;
    });
    return map;
  }, [scope, platform, language, epoch]);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("nav.performance")}</h1>
        <RangeSelector value={range} onChange={setRange} returns={rangeReturns.phase === "ready" ? rangeReturns.data : undefined} />
        <span className="perf-spacer" />
        <button type="button" className="button button-secondary" onClick={reloadAll}>
          {t("common.refresh")}
        </button>
      </div>
      <SummaryCards scope={scope} platform={platform} range={range} epoch={epoch} />
      <ReturnsCard scope={scope} platform={platform} range={range} epoch={epoch} />
      <AssetsCard scope={scope} platform={platform} range={range} epoch={epoch} />
      <CalendarCard scope={scope} platform={platform} range={range} epoch={epoch} />
      <PerformanceTabs scope={scope} platform={platform} range={range} epoch={epoch} />
    </div>
  );
}
