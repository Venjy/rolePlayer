import { buildApp } from "./app";
import { getServerConfig } from "./config";

const config = getServerConfig();
const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.SERVER_HOST, port: config.SERVER_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
