import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerCatalogRoutes } from "./catalog/catalog-routes";
import { getServerConfig, hasQwenConfig } from "./config";
import { registerConversationRoutes } from "./conversations/conversation-routes";
import { registerDatabases } from "./database/register-database";
import { registerRealtimeGateway } from "./realtime/realtime-gateway";

export async function buildApp() {
  const config = getServerConfig();
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

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
  }));

  registerCatalogRoutes(app);
  registerConversationRoutes(app);

  await registerRealtimeGateway(app, { clientOrigin: config.CLIENT_ORIGIN });

  return app;
}
