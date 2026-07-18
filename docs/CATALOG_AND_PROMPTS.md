# Role-play catalog and prompt compilation

## Purpose

The role-play catalog is the durable configuration layer for learner sessions. Administrators edit customer personas and sales scenarios in the SPA; Fastify validates and stores them in SQLite; learners choose a compatible scenario/persona pair and a difficulty before opening a realtime session.

Catalog configuration is global to the current deployment. Authentication, per-tenant ownership, audit history, soft deletion, and catalog versioning are not implemented yet.

## Shared domain contract

`src/shared/role-play-catalog.ts` is the browser/server source of truth. Both REST payloads and database rows are parsed through its Zod schemas.

### Persona presets

`persona_presets` is database-backed reference data for the persona editor. Each returned `PersonaPreset` contains `id`, `category`, `value`, non-negative `position`, and ISO `createdAt`/`updatedAt` timestamps. The six categories are:

| Category | Persona field |
| --- | --- |
| `identity` | `identity` |
| `occupation` | `occupation` |
| `personality_trait` | entries in `personalityTraits` |
| `communication_style` | `communicationStyle` |
| `motivation` | entries in `motivations` |
| `concern` | entries in `concerns` |

Presets are choices, not normalized persona ownership. On save, the form sends the selected **text**, and that text is stored in the persona columns/JSON arrays. No persona field has a foreign key to `persona_presets`. Changing, removing, or reordering a preset affects future choices only and never rewrites an existing persona.

The editor filters options by category and orders them by `position`. Occupation, identity, and communication style are searchable single selects; occupation can be cleared. Personality traits, motivations, and concerns are searchable multiple selects with the existing 12/10/10 item limits. They do not accept arbitrary new tags for a new persona.

Backward compatibility is deliberate: when an existing persona contains text no longer present in the preset table, the editor adds that text as an `existing value` option so it remains visible and savable. Name, age, background, and behavior notes remain free-form; gender and voice retain their fixed selectors. Creating a persona requires available identity, personality-trait, and communication-style presets, so the UI disables save and directs the operator to run catalog initialization when those required categories are empty.

### Persona

A persona contains:

| Field | Contract |
| --- | --- |
| `name` | Required, unique case-insensitively, at most 80 characters |
| `gender` | `female`, `male`, `non_binary`, or `unspecified` |
| `age` | Nullable integer from 1 through 120 |
| `occupation` | May be empty; otherwise at most 120 characters |
| `identity` | Required role and point of view, at most 240 characters |
| `background` | May be empty; otherwise at most 2,000 characters |
| `personalityTraits` | 1–12 entries, each at most 160 characters |
| `communicationStyle` | Required, at most 500 characters |
| `behaviorNotes` | May be empty; otherwise at most 2,000 characters |
| `motivations` | 0–10 entries, each at most 160 characters |
| `concerns` | 0–10 objections/concerns, each at most 160 characters |
| `voice` | One supported Qwen voice: `longanqian`, `longanlingxin`, `longanlingxi`, `longanxiaoxin`, or `longanlufeng` |

Persisted responses also contain an immutable `id` and ISO `createdAt`/`updatedAt` timestamps.

Every input property is present in the JSON contract. Conceptually optional text is represented by an empty string, optional age by `null`, and optional lists by an empty array.

### Scenario

A scenario contains:

| Field | Contract |
| --- | --- |
| `name` | Required, unique case-insensitively, at most 120 characters |
| `description` | Required situation/background, at most 2,000 characters |
| `goals` | 1–10 learner goals, each at most 160 characters |
| `suggestedSkillFocus` | 1–10 skill areas, each at most 160 characters |
| `successCriteria` | 1–12 hidden completion criteria, each at most 160 characters |
| `scoringCriteria` | 0–12 unique names and integer percentage weights; a non-empty list must total 100 |
| `allowedPersonaIds` | 1–100 unique IDs of existing compatible personas |
| `voiceBehavior.interruptFrequency` | `low`, `medium`, or `high` |
| `voiceBehavior.speakingPace` | `slow`, `normal`, or `fast` |
| `voiceBehavior.toneStyle` | Required tone description, at most 160 characters |

Persisted responses also contain an immutable `id` and ISO `createdAt`/`updatedAt` timestamps.

`allowedPersonaIds` is ordered. Migration 3 stores that order as `scenario_personas.position`, and the learner selector shows only personas allowed by the selected scenario.

## REST API

The browser uses this application-owned JSON API:

| Method and path | Result |
| --- | --- |
| `GET /api/catalog` | `{ personaPresets, personas, scenarios }`, with compatibility IDs embedded in each scenario |
| `POST /api/personas` | Create a persona; returns `201` and the persisted persona |
| `PUT /api/personas/:id` | Replace editable fields on an existing persona |
| `DELETE /api/personas/:id` | Delete an unreferenced persona; returns `204` |
| `POST /api/scenarios` | Create a scenario; returns `201` and the persisted scenario |
| `PUT /api/scenarios/:id` | Replace editable fields and compatibility links |
| `DELETE /api/scenarios/:id` | Delete a scenario and its compatibility links; returns `204` |

`personaPresets` is read-only through the current HTTP surface; there are no preset mutation routes or preset-management screen. The explicit initializer supplies deployment defaults. A future preset editor must preserve the same snapshot/no-foreign-key contract.

Invalid payloads and IDs return `400`; missing resources return `404`; case-insensitive duplicate names return `409`. Creating or updating a scenario with unknown persona IDs returns `400`. A compatible pair that would exceed the realtime Instructions budget returns `400` with `error.code: "instructions_too_long"`, the persona/scenario names, actual length, and maximum length.

Persona deletion is deliberately restrictive. If any scenario still references the persona, the server returns `409` with `error.code: "persona_in_use"` and the referencing scenario IDs. The administrator must remove those compatibility links first. Deleting a scenario cascades only its `scenario_personas` rows.

After every successful create, update, or delete, `useRolePlayCatalog` applies the returned result locally and then reloads `GET /api/catalog`. The learner launch screen therefore reflects saved changes immediately without a frontend rebuild or server restart. If only the follow-up read fails, the write remains successful and the local result is retained with a synchronization warning.

## Schema history and explicit catalog initialization

Migration 2 contains an immutable legacy starter configuration on a fresh or version-1 database:

- persona `persona_alex`: Alex, an Operations Director evaluating a sales lead qualification solution, using `longanqian`;
- scenario `scenario_sales_discovery`: Sales discovery call, with goals, skill focus, hidden success/scoring criteria, and a low interjection/challenge tendency;
- one compatibility link from the sales discovery scenario to Alex.

That legacy seed runs only as part of migration 2. Migration 3 adds compatibility ordering. Migration 4 creates `persona_presets` but inserts no business/reference rows. This is the current rule: migrations build/upgrade schema; explicit initialization owns editable defaults.

Run initialization after configuring `DATABASE_PATH` and before the first development server start:

```bash
pnpm catalog:init
```

For a built deployment, run this before starting the server:

```bash
pnpm catalog:init:prod
```

The source and production commands perform the same operation and require no Qwen credentials. The initializer applies pending migrations, then transactionally inserts only missing stable records:

- 70 Chinese presets: 8 identities, 12 occupations, 16 personality traits, 8 communication styles, 12 motivations, and 14 concerns;
- three sales-training personas: 林悦 (`persona_lin_yue`), 王强 (`persona_wang_qiang`), and 陈晨 (`persona_chen_chen`);
- compatibility links appended to `scenario_sales_discovery` when that scenario exists.

Repeated runs are safe. A preset is considered present when either its stable `preset_*` ID or the same case-insensitive category/value exists, and is skipped without update. If a missing preset's preferred position is occupied, it is appended at that category's current maximum position plus one instead of moving the existing row. Starter personas use conflict-tolerant inserts and are never updated. Existing scenario compatibility and ordering are retained; missing starter links are appended after the current maximum position. Before each missing link is inserted, the initializer enforces the shared 100-persona scenario capacity and uses the shared compiler check for easy, medium, and hard. A capacity or over-budget failure raises a descriptive initializer error and rolls back every data write from that initializer call. If the default scenario has been deleted, initialization does not recreate it and simply skips those links.

All initializer data writes commit or roll back together. This is intentionally separate from normal server startup: source setup runs `catalog:init` before `pnpm dev`, while a container runs `catalog:init:prod` against its mounted persistent database before starting the service.

## Learner session selection

Before starting audio, the learner chooses:

1. a searchable scenario;
2. a searchable persona filtered by that scenario's `allowedPersonaIds`;
3. `easy`, `medium`, or `hard` difficulty.

The launch screen summarizes scenario goals, skill focus, voice behavior, persona identity, traits, communication style, behavior notes, and voice. A session cannot start without a valid compatible pair or without configured Qwen credentials.

`App.tsx` snapshots the selected persona, scenario, and difficulty when startup begins. Later catalog edits do not mutate an already active session. The snapshot supplies:

- `persona.voice` as the Qwen `session.configure.voice` value;
- `compileRolePlayInstructions({ persona, scenario, difficulty })` as `session.configure.instructions`;
- `persona.name` for assistant labels and speaking state in the chat UI.

## Deterministic Instructions compiler

`src/shared/role-play-instructions.ts` compiles structured configuration with a deterministic template. It does **not** call an additional language model.

This is intentional:

- identical saved input produces identical Instructions;
- administrators can inspect and copy the prompt preview before saving;
- required rules and hidden fields cannot disappear because a secondary model paraphrased them;
- session startup adds no extra latency, network dependency, token cost, or failure mode;
- compiler output can be unit tested.

The prompt has stable sections for the customer persona, sales scenario, behavior, and non-negotiable rules. It includes identity and demographics, personality, motivations, concerns, goals, skill focus, hidden success/scoring criteria, difficulty behavior, tone, pace, and conversational interjection behavior. It also instructs Qwen to remain the customer, keep turns concise, react to actual learner input, use the learner's language unless asked to switch, and never reveal hidden configuration.

Difficulty is a runtime choice, not a persisted scenario field:

- `easy` makes the customer cooperative with mild objections;
- `medium` reveals information gradually and raises realistic objections;
- `hard` makes the customer skeptical, demanding, and less forthcoming.

The persona voice is sent as the separate Qwen `voice` parameter; describing a voice in prompt prose is not a substitute for that parameter.

### Instructions length budget

The application protocol accepts at most 12,000 characters in `session.configure.instructions`. `findRolePlayInstructionsLengthIssue` compiles easy, medium, and hard and reports the longest over-budget variant. The admin preview shows this budget for the selected pair; saving a scenario checks every `allowedPersonaId`, and editing an already-associated persona checks all scenarios that reference it. `CatalogRepository` repeats the same checks as the authoritative boundary, so bypassing the SPA cannot persist an unusable association.

An unassociated persona may be saved as a draft even when a preview with a fallback or existing scenario is over budget, but it cannot later be associated until the combined configuration is shortened. `App.tsx` performs one final guard before microphone permission and WebSocket startup.

### Interruption limitation

`voiceBehavior.interruptFrequency` controls the role's conversational behavior inside model turns—for example, patience, brief interjections, or quicker challenges. The current transport is manual push-to-talk with `turn_detection: null`. Qwen does not listen and speak simultaneously or autonomously seize the microphone, so this field cannot make the model interrupt the learner mid-utterance.

The **barge-in** feature is a different mechanism: the learner can press while the model is speaking, which stops local playback and repairs Qwen conversation context. Do not conflate learner barge-in with scenario interruption frequency.

## Persistence and evolution

Presets, personas, scenarios, and compatibility links persist until explicitly updated/deleted, reinserted by a requested initializer run, or restored from a database backup. There is no built-in undo, soft delete, audit log, or catalog revision history. Session transcripts, audio, evaluation results, users, and learner difficulty choices are not persisted.

When extending the catalog:

1. update the shared Zod contract first;
2. add a new immutable schema migration rather than editing migrations 2, 3, or 4;
3. put editable reference/business defaults in the idempotent initializer rather than migration SQL;
4. update the repository mapping and REST/initializer tests;
5. update both admin forms and learner summaries where relevant;
6. decide explicitly whether a field belongs in the Instructions compiler, the separate Qwen session configuration, or presentation only;
7. preserve deterministic prompt compilation unless a separately reviewed product requirement justifies a model call.
