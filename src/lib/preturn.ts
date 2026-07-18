import { type Db } from "./db.js";
import type { NousConfig } from "./config.js";
import { sanitizeFtsQuery } from "./fts-query.js";
import { reciprocalRankFusion } from "./rank.js";

// Pre-turn recall injection — the push half of the recall ladder.
//
// Both Nous and Hermes are otherwise pull-only for episodic memory: the model
// must *decide* to search, so recall quality is bounded by tool-use judgment.
// This runs LLM-free on every UserPromptSubmit: salient prompt terms → FTS +
// RRF over past sessions → 2-3 one-line reminders injected as context. The
// model is reminded by default and can pull detail with nous_search.
//
// Cost: one CLI spawn + a few SQLite queries per prompt (milliseconds, zero
// tokens spent on retrieval).

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "has", "had",
  "not", "you", "your", "can", "could", "should", "would", "will", "shall",
  "was", "were", "are", "been", "being", "but", "they", "them", "their",
  "then", "than", "there", "here", "what", "when", "where", "which", "who",
  "how", "why", "all", "any", "each", "into", "onto", "out", "our", "ours",
  "its", "it's", "also", "just", "only", "very", "more", "most", "some",
  "such", "make", "made", "take", "look", "let", "lets", "let's", "please",
  "want", "need", "like", "get", "got", "use", "used", "using", "does", "did",
  "don't", "doesn't", "didn't", "now", "new", "one", "two", "way", "about",
  "after", "before", "between", "over", "under", "again", "still", "back",
]);

// Salient search terms from a prompt: identifiers and content words, deduped,
// order-preserving. Keeps $shortcodes and dotted/slashed identifiers intact
// (sanitizeFtsQuery auto-quotes those downstream).
export function extractTerms(prompt: string, max = 12): string[] {
  const raw = prompt.toLowerCase().split(/[^a-z0-9$._/-]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let t of raw) {
    t = t.replace(/^[._/-]+|[._/-]+$/g, "");
    if (t.length < 3 || t.length > 40) continue;
    if (STOPWORDS.has(t) || /^\d+$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const HIDDEN_SOURCES = new Set(["subagent", "tool"]);
const DEMOTED_SOURCES = new Set(["cron"]);

interface PreturnHit {
  mid: number;
  sid: string;
  project: string;
  ts: string;
  snip: string;
  rank: number;
  source: string;
  summary: string | null;
  ended: string | null;
}

function clip(s: string, max: number): string {
  const one = (s || "").replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

function queryHits(db: Db, match: string, excludeSession: string): PreturnHit[] {
  try {
    const rows = db.raw
      .prepare(
        "SELECT f.message_id AS mid, f.session_id AS sid, m.project AS project, m.ts AS ts, " +
          "snippet(messages_fts, 0, '', '', '…', 10) AS snip, bm25(messages_fts) AS rank, " +
          "COALESCE(s.source,'interactive') AS source, s.summary AS summary, s.ended AS ended " +
          "FROM messages_fts f JOIN messages m ON m.id = f.message_id " +
          "LEFT JOIN sessions s ON s.session_id = f.session_id " +
          "WHERE messages_fts MATCH ? ORDER BY rank LIMIT 60"
      )
      .all(match) as unknown as PreturnHit[];
    return rows.filter((r) => !HIDDEN_SOURCES.has(r.source) && r.sid !== excludeSession);
  } catch {
    return [];
  }
}

// Build the injection block, or "" when there's nothing worth saying.
export function preturnRecall(
  db: Db,
  config: NousConfig,
  prompt: string,
  excludeSession = ""
): string {
  if (!db.ftsAvailable) return "";
  const terms = extractTerms(prompt);
  if (terms.length === 0) return "";

  // Precision first: implicit-AND over the salient terms. Recall fallback: OR.
  let hits: PreturnHit[] = [];
  if (terms.length > 1) {
    hits = queryHits(db, sanitizeFtsQuery(terms.join(" ")), excludeSession);
  }
  let fallback = false;
  if (hits.length === 0) {
    const orMatch = terms
      .map((t) => sanitizeFtsQuery(t))
      .filter(Boolean)
      .join(" OR ");
    if (!orMatch) return "";
    hits = queryHits(db, orMatch, excludeSession);
    fallback = true;
  }
  if (hits.length === 0) return "";

  // Same fusion as the recall ladder: BM25 + recency, cron demoted.
  const fused = reciprocalRankFusion(
    hits,
    [
      (items) => [...items].sort((a, b) => a.rank - b.rank),
      (items) => [...items].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)),
    ],
    (h) => String(h.mid),
    config.ladder.rrfK
  );
  for (const f of fused) if (DEMOTED_SOURCES.has(f.item.source)) f.score *= 0.4;
  fused.sort((a, b) => b.score - a.score);

  // One line per SESSION (best hit wins), newest information first.
  const bySession = new Map<string, PreturnHit>();
  for (const f of fused) {
    if (!bySession.has(f.item.sid)) bySession.set(f.item.sid, f.item);
    if (bySession.size >= config.preturn.maxSessions) break;
  }
  if (bySession.size === 0) return "";

  const lines: string[] = [];
  for (const h of bySession.values()) {
    const date = (h.ended ?? h.ts ?? "").slice(0, 10) || "?";
    const gist = h.summary ? clip(h.summary, 140) : clip(h.snip, 140);
    lines.push(`- [${date}] ${h.project} — ${gist} (session ${h.sid.slice(0, 8)})`);
  }

  return (
    `**NOUS RECALL (auto${fallback ? ", loose match" : ""}):** past sessions that may be relevant to this prompt — ` +
    `ignore if not; pull detail with nous_search scope:"sessions" session_id:"<id>":\n` +
    lines.join("\n")
  );
}
