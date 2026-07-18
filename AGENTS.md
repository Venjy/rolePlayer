# AGENTS.md

## Project goal

Build an AI sales role-player around realtime voice conversations. The current milestone combines a reliable browser ↔ Node ↔ Qwen Audio voice loop with an editable, SQLite-backed persona/scenario catalog, durable text conversation history, and a responsive learner/admin interface. Preserve the working voice, history-recovery, and catalog contracts while extending the product.

Before changing a subsystem, read its focused contract:

- `docs/ARCHITECTURE.md` — runtime and source boundaries
- `docs/UI_INTERACTIONS.md` — responsive layout, theme, and gesture behavior
- `docs/REALTIME_PROTOCOL.md` — browser/server messages and ordering
- `docs/DATABASE.md` — SQLite lifecycle and migration rules
- `docs/CATALOG_AND_PROMPTS.md` — persona/scenario fields, CRUD semantics, compatibility, and Instructions compilation

## Repository contract

- This is one repository and one root npm package. Do not convert it into a monorepo or add nested `package.json` files.
- React code lives in `src/client`.
- Node/TypeScript code lives in `src/server`.
- Code shared by browser and server lives in `src/shared` and must not import Node-only APIs or secrets.
- Browser AudioWorklet modules live in `public` because browsers must receive compiled JavaScript with the correct MIME type.
- Use the root ESLint, TypeScript, lockfile, scripts, and `.gitignore`.
- Production will eventually serve `dist/client` from the Node server and ship one Docker image. Do not create independently deployed frontend/backend projects.

## Required verification

Before handing off any code change, run:

```bash
pnpm check
```

If a change affects real audio or Qwen integration, also perform the manual voice test described in `README.md` when credentials are available.

For UI or gesture changes, additionally verify at minimum:

- a narrow mobile viewport around 360 px;
- the 767/768 px responsive boundary;
- a desktop viewport;
- both light and dark themes;
- normal hold/release, upward cancellation, and AI-speaking barge-in;
- keyboard hold/release with Space or Enter;
- no horizontal overflow and no composer overlap with the latest message.

Vite development mode exposes `?preview=session` and `?preview=recording` for deterministic visual checks without microphone permission. They are static fixtures only; use the real session for audio and gesture behavior.

For database changes, add or update tests using temporary database files. Never point automated tests at the development database.

Catalog initializer tests must also use an explicit temporary `DATABASE_PATH`. Never run `catalog:init` or `catalog:init:prod` against the development database from an automated test.

## UI contract

- Mobile and desktop use one React component tree. Implement responsive behavior with CSS and Ant Design primitives; do not build separate mobile and desktop pages.
- Prefer Ant Design components, icons, theme tokens, and accessibility behavior for standard controls. Use project components/CSS where the library has no appropriate primitive, such as chat bubbles and the microphone waveform.
- Keep the three session regions intact: header, independently scrollable conversation, and bottom voice composer. Account for mobile safe-area insets.
- Messages are chronological, with the newest at the bottom. Auto-follow only while the reader is near the bottom; do not yank a reader who has scrolled up.
- Theme selection belongs to the root `ConfigProvider`. Keep Ant Design's algorithm, the `data-theme` CSS variables, and `color-scheme` synchronized. A theme change must not recreate the realtime or audio session.
- Locale selection belongs to `src/client/i18n` and the root `ConfigProvider`. English is the first-run default; persist only `en` or `zh` under `role-player:locale`, synchronize Ant Design locale and the document `lang`, and keep the language control in the upper-right header actions on learner, admin, and active-session surfaces. A locale change must not recreate the realtime or audio session.
- Every user-interface string—including validation, errors, placeholders, tooltips, accessibility names, and empty states—must provide English and Chinese text through the shared i18n context. Do not infer locale by inspecting translated content.
- Persona preset `value` is the stable Chinese snapshot value and `valueEn` is its English locale projection. Option values must remain canonical across locale changes. In English, map exact preset-backed persona snapshots through `valueEn` for summaries, prompt previews, and session Instructions; never translate or rewrite administrator-authored free text. Authored starter-catalog translations may be used only while a starter record remains unmodified.
- Preserve semantic names, `role="log"`, status announcements, pointer/keyboard parity, and `prefers-reduced-motion` behavior.
- Keep UI components free of API keys, Alibaba Cloud endpoints, and raw Qwen event types.
- Keep the learner launcher, admin console, and active session in one responsive React application. The learner selects a searchable scenario, a compatible persona, and a difficulty before starting; the admin console owns persona/scenario CRUD and prompt preview.
- Keep conversation history in the learner workspace: a persistent left rail at 1200 px and above, and the same list content inside an Ant Design Drawer below that breakpoint. Selecting a saved conversation must reconnect with its immutable snapshot and restored text context; it must not reuse current catalog rows.
- Before switching conversations, starting a new role-play, or ending an active session, serialize the transition and settle durable state first: cancel uncertain uncommitted input, reconcile the current assistant, wait for any committed user turn's persisted `transcript.user.done`, then re-check for a newly-created assistant. Interrupted output requires `response.reconciled`; natural drain requires the matching `response.persisted`. Timeout/close/send failure must not be treated as a successful acknowledgement.
- Keep `.application-root` at viewport height with its own scrolling because `body` uses `overflow: hidden`. On the learner launcher, keep difficulty and the primary start action ahead of the longer summaries so the CTA remains discoverable.
- An active session must display the snapshotted persona identity. Catalog refreshes or edits must not silently change a session already in progress.
- Persona identity, occupation, personality traits, communication style, motivations, and concerns use database-backed preset choices. Name, age, background, and behavior notes remain free-form. Existing persona text that is not present in the current presets must remain visible and savable.

## Press-to-talk invariants

- The gesture lifecycle is owned by `PressToTalkController`; React bindings live in `use-press-to-talk.ts`. Keep asynchronous microphone startup races out of the JSX.
- Pointer input uses pointer capture so release remains observable outside the button.
- Normal release submits exactly once. Moving upward by at least 72 px and then releasing cancels.
- `pointercancel`, unexpected lost pointer capture, window blur, hidden-document transition, disabled input, unmount, and explicit session end must cancel rather than commit uncertain audio.
- A quick release that occurs before asynchronous microphone startup resolves must still finish deterministically: submit after a successful start, or return to idle if startup fails.
- Forced cancellation and session transitions must wait for the whole gesture lifecycle, including already-released `starting` work and an already-running `finishing` handler. Async capture/submit/cancel continuations must be scoped to their runtime epoch and local audio/realtime instances.
- Space and Enter provide the same hold/release lifecycle for keyboard users.
- Cancellation stops capture, clears the upstream input buffer, and never sends `input.commit`.
- Before a normal commit, wait for the AudioWorklet to flush its final partial frame and acknowledge stop.
- Pressing while AI speech is active first captures a conservative playback receipt and interrupts that response, then starts the new input turn. Preserve this ordering.

## Realtime invariants

- Never expose `DASHSCOPE_API_KEY` or other server credentials to browser code, logs, committed files, or `VITE_*` variables.
- The browser speaks only the application protocol in `src/shared/realtime-protocol.ts`; do not couple React directly to Qwen's raw event schema.
- Do not send microphone audio until Qwen has emitted `session.updated` and Node has emitted `session.ready`.
- Microphone input to Qwen is little-endian PCM16, 16 kHz, mono.
- Qwen output is little-endian PCM16, 24 kHz, mono.
- On response cancellation, clear local scheduled audio immediately and send upstream cancellation. Node must suppress late audio for the cancelled response.
- Treat Qwen user transcript delta as `text + stash`; do not append each `text` value.
- Permit only one committed user turn to await finalized transcription. Disable browser push-to-talk while it is pending and reject a second server-side `input.start` with `USER_TURN_PENDING` as defense in depth.
- Unknown upstream events must be ignored rather than terminating a session.
- Closing a browser WebSocket must close its Qwen WebSocket to avoid leaks and continued billing.
- Browser `session.configure` carries only the durable `conversationId` and bounded history limit. Node must load snapshotted Instructions/voice from `ConversationRepository`; never trust browser-supplied prompt or voice fields. Do not add a second model call to paraphrase structured catalog fields.
- A Qwen WebSocket cannot revive an expired upstream session. Resume by opening a new Qwen connection and acknowledging ordered `conversation.item.create` text-history injection before emitting browser `session.ready`.
- Route errors by lifecycle phase. A conversation that has never reached `session.ready` fails initialization back to the launcher. After its first readiness, show every error through an Ant Design message at the top for five seconds; for a fatal runtime error, preserve the chat surface and rebuild the same conversation once from finalized SQLite text instead of reusing uncertain Qwen context. If that rebuild fails, keep the chat visible and turn the composer button into a manual reconnect action rather than navigating automatically.
- Persist the final user transcript before publishing `transcript.user.done`. Associate each generated response with its committed user turn and hold assistant persistence until that user text is durable; failed/empty ASR must not leave an orphan assistant. Persist a normal assistant message only after both generation and browser playback complete, then publish response-specific `response.persisted`; persist an interrupted assistant message only after context repair confirms its retained prefix. Never persist streaming drafts or unheard generated suffixes.

## Catalog and prompt invariants

- `src/shared/role-play-catalog.ts` is the browser/server domain contract. Validate REST input at the Fastify boundary and parse persisted rows before returning them.
- A scenario must reference at least one existing persona. The learner persona selector must expose only personas listed in the selected scenario's `allowedPersonaIds`.
- After successful catalog mutation, apply the returned result locally and reload the authoritative catalog. A failed follow-up read must not be reported as though the write itself failed.
- `GET /api/catalog` returns `personaPresets` alongside personas and scenarios. Keep preset categories limited to `identity`, `occupation`, `personality_trait`, `communication_style`, `motivation`, and `concern` unless the shared contract and migration are deliberately extended.
- Every preset API record exposes both `value` and `valueEn`; English UI must fall back to `value` when `valueEn` is empty. The deployment initializer may backfill an empty English value only when stable seed ID, category, and canonical value still match, but it must never overwrite a non-empty administrator-edited English value.
- Persona records store selected preset text as ordinary field snapshots. Do not add foreign keys from persona fields to `persona_presets`; changing or removing a preset must not rewrite existing personas.
- Persona names and scenario names are unique case-insensitively. A referenced persona cannot be deleted; remove it from every scenario first. Scenario deletion may cascade only its compatibility rows.
- `compileRolePlayInstructions` must remain deterministic, inspectable, and unit-tested. Preserve hidden criteria/rules and omit empty optional fields; do not introduce nondeterministic prompt generation into session startup.
- Compiled conversation Instructions have a shared 12,000-character limit. Validate every compatible persona/scenario pair across easy, medium, and hard before saving an association, and keep the App-level guard as defense in depth.
- Difficulty is selected per launch and is not stored on a scenario. Snapshot persona, scenario, and difficulty before connecting so later catalog edits cannot mutate an active session.
- `voiceBehavior.interruptFrequency` describes conversational interjections/challenge style within model turns. With manual push-to-talk it cannot make Qwen autonomously interrupt a learner who is still speaking; learner barge-in is the separate playback-interruption flow.

## Database invariants

- SQLite is server-only. Do not import `node:sqlite`, database paths, or repository implementations into browser/shared code.
- The supported Node minimum is 22.13.0 because the project imports `node:sqlite` without a runtime flag.
- Fastify owns one `ApplicationDatabase` connection per process: open it in `onReady` and close it in `onClose`.
- Keep `foreign_keys`, WAL journal mode, and the busy timeout enabled unless a measured production issue justifies a documented change.
- Migrations are immutable and strictly increasing. Add a new entry to `DATABASE_MIGRATIONS`; never edit or reorder a migration that may have run elsewhere.
- Migration 2 owns the persisted catalog tables `personas`, `scenarios`, and `scenario_personas` plus the editable Alex/sales-discovery seed. Never rewrite that migration to change fields or seed data; use a later migration.
- Migration 3 adds `scenario_personas.position` and its unique ordering index, including forward upgrade of an already-created migration-2 database. It is immutable as well.
- Migration 4 creates the `persona_presets` schema only. New business/reference content belongs in the explicit catalog initializer, not in migration SQL. Migration 2's historical Alex/scenario seed is immutable legacy behavior, not a pattern for later migrations.
- Migration 5 adds `persona_presets.value_en` with an empty legacy default. Existing databases require the normal initializer run to backfill deployment-owned English labels without replacing administrator edits.
- Migration 6 creates `conversation_sessions` and `conversation_messages`. Sessions store immutable localized persona/scenario snapshots, difficulty, locale, exact compiled Instructions, and voice; messages store finalized text only and cascade with their owning session. Migration 6 is immutable.
- Keep catalog access behind `CatalogRepository`. Avoid long synchronous queries in request handlers because `DatabaseSync` blocks the Node event loop.
- Keep conversation access behind `ConversationRepository`. Current ownership is a single private deployment with one global history; there is no retention job or deletion endpoint, and records live with the SQLite file. Add authentication/authorization and per-owner filtering before any multi-user or public deployment.
- `pnpm catalog:init` and `pnpm catalog:init:prod` must be transactional and idempotent: insert missing stable records/links, backfill only blank English values on otherwise unchanged stable seed rows, preserve administrator edits, and never require Qwen credentials. Detect an existing preset by stable ID or case-insensitive category/value; append a missing preset when its preferred position is occupied rather than reordering existing data. Before inserting any missing scenario link, enforce `MAX_SCENARIO_PERSONAS` and validate that pair across easy/medium/hard against the shared 12,000-character Instructions limit; either failure must abort and roll back the whole initializer data transaction. Development setup runs the source command before `pnpm dev`; container startup runs the built command against the persistent database volume before starting the service.
- Do not add audio, user, evaluation, or parallel session/transcript tables speculatively. Extend the existing conversation tables only after defining ownership, retention, deletion, recovery, and authorization for the new behavior.
- Database files and WAL/SHM sidecars are runtime data and must remain uncommitted. Production must mount a persistent directory rather than store the file only in the container image layer.

## Engineering conventions

- Keep external resources out of the critical browser path; the demo should work without third-party fonts or CDNs.
- Keep `removeNodeProtocol: false` and `node:sqlite` externalization in the tsup build; the production server and initializer require the built-in `node:sqlite` specifier to remain intact.
- Validate all browser JSON messages at the Node boundary.
- Keep binary audio frames bounded and apply WebSocket backpressure limits.
- Put model-specific translation in `src/server/realtime`.
- Prefer small replaceable classes for browser audio, realtime transport, gesture control, and data access instead of embedding them in React components or route handlers.
- Add or update tests for protocol changes, audio conversion, gesture state transitions, migrations, catalog initialization, preset option/legacy-value behavior, catalog validation/CRUD, prompt compilation, selection compatibility, and upstream event ordering.
- Update the relevant document whenever changing a contract. Documentation that describes the old behavior is a defect.

## Git safety

- Do not run Git write operations unless the user explicitly requests them.
- This includes add, commit, push, merge, rebase, reset, checkout/restore that writes to the worktree, and branch or tag creation/deletion.
- Read-only Git commands such as status, diff, log, and show are allowed when useful.

## Scope discipline

The project requirements are in the external case-study document referenced by the user. Build iteratively: preserve the working voice path, durable text-history recovery, and editable catalog first, then add authentication/authorization, evaluation persistence, feedback evaluation, observability, and deployment support in separate milestones.
