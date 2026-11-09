import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invalidatePrivateSession, postJson } from "../api/client";
import { loadPreferences, resolveTheme, savePreferences, type Language, type ThemePreference } from "../lib/prefs";
import { createDeskApi, fixtureExposure, type DeskResult } from "./api/endpoints.ts";
import { MOCK_STORAGE_KEY, resolveMockScenario } from "./api/mock.ts";
import type { DeskSession, Ribbon } from "./contract/types";
import { clockOffsetMs, secondsBetween, serverNowIso } from "./format.ts";
import { deskTranslator, resolveDeskLanguage } from "./i18n/index.ts";
import { deskHash, hotkeyPage, isDeskHash, parseDeskHash, urlOverrides, type DeskPage } from "./router.ts";
import { classifySessionFailure, deskAccess, type SessionFailure } from "./shell/access.ts";
import { AccessCard, DeskShell } from "./shell/DeskShell";
import type { GatewayChip, ShellLock } from "./shell/TopBar";
import { freshnessFromAge } from "./components/stateModel.ts";
import type { FreshnessChipState } from "./components/stateModel.ts";
import { PageStub } from "./pages/PageStub";
import { AlertsPage } from "./pages/AlertsPage";
import { LogsPage } from "./pages/LogsPage";
import { PerformancePage } from "./pages/PerformancePage";
import { OverviewPage } from "./pages/OverviewPage";
import { AccountsPage } from "./pages/AccountsPage";
import { StrategiesPage } from "./pages/StrategiesPage";
import "./styles/desk.css";

type Loadable<T> = { state: "loading" } | { state: "ready"; result: T } | { state: "failed"; failure?: SessionFailure };

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
  const [route, setRoute] = useState(() => parseDeskHash(window.location.hash));
  const page = route.page;
  const params = route.params;
  const [session, setSession] = useState<Loadable<DeskResult<DeskSession>>>({ state: "loading" });
  const [ribbon, setRibbon] = useState<Loadable<DeskResult<Ribbon>>>({ state: "loading" });
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [clientNow, setClientNow] = useState(() => Date.now());
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const t = useMemo(() => deskTranslator(language), [language]);
  const access = deskAccess(session);
  // 401 / 403 / unreadable session: the frame keeps its shape but carries no data.
  const lock: ShellLock | null = access === "login" ? { crumb: "access.title", chip: "access.chip.login" }
    : access === "denied" ? { crumb: "access.denied_title", chip: "access.chip.denied" }
    : access === "error" ? { crumb: "access.error_title", chip: "access.chip.error" }
    : null;

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
      else setRoute(parseDeskHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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
      error => alive && setSession({ state: "failed", failure: classifySessionFailure(error) }),
    );
    return () => { alive = false; };
  }, [api, sessionEpoch]);

  useEffect(() => {
    // Number hotkeys switch pages, so they are inert exactly when the dock is.
    if (lock) return;
    const onKey = (event: KeyboardEvent) => {
      const next = hotkeyPage(event);
      if (next) window.location.hash = deskHash(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lock]);

  useEffect(() => {
    // Fail closed: without a confirmed session the runtime ribbon is not even read.
    if (access !== "open") return;
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
  }, [api, access]);

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
  // A page may mix live reads and fixtures. Derive the chip from every endpoint
  // that page renders, so a newly live endpoint cannot make fixtures look real.
  const exposure = fixtureExposure(page, scenario);
  const mock = exposure === "none" ? null : (scenario ?? "ok");
  const mockPartial = exposure === "partial";
  const serverClock = session.state === "ready" && offsetMs !== null;
  const nowIso = serverNowIso(serverClock ? offsetMs : null, clientNow);

  const retry = () => setSessionEpoch(value => value + 1);
  const signOut = useCallback(async () => {
    invalidatePrivateSession();
    try {
      await postJson("/api/logout", {});
    } catch {
      // Local state is already cleared; the redirect is what the owner can see.
    }
    window.location.assign("/login");
  }, []);
  const admin = session.state === "ready" && session.result.data.admin === true;
  const freshness: FreshnessChipState = ribbon.state === "loading" ? { kind: "loading" }
    : ribbon.state === "failed" ? { kind: "failed" }
    : freshnessFromAge(secondsBetween(ribbon.result.data.generated_at, nowIso));

  const pageContent = page === "performance" ? <PerformancePage api={api} t={t} language={language} />
    : page === "overview" ? <OverviewPage api={api} t={t} language={language} />
    : page === "accounts" ? <AccountsPage api={api} t={t} language={language} initialTab={params.get("tab") === "credentials" ? "credentials" : "brokers"} />
    : page === "alerts" ? <AlertsPage api={api} t={t} language={language} />
    : page === "logs" ? <LogsPage api={api} t={t} language={language} />
    : page === "switch" ? (
      <StrategiesPage
        api={api}
        t={t}
        language={language}
        admin={admin}
        initialTarget={params.get("target")}
        initialProfile={params.get("strategy") ?? params.get("profile")}
      />
    )
    : <PageStub page={page} t={t} />;

  const content = access === "open" ? pageContent
    : access === "loading" ? <section className="mrd-card mrd-access" aria-busy="true"><p>{t("access.loading")}</p></section>
    : <AccessCard t={t} kind={access} onRetry={retry} onSignOut={signOut} />;

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
      mockPartial={mockPartial}
      freshness={lock ? null : freshness}
      lock={lock}
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
