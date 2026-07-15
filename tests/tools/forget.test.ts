import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openDb, type Db, sqliteAvailable } from "../../src/lib/db.js";
import { handleForget, isTombstoned } from "../../src/tools/forget.js";
import { indexFile } from "../../src/lib/indexer.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";

const d = sqliteAvailable() ? describe : describe.skip;

d("nous_forget", () => {
  let dir: string;
  let projDir: string;
  let db: Db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-forget-"));
    projDir = path.join(dir, "projects", "C--p");
    fs.mkdirSync(projDir, { recursive: true });
    db = openDb(path.join(dir, "nous.db"))!;
    const f = path.join(projDir, "secret.jsonl");
    fs.writeFileSync(
      f,
      JSON.stringify({ type: "user", timestamp: "2026-07-01T10:00:00Z", message: { content: "delete me sensitive topic" } }) +
        "\n"
    );
    indexFile(db, f);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("previews without deleting when confirm is absent", () => {
    const r = handleForget({ session_id: "secret" }, db, [], DEFAULT_CONFIG);
    expect(r.text).toContain("Would forget");
    expect(Number(db.raw.prepare("SELECT COUNT(*) c FROM messages WHERE session_id='secret'").get()!.c)).toBe(1);
  });

  it("purges + tombstones on confirm, and blocks re-index resurrection", () => {
    handleForget({ session_id: "secret", confirm: true }, db, [], DEFAULT_CONFIG);
    expect(Number(db.raw.prepare("SELECT COUNT(*) c FROM messages WHERE session_id='secret'").get()!.c)).toBe(0);
    expect(isTombstoned(db, "secret")).toBe(true);
    // re-index the same untouched file -> must NOT restore
    indexFile(db, path.join(projDir, "secret.jsonl"));
    expect(Number(db.raw.prepare("SELECT COUNT(*) c FROM messages WHERE session_id='secret'").get()!.c)).toBe(0);
  });

  it("finds sessions by query", () => {
    const r = handleForget({ query: "sensitive" }, db, [], DEFAULT_CONFIG);
    expect(r.text).toContain("Would forget");
  });
});
