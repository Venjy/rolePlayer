import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  Persona,
  PersonaInput,
  PersonaPreset,
  RolePlayCatalog,
  Scenario,
  ScenarioInput,
} from "../../shared/role-play-catalog";
import {
  personaSchema,
  personaPresetSchema,
  scenarioSchema,
} from "../../shared/role-play-catalog";
import { findRolePlayInstructionsLengthIssue } from "../../shared/role-play-instructions";
import { MAX_REALTIME_INSTRUCTIONS_LENGTH } from "../../shared/realtime-protocol";
import type { ApplicationDatabase } from "../database/database";

interface PersonaRow {
  id: string;
  name: string;
  gender: string;
  age: number | null;
  occupation: string;
  identity: string;
  background: string;
  personality_traits_json: string;
  communication_style: string;
  behavior_notes: string;
  motivations_json: string;
  concerns_json: string;
  voice: string;
  created_at: string;
  updated_at: string;
}

interface ScenarioRow {
  id: string;
  name: string;
  description: string;
  goals_json: string;
  suggested_skill_focus_json: string;
  success_criteria_json: string;
  scoring_criteria_json: string;
  voice_behavior_json: string;
  created_at: string;
  updated_at: string;
}

interface ScenarioPersonaRow {
  scenario_id: string;
  persona_id: string;
}

interface PersonaPresetRow {
  id: string;
  category: string;
  value: string;
  value_en: string;
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
  public constructor(public readonly personaIds: readonly string[]) {
    super(`Unknown compatible persona IDs: ${personaIds.join(", ")}.`);
    this.name = "MissingPersonaReferencesError";
  }
}

export class PersonaInUseError extends Error {
  public constructor(
    public readonly personaId: string,
    public readonly scenarioIds: readonly string[],
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

/**
 * Owns the short synchronous queries for the editable role-play catalog. The
 * repository uses Fastify's process-owned database rather than opening another
 * connection, keeping SQLite lifecycle and realtime performance predictable.
 */
export class CatalogRepository {
  public constructor(private readonly database: ApplicationDatabase) {}

  public listCatalog(): RolePlayCatalog {
    const personaPresetRows = this.connection
      .prepare(
        `SELECT id, category, value, value_en, position, created_at, updated_at
         FROM persona_presets
         ORDER BY category, position, id`,
      )
      .all() as unknown as PersonaPresetRow[];
    const personaRows = this.connection
      .prepare("SELECT * FROM personas ORDER BY name COLLATE NOCASE, id")
      .all() as unknown as PersonaRow[];
    const scenarioRows = this.connection
      .prepare("SELECT * FROM scenarios ORDER BY name COLLATE NOCASE, id")
      .all() as unknown as ScenarioRow[];
    const compatibilityRows = this.connection
      .prepare(
        `SELECT scenario_id, persona_id
         FROM scenario_personas
         ORDER BY scenario_id, position`,
      )
      .all() as unknown as ScenarioPersonaRow[];

    const personaIdsByScenario = new Map<string, string[]>();
    for (const row of compatibilityRows) {
      const personaIds = personaIdsByScenario.get(row.scenario_id) ?? [];
      personaIds.push(row.persona_id);
      personaIdsByScenario.set(row.scenario_id, personaIds);
    }

    return {
      personaPresets: personaPresetRows.map(mapPersonaPresetRow),
      personas: personaRows.map(mapPersonaRow),
      scenarios: scenarioRows.map((row) =>
        mapScenarioRow(row, personaIdsByScenario.get(row.id) ?? []),
      ),
    };
  }

  public getPersona(id: string): Persona | null {
    const row = this.connection
      .prepare("SELECT * FROM personas WHERE id = ?")
      .get(id) as unknown as PersonaRow | undefined;
    return row ? mapPersonaRow(row) : null;
  }

  public createPersona(input: PersonaInput): Persona {
    this.assertNameAvailable("persona", input.name);

    const id = `persona_${randomUUID()}`;
    const timestamp = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT INTO personas (
          id, name, gender, age, occupation, identity, background,
          personality_traits_json, communication_style, behavior_notes,
          motivations_json, concerns_json, voice, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.gender,
        input.age,
        input.occupation,
        input.identity,
        input.background,
        JSON.stringify(input.personalityTraits),
        input.communicationStyle,
        input.behaviorNotes,
        JSON.stringify(input.motivations),
        JSON.stringify(input.concerns),
        input.voice,
        timestamp,
        timestamp,
      );

    return this.requirePersona(id);
  }

  public updatePersona(id: string, input: PersonaInput): Persona | null {
    const existing = this.getPersona(id);
    if (!existing) return null;
    this.assertNameAvailable("persona", input.name, id);
    this.assertPersonaPromptsFit(id, input);

    this.connection
      .prepare(
        `UPDATE personas
         SET name = ?, gender = ?, age = ?, occupation = ?, identity = ?,
             background = ?, personality_traits_json = ?,
             communication_style = ?, behavior_notes = ?, motivations_json = ?,
             concerns_json = ?, voice = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.gender,
        input.age,
        input.occupation,
        input.identity,
        input.background,
        JSON.stringify(input.personalityTraits),
        input.communicationStyle,
        input.behaviorNotes,
        JSON.stringify(input.motivations),
        JSON.stringify(input.concerns),
        input.voice,
        nextTimestamp(existing.updatedAt),
        id,
      );

    return this.requirePersona(id);
  }

  public deletePersona(id: string): boolean {
    const references = this.connection
      .prepare(
        `SELECT scenario_id
         FROM scenario_personas
         WHERE persona_id = ?
         ORDER BY scenario_id`,
      )
      .all(id) as unknown as Array<{ scenario_id: string }>;

    if (references.length > 0) {
      throw new PersonaInUseError(
        id,
        references.map(({ scenario_id }) => scenario_id),
      );
    }

    const result = this.connection
      .prepare("DELETE FROM personas WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  public getScenario(id: string): Scenario | null {
    const row = this.connection
      .prepare("SELECT * FROM scenarios WHERE id = ?")
      .get(id) as unknown as ScenarioRow | undefined;
    if (!row) return null;

    const compatibilityRows = this.connection
      .prepare(
        `SELECT persona_id
         FROM scenario_personas
         WHERE scenario_id = ?
         ORDER BY position`,
      )
      .all(id) as unknown as Array<{ persona_id: string }>;

    return mapScenarioRow(
      row,
      compatibilityRows.map(({ persona_id }) => persona_id),
    );
  }

  public createScenario(input: ScenarioInput): Scenario {
    this.assertNameAvailable("scenario", input.name);
    this.assertPersonasExist(input.allowedPersonaIds);
    this.assertScenarioPromptsFit(input);

    const id = `scenario_${randomUUID()}`;
    const timestamp = new Date().toISOString();
    this.inTransaction(() => {
      this.insertScenario(id, input, timestamp);
      this.replaceScenarioPersonas(id, input.allowedPersonaIds, timestamp);
    });

    return this.requireScenario(id);
  }

  public updateScenario(id: string, input: ScenarioInput): Scenario | null {
    const existing = this.getScenario(id);
    if (!existing) return null;
    this.assertNameAvailable("scenario", input.name, id);
    this.assertPersonasExist(input.allowedPersonaIds);
    this.assertScenarioPromptsFit(input);

    const timestamp = nextTimestamp(existing.updatedAt);
    this.inTransaction(() => {
      this.connection
        .prepare(
          `UPDATE scenarios
           SET name = ?, description = ?, goals_json = ?,
               suggested_skill_focus_json = ?, success_criteria_json = ?,
               scoring_criteria_json = ?, voice_behavior_json = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name,
          input.description,
          JSON.stringify(input.goals),
          JSON.stringify(input.suggestedSkillFocus),
          JSON.stringify(input.successCriteria),
          JSON.stringify(input.scoringCriteria),
          JSON.stringify(input.voiceBehavior),
          timestamp,
          id,
        );
      this.replaceScenarioPersonas(id, input.allowedPersonaIds, timestamp);
    });

    return this.requireScenario(id);
  }

  public deleteScenario(id: string): boolean {
    const result = this.connection
      .prepare("DELETE FROM scenarios WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  private get connection(): DatabaseSync {
    return this.database.raw;
  }

  private requirePersona(id: string): Persona {
    const persona = this.getPersona(id);
    if (!persona) throw new Error(`Persona "${id}" disappeared after writing.`);
    return persona;
  }

  private requireScenario(id: string): Scenario {
    const scenario = this.getScenario(id);
    if (!scenario) throw new Error(`Scenario "${id}" disappeared after writing.`);
    return scenario;
  }

  private assertNameAvailable(
    entity: "persona" | "scenario",
    name: string,
    excludedId?: string,
  ): void {
    const table = entity === "persona" ? "personas" : "scenarios";
    const conflict = this.connection
      .prepare(
        `SELECT id FROM ${table}
         WHERE name = ? COLLATE NOCASE AND (? IS NULL OR id <> ?)`,
      )
      .get(name, excludedId ?? null, excludedId ?? null);
    if (conflict) throw new CatalogNameConflictError(entity, name);
  }

  private assertPersonasExist(personaIds: readonly string[]): void {
    const statement = this.connection.prepare(
      "SELECT 1 AS present FROM personas WHERE id = ?",
    );
    const missing = personaIds.filter((id) => !statement.get(id));
    if (missing.length > 0) throw new MissingPersonaReferencesError(missing);
  }

  private assertPersonaPromptsFit(
    personaId: string,
    persona: PersonaInput,
  ): void {
    for (const scenario of this.listCatalog().scenarios) {
      if (scenario.allowedPersonaIds.includes(personaId)) {
        this.assertPromptFits(persona, scenario);
      }
    }
  }

  private assertScenarioPromptsFit(scenario: ScenarioInput): void {
    for (const personaId of scenario.allowedPersonaIds) {
      this.assertPromptFits(this.requirePersona(personaId), scenario);
    }
  }

  private assertPromptFits(
    persona: PersonaInput,
    scenario: ScenarioInput,
  ): void {
    const issue = findRolePlayInstructionsLengthIssue({ persona, scenario });
    if (issue) {
      throw new RolePlayInstructionsTooLongError(
        persona.name,
        scenario.name,
        issue.actualLength,
      );
    }
  }

  private insertScenario(
    id: string,
    input: ScenarioInput,
    timestamp: string,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO scenarios (
          id, name, description, goals_json, suggested_skill_focus_json,
          success_criteria_json, scoring_criteria_json, voice_behavior_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description,
        JSON.stringify(input.goals),
        JSON.stringify(input.suggestedSkillFocus),
        JSON.stringify(input.successCriteria),
        JSON.stringify(input.scoringCriteria),
        JSON.stringify(input.voiceBehavior),
        timestamp,
        timestamp,
      );
  }

  private replaceScenarioPersonas(
    scenarioId: string,
    personaIds: readonly string[],
    timestamp: string,
  ): void {
    this.connection
      .prepare("DELETE FROM scenario_personas WHERE scenario_id = ?")
      .run(scenarioId);
    const insert = this.connection.prepare(
      `INSERT INTO scenario_personas (
        scenario_id, persona_id, position, created_at
      ) VALUES (?, ?, ?, ?)`,
    );
    personaIds.forEach((personaId, position) => {
      insert.run(scenarioId, personaId, position, timestamp);
    });
  }

  private inTransaction(operation: () => void): void {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      operation();
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
}

function mapPersonaPresetRow(row: PersonaPresetRow): PersonaPreset {
  return personaPresetSchema.parse({
    id: row.id,
    category: row.category,
    value: row.value,
    valueEn: row.value_en,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapPersonaRow(row: PersonaRow): Persona {
  return personaSchema.parse({
    id: row.id,
    name: row.name,
    gender: row.gender,
    age: row.age,
    occupation: row.occupation,
    identity: row.identity,
    background: row.background,
    personalityTraits: parseJson(row.personality_traits_json),
    communicationStyle: row.communication_style,
    behaviorNotes: row.behavior_notes,
    motivations: parseJson(row.motivations_json),
    concerns: parseJson(row.concerns_json),
    voice: row.voice,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapScenarioRow(
  row: ScenarioRow,
  allowedPersonaIds: readonly string[],
): Scenario {
  return scenarioSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    goals: parseJson(row.goals_json),
    suggestedSkillFocus: parseJson(row.suggested_skill_focus_json),
    successCriteria: parseJson(row.success_criteria_json),
    scoringCriteria: parseJson(row.scoring_criteria_json),
    allowedPersonaIds,
    voiceBehavior: parseJson(row.voice_behavior_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error("The role-play catalog contains invalid JSON.", {
      cause: error,
    });
  }
}

function nextTimestamp(previousTimestamp: string): string {
  const now = Date.now();
  const previous = Date.parse(previousTimestamp);
  return new Date(Math.max(now, previous + 1)).toISOString();
}
