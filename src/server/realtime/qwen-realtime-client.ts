import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import type { QwenConfig } from "../config";
import type {
  QwenConversationHistoryItem,
  QwenSessionConfiguration,
} from "./qwen-types";
import {
  parseQwenServerEvent,
  type QwenServerEvent,
} from "./qwen-types";

const CONNECTION_TIMEOUT_MS = 15_000;

export interface QwenRealtimeClientHandlers {
  onEvent: (event: QwenServerEvent) => void;
  onClose: (code: number, reason: string) => void;
  onMalformedEvent: (raw: string, reason: string) => void;
  onProtocolError: (message: string) => void;
}

export type QwenSocketFactory = (
  url: URL,
  options: WebSocket.ClientOptions,
) => WebSocket;

export class QwenRealtimeClient {
  private socket?: WebSocket;
  private configured = false;

  public constructor(
    private readonly config: QwenConfig,
    private readonly handlers: QwenRealtimeClientHandlers,
    private readonly createSocket: QwenSocketFactory = (url, options) =>
      new WebSocket(url, options),
  ) {}

  public connect(
    session: QwenSessionConfiguration,
    history: readonly QwenConversationHistoryItem[] = [],
  ): Promise<string> {
    if (this.socket) {
      throw new Error("The upstream Qwen connection has already been created.");
    }

    const url = new URL(this.config.endpoint);
    url.searchParams.set("model", this.config.model);

    return new Promise((resolve, reject) => {
      let settled = false;
      let sessionId = "unknown";
      let sessionUpdateSent = false;
      let sessionUpdated = false;
      let historyIndex = 0;
      let pendingHistoryItemId: string | undefined;
      let timeout: NodeJS.Timeout | undefined;

      const clearConnectionTimeout = () => {
        if (timeout) clearTimeout(timeout);
        timeout = undefined;
      };

      const settleWithError = (error: Error) => {
        if (settled) return;
        settled = true;
        this.configured = false;
        clearConnectionTimeout();
        reject(error);
        if (
          this.socket &&
          this.socket.readyState !== WebSocket.CLOSED &&
          this.socket.readyState !== WebSocket.CLOSING
        ) {
          this.socket.terminate();
        }
      };

      const armConnectionTimeout = (message: string) => {
        clearConnectionTimeout();
        timeout = setTimeout(() => {
          settleWithError(new Error(message));
        }, CONNECTION_TIMEOUT_MS);
      };

      const settleSuccessfully = () => {
        if (settled) return;
        settled = true;
        this.configured = true;
        clearConnectionTimeout();
        resolve(sessionId);
      };

      const sendNextHistoryItem = () => {
        if (historyIndex >= history.length) {
          settleSuccessfully();
          return;
        }

        const historyItem = history[historyIndex];
        if (!historyItem?.text.trim()) {
          settleWithError(
            new Error(
              `Conversation history item ${historyIndex + 1} has no text.`,
            ),
          );
          return;
        }

        const itemId = `item_history_${randomUUID().replaceAll("-", "")}`;
        pendingHistoryItemId = itemId;
        try {
          this.sendConversationTextItem({
            itemId,
            role: historyItem.role,
            text: historyItem.text,
          });
        } catch (error) {
          settleWithError(
            error instanceof Error
              ? error
              : new Error("Could not restore Qwen conversation history."),
          );
          return;
        }
        armConnectionTimeout(
          `Timed out while restoring Qwen conversation history item ${historyIndex + 1}/${history.length}.`,
        );
      };

      armConnectionTimeout("Timed out while connecting to Qwen Realtime API.");

      this.socket = this.createSocket(url, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "User-Agent": "ai-role-player-demo/0.1.0",
          ...(this.config.workspaceId
            ? { "X-DashScope-WorkSpace": this.config.workspaceId }
            : {}),
        },
      });

      this.socket.on("message", (data: RawData) => {
        const raw = data.toString();
        let value: unknown;

        try {
          value = JSON.parse(raw) as unknown;
        } catch {
          const reason = "Qwen returned invalid JSON.";
          this.handlers.onMalformedEvent(raw, reason);
          if (!settled) settleWithError(new Error(reason));
          else this.handlers.onProtocolError(reason);
          return;
        }

        const parsed = parseQwenServerEvent(value);
        if (!parsed.success) {
          this.handlers.onMalformedEvent(raw, parsed.reason);
          if (!settled) settleWithError(new Error(parsed.reason));
          else this.handlers.onProtocolError(parsed.reason);
          return;
        }
        const event = parsed.event;

        if (event.type === "session.created") {
          sessionId = event.session?.id ?? "unknown";
          if (sessionUpdateSent) {
            this.handlers.onEvent(event);
            return;
          }
          sessionUpdateSent = true;
          this.send({
            type: "session.update",
            session: {
              modalities: ["audio", "text"],
              voice: session.voice,
              instructions: session.instructions,
              input_audio_format: "pcm",
              output_audio_format: "pcm",
              max_history_turns: session.maxHistoryTurns,
              turn_detection: null,
            },
          });
        }

        if (event.type === "session.updated" && !settled) {
          if (!sessionUpdated) {
            sessionUpdated = true;
            if (history.length === 0) settleSuccessfully();
            else sendNextHistoryItem();
          }
        }

        if (
          event.type === "conversation.item.created" &&
          !settled &&
          pendingHistoryItemId &&
          event.item?.id === pendingHistoryItemId
        ) {
          pendingHistoryItemId = undefined;
          historyIndex += 1;
          sendNextHistoryItem();
        }

        if (event.type === "error" && !settled) {
          settleWithError(
            new Error(event.error?.message ?? "Qwen rejected the session."),
          );
        }

        this.handlers.onEvent(event);
      });

      this.socket.on("unexpected-response", (_request, response) => {
        settleWithError(
          new Error(
            `Qwen WebSocket handshake failed with HTTP ${response.statusCode}. Check the API key, workspace ID, region, and model permission.`,
          ),
        );
      });

      this.socket.on("error", (error) => {
        settleWithError(error);
      });

      this.socket.on("close", (code, reason) => {
        this.configured = false;
        clearConnectionTimeout();
        if (!settled) {
          settleWithError(
            new Error(
              `Qwen connection closed before it was ready (${code}: ${reason.toString() || "no reason"}).`,
            ),
          );
        }
        this.handlers.onClose(code, reason.toString());
      });
    });
  }

  public appendAudio(pcm16: Buffer): void {
    this.assertReady();
    this.send({
      type: "input_audio_buffer.append",
      audio: pcm16.toString("base64"),
    });
  }

  public commitAudioAndCreateResponse(): void {
    this.assertReady();
    this.send({ type: "input_audio_buffer.commit" });
    this.createResponse();
  }

  public createResponse(): void {
    this.assertReady();
    this.send({
      type: "response.create",
      response: { modalities: ["audio", "text"] },
    });
  }

  public clearAudio(): void {
    this.assertReady();
    this.send({ type: "input_audio_buffer.clear" });
  }

  public cancelResponse(): void {
    this.assertReady();
    this.send({ type: "response.cancel" });
  }

  public deleteConversationItem(itemId: string): void {
    this.assertReady();
    this.send({ type: "conversation.item.delete", item_id: itemId });
  }

  public createAssistantTextItem(input: {
    itemId: string;
    previousItemId?: string;
    text: string;
  }): void {
    this.createConversationTextItem({ ...input, role: "assistant" });
  }

  public createConversationTextItem(input: {
    itemId: string;
    previousItemId?: string;
    role: "user" | "assistant";
    text: string;
  }): void {
    this.assertReady();
    this.sendConversationTextItem(input);
  }

  private sendConversationTextItem(input: {
    itemId: string;
    previousItemId?: string;
    role: "user" | "assistant";
    text: string;
  }): void {
    this.send({
      type: "conversation.item.create",
      ...(input.previousItemId
        ? { previous_item_id: input.previousItemId }
        : {}),
      item: {
        id: input.itemId,
        type: "message",
        role: input.role,
        content: [
          {
            type: input.role === "user" ? "input_text" : "output_text",
            text: input.text,
          },
        ],
      },
    });
  }

  public close(): void {
    this.configured = false;
    if (!this.socket) return;

    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, "Browser session ended");
    } else if (this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.terminate();
    }
  }

  private assertReady(): void {
    if (!this.configured || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Qwen session is not ready for audio yet.");
    }
  }

  private send(payload: object): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Qwen WebSocket is not open.");
    }
    this.socket.send(JSON.stringify(payload));
  }
}
