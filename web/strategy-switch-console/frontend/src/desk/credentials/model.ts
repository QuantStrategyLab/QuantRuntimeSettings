/**
 * Credential expiry and reminder rules.
 *
 * The desk's reminder enum is exactly not_due / 30 / 7 / 1 / expired / unknown.
 * A legacy 14-day value maps to 30 and is never rendered as its own segment.
 * Only 7, 1 and expired create a "Needs you" item; 30 is an alert only and
 * unknown never becomes an action.
 */
import type { Language } from "../../lib/prefs";
import type { CredentialExpiry, CredentialItem, CredentialPhase, NeedsYouItem } from "../contract/types";
import { formatUtcDayLabel, formatUtcHm } from "../format.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";

export const REMINDER_PHASES = ["not_due", "30", "7", "1", "expired", "unknown"] as const;
export type ReminderPhase = (typeof REMINDER_PHASES)[number];

export function isReminderPhase(value: string): value is ReminderPhase {
  return (REMINDER_PHASES as readonly string[]).includes(value);
}

/** Legacy maintenance uses 14 days; the desk maps it to the 30 phase. */
export function normalizeCredentialPhase(phase: string): CredentialPhase {
  if (phase === "14") return "30";
  return isReminderPhase(phase) ? phase : "unknown";
}

export function reminderCounts(items: readonly { phase: string }[]): Record<ReminderPhase, number> {
  const counts: Record<ReminderPhase, number> = { not_due: 0, "30": 0, "7": 0, "1": 0, expired: 0, unknown: 0 };
  for (const item of items) counts[normalizeCredentialPhase(item.phase)] += 1;
  return counts;
}

export type CredentialTone = "ok" | "warn" | "risk" | "unknown";

export interface CredentialExpiryView {
  phase: CredentialPhase;
  /** Date text, "—" for no expiry, or "?" for unknown. Never 0. */
  mark: string;
  detail: string;
  tone: CredentialTone;
  unknown: boolean;
  /** True only for 7, 1 and expired: the phases that create a Needs-you item. */
  needsYou: boolean;
  /** True for 30, 7, 1 and expired: the schema's requires_action window. */
  requiresAction: boolean;
}

const PHASE_TONE: Record<CredentialPhase, CredentialTone> = {
  not_due: "ok",
  "30": "warn",
  "7": "warn",
  "1": "warn",
  expired: "risk",
  unknown: "unknown",
};

export function phaseLabel(phase: CredentialPhase, t: DeskTranslate): string {
  return t(`credential.phase.${phase}` as DeskKey);
}

export function formatCredentialAt(at: string, language: Language): string | null {
  const day = formatUtcDayLabel(at, language);
  const hm = formatUtcHm(at);
  return day && hm ? `${day} ${hm} UTC` : null;
}

export function credentialExpiryView(
  expiry: CredentialExpiry,
  phaseValue: string,
  t: DeskTranslate,
  language: Language,
): CredentialExpiryView {
  const phase = normalizeCredentialPhase(phaseValue);
  const base = {
    phase,
    tone: PHASE_TONE[phase],
    needsYou: phase === "7" || phase === "1" || phase === "expired",
    requiresAction: phase === "30" || phase === "7" || phase === "1" || phase === "expired",
  };
  if (expiry.status === "none") {
    return { ...base, mark: "—", detail: t("credential.expiry.none"), tone: "ok", unknown: false };
  }
  if (expiry.status === "unknown") {
    return {
      ...base,
      mark: t("read.unknown_mark"),
      detail: `${t(`read.reason.${expiry.reason}` as DeskKey)} · ${t("credential.expiry.source_missing")}`,
      tone: "unknown",
      unknown: true,
    };
  }
  const mark = formatCredentialAt(expiry.at, language) ?? t("read.unknown");
  const detail = `${phaseLabel(phase, t)} · ${t("credential.expiry.source", { source: expiry.source })}`;
  return { ...base, mark, detail, unknown: false };
}

export function credentialNeed(item: CredentialItem, t: DeskTranslate, language: Language): NeedsYouItem | null {
  const phase = normalizeCredentialPhase(item.phase);
  if (phase !== "7" && phase !== "1" && phase !== "expired") return null;
  const view = credentialExpiryView(item.expiry, phase, t, language);
  const expired = phase === "expired";
  return {
    id: `credential:${item.id}`,
    kind: "credential_expiring",
    severity: expired ? "critical" : "warning",
    target_id: null,
    title: t(expired ? "credential.need.expired" : "credential.need.title", { label: item.label }),
    detail: t("credential.need.detail", { phase: phaseLabel(phase, t), at: view.mark }),
    action: { label: t("credential.need.action"), route: `#/desk/accounts?tab=credentials&credential=${encodeURIComponent(item.id)}` },
  };
}

/** Input order is preserved; the card never re-ranks backend items. */
export function credentialNeeds(items: readonly CredentialItem[], t: DeskTranslate, language: Language): NeedsYouItem[] {
  return items.map(item => credentialNeed(item, t, language)).filter((item): item is NeedsYouItem => item !== null);
}
