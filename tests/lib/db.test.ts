import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openDb, dbStats, rebuildFts, sqliteAvailable, SCHEMA_VERSION } from "../../src/lib/db.js";

const HAS_SQLITE = sqliteAvailable();
const d = HAS_SQLITE ? describe : describe.skip;

d("db.ts (node:sqlite present)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-db-"));
    dbPath = path.join(dir, "nous.db");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("creates schema, FTS, and reports version", () => {
    const db = openDb(dbPath)!;
    expect(db).toBeTruthy();
    expect(db.ftsAvailable).toBe(true);
    const v = db.raw.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
    expect(Number(v!.value)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it("indexes messages into FTS via triggers and finds them by term", () => {
    const db = openDb(dbPath)!;
    db.raw.prepare(
      "INSERT INTO messages(session_id,project,role,ts,turn_idx,content) VALUES(?,?,?,?,?,?)"
    ).run("s1", "p", "user", "2026-07-01T10:00:00", 0, "we discussed stripe billing today");
    const hit = db.raw
      .prepare("SELECT message_id, session_id FROM messages_fts WHERE messages_fts MATCH ?")
      .get("stripe");
    expect(hit).toBeTruthy();
    expect(String(hit!.session_id)).toBe("s1");
    db.close();
  });

  it("delete keeps FTS aligned (rowid = messages.id)", () => {
    const db = openDb(dbPath)!;
    const r = db.raw
      .prepare("INSERT INTO messages(session_id,role,content) VALUES('s','user','deletable token')")
      .run();
    db.raw.prepare("DELETE FROM messages WHERE id=?").run(r.lastInsertRowid);
    const hit = db.raw.prepare("SELECT * FROM messages_fts WHERE messages_fts MATCH 'deletable'").get();
    expect(hit).toBeFalsy();
    db.close();
  });

  it("reopen is idempotent and preserves data", () => {
    const a = openDb(dbPath)!;
    a.raw.prepare("INSERT INTO sessions(session_id,project) VALUES('s1','p')").run();
    a.close();
    const b = openDb(dbPath)!;
    const stats = dbStats(b);
    expect(stats.sessions).toBe(1);
    expect(stats.unsummarized).toBe(1);
    b.close();
  });

  it("rebuildFts repopulates from messages", () => {
    const db = openDb(dbPath)!;
    db.raw.prepare("INSERT INTO messages(session_id,role,content) VALUES('s','user','alpha beta')").run();
    db.raw.exec("DELETE FROM messages_fts");
    expect(db.raw.prepare("SELECT * FROM messages_fts WHERE messages_fts MATCH 'alpha'").get()).toBeFalsy();
    rebuildFts(db.raw);
    expect(db.raw.prepare("SELECT * FROM messages_fts WHERE messages_fts MATCH 'alpha'").get()).toBeTruthy();
    db.close();
  });
});
