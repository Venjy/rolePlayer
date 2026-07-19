# AI Role Player — Realtime Voice Demo

**English** | [简体中文](README.zh-CN.md)

A single-repository React + Node/TypeScript application for configurable realtime voice sales role-play. Learners choose an SQLite-backed sales scenario, compatible customer persona, and difficulty; the browser then connects its microphone to Qwen `qwen-audio-3.0-realtime-plus` through a server-side WebSocket gateway, streams transcripts into a chat timeline, and plays the selected persona's voice. Finalized conversations, heard audio, and launch snapshots are stored in SQLite and listed in responsive history navigation. Active sessions can be continued through a fresh Qwen connection; ended sessions become immutable and receive asynchronous Qwen text-model coaching, weighted scoring, highlighted moments, and a reviewable transcript. Conversations can be downloaded as a transcript, one alternating-speaker MP3, or a ZIP containing both. A responsive admin console provides persona/scenario CRUD and an inspectable model-Instructions preview.

The UI uses one responsive React component tree for mobile and desktop. Ant Design supplies the standard controls and theme algorithms; project CSS handles the chat layout, message bubbles, recording overlay, and audio-reactive waveform.

## Repository shape

This is one root package, not a monorepo. Client, server, tests, and shared protocol definitions use the same `package.json`, lockfile, ESLint configuration, TypeScript setup, and `.gitignore`.

```text
.
├── public/                         # Browser AudioWorklet modules
├── scripts/
│   ├── initialize-catalog.ts       # Explicit idempotent catalog defaults
│   ├── split-database.ts           # One-time legacy database splitter
│   └── smoke-realtime.ts           # Live realtime smoke harness
├── src/
│   ├── client/
│   │   ├── admin/                  # Persona/scenario management console
│   │   ├── audio/                  # Microphone capture and streamed playback
│   │   ├── catalog/                # Catalog API and selection state
│   │   ├── components/             # Chat messages and VoiceWaveform
│   │   ├── conversations/          # History API, state, desktop rail/mobile Drawer
│   │   ├── i18n/                   # Locale state, persistence, Ant Design locale
│   │   ├── learner/                # Scenario/persona/difficulty launcher
│   │   ├── realtime/               # Application-protocol WebSocket client
│   │   └── voice/                  # Press-to-talk gesture state machine
│   ├── server/
│   │   ├── catalog/                # Catalog repository, routes, initializer
│   │   ├── conversations/          # Durable conversation repository and REST API
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
- [Qwen OpenAI-compatible chat completions](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)
- [Qwen structured JSON output](https://help.aliyun.com/en/model-studio/qwen-structured-output)

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
   DASHSCOPE_FEEDBACK_MODEL=qwen-plus
   ```

   SQLite uses two files by default: `data/catalog.sqlite` for personas, scenarios, presets, and compatibility; and `data/conversations.sqlite` for conversation snapshots and finalized messages. Override them with `CATALOG_DATABASE_PATH` and `CONVERSATION_DATABASE_PATH`. Relative paths resolve from the process working directory and parent directories are created automatically.

   If upgrading an existing checkout that still has `data/role-player.sqlite`, stop the server, wait for its `-wal`/`-shm` files to disappear, then run `pnpm database:split` once. The command preserves the legacy source and refuses to overwrite either destination.

4. Initialize the database-backed bilingual persona/scenario choices and starter catalog:

   ```bash
   pnpm catalog:init
   ```

   This command opens `CATALOG_DATABASE_PATH`, applies pending schema migrations, and transactionally inserts missing bilingual catalog defaults from JSON. SQLite generates numeric IDs; stable JSON seed keys and conflict-tolerant writes make repeated runs safe without duplicating data or overwriting administrator edits. It does not require Qwen credentials. A run that reports only skipped rows succeeded and simply had nothing new to insert.

5. Start the React and Node development servers:

   ```bash
   pnpm dev
   ```

6. Open [http://localhost:5173](http://localhost:5173), choose a training scenario, compatible persona, and difficulty, then select **Start voice practice** and allow microphone access. Use the left history rail on wide screens—or its header Drawer button on smaller screens—to reopen an active session or review an ended one. The admin console has its own route at [http://localhost:5173/admin](http://localhost:5173/admin). Active conversations use `/chat/:conversationId`; ended-session feedback uses `/feedback/:conversationId`. Refreshing either address reloads its durable data. The interface starts in English; use the upper-right language control to switch to Chinese.

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
| `pnpm database:split` | One-time copy from the legacy combined database into fresh catalog and conversation files |
| `pnpm database:split:prod` | Run the built one-time database splitter |
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

The command creates a normal durable conversation through the local REST API, then succeeds only when it receives a persisted user transcript, an assistant transcript, streamed assistant audio, and the response-specific `response.persisted` acknowledgement after simulated playback completion. Its finalized text therefore appears in the history list. It never reads the Qwen credentials; those remain inside the Node server process.

Add `--interrupt` to wait until generation finishes, simulate stopping queued playback partway through, and verify Qwen acknowledges the assistant-item delete/recreate repair transaction:

```bash
pnpm smoke:realtime /absolute/path/to/input.pcm --interrupt
```

Use `--interrupt-during-generation` to exercise the cancellation path. With no trusted speech-rate history yet, this case must delete the partial assistant item and conservatively retain no estimated text.

## Current behavior

- One responsive Ant Design SPA for learner launch, admin catalog, and voice chat on mobile and desktop; no separate mobile application or duplicated component tree
- Browser routes for the learner launcher (`/`), admin console (`/admin`), refreshable active conversations (`/chat/:conversationId`), and ended-session reviews (`/feedback/:conversationId`)
- Fixed global utility bar with product identity on the left, language/theme controls on every route, and a textual admin entry everywhere except the admin console itself
- English and Chinese UI with English as the first-run default, Ant Design locale synchronization, and the saved `role-player:locale` preference in `localStorage`
- Light and dark themes, initialized from the saved choice or OS preference and switchable without resetting the current surface
- Learner launcher with searchable scenario/persona selectors, compatibility filtering, Ant Design easy/medium/hard Radio buttons, preparation-focused scenario/persona cards (goals, skills, success criteria, background, personality, motivations, and concerns), and the exact compiled Instructions preview with an enforced `actual/12000` budget
- Responsive admin console with independent persona/scenario editors, separate compatibility management, derived scoring weights, standalone Instructions previews, and bilingual editable random drafts generated by the configured Qwen text model
- Database-backed bilingual persona presets plus scenario presets for training goals, skill focus, success criteria, and tone style; no persona/scenario business options are authored in the client
- Independent Chinese/English fields for every localized persona/scenario value; the current language is displayed first with fallback to the other, while admin saves update only the language being edited and never persist fallback text as a translation
- Fully bilingual JSON-defined starter personas/scenarios loaded into SQLite; user-authored content is never machine-translated
- Free-form persona name, age, background, and behavior notes, with existing non-preset values preserved when editing older/custom personas
- Persona owns reusable character attributes and the Qwen voice. Scenario owns situation, goals, skills, success criteria, derived scoring weights, and optional tone/pace/interjection behavior
- Deterministic bilingual `compileRolePlayInstructions` templates selected by the current UI/session locale; no extra LLM is called to turn structured catalog fields into the Qwen system prompt
- Shared 12,000-character Instructions budget, checked across every compatible persona and all three difficulty levels before an association can be saved
- Session-start snapshot sends the selected persona's `voice` and the compiled persona/scenario/difficulty Instructions to Qwen, so later catalog edits affect only future sessions
- Durable SQLite conversation history with immutable launch snapshots, finalized user/assistant text and PCM audio, activity ordering, and full transcript reload
- Active-conversation download as a UTF-8 transcript, one chronological mono MP3 with short gaps between speakers, or a ZIP containing both; request-time speech-aware loudness normalization balances microphone/model turns, and interrupted assistant exports exclude the conservative unheard suffix
- Responsive history navigation: persistent 288 px left rail from 1200 px, shared Ant Design Drawer below that breakpoint, current-item state, and new-practice action
- Text-context continuation through a fresh Qwen WebSocket: Node restores stored Instructions/voice and waits for recent `conversation.item.create` acknowledgements before declaring the session ready
- Conversation switching/new-practice/end actions are serialized and wait for response-specific user/assistant persistence acknowledgements before disconnecting; failed settlement is reported instead of silently dropping the last turn
- Conservative in-session goal detection after each complete AI response: a separate asynchronous Qwen text assessment suggests ending only when every scenario success criterion has explicit evidence and at least 0.9 confidence; it never forces the conversation to end
- Durable end-of-session lifecycle: ending locks further messages/realtime restoration, starts an asynchronous Qwen text-model review, survives process restarts, and exposes retryable pending/processing/completed/failed states
- Responsive coaching page with a server-calculated weighted overall score, scenario-criterion breakdown, strengths, improvements, actionable tips, validated transcript-linked moments when available, session metadata, copyable transcript, existing text/audio export options, permanent record deletion, and **Try again** creation from the same persona/scenario/difficulty; highlight count follows the available learner turns, malformed optional highlights are discarded without losing the core review, and failures identify the data/model/validation/storage stage
- Bottom-anchored conversation history with live user and assistant drafts, timestamps, and interrupted-turn labels
- Press-and-hold recording for mouse, touch, pen, Space, and Enter; release sends and upward slide cancels
- Audio-reactive microphone waveform, recording duration, and release instruction while a gesture is active
- Browser microphone capture with requested echo cancellation/noise suppression, AGC disabled, a short initialization settling window, an 80 Hz high-pass filter, and privacy-safe effective-settings diagnostics
- Streaming downsampling from the browser device rate to PCM16 16 kHz mono
- Tail-buffer acknowledgement before audio commit, avoiding clipped final syllables
- Node WebSocket proxy with server-only Qwen authentication
- Streamed PCM16 24 kHz Qwen playback with volume, mute, stop-response, and end-session controls
- Response-aware playback receipts and best-effort interrupted-response reconciliation
- Separate SQLite catalog/conversation files, Fastify lifecycle ownership, rollback-journal transactions without persistent WAL/SHM sidecars, foreign keys, busy timeout, append-only migrations, durable catalog CRUD, and an explicit transactional/idempotent catalog initializer
- Phase-aware error handling: a first-time startup failure returns to the launcher; once ready, the chat stays visible, errors use a five-second Ant Design message at the top, fatal failures rebuild safely from finalized SQLite text, and a failed rebuild can be retried from the composer

## Persistence status

Fresh catalog and conversation files have independent migration histories and contain only their own domain tables. Every preset domain has its own physical table, and catalog records reference preset IDs instead of copying localized labels. The historical combined file retains migrations 1–17 so `pnpm database:split` can upgrade and copy old data safely. Schema migrations own structure only; current business defaults are installed explicitly. The catalog REST API is:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/catalog` | Read `qwenVoices`, `personaPresets`, `scenarioPresets`, bilingual personas/scenarios, and compatibility IDs |
| `POST` | `/api/catalog/generate/persona`, `/api/catalog/generate/scenario` | Generate a validated bilingual editable draft while excluding persisted content and the submitted current drawer draft; no catalog row is saved |
| `POST`, `PUT`, `DELETE` | `/api/personas`, `/api/personas/:id` | Create, replace, or delete a persona |
| `POST`, `PUT`, `DELETE` | `/api/scenarios`, `/api/scenarios/:id` | Create, replace, or delete a scenario |

Every successful admin mutation first updates local catalog state, then reloads the authoritative catalog. Learner selections therefore reflect saved changes immediately without a rebuild or restart, and remain accurate if the follow-up read temporarily fails. Persona deletion is rejected while a scenario references it; remove the compatibility link first. Scenario deletion cascades only its compatibility rows.

The conversation REST API is:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/conversations` | Resolve authoritative persona/scenario IDs, store a bilingual snapshot, compile Instructions, and create a durable conversation |
| `GET` | `/api/conversations` | List all conversations by latest persisted activity |
| `GET` | `/api/conversations/:id` | Read one immutable launch snapshot and its ordered finalized messages |
| `POST` | `/api/conversations/:id/end` | Lock a settled conversation and enqueue coaching feedback |
| `GET` | `/api/conversations/:id/feedback` | Read feedback state/results and the review transcript |
| `POST` | `/api/conversations/:id/feedback/retry` | Retry a failed feedback job |
| `GET` | `/api/conversations/:id/download?format=audio\|text\|both` | Download one MP3, one UTF-8 transcript, or a ZIP containing both |
| `DELETE` | `/api/conversations/:id` | Permanently delete one ended conversation and all owned snapshots, messages/audio, and feedback |

Business defaults are defined only in `src/server/catalog/initial-data/*.json` and installed with `pnpm catalog:init` (source) or `pnpm catalog:init:prod` (built). The initializer inserts bilingual Qwen voice names, bilingual presets, three starter personas, three starter scenarios, and compatibility links. Stable seed keys and transactional conflict-tolerant writes make repeated runs safe without duplicate data or overwritten existing rows.

Conversation snapshots, selected difficulty, compiled Instructions, voice, finalized transcript text, and the matching finalized-message PCM are persisted in the conversation database. Cancelled input, streaming drafts, and generated-but-unheard assistant suffixes are not stored. Pre-feature text-only conversations remain available for transcript download but cannot be reconstructed as audio. An ended record can be permanently deleted from its feedback page; the server cancels any in-process feedback job before deleting the session so owned snapshots, messages/audio, and feedback cascade together. **Try again** creates a distinct conversation with the source catalog persona/scenario IDs and the previous difficulty, resolved against the current catalog and locale—it never reopens or mutates the ended session. The current private single-user deployment exposes one global history and has no automatic retention job. See [Catalog and prompt compilation](docs/CATALOG_AND_PROMPTS.md) and [Database](docs/DATABASE.md) for the complete contracts.

The default `data/` directory is ignored by Git. A future single-container deployment must mount that directory as persistent storage; embedding the database file in an ephemeral image layer would lose catalog edits when the container is replaced.

## Current limitations

Interrupted-response truncation is an estimate because Qwen does not provide word-level audio timestamps and browsers cannot prove what reached the user's physical output device. The application prefers deleting the entire interrupted assistant turn when evidence is weak.

Scenario `voiceBehavior.interruptFrequency` changes prompt-level conversational patience/interjection/challenge behavior only. Because the demo uses manual push-to-talk (`turn_detection: null`), it cannot make Qwen autonomously interrupt a learner in the middle of an utterance. Learner barge-in while the persona speaks is the separate playback-interruption feature.

History continuation is text-level context reconstruction, not revival of the old Qwen session or replay of original audio. It restores semantic transcript context but not acoustic details such as the learner's tone or emotion. The model currently receives the most recent 20 user turns while the UI keeps the complete stored transcript.

The demo does not yet include authentication/admin authorization, per-user history ownership, automatic retention controls, rubric-version administration, automatic multi-attempt feedback backoff, production rate limiting, Docker, or production static file serving.

The build already separates artifacts as follows:

```text
dist/client/   # Vite SPA output
dist/server/   # Node server and catalog initializer output
```

The intended production step is to add Fastify static serving for `dist/client`, then package both directories into one Docker image and expose only the Node service. Container startup must mount the persistent database directory, run `pnpm catalog:init:prod` against that volume, and only then start the Node service. Initialization does not depend on Qwen credentials. Docker/static serving work is intentionally deferred until the realtime core has been validated with real credentials.

## Troubleshooting

### The persona editor says required presets are missing

Stop the development server if necessary, confirm `CATALOG_DATABASE_PATH`, run `pnpm catalog:init`, then reload the SPA. In a built deployment, run `pnpm catalog:init:prod` against the same persistent volume before starting the service. These commands do not require Qwen credentials.

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

Confirm that the parent directories of `CATALOG_DATABASE_PATH` and `CONVERSATION_DATABASE_PATH` are writable by the Node process. Relative paths are resolved from the directory where the process starts. Do not put production databases in a read-only or ephemeral container path.

## Further documentation

- [Architecture](docs/ARCHITECTURE.md)
- [UI interactions](docs/UI_INTERACTIONS.md)
- [Realtime protocol](docs/REALTIME_PROTOCOL.md)
- [Database](docs/DATABASE.md)
- [Catalog and prompt compilation](docs/CATALOG_AND_PROMPTS.md)
- [AI contributor instructions](AGENTS.md)
