import { accountKey, findAccount } from "../lib/accountDirectory";
import { useDisplayNames } from "../lib/useDisplayNames";
import { useEffect, useRef, useState } from "react";
import { useScope } from "../app/context";
import { useT } from "../i18n";

/** Topbar account-scope selector; grouped by platform, paper accounts in their own group. */
export function ScopeSwitcher() {
  const t = useT();
  const names = useDisplayNames();
  const { scope, options, setScope, status, retry } = useScope();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const scopeError = t("shell.scope_error");
  const scopeLoading = t("shell.scope_loading");

  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selected = findAccount(options.map(option => ({ ...option, account_alias: option.alias })), scope);
  const current = scope === "all" ? t("shell.scope_all") : selected ? `${names.platform(selected.platform)} · ${names.account(selected.alias, selected.platform)}` : t("common.unknown");
  const platforms = [...new Set(options.map(option => option.platform))];

  const optionRow = (option: { alias: string; platform: string; paper: boolean }) => (
    <button
      key={`${option.platform}:${option.alias}`}
      type="button"
      className={`scope-option${scope === accountKey({ platform: option.platform, account_alias: option.alias }) ? " active" : ""}`}
      onClick={() => {
        setScope(accountKey({ platform: option.platform, account_alias: option.alias }));
        setOpen(false);
      }}
    >
      <span style={{ flex: 1 }}>{names.account(option.alias, option.platform)}</span>
      {option.paper && <span className="badge badge-accent">{t("common.paper_badge")}</span>}
    </button>
  );

  return (
    <div className="scope-switcher" ref={rootRef}>
      <button
        type="button"
        className="button button-secondary button-sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("shell.scope")}
        onClick={() => setOpen(value => !value)}
      >
        {status === "error" ? scopeError : current} ▾
      </button>
      {open && (
        <div className="scope-panel" role="listbox" aria-label={t("shell.scope")}>
          {status !== "ready" && (
            <div className="scope-error" role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
              <span style={{ flex: 1 }}>{status === "error" ? scopeError : scopeLoading}</span>
              {status === "error" && <button type="button" className="button button-secondary button-sm" onClick={retry}>{t("common.retry")}</button>}
            </div>
          )}
          <button
            type="button"
            className={`scope-option${scope === "all" ? " active" : ""}`}
            onClick={() => {
              setScope("all");
              setOpen(false);
            }}
          >
            {t("shell.scope_all")}
          </button>
          {platforms.map(platform => (
            <div key={platform}>
              <div className="scope-group">{names.platform(platform)}</div>
              {options.filter(option => option.platform === platform).map(optionRow)}
            </div>
          ))}

        </div>
      )}
    </div>
  );
}
