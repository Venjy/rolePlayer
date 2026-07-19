import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { ApplicationDatabase } from "./database";
import {
  CATALOG_DATABASE_MIGRATIONS,
  CONVERSATION_DATABASE_MIGRATIONS,
  LEGACY_SPLIT_SOURCE_KEY,
} from "./split-database-migrations";

declare module "fastify" {
  interface FastifyInstance {
    catalogDatabase: ApplicationDatabase;
    conversationDatabase: ApplicationDatabase;
    /** Legacy single-database registration retained for migration tests only. */
    database: ApplicationDatabase;
  }
}

export interface SplitDatabaseOptions {
  catalogPath: string;
  conversationPath: string;
  legacyPath?: string;
}

/** Registers the two independently persisted application data domains. */
export function registerDatabases(
  app: FastifyInstance,
  options: SplitDatabaseOptions,
): {
  catalogDatabase: ApplicationDatabase;
  conversationDatabase: ApplicationDatabase;
} {
  const catalogDatabase = new ApplicationDatabase({
    path: options.catalogPath,
    migrations: CATALOG_DATABASE_MIGRATIONS,
  });
  const conversationDatabase = new ApplicationDatabase({
    path: options.conversationPath,
    migrations: CONVERSATION_DATABASE_MIGRATIONS,
  });
  const legacyPath = options.legacyPath
    ? new ApplicationDatabase({ path: options.legacyPath }).path
    : undefined;

  if (
    catalogDatabase.path !== ":memory:" &&
    catalogDatabase.path === conversationDatabase.path
  ) {
    throw new Error(
      "Catalog and conversation databases must use different files.",
    );
  }

  app.decorate("catalogDatabase", catalogDatabase);
  app.decorate("conversationDatabase", conversationDatabase);
  app.addHook("onReady", async () => {
    const legacyExists = legacyPath !== undefined && existsSync(legacyPath);
    if (
      legacyExists &&
      (!existsSync(catalogDatabase.path) ||
        !existsSync(conversationDatabase.path))
    ) {
      throw unsplitLegacyDatabaseError(legacyPath);
    }

    catalogDatabase.open();
    try {
      conversationDatabase.open();
      if (
        legacyExists &&
        (!hasLegacySplitMarker(catalogDatabase, legacyPath) ||
          !hasLegacySplitMarker(conversationDatabase, legacyPath))
      ) {
        throw unsplitLegacyDatabaseError(legacyPath);
      }
    } catch (error) {
      conversationDatabase.close();
      catalogDatabase.close();
      throw error;
    }
  });
  app.addHook("onClose", async () => {
    conversationDatabase.close();
    catalogDatabase.close();
  });

  return { catalogDatabase, conversationDatabase };
}

function hasLegacySplitMarker(
  database: ApplicationDatabase,
  legacyPath: string,
): boolean {
  return Boolean(
    database.raw
      .prepare("SELECT 1 FROM database_metadata WHERE key = ? AND value = ?")
      .get(LEGACY_SPLIT_SOURCE_KEY, legacyPath),
  );
}

function unsplitLegacyDatabaseError(legacyPath: string): Error {
  return new Error(
    `Legacy database detected at ${legacyPath}. Stop the server and run pnpm database:split before starting the application.`,
  );
}

/**
 * Legacy one-file registration retained to exercise the historical migration
 * chain and one-time split importer. New application code uses
 * `registerDatabases` above.
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
