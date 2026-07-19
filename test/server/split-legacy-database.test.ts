import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeCatalogData } from "../../src/server/catalog/catalog-initializer";
import { CatalogRepository } from "../../src/server/catalog/catalog-repository";
import { ConversationRepository } from "../../src/server/conversations/conversation-repository";
import { ApplicationDatabase } from "../../src/server/database/database";
import { formatDatabaseTimestamp } from "../../src/server/database/database-time";
import { splitLegacyDatabase } from "../../src/server/database/split-legacy-database";
import {
  CATALOG_DATABASE_MIGRATIONS,
  CONVERSATION_DATABASE_MIGRATIONS,
  LEGACY_SPLIT_SOURCE_KEY,
} from "../../src/server/database/split-database-migrations";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("splitLegacyDatabase", () => {
  it("preserves catalog data and conversation history in independent files", () => {
    const directory = mkdtempSync(join(tmpdir(), "role-player-split-"));
    directories.push(directory);
    const legacyPath = join(directory, "role-player.sqlite");
    const catalogPath = join(directory, "catalog.sqlite");
    const conversationPath = join(directory, "conversations.sqlite");
    const legacy = new ApplicationDatabase({ path: legacyPath });
    legacy.open();
    initializeCatalogData(legacy);
    const originalCatalog = new CatalogRepository(legacy).listCatalog();
    const persona = originalCatalog.personas[0];
    const scenario = originalCatalog.scenarios[0];
    if (!persona || !scenario) throw new Error("Starter catalog is empty.");
    const timestamp = formatDatabaseTimestamp();
    const conversationId = Number(
      legacy.raw
        .prepare(
          `INSERT INTO conversation_sessions (
            difficulty, locale, instructions, voice, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "medium",
          "en",
          "Preserve this split history.",
          persona.voice,
          timestamp,
          timestamp,
        ).lastInsertRowid,
    );
    legacy.raw
      .prepare(
        `INSERT INTO conversation_persona_snapshots (
          conversation_id, source_persona_id, name, name_zh_cn, gender, age,
          occupation, occupation_zh_cn, background, background_zh_cn,
          personality_traits_json, personality_traits_zh_cn_json,
          communication_style, communication_style_zh_cn,
          behavior_notes, behavior_notes_zh_cn,
          motivations_json, motivations_zh_cn_json,
          concerns_json, concerns_zh_cn_json, voice, source_created_at,
          source_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversationId,
        persona.id,
        persona.name,
        persona.nameZhCn,
        persona.gender,
        persona.age,
        persona.occupation,
        persona.occupationZhCn,
        persona.background,
        persona.backgroundZhCn,
        JSON.stringify(persona.personalityTraits),
        JSON.stringify(persona.personalityTraitsZhCn),
        persona.communicationStyle,
        persona.communicationStyleZhCn,
        persona.behaviorNotes,
        persona.behaviorNotesZhCn,
        JSON.stringify(persona.motivations),
        JSON.stringify(persona.motivationsZhCn),
        JSON.stringify(persona.concerns),
        JSON.stringify(persona.concernsZhCn),
        persona.voice,
        persona.createdAt,
        persona.updatedAt,
      );
    legacy.raw
      .prepare(
        `INSERT INTO conversation_scenario_snapshots (
          conversation_id, source_scenario_id, name, name_zh_cn,
          description, description_zh_cn, goals_json, goals_zh_cn_json,
          suggested_skill_focus_json, suggested_skill_focus_zh_cn_json,
          success_criteria_json, success_criteria_zh_cn_json,
          tone_style, tone_style_zh_cn, interrupt_frequency, speaking_pace,
          source_created_at, source_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversationId,
        scenario.id,
        scenario.name,
        scenario.nameZhCn,
        scenario.description,
        scenario.descriptionZhCn,
        JSON.stringify(scenario.goals),
        JSON.stringify(scenario.goalsZhCn),
        JSON.stringify(scenario.suggestedSkillFocus),
        JSON.stringify(scenario.suggestedSkillFocusZhCn),
        JSON.stringify(scenario.successCriteria),
        JSON.stringify(scenario.successCriteriaZhCn),
        scenario.toneStyle,
        scenario.toneStyleZhCn,
        scenario.voiceBehavior.interruptFrequency ?? null,
        scenario.voiceBehavior.speakingPace ?? null,
        scenario.createdAt,
        scenario.updatedAt,
      );
    const insertCriterion = legacy.raw.prepare(
      `INSERT INTO conversation_scenario_scoring_criteria (
        conversation_id, position, name, name_zh_cn, weight
      ) VALUES (?, ?, ?, ?, ?)`,
    );
    scenario.scoringCriteria.forEach((criterion, position) => {
      insertCriterion.run(
        conversationId,
        position,
        criterion.name,
        criterion.nameZhCn,
        criterion.weight,
      );
    });
    const insertPersona = legacy.raw.prepare(
      `INSERT INTO conversation_scenario_personas (
        conversation_id, position, persona_id
      ) VALUES (?, ?, ?)`,
    );
    scenario.allowedPersonaIds.forEach((personaId, position) => {
      insertPersona.run(conversationId, position, personaId);
    });
    legacy.raw
      .prepare(
        `INSERT INTO conversation_messages (
          conversation_id, position, role, text, interrupted,
          source_item_id, created_at
        ) VALUES (?, 0, 'user', ?, 0, ?, ?)`,
      )
      .run(
        conversationId,
        "Preserve this split history.",
        "split-user-item",
        timestamp,
      );
    legacy.close();

    const result = splitLegacyDatabase({
      legacyPath,
      catalogPath,
      conversationPath,
    });
    expect(result.catalogRowsCopied.personas).toBe(
      originalCatalog.personas.length,
    );
    expect(result.catalogRowsCopied.persona_occupation_presets).toBe(
      originalCatalog.personaPresets.filter(
        ({ category }) => category === "occupation",
      ).length,
    );
    expect(result.catalogRowsCopied.scenario_training_goal_presets).toBe(
      originalCatalog.scenarioPresets.filter(
        ({ category }) => category === "training_goal",
      ).length,
    );
    expect(result.conversationRowsCopied.sessions).toBe(1);
    expect(result.conversationRowsCopied.messages).toBe(1);

    const catalog = new ApplicationDatabase({
      path: catalogPath,
      migrations: CATALOG_DATABASE_MIGRATIONS,
    });
    const conversations = new ApplicationDatabase({
      path: conversationPath,
      migrations: CONVERSATION_DATABASE_MIGRATIONS,
    });
    catalog.open();
    conversations.open();
    try {
      expect(new CatalogRepository(catalog).listCatalog().personas).toHaveLength(
        originalCatalog.personas.length,
      );
      expect(
        new ConversationRepository(conversations).getConversation(
          conversationId,
        ),
      ).toMatchObject({
        id: conversationId,
        messages: [{ text: "Preserve this split history." }],
      });
      expect(
        catalog.raw
          .prepare("SELECT 1 FROM sqlite_schema WHERE name = 'sessions'")
          .get(),
      ).toBeUndefined();
      expect(
        catalog.raw
          .prepare("SELECT 1 FROM sqlite_schema WHERE name = 'persona_presets'")
          .get(),
      ).toBeUndefined();
      expect(
        conversations.raw
          .prepare("SELECT 1 FROM sqlite_schema WHERE name = 'personas'")
          .get(),
      ).toBeUndefined();
      expect(
        catalog.raw
          .prepare("SELECT value FROM database_metadata WHERE key = ?")
          .get(LEGACY_SPLIT_SOURCE_KEY),
      ).toEqual({ value: legacyPath });
      expect(
        conversations.raw
          .prepare("SELECT value FROM database_metadata WHERE key = ?")
          .get(LEGACY_SPLIT_SOURCE_KEY),
      ).toEqual({ value: legacyPath });
    } finally {
      conversations.close();
      catalog.close();
    }
  });

  it("refuses to split a legacy WAL database that may still be active", () => {
    const directory = mkdtempSync(join(tmpdir(), "role-player-split-active-"));
    directories.push(directory);
    const legacyPath = join(directory, "role-player.sqlite");
    const legacy = new ApplicationDatabase({ path: legacyPath });
    legacy.open();
    legacy.close();
    writeFileSync(`${legacyPath}-wal`, "active");

    expect(() =>
      splitLegacyDatabase({
        legacyPath,
        catalogPath: join(directory, "catalog.sqlite"),
        conversationPath: join(directory, "conversations.sqlite"),
      }),
    ).toThrow("appears to be open in WAL mode");
  });
});
