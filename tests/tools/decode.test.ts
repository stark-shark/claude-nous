import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleDecode } from "../../src/tools/decode.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SAMPLE = "---\nT:fb | FK CASCADE\nD:desc\n---\nrule: FK->$emp.id\n:: reason\n(+) trigger";
const SECOND = "---\nT:proj | Other\nD:other desc\n---\nbody with $emp";

describe("handleDecode", () => {
  let tmpDir: string;
  let memDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-test-"));
    memDir = path.join(tmpDir, "proj", "memory");
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "feedback_fk_cascade.md"), SAMPLE);
    fs.writeFileSync(path.join(memDir, "project_other.md"), SECOND);
    fs.writeFileSync(path.join(memDir, "REGISTRY.md"), "$emp = employees\n");
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("decodes a memory by name and expands registry", () => {
    const result = handleDecode({ name: "FK CASCADE" }, [{ projectHash: "proj", memoryDir: memDir }]);
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("employees");
    expect(result.text).toContain("Because:");
    expect(result.text).toContain("Apply when:");
  });

  it("returns error when memory not found", () => {
    const result = handleDecode({ name: "nope" }, [{ projectHash: "proj", memoryDir: memDir }]);
    expect(result.isError).toBe(true);
  });

  it("decodes all memories with all=true", () => {
    const result = handleDecode({ all: true }, [{ projectHash: "proj", memoryDir: memDir }]);
    expect(result.text).toContain("FK CASCADE");
    expect(result.text).toContain("Other");
  });

  it("requires name, file, or all", () => {
    const result = handleDecode({}, [{ projectHash: "proj", memoryDir: memDir }]);
    expect(result.isError).toBe(true);
  });
});
