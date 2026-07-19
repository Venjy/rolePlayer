import { OUTPUT_SAMPLE_RATE } from "../../shared/realtime-protocol";
import { calculateSafePlayedMs } from "./playback-timing";

const STOP_ACK_TIMEOUT_MS = 2_000;
const PLAYBACK_LEAD_SECONDS = 0.08;
const MICROPHONE_SETTLE_MS = 350;
const CAPTURE_HIGH_PASS_HZ = 80;

interface WorkletAudioMessage {
  type: "audio";
  buffer: ArrayBuffer;
}

interface WorkletLevelMessage {
  type: "level";
  value: number;
}

interface WorkletStoppedMessage {
  type: "stopped";
  requestId: number;
}

type WorkletMessage =
  | WorkletAudioMessage
  | WorkletLevelMessage
  | WorkletStoppedMessage;

export interface BrowserAudioEngineHandlers {
  onInputPcm: (buffer: ArrayBuffer) => void;
  onInputLevel: (level: number) => void;
  onPlaybackStarted: (responseId: string) => void;
  onPlaybackDrained: (responseId: string) => void;
  onError: (error: Error) => void;
  onCaptureSettings?: (settings: BrowserCaptureSettings) => void;
}

export interface BrowserCaptureSettings {
  sampleRate?: number;
  channelCount?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

interface ScheduledPlaybackSource {
  source: AudioBufferSourceNode;
  startAt: number;
  endAt: number;
}

interface ResponsePlayback {
  responseId: string;
  sources: Map<AudioBufferSourceNode, ScheduledPlaybackSource>;
  completedSeconds: number;
  totalAudioSeconds: number;
  generationDone: boolean;
  drainNotified: boolean;
  audibilityCompromised: boolean;
}

export interface PlaybackInterruption {
  responseId: string;
  safePlayedMs: number;
}

export class BrowserAudioEngine {
  private context?: AudioContext;
  private stream?: MediaStream;
  private captureSource?: MediaStreamAudioSourceNode;
  private captureFilter?: BiquadFilterNode;
  private captureNode?: AudioWorkletNode;
  private monitorGain?: GainNode;
  private playbackGain?: GainNode;
  private nextPlaybackTime = 0;
  private playback?: ResponsePlayback;
  private readonly discardedResponseIds = new Set<string>();
  private requestSequence = 0;
  private stopRequests = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timeout: number }
  >();
  private prepared = false;
  private captureReadyAt = 0;
  private capturing = false;
  private playbackActive = false;

  public constructor(private readonly handlers: BrowserAudioEngineHandlers) {}

  public async prepare(): Promise<void> {
    if (this.prepared) {
      await this.context?.resume();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support microphone capture.");
    }

    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
          // Browser AGC can change gain substantially while its estimator is
          // settling. Keep capture deterministic and normalize persisted
          // speech offline when producing a downloadable conversation.
          autoGainControl: false,
          sampleRate: { ideal: 16_000 },
        },
      });

      await context.audioWorklet.addModule("/audio-recorder-worklet.js");
      this.captureSource = context.createMediaStreamSource(this.stream);
      this.captureFilter = context.createBiquadFilter();
      this.captureFilter.type = "highpass";
      this.captureFilter.frequency.value = CAPTURE_HIGH_PASS_HZ;
      this.captureFilter.Q.value = Math.SQRT1_2;
      this.captureNode = new AudioWorkletNode(context, "pcm16-recorder", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.monitorGain = context.createGain();
      this.monitorGain.gain.value = 0;
      this.playbackGain = context.createGain();

      this.captureNode.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        this.handleWorkletMessage(event.data);
      };
      this.captureNode.onprocessorerror = () => {
        this.handlers.onError(new Error("The microphone audio processor stopped."));
      };

      this.captureSource.connect(this.captureFilter).connect(this.captureNode);
      this.captureNode.connect(this.monitorGain).connect(context.destination);
      this.playbackGain.connect(context.destination);
      await context.resume();
      this.captureReadyAt = performance.now() + MICROPHONE_SETTLE_MS;
      this.handlers.onCaptureSettings?.(
        sanitizeCaptureSettings(this.stream.getAudioTracks()[0]?.getSettings()),
      );
      this.prepared = true;
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  public async startCapture(): Promise<void> {
    if (!this.captureNode || !this.context || !this.prepared) {
      throw new Error("Audio engine is not prepared.");
    }
    await this.context.resume();
    const settleRemaining = this.captureReadyAt - performance.now();
    if (settleRemaining > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, settleRemaining);
      });
    }
    if (!this.captureNode || !this.context || !this.prepared) {
      throw new Error("Audio engine was disposed while the microphone settled.");
    }
    this.capturing = true;
    this.captureNode.port.postMessage({ type: "start" });
  }

  public finishCapture(): Promise<void> {
    return this.stopCapture("stop");
  }

  public cancelCapture(): Promise<void> {
    return this.stopCapture("cancel");
  }

  public async enqueuePcm24(
    responseId: string,
    buffer: ArrayBuffer,
  ): Promise<void> {
    const context = this.context;
    const gain = this.playbackGain;
    if (!context || !gain || buffer.byteLength === 0) return;

    await context.resume();
    if (this.discardedResponseIds.has(responseId)) return;
    if (this.playback && this.playback.responseId !== responseId) {
      throw new Error("Received overlapping realtime audio responses.");
    }

    const playback =
      this.playback ??
      {
        responseId,
        sources: new Map<AudioBufferSourceNode, ScheduledPlaybackSource>(),
        completedSeconds: 0,
        totalAudioSeconds: 0,
        generationDone: false,
        drainNotified: false,
        audibilityCompromised: gain.gain.value <= 0,
      };
    this.playback = playback;

    const sampleCount = Math.floor(buffer.byteLength / 2);
    const audioBuffer = context.createBuffer(1, sampleCount, OUTPUT_SAMPLE_RATE);
    const samples = audioBuffer.getChannelData(0);
    const view = new DataView(buffer);

    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 0x8000;
    }

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gain);

    const startAt = Math.max(
      this.nextPlaybackTime,
      context.currentTime + PLAYBACK_LEAD_SECONDS,
    );
    const endAt = startAt + audioBuffer.duration;
    this.nextPlaybackTime = endAt;
    playback.totalAudioSeconds += audioBuffer.duration;
    playback.drainNotified = false;
    playback.sources.set(source, { source, startAt, endAt });

    if (!this.playbackActive) {
      this.playbackActive = true;
      this.handlers.onPlaybackStarted(responseId);
    }

    source.onended = () => {
      const current = this.playback;
      const scheduled = current?.sources.get(source);
      if (!current || current.responseId !== responseId || !scheduled) return;

      current.sources.delete(source);
      current.completedSeconds += scheduled.endAt - scheduled.startAt;
      source.disconnect();
      if (current.sources.size === 0) {
        this.playbackActive = false;
        this.nextPlaybackTime = 0;
        this.notifyPlaybackDrainedIfReady(current);
      }
    };

    source.start(startAt);
  }

  public markResponseDone(responseId: string): void {
    const playback =
      this.playback ??
      {
        responseId,
        sources: new Map<AudioBufferSourceNode, ScheduledPlaybackSource>(),
        completedSeconds: 0,
        totalAudioSeconds: 0,
        generationDone: false,
        drainNotified: false,
        audibilityCompromised: this.playbackGain?.gain.value === 0,
      };

    if (playback.responseId !== responseId) return;
    this.playback = playback;
    playback.generationDone = true;
    this.notifyPlaybackDrainedIfReady(playback);
  }

  public interruptPlayback(responseId: string): PlaybackInterruption {
    this.discardedResponseIds.add(responseId);
    const playback = this.playback;
    const context = this.context;
    if (!playback || playback.responseId !== responseId || !context) {
      return { responseId, safePlayedMs: 0 };
    }

    const contextWithOutputLatency = context as AudioContext & {
      outputLatency?: number;
    };
    const outputLatency =
      contextWithOutputLatency.outputLatency ?? context.baseLatency ?? 0;
    const safePlayedMs = calculateSafePlayedMs({
      completedSeconds: playback.completedSeconds,
      totalAudioSeconds: playback.totalAudioSeconds,
      activeIntervals: [...playback.sources.values()],
      currentTime: context.currentTime,
      outputLatencySeconds: outputLatency,
      audibilityCompromised: playback.audibilityCompromised,
    });

    this.stopPlaybackSources(playback);
    this.playback = undefined;
    this.playbackActive = false;
    this.nextPlaybackTime = 0;

    return {
      responseId,
      safePlayedMs,
    };
  }

  public finalizePlayback(responseId: string): void {
    if (
      this.playback?.responseId === responseId &&
      this.playback.sources.size === 0
    ) {
      this.playback = undefined;
    }
  }

  public clearPlayback(): void {
    if (this.playback) {
      this.discardedResponseIds.add(this.playback.responseId);
      this.stopPlaybackSources(this.playback);
    }
    this.playback = undefined;
    this.playbackActive = false;
    this.nextPlaybackTime = 0;
  }

  public setVolume(volume: number): void {
    if (this.playbackGain) {
      const nextVolume = Math.max(0, Math.min(1, volume));
      this.playbackGain.gain.value = nextVolume;
      if (nextVolume === 0 && this.playback) {
        this.playback.audibilityCompromised = true;
      }
    }
  }

  public async dispose(): Promise<void> {
    this.clearPlayback();
    this.capturing = false;

    for (const pending of this.stopRequests.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("Audio engine was disposed."));
    }
    this.stopRequests.clear();

    this.captureSource?.disconnect();
    this.captureFilter?.disconnect();
    this.captureNode?.disconnect();
    this.monitorGain?.disconnect();
    this.playbackGain?.disconnect();
    this.captureSource = undefined;
    this.captureFilter = undefined;
    this.captureNode = undefined;
    this.monitorGain = undefined;
    this.playbackGain = undefined;

    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;

    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }
    this.context = undefined;
    this.prepared = false;
    this.captureReadyAt = 0;
    this.discardedResponseIds.clear();
  }

  private stopCapture(type: "stop" | "cancel"): Promise<void> {
    if (!this.captureNode || !this.capturing) return Promise.resolve();
    this.capturing = false;
    const requestId = ++this.requestSequence;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.stopRequests.delete(requestId);
        reject(new Error("Timed out while flushing microphone audio."));
      }, STOP_ACK_TIMEOUT_MS);

      this.stopRequests.set(requestId, { resolve, reject, timeout });
      this.captureNode?.port.postMessage({ type, requestId });
    });
  }

  private handleWorkletMessage(message: WorkletMessage): void {
    if (message.type === "audio") {
      this.handlers.onInputPcm(message.buffer);
      return;
    }

    if (message.type === "level") {
      this.handlers.onInputLevel(message.value);
      return;
    }

    const pending = this.stopRequests.get(message.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.stopRequests.delete(message.requestId);
    pending.resolve();
  }

  private notifyPlaybackDrainedIfReady(playback: ResponsePlayback): void {
    if (
      playback.generationDone &&
      playback.sources.size === 0 &&
      !playback.drainNotified
    ) {
      playback.drainNotified = true;
      this.handlers.onPlaybackDrained(playback.responseId);
    }
  }

  private stopPlaybackSources(playback: ResponsePlayback): void {
    for (const scheduled of playback.sources.values()) {
      scheduled.source.onended = null;
      try {
        scheduled.source.stop();
      } catch {
        // A source that already ended can throw; it is safe to ignore.
      }
      scheduled.source.disconnect();
    }
    playback.sources.clear();
  }
}

function sanitizeCaptureSettings(
  settings: MediaTrackSettings | undefined,
): BrowserCaptureSettings {
  if (!settings) return {};
  return {
    ...(typeof settings.sampleRate === "number"
      ? { sampleRate: settings.sampleRate }
      : {}),
    ...(typeof settings.channelCount === "number"
      ? { channelCount: settings.channelCount }
      : {}),
    ...(typeof settings.echoCancellation === "boolean"
      ? { echoCancellation: settings.echoCancellation }
      : {}),
    ...(typeof settings.noiseSuppression === "boolean"
      ? { noiseSuppression: settings.noiseSuppression }
      : {}),
    ...(typeof settings.autoGainControl === "boolean"
      ? { autoGainControl: settings.autoGainControl }
      : {}),
  };
}
