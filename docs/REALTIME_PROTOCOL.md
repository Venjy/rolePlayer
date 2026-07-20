# Realtime protocol

The browser and Node gateway use an application-owned protocol. Qwen's raw protocol remains behind the backend adapter so model upgrades do not force React audio code changes.

## Transport

Endpoint:

```text
GET /ws/realtime
```

- JSON text frames carry control and transcript events.
- Browser → Node binary frames are PCM16 16 kHz mono microphone audio.
- Node → browser binary frames are PCM16 24 kHz mono assistant audio.
- A binary frame has no header in the MVP. Direction determines its meaning.

The MVP permits only one assistant response to own the output-audio stream at a
time. Node sends `response.started` before the first binary frame, and the
browser associates every following Node → browser binary frame with that
`responseId`. WebSocket ordering makes this safe while responses remain serial.
The browser drops binary audio when there is no active response or after that
response has been interrupted. Supporting concurrent responses would require a
response identifier in the binary frame format.

## Persisted conversation-derived session configuration

The catalog and conversation REST APIs are separate from this WebSocket
protocol. Before opening `/ws/realtime`, the learner launcher chooses a
scenario, one of its compatible personas, and easy/medium/hard difficulty, then
creates a persisted conversation snapshot. That snapshot owns the selected
persona/scenario data, locale, difficulty, deterministically compiled
Instructions, and voice for every later resume.

The browser identifies that snapshot with `conversationId`; it never submits
Instructions or a voice over the realtime protocol. Node resolves both values
from SQLite at configuration time. This keeps prompt/voice authority on the
server and ensures later catalog edits cannot silently change an existing
conversation.

`compileRolePlayInstructions` remains a deterministic shared template, not a
call to another language model. It includes the snapshotted persona
occupation/behavior, scenario goals and hidden criteria, difficulty, tone, pace,
and interjection behavior in stable, previewable sections. Conversation creation
rejects compiled Instructions over the shared 12,000-character limit; the
catalog association guards remain defense in depth.

Any error received before `session.ready` rejects startup immediately,
regardless of whether that error could have been recoverable in an already-ready
session. The browser settles that rejection with the server's structured error
before the App tears down the partial socket, so a synchronous disconnect cannot
replace the localized cause with a generic close message.

Scenario `voiceBehavior.interruptFrequency` does not change protocol turn
detection. With manual push-to-talk (`turn_detection: null`), it can guide brief
interjections or quicker challenges inside the model's response, but it cannot
make Qwen autonomously talk over an in-progress learner recording. The learner's
barge-in flow described below is independent.

See `docs/CATALOG_AND_PROMPTS.md` for the catalog and compiler contracts.

## Durable pause, continue, and restart boundary

These controls use the conversation REST API rather than new WebSocket control messages. Before pausing or restarting, the browser completes the normal input/assistant settlement barrier. It then closes realtime transport and calls `POST /api/conversations/:id/pause` or `POST /api/conversations/:id/restart`. Continue calls `POST /api/conversations/:id/resume` before opening a fresh socket and sending `session.configure`.

The gateway also coordinates transport lifetime with durable timing. The first configured browser socket idempotently resumes the conversation. Closing the last socket idempotently pauses it, so browser disconnect time is excluded even when the UI cannot send its REST request. A connection token prevents a stale superseded socket from pausing a newer socket for the same conversation. `ConversationRepository` rejects realtime configuration and new finalized-message writes while the row is paused; resume must happen first.

Restart retains the same durable conversation ID and configuration snapshot, but deletes its finalized text/audio and resets active duration before the new socket is configured. It never attempts to clear or reuse the old Qwen session.

## Browser control messages

### Configure session

Must be the first message after WebSocket open.

```json
{
  "type": "session.configure",
  "conversationId": 42,
  "maxHistoryTurns": 20
}
```

`conversationId` is a positive SQLite-generated integer.
`maxHistoryTurns` is an integer from 1 through 50 and defaults to 20 when
omitted. A turn is counted by user messages: restoration starts at the selected
recent user turn and includes all following user/assistant messages in their
persisted order.

Node rejects a missing conversation instead of trusting browser-supplied runtime
configuration. The browser cannot send audio before Node has restored the
session and replied with `session.ready`.

### Qwen history restoration

A resumed conversation always creates a fresh Qwen WebSocket; an expired Qwen
socket is not resumed. Node performs this ordered handshake:

1. Load the conversation's snapshotted Instructions, voice, and bounded recent
   finalized text from SQLite.
2. Wait for Qwen `session.created`, send `session.update`, and wait for
   `session.updated`.
3. Replay each persisted message with `conversation.item.create`: a user message
   uses `input_text`, and an assistant message uses `output_text`.
4. Wait for the matching `conversation.item.created` acknowledgement before
   sending the next item.
5. Emit `session.ready` only after every history item is acknowledged.

Restoration never sends `response.create`, so reconnecting cannot make the model
answer old text. With no persisted messages, readiness follows
`session.updated` as before. An upstream error, close, or acknowledgement timeout
during restoration fails configuration rather than starting with partial
context; timeout handling also terminates the upstream socket.

### Start input

```json
{ "type": "input.start" }
```

This marks subsequent binary frames as the current user turn. If a model response is active, Node cancels and suppresses its late audio.

Only one submitted user turn may await finalized transcription at a time. The
browser disables push-to-talk while that persistence acknowledgement is pending,
and Node independently rejects an early `input.start` with recoverable
`USER_TURN_PENDING`. This keeps the browser's single user-settlement barrier
aligned with the server's active transcription.

When the browser already knows the active `responseId`, it must first stop local
playback, calculate the conservative played duration, and send
`playback.interrupted`. It then sends `input.start`. WebSocket ordering preserves
that sequence. Server-side cancellation during `input.start` remains a fallback
for the short race where a response is active but its ID has not reached the
browser yet.

### Commit input

```json
{ "type": "input.commit" }
```

Node sends the following ordered Qwen events:

```text
input_audio_buffer.commit
response.create
```

The browser sends this only after the AudioWorklet has emitted its final partial
frame and acknowledged that capture stopped. This guarantees that the final
audio frame has entered the WebSocket queue before `input.commit`.

### Clear input

```json
{ "type": "input.clear" }
```

Node maps this to `input_audio_buffer.clear`. It is used when the user cancels a recording before submission.

Node waits for Qwen's `input_audio_buffer.cleared` acknowledgement, then sends:

```json
{ "type": "input.cleared" }
```

The browser hides the cancelled draft immediately but keeps input disabled until
this acknowledgement arrives. It must not follow a cleared turn with
`input.commit`. Node ignores transcription events for the cancelled turn, and
accepts user transcription only after `input_audio_buffer.committed` has bound
the pending turn to the same Qwen `item_id`.

### Cancel response fallback

```json
{ "type": "response.cancel" }
```

This cancels the latest response with no trusted playback duration. It is a
fallback for a response that has not exposed a `responseId` to the browser yet;
its retained transcript is therefore treated as zero-confidence. Once the
browser knows the response ID, it uses `playback.interrupted` instead.

### Playback completed

```json
{
  "type": "playback.completed",
  "responseId": "resp_..."
}
```

The browser sends this only after both conditions are true:

1. Qwen has reached terminal generation and Node has sent a completed
   `response.done` event.
2. Every scheduled Web Audio source for the response has ended naturally.

Node keeps the original assistant conversation item and may use its transcript
and generated PCM duration as a trusted speech-rate sample. A temporary empty
playback queue before `response.done` is not completion.

### Playback interrupted

```json
{
  "type": "playback.interrupted",
  "responseId": "resp_...",
  "safePlayedMs": 1420
}
```

The browser takes the playback timestamp synchronously before stopping its
scheduled sources. It sums only portions of PCM sources that have actually
reached their scheduled start time; prebuffered and future sources do not count.
It then subtracts output latency and a fixed 300 ms safety allowance:

```text
safePlayedMs = max(0, renderedAudioMs - outputLatencyMs - 300)
```

If application playback was muted during the response, audibility is considered
compromised and `safePlayedMs` is zero. The result is intentionally conservative:
Web Audio can estimate rendered output but cannot prove what reached the user's
ears through the operating system and physical output device.

After sending this event, the browser ignores late binary audio for the same
response. Node suppresses further output, cancels Qwen generation when it is
still active, and reconciles the assistant item as described below.

## Node events

### Ready and state

```json
{
  "type": "session.ready",
  "sessionId": "sess_...",
  "conversationId": 42
}
```

```json
{ "type": "session.state", "state": "ready" }
```

Valid application states are `connecting`, `ready`, `listening`, `processing`, `speaking`, `paused`, and `ended`. `paused` represents the REST/database lifecycle while no realtime socket is active; the gateway therefore does not normally emit a `session.state` frame for it.

### User transcript

```json
{
  "type": "transcript.user.delta",
  "itemId": "item_...",
  "text": "finalized text",
  "stash": "tentative text"
}
```

Qwen user deltas are not append-only. React displays `text + stash` and replaces it with the final event:

```json
{
  "type": "transcript.user.done",
  "itemId": "item_...",
  "transcript": "complete user turn"
}
```

### Assistant transcript

Assistant deltas are append-only:

```json
{
  "type": "transcript.assistant.delta",
  "responseId": "resp_...",
  "itemId": "item_...",
  "delta": "next text fragment"
}
```

The final event includes the authoritative transcript.

### Response lifecycle

```json
{ "type": "response.started", "responseId": "resp_..." }
```

```json
{
  "type": "response.done",
  "responseId": "resp_...",
  "status": "completed"
}
```

Status can be `completed`, `cancelled`, or `failed`.

`response.done` means Qwen finished producing data. It does **not** mean the
browser playback queue has drained or the user heard the complete response. A
normal spoken response therefore has two browser/model terminal events and one
persistence acknowledgement:

```text
response.done       Qwen/Node generation is terminal
playback.completed  browser playback later drained naturally
response.persisted  Node committed the finalized assistant text to SQLite
```

The browser keeps the response runtime after sending the playback receipt and
does not move its draft into finalized history until it receives the matching:

```json
{ "type": "response.persisted", "responseId": "resp_..." }
```

### Authoritative persistence points

SQLite stores authoritative finalized conversation text and its matching spoken
PCM, not streaming drafts. Node performs the write synchronously at these boundaries:

- A user message is written when Qwen emits the final
  `conversation.item.input_audio_transcription.completed` event, before Node
  publishes `transcript.user.done`; the submitted PCM16 16 kHz turn is attached
  to that message in the same transaction. Empty or failed transcription is fatal for
  that realtime session because persisting a following assistant without its
  user turn would create unrecoverable ordering.
- A normal assistant message is written only when Qwen generation has completed
  **and** the browser has sent `playback.completed`. Either event may arrive
  first; both are required. Node additionally holds that write until the user
  transcript associated with the response has been persisted, attaches the
  completed PCM16 24 kHz response, then publishes
  `response.persisted`.
- An interrupted assistant message is written only when reconciliation retains a
  non-empty prefix and Qwen has acknowledged the delete/recreate repair. The
  stored text is exactly the prefix reported by `response.reconciled`, with
  `interrupted: true`; stored audio is independently cut to the conservative
  browser receipt `safePlayedMs`, so queued/generated unheard PCM is discarded.

Transient user/assistant deltas, generated-but-unplayed assistant suffixes,
empty interruption rollbacks, and timing estimates are never stored.
If an authoritative write fails, Node sends non-recoverable
`HISTORY_PERSISTENCE_FAILED`, transitions to `ended`, and closes both sides. It
must not continue with SQLite and Qwen holding divergent histories.

### Reconciled interrupted response

```json
{
  "type": "response.reconciled",
  "responseId": "resp_...",
  "originalItemId": "item_original_...",
  "replacementItemId": "item_repair_...",
  "transcript": "The conservative prefix retained in context.",
  "strategy": "estimated_prefix",
  "confidence": "medium"
}
```

`strategy` is `estimated_prefix` or `rollback`; `confidence` is `high`,
`medium`, or `low`. `transcript` is the exact assistant text that remains in
Qwen conversation context. `replacementItemId` is omitted when no replacement
item was created. A low-confidence result uses `strategy: "rollback"`, has an
empty transcript, and removes the whole interrupted assistant turn.

`originalItemId` is omitted only when interruption happened before Qwen emitted
any assistant item, transcript, or audio. That is a safe empty rollback and
does not require a delete operation.

The browser must treat this event, rather than `response.done`, as the terminal
event for an interrupted response.

## Interrupted-response reconciliation

Qwen `response.cancel` retains text generated before cancellation, including
text whose PCM may only have been queued in the browser. Qwen Audio Realtime
does not expose word timestamps or an in-place item-truncate event, so Node uses
a best-effort repair:

1. Snapshot the transcript and generated PCM byte count when interruption is
   received. PCM16 24 kHz mono duration is `bytes / 48` milliseconds.
2. Wait for Qwen generation to become terminal if cancellation was required.
3. Estimate a conservative text prefix from `safePlayedMs`, the current
   response rate, and up to 20 naturally completed speech-rate samples for the
   same language class (`zh`, `en`, or `mixed`).
4. Delete the original assistant conversation item.
5. For a high- or medium-confidence non-empty prefix, recreate an assistant
   text item in the same conversation position. For low confidence, recreate
   nothing and roll back the whole assistant turn.
6. Send `response.reconciled` only after Qwen acknowledges the delete and,
   where applicable, the replacement create.

The prefix estimator never cuts an English word or Han character unit in half,
rolls back an additional unit margin, and prefers a nearby completed sentence.
Numbers, URLs, currency, acronyms, mixed-language speech, sparse rate history,
and very short audio lower confidence.

Context repair is a barrier for the next inference. Browser microphone audio
may continue to arrive while repair is running, but Node must not send the next
Qwen `response.create` until delete/recreate reconciliation succeeds. A repair
timeout or ambiguous Qwen context is fatal (`CONTEXT_STATE_UNCERTAIN`); continuing
would risk prompting the model with text the user never heard.

## Press-to-talk mapping and ordering

The UI gesture state machine is outside the wire protocol, but its mapping to
protocol messages is a contract:

| User/browser outcome | Required order |
| --- | --- |
| Hold begins while idle | `input.start` → binary microphone frames |
| Hold begins while a known response is playing | stop and snapshot local playback → `playback.interrupted` → `input.start` → binary microphone frames |
| Hold begins during the response-ID race | `input.start`; Node performs fallback cancellation |
| Normal release | request capture stop → final partial frame → Worklet stopped acknowledgement → `input.commit` |
| Upward slide of at least 72 px, then release | hide draft → cancel capture → `input.clear` → wait for `input.cleared`; never `input.commit` |
| `pointercancel`, unexpected lost capture, window blur, hidden document, disabled input, unmount, or session end | hide draft → cancel capture → `input.clear` → wait for `input.cleared`; never `input.commit` |
| Microphone startup fails after `input.start` | best-effort `input.clear`; no binary commit |
| Switch/new/end after a commit | settle current assistant → wait for persisted `transcript.user.done` → settle any newly-created assistant → close |

Long recording uses the same rows with a longer interval between `input.start`
and capture stop. Free conversation also retains manual Qwen turn detection: a
browser RMS detector sends `input.start`, flushes a bounded local PCM pre-roll,
streams the open turn, and sends `input.commit` after sustained silence. Capture
continues locally between turns, but Node ignores no implicit audio: the browser
does not forward its between-turn pre-roll until the next explicit
`input.start`. The one-pending-user-turn barrier remains unchanged.

Pointer capture keeps a normal release observable when the pointer leaves the
button. A release can also occur while microphone startup is still awaiting
permission or device initialization. The client retains that release intent and
finishes immediately after startup resolves: a successful normal start commits,
a cancellation clears, and a failed start returns to idle without a commit.

Starting a barge-in does not wait for context reconciliation to finish before
capturing the next user's audio. The reconciliation barrier is enforced before
the following upstream `response.create`, so the model cannot answer against an
unheard assistant suffix.

## Errors

```json
{
  "type": "error",
  "code": "TRANSCRIPTION_FAILED",
  "message": "The user audio could not be transcribed.",
  "recoverable": false
}
```

Unknown Qwen events are ignored. Malformed application events are rejected. A Qwen `server_error`, upstream close, failed/empty finalized user transcription, or authoritative SQLite write failure ends the current browser connection. Continuing on that same Qwen context after transcription failure could persist an assistant without the user turn that prompted it, so the failed socket is never reused.

The browser treats transport severity and UI navigation as separate concerns.
If the visible conversation has never reached `session.ready`, an error fails
initialization, tears down the partial runtime, and returns to the learner
launcher. After the conversation has been ready at least once, recoverable errors
keep the current socket and appear in a top Ant Design message for five seconds.
A non-recoverable runtime error still closes the uncertain socket, but the
browser preserves the chat surface and performs one serialized same-conversation
recovery: it reloads finalized SQLite text and opens a fresh Qwen socket. If that
replacement cannot initialize, the durable chat surface still remains open, the
error message expires after five seconds, and the composer becomes a manual reconnect button;
the existing confirmed end-session control remains available in the header.
Only an initial connection that has never reached `session.ready` returns to the
launcher automatically.
The close event from the discarded socket is epoch-guarded and must not overwrite
the original error or tear down the replacement runtime. An unexpected close
also rejects any in-flight user/assistant persistence barrier immediately;
navigation and session ending never wait for their 32-second safety timeout
after the transport is gone.

## Qwen upstream mapping

The minimum supported Qwen events are:

```text
session.created
session.updated
conversation.item.input_audio_transcription.delta
conversation.item.input_audio_transcription.completed
conversation.item.input_audio_transcription.failed
response.created
response.output_item.added
conversation.item.created
conversation.item.deleted
response.audio_transcript.delta
response.audio_transcript.done
response.audio.delta
response.done
error
```

Official references:

- [WebSocket API](https://help.aliyun.com/en/model-studio/qwen-audio-realtime-websocket-api)
- [Client events](https://help.aliyun.com/en/model-studio/fun-audiochat-client-events)
- [Server events](https://help.aliyun.com/en/model-studio/qwen-audio-realtime-server-events)
