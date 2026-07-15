import * as fs from "node:fs";
import * as path from "node:path";
import { type Db } from "./db.js";
import { sanitizeFtsQuery } from "./fts-query.js";
import { reciprocalRankFusion, topConfidence, type Fused } from "./rank.js";

// Cold tier: full-text recall over Claude Code's own session transcripts.
//
// Primary path is the SQLite FTS5 index (see db.ts + indexer.ts): BM25 relevance
// fused with recency, automation sources demoted, with anchored windows +
// bookends so a hit reconstructs goal -> match -> resolution in one call.
//
// When the DB / FTS5 is unavailable (Node < 22.5, SQLite w/o FTS5), we fall back
// to a dependency-free brute scan of the raw JSONL — same output shape, so
// callers don't care which path ran.

export interface SessionMatch {
  project: string;
  sessionId: string;
  role: string;
  ts: string;
  snippet: string;
  messageId?: number;
}

export interface SessionSearchInput {
  query: string;
  project?: string;
  limit?: number;
}

export interface SessionSearchResult {
  matches: SessionMatch[];
  text: string;
  confidence: number; // 0..1 top-hit confidence; low => worth Haiku expansion
  engine: "fts" | "brute";
}

export function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string; content?: unknown };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "tool_result" && typeof b.content === "string") parts.push(b.content);
  }
  return parts.join(" ");
}

function clip(s: string, max: number): string {
  const one = (s || "").replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

// ─── FTS5 (primary) ───────────────────────────────────────────────────────────

const DEMOTED_SOURCES = new Set(["cron"]);
const HIDDEN_SOURCES = new Set(["subagent", "tool"]);

interface RawHit {
  mid: number;
  sid: string;
  project: string;
  role: string;
  ts: string;
  snip: string;
  rank: number; // bm25, lower = better
  source: string;
}

export function searchSessionsDb(
  db: Db,
  input: SessionSearchInput,
  k = 60
): SessionSearchResult {
  const limit = input.limit ?? 20;
  const match = sanitizeFtsQuery(input.query);
  if (!match) return { matches: [], text: "Empty query.", confidence: 0, engine: "fts" };

  const params: unknown[] = [match];
  let sql =
    "SELECT f.message_id AS mid, f.session_id AS sid, m.project AS project, m.role AS role, " +
    "m.ts AS ts, snippet(messages_fts, 0, '«', '»', '…', 12) AS snip, " +
    "bm25(messages_fts) AS rank, COALESCE(s.source,'interactive') AS source " +
    "FROM messages_fts f JOIN messages m ON m.id = f.message_id " +
    "LEFT JOIN sessions s ON s.session_id = f.session_id " +
    "WHERE messages_fts MATCH ? ";
  if (input.project) {
    sql += "AND m.project = ? ";
    params.push(input.project);
  }
  sql += "ORDER BY rank LIMIT ?";
  params.push(limit * 5);

  let rows: RawHit[];
  try {
    rows = db.raw.prepare(sql).all(...params) as unknown as RawHit[];
  } catch {
    return { matches: [], text: `Cold-tier query failed for '${input.query}'.`, confidence: 0, engine: "fts" };
  }

  const hits = rows.filter((r) => !HIDDEN_SOURCES.has(r.source));
  if (hits.length === 0) {
    return {
      matches: [],
      text: `No past sessions mention '${input.query}'.`,
      confidence: 0,
      engine: "fts",
    };
  }

  // RRF fuse BM25 relevance with recency, then demote automation sources.
  const fused: Fused<RawHit>[] = reciprocalRankFusion(
    hits,
    [
      (items) => [...items].sort((a, b) => a.rank - b.rank), // bm25 best-first
      (items) => [...items].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)), // recent-first
    ],
    (h) => String(h.mid),
    k
  );
  for (const f of fused) if (DEMOTED_SOURCES.has(f.item.source)) f.score *= 0.4;
  fused.sort((a, b) => b.score - a.score);

  const confidence = topConfidence(fused, 2, k);
  const top = fused.slice(0, limit).map((f) => f.item);

  const matches: SessionMatch[] = top.map((h) => ({
    project: h.project,
    sessionId: h.sid,
    role: h.role,
    ts: h.ts ? h.ts.slice(0, 19) : "",
    snippet: clip(h.snip, 200),
    messageId: h.mid,
  }));

  const text = formatDiscovery(db, input.query, confidence, top);
  return { matches, text, confidence, engine: "fts" };
}

function formatDiscovery(db: Db, query: string, confidence: number, hits: RawHit[]): string {
  if (hits.length === 0) return `No past sessions mention '${query}'.`;
  const pct = Math.round(confidence * 100);
  const lines: string[] = [
    `${hits.length} past-session match${hits.length === 1 ? "" : "es"} for '${query}' (confidence ${pct}%):`,
    "",
  ];

  // Expand the top hit's session: bookends (goal + resolution) + window at match.
  const top = hits[0];
  const be = bookends(db, top.sid, 3);
  const win = getAnchoredView(db, top.sid, { around: top.mid, window: 3 });
  const dateRange = sessionDateRange(db, top.sid);
  lines.push(`▸ Top — session ${top.sid.slice(0, 8)} @ ${top.project}  [${dateRange}]`);
  if (be.start.length) {
    lines.push("  goal:");
    for (const l of be.start) lines.push("    " + l);
  }
  if (win.lines.length) {
    lines.push("  around match:");
    for (const l of win.lines) lines.push("    " + l);
  }
  if (be.end.length) {
    lines.push("  resolution:");
    for (const l of be.end) lines.push("    " + l);
  }

  if (hits.length > 1) {
    lines.push("", "Other matches:");
    for (const h of hits.slice(1)) {
      lines.push(
        `- [${h.ts ? h.ts.slice(0, 19) : "?"}] ${h.role} @ ${h.project}/${h.sid.slice(0, 8)} (msg ${h.mid}) — ${clip(h.snip, 160)}`
      );
    }
  }
  lines.push(
    "",
    'To pull more: nous_search scope:"sessions" with session_id:"<id>" [around:<msg>] [full:true]'
  );
  return lines.join("\n");
}

// ─── anchored view + bookends (scroll/read) ────────────────────────────────────

interface MsgRow {
  id: number;
  role: string;
  ts: string;
  content: string;
}

function sessionRows(db: Db, sessionId: string): MsgRow[] {
  try {
    return db.raw
      .prepare("SELECT id, role, ts, content FROM messages WHERE session_id=? ORDER BY id")
      .all(sessionId) as unknown as MsgRow[];
  } catch {
    return [];
  }
}

export interface AnchoredView {
  citation: string;
  lines: string[];
}

// Messages around a hit (or the full session), each as `[ts] role: content`.
export function getAnchoredView(
  db: Db,
  sessionId: string,
  opts: { around?: number; window?: number; full?: boolean } = {}
): AnchoredView {
  const rows = sessionRows(db, sessionId);
  const citation = `session ${sessionId.slice(0, 8)} @ ${sessionDateRange(db, sessionId)}`;
  if (rows.length === 0) return { citation, lines: [] };

  let slice: MsgRow[];
  if (opts.full) {
    slice = rows;
  } else {
    const window = opts.window ?? 5;
    let idx = 0;
    if (opts.around != null) {
      const found = rows.findIndex((r) => r.id === opts.around);
      idx = found >= 0 ? found : 0;
    }
    slice = rows.slice(Math.max(0, idx - window), idx + window + 1);
  }
  const lines = slice.map(
    (r) => `[${r.ts ? r.ts.slice(0, 19) : "?"}] ${r.role}: ${clip(r.content, 220)}`
  );
  return { citation, lines };
}

export interface Bookends {
  start: string[];
  end: string[];
}

// First n and last n messages — the goal (kickoff) and the resolution.
export function bookends(db: Db, sessionId: string, n = 3): Bookends {
  const rows = sessionRows(db, sessionId);
  if (rows.length === 0) return { start: [], end: [] };
  const fmt = (r: MsgRow) =>
    `[${r.ts ? r.ts.slice(0, 19) : "?"}] ${r.role}: ${clip(r.content, 160)}`;
  const start = rows.slice(0, n).map(fmt);
  const end = rows.length > n ? rows.slice(-n).map(fmt) : [];
  return { start, end };
}

function sessionDateRange(db: Db, sessionId: string): string {
  try {
    const row = db.raw
      .prepare("SELECT started, ended FROM sessions WHERE session_id=?")
      .get(sessionId);
    const s = row && typeof row.started === "string" ? row.started.slice(0, 10) : "";
    const e = row && typeof row.ended === "string" ? row.ended.slice(0, 10) : "";
    if (s && e && s !== e) return `${s} → ${e}`;
    return s || e || "?";
  } catch {
    return "?";
  }
}

// ─── brute-scan fallback (no DB / no FTS5) ──────────────────────────────────────

function snippetAround(text: string, terms: string[], width = 160): string {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) idx = 0;
  const start = Math.max(0, idx - width / 2);
  const end = Math.min(text.length, idx + width / 2);
  const clipped = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + clipped + (end < text.length ? "…" : "");
}

export function searchSessionsBrute(
  projectsRoot: string,
  input: SessionSearchInput
): SessionSearchResult {
  const limit = input.limit ?? 20;
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches: SessionMatch[] = [];

  if (!fs.existsSync(projectsRoot) || terms.length === 0) {
    return {
      matches,
      text: terms.length === 0 ? "Empty query." : "No sessions found.",
      confidence: 0,
      engine: "brute",
    };
  }

  const projectDirs = fs.readdirSync(projectsRoot).filter((n) => !input.project || n === input.project);

  outer: for (const project of projectDirs) {
    const dir = path.join(projectsRoot, project);
    let files: string[];
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      let raw: string;
      try {
        raw = fs.readFileSync(path.join(dir, file), "utf-8");
      } catch {
        continue;
      }
      const sessionId = file.replace(/\.jsonl$/, "");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        let obj: { type?: string; message?: unknown; timestamp?: string };
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.type !== "user" && obj.type !== "assistant") continue;
        const text = extractText(obj.message);
        if (!text) continue;
        const lower = text.toLowerCase();
        if (!terms.every((t) => lower.includes(t))) continue;
        matches.push({
          project,
          sessionId,
          role: obj.type,
          ts: typeof obj.timestamp === "string" ? obj.timestamp.slice(0, 19) : "",
          snippet: snippetAround(text, terms),
        });
        if (matches.length >= limit * 4) break outer;
      }
    }
  }

  matches.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const top = matches.slice(0, limit);
  const text =
    top.length === 0
      ? `No past sessions mention '${input.query}'.`
      : top
          .map((m) => `- [${m.ts || "?"}] ${m.role} @ ${m.project}/${m.sessionId.slice(0, 8)} — ${m.snippet}`)
          .join("\n");
  return { matches: top, text, confidence: top.length ? 0.5 : 0, engine: "brute" };
}

// ─── dispatcher ─────────────────────────────────────────────────────────────

// Choose FTS5 when a DB with FTS is available, else brute scan. Keeps a stable
// return shape regardless of engine.
export function searchSessions(
  projectsRoot: string,
  input: SessionSearchInput,
  db?: Db | null
): SessionSearchResult {
  if (db && db.ftsAvailable) return searchSessionsDb(db, input);
  return searchSessionsBrute(projectsRoot, input);
}
