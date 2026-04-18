import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleExport } from "../../src/tools/export.js";
import { handleImport } from "../../src/tools/import.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SAMPLE = "---\nT:fb | FK CASCADE\nD:desc\nC:2026-01-01\nA:3\n---\nrule: FK->$emp.id\n:: r\n(+) t";

describe("handleExport + handleImport round-trip", () => {
  let tmpDir: string;
  let memDir: string;
  let exportPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-test-"));
    memDir = path.join(tmpDir, "proj", "memory");
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "feedback_fk_cascade.md"), SAMPLE);
    fs.writeFileSync(path.join(memDir, "REGISTRY.md"), "$emp = employees\n");
    exportPath = path.join(tmpDir, "export.json");
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("exports to valid v1 JSON", () => {
    const res = handleExport({ outputPath: exportPath }, [{ projectHash: "proj", memoryDir: memDir }], "REGISTRY.md");
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(fs.readFileSync(exportPath, "utf-8"));
    expect(data.version).toBe(1);
    expect(data.memories).toHaveLength(1);
    expect(data.memories[0].header.name).toBe("FK CASCADE");
    expect(data.registry["$emp"]).toBe("employees");
  });

  it("imports previously-exported data into a fresh dir", () => {
    handleExport({ outputPath: exportPath }, [{ projectHash: "proj", memoryDir: memDir }], "REGISTRY.md");

    const freshDir = path.join(tmpDir, "fresh", "memory");
    fs.mkdirSync(freshDir, { recursive: true });
    const res = handleImport({ file: exportPath }, freshDir, DEFAULT_CONFIG);

    expect(res.isError).toBeFalsy();
    expect(res.text).toContain("Imported 1");
    expect(fs.existsSync(path.join(freshDir, "feedback_fk_cascade.md"))).toBe(true);
    expect(fs.readFileSync(path.join(freshDir, "REGISTRY.md"), "utf-8")).toContain("$emp = employees");
  });

  it("skips memories whose filename already exists on import", () => {
    handleExport({ outputPath: exportPath }, [{ projectHash: "proj", memoryDir: memDir }], "REGISTRY.md");
    const res = handleImport({ file: exportPath }, memDir, DEFAULT_CONFIG);
    expect(res.isError).toBeFalsy();
    expect(res.text).toContain("skipped");
  });

  it("returns a structured error on invalid JSON rather than crashing", () => {
    const badPath = path.join(tmpDir, "broken.json");
    fs.writeFileSync(badPath, "{not valid json");
    const freshDir = path.join(tmpDir, "fresh2");
    fs.mkdirSync(freshDir, { recursive: true });
    const res = handleImport({ file: badPath }, freshDir, DEFAULT_CONFIG);
    expect(res.isError).toBe(true);
    expect(res.text).toContain("Invalid JSON");
  });

  it("rejects unsupported export versions", () => {
    const badPath = path.join(tmpDir, "v99.json");
    fs.writeFileSync(badPath, JSON.stringify({ version: 99, memories: [] }));
    const freshDir = path.join(tmpDir, "fresh3");
    fs.mkdirSync(freshDir, { recursive: true });
    const res = handleImport({ file: badPath }, freshDir, DEFAULT_CONFIG);
    expect(res.isError).toBe(true);
    expect(res.text).toContain("Unsupported export version");
  });

  it("returns an error for a missing file", () => {
    const res = handleImport({ file: path.join(tmpDir, "nope.json") }, memDir, DEFAULT_CONFIG);
    expect(res.isError).toBe(true);
  });
});
