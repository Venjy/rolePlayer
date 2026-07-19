import type {
  PersonaPresetCategory,
  ScenarioPresetCategory,
} from "../../shared/role-play-catalog";

export interface PresetTableDefinition<Category extends string = string> {
  category: Category;
  table: string;
  valueColumn: string;
  legacyTable: "persona_presets" | "scenario_presets";
}

/**
 * Each preset domain owns a physical table and domain-named bilingual columns.
 * Categories remain an API/UI concern only; they are not persisted as a
 * discriminator column.
 */
export const PERSONA_PRESET_TABLES = [
  {
    category: "occupation",
    table: "persona_occupation_presets",
    valueColumn: "occupation",
    legacyTable: "persona_presets",
  },
  {
    category: "personality_trait",
    table: "persona_personality_trait_presets",
    valueColumn: "personality_trait",
    legacyTable: "persona_presets",
  },
  {
    category: "communication_style",
    table: "persona_communication_style_presets",
    valueColumn: "communication_style",
    legacyTable: "persona_presets",
  },
  {
    category: "tone_style",
    table: "persona_tone_style_presets",
    valueColumn: "tone_style",
    legacyTable: "persona_presets",
  },
  {
    category: "motivation",
    table: "persona_motivation_presets",
    valueColumn: "motivation",
    legacyTable: "persona_presets",
  },
  {
    category: "concern",
    table: "persona_concern_presets",
    valueColumn: "concern",
    legacyTable: "persona_presets",
  },
] as const satisfies readonly PresetTableDefinition<PersonaPresetCategory>[];

export const SCENARIO_PRESET_TABLES = [
  {
    category: "training_goal",
    table: "scenario_training_goal_presets",
    valueColumn: "training_goal",
    legacyTable: "scenario_presets",
  },
  {
    category: "skill_focus",
    table: "scenario_skill_focus_presets",
    valueColumn: "skill_focus",
    legacyTable: "scenario_presets",
  },
  {
    category: "success_criterion",
    table: "scenario_success_criterion_presets",
    valueColumn: "success_criterion",
    legacyTable: "scenario_presets",
  },
] as const satisfies readonly PresetTableDefinition<ScenarioPresetCategory>[];

export const ALL_PRESET_TABLES: readonly PresetTableDefinition[] = [
  ...PERSONA_PRESET_TABLES,
  ...SCENARIO_PRESET_TABLES,
];

export const PERSONA_PRESET_TABLE_BY_CATEGORY = Object.fromEntries(
  PERSONA_PRESET_TABLES.map((definition) => [
    definition.category,
    definition,
  ]),
) as Record<PersonaPresetCategory, (typeof PERSONA_PRESET_TABLES)[number]>;

export const SCENARIO_PRESET_TABLE_BY_CATEGORY = Object.fromEntries(
  SCENARIO_PRESET_TABLES.map((definition) => [
    definition.category,
    definition,
  ]),
) as Record<ScenarioPresetCategory, (typeof SCENARIO_PRESET_TABLES)[number]>;

/**
 * Appended to both the historical combined chain and the catalog-only chain.
 * It preserves IDs and initializer keys while removing both discriminator
 * tables from the current schema.
 */
export const SPLIT_PRESET_TABLES_MIGRATION_SQL = `
  ${ALL_PRESET_TABLES.map(createPresetTableAndCopySql).join("\n")}

  DROP TABLE persona_presets;
  DROP TABLE scenario_presets;
`;

function createPresetTableAndCopySql(
  definition: PresetTableDefinition,
): string {
  const { category, table, valueColumn, legacyTable } = definition;
  const chineseColumn = `${valueColumn}_zh_cn`;
  return `
    CREATE TABLE ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seed_key TEXT UNIQUE
        CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
      ${valueColumn} TEXT NOT NULL DEFAULT '' CHECK (length(${valueColumn}) <= 500),
      ${chineseColumn} TEXT NOT NULL DEFAULT '' CHECK (length(${chineseColumn}) <= 500),
      position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        length(trim(${valueColumn})) > 0
        OR length(trim(${chineseColumn})) > 0
      )
    ) STRICT;

    CREATE UNIQUE INDEX ${table}_value_en_idx
      ON ${table}(${valueColumn} COLLATE NOCASE)
      WHERE length(trim(${valueColumn})) > 0;
    CREATE UNIQUE INDEX ${table}_value_zh_cn_idx
      ON ${table}(${chineseColumn} COLLATE NOCASE)
      WHERE length(trim(${chineseColumn})) > 0;

    INSERT INTO ${table} (
      id, seed_key, ${valueColumn}, ${chineseColumn},
      position, created_at, updated_at
    )
    SELECT
      id, seed_key, value, value_zh_cn,
      position, created_at, updated_at
    FROM ${legacyTable}
    WHERE category = '${category}';
  `;
}
