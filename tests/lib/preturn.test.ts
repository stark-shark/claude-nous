import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openDb, sqliteAvailable, type Db } from "../../src/lib/db.js";
import { preturnRecall, extractTerms } from "../../src/lib/preturn.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";

describe("extractTerms", () => {
  it("keeps identifiers, drops stopwords and short/numeric tokens", () => {
    const terms = extractTerms("can you fix the vite.config.ts proxy for the new daemon route 42");
    expect(terms).toContain("vite.config.ts");
    expect(terms).toContain("proxy");
    expect(terms).toContain("daemon");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("42");
    expect(terms).not.toContain("you");
  });

  it("dedupes and caps", () => {
    const terms = extractTerms("proxy proxy proxy alpha beta gamma delta epsilon zeta eta theta iota kappa lambda", 5);
    expect(terms).toHaveLength(5);
    expect(new Set(terms).size).toBe(5);
  });
});

describe.skipIf(!sqliteAvailable())("preturnRecall", () => {
  let tmpDir: string;
  let db: Db;

  function seed(sid: string, project: string, content: string, opts: { source?: string; summary?: string; ended?: string } = {}): void {
    db.raw
      .prepare("INSERT INTO sessions(session_id,project,source,summary,summarized_at,ended,turns) VALUES(?,?,?,?,?,?,1)")
      .run(sid, project, opts.source ?? "interactive", opts.summary ?? null, opts.summary ? "x" : null, opts.ended ?? "2026-07-01T10:00:00Z");
    db.raw
      .prepare("INSERT INTO messages(session_id,project,role,ts,turn_idx,content,redacted) VALUES(?,?,?,?,0,?,0)")
      .run(sid, project, "user", opts.ended ?? "2026-07-01T10:00:00Z", content);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-preturn-"));
    db = openDb(path.join(tmpDir, "t.db"))!;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("surfaces a matching past session as a one-line reminder", () => {
    seed("sess-vite-1", "projA", "we fixed the vite proxy for new daemon routes", {
      summary: "Fixed vite proxy config for daemon routes",
    });
    const out = preturnRecall(db, DEFAULT_CONFIG, "why is the vite proxy failing for the daemon again?");
    expect(out).toContain("NOUS RECALL");
    expect(out).toContain("Fixed vite proxy config");
    expect(out).toContain("sess-vit");
  });

  it("returns empty for unrelated prompts", () => {
    seed("sess-1", "projA", "we talked about kubernetes ingress");
    const out = preturnRecall(db, DEFAULT_CONFIG, "let's compose a haiku about strawberries today");
    expect(out).toBe("");
  });

  it("excludes the current session", () => {
    seed("sess-current", "projA", "vite proxy daemon work in progress");
    const out = preturnRecall(db, DEFAULT_CONFIG, "continue the vite proxy daemon work", "sess-current");
    expect(out).toBe("");
  });

  it("never surfaces subagent sessions and caps at maxSessions", () => {
    seed("sess-sub", "projA", "vite proxy daemon internals", { source: "subagent" });
    for (let i = 0; i < 5; i++) {
      seed(`sess-${i}`, "projA", `vite proxy daemon attempt ${i}`, { ended: `2026-07-0${i + 1}T10:00:00Z` });
    }
    const out = preturnRecall(db, DEFAULT_CONFIG, "back to the vite proxy daemon problem");
    expect(out).not.toContain("sess-sub");
    const lines = out.split("\n").filter((l) => l.startsWith("- ["));
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_CONFIG.preturn.maxSessions);
  });
});
