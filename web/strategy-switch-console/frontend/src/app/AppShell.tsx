import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, usePrefs, useScope } from "../app/context";
import { UpdateNotice } from "./UpdateNotice";
import { useLanguage, useT } from "../i18n";
import { formatDateTime } from "../lib/format";
import { ScopeSwitcher } from "../components/ScopeSwitcher";
import { PreferencesPanel } from "./PreferencesPanel";
import type { PageId } from "./router";

const NAV_ITEMS: { id: PageId; labelKey: string; icon: string }[] = [
  { id: "overview", labelKey: "nav.overview", icon: "M3 12 L12 4 L21 12 M6 10 V20 H18 V10" },
  { id: "performance", labelKey: "nav.performance", icon: "M4 18 L10 10 L14 13 L20 5" },
  { id: "decisions", labelKey: "nav.decisions", icon: "M4 6 H20 M4 12 H20 M4 18 H14" },
  { id: "accounts", labelKey: "nav.accounts", icon: "M12 12 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M4 20 c0-4 4-6 8-6 s8 2 8 6" },
  { id: "strategies", labelKey: "nav.strategies", icon: "M5 5 H19 V19 H5 Z M5 10 H19 M10 10 V19" },
  { id: "health", labelKey: "nav.health", icon: "M3 12 H7 L10 5 L14 19 L17 12 H21" },
];

const MOBILE_PRIMARY: PageId[] = ["overview", "performance", "decisions", "accounts"];
const MOBILE_MORE: PageId[] = ["strategies", "health"];

function NavIcon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function AppShell({
  page,
  todoCount,
  synthetic,
  login,
  updatedAt,
  onLogout,
  children,
}: {
  page: PageId;
  todoCount: number | null;
  synthetic: boolean;
  login: string | null;
  updatedAt: string | null;
  onLogout: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const language = useLanguage();
  const navigate = useNavigate();
  const { prefs, setPrefs, resolvedTheme } = usePrefs();
  const dark = resolvedTheme === "dark";
  useScope();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const userMenuRef = useRef<HTMLDetailsElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreWasOpen = useRef(false);

  useEffect(() => {
    if (userMenuRef.current) userMenuRef.current.open = false;
    setMoreOpen(false);
  }, [page]);

  // Closing the "more" sheet returns focus to the control that opened it.
  useEffect(() => {
    if (moreWasOpen.current && !moreOpen) moreButtonRef.current?.focus();
    moreWasOpen.current = moreOpen;
  }, [moreOpen]);

  useEffect(() => {
    const closeIfOutside = (event: PointerEvent) => {
      const menu = userMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (userMenuRef.current) userMenuRef.current.open = false;
      setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const badge = todoCount !== null && todoCount > 0 ? <span className="nav-badge">{todoCount}</span> : null;
  const updated = updatedAt ? formatDateTime(updatedAt, language) : null;

  const navButton = (item: (typeof NAV_ITEMS)[number], extraClass = "") => (
    <button
      key={item.id}
      type="button"
      className={`${extraClass}${page === item.id ? " active" : ""}`}
      aria-label={t(item.labelKey)}
      aria-current={page === item.id ? "page" : undefined}
      onClick={() => navigate({ page: item.id, account: null, tab: null })}
    >
      <NavIcon path={item.icon} />
      <span className="nav-text">{t(item.labelKey)}</span>
      {item.id === "decisions" && badge}
    </button>
  );

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">{t("shell.skip_to_content")}</a>
      <nav className={`sidenav${collapsed ? " collapsed" : ""}`} aria-label={t("nav.main")}>
        <div className="brand">
          <img src="/v2/assets/qsl-brand-icon.svg" alt="" width={28} height={28} />
          <span className="brand-name">{t("app.name")}</span>
        </div>
        {NAV_ITEMS.map(item => navButton(item, "nav-item"))}
        <button type="button" className="sidenav-collapse" onClick={() => setCollapsed(value => !value)} aria-label={t(collapsed ? "common.expand" : "common.collapse")}>
          {collapsed ? "»" : "«"}
        </button>
      </nav>
      <div className="shell-main">
        <header className="topbar">
          {page !== "health" && <ScopeSwitcher />}
          {updated && <span className="topbar-updated">{t("common.updated_at", { value: `${updated.text}${updated.zone ? ` (${updated.zone})` : ""}` })}</span>}
          <span className="spacer" />
          <button type="button" className="button button-secondary button-sm appearance-toggle lang-toggle" aria-label={t("prefs.language")} title={t("prefs.language")} onClick={() => setPrefs({ ...prefs, language: language === "zh" ? "en" : "zh" })}>
            {/* Narrow screens keep the control short; the full word stays for wide layouts. */}
            <span className="lang-label lang-label-full">{language === "zh" ? "English" : "中文"}</span>
            <span className="lang-label lang-label-short" aria-hidden="true">{language === "zh" ? "EN" : "中"}</span>
          </button>
          <button type="button" className="button button-secondary button-sm appearance-toggle" aria-label={t(dark ? "shell.switch_light" : "shell.switch_dark")} title={t(dark ? "shell.switch_light" : "shell.switch_dark")} onClick={() => setPrefs({ ...prefs, theme: dark ? "light" : "dark" })}>
            <span aria-hidden="true">{dark ? "☀" : "☾"}</span><span className="theme-toggle-label">{t(dark ? "prefs.theme_light" : "prefs.theme_dark")}</span>
          </button>
          {synthetic && <span className="badge badge-accent">{t("common.synthetic_badge")}</span>}
          <button
            type="button"
            className="icon-button"
            aria-pressed={prefs.hideAmounts}
            aria-label={t(prefs.hideAmounts ? "shell.show_amounts" : "shell.hide_amounts")}
            title={t(prefs.hideAmounts ? "shell.show_amounts" : "shell.hide_amounts")}
            onClick={() => setPrefs({ ...prefs, hideAmounts: !prefs.hideAmounts })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {prefs.hideAmounts ? (
                <path d="M3 3 L21 21 M10 5.5 C11.5 5 13 5 14 5.5 C18 7 21 12 21 12 C20 14 18.5 15.8 16.5 17 M6.5 6.8 C4 8.7 3 12 3 12 C3 12 6 18 12 18 C13 18 14 17.8 14.8 17.5" />
              ) : (
                <><path d="M2 12 C2 12 5.5 5 12 5 C18.5 5 22 12 22 12 C22 12 18.5 19 12 19 C5.5 19 2 12 2 12 Z" /><circle cx="12" cy="12" r="3" /></>
              )}
            </svg>
          </button>
          <details className="user-menu" ref={userMenuRef}>
            <summary aria-label={t("shell.user_menu")}>{(login || "U").slice(0, 1).toUpperCase()}</summary>
            <div className="user-menu-panel">
              <strong className="user-menu-name">{login || "—"}</strong>
              <button type="button" className="menu-item" onClick={() => { setPrefsOpen(true); if (userMenuRef.current) userMenuRef.current.open = false; }}>
                {t("shell.preferences")}
              </button>
              <button type="button" className="menu-item" onClick={onLogout}>{t("shell.logout")}</button>
            </div>
          </details>
        </header>
        <UpdateNotice />
        <main className="content" id="main-content" key={page}>{children}</main>
      </div>
      <nav className="bottom-tabs" aria-label={t("nav.main")}>
        <div className="bottom-tabs-inner">
          {MOBILE_PRIMARY.map(id => navButton(NAV_ITEMS.find(item => item.id === id)!, "bottom-tab"))}
          <button type="button" ref={moreButtonRef} className={`bottom-tab${moreOpen || MOBILE_MORE.includes(page) ? " active" : ""}`} aria-expanded={moreOpen} aria-controls="more-sheet" onClick={() => setMoreOpen(value => !value)}>
            <NavIcon path="M5 12 m-1.5 0 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 M12 12 m-1.5 0 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 M19 12 m-1.5 0 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0" />
            <span className="nav-text">{t("nav.more")}</span>
          </button>
        </div>
      </nav>
      {moreOpen && (
        <div className="more-sheet" id="more-sheet" role="menu">
          {MOBILE_MORE.map(id => navButton(NAV_ITEMS.find(item => item.id === id)!, "nav-item"))}
          <button type="button" className="nav-item" onClick={() => { setPrefsOpen(true); setMoreOpen(false); }}>
            <NavIcon path="M12 15 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M19 12 a7 7 0 0 0-.1-1.2 l2-1.5 -2-3.4 -2.3 1 a7 7 0 0 0-2-1.2 L14.2 3 H9.8 L9.4 5.7 a7 7 0 0 0-2 1.2 l-2.3-1 -2 3.4 2 1.5 A7 7 0 0 0 5 12" />
            <span className="nav-text">{t("shell.preferences")}</span>
          </button>
        </div>
      )}
      {prefsOpen && <PreferencesPanel onClose={() => setPrefsOpen(false)} />}
    </div>
  );
}
