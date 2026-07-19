# UI interactions

## Purpose and ownership

The current UI has four responsive surfaces—learner launch, admin catalog, active voice chat, and ended-session feedback—plus shared conversation-history navigation around the learner surfaces. Mobile and desktop use one React application and one semantic component tree. A fixed global utility bar owns a semantic home button containing the product icon/title/subtitle on the left, language and theme controls on every route, and a textual admin entry on every non-admin route; the brand button has pointer, hover, and visible keyboard-focus states and routes through the normal SPA transition coordinator. The admin entry and language toggle use the same standard outlined Ant Design button treatment and responsive sizing. Individual screens must not duplicate these controls.

The surfaces have distinct SPA routes: `/` for the launcher, `/admin` for the management console, `/chat/:conversationId` for an active chat, and `/feedback/:conversationId` for an ended session. Refreshing a chat route shows a restoring state, reloads the persisted immutable snapshots and transcript, and reconnects that conversation. Refreshing a feedback route reloads the durable report and transcript without opening realtime voice. Unsupported paths are replaced with `/`. Browser back/forward navigation never bypasses the existing pending-input and assistant-settlement barriers.

Primary files:

| File | Responsibility |
| --- | --- |
| `src/client/App.tsx` | App mode, catalog selection, active-session snapshot, theme, conversation data, audio/realtime orchestration |
| `src/client/i18n/` | Locale initialization, translation selection, Ant Design locale, document language, and persistence |
| `src/client/learner/LearnerLaunchPanel.tsx` | Searchable scenario/persona selection, compatibility, difficulty, summaries, and start action |
| `src/client/admin/AdminConsole.tsx` | Searchable persona/scenario management tabs and CRUD entry points |
| `src/client/admin/PersonaEditorDrawer.tsx` | Database-backed persona choices, legacy-value preservation, validation, and Instructions preview |
| `src/client/admin/ScenarioEditorDrawer.tsx` | Scenario/compatibility/scoring form, validation, and Instructions preview |
| `src/client/catalog/use-role-play-catalog.ts` | Catalog loading, mutations, errors, and immediate post-mutation refresh |
| `src/client/conversations/` | History/feedback REST clients, shared desktop rail/mobile Drawer list, and feedback page |
| `src/client/styles.css` | Responsive shell, chat bubbles, theme variables, safe-area handling, reduced motion |
| `src/client/components/ConversationMessage.tsx` | User/assistant message presentation and metadata |
| `src/client/components/VoiceWaveform.tsx` | Recording timer, level-reactive bars, cancellation instruction |
| `src/client/voice/press-to-talk-controller.ts` | Framework-independent asynchronous gesture lifecycle |
| `src/client/voice/use-press-to-talk.ts` | Pointer/keyboard bindings and abnormal-cancellation hooks |

Standard controls should use Ant Design when a suitable component exists. The custom chat bubbles and waveform remain project components because Ant Design has no equivalent product-level primitive.

## Screens and responsive layout

### Conversation history navigation

The learner launcher, active chat, and feedback page sit inside `.learner-workspace`. At 1200 px and above, a 288 px left rail is always visible and independently scrolls its conversation list. Below 1200 px, that rail is hidden and the same `ConversationHistoryNavigation` content opens in an Ant Design `Drawer` from the history button in the learner/chat/feedback header. The Drawer supplies focus trapping, Escape handling, overlay behavior, and focus restoration; do not fork a second mobile list implementation.

The list is ordered by latest persisted activity and shows snapshotted persona, scenario, difficulty, last-message preview, localized activity time, and ended/feedback-ready state. The displayed conversation uses `aria-current="page"`. **New role-play** returns to the launcher and leaves history intact. Selecting an active item loads the durable detail, renders all finalized messages, opens a new Qwen connection, and enables input only after recent text context has been acknowledged upstream. Selecting an ended item opens its feedback page and cannot continue it. Either action first force-cancels an active push-to-talk gesture/input. It then settles the current assistant (`response.reconciled` after interruption or response-specific `response.persisted` after natural drain), waits for any already-submitted user transcript to reach persisted `transcript.user.done`, and checks once more for an assistant created during that wait. Only then may it close the old runtime, so uncertain user audio is never committed into the wrong session and audible assistant text is not silently lost during navigation. A settlement timeout or connection failure cancels the navigation and shows an error instead of pretending persistence succeeded.

### Ended-session feedback

The end confirmation explicitly states that the session becomes non-continuable and feedback generation follows. After settlement and a successful end request, the SPA navigates to `/feedback/:conversationId`. Pending/processing feedback shows a lightweight skeleton and polls every two seconds. Failure uses a localized stage-specific title, corrective guidance, bounded server detail, and an Ant Design retry action. It distinguishes missing/empty conversation evidence, data loading, missing configuration, model timeout/network/HTTP/API-envelope errors, invalid generated core, and database persistence. A report with no finalized learner speech is the only non-retryable generation failure; missing model configuration instructs the operator to configure and restart before retrying.

Completed feedback displays the server-calculated score, overall assessment, metadata (scenario, persona, duration, learner turns), strengths, improvement areas, criterion scores/weights, actionable coaching tips, and any validated clickable highlighted moments returned by the model. Scoring-criterion API items preserve `name` and `nameZhCn`; their visible label switches immediately with the global UI locale instead of being frozen to the English database column. The generated rationale remains authored in the report's stored generation locale. Moment cards align to the start of their CSS Grid row and retain their own content height; a short strength card must not stretch its background to match an adjacent long improvement card. Clicking a moment smoothly centers its source message in the readable transcript and briefly pulses a theme-safe outline/glow fitted to the actual conversation bubble—not the full transcript row—before clearing it. Repeated clicks restart the pulse by alternating equivalent animation names, while `prefers-reduced-motion` replaces the animation with a short static highlight. Highlights are supplementary: their requested and accepted count is capped by distinct learner turns, malformed/duplicate/invalid-reference items are discarded independently, and the section is omitted when none survive; the main review remains usable. The transcript is independently scrollable, copyable, and uses the existing download API for text, audio, or both; audio choices remain disabled when any finalized message lacks audio.

The bottom action region offers **Delete this role-play record** and **Try again**. Delete uses Ant Design `Popconfirm`, is available only for ended records, and permanently removes the session plus its owned snapshot, transcript/audio, and feedback before returning to the launcher. Try again creates a separate conversation ID using the reviewed record's source persona ID, source scenario ID, and difficulty, but resolves those IDs against the current catalog and uses the current UI locale; it never reopens the ended session or copies its transcript. If either catalog entity was deleted or the pair is no longer compatible, creation fails visibly and the review remains open. On narrow screens both actions become full-width, with the primary retry action first. The feedback page uses the global utility bar and responsive history navigation. Its page header has no duplicate **New role-play** action; that action remains in history navigation.

History contains finalized transcript text only. A current user/assistant draft never appears in the navigation preview. Switching UI language localizes navigation chrome, date formatting, and difficulty labels, but never translates stored transcript or snapshotted authored text.

### Learner launch

The default surface contains a compact-history entry below the desktop breakpoint, startup/catalog errors, three launch choices, configuration summaries, the final Instructions preview, and one primary start action. Product identity, language, theme, and admin access live in the global utility bar. The launch introduction has no decorative eyebrow label:

1. a searchable scenario selector;
2. a searchable persona selector containing only the selected scenario's compatible personas;
3. an Ant Design solid button-style Radio group for easy/medium/hard.

Changing the scenario keeps the selected persona only when it remains compatible; otherwise the first compatible persona is selected. The learner-facing cards prioritize decision and preparation context rather than implementation/configuration details: scenario description, goals, skill focus, and success criteria; plus persona occupation/demographics, background, personality, communication style, motivations, and likely concerns. Qwen voice, scenario tone/pace/interjection settings, and internal persona behavior notes remain available to administrators and still affect compiled Instructions, but are intentionally omitted from these launch summaries. Below both cards, the browser uses the shared deterministic `compileRolePlayInstructions` function to show the exact localized persona + scenario + difficulty text expected at session creation. The preview includes copy support and `{actual}/12000`; an over-limit count and its preceding Ant Design error use error styling.

Difficulty appears immediately after the two selectors. The summary cards, final Instructions/error preview, and primary start action follow in that order. The start action is disabled until catalog loading has finished, `/api/health` reports configured Qwen credentials, a valid compatible scenario/persona pair exists, and the compiled Instructions fit the shared 12,000-character limit. On start, Node independently reloads authoritative catalog data, recompiles and validates the prompt, then snapshots the persona, scenario, and difficulty; later catalog changes cannot rename or reconfigure that active session.

`body` deliberately does not scroll because active voice chat owns its internal regions. The shared `.application-root` is therefore the viewport-height (`100dvh`) scrolling owner for learner/admin pages. Keep both its explicit height and `overflow: auto`; using only `min-height` lets long launch content grow below a non-scrolling body and makes the start action unreachable.

### Admin console

The admin console contains responsive persona and scenario tabs. The Back to practice control is immediately left of the upper-left title. The global utility bar keeps language/theme actions visible and hides only its admin entry while already on `/admin`. Each tab has search, count, responsive cards, create/edit drawers, deletion confirmation, and global/form error feedback.

Persona editing covers name, gender, age, occupation, background, personality traits, communication style, behavior notes, motivations, concerns, and Qwen voice. Occupation, communication style, traits, motivations, and concerns come from `catalog.personaPresets`; voice labels come from `catalog.qwenVoices` and retain the official Qwen ID in the visible option. Name, gender, age, and occupation share one responsive grid: four columns on wide drawers, two at tablet width, and one per row on narrow screens. There is no identity field.

New roles cannot invent arbitrary values in preset-backed persona fields. If required occupation, personality-trait, or communication-style options are absent, the drawer disables save and directs the operator to run the initializer. Existing values absent from the current preset list remain visible and savable.

Scenario editing covers name/description, learner goals, suggested skill focus, success criteria, weights, and optional tone style/speaking pace/interjection tendency. Selecting success criteria regenerates fixed, read-only scoring item names and evenly distributed integer weights totaling 100. Users can change only percentages. Persona compatibility is a separate card action, not part of scenario creation/editing.

Each drawer compiles only its own deterministic Instructions section and never asks for a counterpart. These editor previews intentionally omit a character counter because only a complete launch combination has a meaningful final length. Persona, scenario, and launcher previews all use the same always-expanded Ant Design Card treatment; their copy action appears immediately after **Model Instructions preview / 模型 Instructions 预览** in the card title instead of at the end of the prompt. Switching interface language recompiles both the localized catalog values and every template label/rule. The server combines persona, scenario, difficulty, and the submitted interface locale only when creating the conversation. A successful mutation reloads the authoritative catalog.

A persona referenced by one or more scenarios cannot be deleted. The admin disables its delete action and names the scenarios that must be edited; the server independently enforces the same conflict. Deleting a scenario deletes only its compatibility links. See `docs/CATALOG_AND_PROMPTS.md` for field and API constraints.

### Active session

Inside the learner workspace, the active session uses a four-row CSS grid:

1. Header — selected persona occupation, realtime state, playback controls, conversation download, end-session confirmation, and responsive history entry. Management, language, and theme controls belong to the fixed global utility bar.
2. Goals — the immutable scenario snapshot's localized goals, using the same green Ant Design tag treatment as the learner launcher's **Goals / 本次目标** summary. This row wraps at narrow widths and never reads current mutable catalog data.
3. Conversation — the only vertically scrolling region.
4. Voice composer — the hold-to-talk control, its hint, and the recording overlay anchor.

There is one JSX structure at every width. Current responsive rules are:

- Above 767 px: centered shell, at most 1000 px wide and 940 px high, with outer margin, border, radius, and shadow.
- At 1200 px and above: the persistent history rail consumes 288 px; the chat remains centered in the remaining workspace.
- Below 1200 px: the history rail becomes a Drawer and a history button appears in the header.
- At 767 px and below: shell fills the viewport using `100dvh`, without desktop border, radius, margin, or shadow.
- At 390 px and below: persona title/occupation and header actions tighten further.
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

Persistence follows audible conversation truth: the final user transcript is durable before it becomes a completed UI turn; a normal assistant turn is durable only after generation and browser playback both complete; an interrupted assistant turn stores only the reconciled retained prefix. Reloading or selecting history reconstructs `turns` from those records. Older messages remain visible in the UI even when only the most recent bounded window is restored into Qwen context.

After each complete AI response is received, Node asynchronously evaluates the scenario's snapshotted success criteria without waiting for playback. No UI is shown unless every criterion has direct transcript evidence and passes the server's conservative confidence threshold. A positive result opens an Ant Design confirmation with **End and review** and **Keep practicing**; continuing dismisses the suggestion for the current runtime, while ending uses the normal settlement and feedback flow. Evaluator failures are intentionally silent and never interrupt voice practice.

The active-session header uses an Ant Design dropdown for three download choices: audio (`.mp3`), transcript (`.txt`), or both (`.zip`). The entire download control is disabled while the conversation has no finalized messages and becomes available after the first persisted turn. Its Tooltip remains available in the disabled state through a neutral inline event anchor and explains that there are no completed messages yet. The MP3 is one mono timeline in chronological message order, with a short silence between speakers; it is not a collection of turn fragments. Each turn is speech-aware loudness-normalized with bounded gain and peak protection so microphone and model speech have comparable perceived volume without aggressively amplifying silence. Text remains available for all non-empty conversations. Audio and combined download are disabled unless every finalized message owns persisted audio, which means pre-audio-feature history and any oversized uncaptured turn remain text-only; the disabled menu label reports how many messages lack audio. A download never includes current streaming drafts. Interrupted assistant text is the repaired conservative prefix and its audio is cut to `safePlayedMs`; generated-but-unheard suffixes are excluded from both artifacts.

## Session states

The header maps application session states to user-visible status:

| State | English / Chinese header label | Meaning |
| --- | --- | --- |
| `connecting` | `Connecting` / `连接中` | Browser/Node/Qwen session is being established |
| `ready` | `Ready to talk` / `可以说话` | Ready for the next hold gesture |
| `listening` | `Listening` / `正在聆听` | Microphone capture is active |
| `processing` | `Thinking` / `思考中` | Input is committed or interruption repair is pending |
| `speaking` | `<persona> is speaking` / `<角色> 正在说话` | Assistant audio is actively playing |
| `ended` | `Ended` / `已结束` | Realtime session is closed |

The small equalizer beside the selected persona is shown only in `speaking`. It is decorative and hidden from assistive technology.

## Error presentation and runtime recovery

Error placement follows the conversation lifecycle. If a visible conversation
has never reached `session.ready`, its error is an initialization failure: the
partial runtime is discarded, the learner remains or returns to the launcher,
and the launch error is shown there. Once that conversation has been established
at least once, even a replacement transport's pre-ready error must not replace
the chat surface. Recoverable turn errors such as a too-short recording use a
top Ant Design message, disappear after five seconds, and leave the socket
active.

A non-recoverable runtime error, including an empty/failed finalized user
transcription, uses the same five-second message but cannot safely reuse the old
Qwen context.
The app keeps the current transcript and conversation ID visible, disables input
while reconnecting, reloads finalized text from SQLite, and opens a fresh Qwen
connection. The failed draft turn is intentionally absent because it was never
authoritative. If this replacement connection cannot initialize, the chat still
stays visible and the hold-to-talk control becomes **Retry voice connection**.
The normal confirmed end-session control remains in the header. Only a first
connection that never became ready falls back to the launcher. Recovery is
guarded by both the runtime epoch and component lifetime, so a stale load cannot
open a socket after navigation or unmount.

## Hold-to-talk contract

The primary control is a hold gesture, not a click/toggle recorder. It supports mouse, touch, pen, Space, and Enter.

### Labels and visual precedence

| Condition | English / Chinese button label | Visual behavior |
| --- | --- | --- |
| Idle, AI not speaking | `Hold to talk` / `按住说话` | Primary green button |
| AI audio playing | `Hold to interrupt and talk` / `按住打断并说话` | Attention color; remains enabled |
| Hold/start/recording active | `Release to send` / `松开发送` | Pressed state and waveform overlay |
| Pointer is at least 72 px above its origin | `Release to cancel` / `松开取消` | Danger button and cancellation waveform state |
| Capture is finishing | Existing label with loading state | Input disabled until finish completes |

Cancellation has the highest label priority, then an active gesture, then AI-speaking barge-in, then idle.

### Pointer lifecycle

1. Primary-button pointer down prevents the default click behavior, stores the origin Y coordinate, captures the pointer, and begins asynchronous input startup.
2. Pointer move compares the current Y position with the origin. Moving upward by at least 72 px enters cancellation state; moving back below the threshold returns to send state.
3. Pointer up releases exactly once. Normal state submits. Cancellation state
   removes the visible draft immediately, clears the upstream buffer, and keeps
   input disabled until the realtime clear acknowledgement arrives.
4. `pointercancel` and unexpected lost pointer capture force cancellation.

`touch-action: none`, disabled text selection, and suppressed context menu prevent the browser's normal long-press gestures from competing with recording.

### Keyboard lifecycle

Space or Enter keydown begins a hold, ignoring auto-repeat while already active. The matching keyup releases and submits. This is deliberate hold/release parity, not a press-to-toggle shortcut.

### Asynchronous and abnormal cases

Microphone permission/device startup can outlive a very quick hold. `PressToTalkController` retains whether the press was released and whether it was marked for cancellation. Once startup resolves, it immediately performs the retained outcome instead of losing the release or leaving capture running.

Window blur, document hidden, input becoming disabled, component unmount, and explicit session end force cancellation. Uncertain audio must never be committed. These paths should continue to converge on the same controller rather than adding ad hoc `input.commit` calls in JSX.

### Barge-in while the selected persona speaks

Holding **Hold to interrupt and talk** / **按住打断并说话** performs this order:

1. snapshot conservatively rendered audio duration;
2. clear scheduled local audio immediately;
3. send `playback.interrupted` for the active response;
4. send `input.start`;
5. start microphone capture.

The user can record while Node repairs Qwen's conversation item. Node blocks only the next response creation until repair is acknowledged. See `docs/REALTIME_PROTOCOL.md` for wire ordering and `docs/ARCHITECTURE.md` for the best-effort prefix estimator.

Scenario `voiceBehavior.interruptFrequency` is not this mechanism. It influences whether the role is patient or uses brief interjections/challenges inside its own model turns for that scenario. Manual push-to-talk means the model cannot detect and interrupt the learner mid-recording; only the learner can barge in on model playback.

## Waveform feedback

`VoiceWaveform` is visible for the complete active gesture, including asynchronous startup. It contains:

- nine decorative vertical bars;
- elapsed recording time, updated by the parent every 100 ms;
- localized `Release to send` / `松开发送` or `Release to cancel` / `松开取消` status text.

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

## Language contract

The interface supports English (`en`) and Simplified Chinese (`zh`) from one React component tree. English is the first-run default. Initialization reads `role-player:locale` from `localStorage`; an absent, unsupported, or inaccessible value safely falls back to English. The upper-right language control is present on learner, admin, and active-session headers.

Changing language updates the shared i18n context, Ant Design's locale object, `document.documentElement.lang`, and the saved preference. It must not reset catalog selection, close a drawer, reconnect Qwen, dispose audio, or clear an active transcript. User-facing strings include visible copy as well as validation messages, errors, placeholders, tooltips, empty states, and accessible names.

Every localized catalog field is stored as an independent pair: unsuffixed English (`name`, `value`) and Simplified Chinese with `ZhCn` (`nameZhCn`, `valueZhCn`). Fallback remains presentation-only; saving unchanged fallback text must not copy it into the empty language. Starter translations and preset business content come from JSON through explicit SQLite initialization; no translation service is called.

## Playback and session controls

The header playback popover uses Ant Design controls for:

- mute/unmute;
- volume from 0 to 100 percent;
- stopping the current AI response.

Stopping AI uses the same interruption/reconciliation path as barge-in but does not start a user recording. Ending the session has a confirmation step; confirmation cancels any active gesture/input, waits for a submitted user transcript, reconciles and persists an assistant response that is still audible (or waits for its response-specific normal-playback persistence acknowledgement), closes browser and Qwen connections through the client/server lifecycle, disposes audio, refreshes the persisted history list, and returns to the learner launcher with the catalog selection available for another session. The bounded settlement wait exists only to avoid holding a broken connection forever; timeout/failure leaves the current session in place when possible and reports the problem rather than silently discarding pending history.

Push-to-talk is temporarily disabled while the preceding committed user turn is
waiting for its finalized transcript to be saved. Abnormal cancellation and
session transitions wait for the entire gesture lifecycle, including a
microphone start that is still pending or a submit/cancel handler that is
already finishing. Async continuations from a superseded runtime may clean up
only their captured audio/realtime objects and must not mutate the next session.

## Manual UI verification

After `pnpm check`, exercise the following in a real browser when changing this subsystem:

For layout-only work, `?preview=session` and `?preview=recording` provide development-only static fixtures that reuse the production component tree without requesting microphone access or connecting to Qwen. They are ignored by production builds and do not replace real gesture/audio verification.

1. Inspect approximately 360 px, 767 px, 768 px, 1199 px, 1200 px, and a wide desktop; confirm no horizontal overflow and the rail/Drawer switch occurs once.
2. Confirm the latest message and waveform do not hide behind the composer or mobile safe area.
3. Switch theme and language on learner, admin, drawer, and active-session screens; reload after each language choice to confirm persistence, and confirm the current session remains connected.
4. Hold and release normally with pointer input; verify one submitted turn.
5. Hold, move upward beyond 72 px, and release; verify the draft disappears
   immediately, the captured turn is not sent or restored by a late transcript,
   and a new hold works after clearing finishes.
6. Release quickly during microphone startup; verify the UI returns to idle after the deterministic outcome.
7. Repeat with Space or Enter.
8. While the selected persona is playing audio, hold the barge-in control and confirm playback stops immediately before recording begins.
9. Scroll more than 120 px above the bottom during streaming; confirm new deltas do not steal the reader's scroll position.
10. Search/select scenarios and verify the persona options contain only compatible personas; switch easy/medium/hard and confirm the selected state/summary remains usable at every target width.
11. In the admin console, create/edit both entity types, inspect standalone prompt previews, confirm criteria generate `33/33/34` for three rows, edit weights, and manage compatibility from its separate action.
12. Verify persona and scenario preset categories are loaded from `GET /api/catalog`, ordered, localized, and searchable; confirm preset-backed multi-select limits and the disabled-save warning when required persona categories are empty.
13. Create `张三` in Chinese and confirm the English UI falls back to it; save an unrelated English edit and confirm `name` remains empty; then set English `name` to `Zhang San` and confirm Chinese `nameZhCn` still displays `张三`.
14. Edit a persona containing values absent from `personaPresets`; confirm each is shown as an existing option and can be retained without creating a new preset.
14. Attempt to delete a referenced persona and verify the conflict is shown without removing it; unlink it, retry, and verify deletion succeeds.
15. Finish at least two conversations, confirm newest activity sorts first, resume each from the rail/Drawer, and verify its full transcript and snapshotted persona/scenario/difficulty return before another voice turn.
16. Edit a catalog persona after creating a conversation, then resume the old conversation and confirm it still uses the old snapshot.
17. Check history-item/current-page semantics, Drawer Escape/focus behavior, focus names, status text, reduced motion, mute, volume, stop, and end-session confirmation.
18. Release immediately after pressing or submit silence; confirm the active chat remains visible, an Ant Design error message appears at the top and disappears after five seconds, and input becomes available again—directly for a recoverable short-input error or after the same-conversation rebuild for failed transcription.
19. Force a pre-`session.ready` configuration failure and confirm the partial chat never opens: the app returns to the launcher and shows the startup error there.
20. After a session has become ready, force both its runtime connection and the automatic replacement connection to fail; confirm the chat remains visible, the top error message disappears after five seconds, and the composer becomes **Retry voice connection** and can restore the same conversation. Confirm the header's end-session action still requires confirmation.
21. Complete at least two spoken turns and download audio, text, and both. Confirm the MP3 is a single alternating-speaker timeline, the ZIP contains one MP3 and one TXT, and a text-only historical conversation disables audio choices. Interrupt an assistant mid-sentence and confirm neither export contains its unheard text or audio suffix.
22. End a conversation, open its feedback route, and choose **Try again**. Confirm the app creates a different conversation ID with the same scenario, persona, and difficulty, opens its chat route, and does not copy the old transcript.
23. End another conversation while feedback is still generating, delete it through the bottom confirmation, and confirm its history item, direct feedback route, transcript/audio, and eventual feedback result are all gone. Confirm active conversations cannot be deleted through the API.
24. Click multiple highlighted moments, including the same moment twice, and confirm each target transcript row scrolls to the center, pulses visibly in both themes, and clears after about two seconds. With reduced motion enabled, confirm the target uses a temporary static highlight instead.
