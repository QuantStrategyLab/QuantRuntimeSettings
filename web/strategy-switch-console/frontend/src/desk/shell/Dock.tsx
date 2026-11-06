import type { DeskTranslate } from "../i18n/index.ts";
import { DESK_PAGES, deskHash, type DeskPage } from "../router.ts";
import { Icon } from "./icons";

interface DockProps {
  page: DeskPage;
  t: DeskTranslate;
  /** Open alert count from the ribbon; null when unknown (no badge rather than 0). */
  alertCount: number | null;
  /** Locked shell (401/403): the dock stays visible but every entry is inert. */
  locked?: boolean;
  onNavigate: (page: DeskPage) => void;
}

/** Floating icon dock on wide screens; a bottom tab bar on phones (CSS only). */
export function Dock({ page, t, alertCount, locked = false, onNavigate }: DockProps) {
  return (
    <nav className={locked ? "mrd-dock mrd-dock-locked" : "mrd-dock"} aria-label={t("shell.nav_label")}>
      <span className="mrd-mark" aria-hidden="true"><i /></span>
      {DESK_PAGES.map((id, index) => (
        locked ? (
          <span key={id} className="mrd-dock-item" aria-disabled="true" title={t("access.nav_locked")}>
            <Icon name={id} />
            <span>{t(`nav.${id}`)}</span>
          </span>
        ) : (
          <a
            key={id}
            href={deskHash(id)}
            className="mrd-dock-item"
            aria-current={id === page ? "page" : undefined}
            aria-keyshortcuts={String(index + 1)}
            title={t("nav.hotkey", { key: index + 1 })}
            onClick={event => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate(id);
            }}
          >
            <Icon name={id} />
            <span>{t(`nav.${id}`)}</span>
            {id === "alerts" && alertCount !== null && alertCount > 0 ? (
              <em className="mrd-badge" aria-label={t("nav.alert_badge", { count: alertCount })}>{alertCount > 99 ? "99+" : alertCount}</em>
            ) : null}
          </a>
        )
      ))}
    </nav>
  );
}
