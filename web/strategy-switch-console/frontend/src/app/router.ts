/** Query-param routing: the Worker serves the shell for "/" and "/v2/*" only, so routes stay in "?page=". */

export type PageId = "overview" | "performance" | "decisions" | "accounts" | "strategies" | "health";

export interface Route {
  page: PageId;
  scope: string;
  account: string | null;
  tab: string | null;
}

const PAGES: PageId[] = ["overview", "performance", "decisions", "accounts", "strategies", "health"];

export const DEFAULT_SCOPE = "all";

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search);
  let page = params.get("page") as PageId | null;
  // Compatibility with legacy workspace links.
  const workspace = params.get("workspace");
  if (!page && workspace === "research") page = "decisions";
  if (!page && workspace === "accounts") page = "accounts";
  if (!page || !PAGES.includes(page)) page = "overview";
  return {
    page,
    scope: params.get("scope") || DEFAULT_SCOPE,
    account: params.get("account"),
    tab: params.get("tab"),
  };
}

export function routeToSearch(route: Route): string {
  const params = new URLSearchParams();
  if (route.page !== "overview") params.set("page", route.page);
  if (route.scope !== DEFAULT_SCOPE) params.set("scope", route.scope);
  if (route.account) params.set("account", route.account);
  if (route.tab) params.set("tab", route.tab);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function pushRoute(route: Route): void {
  const search = routeToSearch(route);
  window.history.pushState({ qsl: route }, "", `${window.location.pathname}${search}`);
}

export type NavigationGuard = (() => Promise<boolean>) | null;

let navigationGuard: NavigationGuard = null;

/** Pages with unsaved edits register a guard; navigation waits for it before committing. */
export function setNavigationGuard(guard: NavigationGuard): void {
  navigationGuard = guard;
}

export function getNavigationGuard(): NavigationGuard {
  return navigationGuard;
}
