import { getServerConfig } from "../src/server/config";
import { splitLegacyDatabase } from "../src/server/database/split-legacy-database";

const config = getServerConfig();
const result = splitLegacyDatabase({
  legacyPath: config.LEGACY_DATABASE_PATH,
  catalogPath: config.CATALOG_DATABASE_PATH,
  conversationPath: config.CONVERSATION_DATABASE_PATH,
});

console.log(`Legacy database preserved at ${result.legacyPath}.`);
console.log(`Catalog database created at ${result.catalogPath}.`);
console.log(`Conversation database created at ${result.conversationPath}.`);
console.log(
  JSON.stringify(
    {
      catalogRowsCopied: result.catalogRowsCopied,
      conversationRowsCopied: result.conversationRowsCopied,
    },
    null,
    2,
  ),
);
