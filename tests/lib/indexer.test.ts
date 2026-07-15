import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openDb, type Db } from "../../src/lib/db.js";
import { indexFile, indexAll } from "../../src/lib/indexer.js";
import { sqliteAvailable } from "../../src/lib/db.js";

const d = sqliteAvailable() ? describe : describe.skip;

function line(type: string, text: string, ts: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type, timestamp: ts, message: { content: text }, ...extra }) + "\n";
}

d("indexer", () => {
  let dir: string;
  let projectsRoot: string;
  let projDir: string;
  let db: Db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-idx-"));
    projectsRoot = path.join(dir, "projects");
    projDir = path.join(projectsRoot, "C--proj");
    fs.mkdirSync(projDir, { recursive: true });
    db = openDb(path.join(dir, "nous.db"))!;
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(session: string, content: string) {
    fs.writeFileSync(path.join(projDir, `${session}.jsonl`), content);
  }
  function append(session: string, content: string) {
    fs.appendFileSync(path.join(projDir, `${session}.jsonl`), content);
  }

  it("ingests user/assistant turns and records a session", () => {
    write(
      "s1",
      line("user", "hello about stripe", "2026-07-01T10:00:00Z") +
        line("assistant", "sure, billing", "2026-07-01T10:00:05Z") +
        line("system", "ignored", "2026-07-01T10:00:06Z")
    );
    const r = indexFile(db, path.join(projDir, "s1.jsonl"));
    expect(r?.inserted).toBe(2);
    const sess = db.raw.prepare("SELECT * FROM sessions WHERE session_id='s1'").get()!;
    expect(sess.turns).toBe(1);
    expect(String(sess.started)).toBe("2026-07-01T10:00:00Z");
    expect(String(sess.ended)).toBe("2026-07-01T10:00:05Z");
  });

  it("only ingests appended lines (incremental offset)", () => {
    write("s2", line("user", "first", "2026-07-01T10:00:00Z"));
    expect(indexFile(db, path.join(projDir, "s2.jsonl"))?.inserted).toBe(1);
    // no change -> skip
    expect(indexFile(db, path.join(projDir, "s2.jsonl"))).toBeNull();
    append("s2", line("assistant", "second", "2026-07-01T10:01:00Z"));
    expect(indexFile(db, path.join(projDir, "s2.jsonl"))?.inserted).toBe(1);
    expect(Number(db.raw.prepare("SELECT COUNT(*) c FROM messages WHERE session_id='s2'").get()!.c)).toBe(2);
  });

  it("does not commit a trailing partial line until it completes", () => {
    write("s3", line("user", "complete", "2026-07-01T10:00:00Z"));
    // append a partial (no trailing newline)
    append("s3", JSON.stringify({ type: "assistant", message: { content: "partial" } }));
    expect(indexFile(db, path.join(projDir, "s3.jsonl"))?.inserted).toBe(1); // only the complete one
    // now finish the line
    append("s3", "\n");
    expect(indexFile(db, path.join(projDir, "s3.jsonl"))?.inserted).toBe(1);
    expect(Number(db.raw.prepare("SELECT COUNT(*) c FROM messages WHERE session_id='s3'").get()!.c)).toBe(2);
  });

  it("re-ingests from scratch when the file is truncated/rewritten", () => {
    write("s4", line("user", "old one", "2026-07-01T10:00:00Z") + line("user", "old two", "2026-07-01T10:00:01Z"));
    indexFile(db, path.join(projDir, "s4.jsonl"));
    expect(Number(db.raw.prepare("SELECT COUNT(*) c FROM messages WHERE session_id='s4'").get()!.c)).toBe(2);
    // rewrite with a single shorter line
    write("s4", line("user", "brand new", "2026-07-02T10:00:00Z"));
    indexFile(db, path.join(projDir, "s4.jsonl"));
    const rows = db.raw.prepare("SELECT content FROM messages WHERE session_id='s4'").all();
    expect(rows.length).toBe(1);
    expect(String(rows[0].content)).toContain("brand new");
  });

  it("redacts secrets before they reach FTS", () => {
    write("s5", line("user", "my key is ghp_" + "q".repeat(36) + " ok", "2026-07-01T10:00:00Z"));
    const r = indexFile(db, path.join(projDir, "s5.jsonl"));
    expect(r?.redacted).toBeGreaterThan(0);
    const hit = db.raw.prepare("SELECT * FROM messages_fts WHERE messages_fts MATCH 'ghp_*'").get();
    expect(hit).toBeFalsy(); // secret not searchable
    const stored = String(db.raw.prepare("SELECT content FROM messages WHERE session_id='s5'").get()!.content);
    expect(stored).toContain("[REDACTED:gh-token:");
  });

  it("tags subagent sidechains as source=subagent", () => {
    write("s6", line("user", "child work", "2026-07-01T10:00:00Z", { isSidechain: true }));
    indexFile(db, path.join(projDir, "s6.jsonl"));
    expect(String(db.raw.prepare("SELECT source FROM sessions WHERE session_id='s6'").get()!.source)).toBe("subagent");
  });

  it("indexAll sweeps every project", () => {
    write("a", line("user", "alpha", "2026-07-01T10:00:00Z"));
    write("b", line("user", "beta", "2026-07-01T10:00:00Z"));
    const r = indexAll(db, projectsRoot);
    expect(r.filesIngested).toBe(2);
    expect(r.sessions).toBe(2);
  });
});
