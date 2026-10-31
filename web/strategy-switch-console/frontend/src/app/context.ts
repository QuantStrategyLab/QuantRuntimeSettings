import { createContext, useContext } from "react";
import type { DirectoryConfig } from "../lib/accountDirectory";
export const AccountDirectoryContext = createContext<DirectoryConfig | null>(null);
import type { Preferences } from "../lib/prefs";
import { DEFAULT_PREFERENCES } from "../lib/prefs";

export interface PrefsContextValue {
  prefs: Preferences;
  persistFailed: boolean;
  resolvedTheme: "light" | "dark";
  setPrefs: (next: Preferences) => void;
}

export const PrefsContext = createContext<PrefsContextValue>({
  prefs: DEFAULT_PREFERENCES,
  persistFailed: false,
  resolvedTheme: "light",
  setPrefs: () => {},
});

export function usePrefs(): PrefsContextValue {
  return useContext(PrefsContext);
}

export type ScopeOption = {
  alias: string;
  platform: string;
  /** `null` means the account directory was unreadable, so the environment is unknown. */
  paper: boolean | null;
};

export interface ScopeContextValue {
  scope: string;
  options: ScopeOption[];
  setScope: (scope: string) => void;
  status: "loading" | "ready" | "error";
  /** Whether the account metadata behind names and paper/live labels was read. */
  metaStatus: "ready" | "error";
  retry: () => void;
}

export const ScopeContext = createContext<ScopeContextValue>({
  scope: "all",
  options: [],
  setScope: () => {},
  status: "ready",
  metaStatus: "ready",
  retry: () => {},
});

export function useScope(): ScopeContextValue {
  return useContext(ScopeContext);
}

export type Navigate = (patch: { page?: import("./router").PageId; scope?: string; account?: string | null; tab?: string | null }) => void;

export const NavigateContext = createContext<Navigate>(() => {});

export function useNavigate(): Navigate {
  return useContext(NavigateContext);
}
