import type { DatabaseSync } from "node:sqlite";

/**
 * Moves prompt-level tone and conversational voice behavior from personas to
 * scenarios without discarding catalog IDs or compatibility links. Existing
 * scenarios inherit the values of their first compatible persona because the
 * legacy schema had no scenario-owned value to prefer.
 */
export function moveCatalogVoiceBehaviorToScenarios(
  database: DatabaseSync,
): void {
  database.exec(`
    DROP INDEX personas_name_en_idx;
    DROP INDEX personas_name_zh_cn_idx;
    DROP INDEX scenarios_name_en_idx;
    DROP INDEX scenarios_name_zh_cn_idx;
    DROP INDEX scenario_personas_persona_id_idx;
    DROP INDEX scenario_personas_scenario_position_idx;

    ALTER TABLE scenario_personas RENAME TO scenario_personas_before_voice_behavior;
    ALTER TABLE persona_personality_traits RENAME TO persona_personality_traits_before_voice_behavior;
    ALTER TABLE persona_motivations RENAME TO persona_motivations_before_voice_behavior;
    ALTER TABLE persona_concerns RENAME TO persona_concerns_before_voice_behavior;
    ALTER TABLE scenario_training_goals RENAME TO scenario_training_goals_before_voice_behavior;
    ALTER TABLE scenario_skill_focuses RENAME TO scenario_skill_focuses_before_voice_behavior;
    ALTER TABLE scenario_success_criteria RENAME TO scenario_success_criteria_before_voice_behavior;
    ALTER TABLE personas RENAME TO personas_before_voice_behavior;
    ALTER TABLE scenarios RENAME TO scenarios_before_voice_behavior;
    ALTER TABLE persona_tone_style_presets RENAME TO scenario_tone_style_presets;

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
      behavior_notes TEXT NOT NULL DEFAULT '' CHECK (length(behavior_notes) <= 2000),
      behavior_notes_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(behavior_notes_zh_cn) <= 2000),
      voice TEXT NOT NULL CHECK (voice IN ('longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (length(trim(name)) > 0 OR length(trim(name_zh_cn)) > 0),
      FOREIGN KEY (occupation_preset_id) REFERENCES persona_occupation_presets(id) ON DELETE RESTRICT,
      FOREIGN KEY (communication_style_preset_id) REFERENCES persona_communication_style_presets(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE UNIQUE INDEX personas_name_en_idx ON personas(name COLLATE NOCASE) WHERE length(trim(name)) > 0;
    CREATE UNIQUE INDEX personas_name_zh_cn_idx ON personas(name_zh_cn COLLATE NOCASE) WHERE length(trim(name_zh_cn)) > 0;

    INSERT INTO personas (
      id, seed_key, name, name_zh_cn, gender, age, occupation_preset_id,
      background, background_zh_cn, communication_style_preset_id,
      behavior_notes, behavior_notes_zh_cn, voice, created_at, updated_at
    )
    SELECT
      id, seed_key, name, name_zh_cn, gender, age, occupation_preset_id,
      background, background_zh_cn, communication_style_preset_id,
      behavior_notes, behavior_notes_zh_cn, voice, created_at, updated_at
    FROM personas_before_voice_behavior;

    CREATE TABLE scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seed_key TEXT UNIQUE CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
      name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
      name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 120),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
      description_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(description_zh_cn) <= 2000),
      tone_style_preset_id INTEGER,
      interrupt_frequency TEXT CHECK (interrupt_frequency IS NULL OR interrupt_frequency IN ('low', 'medium', 'high')),
      speaking_pace TEXT CHECK (speaking_pace IS NULL OR speaking_pace IN ('slow', 'normal', 'fast')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (length(trim(name)) > 0 OR length(trim(name_zh_cn)) > 0),
      CHECK (length(trim(description)) > 0 OR length(trim(description_zh_cn)) > 0),
      FOREIGN KEY (tone_style_preset_id) REFERENCES scenario_tone_style_presets(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE UNIQUE INDEX scenarios_name_en_idx ON scenarios(name COLLATE NOCASE) WHERE length(trim(name)) > 0;
    CREATE UNIQUE INDEX scenarios_name_zh_cn_idx ON scenarios(name_zh_cn COLLATE NOCASE) WHERE length(trim(name_zh_cn)) > 0;

    INSERT INTO scenarios (
      id, seed_key, name, name_zh_cn, description, description_zh_cn,
      tone_style_preset_id, interrupt_frequency, speaking_pace,
      created_at, updated_at
    )
    SELECT
      scenario.id, scenario.seed_key, scenario.name, scenario.name_zh_cn,
      scenario.description, scenario.description_zh_cn,
      persona.tone_style_preset_id,
      persona.interrupt_frequency,
      persona.speaking_pace,
      scenario.created_at, scenario.updated_at
    FROM scenarios_before_voice_behavior AS scenario
    LEFT JOIN scenario_personas_before_voice_behavior AS compatibility
      ON compatibility.scenario_id = scenario.id
      AND compatibility.position = (
        SELECT MIN(first_compatibility.position)
        FROM scenario_personas_before_voice_behavior AS first_compatibility
        WHERE first_compatibility.scenario_id = scenario.id
      )
    LEFT JOIN personas_before_voice_behavior AS persona
      ON persona.id = compatibility.persona_id;

    CREATE TABLE persona_personality_traits (
      persona_id INTEGER NOT NULL,
      personality_trait_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (persona_id, personality_trait_preset_id),
      UNIQUE (persona_id, position),
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
      FOREIGN KEY (personality_trait_preset_id) REFERENCES persona_personality_trait_presets(id) ON DELETE RESTRICT
    ) STRICT;
    INSERT INTO persona_personality_traits SELECT * FROM persona_personality_traits_before_voice_behavior;

    CREATE TABLE persona_motivations (
      persona_id INTEGER NOT NULL,
      motivation_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (persona_id, motivation_preset_id),
      UNIQUE (persona_id, position),
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
      FOREIGN KEY (motivation_preset_id) REFERENCES persona_motivation_presets(id) ON DELETE RESTRICT
    ) STRICT;
    INSERT INTO persona_motivations SELECT * FROM persona_motivations_before_voice_behavior;

    CREATE TABLE persona_concerns (
      persona_id INTEGER NOT NULL,
      concern_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (persona_id, concern_preset_id),
      UNIQUE (persona_id, position),
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
      FOREIGN KEY (concern_preset_id) REFERENCES persona_concern_presets(id) ON DELETE RESTRICT
    ) STRICT;
    INSERT INTO persona_concerns SELECT * FROM persona_concerns_before_voice_behavior;

    CREATE TABLE scenario_training_goals (
      scenario_id INTEGER NOT NULL,
      training_goal_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (scenario_id, training_goal_preset_id),
      UNIQUE (scenario_id, position),
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
      FOREIGN KEY (training_goal_preset_id) REFERENCES scenario_training_goal_presets(id) ON DELETE RESTRICT
    ) STRICT;
    INSERT INTO scenario_training_goals SELECT * FROM scenario_training_goals_before_voice_behavior;

    CREATE TABLE scenario_skill_focuses (
      scenario_id INTEGER NOT NULL,
      skill_focus_preset_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (scenario_id, skill_focus_preset_id),
      UNIQUE (scenario_id, position),
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_focus_preset_id) REFERENCES scenario_skill_focus_presets(id) ON DELETE RESTRICT
    ) STRICT;
    INSERT INTO scenario_skill_focuses SELECT * FROM scenario_skill_focuses_before_voice_behavior;

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
    INSERT INTO scenario_success_criteria SELECT * FROM scenario_success_criteria_before_voice_behavior;

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
    INSERT INTO scenario_personas SELECT * FROM scenario_personas_before_voice_behavior;

    DROP TABLE scenario_personas_before_voice_behavior;
    DROP TABLE persona_personality_traits_before_voice_behavior;
    DROP TABLE persona_motivations_before_voice_behavior;
    DROP TABLE persona_concerns_before_voice_behavior;
    DROP TABLE scenario_training_goals_before_voice_behavior;
    DROP TABLE scenario_skill_focuses_before_voice_behavior;
    DROP TABLE scenario_success_criteria_before_voice_behavior;
    DROP TABLE personas_before_voice_behavior;
    DROP TABLE scenarios_before_voice_behavior;
  `);
}

/** Moves immutable resolved values between snapshot owners without rewriting history. */
export function moveConversationVoiceBehaviorToScenarioSnapshots(
  database: DatabaseSync,
): void {
  moveConversationVoiceBehavior(database, "");
}

/** Same snapshot migration for the frozen single-file database table names. */
export function moveCombinedConversationVoiceBehaviorToScenarioSnapshots(
  database: DatabaseSync,
): void {
  moveConversationVoiceBehavior(database, "conversation_");
}

function moveConversationVoiceBehavior(
  database: DatabaseSync,
  prefix: "" | "conversation_",
): void {
  const migrationSql = `
    ALTER TABLE persona_snapshots RENAME TO persona_snapshots_before_voice_behavior;
    ALTER TABLE scenario_snapshots RENAME TO scenario_snapshots_before_voice_behavior;

    CREATE TABLE persona_snapshots (
      conversation_id INTEGER PRIMARY KEY,
      source_persona_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 80),
      name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 80),
      gender TEXT NOT NULL CHECK (gender IN ('female', 'male', 'non_binary', 'unspecified')),
      age INTEGER CHECK (age IS NULL OR age BETWEEN 1 AND 120),
      occupation TEXT NOT NULL DEFAULT '' CHECK (length(occupation) <= 240),
      occupation_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(occupation_zh_cn) <= 240),
      background TEXT NOT NULL DEFAULT '' CHECK (length(background) <= 2000),
      background_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(background_zh_cn) <= 2000),
      personality_traits_json TEXT NOT NULL CHECK (json_valid(personality_traits_json) AND json_type(personality_traits_json) = 'array'),
      personality_traits_zh_cn_json TEXT NOT NULL CHECK (json_valid(personality_traits_zh_cn_json) AND json_type(personality_traits_zh_cn_json) = 'array'),
      communication_style TEXT NOT NULL DEFAULT '' CHECK (length(communication_style) <= 500),
      communication_style_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(communication_style_zh_cn) <= 500),
      behavior_notes TEXT NOT NULL DEFAULT '' CHECK (length(behavior_notes) <= 2000),
      behavior_notes_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(behavior_notes_zh_cn) <= 2000),
      motivations_json TEXT NOT NULL CHECK (json_valid(motivations_json) AND json_type(motivations_json) = 'array'),
      motivations_zh_cn_json TEXT NOT NULL CHECK (json_valid(motivations_zh_cn_json) AND json_type(motivations_zh_cn_json) = 'array'),
      concerns_json TEXT NOT NULL CHECK (json_valid(concerns_json) AND json_type(concerns_json) = 'array'),
      concerns_zh_cn_json TEXT NOT NULL CHECK (json_valid(concerns_zh_cn_json) AND json_type(concerns_zh_cn_json) = 'array'),
      voice TEXT NOT NULL CHECK (voice IN ('longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng')),
      source_created_at TEXT NOT NULL,
      source_updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES sessions(id) ON DELETE CASCADE
    ) STRICT;
    INSERT INTO persona_snapshots (
      conversation_id, source_persona_id, name, name_zh_cn, gender, age,
      occupation, occupation_zh_cn, background, background_zh_cn,
      personality_traits_json, personality_traits_zh_cn_json,
      communication_style, communication_style_zh_cn,
      behavior_notes, behavior_notes_zh_cn,
      motivations_json, motivations_zh_cn_json, concerns_json,
      concerns_zh_cn_json, voice, source_created_at, source_updated_at
    )
    SELECT
      conversation_id, source_persona_id, name, name_zh_cn, gender, age,
      occupation, occupation_zh_cn, background, background_zh_cn,
      personality_traits_json, personality_traits_zh_cn_json,
      communication_style, communication_style_zh_cn,
      behavior_notes, behavior_notes_zh_cn,
      motivations_json, motivations_zh_cn_json, concerns_json,
      concerns_zh_cn_json, voice, source_created_at, source_updated_at
    FROM persona_snapshots_before_voice_behavior;

    CREATE TABLE scenario_snapshots (
      conversation_id INTEGER PRIMARY KEY,
      source_scenario_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
      name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 120),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
      description_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(description_zh_cn) <= 2000),
      goals_json TEXT NOT NULL CHECK (json_valid(goals_json) AND json_type(goals_json) = 'array'),
      goals_zh_cn_json TEXT NOT NULL CHECK (json_valid(goals_zh_cn_json) AND json_type(goals_zh_cn_json) = 'array'),
      suggested_skill_focus_json TEXT NOT NULL CHECK (json_valid(suggested_skill_focus_json) AND json_type(suggested_skill_focus_json) = 'array'),
      suggested_skill_focus_zh_cn_json TEXT NOT NULL CHECK (json_valid(suggested_skill_focus_zh_cn_json) AND json_type(suggested_skill_focus_zh_cn_json) = 'array'),
      success_criteria_json TEXT NOT NULL CHECK (json_valid(success_criteria_json) AND json_type(success_criteria_json) = 'array'),
      success_criteria_zh_cn_json TEXT NOT NULL CHECK (json_valid(success_criteria_zh_cn_json) AND json_type(success_criteria_zh_cn_json) = 'array'),
      tone_style TEXT NOT NULL DEFAULT '' CHECK (length(tone_style) <= 500),
      tone_style_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(tone_style_zh_cn) <= 500),
      interrupt_frequency TEXT CHECK (interrupt_frequency IS NULL OR interrupt_frequency IN ('low', 'medium', 'high')),
      speaking_pace TEXT CHECK (speaking_pace IS NULL OR speaking_pace IN ('slow', 'normal', 'fast')),
      source_created_at TEXT NOT NULL,
      source_updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES sessions(id) ON DELETE CASCADE
    ) STRICT;
    INSERT INTO scenario_snapshots (
      conversation_id, source_scenario_id, name, name_zh_cn, description,
      description_zh_cn, goals_json, goals_zh_cn_json,
      suggested_skill_focus_json, suggested_skill_focus_zh_cn_json,
      success_criteria_json, success_criteria_zh_cn_json,
      tone_style, tone_style_zh_cn, interrupt_frequency, speaking_pace,
      source_created_at, source_updated_at
    )
    SELECT
      scenario.conversation_id, scenario.source_scenario_id,
      scenario.name, scenario.name_zh_cn, scenario.description,
      scenario.description_zh_cn, scenario.goals_json, scenario.goals_zh_cn_json,
      scenario.suggested_skill_focus_json,
      scenario.suggested_skill_focus_zh_cn_json,
      scenario.success_criteria_json, scenario.success_criteria_zh_cn_json,
      persona.tone_style, persona.tone_style_zh_cn,
      persona.interrupt_frequency, persona.speaking_pace,
      scenario.source_created_at, scenario.source_updated_at
    FROM scenario_snapshots_before_voice_behavior AS scenario
    JOIN persona_snapshots_before_voice_behavior AS persona
      ON persona.conversation_id = scenario.conversation_id;

    DROP TABLE persona_snapshots_before_voice_behavior;
    DROP TABLE scenario_snapshots_before_voice_behavior;
  `;
  database.exec(
    migrationSql
      .replaceAll("persona_snapshots", `${prefix}persona_snapshots`)
      .replaceAll("scenario_snapshots", `${prefix}scenario_snapshots`)
      .replaceAll("sessions", `${prefix}sessions`),
  );
}
