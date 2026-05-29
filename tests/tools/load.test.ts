import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleLoad } from "../../src/tools/load.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SAMPLE = "---\nT:fb | FK CASCADE\nD:desc\nA:5\n---\nrule: FK->$emp.id\n:: reason\n(+) trigger";

describe("handleLoad", () => {
  let tmpDir: string;
  let memDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-test-"));
    memDir = path.join(tmpDir, "proj", "memory");
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "feedback_fk_cascade.md"), SAMPLE);
    fs.writeFileSync(path.join(memDir, "REGISTRY.md"), "$emp = employees\n");
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("loads by name", () => {
    const result = handleLoad({ name: "FK CASCADE" }, [{ projectHash: "proj", memoryDir: memDir }], DEFAULT_CONFIG);
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("FK->$emp.id");
  });

  it("increments access count", () => {
    handleLoad({ name: "FK CASCADE" }, [{ projectHash: "proj", memoryDir: memDir }], DEFAULT_CONFIG);
    const updated = fs.readFileSync(path.join(memDir, "feedback_fk_cascade.md"), "utf-8");
    expect(updated).toContain("accessCount: 6");
  });

  it("returns error for nonexistent", () => {
    const result = handleLoad({ name: "nope" }, [{ projectHash: "proj", memoryDir: memDir }], DEFAULT_CONFIG);
    expect(result.isError).toBe(true);
  });
});
