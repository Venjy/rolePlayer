export type AppRoute =
  | { page: "home" }
  | { page: "admin" }
  | { page: "chat"; conversationId: number }
  | { page: "not_found" };

export const HOME_ROUTE = { page: "home" } as const satisfies AppRoute;
export const ADMIN_ROUTE = { page: "admin" } as const satisfies AppRoute;

export interface AppRouteReference {
  current: AppRoute;
}

/**
 * Makes a requested route observable before React commits its state update.
 * Async session transitions use the reference to avoid acting on a stale URL.
 */
export function publishAppRoute(
  reference: AppRouteReference,
  nextRoute: AppRoute,
): AppRoute {
  reference.current = nextRoute;
  return nextRoute;
}

/**
 * Parses the small set of browser routes owned by the SPA. Conversation IDs
 * are SQLite-generated positive integers and are already safe URL segments.
 */
export function parseAppRoute(pathname: string): AppRoute {
  if (pathname === "/" || pathname === "") return HOME_ROUTE;
  if (pathname === "/admin" || pathname === "/admin/") return ADMIN_ROUTE;

  const chatMatch = /^\/chat\/([1-9]\d*)\/?$/.exec(pathname);
  if (chatMatch?.[1]) {
    const conversationId = Number(chatMatch[1]);
    if (Number.isSafeInteger(conversationId)) {
      return { page: "chat", conversationId };
    }
  }

  return { page: "not_found" };
}

export function appRoutePath(route: Exclude<AppRoute, { page: "not_found" }>): string {
  switch (route.page) {
    case "home":
      return "/";
    case "admin":
      return "/admin";
    case "chat":
      return `/chat/${route.conversationId}`;
  }
}
