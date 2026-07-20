import {
  serverMessageSchema,
  type ClientControlMessage,
  type ServerMessage,
} from "../../shared/realtime-protocol";

const INITIAL_CONNECTION_TIMEOUT_MS = 20_000;
const HISTORY_ITEM_TIMEOUT_BUDGET_MS = 15_000;
const MAX_BUFFERED_AUDIO_BYTES = 256 * 1024;
const INPUT_CLEAR_TIMEOUT_MS = 7_000;

interface PendingInputClear {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: number;
}

export interface RealtimeClientHandlers {
  onMessage: (message: ServerMessage) => void;
  onAudio: (responseId: string, buffer: ArrayBuffer) => void;
  onClose: (event: CloseEvent) => void;
  onMalformedMessage: () => void;
}

export interface RealtimeSessionConfiguration {
  conversationId: number;
  maxHistoryTurns: number;
}

export class RealtimeServerError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly recoverable: boolean,
  ) {
    super(message);
    this.name = "RealtimeServerError";
  }
}

export class RealtimeClient {
  private socket?: WebSocket;
  private abortPendingConnection?: (error: Error) => void;
  private activeAudioResponseId?: string;
  private readonly ignoredAudioResponseIds = new Set<string>();
  private pendingInputClear?: PendingInputClear;

  public constructor(private readonly handlers: RealtimeClientHandlers) {}

  public connect(configuration: RealtimeSessionConfiguration): Promise<void> {
    if (this.socket) throw new Error("Realtime client is already connected.");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/realtime`;

    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.binaryType = "arraybuffer";

      // Node restores at most one user and one assistant item per requested
      // turn and gives each acknowledgement its own 15-second timeout. Mirror
      // that legal upper bound instead of aborting a still-valid restoration.
      const connectionTimeoutMs =
        INITIAL_CONNECTION_TIMEOUT_MS +
        configuration.maxHistoryTurns * 2 * HISTORY_ITEM_TIMEOUT_BUDGET_MS;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        const error = new Error("Timed out while starting the realtime session.");
        abortThisConnection(error);
        socket.close();
      }, connectionTimeoutMs);

      const clearPendingConnection = () => {
        if (
          abortThisConnection &&
          this.abortPendingConnection === abortThisConnection
        ) {
          this.abortPendingConnection = undefined;
        }
      };

      const abortThisConnection = (error: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        clearPendingConnection();
        reject(error);
      };
      this.abortPendingConnection = abortThisConnection;

      const handleMalformedMessage = () => {
        const error = new Error(
          "The realtime gateway returned a malformed message.",
        );
        this.handlers.onMalformedMessage();
        if (!settled) {
          abortThisConnection(error);
          socket.close(1002, "Malformed realtime message");
        }
      };

      socket.onopen = () => {
        this.send({
          type: "session.configure",
          ...configuration,
        });
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const responseId = this.activeAudioResponseId;
          if (!responseId || this.ignoredAudioResponseIds.has(responseId)) return;
          this.handlers.onAudio(responseId, event.data);
          return;
        }

        if (typeof event.data !== "string") {
          handleMalformedMessage();
          return;
        }

        let value: unknown;
        try {
          value = JSON.parse(event.data);
        } catch {
          handleMalformedMessage();
          return;
        }

        const parsed = serverMessageSchema.safeParse(value);
        if (!parsed.success) {
          handleMalformedMessage();
          return;
        }

        const message = parsed.data;
        if (message.type === "input.cleared") {
          this.settleInputClear();
        }
        if (message.type === "response.started") {
          this.activeAudioResponseId = message.responseId;
          this.ignoredAudioResponseIds.delete(message.responseId);
        }
        if (
          message.type === "response.done" &&
          message.responseId === this.activeAudioResponseId &&
          message.status !== "completed"
        ) {
          this.activeAudioResponseId = undefined;
        }
        if (
          message.type === "response.reconciled" &&
          message.responseId === this.activeAudioResponseId
        ) {
          this.activeAudioResponseId = undefined;
          this.ignoredAudioResponseIds.delete(message.responseId);
        }
        // Settle a startup failure before forwarding it. The handler may tear
        // down the socket synchronously; rejecting first preserves the server's
        // structured error instead of replacing it with a generic close error.
        if (message.type === "error" && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          clearPendingConnection();
          reject(
            new RealtimeServerError(
              message.code,
              message.message,
              message.recoverable,
            ),
          );
        }

        this.handlers.onMessage(message);

        if (message.type === "session.ready" && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          clearPendingConnection();
          resolve();
        }
      };

      socket.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        clearPendingConnection();
        reject(new Error("Could not connect to the local realtime gateway."));
      };

      socket.onclose = (event) => {
        window.clearTimeout(timeout);
        this.settleInputClear(
          new Error("The realtime connection closed before input was cleared."),
        );
        if (!settled) {
          settled = true;
          clearPendingConnection();
          reject(
            new Error(
              `Realtime connection closed before it was ready (${event.code}).`,
            ),
          );
        }
        this.handlers.onClose(event);
      };
    });
  }

  public startInput(): void {
    this.send({ type: "input.start" });
  }

  public commitInput(): void {
    this.send({ type: "input.commit" });
  }

  public clearInput(): Promise<void> {
    if (this.pendingInputClear) return this.pendingInputClear.promise;

    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const timeoutId = window.setTimeout(() => {
      this.settleInputClear(
        new Error("Timed out while clearing the cancelled recording."),
      );
    }, INPUT_CLEAR_TIMEOUT_MS);
    this.pendingInputClear = { promise, resolve, reject, timeoutId };
    try {
      this.send({ type: "input.clear" });
    } catch (error) {
      this.settleInputClear(
        error instanceof Error
          ? error
          : new Error("Could not clear the cancelled recording."),
      );
    }
    return promise;
  }

  public cancelResponse(): void {
    this.send({ type: "response.cancel" });
  }

  public retryResponse(): void {
    this.send({ type: "response.retry" });
  }

  public completePlayback(responseId: string): void {
    this.send({ type: "playback.completed", responseId });
    if (this.activeAudioResponseId === responseId) {
      this.activeAudioResponseId = undefined;
    }
  }

  public interruptPlayback(responseId: string, safePlayedMs: number): void {
    this.ignoredAudioResponseIds.add(responseId);
    const boundedSafePlayedMs = Number.isFinite(safePlayedMs)
      ? Math.min(10 * 60 * 1_000, Math.max(0, Math.floor(safePlayedMs)))
      : 0;
    this.send({
      type: "playback.interrupted",
      responseId,
      safePlayedMs: boundedSafePlayedMs,
    });
  }

  public sendAudio(buffer: ArrayBuffer): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime WebSocket is not open.");
    }
    if (this.socket.bufferedAmount > MAX_BUFFERED_AUDIO_BYTES) {
      throw new Error("The connection is too slow to stream microphone audio.");
    }
    this.socket.send(buffer);
  }

  public disconnect(): void {
    this.abortPendingConnection?.(
      new Error("Realtime connection closed before it was ready."),
    );
    this.abortPendingConnection = undefined;
    this.settleInputClear(
      new Error("The realtime connection closed before input was cleared."),
    );
    if (!this.socket) return;
    this.socket.onclose = null;
    this.socket.close(1000, "User ended session");
    this.socket = undefined;
    this.activeAudioResponseId = undefined;
    this.ignoredAudioResponseIds.clear();
  }

  private send(message: ClientControlMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime WebSocket is not open.");
    }
    this.socket.send(JSON.stringify(message));
  }

  private settleInputClear(error?: Error): void {
    const pending = this.pendingInputClear;
    if (!pending) return;
    this.pendingInputClear = undefined;
    window.clearTimeout(pending.timeoutId);
    if (error) pending.reject(error);
    else pending.resolve();
  }
}
