import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INITIAL_CATALOG_PERSONAS,
  INITIAL_CATALOG_SCENARIOS,
  INITIAL_PERSONA_PRESETS,
  INITIAL_SCENARIO_PRESETS,
  initializeCatalogData,
} from "../../src/server/catalog/catalog-initializer";
import { CatalogRepository } from "../../src/server/catalog/catalog-repository";
import { ApplicationDatabase } from "../../src/server/database/database";
import { CATALOG_DATABASE_MIGRATIONS } from "../../src/server/database/split-database-migrations";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDatabase(): ApplicationDatabase {
  const directory = mkdtempSync(join(tmpdir(), "role-player-initializer-"));
  directories.push(directory);
  const database = new ApplicationDatabase({
    path: join(directory, "catalog.sqlite"),
    migrations: CATALOG_DATABASE_MIGRATIONS,
  });
  database.open();
  return database;
}

describe("initializeCatalogData", () => {
  it("loads every localized business value from JSON-backed definitions", () => {
    expect(INITIAL_PERSONA_PRESETS.length).toBeGreaterThan(20);
    expect(INITIAL_SCENARIO_PRESETS.length).toBeGreaterThan(10);
    for (const preset of [...INITIAL_PERSONA_PRESETS, ...INITIAL_SCENARIO_PRESETS]) {
      expect(preset.value.trim()).not.toBe("");
      expect(preset.valueZhCn.trim()).not.toBe("");
    }
    expect(INITIAL_PERSONA_PRESETS.filter(({ category }) => category === "occupation").length)
      .toBeGreaterThanOrEqual(20);
    expect(INITIAL_PERSONA_PRESETS.some(({ category }) => category === "identity" as never))
      .toBe(false);
  });

  it("inserts starter data and is idempotent", () => {
    const database = createDatabase();
    try {
      const first = initializeCatalogData(database);
      expect(first).toMatchObject({
        presetRowsInserted: INITIAL_PERSONA_PRESETS.length,
        scenarioPresetRowsInserted: INITIAL_SCENARIO_PRESETS.length,
        personaRowsInserted: INITIAL_CATALOG_PERSONAS.length,
        scenarioRowsInserted: INITIAL_CATALOG_SCENARIOS.length,
      });
      const second = initializeCatalogData(database);
      expect(second).toMatchObject({
        presetRowsInserted: 0,
        presetRowsSkipped: INITIAL_PERSONA_PRESETS.length,
        scenarioPresetRowsInserted: 0,
        scenarioPresetRowsSkipped: INITIAL_SCENARIO_PRESETS.length,
        personaRowsInserted: 0,
        personaRowsSkipped: INITIAL_CATALOG_PERSONAS.length,
        scenarioRowsInserted: 0,
        scenarioRowsSkipped: INITIAL_CATALOG_SCENARIOS.length,
      });
      expect(new CatalogRepository(database).listCatalog()).toMatchObject({
        personas: expect.arrayContaining([
          expect.objectContaining({ id: expect.any(Number), name: "Alex", nameZhCn: "亚历克斯" }),
          expect.objectContaining({ id: expect.any(Number), name: "Lin Yue", nameZhCn: "林悦" }),
        ]),
      });
      expect(
        new CatalogRepository(database)
          .listCatalog()
          .personas.every(
            ({ createdAt, updatedAt }) =>
              createdAt.endsWith("+08:00") && updatedAt.endsWith("+08:00"),
          ),
      ).toBe(true);
    } finally {
      database.close();
    }
  });

  it("does not overwrite administrator edits on repeated runs", () => {
    const database = createDatabase();
    try {
      initializeCatalogData(database);
      database.raw.prepare(
        `UPDATE persona_occupation_presets
         SET occupation = ?, occupation_zh_cn = ?
         WHERE seed_key = ?`,
      ).run("Custom occupation", "自定义职业", "occupation_sales_director");
      initializeCatalogData(database);
      expect(database.raw.prepare(
        `SELECT occupation, occupation_zh_cn
         FROM persona_occupation_presets
         WHERE seed_key = ?`,
      ).get("occupation_sales_director")).toEqual({
        occupation: "Custom occupation",
        occupation_zh_cn: "自定义职业",
      });
    } finally {
      database.close();
    }
  });

  it("writes bilingual starter content to independent physical columns", () => {
    const database = createDatabase();
    try {
      initializeCatalogData(database);
      expect(database.raw.prepare(
        `SELECT p.name, p.name_zh_cn,
                occupation.occupation, occupation.occupation_zh_cn,
                communication.communication_style,
                communication.communication_style_zh_cn
         FROM personas AS p
         JOIN persona_occupation_presets AS occupation
           ON occupation.id = p.occupation_preset_id
         JOIN persona_communication_style_presets AS communication
           ON communication.id = p.communication_style_preset_id
         WHERE p.seed_key = ?`,
      ).get("persona_lin_yue")).toEqual({
        name: "Lin Yue",
        name_zh_cn: "林悦",
        occupation: "Marketing Director",
        occupation_zh_cn: "市场总监",
        communication_style: expect.any(String),
        communication_style_zh_cn: expect.any(String),
      });
      expect(database.raw.prepare(
        `SELECT name, name_zh_cn, description, description_zh_cn
         FROM scenarios WHERE seed_key = ?`,
      ).get("scenario_sales_discovery")).toEqual({
        name: "Sales discovery call",
        name_zh_cn: "销售需求探索",
        description: expect.any(String),
        description_zh_cn: expect.any(String),
      });
      expect(database.raw.prepare(
        `SELECT occupation, occupation_zh_cn
         FROM persona_occupation_presets WHERE seed_key = ?`,
      ).get("occupation_sales_director")).toEqual({
        occupation: "Sales Director",
        occupation_zh_cn: "销售总监",
      });
    } finally {
      database.close();
    }
  });

  it("rolls back all writes if a later insert fails", () => {
    const database = createDatabase();
    try {
      database.raw.exec(`
        CREATE TRIGGER reject_seed_persona
        BEFORE INSERT ON personas
        WHEN NEW.seed_key = 'persona_lin_yue'
        BEGIN
          SELECT RAISE(ABORT, 'forced failure');
        END;
      `);
      expect(() => initializeCatalogData(database)).toThrow("forced failure");
      expect(database.raw.prepare(
        "SELECT COUNT(*) AS count FROM persona_occupation_presets",
      ).get())
        .toEqual({ count: 0 });
      expect(database.raw.prepare("SELECT COUNT(*) AS count FROM personas").get())
        .toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});
