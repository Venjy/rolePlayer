import { useCallback, useEffect, useRef, useState } from "react";
import {
  appRoutePath,
  parseAppRoute,
  publishAppRoute,
  type AppRoute,
} from "./app-route";

type NavigableAppRoute = Exclude<AppRoute, { page: "not_found" }>;

export interface NavigateOptions {
  replace?: boolean;
}

/** Minimal History API router for the SPA's three top-level surfaces. */
export function useAppRoute() {
  const [route, setRoute] = useState<AppRoute>(() =>
    parseAppRoute(window.location.pathname),
  );
  const routeRef = useRef<AppRoute>(route);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(
        publishAppRoute(
          routeRef,
          parseAppRoute(window.location.pathname),
        ),
      );
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback(
    (nextRoute: NavigableAppRoute, options: NavigateOptions = {}) => {
      const nextPath = appRoutePath(nextRoute);
      if (window.location.pathname !== nextPath) {
        const method = options.replace ? "replaceState" : "pushState";
        window.history[method](null, "", nextPath);
      }
      setRoute(publishAppRoute(routeRef, nextRoute));
    },
    [],
  );

  return { route, routeRef, navigate };
}
