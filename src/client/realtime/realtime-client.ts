import {
  serverMessageSchema,
  type ClientControlMessage,
  type QwenVoice,
  type ServerMessage,
} from "../../shared/realtime-protocol";

const CONNECTION_TIMEOUT_MS = 20_000;
const MAX_BUFFERED_AUDIO_BYTES = 256 * 1024;

export interface RealtimeClientHandlers {
  onMessage: (message: ServerMessage) => void;
  onAudio: (responseId: string, buffer: ArrayBuffer) => void;
  onClose: (event: CloseEvent) => void;
  onMalformedMessage: () => void;
}

export interface RealtimeSessionConfiguration {
  instructions: string;
  voice: QwenVoice;
  maxHistoryTurns: number;
}

export class RealtimeClient {
  private socket?: WebSocket;
  private activeAudioResponseId?: string;
  private readonly ignoredAudioResponseIds = new Set<string>();

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

      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error("Timed out while starting the realtime session."));
      }, CONNECTION_TIMEOUT_MS);

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
          this.handlers.onMalformedMessage();
          return;
        }

        let value: unknown;
        try {
          value = JSON.parse(event.data);
        } catch {
          this.handlers.onMalformedMessage();
          return;
        }

        const parsed = serverMessageSchema.safeParse(value);
        if (!parsed.success) {
          this.handlers.onMalformedMessage();
          return;
        }

        const message = parsed.data;
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
        this.handlers.onMessage(message);

        if (message.type === "session.ready" && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        }

        // Before session.ready there is no usable session to recover. Reject
        // immediately even when the gateway classifies the individual error as
        // recoverable for an already-established connection.
        if (message.type === "error" && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(message.message));
        }
      };

      socket.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error("Could not connect to the local realtime gateway."));
      };

      socket.onclose = (event) => {
        window.clearTimeout(timeout);
        if (!settled) {
          settled = true;
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

  public clearInput(): void {
    this.send({ type: "input.clear" });
  }

  public cancelResponse(): void {
    this.send({ type: "response.cancel" });
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
}
