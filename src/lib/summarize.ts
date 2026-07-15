import type { Db } from "./db.js";
import type { RecallConfig } from "./config.js";
import { appendDigest } from "./daily.js";

// Session summarization support. The LLM call itself is a detached headless
// `claude -p --model haiku` spawned by the SessionEnd hook; this module builds
// the transcript payload it summarizes and writes the structured result back
// into the DB + the daily digest. Keeping the I/O here (not in the .mjs hook)
// means it's unit-testable and shares the DB schema.

export interface SummaryResult {
  summary: string;
  decisions: string[];
  open_threads: string[];
}

interface Row {
  role: string;
  ts: string;
  content: string;
}

function capTurn(content: string, cap: number): string {
  if (content.length <= cap) return content;
  // Keep the head (intent) and tail (result); drop the middle.
  const head = content.slice(0, 1500);
  const tail = content.slice(-500);
  return `${head}\n…[${content.length - 2000} chars truncated]…\n${tail}`;
}

// Build the transcript text the summarizer sees: per-turn cap first, then snap
// to whole turns under the total cap (never cut mid-turn).
export function buildTranscript(db: Db, sessionId: string, cfg: RecallConfig): string {
  let rows: Row[];
  try {
    rows = db.raw
      .prepare("SELECT role, ts, content FROM messages WHERE session_id=? ORDER BY id")
      .all(sessionId) as unknown as Row[];
  } catch {
    return "";
  }
  const capped = rows.map((r) => ({
    role: r.role,
    text: capTurn(r.content ?? "", cfg.capture.perTurnCap),
  }));

  // Take from the END (most recent) up to the total cap, snapping to turns.
  const total = cfg.capture.maxTranscriptChars;
  const kept: string[] = [];
  let used = 0;
  for (let i = capped.length - 1; i >= 0; i--) {
    const line = `${capped[i].role}: ${capped[i].text}`;
    if (used + line.length > total && kept.length > 0) break;
    kept.unshift(line);
    used += line.length;
  }
  return kept.join("\n\n");
}

export function summarizerPrompt(transcript: string): string {
  return (
    "You are summarizing one Claude Code session for a durable memory index. " +
    "Read the transcript and reply with ONLY a JSON object, no prose, no code fence:\n" +
    '{"summary": string, "decisions": string[], "open_threads": string[]}\n' +
    "- summary: 2-4 sentences — what the session was about and what got done.\n" +
    "- decisions: concrete choices made (empty array if none).\n" +
    "- open_threads: unfinished work / next steps (empty array if none).\n" +
    "Be specific: keep file names, identifiers, numbers verbatim.\n\n" +
    "TRANSCRIPT:\n" +
    transcript
  );
}

// Parse the model's reply defensively (it may wrap JSON in prose/fences).
export function parseSummary(raw: string): SummaryResult | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return {
      summary: typeof obj.summary === "string" ? obj.summary : "",
      decisions: Array.isArray(obj.decisions) ? obj.decisions.filter((x: unknown) => typeof x === "string") : [],
      open_threads: Array.isArray(obj.open_threads)
        ? obj.open_threads.filter((x: unknown) => typeof x === "string")
        : [],
    };
  } catch {
    return null;
  }
}

function sessionDate(db: Db, sessionId: string): string {
  try {
    const row = db.raw.prepare("SELECT ended, started, project FROM sessions WHERE session_id=?").get(sessionId);
    const iso = (row?.ended as string) || (row?.started as string) || new Date().toISOString();
    return iso.slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Persist a successful summary to the DB and append the daily digest.
export function writeSummary(
  db: Db,
  sessionId: string,
  result: SummaryResult,
  memoryBase?: string
): void {
  const now = new Date().toISOString();
  let project = "";
  try {
    const row = db.raw.prepare("SELECT project FROM sessions WHERE session_id=?").get(sessionId);
    project = (row?.project as string) || "";
  } catch {
    /* ignore */
  }
  try {
    db.raw
      .prepare(
        "UPDATE sessions SET summary=?, decisions=?, open_threads=?, summarized_at=? WHERE session_id=?"
      )
      .run(
        result.summary,
        JSON.stringify(result.decisions),
        JSON.stringify(result.open_threads),
        now,
        sessionId
      );
  } catch {
    /* ignore */
  }
  appendDigest(
    sessionDate(db, sessionId),
    {
      sessionId,
      project,
      summary: result.summary,
      decisions: result.decisions,
      openThreads: result.open_threads,
    },
    memoryBase
  );
}

// On summarizer failure/timeout, mark the session so nous_check's unsummarized
// count doesn't accumulate permanently-stuck sessions.
export function writePlaceholder(db: Db, sessionId: string): void {
  try {
    db.raw
      .prepare("UPDATE sessions SET summary=?, summarized_at=? WHERE session_id=? AND summarized_at IS NULL")
      .run("[summarization failed]", new Date().toISOString(), sessionId);
  } catch {
    /* ignore */
  }
}

// Sessions eligible for summarization: not yet summarized and past minTurns.
export function pendingSummaries(db: Db, cfg: RecallConfig): string[] {
  try {
    const rows = db.raw
      .prepare("SELECT session_id FROM sessions WHERE summarized_at IS NULL AND turns >= ? ORDER BY ended DESC")
      .all(cfg.capture.minTurns);
    return rows.map((r) => String(r.session_id));
  } catch {
    return [];
  }
}
