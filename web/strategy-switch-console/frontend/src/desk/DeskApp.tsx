import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadPreferences, resolveTheme, savePreferences, type Language, type ThemePreference } from "../lib/prefs";
import { createDeskApi, type DeskResult } from "./api/endpoints.ts";
import { MOCK_STORAGE_KEY, resolveMockScenario } from "./api/mock.ts";
import type { DeskSession, Ribbon } from "./contract/types";
import { clockOffsetMs, serverNowIso } from "./format.ts";
import { deskTranslator, resolveDeskLanguage } from "./i18n/index.ts";
import { deskHash, hotkeyPage, isDeskHash, parseDeskHash, urlOverrides, type DeskPage } from "./router.ts";
import { deskAccess } from "./shell/access.ts";
import { AccessCard, DeskShell } from "./shell/DeskShell";
import type { GatewayChip } from "./shell/TopBar";
import { PageStub } from "./pages/PageStub";
import { PerformancePage } from "./pages/PerformancePage";
import "./styles/desk.css";

type Loadable<T> = { state: "loading" } | { state: "ready"; result: T } | { state: "failed" };

const LANGUAGE_KEY = "qsl-switch-lang";
const RIBBON_POLL_MS = 60_000;
const CLOCK_TICK_MS = 15_000;

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function browserLanguages(): readonly string[] {
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export default function DeskApp() {
  const overrides = useMemo(() => urlOverrides(window.location.search), []);
  const scenario = useMemo(() => resolveMockScenario(window.location.search, stored(MOCK_STORAGE_KEY)), []);
  const api = useMemo(() => createDeskApi({ forcedScenario: scenario }), [scenario]);

  const [language, setLanguageState] = useState<Language>(() => overrides.language ?? resolveDeskLanguage(stored(LANGUAGE_KEY), browserLanguages()));
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => overrides.theme ?? loadPreferences().theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const theme = resolveTheme(themePreference, systemDark);
  const [page, setPage] = useState<DeskPage>(() => parseDeskHash(window.location.hash).page);
  const [session, setSession] = useState<Loadable<DeskResult<DeskSession>>>({ state: "loading" });
  const [ribbon, setRibbon] = useState<Loadable<DeskResult<Ribbon>>>({ state: "loading" });
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [clientNow, setClientNow] = useState(() => Date.now());
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const t = useMemo(() => deskTranslator(language), [language]);

  useEffect(() => {
    const html = document.documentElement;
    html.dataset.theme = theme;
    html.lang = language === "zh" ? "zh-CN" : "en";
    document.title = `${t(`nav.${page}`)} · ${t("shell.brand")}`;
  }, [theme, language, page, t]);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const onHash = () => {
      // Leaving #/desk returns to the existing console, which boots from main.tsx.
      if (!isDeskHash(window.location.hash)) window.location.reload();
      else setPage(parseDeskHash(window.location.hash).page);
    };
    const onKey = (event: KeyboardEvent) => {
      const next = hotkeyPage(event);
      if (next) window.location.hash = deskHash(next);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setSession({ state: "loading" });
    api.session().then(
      result => {
        if (!alive) return;
        setSession({ state: "ready", result });
        setOffsetMs(clockOffsetMs(result.data.server_time, Date.now()));
      },
      () => alive && setSession({ state: "failed" }),
    );
    return () => { alive = false; };
  }, [api, sessionEpoch]);

  useEffect(() => {
    let alive = true;
    const load = () => api.ribbon().then(
      result => alive && setRibbon({ state: "ready", result }),
      // Fail closed: a failed refresh drops the last good ribbon, so an old "reachable" never stays on screen.
      () => alive && setRibbon({ state: "failed" }),
    );
    load();
    const poll = window.setInterval(load, RIBBON_POLL_MS);
    const tick = window.setInterval(() => setClientNow(Date.now()), CLOCK_TICK_MS);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [api]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    if (!overrides.language) savePreferences({ ...loadPreferences(), language: next });
  }, [overrides.language]);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setThemePreference(next);
    if (!overrides.theme) savePreferences({ ...loadPreferences(), theme: next });
  }, [theme, overrides.theme]);

  const navigate = useCallback((next: DeskPage) => {
    window.location.hash = deskHash(next);
  }, []);

  const gateway: GatewayChip = ribbon.state === "ready" ? { kind: "read", read: ribbon.result.data.console_state.gateways } : { kind: ribbon.state };
  const alertCount = ribbon.state === "ready" ? ribbon.result.data.alert_badge.open_count : null;
  const mockSources = [session, ribbon].filter(item => item.state === "ready" && item.result.source === "mock");
  const mock = mockSources.length ? scenario ?? "ok" : null;
  const serverClock = session.state === "ready" && offsetMs !== null;
  const nowIso = serverNowIso(serverClock ? offsetMs : null, clientNow);

  const access = deskAccess(session);
  const retry = () => setSessionEpoch(value => value + 1);
  const content = access === "open" ? (page === "performance" ? <PerformancePage api={api} t={t} language={language} /> : <PageStub page={page} t={t} />)
    : access === "loading" ? <section className="mrd-card mrd-access" aria-busy="true"><p>{t("access.loading")}</p></section>
    : <AccessCard t={t} kind={access} onRetry={retry} />;

  return (
    <DeskShell
      page={page}
      t={t}
      language={language}
      theme={theme}
      gateway={gateway}
      alertCount={alertCount}
      nowIso={nowIso}
      serverClock={serverClock}
      mock={mock}
      onNavigate={navigate}
      onLanguage={setLanguage}
      onTheme={toggleTheme}
    >
      {content}
    </DeskShell>
  );
}

export function mountDesk(root: HTMLElement): void {
  createRoot(root).render(<DeskApp />);
}
