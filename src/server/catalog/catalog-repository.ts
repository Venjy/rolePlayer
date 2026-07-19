import type { DatabaseSync } from "node:sqlite";
import type {
  Persona,
  PersonaInput,
  PersonaPreset,
  PersonaPresetCategory,
  QwenVoiceDefinition,
  ResolvedPersonaInput,
  ResolvedScenarioInput,
  RolePlayCatalog,
  Scenario,
  ScenarioInput,
  ScenarioPreset,
  ScenarioPresetCategory,
} from "../../shared/role-play-catalog";
import {
  personaPresetSchema,
  personaSchema,
  qwenVoiceDefinitionSchema,
  scenarioPresetSchema,
  scenarioSchema,
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
import { MAX_REALTIME_INSTRUCTIONS_LENGTH } from "../../shared/realtime-protocol";
import type { ApplicationDatabase } from "../database/database";
import {
  formatDatabaseTimestamp,
  nextDatabaseTimestamp,
} from "../database/database-time";
import {
  PERSONA_PRESET_TABLES,
  SCENARIO_PRESET_TABLES,
  type PresetTableDefinition,
} from "../database/preset-storage";

interface PersonaRow {
  id: number;
  name: string;
  name_zh_cn: string;
  gender: string;
  age: number | null;
  occupation_preset_id: number;
  occupation: string;
  occupation_zh_cn: string;
  background: string;
  background_zh_cn: string;
  communication_style_preset_id: number;
  communication_style: string;
  communication_style_zh_cn: string;
  tone_style_preset_id: number;
  tone_style: string;
  tone_style_zh_cn: string;
  behavior_notes: string;
  behavior_notes_zh_cn: string;
  voice: string;
  interrupt_frequency: string;
  speaking_pace: string;
  created_at: string;
  updated_at: string;
}

interface ScenarioRow {
  id: number;
  name: string;
  name_zh_cn: string;
  description: string;
  description_zh_cn: string;
  created_at: string;
  updated_at: string;
}

interface LocalizedReferenceRow {
  owner_id: number;
  preset_id: number;
  value: string;
  value_zh_cn: string;
  position: number;
  weight?: number;
}

interface ScenarioPersonaRow {
  scenario_id: number;
  persona_id: number;
}

interface PresetRow {
  id: number;
  value: string;
  value_zh_cn: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface QwenVoiceRow {
  id: number;
  voice: string;
  name: string;
  name_zh_cn: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export class CatalogNameConflictError extends Error {
  public constructor(
    public readonly entity: "persona" | "scenario",
    public readonly conflictingName: string,
  ) {
    super(`A ${entity} named "${conflictingName}" already exists.`);
    this.name = "CatalogNameConflictError";
  }
}

export class MissingPersonaReferencesError extends Error {
  public constructor(public readonly personaIds: readonly number[]) {
    super(`Unknown compatible persona IDs: ${personaIds.join(", ")}.`);
    this.name = "MissingPersonaReferencesError";
  }
}

export class PersonaInUseError extends Error {
  public constructor(
    public readonly personaId: number,
    public readonly scenarioIds: readonly number[],
  ) {
    super(
      `Persona "${personaId}" is still referenced by scenarios: ${scenarioIds.join(", ")}.`,
    );
    this.name = "PersonaInUseError";
  }
}

export class RolePlayInstructionsTooLongError extends Error {
  public constructor(
    public readonly personaName: string,
    public readonly scenarioName: string,
    public readonly actualLength: number,
  ) {
    super(
      `The Instructions for persona "${personaName}" and scenario "${scenarioName}" are too long (${actualLength}/${MAX_REALTIME_INSTRUCTIONS_LENGTH} characters).`,
    );
    this.name = "RolePlayInstructionsTooLongError";
  }
}

/** Owns catalog records and resolves every preset ID into bilingual API data. */
export class CatalogRepository {
  public constructor(private readonly database: ApplicationDatabase) {}

  public listCatalog(): RolePlayCatalog {
    const qwenVoices = this.listQwenVoices();
    const personaPresets = this.listPersonaPresets();
    const scenarioPresets = this.listScenarioPresets();
    const personaRows = this.connection.prepare(PERSONA_SELECT).all() as unknown as PersonaRow[];
    const scenarioRows = this.connection
      .prepare(
        `SELECT * FROM scenarios
         ORDER BY COALESCE(NULLIF(name, ''), name_zh_cn) COLLATE NOCASE, id`,
      )
      .all() as unknown as ScenarioRow[];
    const traits = readReferences(
      this.connection,
      "persona_personality_traits",
      "persona_id",
      "personality_trait_preset_id",
      "persona_personality_trait_presets",
      "personality_trait",
    );
    const motivations = readReferences(
      this.connection,
      "persona_motivations",
      "persona_id",
      "motivation_preset_id",
      "persona_motivation_presets",
      "motivation",
    );
    const concerns = readReferences(
      this.connection,
      "persona_concerns",
      "persona_id",
      "concern_preset_id",
      "persona_concern_presets",
      "concern",
    );
    const goals = readReferences(
      this.connection,
      "scenario_training_goals",
      "scenario_id",
      "training_goal_preset_id",
      "scenario_training_goal_presets",
      "training_goal",
    );
    const skills = readReferences(
      this.connection,
      "scenario_skill_focuses",
      "scenario_id",
      "skill_focus_preset_id",
      "scenario_skill_focus_presets",
      "skill_focus",
    );
    const success = readReferences(
      this.connection,
      "scenario_success_criteria",
      "scenario_id",
      "success_criterion_preset_id",
      "scenario_success_criterion_presets",
      "success_criterion",
      true,
    );
    const compatibilityRows = this.connection
      .prepare(
        `SELECT scenario_id, persona_id FROM scenario_personas
         ORDER BY scenario_id, position`,
      )
      .all() as unknown as ScenarioPersonaRow[];

    return {
      qwenVoices,
      personaPresets,
      scenarioPresets,
      personas: personaRows.map((row) =>
        mapPersonaRow(
          row,
          traits.get(row.id) ?? [],
          motivations.get(row.id) ?? [],
          concerns.get(row.id) ?? [],
        ),
      ),
      scenarios: scenarioRows.map((row) =>
        mapScenarioRow(
          row,
          goals.get(row.id) ?? [],
          skills.get(row.id) ?? [],
          success.get(row.id) ?? [],
          compatibilityRows
            .filter(({ scenario_id }) => scenario_id === row.id)
            .map(({ persona_id }) => persona_id),
        ),
      ),
    };
  }

  public getPersona(id: number): Persona | null {
    return this.listCatalog().personas.find((persona) => persona.id === id) ?? null;
  }

  public createPersona(input: PersonaInput): Persona {
    this.assertNamesAvailable("persona", input.name, input.nameZhCn);
    this.assertQwenVoiceExists(input.voice);
    this.resolvePersona(input);
    const timestamp = formatDatabaseTimestamp();
    const id = this.inTransaction(() => {
      const write = this.connection
        .prepare(
          `INSERT INTO personas (
            name, name_zh_cn, gender, age, occupation_preset_id,
            background, background_zh_cn, communication_style_preset_id,
            tone_style_preset_id, behavior_notes, behavior_notes_zh_cn,
            voice, interrupt_frequency, speaking_pace, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name, input.nameZhCn, input.gender, input.age,
          input.occupationPresetId, input.background, input.backgroundZhCn,
          input.communicationStylePresetId, input.toneStylePresetId,
          input.behaviorNotes, input.behaviorNotesZhCn, input.voice,
          input.voiceBehavior.interruptFrequency,
          input.voiceBehavior.speakingPace, timestamp, timestamp,
        );
      const generatedId = toDatabaseId(write.lastInsertRowid);
      this.replacePersonaReferences(generatedId, input);
      return generatedId;
    });
    return this.requirePersona(id);
  }

  public updatePersona(id: number, input: PersonaInput): Persona | null {
    const existing = this.getPersona(id);
    if (!existing) return null;
    this.assertNamesAvailable("persona", input.name, input.nameZhCn, id);
    this.assertQwenVoiceExists(input.voice);
    const resolved = this.resolvePersona(input);
    this.assertPersonaPromptsFit(id, resolved);
    const timestamp = nextDatabaseTimestamp(existing.updatedAt);
    this.inTransaction(() => {
      this.connection
        .prepare(
          `UPDATE personas SET
            name = ?, name_zh_cn = ?, gender = ?, age = ?,
            occupation_preset_id = ?, background = ?, background_zh_cn = ?,
            communication_style_preset_id = ?, tone_style_preset_id = ?,
            behavior_notes = ?, behavior_notes_zh_cn = ?, voice = ?,
            interrupt_frequency = ?, speaking_pace = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name, input.nameZhCn, input.gender, input.age,
          input.occupationPresetId, input.background, input.backgroundZhCn,
          input.communicationStylePresetId, input.toneStylePresetId,
          input.behaviorNotes, input.behaviorNotesZhCn, input.voice,
          input.voiceBehavior.interruptFrequency,
          input.voiceBehavior.speakingPace, timestamp, id,
        );
      this.replacePersonaReferences(id, input);
    });
    return this.requirePersona(id);
  }

  public deletePersona(id: number): boolean {
    const references = this.connection
      .prepare(
        "SELECT scenario_id FROM scenario_personas WHERE persona_id = ? ORDER BY scenario_id",
      )
      .all(id) as unknown as Array<{ scenario_id: number }>;
    if (references.length > 0) {
      throw new PersonaInUseError(id, references.map(({ scenario_id }) => scenario_id));
    }
    return this.connection.prepare("DELETE FROM personas WHERE id = ?").run(id).changes > 0;
  }

  public getScenario(id: number): Scenario | null {
    return this.listCatalog().scenarios.find((scenario) => scenario.id === id) ?? null;
  }

  public createScenario(input: ScenarioInput): Scenario {
    this.assertNamesAvailable("scenario", input.name, input.nameZhCn);
    this.assertPersonasExist(input.allowedPersonaIds);
    const resolved = this.resolveScenario(input);
    this.assertScenarioPromptsFit(resolved);
    const timestamp = formatDatabaseTimestamp();
    const id = this.inTransaction(() => {
      const write = this.connection
        .prepare(
          `INSERT INTO scenarios (
            name, name_zh_cn, description, description_zh_cn, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name, input.nameZhCn, input.description,
          input.descriptionZhCn, timestamp, timestamp,
        );
      const generatedId = toDatabaseId(write.lastInsertRowid);
      this.replaceScenarioReferences(generatedId, input);
      this.replaceScenarioPersonas(generatedId, input.allowedPersonaIds, timestamp);
      return generatedId;
    });
    return this.requireScenario(id);
  }

  public updateScenario(id: number, input: ScenarioInput): Scenario | null {
    const existing = this.getScenario(id);
    if (!existing) return null;
    this.assertNamesAvailable("scenario", input.name, input.nameZhCn, id);
    this.assertPersonasExist(input.allowedPersonaIds);
    const resolved = this.resolveScenario(input);
    this.assertScenarioPromptsFit(resolved);
    const timestamp = nextDatabaseTimestamp(existing.updatedAt);
    this.inTransaction(() => {
      this.connection
        .prepare(
          `UPDATE scenarios SET name = ?, name_zh_cn = ?,
            description = ?, description_zh_cn = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.name, input.nameZhCn, input.description,
          input.descriptionZhCn, timestamp, id,
        );
      this.replaceScenarioReferences(id, input);
      this.replaceScenarioPersonas(id, input.allowedPersonaIds, timestamp);
    });
    return this.requireScenario(id);
  }

  public deleteScenario(id: number): boolean {
    return this.connection.prepare("DELETE FROM scenarios WHERE id = ?").run(id).changes > 0;
  }

  private get connection(): DatabaseSync {
    return this.database.raw;
  }

  private listPersonaPresets(): PersonaPreset[] {
    return PERSONA_PRESET_TABLES.flatMap((storage) =>
      readPresetRows(this.connection, storage).map((row) =>
        mapPersonaPresetRow(row, storage.category),
      ),
    );
  }

  private listQwenVoices(): QwenVoiceDefinition[] {
    const tableExists = this.connection
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'qwen_voices'",
      )
      .get();
    if (!tableExists) return [];
    const rows = this.connection
      .prepare(
        `SELECT id, voice, name, name_zh_cn, position, created_at, updated_at
         FROM qwen_voices ORDER BY position, id`,
      )
      .all() as unknown as QwenVoiceRow[];
    return rows.map((row) => qwenVoiceDefinitionSchema.parse({
      id: row.id,
      voice: row.voice,
      name: row.name,
      nameZhCn: row.name_zh_cn,
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private listScenarioPresets(): ScenarioPreset[] {
    return SCENARIO_PRESET_TABLES.flatMap((storage) =>
      readPresetRows(this.connection, storage).map((row) =>
        mapScenarioPresetRow(row, storage.category),
      ),
    );
  }

  private resolvePersona(input: PersonaInput) {
    return resolvePersonaPresetReferences(input, this.listPersonaPresets());
  }

  private resolveScenario(input: ScenarioInput) {
    return resolveScenarioPresetReferences(input, this.listScenarioPresets());
  }

  private requirePersona(id: number): Persona {
    const persona = this.getPersona(id);
    if (!persona) throw new Error(`Persona "${id}" disappeared after writing.`);
    return persona;
  }

  private requireScenario(id: number): Scenario {
    const scenario = this.getScenario(id);
    if (!scenario) throw new Error(`Scenario "${id}" disappeared after writing.`);
    return scenario;
  }

  private assertNamesAvailable(
    entity: "persona" | "scenario",
    name: string,
    nameZhCn: string,
    excludedId?: number,
  ): void {
    const table = entity === "persona" ? "personas" : "scenarios";
    for (const [column, localizedName] of [["name", name], ["name_zh_cn", nameZhCn]] as const) {
      if (!localizedName) continue;
      const conflict = this.connection
        .prepare(
          `SELECT id FROM ${table}
           WHERE ${column} = ? COLLATE NOCASE AND (? IS NULL OR id <> ?)`,
        )
        .get(localizedName, excludedId ?? null, excludedId ?? null);
      if (conflict) throw new CatalogNameConflictError(entity, localizedName);
    }
  }

  private assertPersonasExist(personaIds: readonly number[]): void {
    const statement = this.connection.prepare("SELECT 1 AS present FROM personas WHERE id = ?");
    const missing = personaIds.filter((id) => !statement.get(id));
    if (missing.length > 0) throw new MissingPersonaReferencesError(missing);
  }

  private assertQwenVoiceExists(voice: PersonaInput["voice"]): void {
    const tableExists = this.connection
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'qwen_voices'",
      )
      .get();
    if (!tableExists) return;
    const present = this.connection
      .prepare("SELECT 1 AS present FROM qwen_voices WHERE voice = ?")
      .get(voice);
    if (!present) {
      throw new Error(
        `Qwen voice "${voice}" is not initialized. Run the catalog initializer.`,
      );
    }
  }

  private assertPersonaPromptsFit(
    personaId: number,
    persona: ResolvedPersonaInput,
  ): void {
    for (const scenario of this.listCatalog().scenarios) {
      if (scenario.allowedPersonaIds.includes(personaId)) {
        this.assertPromptFits(persona, scenario);
      }
    }
  }

  private assertScenarioPromptsFit(scenario: ResolvedScenarioInput): void {
    for (const personaId of scenario.allowedPersonaIds) {
      this.assertPromptFits(this.requirePersona(personaId), scenario);
    }
  }

  private assertPromptFits(
    persona: ResolvedPersonaInput,
    scenario: ResolvedScenarioInput,
  ): void {
    for (const locale of ["zh", "en"] as const) {
      const localizedPersona = localizePersonaInput(persona, locale);
      const localizedScenario = localizeScenarioInput(scenario, locale);
      const issue = findRolePlayInstructionsLengthIssue({
        persona: localizedPersona,
        scenario: localizedScenario,
      });
      if (issue) {
        throw new RolePlayInstructionsTooLongError(
          localizedPersona.name,
          localizedScenario.name,
          issue.actualLength,
        );
      }
    }
  }

  private replacePersonaReferences(personaId: number, input: PersonaInput): void {
    replaceOrderedReferences(
      this.connection, "persona_personality_traits", "persona_id",
      "personality_trait_preset_id", personaId, input.personalityTraitPresetIds,
    );
    replaceOrderedReferences(
      this.connection, "persona_motivations", "persona_id",
      "motivation_preset_id", personaId, input.motivationPresetIds,
    );
    replaceOrderedReferences(
      this.connection, "persona_concerns", "persona_id",
      "concern_preset_id", personaId, input.concernPresetIds,
    );
  }

  private replaceScenarioReferences(scenarioId: number, input: ScenarioInput): void {
    replaceOrderedReferences(
      this.connection, "scenario_training_goals", "scenario_id",
      "training_goal_preset_id", scenarioId, input.trainingGoalPresetIds,
    );
    replaceOrderedReferences(
      this.connection, "scenario_skill_focuses", "scenario_id",
      "skill_focus_preset_id", scenarioId, input.skillFocusPresetIds,
    );
    this.connection
      .prepare("DELETE FROM scenario_success_criteria WHERE scenario_id = ?")
      .run(scenarioId);
    const insert = this.connection.prepare(
      `INSERT INTO scenario_success_criteria (
        scenario_id, success_criterion_preset_id, position, weight
      ) VALUES (?, ?, ?, ?)`,
    );
    input.scoringCriteria.forEach((criterion, position) => {
      insert.run(
        scenarioId,
        criterion.successCriterionPresetId,
        position,
        criterion.weight,
      );
    });
  }

  private replaceScenarioPersonas(
    scenarioId: number,
    personaIds: readonly number[],
    timestamp: string,
  ): void {
    this.connection.prepare("DELETE FROM scenario_personas WHERE scenario_id = ?").run(scenarioId);
    const insert = this.connection.prepare(
      `INSERT INTO scenario_personas (
        scenario_id, persona_id, position, created_at
      ) VALUES (?, ?, ?, ?)`,
    );
    personaIds.forEach((personaId, position) =>
      insert.run(scenarioId, personaId, position, timestamp),
    );
  }

  private inTransaction<T>(operation: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
}

const PERSONA_SELECT = `
  SELECT p.*,
    occupation.occupation, occupation.occupation_zh_cn,
    communication.communication_style, communication.communication_style_zh_cn,
    tone.tone_style, tone.tone_style_zh_cn
  FROM personas AS p
  JOIN persona_occupation_presets AS occupation
    ON occupation.id = p.occupation_preset_id
  JOIN persona_communication_style_presets AS communication
    ON communication.id = p.communication_style_preset_id
  JOIN persona_tone_style_presets AS tone
    ON tone.id = p.tone_style_preset_id
  ORDER BY COALESCE(NULLIF(p.name, ''), p.name_zh_cn) COLLATE NOCASE, p.id
`;

function readPresetRows(
  connection: DatabaseSync,
  storage: PresetTableDefinition,
): PresetRow[] {
  const chineseColumn = `${storage.valueColumn}_zh_cn`;
  return connection
    .prepare(
      `SELECT id, ${storage.valueColumn} AS value,
        ${chineseColumn} AS value_zh_cn, position, created_at, updated_at
       FROM ${storage.table} ORDER BY position, id`,
    )
    .all() as unknown as PresetRow[];
}

function readReferences(
  connection: DatabaseSync,
  relationTable: string,
  ownerColumn: string,
  presetIdColumn: string,
  presetTable: string,
  valueColumn: string,
  hasWeight = false,
): Map<number, LocalizedReferenceRow[]> {
  const rows = connection
    .prepare(
      `SELECT relation.${ownerColumn} AS owner_id,
        relation.${presetIdColumn} AS preset_id,
        preset.${valueColumn} AS value,
        preset.${valueColumn}_zh_cn AS value_zh_cn,
        relation.position${hasWeight ? ", relation.weight" : ""}
       FROM ${relationTable} AS relation
       JOIN ${presetTable} AS preset ON preset.id = relation.${presetIdColumn}
       ORDER BY relation.${ownerColumn}, relation.position`,
    )
    .all() as unknown as LocalizedReferenceRow[];
  const grouped = new Map<number, LocalizedReferenceRow[]>();
  for (const row of rows) {
    const values = grouped.get(row.owner_id) ?? [];
    values.push(row);
    grouped.set(row.owner_id, values);
  }
  return grouped;
}

function mapPersonaPresetRow(
  row: PresetRow,
  category: PersonaPresetCategory,
): PersonaPreset {
  return personaPresetSchema.parse({
    id: row.id, category, value: row.value, valueZhCn: row.value_zh_cn,
    position: row.position, createdAt: row.created_at, updatedAt: row.updated_at,
  });
}

function mapScenarioPresetRow(
  row: PresetRow,
  category: ScenarioPresetCategory,
): ScenarioPreset {
  return scenarioPresetSchema.parse({
    id: row.id, category, value: row.value, valueZhCn: row.value_zh_cn,
    position: row.position, createdAt: row.created_at, updatedAt: row.updated_at,
  });
}

function mapPersonaRow(
  row: PersonaRow,
  traits: readonly LocalizedReferenceRow[],
  motivations: readonly LocalizedReferenceRow[],
  concerns: readonly LocalizedReferenceRow[],
): Persona {
  return personaSchema.parse({
    id: row.id,
    name: row.name,
    nameZhCn: row.name_zh_cn,
    gender: row.gender,
    age: row.age,
    occupationPresetId: row.occupation_preset_id,
    occupation: row.occupation,
    occupationZhCn: row.occupation_zh_cn,
    background: row.background,
    backgroundZhCn: row.background_zh_cn,
    personalityTraitPresetIds: traits.map(({ preset_id }) => preset_id),
    personalityTraits: traits.map(({ value }) => value),
    personalityTraitsZhCn: traits.map(({ value_zh_cn }) => value_zh_cn),
    communicationStylePresetId: row.communication_style_preset_id,
    communicationStyle: row.communication_style,
    communicationStyleZhCn: row.communication_style_zh_cn,
    toneStylePresetId: row.tone_style_preset_id,
    toneStyle: row.tone_style,
    toneStyleZhCn: row.tone_style_zh_cn,
    behaviorNotes: row.behavior_notes,
    behaviorNotesZhCn: row.behavior_notes_zh_cn,
    motivationPresetIds: motivations.map(({ preset_id }) => preset_id),
    motivations: motivations.map(({ value }) => value),
    motivationsZhCn: motivations.map(({ value_zh_cn }) => value_zh_cn),
    concernPresetIds: concerns.map(({ preset_id }) => preset_id),
    concerns: concerns.map(({ value }) => value),
    concernsZhCn: concerns.map(({ value_zh_cn }) => value_zh_cn),
    voice: row.voice,
    voiceBehavior: {
      interruptFrequency: row.interrupt_frequency,
      speakingPace: row.speaking_pace,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapScenarioRow(
  row: ScenarioRow,
  goals: readonly LocalizedReferenceRow[],
  skills: readonly LocalizedReferenceRow[],
  success: readonly LocalizedReferenceRow[],
  allowedPersonaIds: readonly number[],
): Scenario {
  return scenarioSchema.parse({
    id: row.id,
    name: row.name,
    nameZhCn: row.name_zh_cn,
    description: row.description,
    descriptionZhCn: row.description_zh_cn,
    trainingGoalPresetIds: goals.map(({ preset_id }) => preset_id),
    goals: goals.map(({ value }) => value),
    goalsZhCn: goals.map(({ value_zh_cn }) => value_zh_cn),
    skillFocusPresetIds: skills.map(({ preset_id }) => preset_id),
    suggestedSkillFocus: skills.map(({ value }) => value),
    suggestedSkillFocusZhCn: skills.map(({ value_zh_cn }) => value_zh_cn),
    successCriterionPresetIds: success.map(({ preset_id }) => preset_id),
    successCriteria: success.map(({ value }) => value),
    successCriteriaZhCn: success.map(({ value_zh_cn }) => value_zh_cn),
    scoringCriteria: success.map((criterion) => ({
      successCriterionPresetId: criterion.preset_id,
      name: criterion.value,
      nameZhCn: criterion.value_zh_cn,
      weight: criterion.weight,
    })),
    allowedPersonaIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function replaceOrderedReferences(
  connection: DatabaseSync,
  table: string,
  ownerColumn: string,
  presetColumn: string,
  ownerId: number,
  presetIds: readonly number[],
): void {
  connection.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).run(ownerId);
  const insert = connection.prepare(
    `INSERT INTO ${table} (${ownerColumn}, ${presetColumn}, position) VALUES (?, ?, ?)`,
  );
  presetIds.forEach((presetId, position) => insert.run(ownerId, presetId, position));
}

function toDatabaseId(value: number | bigint): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`SQLite returned an invalid generated ID: ${String(value)}.`);
  }
  return id;
}
