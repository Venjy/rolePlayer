import Fastify from "fastify";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerStaticClient } from "../../src/server/static-client";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStaticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "role-player-static-"));
  directories.push(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<main>role player</main>");
  writeFileSync(join(root, "assets", "app-123.js"), "console.log('app')");
  writeFileSync(join(root, "audio-recorder-worklet.js"), "// worklet");
  return root;
}

describe("registerStaticClient", () => {
  it("serves built files and falls back to index.html for SPA routes", async () => {
    const app = Fastify({ logger: false });
    app.get("/api/ping", async () => ({ status: "ok" }));
    await registerStaticClient(app, { root: createStaticRoot() });

    try {
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(200);
      expect(root.body).toContain("role player");
      expect(root.headers["cache-control"]).toBe("no-cache");

      const chat = await app.inject({
        method: "GET",
        url: "/chat/42",
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      expect(chat.statusCode).toBe(200);
      expect(chat.body).toContain("role player");

      const asset = await app.inject({
        method: "GET",
        url: "/assets/app-123.js",
      });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["cache-control"]).toBe(
        "public, max-age=31536000, immutable",
      );

      const worklet = await app.inject({
        method: "GET",
        url: "/audio-recorder-worklet.js",
      });
      expect(worklet.statusCode).toBe(200);
      expect(worklet.headers["cache-control"]).toBe("no-cache");
    } finally {
      await app.close();
    }
  });

  it("does not turn missing API or asset paths into the SPA", async () => {
    const app = Fastify({ logger: false });
    await registerStaticClient(app, { root: createStaticRoot() });

    try {
      const api = await app.inject({
        method: "GET",
        url: "/api/missing",
        headers: { accept: "text/html" },
      });
      expect(api.statusCode).toBe(404);
      expect(api.json()).toMatchObject({ error: { code: "not_found" } });

      const asset = await app.inject({
        method: "GET",
        url: "/missing.js",
        headers: { accept: "text/html" },
      });
      expect(asset.statusCode).toBe(404);
      expect(asset.json()).toMatchObject({ error: { code: "not_found" } });
    } finally {
      await app.close();
    }
  });

  it("fails startup clearly when the production client build is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "role-player-static-missing-"));
    directories.push(root);
    const app = Fastify({ logger: false });

    await expect(registerStaticClient(app, { root })).rejects.toThrow(
      "Run pnpm build first",
    );
    await app.close();
  });
});
