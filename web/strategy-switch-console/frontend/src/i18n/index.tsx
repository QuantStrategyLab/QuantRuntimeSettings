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

const zh: Record<string, string> = {
  ...zhCN,
  ...overview.zh,
  ...performance.zh,
  ...decisions.zh,
  ...accounts.zh,
  ...strategies.zh,
  ...health.zh,
  ...facts.zh,
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
export type Translate = (key: MessageKey, params?: TranslateParams) => string;

export function translate(language: Language, key: MessageKey, params: TranslateParams = {}): string {
  const table = language === "zh" ? zh : enMessages;
  const fallbackKey = key.startsWith("state.") ? "state.unknown_status"
    : key.startsWith("reason.") ? "reason.unknown"
    : key.startsWith("research.state.") ? "state.unknown_status" : null;
  const template = table[key] ?? (language === "zh" ? enMessages[key] : zh[key])
    ?? (fallbackKey ? table[fallbackKey] : key);
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
  return (key, params) => translate(language, key, params);
}
