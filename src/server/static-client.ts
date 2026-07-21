import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface StaticClientOptions {
  root: string;
}

/**
 * Serves the built React application from the same Fastify process as the API.
 * Only extensionless browser-navigation paths receive the SPA fallback; missing
 * API, WebSocket, and asset paths remain honest 404 responses.
 */
export async function registerStaticClient(
  app: FastifyInstance,
  options: StaticClientOptions,
): Promise<void> {
  const root = resolve(options.root);
  const indexPath = join(root, "index.html");

  if (!existsSync(indexPath)) {
    throw new Error(
      `Static client serving is enabled, but ${indexPath} does not exist. Run pnpm build first or set SERVE_STATIC=false.`,
    );
  }

  await app.register(fastifyStatic, {
    root,
    prefix: "/",
    cacheControl: false,
    setHeaders(reply, filePath) {
      reply.header("Cache-Control", cacheControlForFile(root, filePath));
    },
  });

  app.setNotFoundHandler((request, reply) => {
    if (shouldServeSpaFallback(request)) {
      return reply
        .type("text/html; charset=utf-8")
        .header("Cache-Control", "no-cache")
        .sendFile("index.html");
    }

    return sendNotFound(reply);
  });
}

function cacheControlForFile(root: string, filePath: string): string {
  const relativePath = relative(root, filePath);
  const assetsPrefix = `assets${sep}`;
  return relativePath.startsWith(assetsPrefix)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

function shouldServeSpaFallback(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  if (pathname === "/ws" || pathname.startsWith("/ws/")) return false;
  if (extname(pathname) !== "") return false;

  return request.headers.accept?.includes("text/html") ?? false;
}

function sendNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({
    error: {
      code: "not_found",
      message: "The requested resource was not found.",
    },
  });
}
