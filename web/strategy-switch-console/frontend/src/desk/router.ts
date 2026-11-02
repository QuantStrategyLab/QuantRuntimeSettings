/**
 * Desk routes live in the URL hash (#/desk/<page>), so the Worker needs no new path: it
 * already serves the shell at "/". The old console keeps its ?page= routes untouched.
 */
export const DESK_PAGES = ["overview", "accounts", "switch", "performance", "alerts", "logs"] as const;
export type DeskPage = (typeof DESK_PAGES)[number];

const ALIASES: Record<string, DeskPage> = { strategy: "switch", home: "overview", log: "logs", alert: "alerts", account: "accounts", perf: "performance" };

export const DESK_HASH = /^#\/desk(?:[/?]|$)/;

export function isDeskHash(hash: string): boolean {
  return DESK_HASH.test(hash);
}

/** "#/desk/accounts?target=ibkr/tqqq" -> { page: "accounts", params }. Unknown pages fall back to overview. */
export function parseDeskHash(hash: string): { page: DeskPage; params: URLSearchParams } {
  const body = hash.replace(/^#\/desk\/?/, "");
  const [path, query = ""] = body.split("?", 2);
  const segment = (path.split("/")[0] || "overview").toLowerCase();
  const page = (DESK_PAGES as readonly string[]).includes(segment) ? (segment as DeskPage) : ALIASES[segment] ?? "overview";
  return { page, params: new URLSearchParams(query) };
}

export function deskHash(page: DeskPage): string {
  return `#/desk/${page}`;
}

/** Keys 1–6 open the pages in dock order. Ignored while typing or with a modifier held. */
export function hotkeyPage(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; target: unknown }): DeskPage | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = target?.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return null;
  const index = Number.parseInt(event.key, 10);
  return String(index) === event.key && index >= 1 && index <= DESK_PAGES.length ? DESK_PAGES[index - 1] : null;
}

/** Review overrides that are not persisted: ?theme=light|dark and ?lang=zh|en. */
export function urlOverrides(search: string): { theme: "light" | "dark" | null; language: "zh" | "en" | null } {
  const params = new URLSearchParams(search);
  const theme = params.get("theme");
  const lang = params.get("lang");
  return {
    theme: theme === "light" || theme === "dark" ? theme : null,
    language: lang === "zh" || lang === "zh-CN" ? "zh" : lang === "en" ? "en" : null,
  };
}
