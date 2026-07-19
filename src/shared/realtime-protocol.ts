import { z } from "zod";
import { databaseIdSchema } from "./database-id";

export const MAX_REALTIME_INSTRUCTIONS_LENGTH = 12_000;

export const qwenVoiceSchema = z.enum([
  "longanqian",
  "longanlingxin",
  "longanlingxi",
  "longanxiaoxin",
  "longanlufeng",
]);

export type QwenVoice = z.infer<typeof qwenVoiceSchema>;

export const clientControlMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("session.configure"),
      conversationId: databaseIdSchema,
      maxHistoryTurns: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  z.object({ type: z.literal("input.start") }),
  z.object({ type: z.literal("input.commit") }),
  z.object({ type: z.literal("input.clear") }),
  z.object({ type: z.literal("response.cancel") }),
  z.object({
    type: z.literal("playback.completed"),
    responseId: z.string().min(1),
  }),
  z.object({
    type: z.literal("playback.interrupted"),
    responseId: z.string().min(1),
    safePlayedMs: z.number().int().min(0).max(10 * 60 * 1_000),
  }),
]);

export type ClientControlMessage = z.infer<typeof clientControlMessageSchema>;

export const sessionStateSchema = z.enum([
  "connecting",
  "ready",
  "listening",
  "processing",
  "speaking",
  "ended",
]);

export type SessionState = z.infer<typeof sessionStateSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.ready"),
    sessionId: z.string(),
    conversationId: databaseIdSchema,
  }),
  z.object({ type: z.literal("session.state"), state: sessionStateSchema }),
  z.object({
    type: z.literal("transcript.user.delta"),
    itemId: z.string(),
    text: z.string(),
    stash: z.string(),
  }),
  z.object({
    type: z.literal("transcript.user.done"),
    itemId: z.string(),
    transcript: z.string(),
  }),
  z.object({
    type: z.literal("transcript.assistant.delta"),
    responseId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("transcript.assistant.done"),
    responseId: z.string(),
    itemId: z.string(),
    transcript: z.string(),
  }),
  z.object({ type: z.literal("response.started"), responseId: z.string() }),
  z.object({
    type: z.literal("response.persisted"),
    responseId: z.string(),
  }),
  z.object({
    type: z.literal("response.done"),
    responseId: z.string().optional(),
    status: z.enum(["completed", "cancelled", "failed"]),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("response.reconciled"),
    responseId: z.string(),
    originalItemId: z.string().optional(),
    replacementItemId: z.string().optional(),
    transcript: z.string(),
    strategy: z.enum(["estimated_prefix", "rollback"]),
    confidence: z.enum(["high", "medium", "low"]),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    recoverable: z.boolean(),
  }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;
export const PCM_BYTES_PER_SAMPLE = 2;

// 100 ms at 16 kHz, PCM16 mono. It follows Qwen's latency optimization guide.
export const INPUT_CHUNK_SAMPLES = 1_600;
export const INPUT_CHUNK_BYTES = INPUT_CHUNK_SAMPLES * PCM_BYTES_PER_SAMPLE;
