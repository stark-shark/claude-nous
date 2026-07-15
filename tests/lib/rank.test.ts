import { describe, it, expect } from "vitest";
import { reciprocalRankFusion, topConfidence } from "../../src/lib/rank.js";

interface Doc {
  id: string;
  rel: number; // relevance order (0 best)
  ts: number; // recency (higher = newer)
}

describe("reciprocalRankFusion", () => {
  const docs: Doc[] = [
    { id: "a", rel: 0, ts: 1 },
    { id: "b", rel: 1, ts: 3 },
    { id: "c", rel: 2, ts: 2 },
  ];
  const rankers = [
    (items: Doc[]) => [...items].sort((x, y) => x.rel - y.rel),
    (items: Doc[]) => [...items].sort((x, y) => y.ts - x.ts),
  ];

  it("fuses two orderings and returns sorted-by-score", () => {
    const fused = reciprocalRankFusion(docs, rankers, (d) => d.id);
    expect(fused.map((f) => f.item.id)).toEqual(["b", "a", "c"]);
    // b wins: rank0 recency + rank1 relevance beats a (rank0 rel + rank2 recency)
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
  });

  it("topConfidence is 1.0 when the top item is rank 0 in every ranker", () => {
    const perfect: Doc[] = [
      { id: "x", rel: 0, ts: 9 },
      { id: "y", rel: 1, ts: 1 },
    ];
    const fused = reciprocalRankFusion(perfect, rankers, (d) => d.id);
    expect(topConfidence(fused, 2)).toBeCloseTo(1, 5);
  });

  it("empty input => 0 confidence", () => {
    expect(topConfidence([], 2)).toBe(0);
  });
});
