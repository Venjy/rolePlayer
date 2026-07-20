import type { DatabaseMigration } from "./migrations";
import { migrateCatalogRecordsToPresetReferences } from "./catalog-preset-reference-migration";
import { SPLIT_PRESET_TABLES_MIGRATION_SQL } from "./preset-storage";
import {
  moveCatalogVoiceBehaviorToScenarios,
  moveConversationVoiceBehaviorToScenarioSnapshots,
} from "./scenario-voice-behavior-migration";
import {
  addBilingualConversationFeedbackColumns,
  createConversationFeedbackSchema,
} from "./conversation-feedback-migration";
import { addConversationSessionLifecycleColumns } from "./conversation-session-lifecycle-migration";
import { makeScenarioScoringWeightsOptional } from "./optional-scenario-scoring-migration";

const createMigrationTable = `
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (
      strftime('%Y-%m-%dT%H:%M:%f+08:00', 'now', '+8 hours')
    )
  ) STRICT;
`;

export const LEGACY_SPLIT_SOURCE_KEY = "legacy_split_source";

const createDatabaseMetadataTable = `
  CREATE TABLE database_metadata (
    key TEXT PRIMARY KEY CHECK (length(trim(key)) BETWEEN 1 AND 100),
    value TEXT NOT NULL CHECK (length(value) <= 2000)
  ) STRICT;
`;

/** Fresh-schema migrations for role/persona/scenario configuration only. */
export const CATALOG_DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: "create_schema_migrations",
    up: createMigrationTable,
  },
  {
    version: 2,
    name: "create_catalog_schema",
    up: `
      CREATE TABLE personas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed_key TEXT UNIQUE
          CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
        name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 80),
        name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 80),
        gender TEXT NOT NULL
          CHECK (gender IN ('female', 'male', 'non_binary', 'unspecified')),
        age INTEGER CHECK (age IS NULL OR age BETWEEN 1 AND 120),
        occupation TEXT NOT NULL DEFAULT '' CHECK (length(occupation) <= 240),
        occupation_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(occupation_zh_cn) <= 240),
        background TEXT NOT NULL DEFAULT '' CHECK (length(background) <= 2000),
        background_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(background_zh_cn) <= 2000),
        personality_traits_json TEXT NOT NULL
          CHECK (json_valid(personality_traits_json) AND json_type(personality_traits_json) = 'array'),
        personality_traits_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(personality_traits_zh_cn_json) AND json_type(personality_traits_zh_cn_json) = 'array'),
        communication_style TEXT NOT NULL DEFAULT '' CHECK (length(communication_style) <= 500),
        communication_style_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(communication_style_zh_cn) <= 500),
        tone_style TEXT NOT NULL DEFAULT '' CHECK (length(tone_style) <= 160),
        tone_style_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(tone_style_zh_cn) <= 160),
        behavior_notes TEXT NOT NULL DEFAULT '' CHECK (length(behavior_notes) <= 2000),
        behavior_notes_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(behavior_notes_zh_cn) <= 2000),
        motivations_json TEXT NOT NULL
          CHECK (json_valid(motivations_json) AND json_type(motivations_json) = 'array'),
        motivations_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(motivations_zh_cn_json) AND json_type(motivations_zh_cn_json) = 'array'),
        concerns_json TEXT NOT NULL
          CHECK (json_valid(concerns_json) AND json_type(concerns_json) = 'array'),
        concerns_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(concerns_zh_cn_json) AND json_type(concerns_zh_cn_json) = 'array'),
        voice TEXT NOT NULL
          CHECK (voice IN ('longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng')),
        interrupt_frequency TEXT NOT NULL
          CHECK (interrupt_frequency IN ('low', 'medium', 'high')),
        speaking_pace TEXT NOT NULL
          CHECK (speaking_pace IN ('slow', 'normal', 'fast')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (length(trim(name)) > 0 OR length(trim(name_zh_cn)) > 0),
        CHECK (length(trim(occupation)) > 0 OR length(trim(occupation_zh_cn)) > 0),
        CHECK (
          json_array_length(personality_traits_json) > 0
          OR json_array_length(personality_traits_zh_cn_json) > 0
        ),
        CHECK (
          length(trim(communication_style)) > 0
          OR length(trim(communication_style_zh_cn)) > 0
        ),
        CHECK (length(trim(tone_style)) > 0 OR length(trim(tone_style_zh_cn)) > 0)
      ) STRICT;

      CREATE UNIQUE INDEX personas_name_en_idx
        ON personas(name COLLATE NOCASE)
        WHERE length(trim(name)) > 0;
      CREATE UNIQUE INDEX personas_name_zh_cn_idx
        ON personas(name_zh_cn COLLATE NOCASE)
        WHERE length(trim(name_zh_cn)) > 0;

      CREATE TABLE scenarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed_key TEXT UNIQUE
          CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
        name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
        name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 120),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
        description_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(description_zh_cn) <= 2000),
        goals_json TEXT NOT NULL
          CHECK (json_valid(goals_json) AND json_type(goals_json) = 'array'),
        goals_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(goals_zh_cn_json) AND json_type(goals_zh_cn_json) = 'array'),
        suggested_skill_focus_json TEXT NOT NULL
          CHECK (json_valid(suggested_skill_focus_json) AND json_type(suggested_skill_focus_json) = 'array'),
        suggested_skill_focus_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(suggested_skill_focus_zh_cn_json) AND json_type(suggested_skill_focus_zh_cn_json) = 'array'),
        success_criteria_json TEXT NOT NULL
          CHECK (json_valid(success_criteria_json) AND json_type(success_criteria_json) = 'array'),
        success_criteria_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(success_criteria_zh_cn_json) AND json_type(success_criteria_zh_cn_json) = 'array'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (length(trim(name)) > 0 OR length(trim(name_zh_cn)) > 0),
        CHECK (length(trim(description)) > 0 OR length(trim(description_zh_cn)) > 0),
        CHECK (json_array_length(goals_json) > 0 OR json_array_length(goals_zh_cn_json) > 0),
        CHECK (
          json_array_length(suggested_skill_focus_json) > 0
          OR json_array_length(suggested_skill_focus_zh_cn_json) > 0
        ),
        CHECK (
          json_array_length(success_criteria_json) > 0
          OR json_array_length(success_criteria_zh_cn_json) > 0
        )
      ) STRICT;

      CREATE UNIQUE INDEX scenarios_name_en_idx
        ON scenarios(name COLLATE NOCASE)
        WHERE length(trim(name)) > 0;
      CREATE UNIQUE INDEX scenarios_name_zh_cn_idx
        ON scenarios(name_zh_cn COLLATE NOCASE)
        WHERE length(trim(name_zh_cn)) > 0;

      CREATE TABLE persona_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed_key TEXT UNIQUE
          CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
        category TEXT NOT NULL
          CHECK (category IN ('occupation', 'personality_trait', 'communication_style', 'tone_style', 'motivation', 'concern')),
        value TEXT NOT NULL DEFAULT '' CHECK (length(value) <= 500),
        value_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(value_zh_cn) <= 500),
        position INTEGER NOT NULL CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (category, position),
        CHECK (length(trim(value)) > 0 OR length(trim(value_zh_cn)) > 0)
      ) STRICT;

      CREATE UNIQUE INDEX persona_presets_value_en_idx
        ON persona_presets(category, value COLLATE NOCASE)
        WHERE length(trim(value)) > 0;
      CREATE UNIQUE INDEX persona_presets_value_zh_cn_idx
        ON persona_presets(category, value_zh_cn COLLATE NOCASE)
        WHERE length(trim(value_zh_cn)) > 0;

      CREATE TABLE scenario_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed_key TEXT UNIQUE
          CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
        category TEXT NOT NULL
          CHECK (category IN ('training_goal', 'skill_focus', 'success_criterion')),
        value TEXT NOT NULL DEFAULT '' CHECK (length(value) <= 500),
        value_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(value_zh_cn) <= 500),
        position INTEGER NOT NULL CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (category, position),
        CHECK (length(trim(value)) > 0 OR length(trim(value_zh_cn)) > 0)
      ) STRICT;

      CREATE UNIQUE INDEX scenario_presets_value_en_idx
        ON scenario_presets(category, value COLLATE NOCASE)
        WHERE length(trim(value)) > 0;
      CREATE UNIQUE INDEX scenario_presets_value_zh_cn_idx
        ON scenario_presets(category, value_zh_cn COLLATE NOCASE)
        WHERE length(trim(value_zh_cn)) > 0;

      CREATE TABLE scenario_scoring_criteria (
        scenario_id INTEGER NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 160),
        name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 160),
        weight INTEGER NOT NULL CHECK (weight BETWEEN 0 AND 100),
        PRIMARY KEY (scenario_id, position),
        FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
        CHECK (length(trim(name)) > 0 OR length(trim(name_zh_cn)) > 0)
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

      CREATE INDEX scenario_personas_persona_id_idx
        ON scenario_personas(persona_id);
      CREATE UNIQUE INDEX scenario_personas_scenario_position_idx
        ON scenario_personas(scenario_id, position);
    `,
  },
  {
    version: 3,
    name: "create_database_metadata",
    up: createDatabaseMetadataTable,
  },
  {
    version: 4,
    name: "split_preset_categories_into_tables",
    up: SPLIT_PRESET_TABLES_MIGRATION_SQL,
  },
  {
    version: 5,
    name: "reference_catalog_presets_by_id",
    up: migrateCatalogRecordsToPresetReferences,
  },
  {
    version: 6,
    name: "create_qwen_voice_catalog",
    up: `
      CREATE TABLE qwen_voices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed_key TEXT UNIQUE
          CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
        voice TEXT NOT NULL UNIQUE
          CHECK (voice IN ('longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng')),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
        name_zh_cn TEXT NOT NULL CHECK (length(trim(name_zh_cn)) BETWEEN 1 AND 120),
        position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 7,
    name: "move_voice_behavior_to_scenarios",
    up: moveCatalogVoiceBehaviorToScenarios,
  },
  {
    version: 8,
    name: "record_qwen_voice_gender",
    up: `
      ALTER TABLE qwen_voices ADD COLUMN gender TEXT NOT NULL DEFAULT 'female'
        CHECK (gender IN ('female', 'male'));
      UPDATE qwen_voices SET gender = 'male' WHERE voice = 'longanlufeng';
    `,
  },
  {
    version: 9,
    name: "make_scenario_scoring_weights_optional",
    up: makeScenarioScoringWeightsOptional,
  },
];

/** Fresh-schema migrations for immutable session snapshots and messages only. */
export const CONVERSATION_DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: "create_schema_migrations",
    up: createMigrationTable,
  },
  {
    version: 2,
    name: "create_conversation_schema",
    up: `
      CREATE TABLE conversation_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
        locale TEXT NOT NULL CHECK (locale IN ('en', 'zh')),
        instructions TEXT NOT NULL CHECK (length(trim(instructions)) BETWEEN 1 AND 12000),
        voice TEXT NOT NULL
          CHECK (voice IN ('longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE conversation_persona_snapshots (
        conversation_id INTEGER PRIMARY KEY,
        source_persona_id INTEGER NOT NULL,
        name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 80),
        name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 80),
        gender TEXT NOT NULL
          CHECK (gender IN ('female', 'male', 'non_binary', 'unspecified')),
        age INTEGER CHECK (age IS NULL OR age BETWEEN 1 AND 120),
        occupation TEXT NOT NULL DEFAULT '' CHECK (length(occupation) <= 240),
        occupation_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(occupation_zh_cn) <= 240),
        background TEXT NOT NULL DEFAULT '' CHECK (length(background) <= 2000),
        background_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(background_zh_cn) <= 2000),
        personality_traits_json TEXT NOT NULL
          CHECK (json_valid(personality_traits_json) AND json_type(personality_traits_json) = 'array'),
        personality_traits_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(personality_traits_zh_cn_json) AND json_type(personality_traits_zh_cn_json) = 'array'),
        communication_style TEXT NOT NULL DEFAULT '' CHECK (length(communication_style) <= 500),
        communication_style_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(communication_style_zh_cn) <= 500),
        tone_style TEXT NOT NULL DEFAULT '' CHECK (length(tone_style) <= 160),
        tone_style_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(tone_style_zh_cn) <= 160),
        behavior_notes TEXT NOT NULL DEFAULT '' CHECK (length(behavior_notes) <= 2000),
        behavior_notes_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(behavior_notes_zh_cn) <= 2000),
        motivations_json TEXT NOT NULL
          CHECK (json_valid(motivations_json) AND json_type(motivations_json) = 'array'),
        motivations_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(motivations_zh_cn_json) AND json_type(motivations_zh_cn_json) = 'array'),
        concerns_json TEXT NOT NULL
          CHECK (json_valid(concerns_json) AND json_type(concerns_json) = 'array'),
        concerns_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(concerns_zh_cn_json) AND json_type(concerns_zh_cn_json) = 'array'),
        voice TEXT NOT NULL
          CHECK (voice IN ('longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng')),
        interrupt_frequency TEXT NOT NULL
          CHECK (interrupt_frequency IN ('low', 'medium', 'high')),
        speaking_pace TEXT NOT NULL
          CHECK (speaking_pace IN ('slow', 'normal', 'fast')),
        source_created_at TEXT NOT NULL,
        source_updated_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE conversation_scenario_snapshots (
        conversation_id INTEGER PRIMARY KEY,
        source_scenario_id INTEGER NOT NULL,
        name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
        name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 120),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
        description_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(description_zh_cn) <= 2000),
        goals_json TEXT NOT NULL
          CHECK (json_valid(goals_json) AND json_type(goals_json) = 'array'),
        goals_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(goals_zh_cn_json) AND json_type(goals_zh_cn_json) = 'array'),
        suggested_skill_focus_json TEXT NOT NULL
          CHECK (json_valid(suggested_skill_focus_json) AND json_type(suggested_skill_focus_json) = 'array'),
        suggested_skill_focus_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(suggested_skill_focus_zh_cn_json) AND json_type(suggested_skill_focus_zh_cn_json) = 'array'),
        success_criteria_json TEXT NOT NULL
          CHECK (json_valid(success_criteria_json) AND json_type(success_criteria_json) = 'array'),
        success_criteria_zh_cn_json TEXT NOT NULL
          CHECK (json_valid(success_criteria_zh_cn_json) AND json_type(success_criteria_zh_cn_json) = 'array'),
        source_created_at TEXT NOT NULL,
        source_updated_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE conversation_scenario_scoring_criteria (
        conversation_id INTEGER NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 160),
        name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 160),
        weight INTEGER NOT NULL CHECK (weight BETWEEN 0 AND 100),
        PRIMARY KEY (conversation_id, position),
        FOREIGN KEY (conversation_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE conversation_scenario_personas (
        conversation_id INTEGER NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        persona_id INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, position),
        FOREIGN KEY (conversation_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 100000),
        interrupted INTEGER NOT NULL DEFAULT 0 CHECK (interrupted IN (0, 1)),
        source_item_id TEXT
          CHECK (source_item_id IS NULL OR length(trim(source_item_id)) BETWEEN 1 AND 200),
        response_id TEXT
          CHECK (response_id IS NULL OR length(trim(response_id)) BETWEEN 1 AND 200),
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE,
        UNIQUE (conversation_id, position)
      ) STRICT;

      CREATE INDEX conversation_sessions_updated_at_idx
        ON conversation_sessions(updated_at DESC, id DESC);
      CREATE UNIQUE INDEX conversation_messages_source_item_idx
        ON conversation_messages(conversation_id, source_item_id)
        WHERE source_item_id IS NOT NULL;
      CREATE UNIQUE INDEX conversation_messages_response_idx
        ON conversation_messages(conversation_id, response_id)
        WHERE response_id IS NOT NULL;
    `,
  },
  {
    version: 3,
    name: "create_database_metadata",
    up: createDatabaseMetadataTable,
  },
  {
    version: 4,
    name: "remove_redundant_conversation_table_prefixes",
    up: `
      DROP INDEX conversation_sessions_updated_at_idx;
      DROP INDEX conversation_messages_source_item_idx;
      DROP INDEX conversation_messages_response_idx;

      ALTER TABLE conversation_persona_snapshots RENAME TO persona_snapshots;
      ALTER TABLE conversation_scenario_snapshots RENAME TO scenario_snapshots;
      ALTER TABLE conversation_scenario_scoring_criteria RENAME TO scenario_scoring_criteria;
      ALTER TABLE conversation_scenario_personas RENAME TO scenario_personas;
      ALTER TABLE conversation_messages RENAME TO messages;
      ALTER TABLE conversation_sessions RENAME TO sessions;

      CREATE INDEX sessions_updated_at_idx
        ON sessions(updated_at DESC, id DESC);
      CREATE UNIQUE INDEX messages_source_item_idx
        ON messages(conversation_id, source_item_id)
        WHERE source_item_id IS NOT NULL;
      CREATE UNIQUE INDEX messages_response_idx
        ON messages(conversation_id, response_id)
        WHERE response_id IS NOT NULL;
    `,
  },
  {
    version: 5,
    name: "persist_finalized_message_audio",
    up: `
      CREATE TABLE message_audio (
        message_id INTEGER PRIMARY KEY,
        sample_rate INTEGER NOT NULL CHECK (sample_rate IN (16000, 24000)),
        pcm BLOB NOT NULL
          CHECK (length(pcm) > 0 AND length(pcm) % 2 = 0),
        duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      ) STRICT;
    `,
  },
  {
    version: 6,
    name: "move_voice_behavior_to_scenario_snapshots",
    up: moveConversationVoiceBehaviorToScenarioSnapshots,
  },
  {
    version: 7,
    name: "create_conversation_feedback",
    up: createConversationFeedbackSchema,
  },
  {
    version: 8,
    name: "make_conversation_feedback_bilingual",
    up: addBilingualConversationFeedbackColumns,
  },
  {
    version: 9,
    name: "add_conversation_pause_and_active_duration",
    up: addConversationSessionLifecycleColumns,
  },
];
