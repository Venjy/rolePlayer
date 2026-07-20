import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import WebSocket, { type RawData } from "ws";
import {
  clientControlMessageSchema,
  type ServerMessage,
} from "../../shared/realtime-protocol";
import { localizeScenario } from "../../shared/role-play-localization";
import { getFeedbackConfig, getQwenConfig } from "../config";
import {
  ConversationEndedError,
  ConversationRepository,
} from "../conversations/conversation-repository";
import {
  QwenConversationSuccessEvaluator,
  type ConversationSuccessEvaluator,
  type SuccessEvaluationInput,
} from "../conversations/conversation-success-evaluator";
import { QwenRealtimeClient } from "./qwen-realtime-client";
import { RealtimeSessionController } from "./realtime-session-controller";
import type { QwenConversationHistoryItem } from "./qwen-types";

const MAX_INPUT_FRAME_BYTES = 64 * 1024;
const MAX_BROWSER_BUFFERED_BYTES = 1024 * 1024;

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

export function selectRealtimeHistory(
  messages: readonly QwenConversationHistoryItem[],
  maximumTurns: number,
): QwenConversationHistoryItem[] {
  const turns: Array<{
    user: QwenConversationHistoryItem;
    assistant?: QwenConversationHistoryItem;
  }> = [];

  for (const message of messages) {
    const normalized = { role: message.role, text: message.text };
    if (message.role === "user") {
      turns.push({ user: normalized });
      continue;
    }

    // The runtime produces at most one assistant response for a user turn.
    // If an externally modified database violates that invariant, retain only
    // the latest assistant item rather than making browser startup unbounded.
    const currentTurn = turns.at(-1);
    if (currentTurn) currentTurn.assistant = normalized;
  }

  return turns.slice(-maximumTurns).flatMap(({ user, assistant }) =>
    assistant ? [user, assistant] : [user],
  );
}

export async function registerRealtimeGateway(
  app: FastifyInstance,
  options: {
    clientOrigin: string;
    successEvaluator?: ConversationSuccessEvaluator | null;
  },
): Promise<void> {
  await app.register(websocket);
  const conversations = new ConversationRepository(app.conversationDatabase);
  const activeConversationConnections = new Map<number, Set<symbol>>();
  const successEvaluator = options.successEvaluator === undefined
    ? createDefaultSuccessEvaluator()
    : options.successEvaluator ?? undefined;

  app.get("/ws/realtime", { websocket: true }, (browser, request) => {
    const origin = request.headers.origin;
    if (origin && origin !== options.clientOrigin) {
      browser.close(1008, "Origin is not allowed");
      return;
    }

    let qwen: QwenRealtimeClient | undefined;
    let controller: RealtimeSessionController | undefined;
    const connectionToken = Symbol("realtime-connection");
    let connectedConversationId: number | undefined;
    let browserClosed = false;
    let configureStarted = false;
    let successDetected = false;
    let successAssessmentQueue = Promise.resolve();
    const successAssessmentAbort = new AbortController();

    const registerConversationConnection = (conversationId: number) => {
      const connections =
        activeConversationConnections.get(conversationId) ?? new Set<symbol>();
      connections.add(connectionToken);
      activeConversationConnections.set(conversationId, connections);
      connectedConversationId = conversationId;
    };

    const releaseConversationConnection = () => {
      const conversationId = connectedConversationId;
      if (conversationId === undefined) return;
      connectedConversationId = undefined;
      const connections = activeConversationConnections.get(conversationId);
      connections?.delete(connectionToken);
      if (connections && connections.size > 0) return;
      activeConversationConnections.delete(conversationId);
      try {
        conversations.pauseConversation(conversationId);
      } catch (error) {
        if (!(error instanceof ConversationEndedError)) {
          request.log.warn(
            { error, conversationId },
            "Could not pause conversation after realtime disconnect",
          );
        }
      }
    };

    const send = (message: ServerMessage) => {
      if (browser.readyState === WebSocket.OPEN) {
        browser.send(JSON.stringify(message));
      }
    };

    const sendError = (
      code: string,
      message: string,
      recoverable: boolean,
    ) => {
      send({ type: "error", code, message, recoverable });
    };

    const configure = async (
      message: Extract<
        ReturnType<typeof clientControlMessageSchema.parse>,
        { type: "session.configure" }
      >,
    ) => {
      if (configureStarted) {
        sendError("ALREADY_CONFIGURED", "The session is already configured.", true);
        return;
      }

      configureStarted = true;
      send({ type: "session.state", state: "connecting" });

      try {
        conversations.resumeConversation(message.conversationId);
        registerConversationConnection(message.conversationId);
        const conversation = conversations.getRuntimeConversation(
          message.conversationId,
          message.maxHistoryTurns,
        );
        if (!conversation) {
          sendError(
            "CONVERSATION_NOT_FOUND",
            `No conversation exists with ID "${message.conversationId}".`,
            false,
          );
          send({ type: "session.state", state: "ended" });
          browser.close(1008, "Conversation not found");
          return;
        }

        qwen = new QwenRealtimeClient(getQwenConfig(), {
          onEvent: (event) => controller?.handleQwenEvent(event),
          onMalformedEvent: (raw) => {
            request.log.warn(
              { payloadLength: raw.length },
              "Ignoring malformed Qwen event",
            );
          },
          onClose: (code, reason) => {
            if (browserClosed) return;
            sendError(
              "UPSTREAM_CLOSED",
              `The Qwen connection closed (${code}${reason ? `: ${reason}` : ""}).`,
              false,
            );
            send({ type: "session.state", state: "ended" });
            browser.close(1011, "Qwen connection closed");
          },
        });

        const sessionId = await qwen.connect(
          {
            instructions: conversation.instructions,
            voice: conversation.voice,
            maxHistoryTurns: message.maxHistoryTurns,
          },
          selectRealtimeHistory(
            conversation.messages,
            message.maxHistoryTurns,
          ),
        );

        if (browserClosed) {
          qwen.close();
          return;
        }

        controller = new RealtimeSessionController(qwen, {
          send,
          sendAudio: (audio) => {
            if (
              browser.readyState !== WebSocket.OPEN ||
              browser.bufferedAmount > MAX_BROWSER_BUFFERED_BYTES
            ) {
              return false;
            }
            browser.send(audio, { binary: true });
            return true;
          },
          persistMessage: (persisted) => {
            conversations.appendMessage({
              conversationId: conversation.id,
              ...persisted,
            });
          },
          assessScenarioSuccess: ({ responseId, transcript }) => {
            if (!successEvaluator || successDetected) return;
            successAssessmentQueue = successAssessmentQueue
              .then(async () => {
                if (
                  browserClosed ||
                  successDetected ||
                  successAssessmentAbort.signal.aborted
                ) {
                  return;
                }
                const current = conversations.getConversation(conversation.id);
                if (!current || current.status !== "active") return;
                const input = buildSuccessEvaluationInput(
                  current,
                  transcript,
                );
                if (input.criteria.length === 0) return;
                const assessment = await successEvaluator.evaluate(
                  input,
                  successAssessmentAbort.signal,
                );
                if (
                  !assessment.allCriteriaCompleted ||
                  browserClosed ||
                  successDetected
                ) {
                  return;
                }
                successDetected = true;
                send({ type: "scenario.success.detected", responseId });
              })
              .catch((error: unknown) => {
                if (successAssessmentAbort.signal.aborted) return;
                request.log.warn(
                  { error, conversationId: conversation.id, responseId },
                  "Scenario success assessment failed; continuing the conversation",
                );
              });
          },
          closeWithError: () => {
            qwen?.close();
            if (browser.readyState === WebSocket.OPEN) {
              browser.close(1011, "Context repair failed");
            }
          },
          warn: (error, logMessage) => {
            request.log.warn({ error }, logMessage);
          },
          error: (error, logMessage) => {
            request.log.error({ error }, logMessage);
          },
        });

        send({
          type: "session.ready",
          sessionId,
          conversationId: conversation.id,
        });
        send({ type: "session.state", state: "ready" });
      } catch (error) {
        if (error instanceof ConversationEndedError) {
          sendError(
            "CONVERSATION_ENDED",
            "The conversation has ended and cannot be resumed.",
            false,
          );
          send({ type: "session.state", state: "ended" });
          browserClosed = true;
          if (browser.readyState === WebSocket.OPEN) {
            browser.close(1008, "Conversation ended");
          }
          return;
        }
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        request.log.error({ error }, "Failed to configure realtime session");
        sendError("SESSION_CONFIGURATION_FAILED", errorMessage, false);
        send({ type: "session.state", state: "ended" });
        browserClosed = true;
        qwen?.close();
        if (browser.readyState === WebSocket.OPEN) {
          browser.close(1011, "Session configuration failed");
        }
      }
    };

    const handleControlMessage = async (raw: string) => {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        sendError("INVALID_JSON", "Control message must be valid JSON.", true);
        return;
      }

      const parsed = clientControlMessageSchema.safeParse(json);
      if (!parsed.success) {
        sendError(
          "INVALID_MESSAGE",
          parsed.error.issues[0]?.message ?? "Invalid control message.",
          true,
        );
        return;
      }

      const message = parsed.data;
      if (message.type === "session.configure") {
        await configure(message);
        return;
      }

      if (!controller) {
        sendError("SESSION_NOT_READY", "Wait for session.ready first.", true);
        return;
      }

      controller.handleControl(message);
    };

    browser.on("message", (data: RawData, isBinary: boolean) => {
      if (!isBinary) {
        void handleControlMessage(data.toString()).catch((error: unknown) => {
          request.log.error({ error }, "Failed to process browser control message");
          sendError("GATEWAY_ERROR", "The gateway could not process the request.", true);
        });
        return;
      }

      if (!controller) return;
      const pcm = rawDataToBuffer(data);
      if (
        pcm.length === 0 ||
        pcm.length > MAX_INPUT_FRAME_BYTES ||
        pcm.length % 2 !== 0
      ) {
        sendError("INVALID_AUDIO_FRAME", "Invalid PCM16 audio frame.", true);
        return;
      }

      controller.appendAudio(pcm);
    });

    browser.on("close", () => {
      browserClosed = true;
      successAssessmentAbort.abort();
      controller?.dispose();
      qwen?.close();
      releaseConversationConnection();
    });

    browser.on("error", (error) => {
      request.log.warn({ error }, "Browser WebSocket error");
    });
  });
}

function createDefaultSuccessEvaluator(): ConversationSuccessEvaluator | undefined {
  try {
    return new QwenConversationSuccessEvaluator(getFeedbackConfig());
  } catch {
    // Voice conversations remain available when the optional text evaluator is
    // not configured. In that case the app simply never suggests auto-ending.
    return undefined;
  }
}

function buildSuccessEvaluationInput(
  conversation: NonNullable<ReturnType<ConversationRepository["getConversation"]>>,
  pendingAssistantTranscript: string,
): SuccessEvaluationInput {
  const scenario = localizeScenario(
    conversation.scenario,
    conversation.locale,
  );
  const messages = conversation.messages.map((message, turnIndex) => ({
    turnIndex,
    role: message.role,
    text: message.text,
  }));
  const lastMessage = conversation.messages.at(-1);
  if (
    lastMessage?.role !== "assistant" ||
    lastMessage.text !== pendingAssistantTranscript
  ) {
    messages.push({
      turnIndex: messages.length,
      role: "assistant",
      text: pendingAssistantTranscript,
    });
  }
  return {
    locale: conversation.locale,
    scenarioName: scenario.name,
    criteria: scenario.successCriteria,
    messages,
  };
}
