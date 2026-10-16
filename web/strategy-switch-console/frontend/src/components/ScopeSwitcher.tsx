import { accountName } from "../lib/displayNames";
import { useEffect, useRef, useState } from "react";
import { useScope } from "../app/context";
import { useT } from "../i18n";

/** Topbar account-scope selector; grouped by platform, paper accounts in their own group. */
export function ScopeSwitcher() {
  const t = useT();
  const { scope, options, setScope } = useScope();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const current = scope === "all" ? t("shell.scope_all") : scope;
  const live = options.filter(option => !option.paper);
  const paper = options.filter(option => option.paper);
  const platforms = [...new Set(live.map(option => option.platform))];

  const optionRow = (option: { alias: string; platform: string; paper: boolean }) => (
    <button
      key={option.alias}
      type="button"
      className={`scope-option${scope === option.alias ? " active" : ""}`}
      onClick={() => {
        setScope(option.alias);
        setOpen(false);
      }}
    >
      <span style={{ flex: 1 }}>{accountName(option.alias, option.platform)}</span>
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
        {scope === "all" ? current : accountName(scope, options.find(option => option.alias === scope)?.platform)} ▾
      </button>
      {open && (
        <div className="scope-panel" role="listbox" aria-label={t("shell.scope")}>
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
              <div className="scope-group">{platform}</div>
              {live.filter(option => option.platform === platform).map(optionRow)}
            </div>
          ))}
          {paper.length > 0 && (
            <div>
              <div className="scope-group">{t("shell.scope_paper_group")}</div>
              {paper.map(optionRow)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
