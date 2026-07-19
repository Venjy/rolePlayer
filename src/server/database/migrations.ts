import type { DatabaseSync } from "node:sqlite";
import { migrateCatalogRecordsToPresetReferences } from "./catalog-preset-reference-migration";
import { SPLIT_PRESET_TABLES_MIGRATION_SQL } from "./preset-storage";
import {
  moveCatalogVoiceBehaviorToScenarios,
  moveCombinedConversationVoiceBehaviorToScenarioSnapshots,
} from "./scenario-voice-behavior-migration";
import { createCombinedConversationFeedbackSchema } from "./conversation-feedback-migration";

/**
 * A migration is immutable after it has reached a deployed environment.
 * Add a new, monotonically increasing version instead of editing old entries.
 */
export interface DatabaseMigration {
  version: number;
  name: string;
  up: string | ((database: DatabaseSync) => void);
}

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: "create_schema_migrations",
    up: `
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: "create_role_play_catalog",
    up: `
      CREATE TABLE personas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE
          CHECK (length(trim(name)) BETWEEN 1 AND 80),
        gender TEXT NOT NULL
          CHECK (gender IN ('female', 'male', 'non_binary', 'unspecified')),
        age INTEGER
          CHECK (age IS NULL OR age BETWEEN 1 AND 120),
        occupation TEXT NOT NULL
          CHECK (length(occupation) <= 120),
        identity TEXT NOT NULL
          CHECK (length(trim(identity)) BETWEEN 1 AND 240),
        background TEXT NOT NULL
          CHECK (length(background) <= 2000),
        personality_traits_json TEXT NOT NULL
          CHECK (
            json_valid(personality_traits_json)
            AND json_type(personality_traits_json) = 'array'
          ),
        communication_style TEXT NOT NULL
          CHECK (length(trim(communication_style)) BETWEEN 1 AND 500),
        behavior_notes TEXT NOT NULL
          CHECK (length(behavior_notes) <= 2000),
        motivations_json TEXT NOT NULL
          CHECK (
            json_valid(motivations_json)
            AND json_type(motivations_json) = 'array'
          ),
        concerns_json TEXT NOT NULL
          CHECK (
            json_valid(concerns_json)
            AND json_type(concerns_json) = 'array'
          ),
        voice TEXT NOT NULL
          CHECK (
            voice IN (
              'longanqian',
              'longanlingxin',
              'longanlingxi',
              'longanxiaoxin',
              'longanlufeng'
            )
          ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE scenarios (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE
          CHECK (length(trim(name)) BETWEEN 1 AND 120),
        description TEXT NOT NULL
          CHECK (length(trim(description)) BETWEEN 1 AND 2000),
        goals_json TEXT NOT NULL
          CHECK (
            json_valid(goals_json)
            AND json_type(goals_json) = 'array'
          ),
        suggested_skill_focus_json TEXT NOT NULL
          CHECK (
            json_valid(suggested_skill_focus_json)
            AND json_type(suggested_skill_focus_json) = 'array'
          ),
        success_criteria_json TEXT NOT NULL
          CHECK (
            json_valid(success_criteria_json)
            AND json_type(success_criteria_json) = 'array'
          ),
        scoring_criteria_json TEXT NOT NULL
          CHECK (
            json_valid(scoring_criteria_json)
            AND json_type(scoring_criteria_json) = 'array'
          ),
        voice_behavior_json TEXT NOT NULL
          CHECK (
            json_valid(voice_behavior_json)
            AND json_type(voice_behavior_json) = 'object'
          ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE scenario_personas (
        scenario_id TEXT NOT NULL,
        persona_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (scenario_id, persona_id),
        FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
        FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX scenario_personas_persona_id_idx
        ON scenario_personas(persona_id);
    `,
  },
  {
    version: 3,
    name: "add_scenario_persona_position",
    up: `
      ALTER TABLE scenario_personas
        ADD COLUMN position INTEGER NOT NULL DEFAULT 0
        CHECK (position >= 0);

      UPDATE scenario_personas AS current
      SET position = (
        SELECT COUNT(*)
        FROM scenario_personas AS earlier
        WHERE earlier.scenario_id = current.scenario_id
          AND (
            earlier.created_at < current.created_at
            OR (
              earlier.created_at = current.created_at
              AND earlier.persona_id < current.persona_id
            )
          )
      );

      CREATE UNIQUE INDEX scenario_personas_scenario_position_idx
        ON scenario_personas(scenario_id, position);
    `,
  },
  {
    version: 4,
    name: "create_persona_presets",
    up: `
      CREATE TABLE persona_presets (
        id TEXT PRIMARY KEY
          CHECK (length(trim(id)) BETWEEN 1 AND 100),
        category TEXT NOT NULL
          CHECK (
            category IN (
              'identity',
              'occupation',
              'personality_trait',
              'communication_style',
              'motivation',
              'concern'
            )
          ),
        value TEXT NOT NULL COLLATE NOCASE
          CHECK (length(trim(value)) BETWEEN 1 AND 500),
        position INTEGER NOT NULL
          CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (category, value),
        UNIQUE (category, position)
      ) STRICT;
    `,
  },
  {
    version: 5,
    name: "add_persona_preset_english_value",
    up: `
      ALTER TABLE persona_presets
        ADD COLUMN value_en TEXT NOT NULL DEFAULT ''
        CHECK (length(value_en) <= 500);
    `,
  },
  {
    version: 6,
    name: "create_conversation_history",
    up: `
      CREATE TABLE conversation_sessions (
        id TEXT PRIMARY KEY
          CHECK (length(trim(id)) BETWEEN 1 AND 100),
        persona_json TEXT NOT NULL
          CHECK (
            json_valid(persona_json)
            AND json_type(persona_json) = 'object'
          ),
        scenario_json TEXT NOT NULL
          CHECK (
            json_valid(scenario_json)
            AND json_type(scenario_json) = 'object'
          ),
        difficulty TEXT NOT NULL
          CHECK (difficulty IN ('easy', 'medium', 'hard')),
        locale TEXT NOT NULL
          CHECK (locale IN ('en', 'zh')),
        instructions TEXT NOT NULL
          CHECK (length(trim(instructions)) BETWEEN 1 AND 12000),
        voice TEXT NOT NULL
          CHECK (
            voice IN (
              'longanqian',
              'longanlingxin',
              'longanlingxi',
              'longanxiaoxin',
              'longanlufeng'
            )
          ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE conversation_messages (
        id TEXT PRIMARY KEY
          CHECK (length(trim(id)) BETWEEN 1 AND 100),
        conversation_id TEXT NOT NULL,
        position INTEGER NOT NULL
          CHECK (position >= 0),
        role TEXT NOT NULL
          CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL
          CHECK (length(trim(text)) BETWEEN 1 AND 100000),
        interrupted INTEGER NOT NULL DEFAULT 0
          CHECK (interrupted IN (0, 1)),
        source_item_id TEXT
          CHECK (
            source_item_id IS NULL
            OR length(trim(source_item_id)) BETWEEN 1 AND 200
          ),
        response_id TEXT
          CHECK (
            response_id IS NULL
            OR length(trim(response_id)) BETWEEN 1 AND 200
          ),
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id)
          REFERENCES conversation_sessions(id) ON DELETE CASCADE,
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
    version: 7,
    name: "move_tone_style_to_personas",
    up: `
      ALTER TABLE personas
        ADD COLUMN tone_style TEXT NOT NULL DEFAULT 'Professional and composed'
        CHECK (length(trim(tone_style)) BETWEEN 1 AND 160);

      ALTER TABLE persona_presets RENAME TO persona_presets_before_tone_style;

      CREATE TABLE persona_presets (
        id TEXT PRIMARY KEY
          CHECK (length(trim(id)) BETWEEN 1 AND 100),
        category TEXT NOT NULL
          CHECK (
            category IN (
              'identity',
              'occupation',
              'personality_trait',
              'communication_style',
              'tone_style',
              'motivation',
              'concern'
            )
          ),
        value TEXT NOT NULL COLLATE NOCASE
          CHECK (length(trim(value)) BETWEEN 1 AND 500),
        position INTEGER NOT NULL
          CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        value_en TEXT NOT NULL DEFAULT ''
          CHECK (length(value_en) <= 500),
        UNIQUE (category, value),
        UNIQUE (category, position)
      ) STRICT;

      INSERT INTO persona_presets (
        id, category, value, position, created_at, updated_at, value_en
      )
      SELECT id, category, value, position, created_at, updated_at, value_en
      FROM persona_presets_before_tone_style;

      DROP TABLE persona_presets_before_tone_style;

      UPDATE conversation_sessions
      SET persona_json = json_set(
        persona_json,
        '$.toneStyle',
        COALESCE(
          (
            SELECT tone_style
            FROM personas
            WHERE personas.id = json_extract(persona_json, '$.id')
          ),
          'Professional and composed'
        )
      )
      WHERE json_extract(persona_json, '$.toneStyle') IS NULL;
    `,
  },
  {
    version: 8,
    name: "store_bilingual_catalog_content",
    up: `
      DELETE FROM persona_presets WHERE category = 'occupation';

      ALTER TABLE personas
        ADD COLUMN content_zh_json TEXT NOT NULL DEFAULT '{}'
        CHECK (
          json_valid(content_zh_json)
          AND json_type(content_zh_json) = 'object'
        );

      ALTER TABLE personas
        ADD COLUMN content_en_json TEXT NOT NULL DEFAULT '{}'
        CHECK (
          json_valid(content_en_json)
          AND json_type(content_en_json) = 'object'
        );

      UPDATE personas
      SET content_zh_json = json_object(
        'name', name,
        'identity', identity,
        'background', background,
        'personalityTraits', json(personality_traits_json),
        'communicationStyle', communication_style,
        'toneStyle', tone_style,
        'behaviorNotes', behavior_notes,
        'motivations', json(motivations_json),
        'concerns', json(concerns_json)
      ),
      content_en_json = json_object(
        'name', '',
        'identity', '',
        'background', '',
        'personalityTraits', json('[]'),
        'communicationStyle', '',
        'toneStyle', '',
        'behaviorNotes', '',
        'motivations', json('[]'),
        'concerns', json('[]')
      );

      ALTER TABLE scenarios
        ADD COLUMN content_zh_json TEXT NOT NULL DEFAULT '{}'
        CHECK (
          json_valid(content_zh_json)
          AND json_type(content_zh_json) = 'object'
        );

      ALTER TABLE scenarios
        ADD COLUMN content_en_json TEXT NOT NULL DEFAULT '{}'
        CHECK (
          json_valid(content_en_json)
          AND json_type(content_en_json) = 'object'
        );

      UPDATE scenarios
      SET content_zh_json = json_object(
        'name', name,
        'description', description,
        'goals', json(goals_json),
        'suggestedSkillFocus', json(suggested_skill_focus_json),
        'successCriteria', json(success_criteria_json)
      ),
      content_en_json = json_object(
        'name', '',
        'description', '',
        'goals', json('[]'),
        'suggestedSkillFocus', json('[]'),
        'successCriteria', json('[]')
      );

      CREATE TABLE scenario_presets (
        id TEXT PRIMARY KEY
          CHECK (length(trim(id)) BETWEEN 1 AND 100),
        category TEXT NOT NULL
          CHECK (
            category IN (
              'training_goal',
              'skill_focus',
              'success_criterion'
            )
          ),
        value TEXT NOT NULL COLLATE NOCASE
          CHECK (length(trim(value)) BETWEEN 1 AND 500),
        value_en TEXT NOT NULL DEFAULT ''
          CHECK (length(value_en) <= 500),
        position INTEGER NOT NULL
          CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (category, value),
        UNIQUE (category, position)
      ) STRICT;
    `,
  },
  {
    version: 9,
    name: "retire_legacy_migration_seed",
    up: `
      DELETE FROM scenarios
      WHERE id = 'scenario_sales_discovery'
        AND created_at = updated_at
        AND COALESCE(json_extract(content_en_json, '$.name'), '') = '';

      DELETE FROM personas
      WHERE id = 'persona_alex'
        AND created_at = updated_at
        AND COALESCE(json_extract(content_en_json, '$.name'), '') = '';
    `,
  },
  {
    version: 10,
    name: "move_voice_behavior_to_personas",
    up: `
      ALTER TABLE personas
        ADD COLUMN persona_voice_behavior_json TEXT NOT NULL DEFAULT (
          '{"interruptFrequency":"medium","speakingPace":"normal"}'
        )
        CHECK (
          json_valid(persona_voice_behavior_json)
          AND json_type(persona_voice_behavior_json) = 'object'
      );
    `,
  },
  {
    version: 11,
    name: "use_autoincrement_record_ids",
    up: `
      CREATE TEMP TABLE scenario_personas_v11_backup AS
      SELECT scenario_id, persona_id, position, created_at
      FROM scenario_personas;

      DROP TABLE scenario_personas;

      CREATE TABLE personas_v11 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed_key TEXT UNIQUE
          CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
        name TEXT NOT NULL COLLATE NOCASE UNIQUE
          CHECK (length(trim(name)) BETWEEN 1 AND 80),
        gender TEXT NOT NULL
          CHECK (gender IN ('female', 'male', 'non_binary', 'unspecified')),
        age INTEGER CHECK (age IS NULL OR age BETWEEN 1 AND 120),
        occupation TEXT NOT NULL CHECK (length(occupation) <= 120),
        identity TEXT NOT NULL CHECK (length(trim(identity)) BETWEEN 1 AND 240),
        background TEXT NOT NULL CHECK (length(background) <= 2000),
        personality_traits_json TEXT NOT NULL
          CHECK (json_valid(personality_traits_json) AND json_type(personality_traits_json) = 'array'),
        communication_style TEXT NOT NULL
          CHECK (length(trim(communication_style)) BETWEEN 1 AND 500),
        behavior_notes TEXT NOT NULL CHECK (length(behavior_notes) <= 2000),
        motivations_json TEXT NOT NULL
          CHECK (json_valid(motivations_json) AND json_type(motivations_json) = 'array'),
        concerns_json TEXT NOT NULL
          CHECK (json_valid(concerns_json) AND json_type(concerns_json) = 'array'),
        voice TEXT NOT NULL
          CHECK (voice IN ('longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng')),
        tone_style TEXT NOT NULL CHECK (length(trim(tone_style)) BETWEEN 1 AND 160),
        content_zh_json TEXT NOT NULL
          CHECK (json_valid(content_zh_json) AND json_type(content_zh_json) = 'object'),
        content_en_json TEXT NOT NULL
          CHECK (json_valid(content_en_json) AND json_type(content_en_json) = 'object'),
        persona_voice_behavior_json TEXT NOT NULL
          CHECK (json_valid(persona_voice_behavior_json) AND json_type(persona_voice_behavior_json) = 'object'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO personas_v11 (
        seed_key, name, gender, age, occupation, identity, background,
        personality_traits_json, communication_style, behavior_notes,
        motivations_json, concerns_json, voice, tone_style, content_zh_json,
        content_en_json, persona_voice_behavior_json, created_at, updated_at
      )
      SELECT
        id, name, gender, age, occupation, identity, background,
        personality_traits_json, communication_style, behavior_notes,
        motivations_json, concerns_json, voice, tone_style, content_zh_json,
        content_en_json, persona_voice_behavior_json, created_at, updated_at
      FROM personas
      ORDER BY rowid;

      CREATE TEMP TABLE persona_id_v11_map AS
      SELECT old.id AS old_id, current.id AS new_id
      FROM personas AS old
      JOIN personas_v11 AS current ON current.seed_key = old.id;

      CREATE TABLE scenarios_v11 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed_key TEXT UNIQUE
          CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
        name TEXT NOT NULL COLLATE NOCASE UNIQUE
          CHECK (length(trim(name)) BETWEEN 1 AND 120),
        description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 2000),
        goals_json TEXT NOT NULL
          CHECK (json_valid(goals_json) AND json_type(goals_json) = 'array'),
        suggested_skill_focus_json TEXT NOT NULL
          CHECK (json_valid(suggested_skill_focus_json) AND json_type(suggested_skill_focus_json) = 'array'),
        success_criteria_json TEXT NOT NULL
          CHECK (json_valid(success_criteria_json) AND json_type(success_criteria_json) = 'array'),
        scoring_criteria_json TEXT NOT NULL
          CHECK (json_valid(scoring_criteria_json) AND json_type(scoring_criteria_json) = 'array'),
        voice_behavior_json TEXT NOT NULL
          CHECK (json_valid(voice_behavior_json) AND json_type(voice_behavior_json) = 'object'),
        content_zh_json TEXT NOT NULL
          CHECK (json_valid(content_zh_json) AND json_type(content_zh_json) = 'object'),
        content_en_json TEXT NOT NULL
          CHECK (json_valid(content_en_json) AND json_type(content_en_json) = 'object'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO scenarios_v11 (
        seed_key, name, description, goals_json, suggested_skill_focus_json,
        success_criteria_json, scoring_criteria_json, voice_behavior_json,
        content_zh_json, content_en_json, created_at, updated_at
      )
      SELECT
        id, name, description, goals_json, suggested_skill_focus_json,
        success_criteria_json, scoring_criteria_json, voice_behavior_json,
        content_zh_json, content_en_json, created_at, updated_at
      FROM scenarios
      ORDER BY rowid;

      CREATE TEMP TABLE scenario_id_v11_map AS
      SELECT old.id AS old_id, current.id AS new_id
      FROM scenarios AS old
      JOIN scenarios_v11 AS current ON current.seed_key = old.id;

      DROP TABLE personas;
      DROP TABLE scenarios;
      ALTER TABLE personas_v11 RENAME TO personas;
      ALTER TABLE scenarios_v11 RENAME TO scenarios;

      CREATE TABLE scenario_personas (
        scenario_id INTEGER NOT NULL,
        persona_id INTEGER NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        created_at TEXT NOT NULL,
        PRIMARY KEY (scenario_id, persona_id),
        FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
        FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE RESTRICT
      ) STRICT;

      INSERT INTO scenario_personas (scenario_id, persona_id, position, created_at)
      SELECT scenarios.new_id, personas.new_id, links.position, links.created_at
      FROM scenario_personas_v11_backup AS links
      JOIN scenario_id_v11_map AS scenarios ON scenarios.old_id = links.scenario_id
      JOIN persona_id_v11_map AS personas ON personas.old_id = links.persona_id;

      CREATE INDEX scenario_personas_persona_id_idx
        ON scenario_personas(persona_id);
      CREATE UNIQUE INDEX scenario_personas_scenario_position_idx
        ON scenario_personas(scenario_id, position);

      CREATE TABLE persona_presets_v11 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed_key TEXT UNIQUE
          CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
        category TEXT NOT NULL
          CHECK (category IN ('occupation', 'personality_trait', 'communication_style', 'tone_style', 'motivation', 'concern')),
        value TEXT NOT NULL COLLATE NOCASE
          CHECK (length(trim(value)) BETWEEN 1 AND 500),
        value_en TEXT NOT NULL DEFAULT '' CHECK (length(value_en) <= 500),
        position INTEGER NOT NULL CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (category, value),
        UNIQUE (category, position)
      ) STRICT;

      INSERT INTO persona_presets_v11 (
        seed_key, category, value, value_en, position, created_at, updated_at
      )
      SELECT id, category, value, value_en, position, created_at, updated_at
      FROM persona_presets
      WHERE category <> 'identity'
      ORDER BY rowid;

      DROP TABLE persona_presets;
      ALTER TABLE persona_presets_v11 RENAME TO persona_presets;

      CREATE TABLE scenario_presets_v11 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed_key TEXT UNIQUE
          CHECK (seed_key IS NULL OR length(trim(seed_key)) BETWEEN 1 AND 100),
        category TEXT NOT NULL
          CHECK (category IN ('training_goal', 'skill_focus', 'success_criterion')),
        value TEXT NOT NULL COLLATE NOCASE
          CHECK (length(trim(value)) BETWEEN 1 AND 500),
        value_en TEXT NOT NULL DEFAULT '' CHECK (length(value_en) <= 500),
        position INTEGER NOT NULL CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (category, value),
        UNIQUE (category, position)
      ) STRICT;

      INSERT INTO scenario_presets_v11 (
        seed_key, category, value, value_en, position, created_at, updated_at
      )
      SELECT id, category, value, value_en, position, created_at, updated_at
      FROM scenario_presets
      ORDER BY rowid;

      DROP TABLE scenario_presets;
      ALTER TABLE scenario_presets_v11 RENAME TO scenario_presets;

      CREATE TEMP TABLE conversation_messages_v11_backup AS
      SELECT * FROM conversation_messages;

      DROP TABLE conversation_messages;

      CREATE TABLE conversation_sessions_v11_stage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        legacy_id TEXT NOT NULL UNIQUE,
        persona_json TEXT NOT NULL
          CHECK (json_valid(persona_json) AND json_type(persona_json) = 'object'),
        scenario_json TEXT NOT NULL
          CHECK (json_valid(scenario_json) AND json_type(scenario_json) = 'object'),
        difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
        locale TEXT NOT NULL CHECK (locale IN ('en', 'zh')),
        instructions TEXT NOT NULL CHECK (length(trim(instructions)) BETWEEN 1 AND 12000),
        voice TEXT NOT NULL
          CHECK (voice IN ('longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO conversation_sessions_v11_stage (
        legacy_id, persona_json, scenario_json, difficulty, locale,
        instructions, voice, created_at, updated_at
      )
      SELECT
        sessions.id,
        json_set(
          sessions.persona_json,
          '$.id',
          COALESCE(
            (
              SELECT new_id FROM persona_id_v11_map
              WHERE old_id = CAST(json_extract(sessions.persona_json, '$.id') AS TEXT)
            ),
            1000000000 + sessions.rowid
          )
        ),
        json_set(
          sessions.scenario_json,
          '$.id',
          COALESCE(
            (
              SELECT new_id FROM scenario_id_v11_map
              WHERE old_id = CAST(json_extract(sessions.scenario_json, '$.id') AS TEXT)
            ),
            2000000000 + sessions.rowid
          ),
          '$.allowedPersonaIds',
          json_array(
            COALESCE(
              (
                SELECT new_id FROM persona_id_v11_map
                WHERE old_id = CAST(json_extract(sessions.persona_json, '$.id') AS TEXT)
              ),
              1000000000 + sessions.rowid
            )
          )
        ),
        sessions.difficulty, sessions.locale, sessions.instructions,
        sessions.voice, sessions.created_at, sessions.updated_at
      FROM conversation_sessions AS sessions
      ORDER BY sessions.rowid;

      CREATE TEMP TABLE conversation_session_id_v11_map AS
      SELECT legacy_id AS old_id, id AS new_id
      FROM conversation_sessions_v11_stage;

      DROP TABLE conversation_sessions;

      CREATE TABLE conversation_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        persona_json TEXT NOT NULL
          CHECK (json_valid(persona_json) AND json_type(persona_json) = 'object'),
        scenario_json TEXT NOT NULL
          CHECK (json_valid(scenario_json) AND json_type(scenario_json) = 'object'),
        difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
        locale TEXT NOT NULL CHECK (locale IN ('en', 'zh')),
        instructions TEXT NOT NULL CHECK (length(trim(instructions)) BETWEEN 1 AND 12000),
        voice TEXT NOT NULL
          CHECK (voice IN ('longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO conversation_sessions (
        id, persona_json, scenario_json, difficulty, locale,
        instructions, voice, created_at, updated_at
      )
      SELECT
        id, persona_json, scenario_json, difficulty, locale,
        instructions, voice, created_at, updated_at
      FROM conversation_sessions_v11_stage;

      DROP TABLE conversation_sessions_v11_stage;

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

      INSERT INTO conversation_messages (
        conversation_id, position, role, text, interrupted,
        source_item_id, response_id, created_at
      )
      SELECT
        sessions.new_id, messages.position, messages.role, messages.text,
        messages.interrupted, messages.source_item_id, messages.response_id,
        messages.created_at
      FROM conversation_messages_v11_backup AS messages
      JOIN conversation_session_id_v11_map AS sessions
        ON sessions.old_id = messages.conversation_id
      ORDER BY sessions.new_id, messages.position;

      CREATE INDEX conversation_sessions_updated_at_idx
        ON conversation_sessions(updated_at DESC, id DESC);
      CREATE UNIQUE INDEX conversation_messages_source_item_idx
        ON conversation_messages(conversation_id, source_item_id)
        WHERE source_item_id IS NOT NULL;
      CREATE UNIQUE INDEX conversation_messages_response_idx
        ON conversation_messages(conversation_id, response_id)
        WHERE response_id IS NOT NULL;

      DROP TABLE scenario_personas_v11_backup;
      DROP TABLE conversation_messages_v11_backup;
      DROP TABLE persona_id_v11_map;
      DROP TABLE scenario_id_v11_map;
      DROP TABLE conversation_session_id_v11_map;
    `,
  },
  {
    version: 12,
    name: "store_timestamps_in_china_standard_time",
    up: `
      UPDATE personas
      SET created_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', created_at, '+8 hours'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', updated_at, '+8 hours');

      UPDATE scenarios
      SET created_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', created_at, '+8 hours'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', updated_at, '+8 hours');

      UPDATE scenario_personas
      SET created_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', created_at, '+8 hours');

      UPDATE persona_presets
      SET created_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', created_at, '+8 hours'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', updated_at, '+8 hours');

      UPDATE scenario_presets
      SET created_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', created_at, '+8 hours'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', updated_at, '+8 hours');

      UPDATE conversation_sessions
      SET created_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', created_at, '+8 hours'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', updated_at, '+8 hours');

      UPDATE conversation_messages
      SET created_at = strftime('%Y-%m-%dT%H:%M:%f+08:00', created_at, '+8 hours');

      UPDATE conversation_sessions
      SET persona_json = json_set(
        persona_json,
        '$.createdAt',
        strftime(
          '%Y-%m-%dT%H:%M:%f+08:00',
          json_extract(persona_json, '$.createdAt'),
          '+8 hours'
        )
      )
      WHERE json_type(persona_json, '$.createdAt') = 'text';

      UPDATE conversation_sessions
      SET persona_json = json_set(
        persona_json,
        '$.updatedAt',
        strftime(
          '%Y-%m-%dT%H:%M:%f+08:00',
          json_extract(persona_json, '$.updatedAt'),
          '+8 hours'
        )
      )
      WHERE json_type(persona_json, '$.updatedAt') = 'text';

      UPDATE conversation_sessions
      SET scenario_json = json_set(
        scenario_json,
        '$.createdAt',
        strftime(
          '%Y-%m-%dT%H:%M:%f+08:00',
          json_extract(scenario_json, '$.createdAt'),
          '+8 hours'
        )
      )
      WHERE json_type(scenario_json, '$.createdAt') = 'text';

      UPDATE conversation_sessions
      SET scenario_json = json_set(
        scenario_json,
        '$.updatedAt',
        strftime(
          '%Y-%m-%dT%H:%M:%f+08:00',
          json_extract(scenario_json, '$.updatedAt'),
          '+8 hours'
        )
      )
      WHERE json_type(scenario_json, '$.updatedAt') = 'text';

      CREATE TABLE schema_migrations_v12 (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (
          strftime('%Y-%m-%dT%H:%M:%f+08:00', 'now', '+8 hours')
        )
      ) STRICT;

      INSERT INTO schema_migrations_v12 (version, name, applied_at)
      SELECT
        version,
        name,
        strftime('%Y-%m-%dT%H:%M:%f+08:00', applied_at, '+8 hours')
      FROM schema_migrations
      ORDER BY version;

      DROP TABLE schema_migrations;
      ALTER TABLE schema_migrations_v12 RENAME TO schema_migrations;
    `,
  },
  {
    version: 13,
    name: "normalize_bilingual_catalog_and_snapshots",
    up: `
      CREATE TEMP TABLE scenario_personas_v13_backup AS
      SELECT scenario_id, persona_id, position, created_at
      FROM scenario_personas;

      CREATE TEMP TABLE scenario_scoring_criteria_v13_backup AS
      SELECT
        scenarios.id AS scenario_id,
        CAST(criteria.key AS INTEGER) AS position,
        COALESCE(json_extract(criteria.value, '$.name'), '') AS name,
        COALESCE(json_extract(criteria.value, '$.nameZhCn'), '') AS name_zh_cn,
        COALESCE(CAST(json_extract(criteria.value, '$.weight') AS INTEGER), 0) AS weight
      FROM scenarios
      JOIN json_each(scenarios.scoring_criteria_json) AS criteria;

      CREATE TEMP TABLE conversation_sessions_v13_backup AS
      SELECT * FROM conversation_sessions;

      CREATE TEMP TABLE conversation_messages_v13_backup AS
      SELECT * FROM conversation_messages;

      DROP TABLE conversation_messages;
      DROP TABLE conversation_sessions;
      DROP TABLE scenario_personas;

      CREATE TABLE personas_v13 (
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

      INSERT INTO personas_v13 (
        id, seed_key, name, name_zh_cn, gender, age,
        occupation, occupation_zh_cn, background, background_zh_cn,
        personality_traits_json, personality_traits_zh_cn_json,
        communication_style, communication_style_zh_cn,
        tone_style, tone_style_zh_cn, behavior_notes, behavior_notes_zh_cn,
        motivations_json, motivations_zh_cn_json,
        concerns_json, concerns_zh_cn_json,
        voice, interrupt_frequency, speaking_pace, created_at, updated_at
      )
      SELECT
        id,
        seed_key,
        COALESCE(json_extract(content_en_json, '$.name'), name, ''),
        COALESCE(json_extract(content_zh_json, '$.name'), ''),
        gender,
        age,
        COALESCE(json_extract(content_en_json, '$.occupation'), identity, ''),
        COALESCE(json_extract(content_zh_json, '$.occupation'), ''),
        COALESCE(json_extract(content_en_json, '$.background'), background, ''),
        COALESCE(json_extract(content_zh_json, '$.background'), ''),
        CASE
          WHEN json_type(content_en_json, '$.personalityTraits') = 'array'
            THEN json_extract(content_en_json, '$.personalityTraits')
          ELSE personality_traits_json
        END,
        CASE
          WHEN json_type(content_zh_json, '$.personalityTraits') = 'array'
            THEN json_extract(content_zh_json, '$.personalityTraits')
          ELSE '[]'
        END,
        COALESCE(json_extract(content_en_json, '$.communicationStyle'), communication_style, ''),
        COALESCE(json_extract(content_zh_json, '$.communicationStyle'), ''),
        COALESCE(json_extract(content_en_json, '$.toneStyle'), tone_style, ''),
        COALESCE(json_extract(content_zh_json, '$.toneStyle'), ''),
        COALESCE(json_extract(content_en_json, '$.behaviorNotes'), behavior_notes, ''),
        COALESCE(json_extract(content_zh_json, '$.behaviorNotes'), ''),
        CASE
          WHEN json_type(content_en_json, '$.motivations') = 'array'
            THEN json_extract(content_en_json, '$.motivations')
          ELSE motivations_json
        END,
        CASE
          WHEN json_type(content_zh_json, '$.motivations') = 'array'
            THEN json_extract(content_zh_json, '$.motivations')
          ELSE '[]'
        END,
        CASE
          WHEN json_type(content_en_json, '$.concerns') = 'array'
            THEN json_extract(content_en_json, '$.concerns')
          ELSE concerns_json
        END,
        CASE
          WHEN json_type(content_zh_json, '$.concerns') = 'array'
            THEN json_extract(content_zh_json, '$.concerns')
          ELSE '[]'
        END,
        voice,
        COALESCE(json_extract(persona_voice_behavior_json, '$.interruptFrequency'), 'medium'),
        COALESCE(json_extract(persona_voice_behavior_json, '$.speakingPace'), 'normal'),
        created_at,
        updated_at
      FROM personas
      ORDER BY id;

      CREATE TABLE scenarios_v13 (
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

      INSERT INTO scenarios_v13 (
        id, seed_key, name, name_zh_cn, description, description_zh_cn,
        goals_json, goals_zh_cn_json,
        suggested_skill_focus_json, suggested_skill_focus_zh_cn_json,
        success_criteria_json, success_criteria_zh_cn_json,
        created_at, updated_at
      )
      SELECT
        id,
        seed_key,
        COALESCE(json_extract(content_en_json, '$.name'), name, ''),
        COALESCE(json_extract(content_zh_json, '$.name'), ''),
        COALESCE(json_extract(content_en_json, '$.description'), description, ''),
        COALESCE(json_extract(content_zh_json, '$.description'), ''),
        CASE
          WHEN json_type(content_en_json, '$.goals') = 'array'
            THEN json_extract(content_en_json, '$.goals')
          ELSE goals_json
        END,
        CASE
          WHEN json_type(content_zh_json, '$.goals') = 'array'
            THEN json_extract(content_zh_json, '$.goals')
          ELSE '[]'
        END,
        CASE
          WHEN json_type(content_en_json, '$.suggestedSkillFocus') = 'array'
            THEN json_extract(content_en_json, '$.suggestedSkillFocus')
          ELSE suggested_skill_focus_json
        END,
        CASE
          WHEN json_type(content_zh_json, '$.suggestedSkillFocus') = 'array'
            THEN json_extract(content_zh_json, '$.suggestedSkillFocus')
          ELSE '[]'
        END,
        CASE
          WHEN json_type(content_en_json, '$.successCriteria') = 'array'
            THEN json_extract(content_en_json, '$.successCriteria')
          ELSE success_criteria_json
        END,
        CASE
          WHEN json_type(content_zh_json, '$.successCriteria') = 'array'
            THEN json_extract(content_zh_json, '$.successCriteria')
          ELSE '[]'
        END,
        created_at,
        updated_at
      FROM scenarios
      ORDER BY id;

      CREATE TABLE persona_presets_v13 (
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

      INSERT INTO persona_presets_v13 (
        id, seed_key, category, value, value_zh_cn,
        position, created_at, updated_at
      )
      SELECT
        id, seed_key, category, value_en, value,
        position, created_at, updated_at
      FROM persona_presets
      ORDER BY id;

      CREATE TABLE scenario_presets_v13 (
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

      INSERT INTO scenario_presets_v13 (
        id, seed_key, category, value, value_zh_cn,
        position, created_at, updated_at
      )
      SELECT
        id, seed_key, category, value_en, value,
        position, created_at, updated_at
      FROM scenario_presets
      ORDER BY id;

      DROP TABLE persona_presets;
      DROP TABLE scenario_presets;
      DROP TABLE personas;
      DROP TABLE scenarios;

      ALTER TABLE personas_v13 RENAME TO personas;
      ALTER TABLE scenarios_v13 RENAME TO scenarios;
      ALTER TABLE persona_presets_v13 RENAME TO persona_presets;
      ALTER TABLE scenario_presets_v13 RENAME TO scenario_presets;

      CREATE UNIQUE INDEX personas_name_en_idx
        ON personas(name COLLATE NOCASE)
        WHERE length(trim(name)) > 0;
      CREATE UNIQUE INDEX personas_name_zh_cn_idx
        ON personas(name_zh_cn COLLATE NOCASE)
        WHERE length(trim(name_zh_cn)) > 0;
      CREATE UNIQUE INDEX scenarios_name_en_idx
        ON scenarios(name COLLATE NOCASE)
        WHERE length(trim(name)) > 0;
      CREATE UNIQUE INDEX scenarios_name_zh_cn_idx
        ON scenarios(name_zh_cn COLLATE NOCASE)
        WHERE length(trim(name_zh_cn)) > 0;
      CREATE UNIQUE INDEX persona_presets_value_en_idx
        ON persona_presets(category, value COLLATE NOCASE)
        WHERE length(trim(value)) > 0;
      CREATE UNIQUE INDEX persona_presets_value_zh_cn_idx
        ON persona_presets(category, value_zh_cn COLLATE NOCASE)
        WHERE length(trim(value_zh_cn)) > 0;
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

      INSERT INTO scenario_scoring_criteria (
        scenario_id, position, name, name_zh_cn, weight
      )
      SELECT scenario_id, position, name, name_zh_cn, weight
      FROM scenario_scoring_criteria_v13_backup
      ORDER BY scenario_id, position;

      CREATE TABLE scenario_personas (
        scenario_id INTEGER NOT NULL,
        persona_id INTEGER NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        created_at TEXT NOT NULL,
        PRIMARY KEY (scenario_id, persona_id),
        FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
        FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE RESTRICT
      ) STRICT;

      INSERT INTO scenario_personas (
        scenario_id, persona_id, position, created_at
      )
      SELECT scenario_id, persona_id, position, created_at
      FROM scenario_personas_v13_backup;

      CREATE INDEX scenario_personas_persona_id_idx
        ON scenario_personas(persona_id);
      CREATE UNIQUE INDEX scenario_personas_scenario_position_idx
        ON scenario_personas(scenario_id, position);

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

      INSERT INTO conversation_sessions (
        id, difficulty, locale, instructions, voice, created_at, updated_at
      )
      SELECT id, difficulty, locale, instructions, voice, created_at, updated_at
      FROM conversation_sessions_v13_backup
      ORDER BY id;

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

      INSERT INTO conversation_persona_snapshots (
        conversation_id, source_persona_id, name, name_zh_cn, gender, age,
        occupation, occupation_zh_cn, background, background_zh_cn,
        personality_traits_json, personality_traits_zh_cn_json,
        communication_style, communication_style_zh_cn,
        tone_style, tone_style_zh_cn, behavior_notes, behavior_notes_zh_cn,
        motivations_json, motivations_zh_cn_json,
        concerns_json, concerns_zh_cn_json, voice,
        interrupt_frequency, speaking_pace, source_created_at, source_updated_at
      )
      SELECT
        sessions.id,
        CASE
          WHEN CAST(json_extract(sessions.persona_json, '$.id') AS INTEGER) > 0
            THEN CAST(json_extract(sessions.persona_json, '$.id') AS INTEGER)
          ELSE 1000000000 + sessions.id
        END,
        COALESCE(json_extract(sessions.persona_json, '$.name'), ''),
        COALESCE(json_extract(sessions.persona_json, '$.nameZhCn'), ''),
        COALESCE(json_extract(sessions.persona_json, '$.gender'), 'unspecified'),
        CAST(json_extract(sessions.persona_json, '$.age') AS INTEGER),
        COALESCE(json_extract(sessions.persona_json, '$.occupation'), ''),
        COALESCE(json_extract(sessions.persona_json, '$.occupationZhCn'), ''),
        COALESCE(json_extract(sessions.persona_json, '$.background'), ''),
        COALESCE(json_extract(sessions.persona_json, '$.backgroundZhCn'), ''),
        CASE WHEN json_type(sessions.persona_json, '$.personalityTraits') = 'array'
          THEN json_extract(sessions.persona_json, '$.personalityTraits') ELSE '[]' END,
        CASE WHEN json_type(sessions.persona_json, '$.personalityTraitsZhCn') = 'array'
          THEN json_extract(sessions.persona_json, '$.personalityTraitsZhCn') ELSE '[]' END,
        COALESCE(json_extract(sessions.persona_json, '$.communicationStyle'), ''),
        COALESCE(json_extract(sessions.persona_json, '$.communicationStyleZhCn'), ''),
        COALESCE(json_extract(sessions.persona_json, '$.toneStyle'), ''),
        COALESCE(json_extract(sessions.persona_json, '$.toneStyleZhCn'), ''),
        COALESCE(json_extract(sessions.persona_json, '$.behaviorNotes'), ''),
        COALESCE(json_extract(sessions.persona_json, '$.behaviorNotesZhCn'), ''),
        CASE WHEN json_type(sessions.persona_json, '$.motivations') = 'array'
          THEN json_extract(sessions.persona_json, '$.motivations') ELSE '[]' END,
        CASE WHEN json_type(sessions.persona_json, '$.motivationsZhCn') = 'array'
          THEN json_extract(sessions.persona_json, '$.motivationsZhCn') ELSE '[]' END,
        CASE WHEN json_type(sessions.persona_json, '$.concerns') = 'array'
          THEN json_extract(sessions.persona_json, '$.concerns') ELSE '[]' END,
        CASE WHEN json_type(sessions.persona_json, '$.concernsZhCn') = 'array'
          THEN json_extract(sessions.persona_json, '$.concernsZhCn') ELSE '[]' END,
        COALESCE(json_extract(sessions.persona_json, '$.voice'), sessions.voice),
        COALESCE(json_extract(sessions.persona_json, '$.voiceBehavior.interruptFrequency'), 'medium'),
        COALESCE(json_extract(sessions.persona_json, '$.voiceBehavior.speakingPace'), 'normal'),
        COALESCE(json_extract(sessions.persona_json, '$.createdAt'), sessions.created_at),
        COALESCE(json_extract(sessions.persona_json, '$.updatedAt'), sessions.updated_at)
      FROM conversation_sessions_v13_backup AS sessions
      ORDER BY sessions.id;

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

      INSERT INTO conversation_scenario_snapshots (
        conversation_id, source_scenario_id, name, name_zh_cn,
        description, description_zh_cn, goals_json, goals_zh_cn_json,
        suggested_skill_focus_json, suggested_skill_focus_zh_cn_json,
        success_criteria_json, success_criteria_zh_cn_json,
        source_created_at, source_updated_at
      )
      SELECT
        sessions.id,
        CASE
          WHEN CAST(json_extract(sessions.scenario_json, '$.id') AS INTEGER) > 0
            THEN CAST(json_extract(sessions.scenario_json, '$.id') AS INTEGER)
          ELSE 2000000000 + sessions.id
        END,
        COALESCE(json_extract(sessions.scenario_json, '$.name'), ''),
        COALESCE(json_extract(sessions.scenario_json, '$.nameZhCn'), ''),
        COALESCE(json_extract(sessions.scenario_json, '$.description'), ''),
        COALESCE(json_extract(sessions.scenario_json, '$.descriptionZhCn'), ''),
        CASE WHEN json_type(sessions.scenario_json, '$.goals') = 'array'
          THEN json_extract(sessions.scenario_json, '$.goals') ELSE '[]' END,
        CASE WHEN json_type(sessions.scenario_json, '$.goalsZhCn') = 'array'
          THEN json_extract(sessions.scenario_json, '$.goalsZhCn') ELSE '[]' END,
        CASE WHEN json_type(sessions.scenario_json, '$.suggestedSkillFocus') = 'array'
          THEN json_extract(sessions.scenario_json, '$.suggestedSkillFocus') ELSE '[]' END,
        CASE WHEN json_type(sessions.scenario_json, '$.suggestedSkillFocusZhCn') = 'array'
          THEN json_extract(sessions.scenario_json, '$.suggestedSkillFocusZhCn') ELSE '[]' END,
        CASE WHEN json_type(sessions.scenario_json, '$.successCriteria') = 'array'
          THEN json_extract(sessions.scenario_json, '$.successCriteria') ELSE '[]' END,
        CASE WHEN json_type(sessions.scenario_json, '$.successCriteriaZhCn') = 'array'
          THEN json_extract(sessions.scenario_json, '$.successCriteriaZhCn') ELSE '[]' END,
        COALESCE(json_extract(sessions.scenario_json, '$.createdAt'), sessions.created_at),
        COALESCE(json_extract(sessions.scenario_json, '$.updatedAt'), sessions.updated_at)
      FROM conversation_sessions_v13_backup AS sessions
      ORDER BY sessions.id;

      CREATE TABLE conversation_scenario_scoring_criteria (
        conversation_id INTEGER NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 160),
        name_zh_cn TEXT NOT NULL DEFAULT '' CHECK (length(name_zh_cn) <= 160),
        weight INTEGER NOT NULL CHECK (weight BETWEEN 0 AND 100),
        PRIMARY KEY (conversation_id, position),
        FOREIGN KEY (conversation_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
      ) STRICT;

      INSERT INTO conversation_scenario_scoring_criteria (
        conversation_id, position, name, name_zh_cn, weight
      )
      SELECT
        sessions.id,
        CAST(criteria.key AS INTEGER),
        COALESCE(json_extract(criteria.value, '$.name'), ''),
        COALESCE(json_extract(criteria.value, '$.nameZhCn'), ''),
        COALESCE(CAST(json_extract(criteria.value, '$.weight') AS INTEGER), 0)
      FROM conversation_sessions_v13_backup AS sessions
      JOIN json_each(sessions.scenario_json, '$.scoringCriteria') AS criteria
      WHERE json_type(sessions.scenario_json, '$.scoringCriteria') = 'array';

      CREATE TABLE conversation_scenario_personas (
        conversation_id INTEGER NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        persona_id INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, position),
        FOREIGN KEY (conversation_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
      ) STRICT;

      INSERT INTO conversation_scenario_personas (
        conversation_id, position, persona_id
      )
      SELECT
        sessions.id,
        CAST(personas.key AS INTEGER),
        CAST(personas.value AS INTEGER)
      FROM conversation_sessions_v13_backup AS sessions
      JOIN json_each(sessions.scenario_json, '$.allowedPersonaIds') AS personas
      WHERE json_type(sessions.scenario_json, '$.allowedPersonaIds') = 'array'
        AND CAST(personas.value AS INTEGER) > 0;

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

      INSERT INTO conversation_messages (
        id, conversation_id, position, role, text, interrupted,
        source_item_id, response_id, created_at
      )
      SELECT
        id, conversation_id, position, role, text, interrupted,
        source_item_id, response_id, created_at
      FROM conversation_messages_v13_backup
      ORDER BY id;

      CREATE INDEX conversation_sessions_updated_at_idx
        ON conversation_sessions(updated_at DESC, id DESC);
      CREATE UNIQUE INDEX conversation_messages_source_item_idx
        ON conversation_messages(conversation_id, source_item_id)
        WHERE source_item_id IS NOT NULL;
      CREATE UNIQUE INDEX conversation_messages_response_idx
        ON conversation_messages(conversation_id, response_id)
        WHERE response_id IS NOT NULL;

      DROP TABLE scenario_personas_v13_backup;
      DROP TABLE scenario_scoring_criteria_v13_backup;
      DROP TABLE conversation_sessions_v13_backup;
      DROP TABLE conversation_messages_v13_backup;
    `,
  },
  {
    version: 14,
    name: "split_preset_categories_into_tables",
    up: SPLIT_PRESET_TABLES_MIGRATION_SQL,
  },
  {
    version: 15,
    name: "reference_catalog_presets_by_id",
    up: migrateCatalogRecordsToPresetReferences,
  },
  {
    version: 16,
    name: "move_voice_behavior_to_scenarios",
    up: (database) => {
      moveCatalogVoiceBehaviorToScenarios(database);
      moveCombinedConversationVoiceBehaviorToScenarioSnapshots(database);
    },
  },
  {
    version: 17,
    name: "create_conversation_feedback",
    up: createCombinedConversationFeedbackSchema,
  },
];

interface AppliedMigration {
  version: number;
  name: string;
}

/**
 * Applies pending migrations in individual transactions and rejects databases
 * whose migration history no longer matches this codebase.
 */
export function runMigrations(
  database: DatabaseSync,
  migrations: readonly DatabaseMigration[] = DATABASE_MIGRATIONS,
): void {
  validateMigrationDefinitions(migrations);

  const applied = readAppliedMigrations(database);
  validateAppliedMigrations(applied, migrations);

  for (const migration of migrations) {
    if (applied.some(({ version }) => version === migration.version)) continue;

    database.exec("BEGIN IMMEDIATE");
    try {
      if (typeof migration.up === "string") database.exec(migration.up);
      else migration.up(database);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
        )
        .run(migration.version, migration.name);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(
        `Failed to apply database migration ${migration.version} (${migration.name}).`,
        { cause: error },
      );
    }
  }
}

function readAppliedMigrations(database: DatabaseSync): AppliedMigration[] {
  const table = database
    .prepare(
      `SELECT 1 AS present
       FROM sqlite_schema
       WHERE type = 'table' AND name = 'schema_migrations'`,
    )
    .get();

  if (!table) return [];

  return database
    .prepare(
      `SELECT version, name
       FROM schema_migrations
       ORDER BY version`,
    )
    .all() as unknown as AppliedMigration[];
}

function validateMigrationDefinitions(
  migrations: readonly DatabaseMigration[],
): void {
  let previousVersion = 0;
  const names = new Set<string>();

  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= 0) {
      throw new Error("Database migration versions must be positive integers.");
    }
    if (migration.version <= previousVersion) {
      throw new Error("Database migrations must be ordered by increasing version.");
    }
    if (names.has(migration.name)) {
      throw new Error(`Duplicate database migration name: ${migration.name}`);
    }
    previousVersion = migration.version;
    names.add(migration.name);
  }
}

function validateAppliedMigrations(
  applied: readonly AppliedMigration[],
  migrations: readonly DatabaseMigration[],
): void {
  for (const migration of applied) {
    const expected = migrations.find(
      ({ version }) => version === migration.version,
    );
    if (!expected) {
      throw new Error(
        `Database migration ${migration.version} is newer than this application.`,
      );
    }
    if (expected.name !== migration.name) {
      throw new Error(
        `Database migration ${migration.version} is named "${migration.name}" on disk but "${expected.name}" in code.`,
      );
    }
  }
}
