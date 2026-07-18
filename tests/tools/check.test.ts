import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleCheck } from "../../src/tools/check.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const BODY = "rule: FK->$emp.id\n:: reason\n(+) trigger";

function writeMemory(dir: string, filename: string, header: string, body: string = BODY): void {
  fs.writeFileSync(path.join(dir, filename), `---\n${header}\n---\n${body}`);
}

describe("handleCheck", () => {
  let tmpDir: string;
  let memDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-test-"));
    memDir = path.join(tmpDir, "proj", "memory");
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "REGISTRY.md"), "$emp = employees\n");
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("stats reports counts by type", () => {
    writeMemory(memDir, "feedback_a.md", "T:fb | A\nD:d\nA:5");
    writeMemory(memDir, "project_b.md", "T:proj | B\nD:d\nA:2");
    const res = handleCheck({ checks: ["stats"] }, [{ projectHash: "proj", memoryDir: memDir }], DEFAULT_CONFIG);
    expect(res.text).toContain("Memories: 2");
    expect(res.text).toContain("feedback: 1");
    expect(res.text).toContain("project: 1");
  });

  it("stale flags old, rarely-used memories", () => {
    writeMemory(memDir, "feedback_old.md", "T:fb | Old\nD:d\nU:2020-01-01\nA:0");
    writeMemory(memDir, "feedback_new.md", `T:fb | New\nD:d\nU:${new Date().toISOString().slice(0, 10)}\nA:5`);
    const res = handleCheck({ checks: ["stale"] }, [{ projectHash: "proj", memoryDir: memDir }], DEFAULT_CONFIG);
    expect(res.text).toContain("'Old'");
    expect(res.text).not.toContain("'New'");
  });

  it("registry flags unknown entities and unused registry entries", () => {
    writeMemory(memDir, "feedback_a.md", "T:fb | A\nD:d", "rule: use $unknown here\n:: r\n(+) t");
    const res = handleCheck({ checks: ["registry"] }, [{ projectHash: "proj", memoryDir: memDir }], DEFAULT_CONFIG);
    expect(res.text).toContain("unknown entities");
    expect(res.text).toContain("$unknown");
    expect(res.text).toContain("$emp");
    expect(res.text).toContain("not referenced");
  });

  it("links flags broken intra-project and cross-project references", () => {
    writeMemory(memDir, "feedback_a.md", "T:fb | A\nD:d\nL:feedback_missing, other-proj::feedback_x");
    const res = handleCheck({ checks: ["links"] }, [{ projectHash: "proj", memoryDir: memDir }], DEFAULT_CONFIG);
    expect(res.text).toContain("feedback_missing");
    expect(res.text).toContain("other-proj");
  });

  it("links resolves cross-project references that do exist", () => {
    const other = path.join(tmpDir, "other", "memory");
    fs.mkdirSync(other, { recursive: true });
    writeMemory(other, "feedback_x.md", "T:fb | X\nD:d");
    writeMemory(memDir, "feedback_a.md", "T:fb | A\nD:d\nL:other::feedback_x");
    const res = handleCheck(
      { checks: ["links"] },
      [
        { projectHash: "proj", memoryDir: memDir },
        { projectHash: "other", memoryDir: other },
      ],
      DEFAULT_CONFIG
    );
    expect(res.text).toContain("no broken references");
  });

  it("duplicates groups memories with identical bodies", () => {
    writeMemory(memDir, "feedback_a.md", "T:fb | A\nD:d");
    writeMemory(memDir, "feedback_b.md", "T:fb | B\nD:d");
    const res = handleCheck({ checks: ["duplicates"] }, [{ projectHash: "proj", memoryDir: memDir }], DEFAULT_CONFIG);
    expect(res.text).toContain("'A'");
    expect(res.text).toContain("'B'");
  });

  it("compression reports no issues section without crashing", () => {
    writeMemory(memDir, "feedback_a.md", "T:fb | A\nD:d");
    const res = handleCheck({ checks: ["compression"] }, [{ projectHash: "proj", memoryDir: memDir }], DEFAULT_CONFIG);
    expect(res.text).toContain("Compression");
  });
});
