import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(moduleDirectory, "../../.env"), quiet: true });

const serverEnvSchema = z.object({
  SERVER_HOST: z.string().default("127.0.0.1"),
  SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  CATALOG_DATABASE_PATH: z
    .string()
    .trim()
    .min(1)
    .default("data/catalog.sqlite"),
  CONVERSATION_DATABASE_PATH: z
    .string()
    .trim()
    .min(1)
    .default("data/conversations.sqlite"),
  LEGACY_DATABASE_PATH: z.string().trim().min(1).optional(),
  DATABASE_PATH: z.string().trim().min(1).optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

const qwenEnvSchema = z
  .object({
    DASHSCOPE_API_KEY: z.string().trim().min(1),
    DASHSCOPE_WORKSPACE_ID: z.string().trim().optional(),
    DASHSCOPE_REALTIME_URL: z.string().url().optional(),
    DASHSCOPE_MODEL: z
      .string()
      .trim()
      .min(1)
      .default("qwen-audio-3.0-realtime-plus"),
  })
  .superRefine((value, context) => {
    if (!value.DASHSCOPE_WORKSPACE_ID && !value.DASHSCOPE_REALTIME_URL) {
      context.addIssue({
        code: "custom",
        path: ["DASHSCOPE_WORKSPACE_ID"],
        message:
          "Set DASHSCOPE_WORKSPACE_ID or provide DASHSCOPE_REALTIME_URL.",
      });
    }
  });

const feedbackEnvSchema = z.object({
  DASHSCOPE_API_KEY: z.string().trim().min(1),
  DASHSCOPE_FEEDBACK_URL: z
    .string()
    .url()
    .default("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),
  DASHSCOPE_FEEDBACK_MODEL: z
    .string()
    .trim()
    .min(1)
    .default("qwen3.6-flash"),
  DASHSCOPE_FEEDBACK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(60_000),
});

export type QwenConfig = ReturnType<typeof getQwenConfig>;

export function getServerConfig() {
  const parsed = serverEnvSchema.parse(process.env);
  return {
    ...parsed,
    // DATABASE_PATH is accepted only as the source path for the one-time split
    // command so existing local .env files do not need an immediate edit.
    LEGACY_DATABASE_PATH:
      parsed.LEGACY_DATABASE_PATH ??
      parsed.DATABASE_PATH ??
      "data/role-player.sqlite",
  };
}

export function getQwenConfig() {
  const parsed = qwenEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Qwen configuration is incomplete. ${details}`);
  }

  const endpoint =
    parsed.data.DASHSCOPE_REALTIME_URL ??
    `wss://${parsed.data.DASHSCOPE_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime`;

  return {
    apiKey: parsed.data.DASHSCOPE_API_KEY,
    endpoint,
    model: parsed.data.DASHSCOPE_MODEL,
    workspaceId: parsed.data.DASHSCOPE_WORKSPACE_ID,
  };
}

export function hasQwenConfig(): boolean {
  return qwenEnvSchema.safeParse(process.env).success;
}

export type FeedbackConfig = ReturnType<typeof getFeedbackConfig>;

/**
 * Text-model features are optional at process startup. Feedback generation,
 * catalog draft generation, and success detection resolve this configuration
 * lazily, so realtime voice remains usable when it has not been supplied yet.
 */
export function getFeedbackConfig() {
  const parsed = feedbackEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Feedback model configuration is incomplete. ${details}`);
  }

  return {
    apiKey: parsed.data.DASHSCOPE_API_KEY,
    endpoint: parsed.data.DASHSCOPE_FEEDBACK_URL,
    model: parsed.data.DASHSCOPE_FEEDBACK_MODEL,
    timeoutMs: parsed.data.DASHSCOPE_FEEDBACK_TIMEOUT_MS,
  };
}

export function hasFeedbackConfig(): boolean {
  return feedbackEnvSchema.safeParse(process.env).success;
}
