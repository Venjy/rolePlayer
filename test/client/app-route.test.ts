import { describe, expect, it } from "vitest";
import {
  appRoutePath,
  parseAppRoute,
  publishAppRoute,
  type AppRoute,
} from "../../src/client/routing/app-route";

describe("app routes", () => {
  it.each([
    ["/", { page: "home" }],
    ["/admin", { page: "admin" }],
    ["/admin/", { page: "admin" }],
    ["/chat/1", { page: "chat", conversationId: 1 }],
    ["/chat/2048/", { page: "chat", conversationId: 2048 }],
  ])("parses %s", (pathname, expected) => {
    expect(parseAppRoute(pathname)).toEqual(expected);
  });

  it.each([
    "/unknown",
    "/chat",
    "/chat/0",
    "/chat/-1",
    "/chat/1/extra",
    "/chat/9007199254740992",
  ])("rejects unsupported path %s", (pathname) => {
    expect(parseAppRoute(pathname)).toEqual({ page: "not_found" });
  });

  it("serializes navigable routes to canonical paths", () => {
    expect(appRoutePath({ page: "home" })).toBe("/");
    expect(appRoutePath({ page: "admin" })).toBe("/admin");
    expect(appRoutePath({ page: "chat", conversationId: 42 })).toBe(
      "/chat/42",
    );
  });

  it("publishes a requested route before React can commit a render", () => {
    const reference = { current: { page: "home" } as AppRoute };
    const requested = { page: "chat", conversationId: 42 } as const;

    const stateValue = publishAppRoute(reference, requested);

    expect(reference.current).toBe(requested);
    expect(stateValue).toBe(requested);
  });
});
