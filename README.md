# AI Role Player — Realtime Voice Demo

A single-repository React + Node/TypeScript application for configurable realtime voice sales role-play. Learners choose an SQLite-backed sales scenario, compatible customer persona, and difficulty; the browser then connects its microphone to Qwen `qwen-audio-3.0-realtime-plus` through a server-side WebSocket gateway, streams transcripts into a chat timeline, and plays the selected persona's voice. A responsive admin console provides persona/scenario CRUD and an inspectable model-Instructions preview.

The UI uses one responsive React component tree for mobile and desktop. Ant Design supplies the standard controls and theme algorithms; project CSS handles the chat layout, message bubbles, recording overlay, and audio-reactive waveform.

## Repository shape

This is one root package, not a monorepo. Client, server, tests, and shared protocol definitions use the same `package.json`, lockfile, ESLint configuration, TypeScript setup, and `.gitignore`.

```text
.
├── public/                         # Browser AudioWorklet modules
├── scripts/
│   ├── initialize-catalog.ts       # Explicit idempotent catalog defaults
│   └── smoke-realtime.ts           # Live realtime smoke harness
├── src/
│   ├── client/
│   │   ├── admin/                  # Persona/scenario management console
│   │   ├── audio/                  # Microphone capture and streamed playback
│   │   ├── catalog/                # Catalog API and selection state
│   │   ├── components/             # Chat messages and VoiceWaveform
│   │   ├── i18n/                   # Locale state, persistence, Ant Design locale
│   │   ├── learner/                # Scenario/persona/difficulty launcher
│   │   ├── realtime/               # Application-protocol WebSocket client
│   │   └── voice/                  # Press-to-talk gesture state machine
│   ├── server/
│   │   ├── catalog/                # Catalog repository, routes, initializer
│   │   ├── database/               # SQLite lifecycle and migrations
│   │   └── realtime/               # Qwen gateway and context repair
│   └── shared/                     # Protocol, catalog schemas, prompt compiler
├── test/                           # Unit and adapter tests
├── docs/                           # Architecture and engineering contracts
├── index.html
├── eslint.config.js
├── vite.config.ts
└── package.json
```

`pnpm-workspace.yaml` contains only pnpm's dependency-build allowlist for `esbuild`. It does not define workspace packages.

## Prerequisites

- Node.js 22.13.0 or newer (`node:sqlite` is used directly)
- pnpm 11 or newer
- An Alibaba Cloud Model Studio API key in the China (Beijing) region
- A Model Studio Workspace ID with access to `qwen-audio-3.0-realtime-plus`

Official setup references:

- [Get an API key](https://help.aliyun.com/en/model-studio/get-api-key)
- [Get a Workspace ID](https://help.aliyun.com/en/model-studio/obtain-the-app-id-and-workspace-id)
- [Qwen Audio Realtime guide](https://help.aliyun.com/en/model-studio/qwen-audio-realtime-user-guides)

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

3. Configure `.env`. Add the Beijing-region credentials before starting a voice session:

   ```dotenv
   DASHSCOPE_API_KEY=sk-ws-...
   DASHSCOPE_WORKSPACE_ID=ws_...
   ```

   SQLite defaults to `data/role-player.sqlite`. To place the file elsewhere, set `DATABASE_PATH` to an absolute path or a path relative to the process working directory. The parent directory is created automatically. Catalog initialization needs only this server/database configuration; the Qwen credential fields may still be blank while running it.

4. Initialize the database-backed persona choices and starter personas:

   ```bash
   pnpm catalog:init
   ```

   This command opens the configured `DATABASE_PATH`, applies pending schema migrations, inserts missing catalog defaults, and backfills only blank English labels on unchanged built-in preset rows in one transaction. It is safe to run repeatedly, preserves administrator edits, and does not require Qwen credentials.

5. Start the React and Node development servers:

   ```bash
   pnpm dev
   ```

6. Open [http://localhost:5173](http://localhost:5173), choose a training scenario, compatible persona, and difficulty, then select **Start voice practice** and allow microphone access. Use **Admin console** to create or edit catalog records. The interface starts in English; use the upper-right language control to switch to Chinese.

7. Hold **Hold to talk** while speaking. Release to send, or slide upward at least 72 px before releasing to cancel. While the selected persona is speaking, the control changes to **Hold to interrupt and talk**; holding it stops the current playback, begins context reconciliation, and records the next turn. The Chinese interface uses the equivalent **按住说话** and **按住打断并说话** labels.

Do not paste a real API key into source code, commit it, or expose it through a `VITE_*` variable.

### UI-only development previews

When reviewing layout without granting microphone permission or opening a Qwen session, use the development-only fixtures below while Vite is running:

- [http://localhost:5173/?preview=session](http://localhost:5173/?preview=session) — populated conversation while Alex is speaking
- [http://localhost:5173/?preview=recording](http://localhost:5173/?preview=recording) — active recording waveform and composer spacing

These URLs reuse the production React components but inject static in-memory state. Voice controls are intentionally not functional there, and `preview` is ignored in a production build.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run Vite and the Node server together |
| `pnpm dev:client` | Run only the React development server |
| `pnpm dev:server` | Run only the Node TypeScript server |
| `pnpm catalog:init` | Apply migrations and idempotently add missing presets/starter personas using TypeScript sources |
| `pnpm catalog:init:prod` | Run the built initializer against the deployment database before starting the built server |
| `pnpm lint` | Run the shared ESLint configuration |
| `pnpm typecheck` | Type-check client, server, and shared code |
| `pnpm test` | Run all tests once |
| `pnpm smoke:realtime <pcm-file> [interrupt flag]` | Exercise a normal or interrupted live Qwen turn through the local Node gateway |
| `pnpm build` | Build the Node server/initializer to `dist/server` and React to `dist/client` |
| `pnpm check` | Run lint, type-check, tests, and both builds |

### Optional live smoke test

With `pnpm dev:server` running, send any headerless PCM16, 16 kHz, mono recording through the same gateway used by the SPA:

```bash
pnpm smoke:realtime /absolute/path/to/input.pcm
```

The command succeeds only when it receives a user transcript, an assistant transcript, a completed response, and streamed assistant audio. It never reads the Qwen credentials; those remain inside the Node server process.

Add `--interrupt` to wait until generation finishes, simulate stopping queued playback partway through, and verify Qwen acknowledges the assistant-item delete/recreate repair transaction:

```bash
pnpm smoke:realtime /absolute/path/to/input.pcm --interrupt
```

Use `--interrupt-during-generation` to exercise the cancellation path. With no trusted speech-rate history yet, this case must delete the partial assistant item and conservatively retain no estimated text.

## Current behavior

- One responsive Ant Design SPA for learner launch, admin catalog, and voice chat on mobile and desktop; no separate mobile application or duplicated component tree
- English and Chinese UI with English as the first-run default, an upper-right language control, Ant Design locale synchronization, and the saved `role-player:locale` preference in `localStorage`
- Light and dark themes, initialized from the saved choice or OS preference and switchable from the upper-right control
- Learner launcher with searchable scenario and persona selectors, compatibility filtering, easy/medium/hard difficulty, and summaries of goals, skill focus, voice behavior, and persona traits
- Responsive admin console with searchable persona/scenario tabs, create/edit drawers, validation, deletion confirmation, compatibility editing, and live Instructions preview
- Database-backed bilingual persona presets for identity, occupation, personality traits, communication style, motivations, and concerns; the stable Chinese value is stored in the persona while English UI summaries, prompt previews, and English-launched model Instructions project exact preset matches through `valueEn`
- Authored English/Chinese display content for the unmodified built-in personas and default scenario; administrator-edited and user-created free text is always shown exactly as saved and is never machine-translated
- Free-form persona name, age, background, and behavior notes, with existing non-preset values preserved when editing older/custom personas
- Scenario fields for situation, goals, skill focus, hidden success/scoring criteria, compatible personas, and voice behavior
- Deterministic `compileRolePlayInstructions` template; no extra LLM is called to turn structured catalog fields into the Qwen system prompt
- Shared 12,000-character Instructions budget, checked across every compatible persona and all three difficulty levels before an association can be saved
- Session-start snapshot sends the selected persona's `voice` and the compiled persona/scenario/difficulty Instructions to Qwen, so later catalog edits affect only future sessions
- Bottom-anchored conversation history with live user and assistant drafts, timestamps, and interrupted-turn labels
- Press-and-hold recording for mouse, touch, pen, Space, and Enter; release sends and upward slide cancels
- Audio-reactive microphone waveform, recording duration, and release instruction while a gesture is active
- Browser microphone capture with requested echo cancellation, noise suppression, and automatic gain control
- Streaming downsampling from the browser device rate to PCM16 16 kHz mono
- Tail-buffer acknowledgement before audio commit, avoiding clipped final syllables
- Node WebSocket proxy with server-only Qwen authentication
- Streamed PCM16 24 kHz Qwen playback with volume, mute, stop-response, and end-session controls
- Response-aware playback receipts and best-effort interrupted-response reconciliation
- SQLite file setup, Fastify lifecycle ownership, WAL mode, foreign keys, busy timeout, an append-only migration runner, durable catalog CRUD, and an explicit transactional/idempotent catalog initializer
- Basic malformed-message, connection, transcription, model, microphone, and configuration error handling

## Persistence status

Migration 2 persists the role-play catalog in strict `personas`, `scenarios`, and `scenario_personas` tables and contains the immutable legacy Alex/sales-discovery seed. Migration 3 adds deterministic per-scenario persona ordering and upgrades already-created catalog files without requiring deletion. Migration 4 creates the strict `persona_presets` reference table; it intentionally contains no business seed data. Migration 5 adds the backward-compatible English display column for preset rows. The catalog REST API is:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/catalog` | Read `personaPresets`, personas, and scenarios with compatibility IDs |
| `POST`, `PUT`, `DELETE` | `/api/personas`, `/api/personas/:id` | Create, replace, or delete a persona |
| `POST`, `PUT`, `DELETE` | `/api/scenarios`, `/api/scenarios/:id` | Create, replace, or delete a scenario |

Every successful admin mutation first updates local catalog state, then reloads the authoritative catalog. Learner selections therefore reflect saved changes immediately without a rebuild or restart, and remain accurate if the follow-up read temporarily fails. Persona deletion is rejected while a scenario references it; remove the compatibility link first. Scenario deletion cascades only its compatibility rows.

Business defaults are installed explicitly with `pnpm catalog:init` during source development or `pnpm catalog:init:prod` after building. The initializer inserts 70 bilingual presets (8 identities, 12 occupations, 16 personality traits, 8 communication styles, 12 motivations, and 14 concerns) plus the starter personas 林悦, 王强, and 陈晨. For an existing seed preset whose category and Chinese value are still unchanged, a blank English value is backfilled without replacing a non-empty administrator translation; legacy/custom rows with no English label fall back to their canonical text in the UI. If `scenario_sales_discovery` exists, the initializer appends missing starter-persona links without replacing the current ordering, but only after each pair passes the shared easy/medium/hard 12,000-character Instructions check. An over-budget pair produces a clear error and rolls back the initializer's data writes. The whole operation is transactional and idempotent.

Sessions, learner difficulty choices, transcripts, audio, users, and evaluations are not persisted. There is no catalog soft deletion, audit history, or built-in undo. See [Catalog and prompt compilation](docs/CATALOG_AND_PROMPTS.md) and [Database](docs/DATABASE.md) for the complete contracts.

The default `data/` directory is ignored by Git. A future single-container deployment must mount that directory as persistent storage; embedding the database file in an ephemeral image layer would lose catalog edits when the container is replaced.

## Current limitations

Interrupted-response truncation is an estimate because Qwen does not provide word-level audio timestamps and browsers cannot prove what reached the user's physical output device. The application prefers deleting the entire interrupted assistant turn when evidence is weak.

Scenario `interruptFrequency` changes prompt-level conversational patience/interjection/challenge behavior only. Because the demo uses manual push-to-talk (`turn_detection: null`), it cannot make Qwen autonomously interrupt a learner in the middle of an utterance. Learner barge-in while the persona speaks is the separate playback-interruption feature.

The demo does not yet include authentication/admin authorization, session or evaluation persistence, generated feedback/scoring, session recovery, production rate limiting, Docker, or production static file serving.

The build already separates artifacts as follows:

```text
dist/client/   # Vite SPA output
dist/server/   # Node server and catalog initializer output
```

The intended production step is to add Fastify static serving for `dist/client`, then package both directories into one Docker image and expose only the Node service. Container startup must mount the persistent database directory, run `pnpm catalog:init:prod` against that volume, and only then start the Node service. Initialization does not depend on Qwen credentials. Docker/static serving work is intentionally deferred until the realtime core has been validated with real credentials.

## Troubleshooting

### The persona editor says required presets are missing

Stop the development server if necessary, confirm `DATABASE_PATH`, run `pnpm catalog:init`, then reload the SPA. In a built deployment, run `pnpm catalog:init:prod` against the same persistent volume before starting the service. These commands do not require Qwen credentials.

### Catalog initialization rejects an oversized scenario link

The named starter persona/default-scenario pair exceeds the 12,000-character Instructions limit in the reported difficulty, usually after administrator edits. Shorten that persona or scenario configuration, then rerun initialization; the failed run committed none of its initializer data writes.

### The start button says credentials are not configured

Create `.env`, add both required values, and restart `pnpm dev`. The server reads secrets only at process startup.

### Qwen returns HTTP 401 or 403

Confirm that:

- the API key belongs to the China (Beijing) region;
- the Workspace ID is from the same region;
- the workspace has access to `qwen-audio-3.0-realtime-plus`;
- neither value contains quotes or trailing spaces.

### Microphone access fails

Microphone capture requires `localhost` or HTTPS. Check the browser's site-level microphone permission, confirm that an input device exists, then reload the page.

### The transcript works but no audio is heard

Check the page volume and mute controls, system output device, and browser tab audio permission. The app uses Web Audio because Qwen returns raw PCM rather than MP3 or WAV.

### The server cannot open the SQLite database

Confirm that the `DATABASE_PATH` parent directory is writable by the Node process. Relative paths are resolved from the directory where the process starts. Do not put the production database in a read-only or ephemeral container path.

## Further documentation

- [Architecture](docs/ARCHITECTURE.md)
- [UI interactions](docs/UI_INTERACTIONS.md)
- [Realtime protocol](docs/REALTIME_PROTOCOL.md)
- [Database](docs/DATABASE.md)
- [Catalog and prompt compilation](docs/CATALOG_AND_PROMPTS.md)
- [AI contributor instructions](AGENTS.md)
