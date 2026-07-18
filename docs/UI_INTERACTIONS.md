# UI interactions

## Purpose and ownership

The current UI has three responsive surfaces—learner launch, admin catalog, and active voice chat—shared by mobile and desktop. It is intentionally one React application, not separate pages or duplicated mobile/desktop implementations that can drift apart.

Primary files:

| File | Responsibility |
| --- | --- |
| `src/client/App.tsx` | App mode, catalog selection, active-session snapshot, theme, conversation data, audio/realtime orchestration |
| `src/client/learner/LearnerLaunchPanel.tsx` | Searchable scenario/persona selection, compatibility, difficulty, summaries, and start action |
| `src/client/admin/AdminConsole.tsx` | Searchable persona/scenario management tabs and CRUD entry points |
| `src/client/admin/PersonaEditorDrawer.tsx` | Database-backed persona choices, legacy-value preservation, validation, and Instructions preview |
| `src/client/admin/ScenarioEditorDrawer.tsx` | Scenario/compatibility/scoring form, validation, and Instructions preview |
| `src/client/catalog/use-role-play-catalog.ts` | Catalog loading, mutations, errors, and immediate post-mutation refresh |
| `src/client/styles.css` | Responsive shell, chat bubbles, theme variables, safe-area handling, reduced motion |
| `src/client/components/ConversationMessage.tsx` | User/assistant message presentation and metadata |
| `src/client/components/VoiceWaveform.tsx` | Recording timer, level-reactive bars, cancellation instruction |
| `src/client/voice/press-to-talk-controller.ts` | Framework-independent asynchronous gesture lifecycle |
| `src/client/voice/use-press-to-talk.ts` | Pointer/keyboard bindings and abnormal-cancellation hooks |

Standard controls should use Ant Design when a suitable component exists. The custom chat bubbles and waveform remain project components because Ant Design has no equivalent product-level primitive.

## Screens and responsive layout

### Learner launch

The default surface contains the brand header, upper-right theme toggle and admin entry, startup/catalog errors, three launch choices, configuration summaries, and one primary start action:

1. a searchable scenario selector;
2. a searchable persona selector containing only the selected scenario's compatible personas;
3. an easy/medium/hard segmented difficulty selector.

Changing the scenario keeps the currently selected persona only when it remains compatible; otherwise the first compatible persona is selected. The screen summarizes scenario description, goals, suggested skill focus, tone, pace, and interjection behavior, plus persona identity/demographics, traits, communication style, behavior notes, and Qwen voice.

Difficulty and the primary start action appear immediately after the two selectors, before the longer scenario/persona summaries, so the entry point remains discoverable without reading every detail first. The start action is disabled until catalog loading has finished, `/api/health` reports configured Qwen credentials, and a valid compatible scenario/persona pair exists. On start, the app snapshots the persona, scenario, and difficulty; later catalog changes cannot rename or reconfigure that active session.

`body` deliberately does not scroll because active voice chat owns its internal regions. The shared `.application-root` is therefore the viewport-height (`100dvh`) scrolling owner for learner/admin pages. Keep both its explicit height and `overflow: auto`; using only `min-height` lets long launch content grow below a non-scrolling body and makes the start action unreachable.

### Admin console

The admin console contains responsive persona and scenario tabs. Each tab has search, count, paginated responsive cards, create/edit drawers, deletion confirmation, and global/form error feedback.

Persona editing covers name, gender, age, occupation, identity, background, personality traits, communication style, behavior notes, motivations, concerns, and Qwen voice. Identity, occupation, communication style, traits, motivations, and concerns are populated from `catalog.personaPresets`, filtered by category, and ordered by preset position. Occupation, identity, and communication style are searchable single selects; occupation can be cleared. Traits, motivations, and concerns are searchable multiple selects limited to 12/10/10 items. Name, age, background, and behavior notes remain free-form, while gender and voice retain their fixed selectors.

New roles cannot invent arbitrary values in preset-backed fields. If required identity, personality-trait, or communication-style options are absent, the drawer shows a warning, disables save, and directs the operator to run the deployment initializer. Editing remains lossless: persona text absent from the current preset list is appended as an `existing value` option, so historical/custom values remain visible and can be retained even after reference choices change. Saving copies option text into the persona; later preset edits never rewrite existing roles.

Scenario editing covers name/description, learner goals, suggested skill focus, hidden success criteria, optional weighted scoring criteria, compatible personas, the turn-bound interjection/challenge tendency stored as `interruptFrequency`, speaking pace, and tone style.

Both drawers compile an Instructions preview from current form values with a selected compatible counterpart. The preview is deterministic and copyable; it does not call another model. It shows the 12,000-character budget and warns when any difficulty for the previewed pair exceeds it. Save validation checks every affected compatible pair. A successful create, update, or delete applies the returned result locally and then reloads the full catalog, so the learner surface reflects the saved result immediately without a rebuild or restart.

A persona referenced by one or more scenarios cannot be deleted. The admin disables its delete action and names the scenarios that must be edited; the server independently enforces the same conflict. Deleting a scenario deletes only its compatibility links. See `docs/CATALOG_AND_PROMPTS.md` for field and API constraints.

### Active session

The active session uses a three-row CSS grid:

1. Header — selected persona identity, realtime state, playback controls, end-session confirmation, and theme toggle.
2. Conversation — the only vertically scrolling region.
3. Voice composer — the hold-to-talk control, its hint, and the recording overlay anchor.

There is one JSX structure at every width. Current responsive rules are:

- Above 767 px: centered shell, at most 1000 px wide and 940 px high, with outer margin, border, radius, and shadow.
- At 767 px and below: shell fills the viewport using `100dvh`, without desktop border, radius, margin, or shadow.
- At 390 px and below: identity and header actions tighten further.
- The root has a 320 px minimum width.
- Mobile header and composer include `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.

Do not detect a phone in JavaScript to choose a separate component. Add CSS breakpoints only when the same semantic UI needs a different spatial treatment.

## Conversation behavior

Messages are chronological and rendered in this order:

1. completed conversation turns;
2. the current live user transcript, if present;
3. the current live assistant transcript/typing state, if present;
4. a scroll anchor.

The list uses bottom alignment when its content is shorter than the viewport, so the newest content remains adjacent to the composer. User messages align right; selected-persona messages align left. Completed messages include speaker and timestamp. Draft messages identify transcription/generation, and reconciled interrupted messages can carry the `已打断` tag.

Auto-follow is conditional. When new transcript text or state arrives, the UI scrolls to the end only if the reader was within 120 px of the bottom. If the reader scrolls farther up, incoming deltas must not repeatedly pull the viewport away from the older message being read.

The conversation container uses `role="log"`, `aria-live="polite"`, and an accessible label. Avoid introducing rapidly changing assertive announcements for streaming deltas.

## Session states

The header maps application session states to user-visible status:

| State | Header label | Meaning |
| --- | --- | --- |
| `connecting` | `连接中` | Browser/Node/Qwen session is being established |
| `ready` | `可以说话` | Ready for the next hold gesture |
| `listening` | `正在聆听` | Microphone capture is active |
| `processing` | `思考中` | Input is committed or interruption repair is pending |
| `speaking` | `<persona name> 正在说话` | Assistant audio is actively playing |
| `ended` | `已结束` | Realtime session is closed |

The small equalizer beside the selected persona is shown only in `speaking`. It is decorative and hidden from assistive technology.

## Hold-to-talk contract

The primary control is a hold gesture, not a click/toggle recorder. It supports mouse, touch, pen, Space, and Enter.

### Labels and visual precedence

| Condition | Button label | Visual behavior |
| --- | --- | --- |
| Idle, AI not speaking | `按住说话` | Primary green button |
| AI audio playing | `按住打断并说话` | Attention color; remains enabled |
| Hold/start/recording active | `松开发送` | Pressed state and waveform overlay |
| Pointer is at least 72 px above its origin | `松开取消` | Danger button and cancellation waveform state |
| Capture is finishing | Existing label with loading state | Input disabled until finish completes |

Cancellation has the highest label priority, then an active gesture, then AI-speaking barge-in, then idle.

### Pointer lifecycle

1. Primary-button pointer down prevents the default click behavior, stores the origin Y coordinate, captures the pointer, and begins asynchronous input startup.
2. Pointer move compares the current Y position with the origin. Moving upward by at least 72 px enters cancellation state; moving back below the threshold returns to send state.
3. Pointer up releases exactly once. Normal state submits; cancellation state clears.
4. `pointercancel` and unexpected lost pointer capture force cancellation.

`touch-action: none`, disabled text selection, and suppressed context menu prevent the browser's normal long-press gestures from competing with recording.

### Keyboard lifecycle

Space or Enter keydown begins a hold, ignoring auto-repeat while already active. The matching keyup releases and submits. This is deliberate hold/release parity, not a press-to-toggle shortcut.

### Asynchronous and abnormal cases

Microphone permission/device startup can outlive a very quick hold. `PressToTalkController` retains whether the press was released and whether it was marked for cancellation. Once startup resolves, it immediately performs the retained outcome instead of losing the release or leaving capture running.

Window blur, document hidden, input becoming disabled, component unmount, and explicit session end force cancellation. Uncertain audio must never be committed. These paths should continue to converge on the same controller rather than adding ad hoc `input.commit` calls in JSX.

### Barge-in while the selected persona speaks

Holding **按住打断并说话** performs this order:

1. snapshot conservatively rendered audio duration;
2. clear scheduled local audio immediately;
3. send `playback.interrupted` for the active response;
4. send `input.start`;
5. start microphone capture.

The user can record while Node repairs Qwen's conversation item. Node blocks only the next response creation until repair is acknowledged. See `docs/REALTIME_PROTOCOL.md` for wire ordering and `docs/ARCHITECTURE.md` for the best-effort prefix estimator.

Scenario `interruptFrequency` is not this mechanism. It influences whether the role is patient or uses brief interjections/challenges inside its own model turns. Manual push-to-talk means the model cannot detect and interrupt the learner mid-recording; only the learner can barge in on model playback.

## Waveform feedback

`VoiceWaveform` is visible for the complete active gesture, including asynchronous startup. It contains:

- nine decorative vertical bars;
- elapsed recording time, updated by the parent every 100 ms;
- `松开发送` or `松开取消` status text.

The audio engine reports normalized microphone RMS. The component clamps it to 0–1 and applies a square-root curve before scaling the bars, which makes quiet speech visible without letting loud input escape the component bounds. It is feedback only; it does not transform the audio sent to Qwen.

While the overlay is visible, a spacer at the end of the conversation keeps the newest message above it. Do not remove that space or position the waveform over the hold button: the transcript, recording feedback, and release target must all remain readable at narrow widths.

The bars and timer are hidden from screen readers to avoid noisy announcements. The stable instruction uses a polite status region. When reduced motion is requested, project CSS collapses animation and transition durations.

## Theme contract

The two supported modes are `light` and `dark`.

Initialization order:

1. read `role-player:color-mode` from `localStorage` when available;
2. otherwise use `prefers-color-scheme: dark`;
3. otherwise use light mode.

On change, the app updates all three layers:

- Ant Design `defaultAlgorithm` or `darkAlgorithm` in the root `ConfigProvider`;
- `data-theme` and `color-scheme` on the document element;
- the saved localStorage preference when storage is available.

Project CSS variables cover surfaces that are not Ant Design components. Component-local styles, including the waveform, must respect the explicit app theme rather than independently overriding it from OS preference. Changing theme must not refetch/reset catalog choices, reconnect Qwen, dispose the audio engine, reset transcripts, or recreate the session. The learner launcher, admin console, drawers, and active chat must all support both themes.

## Playback and session controls

The header playback popover uses Ant Design controls for:

- mute/unmute;
- volume from 0 to 100 percent;
- stopping the current AI response.

Stopping AI uses the same interruption/reconciliation path as barge-in but does not start a user recording. Ending the session has a confirmation step; confirmation cancels any active gesture/input, closes browser and Qwen connections through the client/server lifecycle, disposes audio, and returns to the learner launcher with the catalog selection available for another session.

## Manual UI verification

After `pnpm check`, exercise the following in a real browser when changing this subsystem:

For layout-only work, `?preview=session` and `?preview=recording` provide development-only static fixtures that reuse the production component tree without requesting microphone access or connecting to Qwen. They are ignored by production builds and do not replace real gesture/audio verification.

1. Inspect approximately 360 px, 767 px, 768 px, and a desktop width; confirm no horizontal overflow.
2. Confirm the latest message and waveform do not hide behind the composer or mobile safe area.
3. Switch theme on learner, admin, drawer, and active-session screens; confirm the current session remains connected.
4. Hold and release normally with pointer input; verify one submitted turn.
5. Hold, move upward beyond 72 px, and release; verify the captured turn is cleared and not sent.
6. Release quickly during microphone startup; verify the UI returns to idle after the deterministic outcome.
7. Repeat with Space or Enter.
8. While the selected persona is playing audio, hold the barge-in control and confirm playback stops immediately before recording begins.
9. Scroll more than 120 px above the bottom during streaming; confirm new deltas do not steal the reader's scroll position.
10. Search/select scenarios and verify the persona options contain only compatible personas; switch easy/medium/hard and confirm the selected state/summary remains usable at every target width.
11. In the admin console, create/edit both entity types, inspect prompt previews, validate scoring totals and required compatibility, and confirm saved changes appear on the learner launcher immediately.
12. Verify all six preset categories are ordered and searchable; confirm preset-backed multi-select limits, clearable occupation, and the disabled-save warning when required preset categories are empty.
13. Edit a persona containing values absent from `personaPresets`; confirm each is shown as an existing option and can be retained without creating a new preset.
14. Attempt to delete a referenced persona and verify the conflict is shown without removing it; unlink it, retry, and verify deletion succeeds.
15. Check focus names, status text, reduced motion, mute, volume, stop, and end-session confirmation.
