import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  public emitJson(event: Record<string, unknown>): void {
    this.emit("message", Buffer.from(JSON.stringify(event)));
  }

  public close(): void {
    this.readyState = WebSocket.CLOSED;
    queueMicrotask(() => this.emit("close", 1000, Buffer.from("closed")));
  }

  public terminate(): void {
    this.close();
  }
}

const sessionConfiguration = {
  instructions: "Stay in character.",
  voice: "longanqian" as const,
  maxHistoryTurns: 20,
};

function createSocketFactory(
  socket: FakeQwenSocket,
  sessionId = "sess_test",
): QwenSocketFactory {
  return () => {
    queueMicrotask(() => {
      socket.emitJson({
        type: "session.created",
        session: { id: sessionId },
      });
    });
    return socket as unknown as WebSocket;
  };
}

function createClient(
  socket: FakeQwenSocket,
  socketFactory: QwenSocketFactory = createSocketFactory(socket),
): QwenRealtimeClient {
  return new QwenRealtimeClient(
    {
      apiKey: "test-secret",
      endpoint: "ws://qwen.example/realtime",
      model: "qwen-audio-3.0-realtime-plus",
      workspaceId: "ws_test",
    },
    {
      onEvent: vi.fn(),
      onClose: vi.fn(),
      onMalformedEvent: vi.fn(),
      onProtocolError: vi.fn(),
    },
    socketFactory,
  );
}

function historyItemId(event: Record<string, unknown>): string {
  return (event.item as { id: string }).id;
}

function sentEvent(
  socket: FakeQwenSocket,
  index: number,
): Record<string, unknown> {
  const event = socket.sent[index];
  if (!event) throw new Error(`Expected sent Qwen event at index ${index}.`);
  return event;
}

afterEach(() => {
  vi.useRealTimers();
});

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
        onProtocolError: vi.fn(),
      },
      socketFactory,
    );

    await expect(
      client.connect(sessionConfiguration),
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

  it("restores text history sequentially and waits for each matching ACK", async () => {
    const socket = new FakeQwenSocket();
    const client = createClient(socket);

    const connection = client.connect(sessionConfiguration, [
      { role: "user", text: "Hello." },
      { role: "assistant", text: "How can I help?" },
      { role: "user", text: "Tell me about the plan." },
    ]);

    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(2);
    });

    const firstCreate = sentEvent(socket, 1);
    expect(firstCreate).toMatchObject({
      type: "conversation.item.create",
      item: {
        role: "user",
        content: [{ type: "input_text", text: "Hello." }],
      },
    });
    expect(socket.sent.some((event) => event.type === "response.create")).toBe(
      false,
    );

    socket.emitJson({
      type: "conversation.item.created",
      item: { id: "an_unrelated_item" },
    });
    await Promise.resolve();
    expect(socket.sent).toHaveLength(2);

    socket.emitJson({
      type: "conversation.item.created",
      item: { id: historyItemId(firstCreate) },
    });
    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(3);
    });

    const secondCreate = sentEvent(socket, 2);
    expect(secondCreate).toMatchObject({
      type: "conversation.item.create",
      item: {
        role: "assistant",
        content: [{ type: "output_text", text: "How can I help?" }],
      },
    });

    socket.emitJson({
      type: "conversation.item.created",
      item: { id: historyItemId(secondCreate) },
    });
    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(4);
    });

    const thirdCreate = sentEvent(socket, 3);
    expect(thirdCreate).toMatchObject({
      type: "conversation.item.create",
      item: {
        role: "user",
        content: [
          { type: "input_text", text: "Tell me about the plan." },
        ],
      },
    });

    socket.emitJson({
      type: "conversation.item.created",
      item: { id: historyItemId(thirdCreate) },
    });

    await expect(connection).resolves.toBe("sess_test");
    expect(socket.sent.map((event) => event.type)).toEqual([
      "session.update",
      "conversation.item.create",
      "conversation.item.create",
      "conversation.item.create",
    ]);

    client.close();
  });

  it("rejects history restoration when Qwen returns an error", async () => {
    const socket = new FakeQwenSocket();
    const client = createClient(socket);
    const connection = client.connect(sessionConfiguration, [
      { role: "user", text: "Restore me." },
    ]);

    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(2);
    });

    socket.emitJson({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "History item was rejected.",
      },
    });

    await expect(connection).rejects.toThrow("History item was rejected.");
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(() => client.appendAudio(Buffer.from([1, 0]))).toThrow(
      "Qwen session is not ready",
    );
    client.close();
  });

  it("rejects when a history item ACK times out", async () => {
    vi.useFakeTimers();
    const socket = new FakeQwenSocket();
    const client = createClient(socket);
    const connection = client.connect(sessionConfiguration, [
      { role: "assistant", text: "An earlier answer." },
    ]);
    const rejection = expect(connection).rejects.toThrow(
      "Timed out while restoring Qwen conversation history item 1/1.",
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(socket.sent.map((event) => event.type)).toEqual([
      "session.update",
      "conversation.item.create",
    ]);

    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it("rejects a malformed known event during configuration without waiting for timeout", async () => {
    const socket = new FakeQwenSocket();
    const onMalformedEvent = vi.fn();
    const client = new QwenRealtimeClient(
      {
        apiKey: "test-secret",
        endpoint: "ws://qwen.example/realtime",
        model: "qwen-audio-3.0-realtime-plus",
        workspaceId: undefined,
      },
      {
        onEvent: vi.fn(),
        onClose: vi.fn(),
        onMalformedEvent,
        onProtocolError: vi.fn(),
      },
      () => socket as unknown as WebSocket,
    );
    const connection = client.connect(sessionConfiguration);

    socket.emitJson({ type: "session.created", session: {} });

    await expect(connection).rejects.toThrow(
      "session.created is missing session.id.",
    );
    expect(onMalformedEvent).toHaveBeenCalledWith(
      expect.any(String),
      "session.created is missing session.id.",
    );
  });

  it("reports malformed known runtime events but preserves unknown event compatibility", async () => {
    const socket = new FakeQwenSocket();
    const onEvent = vi.fn();
    const onProtocolError = vi.fn();
    const client = new QwenRealtimeClient(
      {
        apiKey: "test-secret",
        endpoint: "ws://qwen.example/realtime",
        model: "qwen-audio-3.0-realtime-plus",
        workspaceId: undefined,
      },
      {
        onEvent,
        onClose: vi.fn(),
        onMalformedEvent: vi.fn(),
        onProtocolError,
      },
      createSocketFactory(socket),
    );
    await client.connect(sessionConfiguration);

    socket.emitJson({ type: "provider.future_event", data: { version: 2 } });
    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "provider.future_event" }),
    );
    expect(onProtocolError).not.toHaveBeenCalled();

    socket.emitJson({
      type: "response.done",
      response: { id: "resp_broken" },
    });
    expect(onProtocolError).toHaveBeenCalledWith(
      "response.done has an invalid response.id or status.",
    );
    client.close();
  });
});
