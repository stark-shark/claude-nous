import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openDb, type Db, sqliteAvailable } from "../../src/lib/db.js";
import { parseSummary, writeSummary } from "../../src/lib/summarize.js";
import { daysDir } from "../../src/lib/daily.js";

describe("parseSummary", () => {
  it("parses bare JSON", () => {
    const r = parseSummary('{"summary":"s","decisions":["a"],"open_threads":[]}');
    expect(r?.summary).toBe("s");
    expect(r?.decisions).toEqual(["a"]);
    expect(r?.keywords).toEqual([]);
  });
  it("parses keywords when present", () => {
    const r = parseSummary('{"summary":"s","decisions":[],"open_threads":[],"keywords":["vite","proxy","dev server"]}');
    expect(r?.keywords).toEqual(["vite", "proxy", "dev server"]);
  });
  it("unwraps a code fence + surrounding prose", () => {
    const r = parseSummary('Here you go:\n```json\n{"summary":"x","decisions":[],"open_threads":["t"]}\n```');
    expect(r?.summary).toBe("x");
    expect(r?.open_threads).toEqual(["t"]);
  });
  it("returns null on garbage", () => {
    expect(parseSummary("not json at all")).toBeNull();
  });
});

const d = sqliteAvailable() ? describe : describe.skip;

d("writeSummary session-id validation", () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-sum-"));
    db = openDb(path.join(dir, "nous.db"))!;
    db.raw.prepare("INSERT INTO sessions(session_id,project,started,ended) VALUES('real','p','2026-07-01T00:00:00Z','2026-07-01T01:00:00Z')").run();
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes DB row + digest for a known session", () => {
    const memBase = path.join(dir, "memory");
    const ok = writeSummary(db, "real", { summary: "did things", decisions: ["d1"], open_threads: [], keywords: [] }, memBase);
    expect(ok).toBe(true);
    const row = db.raw.prepare("SELECT summary, summarized_at FROM sessions WHERE session_id='real'").get()!;
    expect(row.summary).toBe("did things");
    expect(row.summarized_at).toBeTruthy();
    // a daily digest file exists under the memory base
    const files = fs.readdirSync(daysDir(memBase));
    expect(files.some((f) => f.endsWith(".md"))).toBe(true);
  });

  it("indexes summary + keywords as a hidden FTS meta row", () => {
    const memBase = path.join(dir, "memory3");
    const ok = writeSummary(
      db,
      "real",
      { summary: "configured the dev server", decisions: [], open_threads: [], keywords: ["vite", "hmr", "frontend tooling"] },
      memBase
    );
    expect(ok).toBe(true);
    const meta = db.raw
      .prepare("SELECT role, content FROM messages WHERE session_id='real' AND role='meta'")
      .all();
    expect(meta).toHaveLength(1);
    expect(String(meta[0].content)).toContain("frontend tooling");
    if (db.ftsAvailable) {
      // A keyword that never appeared in the transcript is now searchable.
      const hits = db.raw
        .prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'hmr'")
        .all();
      expect(hits.length).toBe(1);
    }
    // Re-summarizing replaces (not duplicates) the meta row.
    writeSummary(db, "real", { summary: "v2", decisions: [], open_threads: [], keywords: ["vite"] }, memBase);
    const again = db.raw
      .prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id='real' AND role='meta'")
      .get()!;
    expect(Number(again.c)).toBe(1);
  });

  it("writes NOTHING for an unknown session id (no stray digest)", () => {
    const memBase = path.join(dir, "memory2");
    const ok = writeSummary(db, "nonexistent", { summary: "x", decisions: [], open_threads: [], keywords: [] }, memBase);
    expect(ok).toBe(false);
    expect(fs.existsSync(daysDir(memBase))).toBe(false); // no digest dir created
  });
});
