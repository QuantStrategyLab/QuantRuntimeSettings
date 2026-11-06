import type { CSSProperties } from "react";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { REMINDER_PHASES, reminderCounts } from "../credentials/model.ts";
import type { ReminderPhase } from "../credentials/model.ts";

const row: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 };

const cell = (phase: ReminderPhase): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "9px 10px",
  borderRadius: 12,
  border: "1px solid var(--mrd-line)",
  background: phase === "unknown" ? "none" : "var(--mrd-panel)",
  color: phase === "expired" ? "var(--mrd-coral)" : phase === "unknown" ? "var(--mrd-unknown)" : "var(--mrd-ink)",
});

/**
 * The six-segment reminder strip. There is deliberately no 14 segment: a legacy
 * 14-day value is counted in the 30 segment by reminderCounts().
 */
export function CredentialsReminderStrip({ counts, t }: {
  counts: Record<ReminderPhase, number>;
  t: DeskTranslate;
}) {
  return (
    <div className="mrd-reminder" role="group" aria-label={t("credentials.reminder.title")} data-reminder-phases={REMINDER_PHASES.join(",")}>
      <div style={row}>
        {REMINDER_PHASES.map(phase => (
          <div key={phase} style={cell(phase)} data-phase={phase}>
            <span className="mrd-label">{t(`credentials.reminder.${phase}` as DeskKey)}</span>
            <b style={{ fontSize: 18, lineHeight: 1.1 }}>{counts[phase]}</b>
          </div>
        ))}
      </div>
      <p style={{ margin: "8px 0 0", color: "var(--mrd-ink-3)", fontSize: 12 }}>{t("credentials.reminder.note")}</p>
    </div>
  );
}

export function CredentialsReminder({ items, t }: { items: readonly { phase: string }[]; t: DeskTranslate }) {
  return <CredentialsReminderStrip counts={reminderCounts(items)} t={t} />;
}
