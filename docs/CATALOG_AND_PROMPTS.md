# Role-play catalog and Instructions

## Source of truth

The catalog SQLite file is the runtime source of truth for personas, scenarios, presets, and scenario–persona compatibility. Conversation history and immutable launch snapshots live in the separate conversation file. The shared browser/server contract is `src/shared/role-play-catalog.ts`.

All deployment-owned business data is JSON under `src/server/catalog/initial-data/`:

- `persona-occupations.json`
- `persona-personality-traits.json`
- `persona-communication-styles.json`
- `persona-tone-styles.json`
- `persona-motivations.json`
- `persona-concerns.json`
- `qwen-voices.json`
- `scenario-training-goals.json`
- `scenario-skill-focuses.json`
- `scenario-success-criteria.json`
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
| `toneStyle` / `toneStyleZhCn` | scoring `name` / `nameZhCn` |
| `behaviorNotes` / `behaviorNotesZhCn` | |
| `motivations` / `motivationsZhCn` | |
| `concerns` / `concernsZhCn` | |

Fallback is presentation-only. If a Chinese-created role has `name = ""` and `nameZhCn = "张三"`, the English UI displays `张三`. Saving an unrelated English edit must keep `name` empty. Entering `Zhang San` in the English form changes only `name`; Chinese continues to display `张三`.

SQLite follows the same convention for free text and preset definitions. Preset-backed entity fields do not store localized strings or JSON arrays: they store numeric foreign keys. Multi-select values are ordered child rows, and scenario scoring weight is stored beside the referenced success-criterion ID.

Preset API records follow the same convention: `value` is English and `valueZhCn` is Chinese. The API derives persona categories `occupation`, `personality_trait`, `communication_style`, `tone_style`, `motivation`, and `concern` from six dedicated database tables; the three scenario categories likewise come from three dedicated tables. No current preset table stores a category discriminator or generic value column. Catalog records reference preset rows by ID. The API returns both the IDs and joined bilingual values; immutable conversation snapshots copy the resolved values at launch so later preset edits do not rewrite history.

## Persona and scenario boundaries

Persona owns identity-independent character behavior: occupation, demographics, background, personality, communication style, tone, motivations, concerns, Qwen voice, speaking pace, and interjection/challenge tendency. There is no separate identity field.

Qwen voices keep the official provider ID (`longanqian`, etc.) separate from their bilingual display names. `qwen-voices.json` installs those names into `qwen_voices`; `GET /api/catalog` returns them as `qwenVoices`. Persona records and immutable conversation snapshots continue to store the official ID because that exact value is sent to Qwen. UI labels combine both pieces, for example `longanqian - Natural female voice` or `longanqian - 自然女声`.

Scenario owns training context: description, goals, skill focus, success criteria, and scoring weights. Scoring item names are derived from success criteria and cannot be authored separately. Whole-number default weights are evenly distributed with rounding units placed at the end, so three items receive `33, 33, 34`; totals must remain exactly 100.

### Editor field requirements

The persona editor requires name, gender, occupation, at least one personality trait, communication style, tone style, voice, interjection/challenge tendency, and speaking pace. Gender and the three voice-behavior fields have explicit defaults, but they are still persisted required values. Age, background, behavior notes, motivations, and concerns/objections are optional.

The scenario editor requires every authored content field: name, description, at least one training goal, at least one focus skill, and at least one success criterion. Scoring rows are generated from success criteria; every generated weight is required and the total must equal 100. Compatibility is managed outside the editor and may be empty.

Ant Design's `requiredMark="optional"` is used consistently: required fields use a native `required` rule, while only truly optional fields receive the optional marker. The shared Zod schemas and SQLite constraints enforce the same contract. Prompt compilation trims all text and list values, and omits the complete label/section whenever an optional value is empty.

The original requirement document explicitly asks for “Persona compatibility (which personas are allowed)” per scenario (acceptance criterion 1.4.3). Compatibility is therefore retained as the `scenario_personas` relation, but managed separately from scenario content. Persona/scenario creation and both Instructions previews do not select a counterpart. New scenarios initially allow the personas that exist at creation time; the admin’s Compatibility action can change or clear the relation. A scenario with no compatible persona remains editable but cannot be launched.

## Instructions composition

Prompt generation is deterministic and does not call another model:

- `compilePersonaInstructions(persona)` powers the persona-only editor preview.
- `compileScenarioInstructions(scenario)` powers the scenario-only editor preview.
- `compileRolePlayInstructions({ persona, scenario, difficulty })` combines both sections with difficulty and safety rules.

The final combination happens in `ConversationRepository` on the server when a conversation is created. The browser sends persona/scenario IDs only; it does not compose or supply the final prompt data. The server reloads the catalog, resolves preset IDs, persists the exact compiled Instructions with an immutable bilingual snapshot, then the realtime gateway loads that stored value.

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
