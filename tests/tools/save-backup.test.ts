import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleSave } from "../../src/tools/save.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";

describe("handleSave backup-on-overwrite", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-savebak-"));
    fs.writeFileSync(path.join(dir, "REGISTRY.md"), "");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("first save creates no backup; overwrite backs up the prior body", () => {
    handleSave({ name: "Thing", type: "proj", description: "d", content: "v1 -> a" }, dir, DEFAULT_CONFIG);
    const backupsDir = path.join(dir, ".backups");
    expect(fs.existsSync(backupsDir)).toBe(false); // nothing to back up on create

    handleSave({ name: "Thing", type: "proj", description: "d", content: "v2 -> b" }, dir, DEFAULT_CONFIG);
    expect(fs.existsSync(backupsDir)).toBe(true);
    const baks = fs.readdirSync(backupsDir).filter((f) => f.endsWith(".bak"));
    expect(baks.length).toBe(1);
    // the backup holds the PRIOR (v1) content
    expect(fs.readFileSync(path.join(backupsDir, baks[0]), "utf-8")).toContain("v1 -> a");
  });

  it("does not back up when content is unchanged", () => {
    const same = { name: "Same", type: "proj" as const, description: "d", content: "x -> y" };
    handleSave(same, dir, DEFAULT_CONFIG);
    handleSave(same, dir, DEFAULT_CONFIG); // identical re-save
    const backupsDir = path.join(dir, ".backups");
    const baks = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).filter((f) => f.endsWith(".bak")) : [];
    expect(baks.length).toBe(0);
  });

  it("file override updates the EXACT (legacy-named) file when the name matches", () => {
    // A memory whose stored filename doesn't match current name->filename
    // derivation (name 'legacyslug' would derive project_legacyslug.md, but it
    // lives in oddfile.md). Same NAME, so no collision — the override must
    // update oddfile.md in place, not create the derived file.
    const exact = "oddfile.md";
    fs.writeFileSync(
      path.join(dir, exact),
      `---\nname: legacyslug\ndescription: "d"\nmetadata:\n  node_type: memory\n  type: proj\n  nous:\n    accessCount: 0\n---\nold body\n`
    );
    const r = handleSave(
      { name: "legacyslug", type: "proj", description: "d", content: "new body", file: exact },
      dir,
      DEFAULT_CONFIG
    );
    expect(r.isError).toBeFalsy();
    expect(r.filename).toBe(exact); // used the override
    expect(fs.readFileSync(path.join(dir, exact), "utf-8")).toContain("new body");
    expect(fs.existsSync(path.join(dir, "project_legacyslug.md"))).toBe(false); // not the derived name
    const baks = fs.readdirSync(path.join(dir, ".backups")).filter((f) => f.endsWith(".bak"));
    expect(baks.length).toBe(1); // backed up the prior body
  });

  it("collision guard still blocks overwriting a DIFFERENTLY-named memory's file", () => {
    fs.writeFileSync(
      path.join(dir, "owned.md"),
      `---\nname: owner\ndescription: "d"\nmetadata:\n  node_type: memory\n  type: proj\n  nous:\n    accessCount: 0\n---\nowned body\n`
    );
    const r = handleSave(
      { name: "intruder", type: "proj", description: "d", content: "x", file: "owned.md" },
      dir,
      DEFAULT_CONFIG
    );
    expect(r.isError).toBe(true); // refused — file belongs to 'owner'
    expect(fs.readFileSync(path.join(dir, "owned.md"), "utf-8")).toContain("owned body"); // untouched
  });

  it("rejects a path-traversal file override (falls back to derivation)", () => {
    const r = handleSave(
      { name: "safe", type: "proj", description: "d", content: "x", file: "../evil.md" },
      dir,
      DEFAULT_CONFIG
    );
    expect(r.filename).not.toContain("..");
    expect(fs.existsSync(path.join(dir, "..", "evil.md"))).toBe(false);
  });

  it("the .backups dir is not picked up as a memory (scan reads top-level .md only)", () => {
    handleSave({ name: "A", type: "proj", description: "d", content: "one" }, dir, DEFAULT_CONFIG);
    handleSave({ name: "A", type: "proj", description: "d", content: "two" }, dir, DEFAULT_CONFIG);
    // .backups contains .bak files, never .md — readers filter on .md
    const inBackups = fs.readdirSync(path.join(dir, ".backups"));
    expect(inBackups.every((f) => !f.endsWith(".md"))).toBe(true);
  });
});
