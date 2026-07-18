export class AreaDownsampler {
  constructor(sourceRate, targetRate) {
    this.sourceRate = sourceRate;
    this.targetRate = targetRate;
    this.ratio = sourceRate / targetRate;
    this.buffer = new Float32Array(0);
    this.position = 0;
  }

  reset() {
    this.buffer = new Float32Array(0);
    this.position = 0;
  }

  process(input) {
    if (input.length === 0) return [];

    const combined = new Float32Array(this.buffer.length + input.length);
    combined.set(this.buffer);
    combined.set(input, this.buffer.length);

    const output = [];
    if (this.ratio >= 1) {
      while (this.position + this.ratio <= combined.length) {
        const start = this.position;
        const end = start + this.ratio;
        let weightedSum = 0;
        let weight = 0;

        for (let index = Math.floor(start); index < Math.ceil(end); index += 1) {
          if (index >= combined.length) break;
          const overlap = Math.max(
            0,
            Math.min(end, index + 1) - Math.max(start, index),
          );
          weightedSum += combined[index] * overlap;
          weight += overlap;
        }

        output.push(weight > 0 ? weightedSum / weight : 0);
        this.position = end;
      }
    } else {
      while (this.position + 1 < combined.length) {
        const left = Math.floor(this.position);
        const fraction = this.position - left;
        const right = Math.min(left + 1, combined.length - 1);
        output.push(
          combined[left] * (1 - fraction) + combined[right] * fraction,
        );
        this.position += this.ratio;
      }
    }

    const consumed = Math.floor(this.position);
    this.buffer = combined.slice(consumed);
    this.position -= consumed;
    return output;
  }
}
