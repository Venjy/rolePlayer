import type { DatabaseSync } from "node:sqlite";
import { formatDatabaseTimestamp } from "./database-time";
import {
  PERSONA_PRESET_TABLE_BY_CATEGORY,
  SCENARIO_PRESET_TABLE_BY_CATEGORY,
  type PresetTableDefinition,
} from "./preset-storage";

interface LegacyPersonaRow {
  id: number;
  seed_key: string | null;
  name: string;
  name_zh_cn: string;
  gender: string;
  age: number | null;
  occupation: string;
  occupation_zh_cn: string;
  background: string;
  background_zh_cn: string;
  personality_traits_json: string;
  personality_traits_zh_cn_json: string;
  communication_style: string;
  communication_style_zh_cn: string;
  tone_style: string;
  tone_style_zh_cn: string;
  behavior_notes: string;
  behavior_notes_zh_cn: string;
  motivations_json: string;
  motivations_zh_cn_json: string;
  concerns_json: string;
  concerns_zh_cn_json: string;
  voice: string;
  interrupt_frequency: string;
  speaking_pace: string;
  created_at: string;
  updated_at: string;
}

interface LegacyScenarioRow {
  id: number;
  seed_key: string | null;
  name: string;
  name_zh_cn: string;
  description: string;
  description_zh_cn: string;
  goals_json: string;
  goals_zh_cn_json: string;
  suggested_skill_focus_json: string;
  suggested_skill_focus_zh_cn_json: string;
  success_criteria_json: string;
  success_criteria_zh_cn_json: string;
  created_at: string;
  updated_at: string;
}

interface LegacyScoringRow {
  scenario_id: number;
  position: number;
  name: string;
  name_zh_cn: string;
  weight: number;
}

interface LegacyCompatibilityRow {
  scenario_id: number;
  persona_id: number;
  position: number;
  created_at: string;
}

interface PresetValueRow {
  id: number;
  value: string;
  value_zh_cn: string;
}

interface ResolvedPersonaReferences {
  occupationPresetId: number;
  personalityTraitPresetIds: number[];
  communicationStylePresetId: number;
  toneStylePresetId: number;
  motivationPresetIds: number[];
  concernPresetIds: number[];
}

interface ResolvedScenarioReferences {
  trainingGoalPresetIds: number[];
  skillFocusPresetIds: number[];
  successCriteria: Array<{ presetId: number; weight: number }>;
}

/**
 * Converts duplicated localized preset values on catalog records into foreign
 * keys. Unmatched historical values are promoted to custom preset rows first,
 * so upgrades do not silently discard user-created catalog content.
 */
export function migrateCatalogRecordsToPresetReferences(
  database: DatabaseSync,
): void {
  const personas = database.prepare("SELECT * FROM personas ORDER BY id").all() as
    unknown as LegacyPersonaRow[];
  const scenarios = database.prepare("SELECT * FROM scenarios ORDER BY id").all() as
    unknown as LegacyScenarioRow[];
  const scoringRows = database
    .prepare(
      `SELECT scenario_id, position, name, name_zh_cn, weight
       FROM scenario_scoring_criteria
       ORDER BY scenario_id, position`,
    )
    .all() as unknown as LegacyScoringRow[];
  const compatibilityRows = database
    .prepare(
      `SELECT scenario_id, persona_id, position, created_at
       FROM scenario_personas
       ORDER BY scenario_id, position`,
    )
    .all() as unknown as LegacyCompatibilityRow[];

  const personaReferences = new Map<number, ResolvedPersonaReferences>();
  for (const persona of personas) {
    personaReferences.set(persona.id, {
      occupationPresetId: resolveOrCreatePreset(
        database,
        PERSONA_PRESET_TABLE_BY_CATEGORY.occupation,
        persona.occupation,
        persona.occupation_zh_cn,
      ),
      personalityTraitPresetIds: resolveLocalizedLists(
        database,
        PERSONA_PRESET_TABLE_BY_CATEGORY.personality_trait,
        persona.personality_traits_json,
        persona.personality_traits_zh_cn_json,
      ),
      communicationStylePresetId: resolveOrCreatePreset(
        database,
        PERSONA_PRESET_TABLE_BY_CATEGORY.communication_style,
        persona.communication_style,
        persona.communication_style_zh_cn,
      ),
      toneStylePresetId: resolveOrCreatePreset(
        database,
        PERSONA_PRESET_TABLE_BY_CATEGORY.tone_style,
        persona.tone_style,
        persona.tone_style_zh_cn,
      ),
      motivationPresetIds: resolveLocalizedLists(
        database,
        PERSONA_PRESET_TABLE_BY_CATEGORY.motivation,
        persona.motivations_json,
        persona.motivations_zh_cn_json,
      ),
      concernPresetIds: resolveLocalizedLists(
        database,
        PERSONA_PRESET_TABLE_BY_CATEGORY.concern,
        persona.concerns_json,
        persona.concerns_zh_cn_json,
      ),
    });
  }

  const scoringByScenario = new Map<number, LegacyScoringRow[]>();
  for (const scoring of scoringRows) {
    const rows = scoringByScenario.get(scoring.scenario_id) ?? [];
    rows.push(scoring);
    scoringByScenario.set(scoring.scenario_id, rows);
  }
  const scenarioReferences = new Map<number, ResolvedScenarioReferences>();
  for (const scenario of scenarios) {
    const successIds = resolveLocalizedLists(
      database,
      SCENARIO_PRESET_TABLE_BY_CATEGORY.success_criterion,
      scenario.success_criteria_json,
      scenario.success_criteria_zh_cn_json,
    );
    const scoring = scoringByScenario.get(scenario.id) ?? [];
    if (scoring.length !== 0 && scoring.length !== successIds.length) {
      throw new Error(
        `Scenario ${scenario.id} has ${successIds.length} success criteria but ${scoring.length} scoring weights.`,
      );
    }
    const weights =
      scoring.length === successIds.length
        ? scoring.map(({ weight }) => weight)
        : distributeWeights(successIds.length);
    scenarioReferences.set(scenario.id, {
      trainingGoalPresetIds: resolveLocalizedLists(
        database,
        SCENARIO_PRESET_TABLE_BY_CATEGORY.training_goal,
        scenario.goals_json,
        scenario.goals_zh_cn_json,
      ),
      skillFocusPresetIds: resolveLocalizedLists(
        database,
        SCENARIO_PRESET_TABLE_BY_CATEGORY.skill_focus,
        scenario.suggested_skill_focus_json,
        scenario.suggested_skill_focus_zh_cn_json,
      ),
      successCriteria: successIds.map((presetId, position) => ({
        presetId,
        weight: weights[position] ?? 0,
      })),
    });
  }

  rebuildCatalogTables(
    database,
    personas,
    scenarios,
    compatibilityRows,
    personaReferences,
    scenarioReferences,
  );
}

function resolveLocalizedLists(
  database: DatabaseSync,
  storage: PresetTableDefinition,
  englishJson: string,
  chineseJson: string,
): number[] {
  const english = parseStringList(englishJson);
  const chinese = parseStringList(chineseJson);
  return Array.from({ length: Math.max(english.length, chinese.length) }, (_, index) =>
    resolveOrCreatePreset(
      database,
      storage,
      english[index] ?? "",
      chinese[index] ?? "",
    ),
  );
}

function resolveOrCreatePreset(
  database: DatabaseSync,
  storage: PresetTableDefinition,
  english: string,
  chinese: string,
): number {
  const englishValue = english.trim();
  const chineseValue = chinese.trim();
  if (!englishValue && !chineseValue) {
    throw new Error(`An empty historical value cannot reference ${storage.table}.`);
  }
  const chineseColumn = `${storage.valueColumn}_zh_cn`;
  const rows = database
    .prepare(
      `SELECT id, ${storage.valueColumn} AS value, ${chineseColumn} AS value_zh_cn
       FROM ${storage.table}`,
    )
    .all() as unknown as PresetValueRow[];
  const englishMatch = englishValue
    ? rows.find(({ value }) => equalLocalizedValue(value, englishValue))
    : undefined;
  const chineseMatch = chineseValue
    ? rows.find(({ value_zh_cn }) => equalLocalizedValue(value_zh_cn, chineseValue))
    : undefined;
  if (englishMatch && chineseMatch && englishMatch.id !== chineseMatch.id) {
    throw new Error(
      `Historical values "${englishValue}" and "${chineseValue}" map to different rows in ${storage.table}.`,
    );
  }
  const match = englishMatch ?? chineseMatch;
  if (match) return match.id;

  const maximum = database
    .prepare(`SELECT MAX(position) AS position FROM ${storage.table}`)
    .get() as { position: number | null };
  const timestamp = formatDatabaseTimestamp();
  const write = database
    .prepare(
      `INSERT INTO ${storage.table} (
        seed_key, ${storage.valueColumn}, ${chineseColumn},
        position, created_at, updated_at
      ) VALUES (NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      englishValue,
      chineseValue,
      (maximum.position ?? -1) + 1,
      timestamp,
      timestamp,
    );
  return Number(write.lastInsertRowid);
}

function rebuildCatalogTables(
  database: DatabaseSync,
  personas: readonly LegacyPersonaRow[],
  scenarios: readonly LegacyScenarioRow[],
  compatibilityRows: readonly LegacyCompatibilityRow[],
  personaReferences: ReadonlyMap<number, ResolvedPersonaReferences>,
  scenarioReferences: ReadonlyMap<number, ResolvedScenarioReferences>,
): void {
  database.exec(`
    DROP INDEX personas_name_en_idx;
    DROP INDEX personas_name_zh_cn_idx;
    DROP INDEX scenarios_name_en_idx;
    DROP INDEX scenarios_name_zh_cn_idx;
    DROP INDEX scenario_personas_persona_id_idx;
    DROP INDEX scenario_personas_scenario_position_idx;
    ALTER TABLE scenario_personas RENAME TO scenario_personas_before_preset_references;
    ALTER TABLE scenario_scoring_criteria RENAME TO scenario_scoring_criteria_before_preset_references;
    ALTER TABLE personas RENAME TO personas_before_preset_references;
    ALTER TABLE scenarios RENAME TO scenarios_before_preset_references;

    CREATE TABLE personas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seed_key TEXT UNIQUE CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
      name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 80),
      name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 80),
      gender TEXT NOT NULL CHECK (gender IN ('female', 'male', 'non_binary', 'unspecified')),
      age INTEGER CHECK (age IS NULL OR age BETWEEN 1 AND 120),
      occupation_preset_id INTEGER NOT NULL,
      background TEXT NOT NULL DEFAULT '' CHECK (length(background) <= 2000),
      background_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(background_zh_cn) <= 2000),
      communication_style_preset_id INTEGER NOT NULL,
      tone_style_preset_id INTEGER NOT NULL,
      behavior_notes TEXT NOT NULL DEFAULT '' CHECK (length(behavior_notes) <= 2000),
      behavior_notes_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(behavior_notes_zh_cn) <= 2000),
      voice TEXT NOT NULL CHECK (voice IN ('longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng')),
      interrupt_frequency TEXT NOT NULL CHECK (interrupt_frequency IN ('low', 'medium', 'high')),
      speaking_pace TEXT NOT NULL CHECK (speaking_pace IN ('slow', 'normal', 'fast')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (length(trim(name)) > 0 OR length(trim(name_zh_cn)) > 0),
      FOREIGN KEY (occupation_preset_id) REFERENCES persona_occupation_presets(id) ON DELETE RESTRICT,
      FOREIGN KEY (communication_style_preset_id) REFERENCES persona_communication_style_presets(id) ON DELETE RESTRICT,
      FOREIGN KEY (tone_style_preset_id) REFERENCES persona_tone_style_presets(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE UNIQUE INDEX personas_name_en_idx ON personas(name COLLATE NOCASE) WHERE length(trim(name)) > 0;
    CREATE UNIQUE INDEX personas_name_zh_cn_idx ON personas(name_zh_cn COLLATE NOCASE) WHERE length(trim(name_zh_cn)) > 0;

    CREATE TABLE persona_personality_traits (
      persona_id INTEGER NOT NULL,
      personality_trait_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (persona_id, personality_trait_preset_id),
      UNIQUE (persona_id, position),
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
      FOREIGN KEY (personality_trait_preset_id) REFERENCES persona_personality_trait_presets(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE TABLE persona_motivations (
      persona_id INTEGER NOT NULL,
      motivation_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (persona_id, motivation_preset_id),
      UNIQUE (persona_id, position),
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
      FOREIGN KEY (motivation_preset_id) REFERENCES persona_motivation_presets(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE TABLE persona_concerns (
      persona_id INTEGER NOT NULL,
      concern_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (persona_id, concern_preset_id),
      UNIQUE (persona_id, position),
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
      FOREIGN KEY (concern_preset_id) REFERENCES persona_concern_presets(id) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seed_key TEXT UNIQUE CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
      name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
      name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 120),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
      description_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(description_zh_cn) <= 2000),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (length(trim(name)) > 0 OR length(trim(name_zh_cn)) > 0),
      CHECK (length(trim(description)) > 0 OR length(trim(description_zh_cn)) > 0)
    ) STRICT;
    CREATE UNIQUE INDEX scenarios_name_en_idx ON scenarios(name COLLATE NOCASE) WHERE length(trim(name)) > 0;
    CREATE UNIQUE INDEX scenarios_name_zh_cn_idx ON scenarios(name_zh_cn COLLATE NOCASE) WHERE length(trim(name_zh_cn)) > 0;

    CREATE TABLE scenario_training_goals (
      scenario_id INTEGER NOT NULL,
      training_goal_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (scenario_id, training_goal_preset_id),
      UNIQUE (scenario_id, position),
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
      FOREIGN KEY (training_goal_preset_id) REFERENCES scenario_training_goal_presets(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE TABLE scenario_skill_focuses (
      scenario_id INTEGER NOT NULL,
      skill_focus_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (scenario_id, skill_focus_preset_id),
      UNIQUE (scenario_id, position),
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_focus_preset_id) REFERENCES scenario_skill_focus_presets(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE TABLE scenario_success_criteria (
      scenario_id INTEGER NOT NULL,
      success_criterion_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      weight INTEGER NOT NULL CHECK (weight BETWEEN 0 AND 100),
      PRIMARY KEY (scenario_id, success_criterion_preset_id),
      UNIQUE (scenario_id, position),
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
      FOREIGN KEY (success_criterion_preset_id) REFERENCES scenario_success_criterion_presets(id) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE scenario_personas (
      scenario_id INTEGER NOT NULL,
      persona_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      created_at TEXT NOT NULL,
      PRIMARY KEY (scenario_id, persona_id),
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX scenario_personas_persona_id_idx ON scenario_personas(persona_id);
    CREATE UNIQUE INDEX scenario_personas_scenario_position_idx ON scenario_personas(scenario_id, position);
  `);

  const insertPersona = database.prepare(`
    INSERT INTO personas (
      id, seed_key, name, name_zh_cn, gender, age, occupation_preset_id,
      background, background_zh_cn, communication_style_preset_id,
      tone_style_preset_id, behavior_notes, behavior_notes_zh_cn, voice,
      interrupt_frequency, speaking_pace, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTrait = database.prepare(
    "INSERT INTO persona_personality_traits (persona_id, personality_trait_preset_id, position) VALUES (?, ?, ?)",
  );
  const insertMotivation = database.prepare(
    "INSERT INTO persona_motivations (persona_id, motivation_preset_id, position) VALUES (?, ?, ?)",
  );
  const insertConcern = database.prepare(
    "INSERT INTO persona_concerns (persona_id, concern_preset_id, position) VALUES (?, ?, ?)",
  );
  for (const persona of personas) {
    const references = requireMapValue(personaReferences, persona.id, "persona");
    insertPersona.run(
      persona.id, persona.seed_key, persona.name, persona.name_zh_cn,
      persona.gender, persona.age, references.occupationPresetId,
      persona.background, persona.background_zh_cn,
      references.communicationStylePresetId, references.toneStylePresetId,
      persona.behavior_notes, persona.behavior_notes_zh_cn, persona.voice,
      persona.interrupt_frequency, persona.speaking_pace,
      persona.created_at, persona.updated_at,
    );
    insertOrderedReferences(insertTrait, persona.id, references.personalityTraitPresetIds);
    insertOrderedReferences(insertMotivation, persona.id, references.motivationPresetIds);
    insertOrderedReferences(insertConcern, persona.id, references.concernPresetIds);
  }

  const insertScenario = database.prepare(`
    INSERT INTO scenarios (
      id, seed_key, name, name_zh_cn, description, description_zh_cn,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGoal = database.prepare(
    "INSERT INTO scenario_training_goals (scenario_id, training_goal_preset_id, position) VALUES (?, ?, ?)",
  );
  const insertSkill = database.prepare(
    "INSERT INTO scenario_skill_focuses (scenario_id, skill_focus_preset_id, position) VALUES (?, ?, ?)",
  );
  const insertSuccess = database.prepare(
    "INSERT INTO scenario_success_criteria (scenario_id, success_criterion_preset_id, position, weight) VALUES (?, ?, ?, ?)",
  );
  for (const scenario of scenarios) {
    const references = requireMapValue(scenarioReferences, scenario.id, "scenario");
    insertScenario.run(
      scenario.id, scenario.seed_key, scenario.name, scenario.name_zh_cn,
      scenario.description, scenario.description_zh_cn,
      scenario.created_at, scenario.updated_at,
    );
    insertOrderedReferences(insertGoal, scenario.id, references.trainingGoalPresetIds);
    insertOrderedReferences(insertSkill, scenario.id, references.skillFocusPresetIds);
    references.successCriteria.forEach((criterion, position) => {
      insertSuccess.run(scenario.id, criterion.presetId, position, criterion.weight);
    });
  }

  const insertCompatibility = database.prepare(
    "INSERT INTO scenario_personas (scenario_id, persona_id, position, created_at) VALUES (?, ?, ?, ?)",
  );
  for (const row of compatibilityRows) {
    insertCompatibility.run(row.scenario_id, row.persona_id, row.position, row.created_at);
  }

  database.exec(`
    DROP TABLE scenario_personas_before_preset_references;
    DROP TABLE scenario_scoring_criteria_before_preset_references;
    DROP TABLE personas_before_preset_references;
    DROP TABLE scenarios_before_preset_references;
  `);
}

function insertOrderedReferences(
  statement: ReturnType<DatabaseSync["prepare"]>,
  ownerId: number,
  presetIds: readonly number[],
): void {
  presetIds.forEach((presetId, position) => statement.run(ownerId, presetId, position));
}

function requireMapValue<T>(
  values: ReadonlyMap<number, T>,
  id: number,
  entity: string,
): T {
  const value = values.get(id);
  if (!value) throw new Error(`Missing resolved ${entity} references for ${id}.`);
  return value;
}

function parseStringList(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Historical preset values must be JSON string arrays.");
  }
  return parsed.map((item) => item.trim());
}

function equalLocalizedValue(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
}

function distributeWeights(count: number): number[] {
  if (count === 0) return [];
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from({ length: count }, (_, index) =>
    index >= count - remainder ? base + 1 : base,
  );
}
