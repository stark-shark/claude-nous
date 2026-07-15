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

  it("the .backups dir is not picked up as a memory (scan reads top-level .md only)", () => {
    handleSave({ name: "A", type: "proj", description: "d", content: "one" }, dir, DEFAULT_CONFIG);
    handleSave({ name: "A", type: "proj", description: "d", content: "two" }, dir, DEFAULT_CONFIG);
    // .backups contains .bak files, never .md — readers filter on .md
    const inBackups = fs.readdirSync(path.join(dir, ".backups"));
    expect(inBackups.every((f) => !f.endsWith(".md"))).toBe(true);
  });
});
