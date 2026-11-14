import type { ReactNode } from "react";
import type { Language } from "../../lib/prefs";
import type { MockScenario } from "../api/mock.ts";
import type { FreshnessChipState } from "../components/stateModel.ts";
import type { DeskTranslate } from "../i18n/index.ts";
import type { DeskPage } from "../router.ts";
import { AuthPage } from "../pages/AuthPage";
import { Dock } from "./Dock";
import { TopBar, type GatewayChip, type NextRunRead, type ShellLock } from "./TopBar";

export interface DeskShellProps {
  page: DeskPage;
  t: DeskTranslate;
  language: Language;
  theme: "light" | "dark";
  gateway: GatewayChip;
  alertCount: number | null;
  /** N1: the alert badge read is unknown; the dock shows "?" rather than a count. */
  alertUnknown?: boolean;
  /** N1: the global runtime mode is unknown; the bar says so instead of guessing. */
  modeUnknown?: boolean;
  /** N1 ribbon `next_run`; never shown behind the lock. */
  nextRun?: NextRunRead | null;
  nowIso: string;
  serverClock: boolean;
  mock: MockScenario | null;
  /** True when only some of the page's endpoints are fixtures. */
  mockPartial?: boolean;
  freshness?: FreshnessChipState | null;
  /** Non-null for 401/403/failed access: the shell shows no runtime data at all. */
  lock?: ShellLock | null;
  onNavigate: (page: DeskPage) => void;
  onLanguage: (language: Language) => void;
  onTheme: () => void;
  children: ReactNode;
}

/** Meridian frame: dock + top bar + page. Pure; state lives in DeskApp. */
export function DeskShell(props: DeskShellProps) {
  const { page, t, alertCount, alertUnknown = false, lock, nextRun = null, onNavigate, children, ...bar } = props;
  return (
    <div className="mrd" data-page={page} data-access={lock ? "locked" : "open"}>
      <Dock page={page} t={t} alertCount={lock ? null : alertCount} alertUnknown={!lock && alertUnknown} locked={Boolean(lock)} onNavigate={onNavigate} />
      <main className="mrd-main" id="mrd-main">
        <TopBar page={page} t={t} lock={lock} nextRun={lock ? null : nextRun} {...bar} />
        {children}
      </main>
    </div>
  );
}

/** Shown in the page area when the live session is not allowed or cannot be read. */
export function AccessCard({ t, kind, onRetry, onSignOut }: {
  t: DeskTranslate;
  kind: "login" | "denied" | "error";
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <AuthPage
      kind={kind === "login" ? "unauthorized" : kind === "denied" ? "forbidden" : "error"}
      t={t}
      onRetry={onRetry}
      onSignOut={onSignOut}
    />
  );
}
