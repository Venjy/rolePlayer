/** Evenly distributes whole percentages and assigns rounding units at the end. */
export function distributeScoringWeights(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from({ length: count }, (_, index) =>
    index >= count - remainder ? base + 1 : base,
  );
}
