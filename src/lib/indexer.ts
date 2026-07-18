import * as fs from "node:fs";
import * as path from "node:path";
import { type Db, setMeta } from "./db.js";
import { extractText } from "./sessions.js";
import { redact } from "./redact.js";

// Incremental ingest of Claude Code session transcripts into the Nous DB.
//
// Claude Code writes one JSONL file per session under
// ~/.claude/projects/<project-hash>/<session-id>.jsonl, append-only. We track a
// byte offset per file (files.last_offset) and only parse bytes appended since
// the last run — so the Stop hook can cheaply index just the latest turn.
//
// There is no Hermes precedent for tailing an external writer's file (Hermes IS
// the writer), so truncation/rewrite safety is handled explicitly and tested.

export interface IndexOptions {
  redact?: boolean;
  redactExtra?: string[];
}

export interface IndexFileResult {
  sessionId: string;
  project: string;
  inserted: number;
  redacted: number;
  // Total user turns recorded for this session (from the sessions aggregate) —
  // lets the Stop hook drive its review cadence without re-reading the
  // transcript it just indexed.
  turns: number;
}

interface FileRow {
  mtime: number;
  size: number;
  last_offset: number;
}

function inferSource(obj: Record<string, unknown>): string {
  if (obj.isSidechain === true) return "subagent";
  const ut = typeof obj.userType === "string" ? obj.userType : "";
  if (ut === "cron" || ut === "scheduled") return "cron";
  return "interactive";
}

// Index a single transcript file. Returns null if nothing new was ingested.
export function indexFile(
  db: Db,
  filePath: string,
  opts: IndexOptions = {}
): IndexFileResult | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  if (!filePath.endsWith(".jsonl")) return null;

  const sessionId = path.basename(filePath, ".jsonl");
  const project = path.basename(path.dirname(filePath));
  const mtimeMs = Math.floor(stat.mtimeMs);
  const size = stat.size;

  // Tombstoned by nous_forget — never re-index; record the stat so we stop
  // rescanning it.
  try {
    const tomb = db.raw.prepare("SELECT 1 FROM meta WHERE key=?").get(`tombstone:${sessionId}`);
    if (tomb) {
      upsertFileRow(db, filePath, mtimeMs, size, size);
      return null;
    }
  } catch {
    /* ignore */
  }

  const fileRow = db.raw
    .prepare("SELECT mtime, size, last_offset FROM files WHERE path=?")
    .get(filePath) as FileRow | undefined;

  // Unchanged since last index — skip.
  if (fileRow && fileRow.mtime === mtimeMs && fileRow.size === size) return null;

  let startOffset = fileRow ? fileRow.last_offset : 0;
  let truncated = false;
  if (fileRow && size < fileRow.last_offset) {
    // File shrank — it was truncated/rewritten. Drop this session's rows and
    // re-ingest from the top.
    truncated = true;
    startOffset = 0;
  }

  // Read ONLY the bytes appended since last_offset — a whole-file read here is
  // O(session size) per turn, i.e. quadratic over a long session.
  if (startOffset >= size) {
    upsertFileRow(db, filePath, mtimeMs, size, startOffset);
    return null;
  }
  let slice: Buffer;
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const len = size - startOffset;
      slice = Buffer.allocUnsafe(len);
      let read = 0;
      while (read < len) {
        const n = fs.readSync(fd, slice, read, len - read, startOffset + read);
        if (n <= 0) break;
        read += n;
      }
      if (read < len) slice = slice.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }

  const text = slice.toString("utf8");
  const lastNl = text.lastIndexOf("\n");

  // No complete new line yet — record stat so we don't re-stat forever, but keep
  // the offset where it is.
  if (lastNl === -1) {
    upsertFileRow(db, filePath, mtimeMs, size, startOffset);
    return null;
  }

  const complete = text.slice(0, lastNl); // whole lines only
  const consumed = Buffer.byteLength(complete, "utf8") + 1; // + the newline
  const newOffset = startOffset + consumed;

  const doRedact = opts.redact !== false; // default on
  const insertMsg = db.raw.prepare(
    "INSERT INTO messages(session_id,project,role,ts,turn_idx,content,redacted) VALUES(?,?,?,?,?,?,?)"
  );

  let inserted = 0;
  let redactedTotal = 0;

  // Continue turn numbering from whatever's already stored for this session.
  let turnIdx = 0;
  try {
    const row = db.raw
      .prepare("SELECT COALESCE(MAX(turn_idx),-1) AS m FROM messages WHERE session_id=?")
      .get(sessionId);
    turnIdx = row ? Number(row.m) + 1 : 0;
  } catch {
    turnIdx = 0;
  }

  let cwd = "";
  let source = "interactive";

  try {
    db.raw.exec("BEGIN IMMEDIATE");

    if (truncated) {
      db.raw.prepare("DELETE FROM messages WHERE session_id=?").run(sessionId);
      turnIdx = 0;
    }

    for (const line of complete.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const t = obj.type;
      if (t !== "user" && t !== "assistant") continue;

      if (typeof obj.cwd === "string" && obj.cwd) cwd = obj.cwd;
      source = inferSource(obj);

      let content = extractText(obj.message);
      if (!content) continue;

      let redCount = 0;
      if (doRedact) {
        const r = redact(content, opts.redactExtra);
        content = r.text;
        redCount = r.count;
      }
      redactedTotal += redCount;

      const ts = typeof obj.timestamp === "string" ? obj.timestamp : "";
      insertMsg.run(sessionId, project, t, ts, turnIdx, content, redCount > 0 ? redCount : 0);
      if (t === "user") turnIdx++;
      inserted++;
    }

    // Upsert the session row, then recompute aggregates from messages (robust +
    // idempotent regardless of how many increments we've done).
    db.raw
      .prepare(
        "INSERT INTO sessions(session_id,project,cwd,source) VALUES(?,?,?,?) " +
          "ON CONFLICT(session_id) DO UPDATE SET project=excluded.project, " +
          "cwd=COALESCE(NULLIF(excluded.cwd,''), sessions.cwd), source=excluded.source"
      )
      .run(sessionId, project, cwd, source);
    db.raw
      .prepare(
        "UPDATE sessions SET " +
          "started=(SELECT MIN(ts) FROM messages WHERE session_id=? AND ts<>''), " +
          "ended=(SELECT MAX(ts) FROM messages WHERE session_id=? AND ts<>''), " +
          "turns=(SELECT COUNT(*) FROM messages WHERE session_id=? AND role='user') " +
          "WHERE session_id=?"
      )
      .run(sessionId, sessionId, sessionId, sessionId);

    upsertFileRowTx(db, filePath, mtimeMs, size, newOffset);

    db.raw.exec("COMMIT");
  } catch {
    try {
      db.raw.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    return null;
  }

  try {
    setMeta(db, "last_index", new Date().toISOString());
  } catch {
    /* ignore */
  }

  if (inserted === 0) return null;
  let turns = 0;
  try {
    const row = db.raw.prepare("SELECT turns FROM sessions WHERE session_id=?").get(sessionId);
    turns = row ? Number(row.turns ?? 0) : 0;
  } catch {
    /* ignore */
  }
  return { sessionId, project, inserted, redacted: redactedTotal, turns };
}

function upsertFileRow(db: Db, p: string, mtime: number, size: number, offset: number): void {
  try {
    db.raw.exec("BEGIN IMMEDIATE");
    upsertFileRowTx(db, p, mtime, size, offset);
    db.raw.exec("COMMIT");
  } catch {
    try {
      db.raw.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
  }
}

function upsertFileRowTx(db: Db, p: string, mtime: number, size: number, offset: number): void {
  db.raw
    .prepare(
      "INSERT INTO files(path,mtime,size,last_offset) VALUES(?,?,?,?) " +
        "ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, last_offset=excluded.last_offset"
    )
    .run(p, mtime, size, offset);
}

export interface IndexAllResult {
  filesScanned: number;
  filesIngested: number;
  messages: number;
  redacted: number;
  sessions: number;
}

// Backfill / incremental sweep over every project's transcripts.
export function indexAll(
  db: Db,
  projectsRoot: string,
  opts: IndexOptions = {}
): IndexAllResult {
  const out: IndexAllResult = {
    filesScanned: 0,
    filesIngested: 0,
    messages: 0,
    redacted: 0,
    sessions: 0,
  };
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(projectsRoot);
  } catch {
    return out;
  }
  const touchedSessions = new Set<string>();
  for (const proj of projectDirs) {
    const dir = path.join(projectsRoot, proj);
    let files: string[];
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      out.filesScanned++;
      const res = indexFile(db, path.join(dir, f), opts);
      if (res) {
        out.filesIngested++;
        out.messages += res.inserted;
        out.redacted += res.redacted;
        touchedSessions.add(res.sessionId);
      }
    }
  }
  out.sessions = touchedSessions.size;
  return out;
}
