import type { Language } from "../../lib/prefs";
import type { GatewayState, Read } from "../contract/types";
import type { N1Ribbon } from "../contract/n1";
import { coverageText } from "../api/n1.ts";
import type { MockScenario } from "../api/mock.ts";
import { FreshnessChip } from "../components/StateBlocks.tsx";
import type { FreshnessChipState } from "../components/stateModel.ts";
import { formatAge, formatUtcDayLabel, formatUtcHm } from "../format.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import type { DeskPage } from "../router.ts";
import { Icon } from "./icons";
import { P } from "../components/deskStyles.ts";

/** Gateway chip state: a read, still loading, or a failed ribbon request. Unknown is never "down". */
export type GatewayChip = { kind: "read"; read: Read<GatewayState> } | { kind: "loading" } | { kind: "failed" };

/** The shared ribbon's `next_run` read; null while the ribbon is not ready. */
export type NextRunRead = N1Ribbon["next_run"];

/** Locked shell: the crumb and the single chip that replaces every data read. */
export interface ShellLock {
  crumb: DeskKey;
  chip: DeskKey;
}

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
  /** True when only some of the page's endpoints are fixtures. */
  mockPartial?: boolean;
  /** Optional global freshness chip; omitted in contexts that do not have a read. */
  freshness?: FreshnessChipState | null;
  /** Set for 401/403/failed access: no gateway, alert, freshness or clock data is shown. */
  lock?: ShellLock | null;
  /** N1: the global runtime mode read is unknown. */
  modeUnknown?: boolean;
  /** N1 ribbon `next_run`; omitted or null shows no chip. */
  nextRun?: NextRunRead | null;
  onLanguage: (language: Language) => void;
  onTheme: () => void;
}

function gatewayView(chip: GatewayChip): { key: DeskKey; tone: string; ageSeconds?: number } {
  if (chip.kind === "loading") return { key: "gateway.loading", tone: "muted" };
  if (chip.kind === "failed") return { key: "gateway.failed", tone: "unknown" };
  const read = chip.read;
  if (read.status === "unknown") return { key: "gateway.unknown", tone: "unknown" };
  if (read.status === "stale") return { key: "gateway.stale", tone: "unknown", ageSeconds: read.age_seconds };
  const tone = read.value === "all_reachable" ? "ok" : read.value === "degraded" ? "warn" : "risk";
  return { key: `gateway.${read.value}` as DeskKey, tone };
}

/**
 * A stored UTC instant as "HH:MM", with its UTC date label in front when that date is not
 * the viewer's current UTC day (`nowIso`), so a time across UTC midnight is never read as
 * today's. Null for a malformed instant.
 */
export function utcWhen(iso: string, nowIso: string, language: Language): string | null {
  const time = formatUtcHm(iso);
  if (time === null) return null;
  const day = iso.slice(0, 10) === nowIso.slice(0, 10) ? null : formatUtcDayLabel(iso, language);
  return day ? `${day} ${time}` : time;
}

/**
 * Next scheduled run chip. A partial read is only the earliest observed candidate and says
 * so; a stale read keeps its age; a time already past (the ribbon polls) or a null value
 * is unknown, never "no run". A run on another UTC day than the viewer's carries its date.
 */
export function nextRunView(read: NextRunRead, nowIso: string, t: DeskTranslate, language: Language): { text: string; tone: string; state: string } {
  const value = read.status === "unknown" ? null : read.value;
  if (!value || !(Date.parse(value.due_at) > Date.parse(nowIso))) return { text: t("next_run.unknown"), tone: "unknown", state: "unknown" };
  const params = { time: utcWhen(value.due_at, nowIso, language) ?? "--:--", target: value.target_id };
  if (read.status === "partial") return { text: t("next_run.partial", { ...params, coverage: coverageText(read.coverage) }), tone: "unknown", state: "partial" };
  if (read.status === "stale") return { text: t("next_run.stale", { ...params, age: formatAge(read.age_seconds, language) ?? "—" }), tone: "unknown", state: "stale" };
  return { text: t("next_run.known", params), tone: "muted", state: "known" };
}

export function TopBar({ page, t, language, theme, gateway, nowIso, serverClock, mock, mockPartial = false, freshness, lock, modeUnknown = false, nextRun = null, onLanguage, onTheme }: TopBarProps) {
  const chip = gatewayView(gateway);
  const next = nextRun ? nextRunView(nextRun, nowIso, t, language) : null;
  const time = formatUtcHm(nowIso) ?? "--:--";
  const day = formatUtcDayLabel(nowIso, language);
  return (
    <header className="mrd-top">
      <div className="mrd-crumb">
        <span className="mrd-crumb-brand">{t("shell.brand")}</span>
        <span className="mrd-crumb-sep" aria-hidden="true">/</span>
        <b>{lock ? t(lock.crumb) : t(`nav.${page}`)}</b>
      </div>
      <div className="mrd-tools">
        {lock ? (
          <span className="mrd-chip" style={P.lockChip} role="status" data-locked={lock.chip}>{t(lock.chip)}</span>
        ) : (
          <>
            {mock ? (
              <span className="mrd-chip mrd-chip-mock" title={t(mockPartial ? "mock.title_partial" : "mock.title")}>
                {mock !== "ok" ? t("mock.scenario", { scenario: mock })
                  : t(mockPartial ? "mock.badge_partial" : "mock.badge")}
              </span>
            ) : null}
            {freshness ? <FreshnessChip state={freshness} t={t} language={language} /> : null}
            {modeUnknown ? (
              <span className="mrd-chip" data-tone="unknown" data-mode="unknown" title={t("mode.unknown_title")}>
                {t("mode.unknown_chip")}
              </span>
            ) : null}
            {next ? (
              <span className="mrd-chip" data-tone={next.tone} data-next-run={next.state} title={t("next_run.title")}>{next.text}</span>
            ) : null}
            <span className="mrd-chip" data-tone={chip.tone} role="status">
              <i aria-hidden="true" />
              {t(chip.key, { age: formatAge(chip.ageSeconds, language) ?? "—" })}
            </span>
            <span className="mrd-chip mrd-clock">
              {day ? <span className="mrd-clock-day">{day} · </span> : null}
              {serverClock ? t("clock.utc", { time }) : t("clock.local", { time })}
            </span>
          </>
        )}
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
