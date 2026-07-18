import type { FastifyInstance } from "fastify";
import { ApplicationDatabase } from "./database";

declare module "fastify" {
  interface FastifyInstance {
    database: ApplicationDatabase;
  }
}

/**
 * Opens the database in Fastify's onReady phase and closes it in onClose.
 * Keeping one connection per process also makes ownership explicit for future
 * repositories and services.
 */
export function registerDatabase(
  app: FastifyInstance,
  options: { path: string },
): ApplicationDatabase {
  const database = new ApplicationDatabase(options);

  app.decorate("database", database);
  app.addHook("onReady", async () => {
    database.open();
  });
  app.addHook("onClose", async () => {
    database.close();
  });

  return database;
}
