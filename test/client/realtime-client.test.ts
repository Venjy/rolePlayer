import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RealtimeClient,
  RealtimeServerError,
} from "../../src/client/realtime/realtime-client";

class FakeWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public static instances: FakeWebSocket[] = [];

  public binaryType = "blob";
  public bufferedAmount = 0;
  public readyState = FakeWebSocket.CONNECTING;
  public readonly sent: unknown[] = [];
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;

  public constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  public open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  public receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  public send(payload: unknown): void {
    this.sent.push(payload);
  }

  public close(code = 1000, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

function createClient() {
  return new RealtimeClient({
    onMessage: vi.fn(),
    onAudio: vi.fn(),
    onClose: vi.fn(),
    onMalformedMessage: vi.fn(),
  });
}

describe("RealtimeClient connection lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:5173" },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("allows the server's per-item restoration budget before timing out", async () => {
    const client = createClient();
    const connection = client.connect({
      conversationId: "conversation_1",
      maxHistoryTurns: 2,
    });
    const rejection = expect(connection).rejects.toThrow(
      "Timed out while starting the realtime session.",
    );
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.open();

    await vi.advanceTimersByTimeAsync(79_999);
    expect(socket?.readyState).toBe(FakeWebSocket.OPEN);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(socket?.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("clears the startup timer after session.ready", async () => {
    const client = createClient();
    const connection = client.connect({
      conversationId: "conversation_1",
      maxHistoryTurns: 20,
    });
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.receive({
      type: "session.ready",
      sessionId: "session_1",
      conversationId: "conversation_1",
    });

    await connection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards but rejects an error received before session.ready", async () => {
    const onMessage = vi.fn();
    const client: RealtimeClient = new RealtimeClient({
      onMessage: (message) => {
        onMessage(message);
        // App startup error handling tears down the partial runtime from this
        // callback. The original structured error must survive that close.
        if (message.type === "error") client.disconnect();
      },
      onAudio: vi.fn(),
      onClose: vi.fn(),
      onMalformedMessage: vi.fn(),
    });
    const connection = client.connect({
      conversationId: "conversation_1",
      maxHistoryTurns: 20,
    });
    const rejection = connection.catch((error: unknown) => error);
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.receive({
      type: "error",
      code: "SESSION_CONFIGURATION_FAILED",
      message: "The realtime session could not be configured.",
      recoverable: false,
    });

    const error = await rejection;
    expect(error).toBeInstanceOf(RealtimeServerError);
    expect(error).toMatchObject({
      code: "SESSION_CONFIGURATION_FAILED",
      message: "The realtime session could not be configured.",
      recoverable: false,
    });
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        code: "SESSION_CONFIGURATION_FAILED",
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards an active-session error without reopening startup settlement", async () => {
    const onMessage = vi.fn();
    const client = new RealtimeClient({
      onMessage,
      onAudio: vi.fn(),
      onClose: vi.fn(),
      onMalformedMessage: vi.fn(),
    });
    const connection = client.connect({
      conversationId: "conversation_1",
      maxHistoryTurns: 20,
    });
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.receive({
      type: "session.ready",
      sessionId: "session_1",
      conversationId: "conversation_1",
    });
    await connection;

    socket?.receive({
      type: "error",
      code: "RECORDING_TOO_SHORT",
      message: "Please speak for at least 100 ms before submitting.",
      recoverable: true,
    });

    expect(onMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "error",
        code: "RECORDING_TOO_SHORT",
      }),
    );
    expect(socket?.readyState).toBe(FakeWebSocket.OPEN);
  });

  it("rejects immediately and clears the timer when disconnected before ready", async () => {
    const client = createClient();
    const connection = client.connect({
      conversationId: "conversation_1",
      maxHistoryTurns: 50,
    });
    const rejection = expect(connection).rejects.toThrow(
      "Realtime connection closed before it was ready.",
    );
    const socket = FakeWebSocket.instances[0];
    socket?.open();

    client.disconnect();

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(socket?.readyState).toBe(FakeWebSocket.CLOSED);
  });
});
