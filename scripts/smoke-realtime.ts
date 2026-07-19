import { readFile } from "node:fs/promises";
import WebSocket, { type RawData } from "ws";
import { conversationDetailSchema } from "../src/shared/conversation-history";
import { rolePlayCatalogSchema } from "../src/shared/role-play-catalog";
import {
  INPUT_CHUNK_BYTES,
  INPUT_SAMPLE_RATE,
  serverMessageSchema,
  type ServerMessage,
} from "../src/shared/realtime-protocol";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:3001/ws/realtime";
const TEST_TIMEOUT_MS = 60_000;
const DURING_GENERATION_INTERRUPT_BYTES = 96_000;

type InterruptionMode = "none" | "after-generation" | "during-generation";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function sendJson(socket: WebSocket, message: object): void {
  socket.send(JSON.stringify(message));
}

function apiBaseFromGateway(gatewayUrl: string): URL {
  const base = new URL(gatewayUrl);
  base.protocol = base.protocol === "wss:" ? "https:" : "http:";
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  return base;
}

async function createSmokeConversation(gatewayUrl: string): Promise<number> {
  const apiBase = process.env.SMOKE_API_URL
    ? new URL(process.env.SMOKE_API_URL)
    : apiBaseFromGateway(gatewayUrl);
  const catalogResponse = await fetch(new URL("/api/catalog", apiBase));
  if (!catalogResponse.ok) {
    throw new Error(
      `Could not load the local catalog (HTTP ${catalogResponse.status}).`,
    );
  }
  const catalog = rolePlayCatalogSchema.parse(await catalogResponse.json());
  const scenario = catalog.scenarios[0];
  const persona = scenario
    ? catalog.personas.find(({ id }) =>
        scenario.allowedPersonaIds.includes(id),
      )
    : undefined;
  if (!scenario || !persona) {
    throw new Error(
      "The local catalog needs at least one scenario with a compatible persona.",
    );
  }

  const createResponse = await fetch(new URL("/api/conversations", apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personaId: persona.id,
      scenarioId: scenario.id,
      difficulty: "easy",
      locale: "en",
    }),
  });
  if (!createResponse.ok) {
    throw new Error(
      `Could not create the smoke-test conversation (HTTP ${createResponse.status}).`,
    );
  }
  return conversationDetailSchema.parse(await createResponse.json()).id;
}

async function streamPcm(socket: WebSocket, pcm: Buffer): Promise<void> {
  sendJson(socket, { type: "input.start" });

  for (let offset = 0; offset < pcm.length; offset += INPUT_CHUNK_BYTES) {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error("The local realtime gateway closed during audio upload.");
    }

    const chunk = pcm.subarray(
      offset,
      Math.min(offset + INPUT_CHUNK_BYTES, pcm.length),
    );
    socket.send(chunk, { binary: true });

    const chunkDurationMs =
      (chunk.length / 2 / INPUT_SAMPLE_RATE) * 1_000;
    await delay(chunkDurationMs);
  }

  sendJson(socket, { type: "input.commit" });
}

function parseServerMessage(data: RawData): ServerMessage {
  let json: unknown;
  try {
    json = JSON.parse(rawDataToBuffer(data).toString());
  } catch {
    throw new Error("The local gateway returned malformed JSON.");
  }

  const parsed = serverMessageSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Unexpected gateway event: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function runSmokeTest(
  pcmPath: string,
  gatewayUrl: string,
  interruptionMode: InterruptionMode,
): Promise<void> {
  const pcm = await readFile(pcmPath);
  if (pcm.length < INPUT_CHUNK_BYTES || pcm.length % 2 !== 0) {
    throw new Error(
      `Input must be headerless PCM16 mono at 16 kHz and at least ${INPUT_CHUNK_BYTES} bytes.`,
    );
  }

  const conversationId = await createSmokeConversation(gatewayUrl);
  const socket = new WebSocket(gatewayUrl);
  let settled = false;
  let audioUploadStarted = false;
  let liveUserTranscript = "";
  let finalUserTranscript = "";
  let assistantTranscriptDeltas = "";
  let finalAssistantTranscript = "";
  let outputAudioBytes = 0;
  let interruptionSent = false;
  let activeResponseId: string | undefined;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      fail(new Error(`The smoke test timed out after ${TEST_TIMEOUT_MS / 1_000}s.`));
    }, TEST_TIMEOUT_MS);

    const closeSocket = () => {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, "Smoke test finished");
      }
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      closeSocket();
      reject(error);
    };

    socket.on("open", () => {
      sendJson(socket, {
        type: "session.configure",
        conversationId,
        maxHistoryTurns: 5,
      });
    });

    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        outputAudioBytes += rawDataToBuffer(data).length;
        if (
          interruptionMode === "during-generation" &&
          !interruptionSent &&
          activeResponseId &&
          outputAudioBytes >= DURING_GENERATION_INTERRUPT_BYTES
        ) {
          sendJson(socket, {
            type: "playback.interrupted",
            responseId: activeResponseId,
            safePlayedMs: 1_000,
          });
          interruptionSent = true;
        }
        return;
      }

      let message: ServerMessage;
      try {
        message = parseServerMessage(data);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Unknown protocol error."));
        return;
      }

      switch (message.type) {
        case "session.ready":
          if (!audioUploadStarted) {
            audioUploadStarted = true;
            void streamPcm(socket, pcm).catch(fail);
          }
          break;

        case "transcript.user.delta":
          liveUserTranscript = `${message.text}${message.stash}`;
          break;

        case "transcript.user.done":
          finalUserTranscript = message.transcript;
          break;

        case "transcript.assistant.delta":
          assistantTranscriptDeltas += message.delta;
          break;

        case "transcript.assistant.done":
          finalAssistantTranscript = message.transcript;
          break;

        case "response.started":
          activeResponseId = message.responseId;
          break;

        case "response.done": {
          const userTranscript =
            finalUserTranscript.trim() || liveUserTranscript.trim();
          const assistantTranscript =
            finalAssistantTranscript.trim() ||
            assistantTranscriptDeltas.trim();
          const failures = [
            message.status !== "completed" &&
              `response status was ${message.status}`,
            !userTranscript && "no user transcript was received",
            !assistantTranscript && "no assistant transcript was received",
            outputAudioBytes === 0 && "no assistant audio was received",
          ].filter(Boolean);

          if (failures.length > 0) {
            fail(new Error(failures.join("; ")));
            return;
          }

          if (interruptionMode === "during-generation") {
            fail(
              new Error(
                "the gateway exposed response.done instead of reconciling the interrupted generation",
              ),
            );
            return;
          }

          if (interruptionMode === "after-generation") {
            if (!message.responseId) {
              fail(new Error("completed response did not include a response ID"));
              return;
            }
            const generatedAudioMs = outputAudioBytes / 48;
            sendJson(socket, {
              type: "playback.interrupted",
              responseId: message.responseId,
              safePlayedMs: Math.max(
                300,
                Math.floor(generatedAudioMs * 0.75),
              ),
            });
            interruptionSent = true;
            break;
          }

          if (!message.responseId) {
            fail(new Error("completed response did not include a response ID"));
            return;
          }
          sendJson(socket, {
            type: "playback.completed",
            responseId: message.responseId,
          });
          break;
        }

        case "response.persisted": {
          if (
            interruptionMode !== "none" ||
            message.responseId !== activeResponseId
          ) {
            fail(new Error("received an unexpected response.persisted event"));
            return;
          }

          console.log(
            JSON.stringify(
              {
                status: "persisted",
                userTranscript:
                  finalUserTranscript.trim() || liveUserTranscript.trim(),
                assistantTranscript:
                  finalAssistantTranscript.trim() ||
                  assistantTranscriptDeltas.trim(),
                outputAudioBytes,
              },
              null,
              2,
            ),
          );

          settled = true;
          clearTimeout(timeout);
          closeSocket();
          resolve();
          break;
        }

        case "response.reconciled": {
          if (interruptionMode === "none" || !interruptionSent) {
            fail(new Error("received an unexpected response.reconciled event"));
            return;
          }

          const userTranscript =
            finalUserTranscript.trim() || liveUserTranscript.trim();
          console.log(
            JSON.stringify(
              {
                status: "reconciled",
                userTranscript,
                generatedAssistantTranscript:
                  finalAssistantTranscript.trim() ||
                  assistantTranscriptDeltas.trim(),
                retainedAssistantTranscript: message.transcript,
                strategy: message.strategy,
                confidence: message.confidence,
                originalItemId: message.originalItemId,
                replacementItemId: message.replacementItemId,
                outputAudioBytes,
              },
              null,
              2,
            ),
          );

          const commonFailures = [
            !userTranscript && "no user transcript was received",
            !message.originalItemId && "no original assistant item was repaired",
          ].filter(Boolean);
          const modeFailures =
            interruptionMode === "after-generation"
              ? [
                  !message.replacementItemId &&
                    "no replacement assistant item was created",
                  !message.transcript && "the retained assistant prefix was empty",
                  message.strategy !== "estimated_prefix" &&
                    `unexpected repair strategy ${message.strategy}`,
                ].filter(Boolean)
              : [
                  message.replacementItemId !== undefined &&
                    "a low-confidence interruption unexpectedly created a replacement",
                  message.transcript !== "" &&
                    "a low-confidence interruption retained estimated text",
                  message.strategy !== "rollback" &&
                    `unexpected repair strategy ${message.strategy}`,
                ].filter(Boolean);
          const failures = [...commonFailures, ...modeFailures];
          if (failures.length > 0) {
            fail(new Error(failures.join("; ")));
            return;
          }

          settled = true;
          clearTimeout(timeout);
          closeSocket();
          resolve();
          break;
        }

        case "error":
          fail(new Error(`${message.code}: ${message.message}`));
          break;

        default:
          break;
      }
    });

    socket.on("error", (error) => {
      fail(error);
    });

    socket.on("close", (code, reason) => {
      if (!settled) {
        fail(
          new Error(
            `The local gateway closed before completion (${code}: ${reason.toString() || "no reason"}).`,
          ),
        );
      }
    });
  });
}

async function main(): Promise<void> {
  const pcmPath = process.argv[2];
  const interruptionMode: InterruptionMode = process.argv.includes(
    "--interrupt-during-generation",
  )
    ? "during-generation"
    : process.argv.includes("--interrupt")
      ? "after-generation"
      : "none";
  if (!pcmPath) {
    throw new Error(
      "Usage: pnpm smoke:realtime /absolute/path/to/16khz-mono-s16le.pcm [--interrupt|--interrupt-during-generation]",
    );
  }

  await runSmokeTest(
    pcmPath,
    process.env.SMOKE_WS_URL ?? DEFAULT_GATEWAY_URL,
    interruptionMode,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
