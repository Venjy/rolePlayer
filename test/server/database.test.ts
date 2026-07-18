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
      expect.objectContaining({
        version: 5,
        name: "add_persona_preset_english_value",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 6,
        name: "create_conversation_history",
        applied_at: expect.any(String),
      }),
    ]);
    expect(
      database.raw
        .prepare(
          `SELECT name, strict
           FROM pragma_table_list
           WHERE name IN (
             'conversation_messages', 'conversation_sessions',
             'persona_presets', 'personas', 'scenarios', 'scenario_personas'
           )
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "conversation_messages", strict: 1 },
      { name: "conversation_sessions", strict: 1 },
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
    ).toMatchObject({ count: 6 });
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
      { version: 5, name: "add_persona_preset_english_value" },
      { version: 6, name: "create_conversation_history" },
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

  it("adds an empty English value when upgrading an existing version 4 preset", () => {
    const path = createDatabasePath();
    mkdirSync(dirname(path), { recursive: true });
    const legacyConnection = new DatabaseSync(path);
    legacyConnection.exec("PRAGMA foreign_keys = ON");
    runMigrations(legacyConnection, DATABASE_MIGRATIONS.slice(0, 4));
    const timestamp = new Date().toISOString();
    legacyConnection
      .prepare(
        `INSERT INTO persona_presets (
          id, category, value, position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "preset_identity_business_decision_maker",
        "identity",
        "业务部门的最终决策者",
        0,
        timestamp,
        timestamp,
      );
    expect(
      legacyConnection
        .prepare("SELECT name FROM pragma_table_info('persona_presets')")
        .all(),
    ).not.toContainEqual({ name: "value_en" });
    legacyConnection.close();

    const upgraded = new ApplicationDatabase({ path });
    upgraded.open();
    expect(
      upgraded.raw
        .prepare("SELECT name FROM schema_migrations WHERE version = 5")
        .get(),
    ).toEqual({ name: "add_persona_preset_english_value" });
    expect(
      upgraded.raw
        .prepare(
          `SELECT value, value_en
           FROM persona_presets
           WHERE id = ?`,
        )
        .get("preset_identity_business_decision_maker"),
    ).toEqual({
      value: "业务部门的最终决策者",
      value_en: "",
    });
    upgraded.close();
  });

  it("upgrades version 5 with strict conversation history and cascading messages", () => {
    const path = createDatabasePath();
    mkdirSync(dirname(path), { recursive: true });
    const legacyConnection = new DatabaseSync(path);
    legacyConnection.exec("PRAGMA foreign_keys = ON");
    runMigrations(legacyConnection, DATABASE_MIGRATIONS.slice(0, 5));
    expect(
      legacyConnection
        .prepare(
          `SELECT 1 AS present
           FROM sqlite_schema
           WHERE type = 'table' AND name = 'conversation_sessions'`,
        )
        .get(),
    ).toBeUndefined();
    legacyConnection.close();

    const upgraded = new ApplicationDatabase({ path });
    upgraded.open();
    expect(
      upgraded.raw
        .prepare("SELECT name FROM schema_migrations WHERE version = 6")
        .get(),
    ).toEqual({ name: "create_conversation_history" });
    expect(
      upgraded.raw
        .prepare(
          `SELECT name, strict
           FROM pragma_table_list
           WHERE name IN ('conversation_sessions', 'conversation_messages')
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "conversation_messages", strict: 1 },
      { name: "conversation_sessions", strict: 1 },
    ]);
    expect(
      upgraded.raw
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'index'
             AND name LIKE 'conversation_%_idx'
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "conversation_messages_response_idx" },
      { name: "conversation_messages_source_item_idx" },
      { name: "conversation_sessions_updated_at_idx" },
    ]);

    const timestamp = new Date().toISOString();
    const insertSession = upgraded.raw.prepare(
      `INSERT INTO conversation_sessions (
        id, persona_json, scenario_json, difficulty, locale,
        instructions, voice, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertSession.run(
      "conversation_test",
      JSON.stringify({ id: "persona_snapshot" }),
      JSON.stringify({ id: "scenario_snapshot" }),
      "medium",
      "en",
      "Stay in character.",
      "longanqian",
      timestamp,
      timestamp,
    );
    expect(() =>
      insertSession.run(
        "conversation_invalid_json",
        "[]",
        JSON.stringify({ id: "scenario_snapshot" }),
        "medium",
        "en",
        "Stay in character.",
        "longanqian",
        timestamp,
        timestamp,
      ),
    ).toThrow();

    const insertMessage = upgraded.raw.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, position, role, text, interrupted,
        source_item_id, response_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertMessage.run(
      "message_test",
      "conversation_test",
      0,
      "assistant",
      "A persisted finalized response.",
      1,
      null,
      "response_test",
      timestamp,
    );
    expect(() =>
      insertMessage.run(
        "message_invalid_role",
        "conversation_test",
        1,
        "system",
        "Invalid role.",
        0,
        "item_invalid",
        null,
        timestamp,
      ),
    ).toThrow();

    upgraded.raw
      .prepare("DELETE FROM conversation_sessions WHERE id = ?")
      .run("conversation_test");
    expect(
      upgraded.raw
        .prepare(
          "SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id = ?",
        )
        .get("conversation_test"),
    ).toEqual({ count: 0 });
    upgraded.close();
  });
});
