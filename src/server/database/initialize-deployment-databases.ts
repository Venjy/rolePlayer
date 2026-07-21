import { initializeCatalogData } from "../catalog/catalog-initializer";
import { ApplicationDatabase } from "./database";
import {
  CATALOG_DATABASE_MIGRATIONS,
  CONVERSATION_DATABASE_MIGRATIONS,
} from "./split-database-migrations";

export interface DeploymentDatabasePaths {
  catalogPath: string;
  conversationPath: string;
}

export interface DeploymentDatabaseInitializationResult {
  catalogPath: string;
  conversationPath: string;
  catalog: ReturnType<typeof initializeCatalogData>;
}

/**
 * Applies both independent migration chains and installs missing catalog seed
 * data. It is safe at image-build time and on every container start.
 */
export function initializeDeploymentDatabases(
  paths: DeploymentDatabasePaths,
): DeploymentDatabaseInitializationResult {
  const catalogDatabase = new ApplicationDatabase({
    path: paths.catalogPath,
    migrations: CATALOG_DATABASE_MIGRATIONS,
  });
  const conversationDatabase = new ApplicationDatabase({
    path: paths.conversationPath,
    migrations: CONVERSATION_DATABASE_MIGRATIONS,
  });

  try {
    catalogDatabase.open();
    conversationDatabase.open();
    return {
      catalogPath: catalogDatabase.path,
      conversationPath: conversationDatabase.path,
      catalog: initializeCatalogData(catalogDatabase),
    };
  } finally {
    conversationDatabase.close();
    catalogDatabase.close();
  }
}
