import { getServerConfig } from "../src/server/config";
import { initializeDeploymentDatabases } from "../src/server/database/initialize-deployment-databases";

const config = getServerConfig();
const result = initializeDeploymentDatabases({
  catalogPath: config.CATALOG_DATABASE_PATH,
  conversationPath: config.CONVERSATION_DATABASE_PATH,
});

console.log("Deployment database initialization completed.");
console.log(`Catalog: ${result.catalogPath}`);
console.log(`Conversations: ${result.conversationPath}`);
console.log(JSON.stringify(result.catalog, null, 2));

const inserted =
  result.catalog.qwenVoiceRowsInserted +
  result.catalog.presetRowsInserted +
  result.catalog.scenarioPresetRowsInserted +
  result.catalog.personaRowsInserted +
  result.catalog.scenarioRowsInserted +
  result.catalog.scenarioLinksInserted;
if (inserted === 0) {
  console.log(
    "No catalog changes were needed. Both database schemas are current and seed rows already exist.",
  );
}
