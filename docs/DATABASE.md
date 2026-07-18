# Database

## Current decision

The backend uses SQLite through Node's built-in `node:sqlite` API. This matches the intended single-service deployment: the React build, Node server, and database owner can ship in one image without running a separate database service.

SQLite removes a service dependency, not the need for persistent storage. In production, the directory containing the database file must be mounted outside the container's ephemeral image layer.

## Current scope

The database persists the editable role-play catalog and persona-editor reference choices. All five current tables are declared `STRICT`:

```text
schema_migrations
├── version     INTEGER PRIMARY KEY
├── name        TEXT NOT NULL UNIQUE
└── applied_at  TEXT NOT NULL

personas
├── id, name, gender, age, occupation, identity, background
├── personality_traits_json, communication_style, behavior_notes
├── motivations_json, concerns_json, voice
└── created_at, updated_at

scenarios
├── id, name, description
├── goals_json, suggested_skill_focus_json, success_criteria_json
├── scoring_criteria_json, voice_behavior_json
└── created_at, updated_at

scenario_personas
├── scenario_id → scenarios.id ON DELETE CASCADE
├── persona_id  → personas.id  ON DELETE RESTRICT
├── position
└── created_at

persona_presets
├── id          TEXT PRIMARY KEY
├── category    identity | occupation | personality_trait |
│               communication_style | motivation | concern
├── value       TEXT NOT NULL       # stable Chinese snapshot value
├── value_en    TEXT NOT NULL       # English display value
├── position    INTEGER NOT NULL
└── created_at, updated_at
```

`scenario_personas` is the ordered many-to-many compatibility relation. Its `(scenario_id, persona_id)` primary key prevents duplicate links, `(scenario_id, position)` keeps one stable order, and `scenario_personas_persona_id_idx` supports reverse reference checks. Migration 2 created the relation and seed; migration 3 adds/backfills `position` and creates the unique ordering index so databases opened during earlier development upgrade without being deleted.

Migration 4 creates `persona_presets` and its ordering/uniqueness constraints, but intentionally inserts no preset or persona business data. Persona fields store selected preset text directly; there are no foreign keys from `personas` to `persona_presets`. Editing or removing a preset therefore changes future form choices without mutating existing personas.

Migration 5 adds `value_en` with an empty default so already-created migration-4 databases upgrade without deletion. The explicit catalog initializer fills deployment-owned English labels only when the stable seed ID, category, and canonical value are unchanged. A non-empty administrator translation or edited canonical row is preserved; other legacy/custom blank labels remain valid and fall back to `value` in the UI.

`persona_presets` restricts category to the six shared enum values, requires a non-empty canonical value up to 500 characters, permits an empty English value for backward compatibility, and requires a non-negative position. It enforces case-insensitive `(category, value)` uniqueness plus `(category, position)` uniqueness. Preset ordering is scoped to its category.

Migration 2 contains the immutable legacy `persona_alex`, `scenario_sales_discovery`, and compatibility seed. New migrations must not repeat that historical coupling of schema and business defaults. All new presets and starter personas are owned by the explicit initializer described below.

Catalog rows persist across process restarts. There are still no user, learner-selection, session, transcript, audio, interruption-sample, or evaluation tables. Realtime state and conversation context remain process/browser memory, so the demo does not provide session history or recovery.

## Runtime ownership

Relevant files:

| File | Responsibility |
| --- | --- |
| `src/server/config.ts` | Validates `DATABASE_PATH` and provides its default |
| `src/server/database/database.ts` | Resolves the path, creates the directory, opens/configures/closes SQLite |
| `src/server/database/migrations.ts` | Defines and applies immutable migrations |
| `src/server/database/register-database.ts` | Attaches one database owner to Fastify lifecycle hooks |
| `src/server/catalog/catalog-repository.ts` | Maps validated catalog records and owns short transactional CRUD operations |
| `src/server/catalog/catalog-routes.ts` | Exposes the validated catalog REST boundary |
| `src/server/catalog/catalog-initializer.ts` | Defines stable defaults, transactional missing-row insertion, and guarded blank-English backfill |
| `scripts/initialize-catalog.ts` | Opens the configured database and runs the initializer for source/built commands |
| `test/server/database.test.ts` | Verifies filesystem creation, PRAGMAs, migrations 2/3/4/5, upgrade paths, seed/reopen behavior, and lifecycle closure |
| `test/server/catalog-routes.test.ts` | Verifies validation, CRUD, compatibility, conflicts, and deletion semantics |
| `test/server/catalog-initializer.test.ts` | Verifies bilingual content, guarded backfill, ordering, idempotency, and edit preservation with a temporary database |

`registerDatabase` decorates the Fastify instance with one `ApplicationDatabase`. It opens during `onReady` and closes during `onClose`. `CatalogRepository` uses that process-owned connection; routes and future repositories must not open a connection per request.

If opening or migrating fails, Fastify startup fails. A successful `/api/health` response reports `database: "ok"` because readiness has already completed; it is not currently a query-latency or disk-capacity probe.

## Configuration and paths

Default configuration:

```dotenv
DATABASE_PATH=data/role-player.sqlite
```

Rules:

- Absolute paths are used as given.
- Relative paths are resolved from `process.cwd()`, not from the source file directory.
- Missing parent directories are created recursively on open.
- `:memory:` is supported by `ApplicationDatabase` for ephemeral use, but must not be used when persistence is expected.
- The default `data/` directory is ignored by Git.

Run the production process from a predictable working directory or set an absolute `DATABASE_PATH`. Ensure the Node process can create and write the parent directory.

The project requires Node.js 22.13.0 or newer because it imports `node:sqlite` directly without an experimental runtime flag. Do not add a native SQLite package unless a measured limitation justifies the extra installation and container complexity.

## Connection configuration

Every open applies:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

- WAL improves read/write coexistence and produces `-wal` and `-shm` sidecar files while active.
- Foreign-key checks are connection-scoped in SQLite, so they must remain enabled whenever a new connection strategy is introduced.
- The 5-second busy timeout gives short lock contention a bounded retry window instead of failing immediately.

`DatabaseSync` is synchronous. It is appropriate for the current small catalog and short transactions, but a slow query blocks the Node event loop, including realtime WebSocket work. Keep request-path operations small, add indexes from measured access patterns, and reconsider the driver/worker architecture before adding large reports or heavy concurrent writes.

## Migration contract

Migrations live in the ordered `DATABASE_MIGRATIONS` array. Every definition has:

- a positive, monotonically increasing integer `version`;
- a unique stable `name`;
- SQL in `up`.

On startup, the runner:

1. validates definition order and unique names;
2. reads applied versions when `schema_migrations` exists;
3. rejects an on-disk version unknown to the running application;
4. rejects a version whose on-disk name differs from the code definition;
5. runs each pending migration in its own `BEGIN IMMEDIATE` transaction;
6. inserts the version/name record before committing;
7. rolls back and fails startup on error.

Once a migration may have run outside a local scratch database, it is immutable. Never edit, rename, reorder, or reuse it. Correct a schema with a new migration and the next version number. The project currently has no automatic down migrations; recovery means restoring a coherent backup or applying a deliberate forward repair.

Example next addition:

```ts
export const DATABASE_MIGRATIONS = [
  // Existing entries remain byte-for-byte stable.
  {
    version: 6,
    name: "create_example_table",
    up: `CREATE TABLE example (... ) STRICT;`,
  },
] as const;
```

The example is illustrative only; do not create an `example` table in the real database. Migration 2 is `create_role_play_catalog`, migration 3 is `add_scenario_persona_position`, migration 4 creates persona presets, and migration 5 adds their English display values; all are immutable.

## Schema migrations versus catalog initialization

Migrations define durable structure and forward upgrades. They run automatically whenever `ApplicationDatabase` opens. Except for migration 2's immutable historical starter rows, migrations must not carry editable business/reference content.

Catalog defaults are an explicit deployment operation:

```bash
# TypeScript/source checkout
pnpm catalog:init

# Built deployment artifact
pnpm catalog:init:prod
```

Both commands use the configured `DATABASE_PATH`, open/configure SQLite, and apply pending migrations before initialization. They do not start Fastify or connect to Qwen, and `DASHSCOPE_API_KEY`/`DASHSCOPE_WORKSPACE_ID` are not required.

The initializer owns:

- 70 bilingual choices: identity 8, occupation 12, personality trait 16, communication style 8, motivation 12, and concern 14;
- the starter personas 林悦 (`persona_lin_yue`), 王强 (`persona_wang_qiang`), and 陈晨 (`persona_chen_chen`);
- missing compatibility links that append those personas to `scenario_sales_discovery` when that scenario exists.

Initialization data writes use one `BEGIN IMMEDIATE` transaction. Any failure rolls back all preset/persona/link writes from that initializer call; migrations applied while opening the database are separate committed migration transactions. Stable IDs and conflict-tolerant inserts make initialization idempotent: each run attempts missing presets, personas, and links. The sole permitted update fills an empty English value—and advances `updated_at`—when stable seed ID, category, and canonical value all still match; non-empty translations and edited canonical rows are preserved. A preset is otherwise skipped when its stable ID or the same case-insensitive category/value already exists. When its preferred category position is occupied, the missing preset is appended at that category's current maximum plus one instead of moving or overwriting the existing row.

The initializer does not recreate `scenario_sales_discovery` when it is absent. When it exists, each missing link is checked against both the shared 100-persona scenario capacity and the 12,000-character Instructions limit for easy, medium, and hard before insertion, then receives a position after the current maximum. A capacity or over-budget failure throws a descriptive error and rolls back all initializer data writes, preserving the association invariants and existing database state.

Operational order is part of the contract:

```text
first source setup: install → configure DATABASE_PATH → catalog:init → dev
container startup: mount persistent volume → catalog:init:prod → start server
```

Run the initializer against the same persistent database path used by the service. It is not an implicit side effect of every server start, so operators control when missing defaults are restored.

## Catalog durability and deletion contract

The shared Zod schemas validate REST payloads and parsed rows. SQLite also enforces key scalar constraints, JSON validity/type checks, allowed gender/voice values, case-insensitive unique persona/scenario names, and foreign keys. Array cardinality, list-item length, scoring-name uniqueness, scoring weights totaling 100, and voice-behavior shape are enforced by the shared schemas.

Catalog operations use these durability rules:

- `GET /api/catalog` returns ordered `personaPresets` together with personas and scenarios;
- presets are form reference data, while each saved persona owns a text snapshot of its selections;
- persona/scenario creation and replacement are immediately durable when the API succeeds;
- scenario creation/update and its full compatibility replacement run in one `BEGIN IMMEDIATE` transaction;
- an unknown persona compatibility reference rejects the whole scenario write;
- any persona/scenario association whose compiled Instructions exceeds 12,000 characters in easy, medium, or hard returns `400 instructions_too_long` and changes nothing;
- deleting a persona referenced by any scenario returns a conflict and changes nothing;
- administrators must first update/delete referencing scenarios, then retry persona deletion;
- deleting a scenario cascades its compatibility rows but never deletes a persona;
- there is no soft delete, undo, audit trail, or catalog revision history.

After a successful mutation, the browser applies the returned result locally and then reloads `GET /api/catalog`, so the learner launcher reflects persisted changes immediately. A failed follow-up read is a refresh error, not a failed write. See `docs/CATALOG_AND_PROMPTS.md` for fields and HTTP status/error semantics.

## Adding further product persistence

The catalog is the first persisted product domain. Before introducing another domain table, settle at least:

- who owns and may read each record;
- whether audio is stored or only transcript/metadata;
- retention and user-initiated deletion rules;
- whether an interrupted/draft turn is durable;
- session recovery and Qwen-context rehydration behavior;
- expected query patterns and indexes;
- transaction boundaries;
- backup, restore, and schema-upgrade behavior in deployment.

Then make the change as one coherent slice:

1. add a new migration without modifying old entries;
2. add a small server-only repository/service with typed inputs and outputs;
3. wire it into an explicit application boundary rather than importing SQLite into React, shared protocol types, or model adapters;
4. add tests with a fresh temporary database and a reopen/migration case;
5. update this document and `docs/ARCHITECTURE.md` with the new durability contract;
6. run `pnpm check`.

Avoid speculative empty tables and generic key/value storage. In particular, do not add session, transcript, audio, user, or evaluation tables until their authorization, retention, deletion, and recovery contracts are explicit.

## Testing

Database tests create isolated files beneath the operating system temporary directory and remove them afterward. Current coverage verifies:

- nested parent-directory creation;
- WAL, foreign-key, and busy-timeout settings;
- creation of migration metadata, the migration-2 strict catalog schema, the migration-3 compatibility-order upgrade, the migration-4 preset schema, and the migration-5 English-label upgrade from an existing version-4 row;
- the Alex/sales-discovery seed and compatibility link;
- upgrade from a version-1 database, upgrade of an existing version-2 catalog without `position`, and migration idempotency after close/reopen;
- catalog input validation, case-insensitive duplicate names, CRUD, compatibility writes, missing references, not-found responses, and deletion conflicts;
- bilingual preset/starter-persona insertion, guarded blank-English backfill, occupied-position append behavior, compatibility append order, over-budget link rejection with full rollback, repeat-run idempotency, and preservation of administrator-edited rows;
- Fastify `onReady` open and `onClose` close.

Future migration tests should begin from both a fresh database and the immediately previous schema version. Initializer tests must set `DATABASE_PATH` to a temporary file and must cover at least two runs; changes to failure handling or absent-scenario behavior also require explicit rollback/skip cases. Never use `data/role-player.sqlite` or any developer-configured database in an automated test.

## Container storage, backup, and restore

Docker/static serving has not been implemented yet. When it is:

- mount the database directory as a persistent volume;
- keep `DATABASE_PATH` inside that mounted directory;
- ensure the runtime UID/GID can write it;
- run `pnpm catalog:init:prod` against the mounted path before starting the Node service;
- preserve the database and active WAL state as one consistency unit;
- stop the process for a simple file-level backup, or adopt SQLite-aware online backup/checkpoint tooling before copying a live database;
- test restore and forward migration before calling the backup strategy complete.

Copying only the main `.sqlite` file while the service is actively writing in WAL mode can omit committed data still present in the WAL. Backup automation is not implemented in the current repository.

## Security and data handling

- Keep the database path and all database access server-side.
- The current SQLite file is not application-level encrypted.
- Persona and scenario configuration can contain customer-like details. Do not put real personal data in catalog records without an explicit data policy.
- Do not log transcripts or personal data by default when further persistence is added.
- The current CRUD API has no authentication or authorization and is suitable only for the current controlled demo environment. Protect admin writes before exposing the service publicly or to multiple tenants.
- Define file permissions, secret management, catalog ownership, retention, export, and deletion before production user data is stored.

## Troubleshooting

### `catalog:init:prod` cannot find `dist/server/initialize-catalog.js`

The production command runs the bundled entry point and therefore requires `pnpm build` first. In a source checkout use `pnpm catalog:init`.

### Initialization completed but the SPA has no presets

The initializer and server likely resolved different database files. Confirm both processes use the same absolute `DATABASE_PATH` or the same working directory for a relative path, then rerun the initializer and restart/reload the application.

### `Database is not open.`

Code accessed `database.raw` before Fastify readiness or after close. Use the Fastify-owned instance during the application lifecycle; do not bypass startup hooks.

### Startup reports a migration mismatch

Do not rename an applied migration to silence the error. Identify which application/database version produced the file, restore the matching code or backup, and create a new forward migration when appropriate.

### `SQLITE_BUSY` or long realtime pauses

Inspect concurrent writers and synchronous query duration. The busy timeout is finite and cannot make long transactions safe for the realtime event loop. Shorten transactions/queries before increasing the timeout.

### The file is created in an unexpected directory

`DATABASE_PATH` was relative and the process started from a different working directory. Use an absolute path in deployment or make the working directory explicit.
