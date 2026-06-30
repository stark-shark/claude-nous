import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleLoad } from "../../src/tools/load.js";
import { handleSave } from "../../src/tools/save.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";
import { parseHeader } from "../../src/lib/parser.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("resurrection-on-access", () => {
  let tmpDir: string;
  let dirs: { projectHash: string; memoryDir: string }[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-resurrect-"));
    fs.writeFileSync(path.join(tmpDir, "REGISTRY.md"), "");
    dirs = [{ projectHash: "p", memoryDir: tmpDir }];
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  function setState(file: string, state: string) {
    const c = fs.readFileSync(file, "utf-8").replace("  recall:", `  recall:\n    state: ${state}`);
    fs.writeFileSync(file, c);
  }

  it("revives an archived memory to active and re-adds it to MEMORY.md", () => {
    handleSave({ name: "Gone", type: "proj", description: "d", content: "x->y :: z" }, tmpDir, DEFAULT_CONFIG);
    const file = path.join(tmpDir, "project_gone.md");
    setState(file, "archived");
    // simulate archive removing it from the index
    const idx = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(idx, "# Memory Index\n");

    const res = handleLoad({ name: "Gone" }, dirs, DEFAULT_CONFIG);
    expect(res.text).toContain("resurrected");
    // "active" is the default state and is intentionally not serialized
    expect(parseHeader(fs.readFileSync(file, "utf-8"))?.state ?? "active").toBe("active");
    expect(fs.readFileSync(idx, "utf-8")).toContain("(project_gone.md)");
  });

  it("revives a stale memory to active without requiring re-index", () => {
    handleSave({ name: "Old", type: "proj", description: "d", content: "x->y :: z" }, tmpDir, DEFAULT_CONFIG);
    const file = path.join(tmpDir, "project_old.md");
    setState(file, "stale");
    handleLoad({ name: "Old" }, dirs, DEFAULT_CONFIG);
    expect(parseHeader(fs.readFileSync(file, "utf-8"))?.state ?? "active").toBe("active");
  });

  it("does not add a resurrection banner for a normal active memory", () => {
    handleSave({ name: "Fresh", type: "proj", description: "d", content: "x->y :: z" }, tmpDir, DEFAULT_CONFIG);
    const res = handleLoad({ name: "Fresh" }, dirs, DEFAULT_CONFIG);
    expect(res.text).not.toContain("resurrected");
  });
});
