# Role-play catalog and Instructions

## Source of truth

The catalog SQLite file is the runtime source of truth for personas, scenarios, presets, and scenario–persona compatibility. Conversation history and immutable launch snapshots live in the separate conversation file. The shared browser/server contract is `src/shared/role-play-catalog.ts`.

All deployment-owned business data is JSON under `src/server/catalog/initial-data/`:

- `persona-occupations.json`
- `persona-personality-traits.json`
- `persona-communication-styles.json`
- `persona-motivations.json`
- `persona-concerns.json`
- `qwen-voices.json`
- `scenario-training-goals.json`
- `scenario-skill-focuses.json`
- `scenario-success-criteria.json`
- `scenario-tone-styles.json`
- `personas.json`
- `scenarios.json`

`catalog-initializer.ts` contains validation and idempotent database writes only. Do not add seed voice names, labels, occupations, personas, scenarios, or criteria to TypeScript, React localization files, or migrations.

## Bilingual fields

English uses the unsuffixed field and Simplified Chinese uses `ZhCn`:

| Resolved persona/API | Resolved scenario/API |
| --- | --- |
| `name` / `nameZhCn` | `name` / `nameZhCn` |
| `occupation` / `occupationZhCn` | `description` / `descriptionZhCn` |
| `background` / `backgroundZhCn` | `goals` / `goalsZhCn` |
| `personalityTraits` / `personalityTraitsZhCn` | `suggestedSkillFocus` / `suggestedSkillFocusZhCn` |
| `communicationStyle` / `communicationStyleZhCn` | `successCriteria` / `successCriteriaZhCn` |
| `behaviorNotes` / `behaviorNotesZhCn` | `toneStyle` / `toneStyleZhCn` |
| | scoring `name` / `nameZhCn` |
| `motivations` / `motivationsZhCn` | |
| `concerns` / `concernsZhCn` | |

Fallback is presentation-only. If a Chinese-created role has `name = ""` and `nameZhCn = "张三"`, the English UI displays `张三`. Saving an unrelated English edit must keep `name` empty. Entering `Zhang San` in the English form changes only `name`; Chinese continues to display `张三`.

SQLite follows the same convention for free text and preset definitions. Preset-backed entity fields do not store localized strings or JSON arrays: they store numeric foreign keys. Multi-select values are ordered child rows, and scenario scoring weight is stored beside the referenced success-criterion ID.

Preset API records follow the same convention: `value` is English and `valueZhCn` is Chinese. The API derives persona categories `occupation`, `personality_trait`, `communication_style`, `motivation`, and `concern` from five dedicated database tables; scenario categories `training_goal`, `skill_focus`, `success_criterion`, and `tone_style` come from four dedicated tables. No current preset table stores a category discriminator or generic value column. Catalog records reference preset rows by ID. The API returns both the IDs and joined bilingual values; immutable conversation snapshots copy the resolved values at launch so later preset edits do not rewrite history.

## Persona and scenario boundaries

Persona owns the reusable character definition: occupation, demographics, background, personality, communication style, motivations, concerns, behavior notes, and Qwen voice. There is no separate identity field.

Qwen voices keep the official provider ID (`longanqian`, etc.) separate from their bilingual display names and structured `female`/`male` capability. `qwen-voices.json` installs those values into `qwen_voices`; `GET /api/catalog` returns them as `qwenVoices`. Persona records and immutable conversation snapshots continue to store the official ID because that exact value is sent to Qwen. UI labels combine ID and localized name, while catalog generation uses the structured gender field to reject an incompatible persona/voice pairing.

Scenario owns training context and optional voice behavior: description, goals, skill focus, success criteria, scoring weights, tone style, speaking pace, and interjection/challenge tendency. Goals, skill focus, success criteria, and scoring weights are optional. Scoring item names are derived from success criteria and cannot be authored separately. When scoring is enabled, whole-number default weights are evenly distributed with rounding units placed at the end, so three items receive `33, 33, 34`; every selected success criterion becomes a scoring row and totals must remain exactly 100. When scoring is disabled, the selected success criteria remain available to Instructions and conservative goal detection, while their database relation weights are `NULL`.

### Editor field requirements

The persona editor requires name, gender, occupation, at least one personality trait, communication style, and voice. Age, background, behavior notes, motivations, and concerns/objections are optional.

The scenario editor requires only a localized name and description. Training goals, focus skills, success criteria, tone style, speaking pace, interjection/challenge tendency, and scoring weights are optional. An explicit scoring switch is disabled until at least one success criterion is selected. Enabling it generates one fixed-name row per selected criterion; every generated weight is required and the total must equal 100. Disabling it clears only the weights, not the selected criteria. Compatibility is managed outside the editor and may be empty.

Ant Design's `requiredMark="optional"` is used consistently: required fields use a native `required` rule, while only truly optional fields receive the optional marker. The shared Zod schemas and SQLite constraints enforce the same contract. Prompt compilation trims all text and list values, and omits the complete label/section whenever an optional value is empty.

### AI-generated editable drafts

The create-persona and create-scenario drawers can request a random draft through `POST /api/catalog/generate/persona` and `POST /api/catalog/generate/scenario`. These endpoints lazily reuse the configured `DASHSCOPE_FEEDBACK_*` OpenAI-compatible `qwen-plus` text model; realtime audio generation is not involved. The request includes every current SQLite preset ID with both localized labels and all Qwen voice IDs with structured gender. An optional `currentDraft` contains only meaningful form values: the initial request uses fields the operator actually touched, while later requests include the generated base and subsequent edits. Blank strings, empty ID lists, null/default-only values, and empty voice-behavior objects are omitted; if nothing remains, the whole `currentDraft` property is absent. Persona generation also sends every persisted bilingual name and background; scenario generation sends every persisted bilingual name and description. The model must treat a non-empty current draft as one additional existing instance, avoid copying or lightly paraphrasing those exclusion texts, produce semantically matching English and Simplified Chinese free text, and never invent an option.

The server treats model output as untrusted. Incoming partial draft schemas deliberately accept empty selections and compact them again before constructing the model prompt; create/update schemas enforce only the fields that are truly required by each editor. Model output validation requires both languages, verifies every referenced ID belongs to its expected category, checks persona gender against voice gender, derives scenario scoring weights locally for generated full drafts, and normalizes case, Unicode form, whitespace, punctuation, and symbols before rejecting duplicate names/backgrounds/descriptions against both SQLite records and a non-empty `currentDraft`. Invalid output is retried up to three times with the concrete duplicate or validation reason. Scenario generation is persona-agnostic and does not let the model choose compatibility. The result is only an editable form draft: generation never writes SQLite. While a request is pending, the drawer cannot be submitted or edited; explicit Cancel remains available, aborts the browser request, and ignores late responses. Saving merges the visible-language edits into the bilingual generated base so the hidden language is preserved.

The original requirement document explicitly asks for “Persona compatibility (which personas are allowed)” per scenario (acceptance criterion 1.4.3). Compatibility is therefore retained as the `scenario_personas` relation, but managed separately from scenario content. Persona/scenario creation and both Instructions previews do not select a counterpart. New scenarios initially allow the personas that exist at creation time; the admin’s Compatibility action can change or clear the relation. A scenario with no compatible persona remains editable but cannot be launched.

## Instructions composition

Prompt generation is deterministic and does not call another model:

- `compilePersonaInstructions(persona, locale)` powers the persona-only editor preview.
- `compileScenarioInstructions(scenario, locale)` powers the scenario-only editor preview.
- `compileRolePlayInstructions({ persona, scenario, difficulty, locale })` combines both sections with difficulty and safety rules.

Every compiler has complete English and Chinese template labels, section headings, difficulty/voice-behavior rules, and hidden safety rules. The current interface locale selects the template as well as the already-localized catalog values. The learner launcher calls the shared compiler to preview the expected final combination and enforce the same length budget before enabling start. It still sends persona/scenario IDs and locale only and never supplies prompt data to the server. `ConversationRepository` reloads the authoritative catalog, resolves preset IDs, independently compiles and validates the final Instructions in that submitted locale, persists them with an immutable bilingual snapshot, then the realtime gateway loads that exact stored value. Persona/scenario editor previews show only their independent sections and intentionally omit character counts. All three previews use a non-collapsible card and place the copy control directly after the title.

Compiled Instructions are limited to 12,000 characters. The repository validates affected compatible combinations across locales/difficulties when saving, and conversation creation performs the final limit check.

## Initializing data

Development/source command:

```bash
pnpm catalog:init
```

Built production command:

```bash
pnpm catalog:init:prod
```

Both commands are transactional and idempotent. Stable JSON keys stored as `seed_key` prevent duplicate starter rows; public IDs remain SQLite-generated integers, and existing administrator-edited records are not overwritten. They require a configured catalog database path but no Qwen API key.

The starter occupation catalog spans hospitality, retail, agriculture, education, healthcare, professional services, engineering, technology, manufacturing, logistics, travel, and creative work. Occupation labels are concise (all current Simplified Chinese labels are eight characters or fewer) and avoid a management-title-heavy catalog. Starter persona backgrounds and scenario descriptions remain detailed operational situations; related traits, motivations, concerns, behavior, gender, and voice are designed as a consistent whole. Because initializer conflicts preserve existing records, JSON improvements appear in a fresh database but do not overwrite an already-installed or administrator-edited row with the same `seed_key`.
