import { initializeCatalogData } from "../src/server/catalog/catalog-initializer";
import { getServerConfig } from "../src/server/config";
import { ApplicationDatabase } from "../src/server/database/database";
import { CATALOG_DATABASE_MIGRATIONS } from "../src/server/database/split-database-migrations";

const config = getServerConfig();
const database = new ApplicationDatabase({
  path: config.CATALOG_DATABASE_PATH,
  migrations: CATALOG_DATABASE_MIGRATIONS,
});

try {
  database.open();
  const result = initializeCatalogData(database);
  console.log(`Catalog initialization completed for ${database.path}.`);
  console.log(JSON.stringify(result, null, 2));
  const inserted =
    result.presetRowsInserted +
    result.scenarioPresetRowsInserted +
    result.personaRowsInserted +
    result.scenarioRowsInserted +
    result.scenarioLinksInserted;
  if (inserted === 0) {
    console.log(
      "No changes were needed. Skipped rows were already initialized; this is not an error.",
    );
  }
} finally {
  database.close();
}
