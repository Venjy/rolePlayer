import type { QwenVoice } from "../../shared/realtime-protocol";

export interface QwenSessionConfiguration {
  instructions: string;
  voice: QwenVoice;
  maxHistoryTurns: number;
}

/** Final text history replayed into a newly-created Qwen WebSocket session. */
export interface QwenConversationHistoryItem {
  role: "user" | "assistant";
  text: string;
}

export interface QwenConversationContent {
  type?: string;
  text?: string;
  transcript?: string;
}

export interface QwenConversationItem {
  id?: string;
  object?: string;
  type?: "message" | "function_call" | "function_call_output";
  status?: "in_progress" | "completed";
  role?: "system" | "user" | "assistant";
  content?: QwenConversationContent[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

export interface QwenServerEvent {
  type: string;
  event_id?: string;
  session?: { id?: string };
  previous_item_id?: string;
  item?: QwenConversationItem;
  item_id?: string;
  response_id?: string;
  text?: string;
  stash?: string;
  transcript?: string;
  delta?: string;
  response?: {
    id?: string;
    status?: "completed" | "cancelled" | "failed";
    status_details?: {
      type?: string;
      reason?: string;
      error?: { code?: string; message?: string };
    };
    output?: QwenConversationItem[];
  };
  error?: {
    type?: string;
    code?: string;
    message?: string;
    param?: string;
  };
}

export type QwenServerEventParseResult =
  | { success: true; event: QwenServerEvent }
  | { success: false; reason: string };

/**
 * Validate only the Qwen events the adapter consumes. Unknown event types are
 * deliberately accepted so provider additions remain forward-compatible, but
 * a known event missing correlation data must never leave our state machine
 * waiting forever.
 */
export function parseQwenServerEvent(
  value: unknown,
): QwenServerEventParseResult {
  if (!isRecord(value) || !isNonEmptyString(value.type)) {
    return malformed("The payload is not a Qwen event object with a type.");
  }

  const event = value as unknown as QwenServerEvent;
  switch (event.type) {
    case "session.created":
      return isRecord(value.session) && isNonEmptyString(value.session.id)
        ? valid(event)
        : malformed("session.created is missing session.id.");

    case "session.updated":
    case "input_audio_buffer.cleared":
      return valid(event);

    case "input_audio_buffer.committed":
    case "conversation.item.deleted":
      return isNonEmptyString(value.item_id)
        ? valid(event)
        : malformed(`${event.type} is missing item_id.`);

    case "conversation.item.input_audio_transcription.delta":
      return isNonEmptyString(value.item_id) &&
        typeof value.text === "string" &&
        typeof value.stash === "string"
        ? valid(event)
        : malformed(
            "conversation.item.input_audio_transcription.delta has an invalid item_id, text, or stash.",
          );

    case "conversation.item.input_audio_transcription.completed":
      return isNonEmptyString(value.item_id) &&
        typeof value.transcript === "string"
        ? valid(event)
        : malformed(
            "conversation.item.input_audio_transcription.completed has an invalid item_id or transcript.",
          );

    case "conversation.item.input_audio_transcription.failed":
      return isNonEmptyString(value.item_id) &&
        isRecord(value.error) &&
        isNonEmptyString(value.error.message)
        ? valid(event)
        : malformed(
            "conversation.item.input_audio_transcription.failed has an invalid item_id or error.",
          );

    case "response.created":
      return isRecord(value.response) && isNonEmptyString(value.response.id)
        ? valid(event)
        : malformed("response.created is missing response.id.");

    case "response.output_item.added":
      return isNonEmptyString(value.response_id) &&
        isRecord(value.item) &&
        isNonEmptyString(value.item.id)
        ? valid(event)
        : malformed(
            "response.output_item.added is missing response_id or item.id.",
          );

    case "conversation.item.created":
      return isRecord(value.item) && isNonEmptyString(value.item.id)
        ? valid(event)
        : malformed("conversation.item.created is missing item.id.");

    case "response.audio_transcript.delta":
    case "response.text.delta":
    case "response.audio.delta":
      return isNonEmptyString(value.response_id) &&
        typeof value.delta === "string"
        ? valid(event)
        : malformed(`${event.type} has an invalid response_id or delta.`);

    case "response.audio_transcript.done":
      return isNonEmptyString(value.response_id) &&
        typeof value.transcript === "string"
        ? valid(event)
        : malformed(
            "response.audio_transcript.done has an invalid response_id or transcript.",
          );

    case "response.text.done":
      return isNonEmptyString(value.response_id) && typeof value.text === "string"
        ? valid(event)
        : malformed("response.text.done has an invalid response_id or text.");

    case "response.audio.done":
    case "response.content_part.done":
    case "response.output_item.done":
      return isNonEmptyString(value.response_id)
        ? valid(event)
        : malformed(`${event.type} is missing response_id.`);

    case "response.done":
      return isRecord(value.response) &&
        isNonEmptyString(value.response.id) &&
        (value.response.status === "completed" ||
          value.response.status === "cancelled" ||
          value.response.status === "failed")
        ? valid(event)
        : malformed("response.done has an invalid response.id or status.");

    case "error":
      return isRecord(value.error) &&
        isNonEmptyString(value.error.type) &&
        isNonEmptyString(value.error.message)
        ? valid(event)
        : malformed("The Qwen error event is missing its type or message.");

    default:
      return valid(event);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function valid(event: QwenServerEvent): QwenServerEventParseResult {
  return { success: true, event };
}

function malformed(reason: string): QwenServerEventParseResult {
  return { success: false, reason };
}
