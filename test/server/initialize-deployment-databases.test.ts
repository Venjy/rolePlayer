import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDeploymentDatabases } from "../../src/server/database/initialize-deployment-databases";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createPaths() {
  const directory = mkdtempSync(join(tmpdir(), "role-player-deployment-init-"));
  directories.push(directory);
  return {
    catalogPath: join(directory, "catalog.sqlite"),
    conversationPath: join(directory, "conversations.sqlite"),
  };
}

describe("initializeDeploymentDatabases", () => {
  it("migrates both databases, seeds catalog data, and remains idempotent", () => {
    const paths = createPaths();

    const first = initializeDeploymentDatabases(paths);
    const second = initializeDeploymentDatabases(paths);

    expect(first.catalog.qwenVoiceRowsInserted).toBeGreaterThan(0);
    expect(first.catalog.personaRowsInserted).toBeGreaterThan(0);
    expect(first.catalog.scenarioRowsInserted).toBeGreaterThan(0);
    expect(second.catalog.qwenVoiceRowsInserted).toBe(0);
    expect(second.catalog.personaRowsInserted).toBe(0);
    expect(second.catalog.scenarioRowsInserted).toBe(0);

    const catalog = new DatabaseSync(paths.catalogPath);
    const conversations = new DatabaseSync(paths.conversationPath);
    try {
      expect(
        catalog.prepare("SELECT COUNT(*) AS count FROM personas").get(),
      ).toMatchObject({ count: 3 });
      expect(
        conversations
          .prepare("SELECT COUNT(*) AS count FROM sessions")
          .get(),
      ).toMatchObject({ count: 0 });
      expect(
        conversations
          .prepare("SELECT MAX(version) AS version FROM schema_migrations")
          .get(),
      ).toMatchObject({ version: 9 });
    } finally {
      conversations.close();
      catalog.close();
    }
  });
});
