import { createHash } from "node:crypto";

function normalize(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function hashContent(content: string): string {
  return createHash("sha256").update(normalize(content)).digest("hex");
}

export function findDuplicate(
  content: string,
  existingFiles: Map<string, string>
): string | null {
  const newHash = hashContent(content);

  for (const [filename, existingContent] of existingFiles) {
    if (hashContent(existingContent) === newHash) {
      return filename;
    }
  }

  return null;
}

// ─── near-duplicate detection (token overlap) ────────────────────────────────
// Exact-hash dedup misses "same fact, one word changed". A Jaccard similarity
// over ≥3-char tokens (Hermes uses the same trick for its learning-graph edges)
// catches those cheaply, with no semantic machinery. Used to WARN, never block.

function tokenSet(content: string): Set<string> {
  const tokens = content.toLowerCase().split(/[^a-z0-9$_]+/);
  return new Set(tokens.filter((t) => t.length >= 3));
}

export interface NearDuplicate {
  filename: string;
  similarity: number; // 0..1 Jaccard over token sets
}

export function findNearDuplicate(
  content: string,
  existingFiles: Map<string, string>,
  threshold = 0.7
): NearDuplicate | null {
  const newTokens = tokenSet(content);
  if (newTokens.size < 8) return null; // too little signal to judge

  let best: NearDuplicate | null = null;
  for (const [filename, existingContent] of existingFiles) {
    const other = tokenSet(existingContent);
    if (other.size === 0) continue;
    let shared = 0;
    for (const t of newTokens) if (other.has(t)) shared++;
    const union = newTokens.size + other.size - shared;
    const similarity = union > 0 ? shared / union : 0;
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { filename, similarity };
    }
  }
  return best;
}
