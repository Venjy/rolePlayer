import Fastify from "fastify";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationDatabase } from "../../src/server/database/database";
import {
  DATABASE_MIGRATIONS,
  runMigrations,
} from "../../src/server/database/migrations";
import { registerDatabase } from "../../src/server/database/register-database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "role-player-database-"));
  temporaryDirectories.push(directory);
  return join(directory, "nested", "test.sqlite");
}

describe("ApplicationDatabase", () => {
  it("creates its directory, configures SQLite, and applies migrations", () => {
    const database = new ApplicationDatabase({ path: createDatabasePath() });

    database.open();

    expect(database.raw.prepare("PRAGMA journal_mode").get()).toMatchObject({
      journal_mode: "wal",
    });
    expect(database.raw.prepare("PRAGMA foreign_keys").get()).toMatchObject({
      foreign_keys: 1,
    });
    expect(database.raw.prepare("PRAGMA busy_timeout").get()).toMatchObject({
      timeout: 5_000,
    });
    expect(
      database.raw
        .prepare(
          "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
        )
        .all(),
    ).toEqual([
      expect.objectContaining({
        version: 1,
        name: "create_schema_migrations",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 2,
        name: "create_role_play_catalog",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 3,
        name: "add_scenario_persona_position",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 4,
        name: "create_persona_presets",
        applied_at: expect.any(String),
      }),
    ]);
    expect(
      database.raw
        .prepare(
          `SELECT name, strict
           FROM pragma_table_list
           WHERE name IN (
             'persona_presets', 'personas', 'scenarios', 'scenario_personas'
           )
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "persona_presets", strict: 1 },
      { name: "personas", strict: 1 },
      { name: "scenario_personas", strict: 1 },
      { name: "scenarios", strict: 1 },
    ]);
    expect(
      database.raw.prepare("SELECT name FROM personas WHERE id = ?").get(
        "persona_alex",
      ),
    ).toEqual({ name: "Alex" });
    expect(
      database.raw
        .prepare(
          `SELECT scenario_id, persona_id
           FROM scenario_personas
           WHERE scenario_id = 'scenario_sales_discovery'`,
        )
        .get(),
    ).toEqual({
      scenario_id: "scenario_sales_discovery",
      persona_id: "persona_alex",
    });

    database.close();
  });

  it("does not reapply migrations when a database is reopened", () => {
    const path = createDatabasePath();
    const first = new ApplicationDatabase({ path });
    first.open();
    const appliedAt = first.raw
      .prepare("SELECT applied_at FROM schema_migrations WHERE version = 1")
      .get()?.applied_at;
    first.close();

    const second = new ApplicationDatabase({ path });
    second.open();

    expect(
      second.raw
        .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
        .get(),
    ).toMatchObject({ count: 4 });
    expect(
      second.raw
        .prepare("SELECT applied_at FROM schema_migrations WHERE version = 1")
        .get()?.applied_at,
    ).toBe(appliedAt);
    second.close();
  });

  it("closes the connection with the Fastify lifecycle", async () => {
    const app = Fastify({ logger: false });
    const database = registerDatabase(app, { path: createDatabasePath() });

    expect(app.database).toBe(database);
    expect(() => database.raw).toThrow("Database is not open.");

    await app.ready();

    expect(database.raw.prepare("SELECT 1 AS value").get()).toMatchObject({
      value: 1,
    });

    await app.close();

    expect(() => database.raw).toThrow("Database is not open.");
  });

  it("upgrades a version 1 database and keeps the seeded catalog on reopen", () => {
    const path = createDatabasePath();
    mkdirSync(dirname(path), { recursive: true });
    const legacyConnection = new DatabaseSync(path);
    runMigrations(legacyConnection, DATABASE_MIGRATIONS.slice(0, 1));
    legacyConnection.close();

    const first = new ApplicationDatabase({ path });
    first.open();
    expect(
      first.raw
        .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([
      { version: 1, name: "create_schema_migrations" },
      { version: 2, name: "create_role_play_catalog" },
      { version: 3, name: "add_scenario_persona_position" },
      { version: 4, name: "create_persona_presets" },
    ]);
    expect(
      first.raw.prepare("SELECT COUNT(*) AS count FROM personas").get(),
    ).toEqual({ count: 1 });
    first.close();

    const reopened = new ApplicationDatabase({ path });
    reopened.open();
    expect(
      reopened.raw.prepare("SELECT COUNT(*) AS count FROM personas").get(),
    ).toEqual({ count: 1 });
    expect(
      reopened.raw.prepare("SELECT COUNT(*) AS count FROM scenarios").get(),
    ).toEqual({ count: 1 });
    reopened.close();
  });

  it("upgrades an existing catalog by adding deterministic persona order", () => {
    const path = createDatabasePath();
    mkdirSync(dirname(path), { recursive: true });
    const legacyConnection = new DatabaseSync(path);
    legacyConnection.exec("PRAGMA foreign_keys = ON");
    runMigrations(legacyConnection, DATABASE_MIGRATIONS.slice(0, 2));
    expect(
      legacyConnection
        .prepare("SELECT name FROM pragma_table_info('scenario_personas')")
        .all(),
    ).not.toContainEqual({ name: "position" });

    legacyConnection.exec(`
      INSERT INTO personas (
        id, name, gender, age, occupation, identity, background,
        personality_traits_json, communication_style, behavior_notes,
        motivations_json, concerns_json, voice, created_at, updated_at
      )
      SELECT
        'persona_beth', 'Beth', gender, age, occupation, identity, background,
        personality_traits_json, communication_style, behavior_notes,
        motivations_json, concerns_json, voice, created_at, updated_at
      FROM personas
      WHERE id = 'persona_alex';

      INSERT INTO scenario_personas (
        scenario_id, persona_id, created_at
      )
      SELECT scenario_id, 'persona_beth', created_at
      FROM scenario_personas
      WHERE persona_id = 'persona_alex';
    `);
    legacyConnection.close();

    const upgraded = new ApplicationDatabase({ path });
    upgraded.open();
    expect(
      upgraded.raw
        .prepare(
          `SELECT persona_id, position
           FROM scenario_personas
           WHERE scenario_id = 'scenario_sales_discovery'
           ORDER BY position`,
        )
        .all(),
    ).toEqual([
      { persona_id: "persona_alex", position: 0 },
      { persona_id: "persona_beth", position: 1 },
    ]);
    expect(
      upgraded.raw
        .prepare("SELECT name FROM schema_migrations WHERE version = 3")
        .get(),
    ).toEqual({ name: "add_scenario_persona_position" });
    upgraded.close();
  });

  it("upgrades a version 3 catalog with constrained persona presets", () => {
    const path = createDatabasePath();
    mkdirSync(dirname(path), { recursive: true });
    const legacyConnection = new DatabaseSync(path);
    legacyConnection.exec("PRAGMA foreign_keys = ON");
    runMigrations(legacyConnection, DATABASE_MIGRATIONS.slice(0, 3));
    expect(
      legacyConnection
        .prepare(
          `SELECT 1 AS present
           FROM sqlite_schema
           WHERE type = 'table' AND name = 'persona_presets'`,
        )
        .get(),
    ).toBeUndefined();
    legacyConnection.close();

    const upgraded = new ApplicationDatabase({ path });
    upgraded.open();
    expect(
      upgraded.raw
        .prepare("SELECT name FROM schema_migrations WHERE version = 4")
        .get(),
    ).toEqual({ name: "create_persona_presets" });
    expect(
      upgraded.raw
        .prepare(
          `SELECT strict
           FROM pragma_table_list
           WHERE name = 'persona_presets'`,
        )
        .get(),
    ).toEqual({ strict: 1 });

    const insert = upgraded.raw.prepare(
      `INSERT INTO persona_presets (
        id, category, value, position, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const timestamp = new Date().toISOString();
    insert.run(
      "preset_test",
      "identity",
      "Test Value",
      0,
      timestamp,
      timestamp,
    );
    expect(() =>
      insert.run(
        "preset_duplicate_value",
        "identity",
        "test value",
        1,
        timestamp,
        timestamp,
      ),
    ).toThrow();
    expect(() =>
      insert.run(
        "preset_duplicate_position",
        "identity",
        "Another value",
        0,
        timestamp,
        timestamp,
      ),
    ).toThrow();
    upgraded.close();
  });
});
