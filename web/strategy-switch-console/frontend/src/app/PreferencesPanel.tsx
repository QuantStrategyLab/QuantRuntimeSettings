import { usePrefs } from "../app/context";
import { useT } from "../i18n";
import { RANGES } from "../components/RangeSelector";
import type { DefaultRange, Language, ThemePreference, UpDownPreference } from "../lib/prefs";

/** Preferences dialog: theme, language, up/down colors, hide amounts, default range. Stored locally only. */
export function PreferencesPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { prefs, setPrefs } = usePrefs();

  const set = <K extends keyof typeof prefs>(key: K, value: (typeof prefs)[K]) => setPrefs({ ...prefs, [key]: value });

  return (
    <div className="dialog-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="prefs-title">
        <h2 id="prefs-title">{t("prefs.title")}</h2>
        <div className="prefs-grid">
          <div className="prefs-row">
            <span>{t("prefs.theme")}</span>
            <div className="segmented" role="group" aria-label={t("prefs.theme")}>
              {(["light", "dark", "system"] as ThemePreference[]).map(value => (
                <button key={value} type="button" className={`segment${prefs.theme === value ? " active" : ""}`} onClick={() => set("theme", value)}>
                  {t(`prefs.theme_${value}` as const)}
                </button>
              ))}
            </div>
          </div>
          <div className="prefs-row">
            <span>{t("prefs.language")}</span>
            <div className="segmented" role="group" aria-label={t("prefs.language")}>
              {(["zh", "en"] as Language[]).map(value => (
                <button key={value} type="button" className={`segment${prefs.language === value ? " active" : ""}`} onClick={() => set("language", value)}>
                  {value === "zh" ? "中文" : "English"}
                </button>
              ))}
            </div>
          </div>
          <div className="prefs-row">
            <span>{t("prefs.updown")}</span>
            <div className="segmented" role="group" aria-label={t("prefs.updown")}>
              {(["green-up", "red-up"] as UpDownPreference[]).map(value => (
                <button key={value} type="button" className={`segment${prefs.upDown === value ? " active" : ""}`} onClick={() => set("upDown", value)}>
                  {t(value === "green-up" ? "prefs.updown_green_up" : "prefs.updown_red_up")}
                </button>
              ))}
            </div>
          </div>
          <div className="prefs-row">
            <span>{t("prefs.hide_amounts")}</span>
            <input type="checkbox" checked={prefs.hideAmounts} onChange={event => set("hideAmounts", event.target.checked)} aria-label={t("prefs.hide_amounts")} />
          </div>
          <div className="prefs-row">
            <span>{t("prefs.default_range")}</span>
            <div className="segmented" role="group" aria-label={t("prefs.default_range")}>
              {RANGES.map(value => (
                <button key={value} type="button" className={`segment${prefs.defaultRange === value ? " active" : ""}`} onClick={() => set("defaultRange", value as DefaultRange)}>
                  {t(`perf.range.${value}` as const)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="card-note">{t("prefs.note")}</p>
        <div className="dialog-actions">
          <button type="button" className="button button-primary" onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}
