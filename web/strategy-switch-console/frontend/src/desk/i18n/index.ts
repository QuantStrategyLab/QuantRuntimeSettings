import type { Language } from "../../lib/prefs";
import { zh, type DeskKey } from "./zh-CN.ts";
import { en } from "./en.ts";

export type { DeskKey };
export type DeskParams = Record<string, string | number>;
export type DeskTranslate = (key: DeskKey, params?: DeskParams) => string;

export const DESK_MESSAGES: Record<Language, Record<DeskKey, string>> = { zh, en };

/** Fills {name} placeholders; an unknown placeholder stays visible rather than vanishing. */
export function deskTranslate(language: Language, key: DeskKey, params: DeskParams = {}): string {
  const template = DESK_MESSAGES[language][key] ?? DESK_MESSAGES.zh[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function deskTranslator(language: Language): DeskTranslate {
  return (key, params) => deskTranslate(language, key, params);
}

/**
 * The desk is zh-CN first. A stored choice wins; otherwise the browser language if it is
 * zh or en; otherwise zh (the console-wide default of en does not apply to the desk).
 */
export function resolveDeskLanguage(stored: string | null, browserLanguages: readonly string[]): Language {
  if (stored === "zh" || stored === "zh-CN") return "zh";
  if (stored === "en") return "en";
  for (const language of browserLanguages) {
    if (/^zh(?:-|$)/i.test(language)) return "zh";
    if (/^en(?:-|$)/i.test(language)) return "en";
  }
  return "zh";
}

const READ_REASONS = new Set(["never_read", "read_failed", "source_unavailable", "identity_unverified", "not_supported", "insufficient_history"]);

/** Reason codes from newer backends fall back to a generic label instead of a raw code. */
export function readReasonKey(reason: string): DeskKey {
  return (READ_REASONS.has(reason) ? `read.reason.${reason}` : "read.reason.other") as DeskKey;
}
