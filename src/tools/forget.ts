import type { NousConfig } from "../lib/config.js";
import type { Db } from "../lib/db.js";
import { setMeta } from "../lib/db.js";
import type { MemoryDirEntry } from "../lib/memory-dir.js";

// nous_forget — the right-to-forget path a total-recall store needs. Purges a
// session (or matching sessions) across every tier: DB rows + FTS, and writes a
// tombstone so re-indexing the same JSONL won't resurrect it. Preview first;
// only `confirm:true` deletes.

export interface ForgetInput {
  session_id?: string;
  query?: string; // find sessions whose messages match, then purge them
  confirm?: boolean;
}

function tombstone(db: Db, sessionId: string): void {
  setMeta(db, `tombstone:${sessionId}`, new Date().toISOString());
}

export function isTombstoned(db: Db, sessionId: string): boolean {
  try {
    const row = db.raw.prepare("SELECT value FROM meta WHERE key=?").get(`tombstone:${sessionId}`);
    return !!row;
  } catch {
    return false;
  }
}

function sessionsForQuery(db: Db, query: string, limit = 25): string[] {
  try {
    const rows = db.raw
      .prepare(
        "SELECT DISTINCT session_id sid FROM messages WHERE id IN " +
          "(SELECT message_id FROM messages_fts WHERE messages_fts MATCH ? LIMIT ?)"
      )
      .all(query, limit);
    return rows.map((r) => String(r.sid));
  } catch {
    return [];
  }
}

export function handleForget(
  input: ForgetInput,
  db: Db | null,
  _dirs: MemoryDirEntry[],
  _config: NousConfig
): { text: string; isError?: boolean } {
  if (!db) return { text: "Cold-tier DB unavailable — nothing to forget there.", isError: true };

  let ids: string[] = [];
  if (input.session_id) ids = [input.session_id];
  else if (input.query) ids = sessionsForQuery(db, input.query);
  else return { text: "Provide session_id or query.", isError: true };

  if (ids.length === 0) return { text: "No matching sessions." };

  if (!input.confirm) {
    const preview = ids
      .map((id) => {
        const row = db.raw.prepare("SELECT project, turns, started, summary FROM sessions WHERE session_id=?").get(id);
        const msgs = db.raw.prepare("SELECT COUNT(*) c FROM messages WHERE session_id=?").get(id);
        return `- ${id.slice(0, 8)} @ ${row?.project ?? "?"} — ${Number(msgs?.c ?? 0)} msgs, started ${String(row?.started ?? "?").slice(0, 10)}`;
      })
      .join("\n");
    return {
      text: `Would forget ${ids.length} session(s):\n${preview}\n\nRe-run with confirm:true to purge (DB rows + FTS + tombstone). This is irreversible.`,
    };
  }

  let purged = 0;
  for (const id of ids) {
    try {
      db.raw.exec("BEGIN IMMEDIATE");
      db.raw.prepare("DELETE FROM messages WHERE session_id=?").run(id); // triggers drop FTS rows
      db.raw.prepare("DELETE FROM sessions WHERE session_id=?").run(id);
      tombstone(db, id);
      db.raw.exec("COMMIT");
      purged++;
    } catch {
      try {
        db.raw.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
  }
  return { text: `Forgot ${purged} session(s). Tombstoned so re-indexing won't restore them.` };
}
