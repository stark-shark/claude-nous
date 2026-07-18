import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openDb, sqliteAvailable, type Db } from "../../src/lib/db.js";
import { runRetention } from "../../src/lib/retention.js";
import { DEFAULT_CONFIG, type NousConfig } from "../../src/lib/config.js";

const NOW = new Date("2026-07-17T12:00:00Z");
const OLD = "2025-01-01T10:00:00Z"; // far past pruneDays
const FRESH = "2026-07-16T10:00:00Z";

function cfgWith(retention: Partial<NousConfig["retention"]>): NousConfig {
  return { ...DEFAULT_CONFIG, retention: { ...DEFAULT_CONFIG.retention, ...retention } };
}

function seedSession(db: Db, sid: string, ended: string, summarized: boolean): void {
  db.raw
    .prepare(
      "INSERT INTO sessions(session_id,project,ended,turns,summary,summarized_at) VALUES(?,?,?,?,?,?)"
    )
    .run(sid, "proj", ended, 2, summarized ? `summary of ${sid}` : null, summarized ? ended : null);
  const ins = db.raw.prepare(
    "INSERT INTO messages(session_id,project,role,ts,turn_idx,content,redacted) VALUES(?,?,?,?,?,?,0)"
  );
  ins.run(sid, "proj", "user", ended, 0, `hello from ${sid}`);
  ins.run(sid, "proj", "assistant", ended, 0, `answer for ${sid}`);
}

describe.skipIf(!sqliteAvailable())("runRetention", () => {
  let tmpDir: string;
  let db: Db;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-retention-"));
    db = openDb(path.join(tmpDir, "test.db"))!;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prunes old summarized sessions down to a searchable summary row", () => {
    seedSession(db, "old-summarized", OLD, true);
    const res = runRetention(db, cfgWith({ pruneSessions: true, pruneDays: 180 }), NOW);

    expect(res.ran).toBe(true);
    expect(res.prunedSessions).toBe(1);
    expect(res.prunedMessages).toBe(2);

    const rows = db.raw
      .prepare("SELECT role, content FROM messages WHERE session_id='old-summarized'")
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("summary");
    expect(String(rows[0].content)).toContain("summary of old-summarized");

    // Session row + summary survive.
    const sess = db.raw
      .prepare("SELECT summary FROM sessions WHERE session_id='old-summarized'")
      .get();
    expect(String(sess!.summary)).toContain("summary of old-summarized");

    // The summary row is FTS-searchable (insert trigger fired).
    if (db.ftsAvailable) {
      const hits = db.raw
        .prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'summary'")
        .all();
      expect(hits.length).toBeGreaterThan(0);
    }
  });

  it("never prunes unsummarized or fresh sessions", () => {
    seedSession(db, "old-unsummarized", OLD, false);
    seedSession(db, "fresh-summarized", FRESH, true);
    const res = runRetention(db, cfgWith({ pruneSessions: true, pruneDays: 180 }), NOW);

    expect(res.prunedSessions).toBe(0);
    const count = db.raw.prepare("SELECT COUNT(*) AS c FROM messages").get();
    expect(Number(count!.c)).toBe(4);
  });

  it("does not re-prune an already-pruned session", () => {
    seedSession(db, "old-summarized", OLD, true);
    runRetention(db, cfgWith({ pruneSessions: true, pruneDays: 180 }), NOW);
    // Clear the interval gate, run again.
    db.raw.prepare("DELETE FROM meta WHERE key='last_retention'").run();
    const res2 = runRetention(db, cfgWith({ pruneSessions: true, pruneDays: 180 }), NOW);
    expect(res2.prunedSessions).toBe(0);
    const rows = db.raw
      .prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id='old-summarized'")
      .all();
    expect(Number(rows[0].c)).toBe(1);
  });

  it("is gated by vacuumMinIntervalHours", () => {
    const cfg = cfgWith({ vacuum: true });
    const first = runRetention(db, cfg, NOW);
    expect(first.ran).toBe(true);
    expect(first.vacuumed).toBe(true);

    const second = runRetention(db, cfg, new Date(NOW.getTime() + 60_000));
    expect(second.ran).toBe(false);
    expect(second.reason).toBe("interval");

    const later = runRetention(db, cfg, new Date(NOW.getTime() + 25 * 3_600_000));
    expect(later.ran).toBe(true);
  });

  it("skips entirely when both knobs are off", () => {
    const res = runRetention(db, cfgWith({ vacuum: false, pruneSessions: false }), NOW);
    expect(res.ran).toBe(false);
    expect(res.reason).toBe("disabled");
  });
});
