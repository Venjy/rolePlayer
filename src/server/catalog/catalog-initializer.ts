import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type {
  PersonaInput,
  PersonaPresetCategory,
  ScenarioInput,
  ScenarioPresetCategory,
} from "../../shared/role-play-catalog";
import {
  MAX_SCENARIO_PERSONAS,
  personaGenderSchema,
  personaInputSchema,
  personaPresetSchema,
  scenarioInputSchema,
  scenarioPresetSchema,
  voiceBehaviorSchema,
} from "../../shared/role-play-catalog";
import { findRolePlayInstructionsLengthIssue } from "../../shared/role-play-instructions";
import {
  localizePersonaInput,
  localizeScenarioInput,
} from "../../shared/role-play-localization";
import {
  resolvePersonaPresetReferences,
  resolveScenarioPresetReferences,
} from "../../shared/role-play-preset-resolution";
import { qwenVoiceSchema } from "../../shared/realtime-protocol";
import type { ApplicationDatabase } from "../database/database";
import { formatDatabaseTimestamp } from "../database/database-time";
import {
  PERSONA_PRESET_TABLE_BY_CATEGORY,
  SCENARIO_PRESET_TABLE_BY_CATEGORY,
  type PresetTableDefinition,
} from "../database/preset-storage";
import personaCommunicationStyleData from "./initial-data/persona-communication-styles.json";
import personaConcernData from "./initial-data/persona-concerns.json";
import personaMotivationData from "./initial-data/persona-motivations.json";
import personaOccupationData from "./initial-data/persona-occupations.json";
import personaPersonalityTraitData from "./initial-data/persona-personality-traits.json";
import personaToneStyleData from "./initial-data/persona-tone-styles.json";
import personaData from "./initial-data/personas.json";
import scenarioSkillFocusData from "./initial-data/scenario-skill-focuses.json";
import scenarioSuccessCriterionData from "./initial-data/scenario-success-criteria.json";
import scenarioTrainingGoalData from "./initial-data/scenario-training-goals.json";
import scenarioData from "./initial-data/scenarios.json";

export interface CatalogInitializationResult {
  presetRowsInserted: number;
  presetRowsSkipped: number;
  scenarioPresetRowsInserted: number;
  scenarioPresetRowsSkipped: number;
  personaRowsInserted: number;
  personaRowsSkipped: number;
  scenarioRowsInserted: number;
  scenarioRowsSkipped: number;
  scenarioLinksInserted: number;
  scenarioLinksSkipped: number;
}

interface StarterPreset {
  key: string;
  category: PersonaPresetCategory | ScenarioPresetCategory;
  value: string;
  valueZhCn: string;
  position: number;
}

interface StarterPresetJson {
  key: string;
  value: string;
  valueZhCn: string;
  position: number;
}

const starterKeySchema = z.string().trim().min(1).max(100);
const localizedOptionalText = (maximum: number) => z.string().trim().max(maximum);

const starterPersonaInputSchema = z.object({
  name: localizedOptionalText(80),
  nameZhCn: localizedOptionalText(80),
  gender: personaGenderSchema,
  age: z.number().int().min(1).max(120).nullable(),
  occupationPresetKey: starterKeySchema,
  background: localizedOptionalText(2_000),
  backgroundZhCn: localizedOptionalText(2_000),
  personalityTraitPresetKeys: z.array(starterKeySchema).min(1).max(12),
  communicationStylePresetKey: starterKeySchema,
  toneStylePresetKey: starterKeySchema,
  behaviorNotes: localizedOptionalText(2_000),
  behaviorNotesZhCn: localizedOptionalText(2_000),
  motivationPresetKeys: z.array(starterKeySchema).max(10),
  concernPresetKeys: z.array(starterKeySchema).max(10),
  voice: qwenVoiceSchema,
  voiceBehavior: voiceBehaviorSchema,
});

const starterScenarioInputSchema = z.object({
  name: localizedOptionalText(120),
  nameZhCn: localizedOptionalText(120),
  description: localizedOptionalText(2_000),
  descriptionZhCn: localizedOptionalText(2_000),
  trainingGoalPresetKeys: z.array(starterKeySchema).min(1).max(10),
  skillFocusPresetKeys: z.array(starterKeySchema).min(1).max(10),
  successCriteria: z.array(z.object({
    presetKey: starterKeySchema,
    weight: z.number().int().min(0).max(100),
  })).min(1).max(12),
  allowedPersonaKeys: z.array(starterKeySchema).max(MAX_SCENARIO_PERSONAS),
});

interface StarterPersona {
  key: string;
  input: z.infer<typeof starterPersonaInputSchema>;
}

interface StarterScenario {
  key: string;
  input: z.infer<typeof starterScenarioInputSchema>;
}

export class CatalogInitializationInstructionsTooLongError extends Error {
  public constructor(
    public readonly personaKey: string,
    public readonly scenarioKey: string,
    public readonly actualLength: number,
  ) {
    super(
      `Starter persona "${personaKey}" and scenario "${scenarioKey}" generate Instructions that are too long (${actualLength} characters).`,
    );
    this.name = "CatalogInitializationInstructionsTooLongError";
  }
}

export class CatalogInitializationScenarioCapacityError extends Error {
  public constructor(
    public readonly scenarioKey: string,
    public readonly personaKey: string,
  ) {
    super(
      `Starter scenario "${scenarioKey}" cannot link persona "${personaKey}" because it reached ${MAX_SCENARIO_PERSONAS} compatible personas.`,
    );
    this.name = "CatalogInitializationScenarioCapacityError";
  }
}

export const DEFAULT_INITIAL_SCENARIO_KEY = "scenario_sales_discovery";
const SEED_TIMESTAMP = formatDatabaseTimestamp(0);

export const INITIAL_PERSONA_PRESETS: StarterPreset[] = [
  ...parsePresetDefinitions(personaOccupationData, "occupation", "persona"),
  ...parsePresetDefinitions(personaPersonalityTraitData, "personality_trait", "persona"),
  ...parsePresetDefinitions(personaCommunicationStyleData, "communication_style", "persona"),
  ...parsePresetDefinitions(personaToneStyleData, "tone_style", "persona"),
  ...parsePresetDefinitions(personaMotivationData, "motivation", "persona"),
  ...parsePresetDefinitions(personaConcernData, "concern", "persona"),
];
export const INITIAL_SCENARIO_PRESETS: StarterPreset[] = [
  ...parsePresetDefinitions(scenarioTrainingGoalData, "training_goal", "scenario"),
  ...parsePresetDefinitions(scenarioSkillFocusData, "skill_focus", "scenario"),
  ...parsePresetDefinitions(scenarioSuccessCriterionData, "success_criterion", "scenario"),
];
export const INITIAL_CATALOG_PERSONAS: StarterPersona[] = personaData.map((definition) => ({
  key: starterKeySchema.parse(definition.key),
  input: starterPersonaInputSchema.parse(definition.input),
}));
export const INITIAL_CATALOG_SCENARIOS: StarterScenario[] = scenarioData.map((definition) => ({
  key: starterKeySchema.parse(definition.key),
  input: starterScenarioInputSchema.parse(definition.input),
}));

assertUniqueStarterKeys();

/** Inserts JSON-defined deployment data using stable keys and generated IDs. */
export function initializeCatalogData(
  database: ApplicationDatabase,
): CatalogInitializationResult {
  const connection = database.raw;
  const timestamp = formatDatabaseTimestamp();
  const result: CatalogInitializationResult = {
    presetRowsInserted: 0,
    presetRowsSkipped: 0,
    scenarioPresetRowsInserted: 0,
    scenarioPresetRowsSkipped: 0,
    personaRowsInserted: 0,
    personaRowsSkipped: 0,
    scenarioRowsInserted: 0,
    scenarioRowsSkipped: 0,
    scenarioLinksInserted: 0,
    scenarioLinksSkipped: 0,
  };

  connection.exec("BEGIN IMMEDIATE");
  try {
    insertPresets(connection, timestamp, result);
    const personas = resolveStarterPersonas(connection);
    const scenarios = resolveStarterScenarios(connection);
    validateStarterInstructions(connection, personas, scenarios);
    insertPersonas(connection, personas, timestamp, result);
    insertScenarios(connection, scenarios, timestamp, result);
    insertScenarioLinks(connection, timestamp, result);
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

function parsePresetDefinitions(
  definitions: readonly StarterPresetJson[],
  category: PersonaPresetCategory | ScenarioPresetCategory,
  kind: "persona" | "scenario",
): StarterPreset[] {
  const schema = kind === "persona" ? personaPresetSchema : scenarioPresetSchema;
  return definitions.map((definition) => {
    const key = starterKeySchema.parse(definition.key);
    const parsed = schema.parse({
      ...definition,
      category,
      id: 1,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    });
    return {
      key,
      category: parsed.category,
      value: parsed.value,
      valueZhCn: parsed.valueZhCn,
      position: parsed.position,
    };
  });
}

function insertPresets(
  connection: DatabaseSync,
  timestamp: string,
  result: CatalogInitializationResult,
): void {
  for (const preset of INITIAL_PERSONA_PRESETS) {
    const inserted = insertPreset(
      connection,
      PERSONA_PRESET_TABLE_BY_CATEGORY[preset.category as PersonaPresetCategory],
      preset,
      timestamp,
    );
    if (inserted) result.presetRowsInserted += 1;
    else result.presetRowsSkipped += 1;
  }
  for (const preset of INITIAL_SCENARIO_PRESETS) {
    const inserted = insertPreset(
      connection,
      SCENARIO_PRESET_TABLE_BY_CATEGORY[preset.category as ScenarioPresetCategory],
      preset,
      timestamp,
    );
    if (inserted) result.scenarioPresetRowsInserted += 1;
    else result.scenarioPresetRowsSkipped += 1;
  }
}

function insertPreset(
  connection: DatabaseSync,
  storage: PresetTableDefinition,
  preset: StarterPreset,
  timestamp: string,
): boolean {
  const chineseColumn = `${storage.valueColumn}_zh_cn`;
  const write = connection
    .prepare(
      `INSERT INTO ${storage.table} (
        seed_key, ${storage.valueColumn}, ${chineseColumn},
        position, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(seed_key) DO NOTHING`,
    )
    .run(
      preset.key,
      preset.value,
      preset.valueZhCn,
      preset.position,
      timestamp,
      timestamp,
    );
  return write.changes > 0;
}

function resolveStarterPersonas(connection: DatabaseSync) {
  return INITIAL_CATALOG_PERSONAS.map(({ key, input }) => ({
    key,
    input: personaInputSchema.parse({
      name: input.name,
      nameZhCn: input.nameZhCn,
      gender: input.gender,
      age: input.age,
      occupationPresetId: readPresetSeedId(
        connection,
        PERSONA_PRESET_TABLE_BY_CATEGORY.occupation,
        input.occupationPresetKey,
      ),
      background: input.background,
      backgroundZhCn: input.backgroundZhCn,
      personalityTraitPresetIds: input.personalityTraitPresetKeys.map((presetKey) =>
        readPresetSeedId(
          connection,
          PERSONA_PRESET_TABLE_BY_CATEGORY.personality_trait,
          presetKey,
        ),
      ),
      communicationStylePresetId: readPresetSeedId(
        connection,
        PERSONA_PRESET_TABLE_BY_CATEGORY.communication_style,
        input.communicationStylePresetKey,
      ),
      toneStylePresetId: readPresetSeedId(
        connection,
        PERSONA_PRESET_TABLE_BY_CATEGORY.tone_style,
        input.toneStylePresetKey,
      ),
      behaviorNotes: input.behaviorNotes,
      behaviorNotesZhCn: input.behaviorNotesZhCn,
      motivationPresetIds: input.motivationPresetKeys.map((presetKey) =>
        readPresetSeedId(
          connection,
          PERSONA_PRESET_TABLE_BY_CATEGORY.motivation,
          presetKey,
        ),
      ),
      concernPresetIds: input.concernPresetKeys.map((presetKey) =>
        readPresetSeedId(
          connection,
          PERSONA_PRESET_TABLE_BY_CATEGORY.concern,
          presetKey,
        ),
      ),
      voice: input.voice,
      voiceBehavior: input.voiceBehavior,
    }),
  }));
}

function resolveStarterScenarios(connection: DatabaseSync) {
  return INITIAL_CATALOG_SCENARIOS.map(({ key, input }) => {
    const successCriterionPresetIds = input.successCriteria.map(({ presetKey }) =>
      readPresetSeedId(
        connection,
        SCENARIO_PRESET_TABLE_BY_CATEGORY.success_criterion,
        presetKey,
      ),
    );
    return {
      key,
      input: scenarioInputSchema.parse({
        name: input.name,
        nameZhCn: input.nameZhCn,
        description: input.description,
        descriptionZhCn: input.descriptionZhCn,
        trainingGoalPresetIds: input.trainingGoalPresetKeys.map((presetKey) =>
          readPresetSeedId(
            connection,
            SCENARIO_PRESET_TABLE_BY_CATEGORY.training_goal,
            presetKey,
          ),
        ),
        skillFocusPresetIds: input.skillFocusPresetKeys.map((presetKey) =>
          readPresetSeedId(
            connection,
            SCENARIO_PRESET_TABLE_BY_CATEGORY.skill_focus,
            presetKey,
          ),
        ),
        successCriterionPresetIds,
        scoringCriteria: input.successCriteria.map((criterion, index) => ({
          successCriterionPresetId: successCriterionPresetIds[index],
          weight: criterion.weight,
        })),
        allowedPersonaIds: [],
      }),
      allowedPersonaKeys: input.allowedPersonaKeys,
    };
  });
}

function insertPersonas(
  connection: DatabaseSync,
  personas: ReadonlyArray<{ key: string; input: PersonaInput }>,
  timestamp: string,
  result: CatalogInitializationResult,
): void {
  const find = connection.prepare("SELECT id FROM personas WHERE seed_key = ?");
  const insert = connection.prepare(`
    INSERT INTO personas (
      seed_key, name, name_zh_cn, gender, age, occupation_preset_id,
      background, background_zh_cn, communication_style_preset_id,
      tone_style_preset_id, behavior_notes, behavior_notes_zh_cn, voice,
      interrupt_frequency, speaking_pace, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(seed_key) DO NOTHING
  `);
  for (const { key, input } of personas) {
    const existing = find.get(key) as { id: number } | undefined;
    if (existing) {
      result.personaRowsSkipped += 1;
      continue;
    }
    const write = insert.run(
      key, input.name, input.nameZhCn, input.gender, input.age,
      input.occupationPresetId, input.background, input.backgroundZhCn,
      input.communicationStylePresetId, input.toneStylePresetId,
      input.behaviorNotes, input.behaviorNotesZhCn, input.voice,
      input.voiceBehavior.interruptFrequency, input.voiceBehavior.speakingPace,
      timestamp, timestamp,
    );
    if (!write.changes) {
      result.personaRowsSkipped += 1;
      continue;
    }
    const personaId = Number(write.lastInsertRowid);
    insertOrderedReferences(
      connection, "persona_personality_traits", "persona_id",
      "personality_trait_preset_id", personaId, input.personalityTraitPresetIds,
    );
    insertOrderedReferences(
      connection, "persona_motivations", "persona_id",
      "motivation_preset_id", personaId, input.motivationPresetIds,
    );
    insertOrderedReferences(
      connection, "persona_concerns", "persona_id",
      "concern_preset_id", personaId, input.concernPresetIds,
    );
    result.personaRowsInserted += 1;
  }
}

function insertScenarios(
  connection: DatabaseSync,
  scenarios: ReadonlyArray<{
    key: string;
    input: ScenarioInput;
    allowedPersonaKeys: string[];
  }>,
  timestamp: string,
  result: CatalogInitializationResult,
): void {
  const find = connection.prepare("SELECT id FROM scenarios WHERE seed_key = ?");
  const insert = connection.prepare(`
    INSERT INTO scenarios (
      seed_key, name, name_zh_cn, description, description_zh_cn,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(seed_key) DO NOTHING
  `);
  for (const { key, input } of scenarios) {
    const existing = find.get(key) as { id: number } | undefined;
    if (existing) {
      result.scenarioRowsSkipped += 1;
      continue;
    }
    const write = insert.run(
      key, input.name, input.nameZhCn, input.description,
      input.descriptionZhCn, timestamp, timestamp,
    );
    if (!write.changes) {
      result.scenarioRowsSkipped += 1;
      continue;
    }
    const scenarioId = Number(write.lastInsertRowid);
    insertOrderedReferences(
      connection, "scenario_training_goals", "scenario_id",
      "training_goal_preset_id", scenarioId, input.trainingGoalPresetIds,
    );
    insertOrderedReferences(
      connection, "scenario_skill_focuses", "scenario_id",
      "skill_focus_preset_id", scenarioId, input.skillFocusPresetIds,
    );
    const insertSuccess = connection.prepare(`
      INSERT INTO scenario_success_criteria (
        scenario_id, success_criterion_preset_id, position, weight
      ) VALUES (?, ?, ?, ?)
    `);
    input.scoringCriteria.forEach((criterion, position) => {
      insertSuccess.run(
        scenarioId, criterion.successCriterionPresetId,
        position, criterion.weight,
      );
    });
    result.scenarioRowsInserted += 1;
  }
}

function insertScenarioLinks(
  connection: DatabaseSync,
  timestamp: string,
  result: CatalogInitializationResult,
): void {
  const personaId = connection.prepare("SELECT id FROM personas WHERE seed_key = ?");
  const scenarioId = connection.prepare("SELECT id FROM scenarios WHERE seed_key = ?");
  const exists = connection.prepare(
    "SELECT 1 AS present FROM scenario_personas WHERE scenario_id = ? AND persona_id = ?",
  );
  const count = connection.prepare(
    "SELECT COUNT(*) AS count FROM scenario_personas WHERE scenario_id = ?",
  );
  const maximum = connection.prepare(
    "SELECT MAX(position) AS position FROM scenario_personas WHERE scenario_id = ?",
  );
  const insert = connection.prepare(`
    INSERT INTO scenario_personas (
      scenario_id, persona_id, position, created_at
    ) VALUES (?, ?, ?, ?)
  `);
  for (const scenario of INITIAL_CATALOG_SCENARIOS) {
    const resolvedScenarioId = readSeedId(scenarioId, scenario.key, "scenario");
    let linkCount = (count.get(resolvedScenarioId) as { count: number }).count;
    let nextPosition =
      ((maximum.get(resolvedScenarioId) as { position: number | null }).position ?? -1) + 1;
    for (const personaKey of scenario.input.allowedPersonaKeys) {
      const resolvedPersonaId = readSeedId(personaId, personaKey, "persona");
      if (exists.get(resolvedScenarioId, resolvedPersonaId)) {
        result.scenarioLinksSkipped += 1;
        continue;
      }
      if (linkCount >= MAX_SCENARIO_PERSONAS) {
        throw new CatalogInitializationScenarioCapacityError(scenario.key, personaKey);
      }
      insert.run(resolvedScenarioId, resolvedPersonaId, nextPosition, timestamp);
      nextPosition += 1;
      linkCount += 1;
      result.scenarioLinksInserted += 1;
    }
  }
}

function validateStarterInstructions(
  connection: DatabaseSync,
  personas: ReadonlyArray<{ key: string; input: PersonaInput }>,
  scenarios: ReadonlyArray<{
    key: string;
    input: ScenarioInput;
    allowedPersonaKeys: string[];
  }>,
): void {
  const personaPresets = readPersonaPresetsForResolution(connection);
  const scenarioPresets = readScenarioPresetsForResolution(connection);
  const personaByKey = new Map(personas.map((persona) => [persona.key, persona.input]));
  for (const scenario of scenarios) {
    const resolvedScenario = resolveScenarioPresetReferences(scenario.input, scenarioPresets);
    for (const personaKey of scenario.allowedPersonaKeys) {
      const persona = personaByKey.get(personaKey);
      if (!persona) throw new Error(`Starter scenario "${scenario.key}" references unknown persona "${personaKey}".`);
      const resolvedPersona = resolvePersonaPresetReferences(persona, personaPresets);
      for (const locale of ["en", "zh"] as const) {
        const issue = findRolePlayInstructionsLengthIssue({
          persona: localizePersonaInput(resolvedPersona, locale),
          scenario: localizeScenarioInput(resolvedScenario, locale),
        });
        if (issue) {
          throw new CatalogInitializationInstructionsTooLongError(
            personaKey, scenario.key, issue.actualLength,
          );
        }
      }
    }
  }
}

function readPersonaPresetsForResolution(connection: DatabaseSync) {
  return Object.entries(PERSONA_PRESET_TABLE_BY_CATEGORY).flatMap(([category, storage]) =>
    readPresetRowsForResolution(connection, storage).map((row) => ({
      ...row,
      category: category as PersonaPresetCategory,
    })),
  );
}

function readScenarioPresetsForResolution(connection: DatabaseSync) {
  return Object.entries(SCENARIO_PRESET_TABLE_BY_CATEGORY).flatMap(([category, storage]) =>
    readPresetRowsForResolution(connection, storage).map((row) => ({
      ...row,
      category: category as ScenarioPresetCategory,
    })),
  );
}

function readPresetRowsForResolution(
  connection: DatabaseSync,
  storage: PresetTableDefinition,
) {
  const rows = connection.prepare(`
    SELECT id, ${storage.valueColumn} AS value,
      ${storage.valueColumn}_zh_cn AS value_zh_cn,
      position, created_at, updated_at
    FROM ${storage.table}
  `).all() as unknown as Array<{
    id: number;
    value: string;
    value_zh_cn: string;
    position: number;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    value: row.value,
    valueZhCn: row.value_zh_cn,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function readPresetSeedId(
  connection: DatabaseSync,
  storage: PresetTableDefinition,
  key: string,
): number {
  const row = connection
    .prepare(`SELECT id FROM ${storage.table} WHERE seed_key = ?`)
    .get(key) as { id: number } | undefined;
  if (!row) throw new Error(`Starter preset "${key}" could not be resolved in ${storage.table}.`);
  return row.id;
}

function insertOrderedReferences(
  connection: DatabaseSync,
  table: string,
  ownerColumn: string,
  presetColumn: string,
  ownerId: number,
  presetIds: readonly number[],
): void {
  const insert = connection.prepare(
    `INSERT INTO ${table} (${ownerColumn}, ${presetColumn}, position) VALUES (?, ?, ?)`,
  );
  presetIds.forEach((presetId, position) => insert.run(ownerId, presetId, position));
}

function readSeedId(
  statement: ReturnType<DatabaseSync["prepare"]>,
  key: string,
  entity: "persona" | "scenario",
): number {
  const row = statement.get(key) as { id: number } | undefined;
  if (!row) throw new Error(`Starter ${entity} "${key}" could not be resolved after initialization.`);
  return row.id;
}

function assertUniqueStarterKeys(): void {
  for (const group of [
    INITIAL_PERSONA_PRESETS,
    INITIAL_SCENARIO_PRESETS,
    INITIAL_CATALOG_PERSONAS,
    INITIAL_CATALOG_SCENARIOS,
  ]) {
    const keys = group.map(({ key }) => key);
    if (new Set(keys).size !== keys.length) {
      throw new Error("Catalog initializer JSON contains duplicate seed keys.");
    }
  }
}
