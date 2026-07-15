import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openDb, type Db, sqliteAvailable } from "../../src/lib/db.js";
import { searchSessionsDb, getAnchoredView, bookends } from "../../src/lib/sessions.js";

const d = sqliteAvailable() ? describe : describe.skip;

d("cold-tier FTS search", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-fts-"));
    db = openDb(path.join(dir, "nous.db"))!;
    seed();
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function msg(sid: string, project: string, role: string, ts: string, content: string, source = "interactive") {
    db.raw
      .prepare("INSERT OR IGNORE INTO sessions(session_id,project,source,started,ended) VALUES(?,?,?,?,?)")
      .run(sid, project, source, ts, ts);
    db.raw
      .prepare("INSERT INTO messages(session_id,project,role,ts,turn_idx,content) VALUES(?,?,?,?,?,?)")
      .run(sid, project, role, ts, 0, content);
  }

  function seed() {
    msg("s1", "proj", "user", "2026-06-01T10:00:00Z", "how do pi extensions work in foundry");
    msg("s1", "proj", "assistant", "2026-06-01T10:01:00Z", "pi extensions are installed via npx");
    msg("s1", "proj", "user", "2026-06-01T10:02:00Z", "great, mission control powerline done");
    msg("s2", "proj", "user", "2026-07-01T10:00:00Z", "unrelated stripe billing talk");
    // an automation session that mentions the term a lot (should be demoted/hidden)
    msg("bot", "proj", "assistant", "2026-07-10T10:00:00Z", "pi extensions pi extensions pi extensions", "subagent");
  }

  it("finds a term and hides subagent-sourced hits", () => {
    const r = searchSessionsDb(db, { query: "pi extensions" });
    expect(r.engine).toBe("fts");
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.every((m) => m.sessionId !== "bot")).toBe(true);
    expect(r.matches[0].sessionId).toBe("s1");
    expect(r.matches[0].messageId).toBeGreaterThan(0);
  });

  it("returns discovery text with goal/resolution bookends", () => {
    const r = searchSessionsDb(db, { query: "powerline" });
    expect(r.text).toContain("goal:");
    expect(r.text).toContain("session s1".slice(0, 8));
  });

  it("auto-quoted identifier query matches", () => {
    msg("s3", "proj", "user", "2026-07-02T10:00:00Z", "editing src/lib/config today");
    const r = searchSessionsDb(db, { query: "src/lib/config" });
    expect(r.matches.some((m) => m.sessionId === "s3")).toBe(true);
  });

  it("getAnchoredView returns a window around a message with citation", () => {
    const hit = db.raw.prepare("SELECT id FROM messages WHERE session_id='s1' ORDER BY id LIMIT 1 OFFSET 1").get()!;
    const view = getAnchoredView(db, "s1", { around: Number(hit.id), window: 1 });
    expect(view.citation).toContain("s1".slice(0, 8));
    expect(view.lines.length).toBeGreaterThanOrEqual(2);
  });

  it("bookends returns first and last messages", () => {
    const be = bookends(db, "s1", 1);
    expect(be.start.length).toBe(1);
    expect(be.end.length).toBe(1);
    expect(be.start[0]).toContain("pi extensions");
  });

  it("empty query is handled", () => {
    expect(searchSessionsDb(db, { query: "   " }).matches.length).toBe(0);
  });
});
