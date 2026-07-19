# Database

## Decision and lifecycle

The backend uses SQLite through Node's built-in `node:sqlite` API. React build output, Fastify, and both database owners can therefore ship in one container without a separate database service.

Runtime data is split by lifecycle and responsibility:

- `data/catalog.sqlite` owns personas, scenarios, presets, scoring configuration, and scenario/persona compatibility.
- `data/conversations.sqlite` owns immutable launch snapshots, compiled Instructions, and finalized messages.

`registerDatabases` creates one process-owned synchronous connection per file, enables foreign keys and a 5-second busy timeout, and applies that file's independent migration chain. Production must mount the directory containing both files; storing it only in an ephemeral image layer loses catalog edits and history when the container is replaced.

Both connections use SQLite's `DELETE` journal mode. Transactions remain crash-safe, but there are no persistent `-wal` or `-shm` sidecars. A `-journal` file may appear briefly during a write and is normally deleted at commit; after a crash SQLite may retain it so the next open can recover. This mode matches the current single Node process and one connection per file. Reconsider WAL if the deployment later adds multiple server processes or substantial concurrent readers/writers.

All database timestamps use ISO 8601 with the fixed China Standard Time offset `+08:00`, for example `2026-07-19T12:05:06.007+08:00`. Server writes must use `database-time.ts` rather than the host timezone or `Date#toISOString()`. Migration 12 converts existing UTC timestamps—including timestamps embedded in conversation persona/scenario snapshots—and changes the migration-record default to UTC+08:00.

## Tables

All current tables are `STRICT`. The catalog file contains:

```text
schema_migrations
├── version, name, applied_at

database_metadata
└── key, value

qwen_voices
├── id (INTEGER AUTOINCREMENT), seed_key, voice (official provider ID)
├── name / name_zh_cn
├── position
└── created_at, updated_at

personas
├── id (INTEGER AUTOINCREMENT), seed_key, gender, age, voice
├── name / name_zh_cn
├── occupation_preset_id → persona_occupation_presets.id
├── background / background_zh_cn
├── communication_style_preset_id → persona_communication_style_presets.id
├── behavior_notes / behavior_notes_zh_cn
└── created_at, updated_at

persona_personality_traits
└── persona_id, personality_trait_preset_id, position

persona_motivations
└── persona_id, motivation_preset_id, position

persona_concerns
└── persona_id, concern_preset_id, position

scenarios
├── id (INTEGER AUTOINCREMENT), seed_key
├── name / name_zh_cn, description / description_zh_cn
├── tone_style_preset_id → scenario_tone_style_presets.id (optional)
├── interrupt_frequency, speaking_pace (optional)
└── created_at, updated_at

scenario_training_goals
└── scenario_id, training_goal_preset_id, position

scenario_skill_focuses
└── scenario_id, skill_focus_preset_id, position

scenario_success_criteria
└── scenario_id, success_criterion_preset_id, position, weight

scenario_personas
├── scenario_id → scenarios.id ON DELETE CASCADE
├── persona_id  → personas.id ON DELETE RESTRICT
├── position
└── created_at

persona_occupation_presets
└── id, seed_key, occupation / occupation_zh_cn, position, timestamps

persona_personality_trait_presets
└── id, seed_key, personality_trait / personality_trait_zh_cn, position, timestamps

persona_communication_style_presets
└── id, seed_key, communication_style / communication_style_zh_cn, position, timestamps

persona_motivation_presets
└── id, seed_key, motivation / motivation_zh_cn, position, timestamps

persona_concern_presets
└── id, seed_key, concern / concern_zh_cn, position, timestamps

scenario_training_goal_presets
└── id, seed_key, training_goal / training_goal_zh_cn, position, timestamps

scenario_skill_focus_presets
└── id, seed_key, skill_focus / skill_focus_zh_cn, position, timestamps

scenario_success_criterion_presets
└── id, seed_key, success_criterion / success_criterion_zh_cn, position, timestamps

scenario_tone_style_presets
└── id, seed_key, tone_style / tone_style_zh_cn, position, timestamps

```

The conversation file contains:

```text
schema_migrations
├── version, name, applied_at

database_metadata
└── key, value

sessions
├── id (INTEGER AUTOINCREMENT), difficulty, locale, instructions, voice
├── status (active or ended), ended_at
└── created_at, updated_at

persona_snapshots
├── conversation_id, source_persona_id
└── the same explicit bilingual persona columns used by personas

scenario_snapshots
├── conversation_id, source_scenario_id
└── the same explicit bilingual scenario columns used by scenarios

scenario_scoring_criteria
└── conversation_id, position, name, name_zh_cn, weight

scenario_personas
└── conversation_id, position, persona_id

messages
├── id (INTEGER AUTOINCREMENT), conversation_id, position, role, text, interrupted
├── source_item_id, response_id
└── created_at

message_audio
├── message_id → messages.id (PRIMARY KEY, ON DELETE CASCADE)
├── sample_rate (16000 or 24000), pcm (PCM16 LE BLOB), duration_ms
└── created_at

feedback_reports
├── conversation_id → sessions.id (PRIMARY KEY, ON DELETE CASCADE)
├── status, locale, model, prompt_version
├── overall_assessment, overall_score, error_code, error_message
└── created_at, updated_at, completed_at

feedback_strengths / feedback_improvement_areas
└── conversation_id, position, text

feedback_coaching_tips
└── conversation_id, position, title, advice

feedback_criterion_scores
└── conversation_id, criterion_position, score, rationale

feedback_moments
└── conversation_id, position, message_id, kind, title, assessment, suggested_approach
```

## Bilingual catalog storage

Unsuffixed database columns represent English and `_zh_cn` columns represent Simplified Chinese. The API maps those columns to unsuffixed English fields and `*ZhCn` Chinese fields. Either language may be empty; fallback remains presentation-only.

Free-text business fields have explicit English/Chinese columns. Preset-backed fields do not duplicate localized text on personas or scenarios: single selections are foreign-key columns and multi-selections are ordered relation rows. `qwen_voices.voice` and `personas.voice` retain the provider-owned Qwen ID needed by the realtime API; localized display names live only in `qwen_voices.name` / `name_zh_cn`. Scenario voice behavior uses nullable `interrupt_frequency` and `speaking_pace` columns; scenario success-standard weights live on `scenario_success_criteria`.

## Presets

Every preset domain owns a dedicated physical table; the current schema has no preset `category` discriminator column and no generic preset `value` column. Each table uses domain-named bilingual columns, such as `occupation` / `occupation_zh_cn`, and independently constrains non-empty English text, Chinese text, and `position` to be unique.

The REST contract still returns flat `personaPresets` and `scenarioPresets` collections with a derived `category`, `value`, and `valueZhCn` so the responsive UI can use one reusable option pipeline. Those fields are assembled by `CatalogRepository`; they are not the physical storage model.

Personas and scenarios store preset IDs. `CatalogRepository` joins the relevant preset tables and returns both IDs and resolved bilingual values, so the UI and prompt compiler can display `Impatient` or `缺乏耐心` from the same selection. Existing conversations do not change when a preset changes because launch-time resolved text is stored separately as an immutable snapshot.

## Compatibility and conversation history

`scenario_personas` is an ordered many-to-many relation. Its composite primary key prevents duplicate links, and `(scenario_id, position)` preserves deterministic display order. A persona cannot be deleted while referenced; deleting a scenario cascades its links.

`sessions` stores the exact compiled Instructions, voice, difficulty, locale, and timestamps needed to rebuild a realtime connection. Its immutable catalog snapshot is normalized into `persona_snapshots`, `scenario_snapshots`, `scenario_scoring_criteria`, and `scenario_personas`. Catalog edits therefore affect only future conversations without putting whole business objects into JSON columns.

`messages` stores authoritative finalized text. `(conversation_id, position)` preserves ordering. Partial unique indexes on `source_item_id` and `response_id` make user/assistant persistence idempotent. `message_audio` is an optional one-to-one child inserted in the same transaction: user rows retain submitted PCM16 16 kHz microphone audio, normal assistant rows retain completed PCM16 24 kHz output, and interrupted assistant rows retain only the conservative `safePlayedMs` prefix associated with the repaired text. Streaming deltas, generated-but-unheard assistant suffixes, cancelled input, and empty interruption rollbacks are not stored. A conversation advertises audio download only when every finalized message has an audio row; this keeps older text-only history honest. Request-time MP3 loudness normalization operates on decoded copies and never rewrites these authoritative PCM blobs.

Ending a session changes `sessions.status` from `active` to `ended` and records `ended_at`; the repository then rejects new message writes and realtime restoration. Feedback generation state lives in `feedback_reports`, while repeatable values use normalized ordered child tables. Criterion scores reference the immutable snapshot criterion position, and highlighted moments reference a stored message ID. The model supplies per-criterion scores; Node calculates and persists the weighted total. Pending/processing state survives process restarts, failed state retains a bounded stage-specific diagnostic code/message (evidence loading, configuration, timeout/network/HTTP/provider shape, generated-core validation, or persistence), and explicit retry reuses the same report instead of creating duplicates while updating its prompt version.

Deleting an ended session removes its `sessions` row. Foreign keys cascade every owned persona/scenario snapshot, scoring/compatibility snapshot, finalized message and `message_audio`, feedback report, and normalized feedback child. Active sessions are not deletable. The HTTP route cancels and awaits any same-process feedback generator before repository deletion so no asynchronous result can write back after the parent has gone. **Try again** performs no database clone: it creates a new session through the normal catalog-backed creation path using the old snapshot's source persona/scenario IDs and difficulty.

## Migrations, legacy splitting, and business initialization

Migrations are append-only structural changes. The catalog chain currently has seven entries: migration 4 moves both historical discriminator tables into nine independent domain tables, migration 5 replaces duplicated catalog text with preset foreign keys/ordered relations, migration 6 creates the bilingual Qwen voice directory, and migration 7 moves tone/pace/interjection configuration from personas to scenarios. The conversation chain has seven entries: migration 4 removes the redundant `conversation_` prefix from business table and index names, migration 5 adds finalized-message audio, migration 6 moves the resolved voice-behavior values from persona snapshots to scenario snapshots, and migration 7 adds terminal session state plus normalized feedback tables. Neither file contains the other domain's business tables.

The historical combined database uses migrations 1–17:

- migration 2: core catalog tables;
- migration 3: compatibility ordering;
- migrations 4–5: persona presets and English preset values;
- migration 6: conversation history;
- migration 7: persona tone style;
- migration 8: bilingual catalog JSON and scenario presets;
- migration 9: retire old migration-owned starter rows on legacy databases.
- migration 10: add persona-owned voice behavior.
- migration 11: rebuild application record primary keys and foreign keys as SQLite-generated integers while preserving existing catalog links and conversation history.
- migration 12: convert stored timestamps and future migration records to fixed UTC+08:00 ISO 8601 values.
- migration 13: replace aggregate bilingual/object JSON storage with explicit localized columns and normalized scoring/snapshot tables while preserving existing data.
- migration 14: split role and scenario preset categories into nine physical tables with domain-specific bilingual columns while preserving IDs and initializer keys.
- migration 15: replace preset-backed persona/scenario text with preset IDs, promote unmatched historical custom text to custom preset rows, and preserve scoring weights.
- migration 16: move tone style, speaking pace, and interjection/challenge tendency to scenario records and scenario snapshots while preserving compatibility and history.
- migration 17: add terminal conversation state and normalized coaching-feedback tables.

Business data is not seeded by normal schema creation. Run the explicit, transactional initializer:

```bash
pnpm catalog:init
```

Built deployment:

```bash
pnpm catalog:init:prod
```

All business records come from `src/server/catalog/initial-data/*.json`. Every preset table and the Qwen voice directory have their own JSON file, and preset files contain no category discriminator. The initializer inserts bilingual voice names, bilingual presets, three starter personas, three starter scenarios, and compatibility links. JSON `key` values are initializer-only idempotency markers; they are stored as nullable `seed_key` metadata and are never used as public IDs. All public IDs are generated by SQLite. Repeated runs preserve existing rows and require no Qwen credentials.

To preserve an existing combined `data/role-player.sqlite`, stop the server and wait for its WAL/SHM files to disappear, then run:

```bash
pnpm database:split
```

`LEGACY_DATABASE_PATH` selects the source, while `CATALOG_DATABASE_PATH` and `CONVERSATION_DATABASE_PATH` select the destinations. For compatibility, an old `DATABASE_PATH` value is also accepted as the legacy source only. The command upgrades the source through historical migration 17, creates both fresh destination schemas, copies every row with its ID, validates column shapes, row counts, and foreign keys, and leaves the source untouched afterward. It refuses to run while legacy WAL sidecars exist and never merges into or overwrites an existing target file.

Node currently labels its built-in `node:sqlite` API as experimental even though the project supports it on the enforced Node version. That warning does not mean initialization failed. The catalog scripts suppress this single warning code so successful initializer output is not mistaken for an error.

## Paths, backup, and containers

The resolved defaults are `data/catalog.sqlite` and `data/conversations.sqlite`; `CATALOG_DATABASE_PATH` and `CONVERSATION_DATABASE_PATH` override them. Relative paths resolve from the process working directory. The two paths must be different. `data/` and SQLite sidecar files are ignored by Git.

For a consistent local backup, stop the server and copy both `.sqlite` files. Under the current `DELETE` journal mode, a clean shutdown leaves no WAL/SHM sidecars. Do not discard a leftover `-journal` file after an abnormal shutdown before SQLite has had an opportunity to recover. For containers, mount the shared database directory as a persistent volume, run `catalog:init:prod` against that volume, and then start Fastify.

SQLite is appropriate for the current single-process/private deployment. Raw PCM costs approximately 32 KiB/s for user audio and 48 KiB/s for assistant audio, so production storage and backup sizing must include audio history. Each captured message is capped at 32 MiB; an oversized turn remains usable as text but makes complete audio export unavailable for that conversation. Revisit SQLite or move message audio to owned object storage if the product requires long retention at scale, multiple write replicas, high concurrent write volume, external analytics over live data, or tenant isolation that should not share one file.
