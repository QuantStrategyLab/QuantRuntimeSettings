import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { I18nProvider, translate, useT } from "../i18n";
import { AccountDirectoryContext, NavigateContext, PrefsContext, ScopeContext, type ScopeOption } from "./context";
import { loadPreferences, resolveTheme, savePreferences, type Preferences } from "../lib/prefs";
import { getNavigationGuard, parseRoute, pushRoute, type Route } from "./router";
import { AccessError, getJson, invalidatePrivateSession, postJson } from "../api/client";
import { loadAccounts, loadInbox, loadSession, type Session } from "../api/endpoints";
import type { DirectoryConfig } from "../lib/accountDirectory";
import { AppShell } from "./AppShell";
import { ToastProvider } from "../components/Toast";
import { Skeleton } from "../components/primitives";
import { PageLoadBoundary } from "../components/PageLoadBoundary";

const OverviewPage = lazy(() => import("../pages/overview/OverviewPage"));
const PerformancePage = lazy(() => import("../pages/performance/PerformancePage"));
const DecisionsPage = lazy(() => import("../pages/decisions/DecisionsPage"));
const AccountsPage = lazy(() => import("../pages/accounts/AccountsPage"));
const StrategiesPage = lazy(() => import("../pages/strategies/StrategiesPage"));
const HealthPage = lazy(() => import("../pages/health/HealthPage"));

type Boot = "loading" | "ready" | "denied" | "error";

function AccessScreen({ kind, noAccess, onRetry }: { kind: "denied" | "error"; noAccess?: boolean; onRetry?: () => void }) {
  const t = useT();
  const denied = kind === "denied";
  return (
    <main className="access-screen">
      <img src="/v2/assets/qsl-brand-icon.svg" alt="" width={48} height={48} />
      <h1>{t(denied ? (noAccess ? "auth.denied_title" : "auth.login_title") : "auth.error_title")}</h1>
      <p>{t(denied ? (noAccess ? "auth.denied_body" : "auth.login_body") : "auth.error_body")}</p>
      {denied ? (
        noAccess ? null : (
          <a className="button button-primary" href="/login">{t("auth.login")}</a>
        )
      ) : (
        <button className="button button-primary" type="button" onClick={onRetry}>{t("common.retry")}</button>
      )}
    </main>
  );
}

export default function App() {
  const [prefs, setPrefsState] = useState<Preferences>(loadPreferences);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [boot, setBoot] = useState<Boot>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.search));
  const [directory, setDirectory] = useState<DirectoryConfig | null>(null);
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
  const [scopeStatus, setScopeStatus] = useState<"loading" | "ready" | "error">("loading");
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const [metaStatus, setMetaStatus] = useState<"ready" | "error">("ready");
  const [persistFailed, setPersistFailed] = useState(false);
  const [todoCount, setTodoCount] = useState<number | null>(null);
  const [todoStatus, setTodoStatus] = useState<"loading" | "ok" | "read_failed">("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [bootEpoch, setBootEpoch] = useState(0);
  const routeRef = useRef(route);
  routeRef.current = route;

  const setPrefs = useCallback((next: Preferences) => {
    setPrefsState(next);
    setPersistFailed(!savePreferences(next));
  }, []);
  const retryScope = useCallback(() => setScopeEpoch(value => value + 1), []);

  const resolvedTheme = resolveTheme(prefs.theme, systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);
  useEffect(() => {
    document.documentElement.dataset.updown = prefs.upDown;
  }, [prefs.upDown]);
  useEffect(() => {
    document.documentElement.lang = prefs.language === "zh" ? "zh-CN" : "en";
  }, [prefs.language]);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // Boot: session, then the todo badge. Auxiliary read failures never block the shell.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await loadSession();
        if (cancelled) return;
        if (!next.authenticated || !next.allowed) {
          setSession(next);
          setBoot("denied");
          return;
        }
        setSession(next);
        setBoot("ready");
        setTodoStatus("loading");
        try {
          const inbox = await loadInbox();
          if (cancelled) return;
          const unreadable = inbox.status === "read_failed";
          setTodoStatus(unreadable ? "read_failed" : "ok");
          setTodoCount(unreadable ? null : inbox.items.filter(item => item.status === "pending").length);
        } catch {
          if (cancelled) return;
          setTodoStatus("read_failed");
          setTodoCount(null);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof AccessError && error.status === 401) setBoot("denied");
        else setBoot(current => (current === "ready" ? current : "error"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootEpoch]);

  // Scope options load on their own so a failure can be retried without re-reading the session or inbox.
  useEffect(() => {
    if (boot !== "ready") return;
    let cancelled = false;
    setScopeStatus("loading");
    (async () => {
      try {
        const accounts = await loadAccounts();
        if (cancelled) return;
        let config: DirectoryConfig | null = null;
        try {
          config = await getJson<DirectoryConfig>("/api/config");
        } catch { /* The list stays usable; only the metadata below is unknown. */ }
        if (cancelled) return;
        setDirectory(config);
        setMetaStatus(config ? "ready" : "error");
        setScopeOptions(accounts.accounts.map(account => ({
          alias: account.account_alias,
          platform: account.platform,
          // Without the directory, an account has no declared environment: neither
          // "paper" nor "live" is known, so no paper badge and no live totals.
          paper: config
            ? config.accountOptions?.[account.platform]?.find(option => option.key === account.account_alias)?.broker_environment === "paper"
            : null,
        })));
        setUpdatedAt(new Date().toISOString());
        setScopeStatus("ready");
      } catch {
        if (!cancelled) setScopeStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boot, scopeEpoch]);

  useEffect(() => {
    const onInvalid = () => {
      setSession(null);
      setBoot("denied");
    };
    window.addEventListener("qsl-private-session-invalid", onInvalid);
    return () => window.removeEventListener("qsl-private-session-invalid", onInvalid);
  }, []);

  // Navigation with unsaved-changes guard.
  const navigate = useCallback(
    (patch: Partial<Route>) => {
      const next: Route = { ...routeRef.current, ...patch };
      const commit = () => {
        setRoute(next);
        pushRoute(next);
      };
      const guard = getNavigationGuard();
      if (guard && (next.page !== routeRef.current.page || next.account !== routeRef.current.account)) {
        void guard().then(allowed => {
          if (allowed) commit();
        });
        return;
      }
      commit();
    },
    [],
  );

  useEffect(() => {
    const onPop = () => {
      const next = parseRoute(window.location.search);
      const guard = getNavigationGuard();
      if (guard) {
        void guard().then(allowed => {
          if (allowed) setRoute(next);
          else pushRoute(routeRef.current);
        });
        return;
      }
      setRoute(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const logout = async () => {
    invalidatePrivateSession();
    try {
      await postJson("/api/logout", {});
    } catch {
      // Local state is already cleared.
    }
    window.location.assign("/login");
  };

  useEffect(() => {
    document.title = `${translate(prefs.language, `nav.${route.page}`)} · QuantStrategyLab`;
  }, [prefs.language, route.page]);

  if (boot === "loading") {
    return (
      <I18nProvider language={prefs.language}>
        <main className="boot-screen" role="status" aria-live="polite">
          <Skeleton height={24} width={200} />
        </main>
      </I18nProvider>
    );
  }
  if (boot === "denied") {
    return (
      <I18nProvider language={prefs.language}>
        <AccessScreen kind="denied" noAccess={session?.authenticated === true && !session.allowed} />
      </I18nProvider>
    );
  }
  if (boot === "error") {
    return (
      <I18nProvider language={prefs.language}>
        <AccessScreen kind="error" onRetry={() => setBootEpoch(value => value + 1)} />
      </I18nProvider>
    );
  }

  const scopeValue = {
    scope: route.scope,
    options: scopeOptions,
    setScope: (scope: string) => navigate({ scope }),
    status: scopeStatus,
    metaStatus,
    retry: retryScope,
  };

  return (
    <I18nProvider language={prefs.language}>
      <PrefsContext.Provider value={{ prefs, setPrefs, resolvedTheme, persistFailed }}>
        <AccountDirectoryContext.Provider value={directory}>
        <ScopeContext.Provider value={scopeValue}>
          <NavigateContext.Provider value={navigate}>
            <ToastProvider>
              <AppShell
                page={route.page}
                todoCount={todoCount}
                todoStatus={todoStatus}
                synthetic={session?.synthetic === true}
                login={session?.login || null}
                updatedAt={updatedAt}
                onLogout={() => void logout()}
              >
                <PageLoadBoundary key={route.page}>
                  <Suspense fallback={<Skeleton height={240} />}>
                    {route.page === "overview" && <OverviewPage />}
                    {route.page === "performance" && <PerformancePage />}
                    {route.page === "decisions" && <DecisionsPage />}
                    {route.page === "accounts" && <AccountsPage account={route.account} tab={route.tab} />}
                    {route.page === "strategies" && <StrategiesPage />}
                    {route.page === "health" && <HealthPage />}
                  </Suspense>
                </PageLoadBoundary>
              </AppShell>
            </ToastProvider>
          </NavigateContext.Provider>
        </ScopeContext.Provider>
        </AccountDirectoryContext.Provider>
      </PrefsContext.Provider>
    </I18nProvider>
  );
}
