import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleCheck } from "../../src/tools/check.js";
import { handleSave } from "../../src/tools/save.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("recall_check — lifecycle + caps", () => {
  let tmpDir: string;
  let dirs: { projectHash: string; memoryDir: string }[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-checkv06-"));
    fs.writeFileSync(path.join(tmpDir, "REGISTRY.md"), "");
    dirs = [{ projectHash: "p", memoryDir: tmpDir }];
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("reports lifecycle state counts", () => {
    handleSave({ name: "A", type: "proj", description: "d", content: "x->y :: z" }, tmpDir, DEFAULT_CONFIG);
    const f = path.join(tmpDir, "project_a.md");
    fs.writeFileSync(f, fs.readFileSync(f, "utf-8").replace("  nous:", "  nous:\n    state: archived"));
    const r = handleCheck({ checks: ["lifecycle"] }, dirs, DEFAULT_CONFIG);
    expect(r.text).toContain("archived: 1");
    expect(r.text).toContain("'A'");
  });

  it("flags an over-cap memory in the caps check", () => {
    const cfg = { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, proj: 40 } };
    // write a bloated file directly (bypassing save's cap)
    const f = path.join(tmpDir, "project_big.md");
    fs.writeFileSync(
      f,
      `---\nname: big\ndescription: "d"\nmetadata:\n  node_type: memory\n  type: proj\n  nous:\n    accessCount: 0\n---\n${"x->y :: z ".repeat(20)}\n`
    );
    const r = handleCheck({ checks: ["caps"] }, dirs, cfg);
    expect(r.text).toMatch(/over by \d+/);
    expect(r.text).toContain("'big'");
  });

  it("caps check passes when all within budget", () => {
    handleSave({ name: "Small", type: "proj", description: "d", content: "x->y :: z" }, tmpDir, DEFAULT_CONFIG);
    const r = handleCheck({ checks: ["caps"] }, dirs, DEFAULT_CONFIG);
    expect(r.text).toContain("within budget");
  });
});

describe("global user.md routing", () => {
  let projDir: string;
  let globalDir: string;

  beforeEach(() => {
    projDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-proj-"));
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-global-"));
    fs.writeFileSync(path.join(projDir, "REGISTRY.md"), "");
  });
  afterEach(() => {
    fs.rmSync(projDir, { recursive: true, force: true });
    fs.rmSync(globalDir, { recursive: true, force: true });
  });

  it("writes the user profile to the global dir, not the project, and skips the project index", () => {
    const cfg = { ...DEFAULT_CONFIG, userMemory: { ...DEFAULT_CONFIG.userMemory, dir: globalDir } };
    const res = handleSave(
      { name: "user", type: "usr", description: "profile", content: "Connor -> midwest :: IT" },
      projDir,
      cfg
    );
    expect(res.isError).toBeFalsy();
    expect(fs.existsSync(path.join(globalDir, "user.md"))).toBe(true);
    expect(fs.existsSync(path.join(projDir, "user.md"))).toBe(false);
    // not added to the project's MEMORY.md
    const idxPath = path.join(projDir, "MEMORY.md");
    if (fs.existsSync(idxPath)) {
      expect(fs.readFileSync(idxPath, "utf-8")).not.toContain("user.md");
    }
  });
});
