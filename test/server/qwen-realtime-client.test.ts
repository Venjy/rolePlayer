import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  QwenRealtimeClient,
  type QwenSocketFactory,
} from "../../src/server/realtime/qwen-realtime-client";

class FakeQwenSocket extends EventEmitter {
  public readyState: number = WebSocket.OPEN;
  public readonly sent: Array<Record<string, unknown>> = [];

  public send(raw: string): void {
    const event = JSON.parse(raw) as Record<string, unknown>;
    this.sent.push(event);
    if (event.type === "session.update") {
      queueMicrotask(() => {
        this.emit(
          "message",
          Buffer.from(JSON.stringify({ type: "session.updated", session: {} })),
        );
      });
    }
  }

  public close(): void {
    this.readyState = WebSocket.CLOSED;
    queueMicrotask(() => this.emit("close", 1000, Buffer.from("closed")));
  }

  public terminate(): void {
    this.close();
  }
}

describe("QwenRealtimeClient", () => {
  it("configures a manual session and sends audio before commit/create", async () => {
    const socket = new FakeQwenSocket();
    let authorizationHeader: string | undefined;
    const socketFactory: QwenSocketFactory = (_url, options) => {
      authorizationHeader = options.headers?.Authorization as string | undefined;
      queueMicrotask(() => {
        socket.emit(
          "message",
          Buffer.from(
            JSON.stringify({
              type: "session.created",
              session: { id: "sess_test" },
            }),
          ),
        );
      });
      return socket as unknown as WebSocket;
    };

    const onEvent = vi.fn();
    const client = new QwenRealtimeClient(
      {
        apiKey: "test-secret",
        endpoint: "ws://qwen.example/realtime",
        model: "qwen-audio-3.0-realtime-plus",
        workspaceId: "ws_test",
      },
      {
        onEvent,
        onClose: vi.fn(),
        onMalformedEvent: vi.fn(),
      },
      socketFactory,
    );

    await expect(
      client.connect({
        instructions: "Stay in character.",
        voice: "longanqian",
        maxHistoryTurns: 20,
      }),
    ).resolves.toBe("sess_test");

    client.appendAudio(Buffer.from([1, 0, 2, 0]));
    client.commitAudioAndCreateResponse();
    client.deleteConversationItem("item_old");
    client.createAssistantTextItem({
      itemId: "item_rebuilt",
      previousItemId: "item_user",
      text: "The part the user heard.",
    });

    expect(authorizationHeader).toBe("Bearer test-secret");
    expect(socket.sent.map((event) => event.type)).toEqual([
      "session.update",
      "input_audio_buffer.append",
      "input_audio_buffer.commit",
      "response.create",
      "conversation.item.delete",
      "conversation.item.create",
    ]);
    expect(socket.sent[0]).toMatchObject({
      session: {
        modalities: ["audio", "text"],
        input_audio_format: "pcm",
        output_audio_format: "pcm",
        turn_detection: null,
      },
    });
    expect(socket.sent.at(-1)).toMatchObject({
      previous_item_id: "item_user",
      item: {
        id: "item_rebuilt",
        role: "assistant",
        content: [
          { type: "output_text", text: "The part the user heard." },
        ],
      },
    });

    client.close();
  });
});
