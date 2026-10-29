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
  paper: boolean;
};

export interface ScopeContextValue {
  scope: string;
  options: ScopeOption[];
  setScope: (scope: string) => void;
  status: "loading" | "ready" | "error";
  retry: () => void;
}

export const ScopeContext = createContext<ScopeContextValue>({
  scope: "all",
  options: [],
  setScope: () => {},
  status: "ready",
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
