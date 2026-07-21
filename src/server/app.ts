import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { registerCatalogRoutes } from "./catalog/catalog-routes";
import { getServerConfig, hasFeedbackConfig, hasQwenConfig } from "./config";
import { registerConversationRoutes } from "./conversations/conversation-routes";
import { registerDatabases } from "./database/register-database";
import { registerRealtimeGateway } from "./realtime/realtime-gateway";
import { loadServerHttpsOptions } from "./server-https";
import { registerStaticClient } from "./static-client";

export async function buildApp() {
  const config = getServerConfig();
  const https = loadServerHttpsOptions({
    certPath: config.TLS_CERT_PATH,
    keyPath: config.TLS_KEY_PATH,
  });
  const logger = { level: config.LOG_LEVEL };
  // Node's HTTP and HTTPS servers share the same request/reply contract used
  // throughout the app; narrow Fastify's server generic at this one boundary.
  const app: FastifyInstance = https
    ? (Fastify({ logger, https }) as unknown as FastifyInstance)
    : Fastify({ logger });

  registerDatabases(app, {
    catalogPath: config.CATALOG_DATABASE_PATH,
    conversationPath: config.CONVERSATION_DATABASE_PATH,
    legacyPath: config.LEGACY_DATABASE_PATH,
  });

  await app.register(cors, {
    origin: config.CLIENT_ORIGIN,
  });

  app.get("/api/health", async () => ({
    status: "ok",
    databases: {
      catalog: "ok",
      conversations: "ok",
    },
    qwenConfigured: hasQwenConfig(),
    feedbackConfigured: hasFeedbackConfig(),
  }));

  registerCatalogRoutes(app);
  registerConversationRoutes(app);

  await registerRealtimeGateway(app, { clientOrigin: config.CLIENT_ORIGIN });

  if (config.SERVE_STATIC) {
    await registerStaticClient(app, { root: config.STATIC_CLIENT_PATH });
  }

  return app;
}
