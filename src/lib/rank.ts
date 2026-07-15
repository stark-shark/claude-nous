// Reciprocal Rank Fusion — a zero-LLM re-ranker for the cold tier.
//
// Fuses several orderings of the same candidate set (e.g. FTS5 BM25 relevance +
// recency) into one ranking. RRF is order-based, so it needs no score
// normalization across incommensurable signals. This runs BEFORE any Haiku
// query-expansion escalation, and the fused top-hit confidence decides whether
// escalation is even worth it (ladder.escalateBelow).
//
//   score(item) = Σ_rankers 1 / (k + rank_in_that_ranker)

export interface Fused<T> {
  item: T;
  score: number;
}

// `rankers` each return the candidate items sorted best-first. `keyOf` maps an
// item to a stable identity so the same item across rankers is fused.
export function reciprocalRankFusion<T>(
  items: T[],
  rankers: Array<(items: T[]) => T[]>,
  keyOf: (t: T) => string,
  k = 60
): Fused<T>[] {
  const scores = new Map<string, number>();
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(keyOf(item), item);

  for (const ranker of rankers) {
    const ordered = ranker(items);
    ordered.forEach((item, rank) => {
      const key = keyOf(item);
      scores.set(key, (scores.get(key) ?? 0) + 1 / (k + rank));
    });
  }

  return [...scores.entries()]
    .map(([key, score]) => ({ item: byKey.get(key) as T, score }))
    .sort((a, b) => b.score - a.score);
}

// Normalized 0..1 confidence of the top fused hit: its score over the maximum
// achievable (rank 0 in every ranker). Used to decide whether recall is strong
// enough to skip Haiku query expansion.
export function topConfidence(fused: Fused<{ }>[], rankerCount: number, k = 60): number {
  if (fused.length === 0) return 0;
  const max = rankerCount * (1 / k); // rank 0 in every ranker
  if (max <= 0) return 0;
  return Math.min(1, fused[0].score / max);
}
