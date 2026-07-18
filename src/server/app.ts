import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerCatalogRoutes } from "./catalog/catalog-routes";
import { getServerConfig, hasQwenConfig } from "./config";
import { registerConversationRoutes } from "./conversations/conversation-routes";
import { registerDatabase } from "./database/register-database";
import { registerRealtimeGateway } from "./realtime/realtime-gateway";

export async function buildApp() {
  const config = getServerConfig();
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  registerDatabase(app, { path: config.DATABASE_PATH });

  await app.register(cors, {
    origin: config.CLIENT_ORIGIN,
  });

  app.get("/api/health", async () => ({
    status: "ok",
    database: "ok",
    qwenConfigured: hasQwenConfig(),
  }));

  registerCatalogRoutes(app);
  registerConversationRoutes(app);

  await registerRealtimeGateway(app, { clientOrigin: config.CLIENT_ORIGIN });

  return app;
}
