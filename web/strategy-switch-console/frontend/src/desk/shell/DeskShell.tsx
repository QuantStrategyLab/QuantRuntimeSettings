import type { ReactNode } from "react";
import type { Language } from "../../lib/prefs";
import type { MockScenario } from "../api/mock.ts";
import type { DeskTranslate } from "../i18n/index.ts";
import type { DeskPage } from "../router.ts";
import { Dock } from "./Dock";
import { TopBar, type GatewayChip } from "./TopBar";

export interface DeskShellProps {
  page: DeskPage;
  t: DeskTranslate;
  language: Language;
  theme: "light" | "dark";
  gateway: GatewayChip;
  alertCount: number | null;
  nowIso: string;
  serverClock: boolean;
  mock: MockScenario | null;
  onNavigate: (page: DeskPage) => void;
  onLanguage: (language: Language) => void;
  onTheme: () => void;
  children: ReactNode;
}

/** Meridian frame: dock + top bar + page. Pure; state lives in DeskApp. */
export function DeskShell(props: DeskShellProps) {
  const { page, t, alertCount, onNavigate, children, ...bar } = props;
  return (
    <div className="mrd" data-page={page}>
      <Dock page={page} t={t} alertCount={alertCount} onNavigate={onNavigate} />
      <main className="mrd-main" id="mrd-main">
        <TopBar page={page} t={t} {...bar} />
        {children}
      </main>
    </div>
  );
}

/** Shown in the page area when the live session is not allowed or cannot be read. */
export function AccessCard({ t, kind, onRetry }: { t: DeskTranslate; kind: "login" | "denied" | "error"; onRetry: () => void }) {
  return (
    <section className="mrd-card mrd-access" role="alert">
      <h1 className="mrd-serif">{t("access.title")}</h1>
      <p>{t(kind === "login" ? "access.body" : kind === "denied" ? "access.denied" : "access.error")}</p>
      {kind === "login" ? <a className="mrd-button" href="/login">{t("access.login")}</a> : null}
      {kind === "error" ? <button type="button" className="mrd-button" onClick={onRetry}>{t("access.retry")}</button> : null}
    </section>
  );
}
