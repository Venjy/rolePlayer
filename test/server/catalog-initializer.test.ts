import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CatalogInitializationInstructionsTooLongError,
  CatalogInitializationScenarioCapacityError,
  DEFAULT_INITIAL_SCENARIO_ID,
  INITIAL_CATALOG_PERSONAS,
  INITIAL_PERSONA_PRESETS,
  initializeCatalogData,
} from "../../src/server/catalog/catalog-initializer";
import { CatalogRepository } from "../../src/server/catalog/catalog-repository";
import { ApplicationDatabase } from "../../src/server/database/database";
import { MAX_SCENARIO_PERSONAS } from "../../src/shared/role-play-catalog";
import { findRolePlayInstructionsLengthIssue } from "../../src/shared/role-play-instructions";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDatabase(): ApplicationDatabase {
  const directory = mkdtempSync(join(tmpdir(), "role-player-initializer-"));
  temporaryDirectories.push(directory);
  const database = new ApplicationDatabase({
    path: join(directory, "catalog.sqlite"),
  });
  database.open();
  return database;
}

describe("initializeCatalogData", () => {
  it("keeps every starter persona value backed by a matching preset", () => {
    const presetValues = new Map(
      [
        "identity",
        "occupation",
        "personality_trait",
        "communication_style",
        "motivation",
        "concern",
      ].map((category) => [
        category,
        new Set(
          INITIAL_PERSONA_PRESETS.filter(
            (preset) => preset.category === category,
          ).map((preset) => preset.value),
        ),
      ]),
    );

    for (const { input } of INITIAL_CATALOG_PERSONAS) {
      expect(presetValues.get("occupation")).toContain(input.occupation);
      expect(presetValues.get("identity")).toContain(input.identity);
      expect(presetValues.get("communication_style")).toContain(
        input.communicationStyle,
      );
      for (const trait of input.personalityTraits) {
        expect(presetValues.get("personality_trait")).toContain(trait);
      }
      for (const motivation of input.motivations) {
        expect(presetValues.get("motivation")).toContain(motivation);
      }
      for (const concern of input.concerns) {
        expect(presetValues.get("concern")).toContain(concern);
      }
    }
  });

  it("is idempotent without overwriting later edits", () => {
    const database = createDatabase();
    try {
      const first = initializeCatalogData(database);

      expect(first).toEqual({
        presetRowsInserted: INITIAL_PERSONA_PRESETS.length,
        presetRowsSkipped: 0,
        personaRowsInserted: INITIAL_CATALOG_PERSONAS.length,
        personaRowsSkipped: 0,
        scenarioLinksInserted: INITIAL_CATALOG_PERSONAS.length,
        scenarioLinksSkipped: 0,
        defaultScenarioFound: true,
      });
      expect(
        database.raw
          .prepare("SELECT COUNT(*) AS count FROM persona_presets")
          .get(),
      ).toEqual({ count: INITIAL_PERSONA_PRESETS.length });
      expect(
        database.raw.prepare("SELECT COUNT(*) AS count FROM personas").get(),
      ).toEqual({ count: INITIAL_CATALOG_PERSONAS.length + 1 });
      expect(
        database.raw
          .prepare(
            `SELECT persona_id, position
             FROM scenario_personas
             WHERE scenario_id = ?
             ORDER BY position`,
          )
          .all(DEFAULT_INITIAL_SCENARIO_ID),
      ).toEqual([
        { persona_id: "persona_alex", position: 0 },
        { persona_id: "persona_lin_yue", position: 1 },
        { persona_id: "persona_wang_qiang", position: 2 },
        { persona_id: "persona_chen_chen", position: 3 },
      ]);

      const editedAt = "2099-01-01T00:00:00.000Z";
      database.raw
        .prepare(
          `UPDATE persona_presets
           SET value = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          "管理员修改后的身份",
          editedAt,
          "preset_identity_business_decision_maker",
        );
      database.raw
        .prepare(
          `UPDATE personas
           SET occupation = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run("管理员修改后的职业", editedAt, "persona_lin_yue");

      const second = initializeCatalogData(database);

      expect(second).toEqual({
        presetRowsInserted: 0,
        presetRowsSkipped: INITIAL_PERSONA_PRESETS.length,
        personaRowsInserted: 0,
        personaRowsSkipped: INITIAL_CATALOG_PERSONAS.length,
        scenarioLinksInserted: 0,
        scenarioLinksSkipped: INITIAL_CATALOG_PERSONAS.length,
        defaultScenarioFound: true,
      });
      expect(
        database.raw
          .prepare(
            `SELECT value, updated_at
             FROM persona_presets
             WHERE id = ?`,
          )
          .get("preset_identity_business_decision_maker"),
      ).toEqual({
        value: "管理员修改后的身份",
        updated_at: editedAt,
      });
      expect(
        database.raw
          .prepare(
            `SELECT occupation, updated_at
             FROM personas
             WHERE id = ?`,
          )
          .get("persona_lin_yue"),
      ).toEqual({
        occupation: "管理员修改后的职业",
        updated_at: editedAt,
      });
      expect(
        database.raw
          .prepare("SELECT COUNT(*) AS count FROM persona_presets")
          .get(),
      ).toEqual({ count: INITIAL_PERSONA_PRESETS.length });
      expect(
        database.raw.prepare("SELECT COUNT(*) AS count FROM personas").get(),
      ).toEqual({ count: INITIAL_CATALOG_PERSONAS.length + 1 });
      expect(
        database.raw
          .prepare(
            `SELECT COUNT(*) AS count
             FROM scenario_personas
             WHERE scenario_id = ?`,
          )
          .get(DEFAULT_INITIAL_SCENARIO_ID),
      ).toEqual({ count: INITIAL_CATALOG_PERSONAS.length + 1 });
    } finally {
      database.close();
    }
  });

  it("appends a missing preset when its preferred position is occupied", () => {
    const database = createDatabase();
    try {
      const timestamp = new Date().toISOString();
      database.raw
        .prepare(
          `INSERT INTO persona_presets (
            id, category, value, position, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "preset_custom_identity",
          "identity",
          "管理员自定义身份",
          0,
          timestamp,
          timestamp,
        );

      const result = initializeCatalogData(database);

      expect(result.presetRowsInserted).toBe(INITIAL_PERSONA_PRESETS.length);
      expect(result.presetRowsSkipped).toBe(0);
      expect(
        database.raw
          .prepare(
            `SELECT id, position
             FROM persona_presets
             WHERE category = 'identity'
             ORDER BY position`,
          )
          .all(),
      ).toEqual([
        { id: "preset_custom_identity", position: 0 },
        { id: "preset_identity_business_decision_maker", position: 1 },
        { id: "preset_identity_management_recommender", position: 2 },
        { id: "preset_identity_procurement_decision_maker", position: 3 },
        { id: "preset_identity_small_business_owner", position: 4 },
        { id: "preset_identity_technical_evaluator", position: 5 },
        { id: "preset_identity_daily_user_influencer", position: 6 },
        { id: "preset_identity_marketing_decision_maker", position: 7 },
        { id: "preset_identity_people_manager", position: 8 },
      ]);
    } finally {
      database.close();
    }
  });

  it("appends a restored scenario link without reordering existing links", () => {
    const database = createDatabase();
    try {
      initializeCatalogData(database);
      expect(
        database.raw
          .prepare(
            `DELETE FROM scenario_personas
             WHERE scenario_id = ? AND persona_id = ?`,
          )
          .run(DEFAULT_INITIAL_SCENARIO_ID, "persona_wang_qiang").changes,
      ).toBe(1);

      const result = initializeCatalogData(database);

      expect(result.scenarioLinksInserted).toBe(1);
      expect(result.scenarioLinksSkipped).toBe(2);
      expect(
        database.raw
          .prepare(
            `SELECT persona_id, position
             FROM scenario_personas
             WHERE scenario_id = ?
             ORDER BY position`,
          )
          .all(DEFAULT_INITIAL_SCENARIO_ID),
      ).toEqual([
        { persona_id: "persona_alex", position: 0 },
        { persona_id: "persona_lin_yue", position: 1 },
        { persona_id: "persona_chen_chen", position: 3 },
        { persona_id: "persona_wang_qiang", position: 4 },
      ]);
    } finally {
      database.close();
    }
  });

  it("does not recreate a deleted default scenario", () => {
    const database = createDatabase();
    try {
      expect(
        database.raw
          .prepare("DELETE FROM scenarios WHERE id = ?")
          .run(DEFAULT_INITIAL_SCENARIO_ID).changes,
      ).toBe(1);

      const result = initializeCatalogData(database);

      expect(result).toEqual({
        presetRowsInserted: INITIAL_PERSONA_PRESETS.length,
        presetRowsSkipped: 0,
        personaRowsInserted: INITIAL_CATALOG_PERSONAS.length,
        personaRowsSkipped: 0,
        scenarioLinksInserted: 0,
        scenarioLinksSkipped: INITIAL_CATALOG_PERSONAS.length,
        defaultScenarioFound: false,
      });
      expect(
        database.raw
          .prepare("SELECT 1 AS present FROM scenarios WHERE id = ?")
          .get(DEFAULT_INITIAL_SCENARIO_ID),
      ).toBeUndefined();
      expect(
        database.raw
          .prepare("SELECT COUNT(*) AS count FROM persona_presets")
          .get(),
      ).toEqual({ count: INITIAL_PERSONA_PRESETS.length });
      expect(
        database.raw.prepare("SELECT COUNT(*) AS count FROM personas").get(),
      ).toEqual({ count: INITIAL_CATALOG_PERSONAS.length + 1 });
      expect(
        database.raw
          .prepare("SELECT COUNT(*) AS count FROM scenario_personas")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("rolls back instead of exceeding the scenario persona limit", () => {
    const database = createDatabase();
    try {
      initializeCatalogData(database);
      database.raw
        .prepare(
          `DELETE FROM scenario_personas
           WHERE scenario_id = ? AND persona_id = ?`,
        )
        .run(DEFAULT_INITIAL_SCENARIO_ID, "persona_wang_qiang");

      const clonePersona = database.raw.prepare(
        `INSERT INTO personas (
          id, name, gender, age, occupation, identity, background,
          personality_traits_json, communication_style, behavior_notes,
          motivations_json, concerns_json, voice, created_at, updated_at
        )
        SELECT
          ?, ?, gender, age, occupation, identity, background,
          personality_traits_json, communication_style, behavior_notes,
          motivations_json, concerns_json, voice, created_at, updated_at
        FROM personas
        WHERE id = 'persona_alex'`,
      );
      const insertLink = database.raw.prepare(
        `INSERT INTO scenario_personas (
          scenario_id, persona_id, position, created_at
        ) VALUES (?, ?, ?, ?)`,
      );
      const timestamp = new Date().toISOString();
      const customPersonaCount = MAX_SCENARIO_PERSONAS - 3;
      for (let index = 0; index < customPersonaCount; index += 1) {
        const personaId = `persona_capacity_${index}`;
        clonePersona.run(personaId, `容量角色 ${index}`);
        insertLink.run(
          DEFAULT_INITIAL_SCENARIO_ID,
          personaId,
          index + 4,
          timestamp,
        );
      }
      expect(
        database.raw
          .prepare(
            `SELECT COUNT(*) AS count
             FROM scenario_personas
             WHERE scenario_id = ?`,
          )
          .get(DEFAULT_INITIAL_SCENARIO_ID),
      ).toEqual({ count: MAX_SCENARIO_PERSONAS });

      const missingPresetId = "preset_concern_hidden_fees";
      database.raw
        .prepare("DELETE FROM persona_presets WHERE id = ?")
        .run(missingPresetId);

      expect(() => initializeCatalogData(database)).toThrow(
        CatalogInitializationScenarioCapacityError,
      );

      expect(
        database.raw
          .prepare(
            `SELECT COUNT(*) AS count
             FROM scenario_personas
             WHERE scenario_id = ?`,
          )
          .get(DEFAULT_INITIAL_SCENARIO_ID),
      ).toEqual({ count: MAX_SCENARIO_PERSONAS });
      expect(
        database.raw
          .prepare(
            `SELECT 1 AS present
             FROM scenario_personas
             WHERE scenario_id = ? AND persona_id = ?`,
          )
          .get(DEFAULT_INITIAL_SCENARIO_ID, "persona_wang_qiang"),
      ).toBeUndefined();
      expect(
        database.raw
          .prepare("SELECT 1 AS present FROM persona_presets WHERE id = ?")
          .get(missingPresetId),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("rolls back all starter data when a later write fails", () => {
    const database = createDatabase();
    try {
      database.raw.exec(`
        CREATE TRIGGER reject_initial_persona
        BEFORE INSERT ON personas
        WHEN NEW.id = 'persona_lin_yue'
        BEGIN
          SELECT RAISE(ABORT, 'forced initializer failure');
        END;
      `);

      expect(() => initializeCatalogData(database)).toThrow(
        "forced initializer failure",
      );
      expect(
        database.raw
          .prepare("SELECT COUNT(*) AS count FROM persona_presets")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database.raw.prepare("SELECT COUNT(*) AS count FROM personas").get(),
      ).toEqual({ count: 1 });
      expect(
        database.raw
          .prepare("SELECT COUNT(*) AS count FROM scenario_personas")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it("rejects an oversized missing link and rolls back other seed repairs", () => {
    const database = createDatabase();
    try {
      initializeCatalogData(database);
      const repository = new CatalogRepository(database);
      database.raw
        .prepare(
          `DELETE FROM scenario_personas
           WHERE scenario_id = ? AND persona_id = ?`,
        )
        .run(DEFAULT_INITIAL_SCENARIO_ID, "persona_lin_yue");

      const currentPersona = repository.getPersona("persona_lin_yue");
      expect(currentPersona).not.toBeNull();
      if (!currentPersona) throw new Error("Expected initialized persona.");
      const editedPersona = repository.updatePersona(currentPersona.id, {
        name: currentPersona.name,
        gender: currentPersona.gender,
        age: currentPersona.age,
        occupation: "职".repeat(120),
        identity: "身".repeat(240),
        background: "背".repeat(2_000),
        personalityTraits: Array.from({ length: 12 }, (_, index) =>
          String(index).padEnd(160, "性"),
        ),
        communicationStyle: "沟".repeat(500),
        behaviorNotes: "行".repeat(2_000),
        motivations: Array.from({ length: 10 }, (_, index) =>
          String(index).padEnd(160, "动"),
        ),
        concerns: Array.from({ length: 10 }, (_, index) =>
          String(index).padEnd(160, "虑"),
        ),
        voice: currentPersona.voice,
      });
      expect(editedPersona).not.toBeNull();
      if (!editedPersona) throw new Error("Expected persona update to succeed.");

      const currentScenario = repository.getScenario(
        DEFAULT_INITIAL_SCENARIO_ID,
      );
      expect(currentScenario).not.toBeNull();
      if (!currentScenario) throw new Error("Expected initialized scenario.");
      expect(currentScenario.allowedPersonaIds).not.toContain(
        "persona_lin_yue",
      );
      const editedScenario = repository.updateScenario(currentScenario.id, {
        name: currentScenario.name,
        description: "场".repeat(2_000),
        goals: currentScenario.goals,
        suggestedSkillFocus: currentScenario.suggestedSkillFocus,
        successCriteria: currentScenario.successCriteria,
        scoringCriteria: currentScenario.scoringCriteria,
        allowedPersonaIds: currentScenario.allowedPersonaIds,
        voiceBehavior: currentScenario.voiceBehavior,
      });
      expect(editedScenario).not.toBeNull();
      if (!editedScenario) throw new Error("Expected scenario update to succeed.");
      expect(
        findRolePlayInstructionsLengthIssue({
          persona: editedPersona,
          scenario: editedScenario,
        }),
      ).toMatchObject({ maximumLength: 12_000 });

      const missingPresetId = "preset_concern_hidden_fees";
      expect(
        database.raw
          .prepare("DELETE FROM persona_presets WHERE id = ?")
          .run(missingPresetId).changes,
      ).toBe(1);

      expect(() => initializeCatalogData(database)).toThrow(
        CatalogInitializationInstructionsTooLongError,
      );

      expect(
        database.raw
          .prepare("SELECT 1 AS present FROM persona_presets WHERE id = ?")
          .get(missingPresetId),
      ).toBeUndefined();
      expect(
        database.raw
          .prepare(
            `SELECT 1 AS present
             FROM scenario_personas
             WHERE scenario_id = ? AND persona_id = ?`,
          )
          .get(DEFAULT_INITIAL_SCENARIO_ID, "persona_lin_yue"),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
