import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleSearch } from "../../src/tools/search.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("handleSearch", () => {
  let tmpDir: string;
  let memA: string;
  let memB: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-test-"));
    memA = path.join(tmpDir, "a", "memory");
    memB = path.join(tmpDir, "b", "memory");
    fs.mkdirSync(memA, { recursive: true });
    fs.mkdirSync(memB, { recursive: true });
    fs.writeFileSync(path.join(memA, "feedback_fk.md"), "---\nT:fb | FK CASCADE\nD:FK desc\n---\nrule: FK");
    fs.writeFileSync(path.join(memA, "project_gp.md"), "---\nT:proj | GP\nD:GP desc\n---\nGP sync");
    fs.writeFileSync(path.join(memB, "feedback_auth.md"), "---\nT:fb | Auth\nD:auth rules\n---\nrule: auth");
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("searches across projects", () => {
    const result = handleSearch({ query: "FK" }, [{ projectHash: "a", memoryDir: memA }, { projectHash: "b", memoryDir: memB }]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].name).toBe("FK CASCADE");
  });

  it("filters by type", () => {
    const result = handleSearch({ query: "", type: "fb" }, [{ projectHash: "a", memoryDir: memA }, { projectHash: "b", memoryDir: memB }]);
    expect(result.matches).toHaveLength(2);
  });

  it("filters by project", () => {
    const result = handleSearch({ query: "", project: "b" }, [{ projectHash: "a", memoryDir: memA }, { projectHash: "b", memoryDir: memB }]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].project).toBe("b");
  });
});
