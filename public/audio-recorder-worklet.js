import { AreaDownsampler } from "/audio-resampler.js";

const TARGET_SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = 1_600;

class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.pending = [];
    this.levelFrameCount = 0;
    this.levelSquareSum = 0;
    this.downsampler = new AreaDownsampler(sampleRate, TARGET_SAMPLE_RATE);

    this.port.onmessage = (event) => {
      const { type, requestId } = event.data ?? {};

      if (type === "start") {
        this.pending = [];
        this.levelFrameCount = 0;
        this.levelSquareSum = 0;
        this.downsampler.reset();
        this.recording = true;
      }

      if (type === "stop") {
        this.recording = false;
        this.flushPending();
        this.port.postMessage({ type: "stopped", requestId });
      }

      if (type === "cancel") {
        this.recording = false;
        this.pending = [];
        this.downsampler.reset();
        this.port.postMessage({ type: "stopped", requestId });
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output) {
      for (const channel of output) channel.fill(0);
    }

    if (!this.recording) return true;
    const channels = inputs[0];
    if (!channels || channels.length === 0 || channels[0].length === 0) {
      return true;
    }

    const frameCount = channels[0].length;
    const mono = new Float32Array(frameCount);

    for (let frame = 0; frame < frameCount; frame += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[frame] ?? 0;
      mono[frame] = sample / channels.length;
    }

    const downsampled = this.downsampler.process(mono);
    for (const sample of downsampled) {
      const clamped = Math.max(-1, Math.min(1, sample));
      this.pending.push(clamped);
      this.levelSquareSum += clamped * clamped;
      this.levelFrameCount += 1;

      if (this.pending.length >= CHUNK_SAMPLES) {
        this.emitPcm(this.pending.splice(0, CHUNK_SAMPLES));
      }

      if (this.levelFrameCount >= 800) {
        this.port.postMessage({
          type: "level",
          value: Math.sqrt(this.levelSquareSum / this.levelFrameCount),
        });
        this.levelFrameCount = 0;
        this.levelSquareSum = 0;
      }
    }

    return true;
  }

  flushPending() {
    if (this.pending.length > 0) {
      this.emitPcm(this.pending.splice(0));
    }
    this.port.postMessage({ type: "level", value: 0 });
  }

  emitPcm(samples) {
    const buffer = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buffer);

    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(index * 2, Math.round(value), true);
    }

    this.port.postMessage({ type: "audio", buffer }, [buffer]);
  }
}

registerProcessor("pcm16-recorder", PcmRecorderProcessor);
