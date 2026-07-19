import Fastify from "fastify";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationDatabase } from "../../src/server/database/database";
import { formatDatabaseTimestamp } from "../../src/server/database/database-time";
import {
  DATABASE_MIGRATIONS,
  runMigrations,
} from "../../src/server/database/migrations";
import {
  registerDatabase,
  registerDatabases,
} from "../../src/server/database/register-database";
import {
  CATALOG_DATABASE_MIGRATIONS,
  CONVERSATION_DATABASE_MIGRATIONS,
} from "../../src/server/database/split-database-migrations";

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
      journal_mode: "delete",
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
      expect.objectContaining({
        version: 7,
        name: "move_tone_style_to_personas",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 8,
        name: "store_bilingual_catalog_content",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 9,
        name: "retire_legacy_migration_seed",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 10,
        name: "move_voice_behavior_to_personas",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 11,
        name: "use_autoincrement_record_ids",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 12,
        name: "store_timestamps_in_china_standard_time",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 13,
        name: "normalize_bilingual_catalog_and_snapshots",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 14,
        name: "split_preset_categories_into_tables",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 15,
        name: "reference_catalog_presets_by_id",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 16,
        name: "move_voice_behavior_to_scenarios",
        applied_at: expect.any(String),
      }),
      expect.objectContaining({
        version: 17,
        name: "create_conversation_feedback",
        applied_at: expect.any(String),
      }),
    ]);
    expect(
      database.raw
        .prepare("SELECT applied_at FROM schema_migrations")
        .all()
        .every(({ applied_at }) =>
          String(applied_at).endsWith("+08:00"),
        ),
    ).toBe(true);
    expect(
      database.raw
        .prepare(
          `SELECT name, strict
           FROM pragma_table_list
           WHERE name IN (
             'conversation_feedback_reports',
             'conversation_feedback_strengths',
             'conversation_feedback_improvement_areas',
             'conversation_feedback_coaching_tips',
             'conversation_feedback_criterion_scores',
             'conversation_feedback_moments',
             'conversation_messages', 'conversation_sessions',
             'conversation_persona_snapshots',
             'conversation_scenario_snapshots',
             'conversation_scenario_scoring_criteria',
             'conversation_scenario_personas',
             'persona_occupation_presets',
             'persona_personality_trait_presets',
             'persona_communication_style_presets',
             'scenario_tone_style_presets',
             'persona_motivation_presets',
             'persona_concern_presets',
             'scenario_training_goal_presets',
             'scenario_skill_focus_presets',
             'scenario_success_criterion_presets',
             'personas', 'scenarios',
             'persona_personality_traits', 'persona_motivations',
             'persona_concerns', 'scenario_training_goals',
             'scenario_skill_focuses', 'scenario_success_criteria',
             'scenario_personas'
           )
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "conversation_feedback_coaching_tips", strict: 1 },
      { name: "conversation_feedback_criterion_scores", strict: 1 },
      { name: "conversation_feedback_improvement_areas", strict: 1 },
      { name: "conversation_feedback_moments", strict: 1 },
      { name: "conversation_feedback_reports", strict: 1 },
      { name: "conversation_feedback_strengths", strict: 1 },
      { name: "conversation_messages", strict: 1 },
      { name: "conversation_persona_snapshots", strict: 1 },
      { name: "conversation_scenario_personas", strict: 1 },
      { name: "conversation_scenario_scoring_criteria", strict: 1 },
      { name: "conversation_scenario_snapshots", strict: 1 },
      { name: "conversation_sessions", strict: 1 },
      { name: "persona_communication_style_presets", strict: 1 },
      { name: "persona_concern_presets", strict: 1 },
      { name: "persona_concerns", strict: 1 },
      { name: "persona_motivation_presets", strict: 1 },
      { name: "persona_motivations", strict: 1 },
      { name: "persona_occupation_presets", strict: 1 },
      { name: "persona_personality_trait_presets", strict: 1 },
      { name: "persona_personality_traits", strict: 1 },
      { name: "personas", strict: 1 },
      { name: "scenario_personas", strict: 1 },
      { name: "scenario_skill_focus_presets", strict: 1 },
      { name: "scenario_skill_focuses", strict: 1 },
      { name: "scenario_success_criteria", strict: 1 },
      { name: "scenario_success_criterion_presets", strict: 1 },
      { name: "scenario_tone_style_presets", strict: 1 },
      { name: "scenario_training_goal_presets", strict: 1 },
      { name: "scenario_training_goals", strict: 1 },
      { name: "scenarios", strict: 1 },
    ]);
    expect(
      database.raw
        .prepare("SELECT COUNT(*) AS count FROM personas")
        .get(),
    ).toEqual({ count: 0 });

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
    ).toMatchObject({ count: 17 });
    expect(
      second.raw
        .prepare("SELECT applied_at FROM schema_migrations WHERE version = 1")
        .get()?.applied_at,
    ).toBe(appliedAt);
    second.close();
  });

  it("stores localized fields in dedicated columns instead of aggregate object JSON", () => {
    const database = new ApplicationDatabase({ path: createDatabasePath() });
    database.open();
    try {
      const columnNames = (table: string) =>
        database.raw
          .prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`)
          .all()
          .map(({ name }) => String(name));

      expect(columnNames("personas")).toEqual(expect.arrayContaining([
        "name", "name_zh_cn",
        "occupation_preset_id",
        "background", "background_zh_cn",
        "communication_style_preset_id",
        "behavior_notes", "behavior_notes_zh_cn",
      ]));
      expect(columnNames("scenarios")).toEqual(expect.arrayContaining([
        "name", "name_zh_cn",
        "description", "description_zh_cn",
        "tone_style_preset_id", "interrupt_frequency", "speaking_pace",
      ]));
      expect(columnNames("persona_personality_traits")).toEqual(expect.arrayContaining([
        "persona_id", "personality_trait_preset_id", "position",
      ]));
      expect(columnNames("scenario_success_criteria")).toEqual(expect.arrayContaining([
        "scenario_id", "success_criterion_preset_id", "position", "weight",
      ]));
      expect(columnNames("persona_occupation_presets")).toEqual(expect.arrayContaining([
        "occupation", "occupation_zh_cn",
      ]));
      expect(columnNames("persona_personality_trait_presets")).toEqual(
        expect.arrayContaining(["personality_trait", "personality_trait_zh_cn"]),
      );
      expect(columnNames("scenario_training_goal_presets")).toEqual(expect.arrayContaining([
        "training_goal", "training_goal_zh_cn",
      ]));
      expect(columnNames("conversation_sessions")).not.toEqual(
        expect.arrayContaining(["persona_json", "scenario_json"]),
      );

      const currentSchema = database.raw
        .prepare(
          `SELECT group_concat(sql, ' ') AS sql
           FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        )
        .get() as { sql: string };
      expect(currentSchema.sql).not.toMatch(
        /content_(?:zh|en)_json|persona_json|scenario_json|value_en|voice_behavior_json|scoring_criteria_json|\bcategory\b/,
      );
      expect(
        database.raw
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type = 'table'
               AND name IN ('persona_presets', 'scenario_presets')`,
          )
          .all(),
      ).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("normalizes existing JSON conversation snapshots without losing history", () => {
    const path = createDatabasePath();
    mkdirSync(dirname(path), { recursive: true });
    const legacy = new DatabaseSync(path);
    legacy.exec("PRAGMA foreign_keys = ON");
    runMigrations(legacy, DATABASE_MIGRATIONS.slice(0, 12));
    const timestamp = "2026-07-19T12:00:00.000+08:00";
    const sessionWrite = legacy.prepare(
      `INSERT INTO conversation_sessions (
        persona_json, scenario_json, difficulty, locale,
        instructions, voice, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      JSON.stringify({
        id: 42,
        name: "Ada",
        nameZhCn: "艾达",
        voiceBehavior: { interruptFrequency: "high", speakingPace: "fast" },
      }),
      JSON.stringify({
        id: 84,
        name: "Renewal negotiation",
        nameZhCn: "续约谈判",
        scoringCriteria: [
          { name: "Agreement", nameZhCn: "达成一致", weight: 100 },
        ],
        allowedPersonaIds: [42],
      }),
      "hard",
      "zh",
      "Stay in character.",
      "longanqian",
      timestamp,
      timestamp,
    );
    const conversationId = Number(sessionWrite.lastInsertRowid);
    legacy.prepare(
      `INSERT INTO conversation_messages (
        conversation_id, position, role, text, interrupted, created_at
      ) VALUES (?, 0, 'user', '保留这条历史。', 0, ?)`,
    ).run(conversationId, timestamp);
    legacy.close();

    const upgraded = new ApplicationDatabase({ path });
    upgraded.open();
    try {
      expect(upgraded.raw.prepare(
        `SELECT name, name_zh_cn, interrupt_frequency, speaking_pace
         FROM conversation_scenario_snapshots
         WHERE conversation_id = ?`,
      ).get(conversationId)).toEqual({
        name: "Renewal negotiation",
        name_zh_cn: "续约谈判",
        interrupt_frequency: "high",
        speaking_pace: "fast",
      });
      expect(upgraded.raw.prepare(
        `SELECT name, name_zh_cn, weight
         FROM conversation_scenario_scoring_criteria
         WHERE conversation_id = ?`,
      ).get(conversationId)).toEqual({
        name: "Agreement",
        name_zh_cn: "达成一致",
        weight: 100,
      });
      expect(upgraded.raw.prepare(
        `SELECT persona_id FROM conversation_scenario_personas
         WHERE conversation_id = ?`,
      ).get(conversationId)).toEqual({ persona_id: 42 });
      expect(upgraded.raw.prepare(
        `SELECT text FROM conversation_messages
         WHERE conversation_id = ?`,
      ).get(conversationId)).toEqual({ text: "保留这条历史。" });
    } finally {
      upgraded.close();
    }
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

  it("separates catalog and conversation schemas without WAL sidecars", async () => {
    const directory = mkdtempSync(join(tmpdir(), "role-player-split-databases-"));
    temporaryDirectories.push(directory);
    const catalogPath = join(directory, "catalog.sqlite");
    const conversationPath = join(directory, "conversations.sqlite");
    const app = Fastify({ logger: false });
    const databases = registerDatabases(app, {
      catalogPath,
      conversationPath,
    });

    await app.ready();
    expect(app.catalogDatabase).toBe(databases.catalogDatabase);
    expect(app.conversationDatabase).toBe(databases.conversationDatabase);
    expect(
      app.catalogDatabase.raw
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'personas'")
        .get(),
    ).toBeDefined();
    expect(
      app.catalogDatabase.raw
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'sessions'")
        .get(),
    ).toBeUndefined();
    expect(
      app.catalogDatabase.raw
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'persona_occupation_presets'")
        .get(),
    ).toBeDefined();
    expect(
      app.catalogDatabase.raw
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'persona_presets'")
        .get(),
    ).toBeUndefined();
    expect(
      app.conversationDatabase.raw
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'sessions'")
        .get(),
    ).toBeDefined();
    expect(
      app.conversationDatabase.raw
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'personas'")
        .get(),
    ).toBeUndefined();
    expect(existsSync(`${catalogPath}-wal`)).toBe(false);
    expect(existsSync(`${catalogPath}-shm`)).toBe(false);
    expect(existsSync(`${conversationPath}-wal`)).toBe(false);
    expect(existsSync(`${conversationPath}-shm`)).toBe(false);

    await app.close();
  });

  it("removes redundant table prefixes from an existing conversation database without losing history", () => {
    const path = createDatabasePath();
    const previousSchema = new ApplicationDatabase({
      path,
      migrations: CONVERSATION_DATABASE_MIGRATIONS.slice(0, 3),
    });
    previousSchema.open();
    const timestamp = formatDatabaseTimestamp();
    const conversationId = Number(
      previousSchema.raw
        .prepare(
          `INSERT INTO conversation_sessions (
            difficulty, locale, instructions, voice, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "medium",
          "en",
          "Preserve this session.",
          "longanqian",
          timestamp,
          timestamp,
        ).lastInsertRowid,
    );
    previousSchema.raw
      .prepare(
        `INSERT INTO conversation_messages (
          conversation_id, position, role, text, interrupted, created_at
        ) VALUES (?, 0, 'user', ?, 0, ?)`,
      )
      .run(conversationId, "Preserve this message.", timestamp);
    previousSchema.close();

    const upgraded = new ApplicationDatabase({
      path,
      migrations: CONVERSATION_DATABASE_MIGRATIONS,
    });
    upgraded.open();
    try {
      expect(
        upgraded.raw
          .prepare("SELECT name FROM schema_migrations WHERE version = 4")
          .get(),
      ).toEqual({ name: "remove_redundant_conversation_table_prefixes" });
      expect(
        upgraded.raw
          .prepare("SELECT name FROM schema_migrations WHERE version = 5")
          .get(),
      ).toEqual({ name: "persist_finalized_message_audio" });
      expect(
        upgraded.raw
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'message_audio'",
          )
          .get(),
      ).toEqual({ name: "message_audio" });
      expect(
        upgraded.raw
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type = 'table'
               AND name IN (
                 'sessions', 'persona_snapshots', 'scenario_snapshots',
                 'scenario_scoring_criteria', 'scenario_personas', 'messages'
               )
             ORDER BY name`,
          )
          .all(),
      ).toEqual([
        { name: "messages" },
        { name: "persona_snapshots" },
        { name: "scenario_personas" },
        { name: "scenario_scoring_criteria" },
        { name: "scenario_snapshots" },
        { name: "sessions" },
      ]);
      expect(
        upgraded.raw
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type = 'table' AND name LIKE 'conversation_%'`,
          )
          .all(),
      ).toEqual([]);
      expect(
        upgraded.raw
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type = 'index' AND name IN (
               'sessions_updated_at_idx',
               'messages_source_item_idx',
               'messages_response_idx'
             )
             ORDER BY name`,
          )
          .all(),
      ).toEqual([
        { name: "messages_response_idx" },
        { name: "messages_source_item_idx" },
        { name: "sessions_updated_at_idx" },
      ]);
      expect(
        upgraded.raw
          .prepare("SELECT instructions FROM sessions WHERE id = ?")
          .get(conversationId),
      ).toEqual({ instructions: "Preserve this session." });
      expect(
        upgraded.raw
          .prepare("SELECT text FROM messages WHERE conversation_id = ?")
          .get(conversationId),
      ).toEqual({ text: "Preserve this message." });
      expect(upgraded.raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("migrates discriminator-based preset rows into independent catalog tables", () => {
    const path = createDatabasePath();
    const oldCatalog = new ApplicationDatabase({
      path,
      migrations: CATALOG_DATABASE_MIGRATIONS.slice(0, 3),
    });
    oldCatalog.open();
    const timestamp = formatDatabaseTimestamp();
    oldCatalog.raw
      .prepare(
        `INSERT INTO persona_presets (
          id, seed_key, category, value, value_zh_cn,
          position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        41,
        "occupation_test",
        "occupation",
        "Tester",
        "测试员",
        0,
        timestamp,
        timestamp,
      );
    oldCatalog.raw
      .prepare(
        `INSERT INTO scenario_presets (
          id, seed_key, category, value, value_zh_cn,
          position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        73,
        "goal_test",
        "training_goal",
        "Verify migration",
        "验证迁移",
        0,
        timestamp,
        timestamp,
      );
    oldCatalog.close();

    const upgraded = new ApplicationDatabase({
      path,
      migrations: CATALOG_DATABASE_MIGRATIONS,
    });
    upgraded.open();
    try {
      expect(
        upgraded.raw
          .prepare(
            `SELECT id, occupation, occupation_zh_cn
             FROM persona_occupation_presets
             WHERE seed_key = ?`,
          )
          .get("occupation_test"),
      ).toEqual({ id: 41, occupation: "Tester", occupation_zh_cn: "测试员" });
      expect(
        upgraded.raw
          .prepare(
            `SELECT id, training_goal, training_goal_zh_cn
             FROM scenario_training_goal_presets
             WHERE seed_key = ?`,
          )
          .get("goal_test"),
      ).toEqual({
        id: 73,
        training_goal: "Verify migration",
        training_goal_zh_cn: "验证迁移",
      });
      expect(
        upgraded.raw
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type = 'table'
               AND name IN ('persona_presets', 'scenario_presets')`,
          )
          .all(),
      ).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("does not create empty split databases while an unsplit legacy database exists", async () => {
    const directory = mkdtempSync(join(tmpdir(), "role-player-unsplit-guard-"));
    temporaryDirectories.push(directory);
    const legacyPath = join(directory, "role-player.sqlite");
    const catalogPath = join(directory, "catalog.sqlite");
    const conversationPath = join(directory, "conversations.sqlite");
    const legacy = new ApplicationDatabase({ path: legacyPath });
    legacy.open();
    legacy.close();
    const app = Fastify({ logger: false });
    registerDatabases(app, {
      catalogPath,
      conversationPath,
      legacyPath,
    });

    await expect(app.ready()).rejects.toThrow(
      "Legacy database detected",
    );
    expect(existsSync(catalogPath)).toBe(false);
    expect(existsSync(conversationPath)).toBe(false);
    await app.close();
  });

  it("upgrades a version 1 database without creating business data", () => {
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
      { version: 7, name: "move_tone_style_to_personas" },
      { version: 8, name: "store_bilingual_catalog_content" },
      { version: 9, name: "retire_legacy_migration_seed" },
      { version: 10, name: "move_voice_behavior_to_personas" },
      { version: 11, name: "use_autoincrement_record_ids" },
      { version: 12, name: "store_timestamps_in_china_standard_time" },
      { version: 13, name: "normalize_bilingual_catalog_and_snapshots" },
      { version: 14, name: "split_preset_categories_into_tables" },
      { version: 15, name: "reference_catalog_presets_by_id" },
      { version: 16, name: "move_voice_behavior_to_scenarios" },
      { version: 17, name: "create_conversation_feedback" },
    ]);
    expect(
      first.raw.prepare("SELECT COUNT(*) AS count FROM personas").get(),
    ).toEqual({ count: 0 });
    first.close();

    const reopened = new ApplicationDatabase({ path });
    reopened.open();
    expect(
      reopened.raw.prepare("SELECT COUNT(*) AS count FROM personas").get(),
    ).toEqual({ count: 0 });
    expect(
      reopened.raw.prepare("SELECT COUNT(*) AS count FROM scenarios").get(),
    ).toEqual({ count: 0 });
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

    const timestamp = new Date().toISOString();
    const insertPersona = legacyConnection.prepare(`
      INSERT INTO personas (
        id, name, gender, age, occupation, identity, background,
        personality_traits_json, communication_style, behavior_notes,
        motivations_json, concerns_json, voice, created_at, updated_at
      ) VALUES (?, ?, 'unspecified', NULL, '', 'Buyer', '', json('["Cautious"]'),
                'Concise', '', json('[]'), json('[]'), 'longanqian', ?, ?)
    `);
    insertPersona.run("persona_adam", "Adam", timestamp, timestamp);
    insertPersona.run("persona_beth", "Beth", timestamp, timestamp);
    legacyConnection.prepare(`
      INSERT INTO scenarios (
        id, name, description, goals_json, suggested_skill_focus_json,
        success_criteria_json, scoring_criteria_json, voice_behavior_json,
        created_at, updated_at
      ) VALUES (
        'scenario_test_order', 'Discovery', 'Description', json('["Goal"]'),
        json('["Skill"]'), json('["Success"]'), json('[]'),
        json('{"interruptFrequency":"low","speakingPace":"normal"}'), ?, ?
      )
    `).run(timestamp, timestamp);
    const insertLink = legacyConnection.prepare(`
      INSERT INTO scenario_personas (
        scenario_id, persona_id, created_at
      ) VALUES ('scenario_test_order', ?, ?)
    `);
    insertLink.run("persona_adam", timestamp);
    insertLink.run("persona_beth", timestamp);
    legacyConnection.close();

    const upgraded = new ApplicationDatabase({ path });
    upgraded.open();
    expect(
      upgraded.raw
        .prepare(
          `SELECT personas.seed_key AS persona_key, links.position
           FROM scenario_personas AS links
           JOIN personas ON personas.id = links.persona_id
           JOIN scenarios ON scenarios.id = links.scenario_id
           WHERE scenarios.seed_key = 'scenario_test_order'
           ORDER BY position`,
        )
        .all(),
    ).toEqual([
      { persona_key: "persona_adam", position: 0 },
      { persona_key: "persona_beth", position: 1 },
    ]);
    expect(
      upgraded.raw
        .prepare(
          "SELECT created_at, updated_at FROM personas WHERE seed_key = ?",
        )
        .get("persona_adam"),
    ).toEqual({
      created_at: formatDatabaseTimestamp(Date.parse(timestamp)),
      updated_at: formatDatabaseTimestamp(Date.parse(timestamp)),
    });
    expect(
      upgraded.raw
        .prepare("SELECT name FROM schema_migrations WHERE version = 3")
        .get(),
    ).toEqual({ name: "add_scenario_persona_position" });
    upgraded.close();
  });

  it("upgrades a version 3 catalog into constrained per-domain preset tables", () => {
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
           WHERE name = 'persona_occupation_presets'`,
        )
        .get(),
    ).toEqual({ strict: 1 });

    const insert = upgraded.raw.prepare(
      `INSERT INTO persona_occupation_presets (
        occupation, occupation_zh_cn, position, created_at, updated_at
      ) VALUES (?, '', ?, ?, ?)`,
    );
    const timestamp = formatDatabaseTimestamp();
    insert.run(
      "Test Value",
      0,
      timestamp,
      timestamp,
    );
    expect(() =>
      insert.run(
        "test value",
        1,
        timestamp,
        timestamp,
      ),
    ).toThrow();
    expect(() =>
      insert.run(
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
        "preset_trait_thoughtful",
        "personality_trait",
        "周到",
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
          `SELECT personality_trait, personality_trait_zh_cn
           FROM persona_personality_trait_presets
           WHERE seed_key = ?`,
        )
        .get("preset_trait_thoughtful"),
    ).toEqual({
      personality_trait: "",
      personality_trait_zh_cn: "周到",
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
      { name: "conversation_feedback_moments_message_id_idx" },
      { name: "conversation_feedback_reports_status_idx" },
      { name: "conversation_messages_feedback_owner_idx" },
      { name: "conversation_messages_response_idx" },
      { name: "conversation_messages_source_item_idx" },
      { name: "conversation_sessions_updated_at_idx" },
    ]);

    const timestamp = new Date().toISOString();
    const insertSession = upgraded.raw.prepare(
      `INSERT INTO conversation_sessions (
        difficulty, locale, instructions, voice, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const conversationId = Number(insertSession.run(
      "medium",
      "en",
      "Stay in character.",
      "longanqian",
      timestamp,
      timestamp,
    ).lastInsertRowid);
    expect(() =>
      insertSession.run(
        "invalid",
        "en",
        "Stay in character.",
        "longanqian",
        timestamp,
        timestamp,
      ),
    ).toThrow();

    const insertMessage = upgraded.raw.prepare(
      `INSERT INTO conversation_messages (
        conversation_id, position, role, text, interrupted,
        source_item_id, response_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertMessage.run(
      conversationId,
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
        conversationId,
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
      .run(conversationId);
    expect(
      upgraded.raw
        .prepare(
          "SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id = ?",
        )
        .get(conversationId),
    ).toEqual({ count: 0 });
    upgraded.close();
  });
});
