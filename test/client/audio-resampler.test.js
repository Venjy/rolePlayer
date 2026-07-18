import { describe, expect, it } from "vitest";
import { AreaDownsampler } from "../../public/audio-resampler.js";

function createSine(sampleRate, seconds = 1) {
  return Float32Array.from(
    { length: sampleRate * seconds },
    (_, index) => Math.sin((2 * Math.PI * 440 * index) / sampleRate),
  );
}

function processInChunks(input, sourceRate, chunkSizes) {
  const downsampler = new AreaDownsampler(sourceRate, 16_000);
  const output = [];
  let offset = 0;
  let chunkIndex = 0;

  while (offset < input.length) {
    const size = chunkSizes[chunkIndex % chunkSizes.length];
    const end = Math.min(input.length, offset + size);
    output.push(...downsampler.process(input.slice(offset, end)));
    offset = end;
    chunkIndex += 1;
  }
  return output;
}

describe("AreaDownsampler", () => {
  it.each([44_100, 48_000])(
    "converts one second at %i Hz to approximately 16,000 samples",
    (sourceRate) => {
      const output = processInChunks(
        createSine(sourceRate),
        sourceRate,
        [128, 511, 73, 1_024],
      );
      expect(output.length).toBeGreaterThanOrEqual(15_999);
      expect(output.length).toBeLessThanOrEqual(16_000);
    },
  );

  it("produces the same stream regardless of input chunk boundaries", () => {
    const input = createSine(48_000);
    const oneChunk = processInChunks(input, 48_000, [input.length]);
    const manyChunks = processInChunks(input, 48_000, [17, 128, 997, 31]);

    expect(manyChunks).toHaveLength(oneChunk.length);
    for (let index = 0; index < oneChunk.length; index += 1) {
      expect(manyChunks[index]).toBeCloseTo(oneChunk[index], 6);
    }
  });
});
