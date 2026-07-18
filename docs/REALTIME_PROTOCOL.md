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

## Catalog-derived session configuration

The catalog REST API is separate from this WebSocket protocol. Before opening
`/ws/realtime`, the learner launcher loads `GET /api/catalog` and chooses a
scenario, one of its compatible personas, and easy/medium/hard difficulty.

`App.tsx` snapshots that selection for the lifetime of the session. It derives
the first control message as follows:

```ts
const instructions = compileRolePlayInstructions({
  persona,
  scenario,
  difficulty,
});
const voice = persona.voice;
```

`compileRolePlayInstructions` is a deterministic shared template, not a call to
another language model. It includes the persona identity/behavior, scenario
goals and hidden criteria, difficulty, tone, pace, and interjection behavior in
stable, previewable sections. The selected Qwen voice remains a separate
protocol field. Catalog edits or refreshes after connection do not alter the
active session; they apply to a later connection.

`session.configure.instructions` is limited to 12,000 characters by the shared
protocol schema. Catalog writes validate every compatible persona/scenario pair
for easy, medium, and hard and return `400 instructions_too_long` when any
compiled prompt exceeds that budget. The browser checks the chosen combination
again before microphone setup. Any error received before `session.ready`
rejects startup immediately, regardless of whether that error could have been
recoverable in an already-ready session.

Scenario `voiceBehavior.interruptFrequency` does not change protocol turn
detection. With manual push-to-talk (`turn_detection: null`), it can guide brief
interjections or quicker challenges inside the model's response, but it cannot
make Qwen autonomously talk over an in-progress learner recording. The learner's
barge-in flow described below is independent.

See `docs/CATALOG_AND_PROMPTS.md` for the catalog and compiler contracts.

## Browser control messages

### Configure session

Must be the first message after WebSocket open.

```json
{
  "type": "session.configure",
  "instructions": "Stay in character...",
  "voice": "longanqian",
  "maxHistoryTurns": 20
}
```

Node opens the Qwen connection, waits for `session.created`, sends `session.update`, and waits for `session.updated`. The browser cannot send audio before Node replies with `session.ready`.

For normal SPA sessions, `instructions` is the compiled selected configuration
and `voice` is the selected persona's saved Qwen voice. The protocol still
validates both fields at the Node boundary; neither value authorizes the browser
to send credentials or raw Qwen events.

### Start input

```json
{ "type": "input.start" }
```

This marks subsequent binary frames as the current user turn. If a model response is active, Node cancels and suppresses its late audio.

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

The browser must not follow a cleared turn with `input.commit`.

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
{ "type": "session.ready", "sessionId": "sess_..." }
```

```json
{ "type": "session.state", "state": "ready" }
```

Valid states are `connecting`, `ready`, `listening`, `processing`, `speaking`, and `ended`.

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
normal spoken response therefore has two terminal events:

```text
response.done       Qwen/Node generation is terminal
playback.completed  browser playback later drained naturally
```

The browser keeps the completed response ID until it has sent the playback
receipt.

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
| Upward slide of at least 72 px, then release | cancel capture → `input.clear`; never `input.commit` |
| `pointercancel`, unexpected lost capture, window blur, hidden document, disabled input, unmount, or session end | cancel capture → `input.clear`; never `input.commit` |
| Microphone startup fails after `input.start` | best-effort `input.clear`; no binary commit |

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
  "recoverable": true
}
```

Unknown Qwen events are ignored. Malformed application events are rejected. A Qwen `server_error` or upstream close ends the browser connection; invalid request and transcription failures can leave it open.

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
