import { initializeCatalogData } from "../src/server/catalog/catalog-initializer";
import { getServerConfig } from "../src/server/config";
import { ApplicationDatabase } from "../src/server/database/database";

const config = getServerConfig();
const database = new ApplicationDatabase({ path: config.DATABASE_PATH });

try {
  database.open();
  const result = initializeCatalogData(database);
  console.log(`Catalog initialization completed for ${database.path}.`);
  console.log(
    `English preset translations backfilled: ${result.presetTranslationsUpdated}.`,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  database.close();
}
