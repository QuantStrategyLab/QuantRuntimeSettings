import type { Language } from "../../lib/prefs";
import type { GatewayState, Read } from "../contract/types";
import type { MockScenario } from "../api/mock.ts";
import { formatUtcDayLabel, formatUtcHm } from "../format.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import type { DeskPage } from "../router.ts";
import { Icon } from "./icons";

/** Gateway chip state: a read, still loading, or a failed ribbon request. Unknown is never "down". */
export type GatewayChip = { kind: "read"; read: Read<GatewayState> } | { kind: "loading" } | { kind: "failed" };

interface TopBarProps {
  page: DeskPage;
  t: DeskTranslate;
  language: Language;
  theme: "light" | "dark";
  gateway: GatewayChip;
  /** Server-adjusted now (ISO), or the browser clock when `serverClock` is false. */
  nowIso: string;
  serverClock: boolean;
  /** Non-null when any data on screen came from fixtures. */
  mock: MockScenario | null;
  onLanguage: (language: Language) => void;
  onTheme: () => void;
}

function gatewayView(chip: GatewayChip): { key: DeskKey; tone: string } {
  if (chip.kind === "loading") return { key: "gateway.loading", tone: "muted" };
  if (chip.kind === "failed") return { key: "gateway.failed", tone: "unknown" };
  const read = chip.read;
  if (read.status === "unknown") return { key: "gateway.unknown", tone: "unknown" };
  if (read.status === "stale") return { key: "gateway.stale", tone: "unknown" };
  const tone = read.value === "all_reachable" ? "ok" : read.value === "degraded" ? "warn" : "risk";
  return { key: `gateway.${read.value}` as DeskKey, tone };
}

export function TopBar({ page, t, language, theme, gateway, nowIso, serverClock, mock, onLanguage, onTheme }: TopBarProps) {
  const chip = gatewayView(gateway);
  const time = formatUtcHm(nowIso) ?? "--:--";
  const day = formatUtcDayLabel(nowIso, language);
  return (
    <header className="mrd-top">
      <div className="mrd-crumb">
        <span className="mrd-crumb-brand">{t("shell.brand")}</span>
        <span className="mrd-crumb-sep" aria-hidden="true">/</span>
        <b>{t(`nav.${page}`)}</b>
      </div>
      <div className="mrd-tools">
        {mock ? (
          <span className="mrd-chip mrd-chip-mock" title={t("mock.title")}>
            {mock === "ok" ? t("mock.badge") : t("mock.scenario", { scenario: mock })}
          </span>
        ) : null}
        <span className="mrd-chip" data-tone={chip.tone} role="status">
          <i aria-hidden="true" />
          {t(chip.key)}
        </span>
        <span className="mrd-chip mrd-clock">
          {day ? <span className="mrd-clock-day">{day} · </span> : null}
          {serverClock ? t("clock.utc", { time }) : t("clock.local", { time })}
        </span>
        <span className="mrd-seg" role="group" aria-label={t("lang.label")}>
          <button type="button" lang="zh-CN" aria-pressed={language === "zh"} onClick={() => onLanguage("zh")}>中</button>
          <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => onLanguage("en")}>EN</button>
        </span>
        <button type="button" className="mrd-chip mrd-icon-button" onClick={onTheme} aria-label={t(theme === "dark" ? "theme.to_light" : "theme.to_dark")} title={t(theme === "dark" ? "theme.to_light" : "theme.to_dark")}>
          <Icon name={theme === "dark" ? "moon" : "sun"} />
        </button>
      </div>
    </header>
  );
}
