import { type Db, setMeta } from "./db.js";
import type { NousConfig } from "./config.js";

// DB retention/maintenance for the cold tier. Two independent knobs
// (config.retention):
//   vacuum         — periodic VACUUM to reclaim space after deletes/pruning.
//   pruneSessions  — OFF by default (total-recall goal). When on, replaces the
//                    raw messages of old, ALREADY-SUMMARIZED sessions with a
//                    single searchable summary row. Unsummarized sessions are
//                    never pruned — their content would be unrecoverable.
// The whole pass is gated by vacuumMinIntervalHours via meta.last_retention so
// the SessionEnd hook can call it unconditionally.

export interface RetentionResult {
  ran: boolean;
  reason?: string;
  prunedSessions: number;
  prunedMessages: number;
  vacuumed: boolean;
}

export function runRetention(
  db: Db,
  config: NousConfig,
  now: Date = new Date()
): RetentionResult {
  const res: RetentionResult = {
    ran: false,
    prunedSessions: 0,
    prunedMessages: 0,
    vacuumed: false,
  };
  const r = config.retention;
  if (!r.vacuum && !r.pruneSessions) {
    res.reason = "disabled";
    return res;
  }

  try {
    const row = db.raw.prepare("SELECT value FROM meta WHERE key='last_retention'").get();
    const last = row && typeof row.value === "string" ? Date.parse(row.value) : NaN;
    const minMs = Math.max(1, r.vacuumMinIntervalHours) * 3_600_000;
    if (Number.isFinite(last) && now.getTime() - last < minMs) {
      res.reason = "interval";
      return res;
    }
  } catch {
    /* no meta table / first run — proceed */
  }
  res.ran = true;

  if (r.pruneSessions && r.pruneDays > 0) {
    const cutoff = new Date(now.getTime() - r.pruneDays * 86_400_000).toISOString();
    try {
      // Only sessions that still carry raw conversation rows — a previously
      // pruned session (summary row only) is not re-pruned.
      const rows = db.raw
        .prepare(
          "SELECT session_id, ended, summary, keywords FROM sessions s " +
            "WHERE ended IS NOT NULL AND ended < ? AND summarized_at IS NOT NULL " +
            "AND EXISTS(SELECT 1 FROM messages m WHERE m.session_id = s.session_id AND m.role IN ('user','assistant'))"
        )
        .all(cutoff);
      if (rows.length > 0) {
        const del = db.raw.prepare("DELETE FROM messages WHERE session_id=?");
        const ins = db.raw.prepare(
          "INSERT INTO messages(session_id,project,role,ts,turn_idx,content,redacted) " +
            "SELECT ?, project, 'summary', ?, 0, ?, 0 FROM sessions WHERE session_id=?"
        );
        db.raw.exec("BEGIN IMMEDIATE");
        for (const row of rows) {
          const sid = String(row.session_id);
          const changes = Number(del.run(sid).changes);
          // Keep the session findable: the summary (+ semantic keywords) becomes
          // its one FTS-indexed message (insert trigger populates messages_fts).
          const summary = typeof row.summary === "string" ? row.summary.trim() : "";
          let kw = "";
          try {
            const parsed = typeof row.keywords === "string" ? JSON.parse(row.keywords) : [];
            if (Array.isArray(parsed) && parsed.length) kw = ` keywords: ${parsed.join(", ")}`;
          } catch {
            /* no keywords */
          }
          if (summary) {
            ins.run(sid, String(row.ended ?? ""), `[pruned — summary only] ${summary}${kw}`, sid);
          }
          res.prunedSessions++;
          res.prunedMessages += changes;
        }
        db.raw.exec("COMMIT");
      }
    } catch {
      try {
        db.raw.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
  }

  if (r.vacuum) {
    try {
      db.raw.exec("VACUUM");
      res.vacuumed = true;
    } catch {
      /* WAL checkpoint contention etc. — retry next interval */
    }
  }

  setMeta(db, "last_retention", now.toISOString());
  return res;
}

export function formatRetention(res: RetentionResult): string {
  if (!res.ran) return `retention: skipped (${res.reason ?? "unknown"})`;
  const parts: string[] = [];
  if (res.prunedSessions > 0) {
    parts.push(`pruned ${res.prunedMessages} msgs across ${res.prunedSessions} sessions`);
  }
  parts.push(res.vacuumed ? "vacuumed" : "no vacuum");
  return `retention: ${parts.join(", ")}`;
}
