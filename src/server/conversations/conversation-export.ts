import { Mp3Encoder } from "@breezystack/lamejs";
import { strToU8, zipSync } from "fflate";
import type {
  ConversationDetail,
  ConversationDownloadFormat,
} from "../../shared/conversation-history";
import type { ConversationAudioSegment } from "./conversation-repository";

const EXPORT_SAMPLE_RATE = 24_000;
const MP3_BITRATE_KBPS = 64;
const MP3_BLOCK_SAMPLES = 1_152;
const LEADING_SILENCE_MS = 180;
const BETWEEN_TURNS_SILENCE_MS = 360;
const TRAILING_SILENCE_MS = 240;
const EDGE_FADE_MS = 5;
const MAX_EXPORT_SOURCE_PCM_BYTES = 64 * 1024 * 1024;
const LOUDNESS_FRAME_MS = 20;
const ACTIVE_SPEECH_THRESHOLD_DBFS = -45;
const TARGET_ACTIVE_SPEECH_DBFS = -20;
const MAX_GAIN_DB = 12;
const MAX_ATTENUATION_DB = 12;
const PEAK_CEILING_DBFS = -1;
const MIN_ACTIVE_SPEECH_MS = 80;

const DIFFICULTY_LABELS = {
  easy: { en: "Easy", zh: "简单" },
  medium: { en: "Medium", zh: "中等" },
  hard: { en: "Hard", zh: "困难" },
} as const;

export class ConversationAudioUnavailableError extends Error {
  public constructor() {
    super(
      "A complete audio recording is unavailable for this conversation. Existing text-only history cannot be reconstructed as audio.",
    );
    this.name = "ConversationAudioUnavailableError";
  }
}

export class ConversationAudioTooLargeError extends Error {
  public constructor() {
    super("This conversation is too large to encode as a single MP3 file.");
    this.name = "ConversationAudioTooLargeError";
  }
}

export interface ConversationDownload {
  body: Buffer;
  contentType: string;
  filename: string;
}

export function createConversationDownload(
  conversation: ConversationDetail,
  audioSegments: readonly ConversationAudioSegment[],
  format: ConversationDownloadFormat,
): ConversationDownload {
  const basename = `conversation-${conversation.id}`;
  const transcript = createConversationTranscript(conversation);

  if (format === "text") {
    return {
      body: Buffer.from(transcript, "utf8"),
      contentType: "text/plain; charset=utf-8",
      filename: `${basename}.txt`,
    };
  }

  assertCompleteAudio(conversation, audioSegments);
  const mp3 = encodeConversationMp3(audioSegments);
  if (format === "audio") {
    return {
      body: mp3,
      contentType: "audio/mpeg",
      filename: `${basename}.mp3`,
    };
  }

  const transcriptFilename = `${basename}.txt`;
  const audioFilename = `${basename}.mp3`;
  return {
    body: Buffer.from(
      zipSync(
        {
          [transcriptFilename]: strToU8(transcript),
          [audioFilename]: new Uint8Array(mp3),
        },
        { level: 0 },
      ),
    ),
    contentType: "application/zip",
    filename: `${basename}.zip`,
  };
}

export function createConversationTranscript(
  conversation: ConversationDetail,
): string {
  const chinese = conversation.locale === "zh";
  const locale = chinese ? "zh-CN" : "en-US";
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Shanghai",
  });
  const lines = chinese
    ? [
        `会话 #${conversation.id}`,
        `场景：${conversation.scenarioName}`,
        `角色：${conversation.personaName}`,
        `难度：${DIFFICULTY_LABELS[conversation.difficulty].zh}`,
        `开始时间：${dateFormatter.format(new Date(conversation.createdAt))}`,
        "",
        "对话记录",
        "--------",
      ]
    : [
        `Conversation #${conversation.id}`,
        `Scenario: ${conversation.scenarioName}`,
        `Role: ${conversation.personaName}`,
        `Difficulty: ${DIFFICULTY_LABELS[conversation.difficulty].en}`,
        `Started: ${dateFormatter.format(new Date(conversation.createdAt))}`,
        "",
        "Transcript",
        "----------",
      ];

  if (conversation.messages.length === 0) {
    lines.push(chinese ? "（暂无对话）" : "(No messages yet)");
  } else {
    for (const message of conversation.messages) {
      const speaker =
        message.role === "user"
          ? chinese
            ? "你"
            : "You"
          : conversation.personaName;
      const interrupted = message.interrupted
        ? chinese
          ? "（已打断）"
          : " (interrupted)"
        : "";
      const timestamp = dateFormatter.format(new Date(message.createdAt));
      lines.push(`[${timestamp}] ${speaker}${interrupted}: ${message.text}`);
    }
  }

  // The BOM keeps Simplified Chinese readable in common desktop text editors.
  return `\uFEFF${lines.join("\n")}\n`;
}

export function encodeConversationMp3(
  audioSegments: readonly ConversationAudioSegment[],
): Buffer {
  const sourceBytes = audioSegments.reduce(
    (total, segment) => total + segment.pcm.length,
    0,
  );
  if (sourceBytes === 0) throw new ConversationAudioUnavailableError();
  if (sourceBytes > MAX_EXPORT_SOURCE_PCM_BYTES) {
    throw new ConversationAudioTooLargeError();
  }

  const encoder = new Mp3Encoder(1, EXPORT_SAMPLE_RATE, MP3_BITRATE_KBPS);
  const chunks: Buffer[] = [];
  encodeMp3Samples(
    encoder,
    new Int16Array(millisecondsToSamples(LEADING_SILENCE_MS)),
    chunks,
  );
  for (const [index, segment] of audioSegments.entries()) {
    const samples = resamplePcm16(
      decodePcm16Le(segment.pcm),
      segment.sampleRate,
    );
    normalizeSpeechLoudness(samples, EXPORT_SAMPLE_RATE);
    applyEdgeFade(samples);
    encodeMp3Samples(encoder, samples, chunks);
    if (index < audioSegments.length - 1) {
      encodeMp3Samples(
        encoder,
        new Int16Array(millisecondsToSamples(BETWEEN_TURNS_SILENCE_MS)),
        chunks,
      );
    }
  }
  encodeMp3Samples(
    encoder,
    new Int16Array(millisecondsToSamples(TRAILING_SILENCE_MS)),
    chunks,
  );
  const finalChunk = encoder.flush();
  if (finalChunk.length > 0) chunks.push(Buffer.from(finalChunk));
  return Buffer.concat(chunks);
}

/**
 * Applies one conservative gain value to a finalized turn. Measuring only
 * frames above the speech threshold prevents leading/trailing silence from
 * making quiet recordings look even quieter. Gain and attenuation are both
 * bounded, and the peak ceiling prevents newly introduced clipping.
 *
 * The function intentionally avoids fast per-frame gain changes: those would
 * pump the noise floor between words and make two speakers sound unnatural.
 * It returns the applied gain in dB to keep the behavior directly testable.
 */
export function normalizeSpeechLoudness(
  samples: Int16Array,
  sampleRate: number,
): number {
  if (samples.length === 0 || sampleRate <= 0) return 0;

  const frameSamples = Math.max(
    1,
    Math.round((sampleRate * LOUDNESS_FRAME_MS) / 1_000),
  );
  let activeSquareSum = 0;
  let activeSampleCount = 0;
  let activeFrameCount = 0;

  for (let start = 0; start < samples.length; start += frameSamples) {
    const end = Math.min(start + frameSamples, samples.length);
    let frameSquareSum = 0;
    for (let index = start; index < end; index += 1) {
      const sample = samples[index] ?? 0;
      frameSquareSum += sample * sample;
    }

    const frameLength = end - start;
    const frameRms = Math.sqrt(frameSquareSum / frameLength);
    if (amplitudeToDbfs(frameRms) < ACTIVE_SPEECH_THRESHOLD_DBFS) continue;
    activeSquareSum += frameSquareSum;
    activeSampleCount += frameLength;
    activeFrameCount += 1;
  }

  const minimumActiveFrames = Math.ceil(
    MIN_ACTIVE_SPEECH_MS / LOUDNESS_FRAME_MS,
  );
  if (activeFrameCount < minimumActiveFrames || activeSampleCount === 0) {
    return 0;
  }

  const activeRms = Math.sqrt(activeSquareSum / activeSampleCount);
  const desiredGainDb =
    TARGET_ACTIVE_SPEECH_DBFS - amplitudeToDbfs(activeRms);
  const boundedGainDb = Math.max(
    -MAX_ATTENUATION_DB,
    Math.min(MAX_GAIN_DB, desiredGainDb),
  );
  const appliedGainDb = boundedGainDb;
  const gain = 10 ** (appliedGainDb / 20);
  const peakCeiling = Math.round(
    0x8000 * 10 ** (PEAK_CEILING_DBFS / 20),
  );

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.max(
      -peakCeiling,
      Math.min(peakCeiling, Math.round((samples[index] ?? 0) * gain)),
    );
  }
  return appliedGainDb;
}

function assertCompleteAudio(
  conversation: ConversationDetail,
  segments: readonly ConversationAudioSegment[],
): void {
  if (
    !conversation.audioAvailable ||
    conversation.messages.length === 0 ||
    segments.length !== conversation.messages.length
  ) {
    throw new ConversationAudioUnavailableError();
  }
}

function decodePcm16Le(pcm: Buffer): Int16Array {
  const samples = new Int16Array(pcm.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = pcm.readInt16LE(index * 2);
  }
  return samples;
}

function resamplePcm16(
  source: Int16Array,
  sourceSampleRate: 16_000 | 24_000,
): Int16Array {
  if (sourceSampleRate === EXPORT_SAMPLE_RATE) return source;
  const targetLength = Math.max(
    1,
    Math.round((source.length * EXPORT_SAMPLE_RATE) / sourceSampleRate),
  );
  const target = new Int16Array(targetLength);
  const ratio = sourceSampleRate / EXPORT_SAMPLE_RATE;
  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.min(Math.floor(sourcePosition), source.length - 1);
    const rightIndex = Math.min(leftIndex + 1, source.length - 1);
    const fraction = sourcePosition - leftIndex;
    target[index] = Math.round(
      source[leftIndex]! * (1 - fraction) + source[rightIndex]! * fraction,
    );
  }
  return target;
}

function applyEdgeFade(samples: Int16Array): void {
  const fadeSamples = Math.min(
    millisecondsToSamples(EDGE_FADE_MS),
    Math.floor(samples.length / 2),
  );
  for (let index = 0; index < samples.length; index += 1) {
    let gain = 1;
    if (fadeSamples > 0 && index < fadeSamples) gain = index / fadeSamples;
    if (fadeSamples > 0 && index >= samples.length - fadeSamples) {
      gain = Math.min(gain, (samples.length - index - 1) / fadeSamples);
    }
    samples[index] = Math.round(samples[index]! * Math.max(0, gain));
  }
}

function encodeMp3Samples(
  encoder: Mp3Encoder,
  samples: Int16Array,
  chunks: Buffer[],
): void {
  for (let start = 0; start < samples.length; start += MP3_BLOCK_SAMPLES) {
    const encoded = encoder.encodeBuffer(
      samples.subarray(start, start + MP3_BLOCK_SAMPLES),
    );
    if (encoded.length > 0) chunks.push(Buffer.from(encoded));
  }
}

function millisecondsToSamples(milliseconds: number): number {
  return Math.round((milliseconds * EXPORT_SAMPLE_RATE) / 1_000);
}

function amplitudeToDbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude / 0x8000) : -Infinity;
}
