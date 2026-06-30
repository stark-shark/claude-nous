import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { searchSessions } from "../../src/lib/sessions.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("searchSessions (cold tier)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "recall-sess-"));
    const proj = path.join(root, "C--proj");
    fs.mkdirSync(proj, { recursive: true });
    const lines = [
      JSON.stringify({ type: "mode", mode: "normal" }),
      JSON.stringify({ type: "user", timestamp: "2026-06-01T10:00:00Z", message: { role: "user", content: "let's discuss the supabase RLS policy" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-06-02T11:00:00Z", message: { role: "assistant", content: [{ type: "text", text: "the RLS policy needs a tenant check" }, { type: "tool_use", name: "x" }] } }),
      JSON.stringify({ type: "user", timestamp: "2026-06-03T12:00:00Z", message: { role: "user", content: "unrelated weather chatter" } }),
    ];
    fs.writeFileSync(path.join(proj, "sess1.jsonl"), lines.join("\n"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("finds messages by keyword, most recent first", () => {
    const r = searchSessions(root, { query: "RLS policy" });
    expect(r.matches.length).toBe(2);
    expect(r.matches[0].ts > r.matches[1].ts).toBe(true);
    expect(r.matches[0].snippet.toLowerCase()).toContain("rls");
  });

  it("ANDs multiple terms", () => {
    expect(searchSessions(root, { query: "tenant check" }).matches.length).toBe(1);
    expect(searchSessions(root, { query: "tenant nonexistentword" }).matches.length).toBe(0);
  });

  it("ignores non-message line types", () => {
    expect(searchSessions(root, { query: "normal" }).matches.length).toBe(0);
  });

  it("returns a friendly message when nothing matches", () => {
    expect(searchSessions(root, { query: "zzzznotfound" }).text).toContain("No past sessions");
  });
});
