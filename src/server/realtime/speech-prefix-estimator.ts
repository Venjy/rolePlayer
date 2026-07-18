const MAX_HISTORY_SAMPLES = 20;
const MIN_HISTORY_AUDIO_MS = 1_000;
const MIN_ESTIMATED_AUDIO_MS = 300;
const HISTORY_SMOOTHING_SECONDS = 2;
const SENTENCE_LOOKBACK_SECONDS = 1.5;

export type SpeechLanguage = "zh" | "en" | "mixed";
export type PrefixConfidence = "high" | "medium" | "low";
export type ReconciliationStrategy = "estimated_prefix" | "rollback";

interface SpeechToken {
  end: number;
  kind: "han" | "word";
}

interface TextAnalysis {
  tokens: SpeechToken[];
  language: SpeechLanguage;
  complex: boolean;
}

interface RateSample {
  rate: number;
}

export interface PrefixEstimateInput {
  transcript: string;
  generatedAudioMs: number;
  safePlayedMs: number;
  generationCompleted: boolean;
}

export interface PrefixEstimate {
  transcript: string;
  strategy: ReconciliationStrategy;
  confidence: PrefixConfidence;
  estimatedUnits: number;
  language: SpeechLanguage;
}

const speechTokenPattern =
  /\p{Script=Han}|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const hanPattern = /^\p{Script=Han}$/u;
const complexSpeechPattern =
  /\d|https?:\/\/|www\.|[@#$%€£¥￥]|\b[A-Z]{2,}\b/u;
const sentenceEndPattern = /[。！？.!?]/gu;

function analyzeText(text: string): TextAnalysis {
  const tokens: SpeechToken[] = [];
  let hanCount = 0;
  let wordCount = 0;

  for (const match of text.matchAll(speechTokenPattern)) {
    const value = match[0];
    const index = match.index;
    if (index === undefined) continue;
    const kind = hanPattern.test(value) ? "han" : "word";
    if (kind === "han") hanCount += 1;
    else wordCount += 1;
    tokens.push({ end: index + value.length, kind });
  }

  const language: SpeechLanguage =
    hanCount > 0 && wordCount > 0
      ? "mixed"
      : hanCount > 0
        ? "zh"
        : "en";

  return {
    tokens,
    language,
    complex: complexSpeechPattern.test(text),
  };
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) return undefined;
  if (sorted.length % 2 === 1) return value;
  const previous = sorted[middle - 1];
  return previous === undefined ? value : (previous + value) / 2;
}

function relativeMedianDeviation(values: number[], center: number): number {
  if (center <= 0) return Number.POSITIVE_INFINITY;
  const deviation = median(values.map((value) => Math.abs(value - center)));
  return deviation === undefined ? Number.POSITIVE_INFINITY : deviation / center;
}

function lastSentenceBoundary(
  text: string,
  from: number,
  to: number,
): number | undefined {
  const segment = text.slice(from, to);
  let boundary: number | undefined;
  for (const match of segment.matchAll(sentenceEndPattern)) {
    const index = match.index;
    if (index !== undefined) boundary = from + index + match[0].length;
  }
  return boundary;
}

function rollbackEstimate(language: SpeechLanguage): PrefixEstimate {
  return {
    transcript: "",
    strategy: "rollback",
    confidence: "low",
    estimatedUnits: 0,
    language,
  };
}

export class SpeechPrefixEstimator {
  private readonly history = new Map<SpeechLanguage, RateSample[]>();

  public addCompletedSample(transcript: string, audioDurationMs: number): void {
    if (!Number.isFinite(audioDurationMs) || audioDurationMs < MIN_HISTORY_AUDIO_MS) {
      return;
    }

    const analysis = analyzeText(transcript);
    if (analysis.tokens.length === 0) return;
    const rate = analysis.tokens.length / (audioDurationMs / 1_000);
    if (!Number.isFinite(rate) || rate <= 0) return;

    const samples = this.history.get(analysis.language) ?? [];
    samples.push({ rate });
    if (samples.length > MAX_HISTORY_SAMPLES) samples.shift();
    this.history.set(analysis.language, samples);
  }

  public estimate(input: PrefixEstimateInput): PrefixEstimate {
    const transcript = input.transcript.trim();
    const analysis = analyzeText(transcript);
    if (
      analysis.tokens.length === 0 ||
      !Number.isFinite(input.generatedAudioMs) ||
      input.generatedAudioMs <= 0 ||
      !Number.isFinite(input.safePlayedMs) ||
      input.safePlayedMs < MIN_ESTIMATED_AUDIO_MS
    ) {
      return rollbackEstimate(analysis.language);
    }

    const generatedSeconds = input.generatedAudioMs / 1_000;
    const safePlayedSeconds =
      Math.min(input.safePlayedMs, input.generatedAudioMs) / 1_000;
    const currentRate = analysis.tokens.length / generatedSeconds;
    const samples = this.history.get(analysis.language) ?? [];
    const rates = samples.map((sample) => sample.rate);
    const historicalRate = median(rates);

    let estimatedRate: number;
    let confidence: PrefixConfidence;

    if (input.generationCompleted) {
      estimatedRate = currentRate;
      confidence = analysis.complex || analysis.language === "mixed" ? "medium" : "high";
    } else if (historicalRate !== undefined) {
      estimatedRate =
        (analysis.tokens.length + HISTORY_SMOOTHING_SECONDS * historicalRate) /
        (generatedSeconds + HISTORY_SMOOTHING_SECONDS);
      const dispersion = relativeMedianDeviation(rates, historicalRate);
      confidence =
        samples.length >= 3 &&
        dispersion <= 0.25 &&
        !analysis.complex &&
        analysis.language !== "mixed"
          ? "medium"
          : "low";
    } else if (generatedSeconds >= 1.5 && analysis.tokens.length >= 4) {
      estimatedRate = currentRate;
      confidence = "low";
    } else {
      return rollbackEstimate(analysis.language);
    }

    if (confidence === "low") {
      return rollbackEstimate(analysis.language);
    }

    const estimatedUnits = Math.min(
      analysis.tokens.length,
      Math.floor(estimatedRate * safePlayedSeconds),
    );
    const conservativeRollback = analysis.language === "en" ? 1 : 2;
    const safeUnits = estimatedUnits - conservativeRollback;
    if (safeUnits <= 0) return rollbackEstimate(analysis.language);

    const token = analysis.tokens[safeUnits - 1];
    if (!token) return rollbackEstimate(analysis.language);
    let prefixEnd = token.end;

    const lookbackUnits = Math.max(
      2,
      Math.ceil(estimatedRate * SENTENCE_LOOKBACK_SECONDS),
    );
    const lookbackToken = analysis.tokens[Math.max(0, safeUnits - lookbackUnits)];
    const boundary = lastSentenceBoundary(
      transcript,
      lookbackToken?.end ?? 0,
      prefixEnd,
    );
    if (boundary !== undefined) prefixEnd = boundary;

    const prefix = transcript.slice(0, prefixEnd).trimEnd();
    if (!prefix) return rollbackEstimate(analysis.language);

    return {
      transcript: prefix,
      strategy: "estimated_prefix",
      confidence,
      estimatedUnits: safeUnits,
      language: analysis.language,
    };
  }
}
