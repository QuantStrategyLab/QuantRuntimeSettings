import { accountKey, findAccount } from "../lib/accountDirectory";
import { useDisplayNames } from "../lib/useDisplayNames";
import { useEffect, useRef, useState } from "react";
import { useScope } from "../app/context";
import { useT } from "../i18n";

/** Topbar account-scope selector; grouped by platform, paper accounts in their own group. */
export function ScopeSwitcher() {
  const t = useT();
  const names = useDisplayNames();
  const { scope, options, setScope, status, metaStatus, retry } = useScope();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  // Why the panel last closed. Only a keyboard or in-panel close returns focus
  // to the trigger; a click on some other control must keep that control.
  const closeReason = useRef<"escape" | "select" | "outside" | null>(null);

  const scopeError = t("shell.scope_error");
  const scopeLoading = t("shell.scope_loading");

  const close = (reason: "escape" | "select" | "outside") => {
    closeReason.current = reason;
    setOpen(false);
  };

  // Focus moves into the panel when it opens and returns to the trigger when it
  // closes, so a keyboard or touch user is never left on a hidden element.
  useEffect(() => {
    if (open) {
      panelRef.current?.querySelector<HTMLElement>(".scope-option, .scope-panel button")?.focus();
    } else if (wasOpen.current && closeReason.current !== "outside") {
      triggerRef.current?.focus();
    }
    if (!open) closeReason.current = null;
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close("outside");
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close("escape");
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

  const optionRow = (option: { alias: string; platform: string; paper: boolean | null }) => (
    <button
      key={`${option.platform}:${option.alias}`}
      type="button"
      className={`scope-option${scope === accountKey({ platform: option.platform, account_alias: option.alias }) ? " active" : ""}`}
      onClick={() => {
        setScope(accountKey({ platform: option.platform, account_alias: option.alias }));
        close("select");
      }}
    >
      {/* The open panel shows the whole name: the label wraps instead of
          overflowing the panel, and the paper badge never shrinks away. */}
      <span className="scope-option-label">{names.account(option.alias, option.platform)}</span>
      {option.paper === true && <span className="badge badge-accent">{t("common.paper_badge")}</span>}
    </button>
  );

  return (
    <div className="scope-switcher" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="button button-secondary button-sm scope-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("shell.scope")}
        onClick={() => setOpen(value => !value)}
      >
        {/* A long account name is shortened inside the button only; the full
            name stays readable in the open panel. */}
        <span className="scope-trigger-label">{status === "error" ? scopeError : current} ▾</span>
      </button>
      {open && (
        <div className="scope-panel" ref={panelRef} role="listbox" aria-label={t("shell.scope")}>
          {status !== "ready" && (
            <div className="scope-error" role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
              <span className="scope-panel-text">{status === "error" ? scopeError : scopeLoading}</span>
              {status === "error" && <button type="button" className="button button-secondary button-sm" onClick={retry}>{t("common.retry")}</button>}
            </div>
          )}
          {status === "ready" && metaStatus === "error" && (
            <div className="scope-error" role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
              <span className="scope-panel-text">{t("shell.scope_meta_error")}</span>
              <button type="button" className="button button-secondary button-sm" onClick={retry}>{t("common.retry")}</button>
            </div>
          )}
          <button
            type="button"
            className={`scope-option${scope === "all" ? " active" : ""}`}
            onClick={() => {
              setScope("all");
              close("select");
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
