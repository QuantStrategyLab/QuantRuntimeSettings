import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Language } from "../lib/prefs";
import { zhCN, type CoreMessageKey } from "./zh-CN";
import { en } from "./en";
import * as overview from "./pages/overview";
import * as performance from "./pages/performance";
import * as decisions from "./pages/decisions";
import * as accounts from "./pages/accounts";
import * as strategies from "./pages/strategies";
import * as health from "./pages/health";
import * as facts from "./pages/facts";
import * as cockpit from "./pages/cockpit";
import * as desk from "./pages/desk";

const zh: Record<string, string> = {
  ...zhCN,
  ...overview.zh,
  ...performance.zh,
  ...decisions.zh,
  ...accounts.zh,
  ...strategies.zh,
  ...health.zh,
  ...facts.zh,
  ...cockpit.zh,
  ...desk.zh,
};
const enMessages: Record<string, string> = {
  ...en,
  ...overview.en,
  ...performance.en,
  ...decisions.en,
  ...accounts.en,
  ...strategies.en,
  ...health.en,
  ...facts.en,
  ...cockpit.en,
  ...desk.en,
};

for (const key of Object.keys(zh)) {
  if (!(key in enMessages)) throw new Error(`i18n: missing en translation for ${key}`);
}
for (const key of Object.keys(enMessages)) {
  if (!(key in zh)) throw new Error(`i18n: missing zh translation for ${key}`);
}

/** Core keys are type-checked; page fragment keys are plain strings. */
export type MessageKey = CoreMessageKey | (string & {});

export type TranslateParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: TranslateParams, fallbackKey?: MessageKey) => string;

const lookup = (table: Record<string, string>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

/** True when the key has its own vetted copy (parity guarantees both languages). */
export function hasTranslation(key: string): boolean {
  return lookup(zh, key) !== undefined;
}

/** Ordered longest-prefix-first namespace fallbacks; unclassified keys end at common.unknown. */
const NAMESPACE_FALLBACKS: readonly [prefix: string, fallbackKey: string][] = [
  ["research.state.", "state.unknown_status"],
  ["state.", "state.unknown_status"],
  ["reason.", "reason.unknown"],
  ["decisions.action.", "decisions.action.unknown"],
  ["strategies.execution.", "strategies.execution.unknown"],
  ["research.source.", "research.source.other"],
  ["initial_enrollment.fact.", "initial_enrollment.fact.other"],
  ["initial_enrollment.", "initial_enrollment.value.unknown"],
  ["accounts.field.", "accounts.field.other"],
  ["cockpit.change_log.action.", "cockpit.change_log.action.other"],
  ["cockpit.change_log.outcome.", "cockpit.change_log.outcome.unknown"],
  ["cockpit.change_log.subject_kind.", "cockpit.change_log.subject_kind.other"],
  ["cockpit.policy.limit.", "cockpit.policy.limit.other"],
  ["cockpit.policy.source.", "cockpit.policy.source.unknown"],
  ["cockpit.policy.restriction.reason.", "cockpit.policy.restriction.reason.unknown"],
  ["cockpit.lifecycle.regime_effect.", "cockpit.lifecycle.regime_effect.unknown"],
  ["cockpit.operation.reason.", "cockpit.operation.reason.unknown"],
];

export function translate(
  language: Language,
  key: MessageKey,
  params: TranslateParams = {},
  fallbackKey?: MessageKey,
): string {
  const tables = language === "zh" ? [zh, enMessages] : [enMessages, zh];
  const namespaceFallback = (candidate: string): string | undefined =>
    NAMESPACE_FALLBACKS.find(([prefix]) => candidate.startsWith(prefix))?.[1];
  const candidates: string[] = [key];
  if (fallbackKey) candidates.push(fallbackKey);
  for (const candidate of [key, fallbackKey]) {
    if (!candidate) continue;
    const routed = namespaceFallback(candidate);
    if (routed && !candidates.includes(routed)) candidates.push(routed);
  }
  candidates.push("common.unknown");
  let template: string | undefined;
  for (const candidate of candidates) {
    template = tables.map(table => lookup(table, candidate)).find(value => value !== undefined);
    if (template !== undefined) break;
  }
  if (template === undefined) template = lookup(tables[0], "common.unknown") ?? "Unknown";
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export const LanguageContext = createContext<Language>("zh");

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Language {
  return useContext(LanguageContext);
}

export function useT(): Translate {
  const language = useLanguage();
  return (key, params, fallbackKey) => translate(language, key, params, fallbackKey);
}
