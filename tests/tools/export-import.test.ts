import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleExport } from "../../src/tools/export.js";
import { handleImport } from "../../src/tools/import.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";
import { serializeHeader, parseHeader, type MemoryHeader } from "../../src/lib/parser.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SAMPLE = "---\nT:fb | FK CASCADE\nD:desc\nC:2026-01-01\nA:3\n---\nrule: FK->$emp.id\n:: r\n(+) t";

describe("handleExport + handleImport round-trip", () => {
  let tmpDir: string;
  let memDir: string;
  let exportPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-test-"));
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

  it("preserves lifecycle metadata through a round-trip (current-format header)", () => {
    const header: MemoryHeader = {
      type: "proj",
      name: "Nova Email",
      description: "Gmail client module",
      created: "2026-02-01",
      updated: "2026-05-10",
      accessCount: 7,
      links: ["project_nova"],
      state: "stale",
    };
    fs.writeFileSync(
      path.join(memDir, "project_nova_email.md"),
      `${serializeHeader(header)}\nowa parity A-F :: done\n`
    );

    handleExport({ outputPath: exportPath }, [{ projectHash: "proj", memoryDir: memDir }], "REGISTRY.md");
    const freshDir = path.join(tmpDir, "fresh-meta", "memory");
    fs.mkdirSync(freshDir, { recursive: true });
    const res = handleImport({ file: exportPath }, freshDir, DEFAULT_CONFIG);
    expect(res.isError).toBeFalsy();

    const reparsed = parseHeader(
      fs.readFileSync(path.join(freshDir, "project_nova_email.md"), "utf-8")
    )!;
    expect(reparsed.created).toBe("2026-02-01");
    expect(reparsed.updated).toBe("2026-05-10");
    expect(reparsed.accessCount).toBe(7);
    expect(reparsed.links).toEqual(["project_nova"]);
    expect(reparsed.state).toBe("stale");
  });

  it("writes the CURRENT header format (not legacy T:/D:) and updates MEMORY.md", () => {
    handleExport({ outputPath: exportPath }, [{ projectHash: "proj", memoryDir: memDir }], "REGISTRY.md");
    const freshDir = path.join(tmpDir, "fresh-fmt", "memory");
    fs.mkdirSync(freshDir, { recursive: true });
    handleImport({ file: exportPath }, freshDir, DEFAULT_CONFIG);

    const raw = fs.readFileSync(path.join(freshDir, "feedback_fk_cascade.md"), "utf-8");
    expect(raw).toContain("metadata:");
    expect(raw).toContain("  nous:");
    expect(raw).not.toMatch(/^T:/m);

    const index = fs.readFileSync(path.join(freshDir, "MEMORY.md"), "utf-8");
    expect(index).toContain("(feedback_fk_cascade.md)");
  });

  it("skips identical content under a different filename (content dedup)", () => {
    handleExport({ outputPath: exportPath }, [{ projectHash: "proj", memoryDir: memDir }], "REGISTRY.md");
    const data = JSON.parse(fs.readFileSync(exportPath, "utf-8"));
    data.memories.push({ ...data.memories[0], filename: "feedback_fk_cascade_copy.md" });
    fs.writeFileSync(exportPath, JSON.stringify(data));

    const freshDir = path.join(tmpDir, "fresh-dup", "memory");
    fs.mkdirSync(freshDir, { recursive: true });
    const res = handleImport({ file: exportPath }, freshDir, DEFAULT_CONFIG);
    expect(res.text).toContain("duplicate content");
    expect(fs.existsSync(path.join(freshDir, "feedback_fk_cascade_copy.md"))).toBe(false);
  });

  it("blocks entries with invisible-unicode threats instead of writing them", () => {
    handleExport({ outputPath: exportPath }, [{ projectHash: "proj", memoryDir: memDir }], "REGISTRY.md");
    const data = JSON.parse(fs.readFileSync(exportPath, "utf-8"));
    data.memories[0].content = "rule: safe​ :: hidden zero-width";
    fs.writeFileSync(exportPath, JSON.stringify(data));

    const freshDir = path.join(tmpDir, "fresh-threat", "memory");
    fs.mkdirSync(freshDir, { recursive: true });
    const res = handleImport({ file: exportPath }, freshDir, DEFAULT_CONFIG);
    expect(res.text).toContain("BLOCKED");
    expect(fs.existsSync(path.join(freshDir, "feedback_fk_cascade.md"))).toBe(false);
  });

  it("rejects unsafe filenames (path traversal) as invalid", () => {
    const payload = {
      version: 1,
      memories: [
        {
          filename: "../evil.md",
          header: { type: "fb", name: "evil", description: "x" },
          content: "rule: x :: y",
        },
      ],
    };
    const p = path.join(tmpDir, "evil.json");
    fs.writeFileSync(p, JSON.stringify(payload));
    const freshDir = path.join(tmpDir, "fresh-evil", "memory");
    fs.mkdirSync(freshDir, { recursive: true });
    const res = handleImport({ file: p }, freshDir, DEFAULT_CONFIG);
    expect(res.text).toContain("invalid entry");
    expect(fs.existsSync(path.join(tmpDir, "fresh-evil", "evil.md"))).toBe(false);
  });

  it("honors the project filter", () => {
    handleExport({ outputPath: exportPath }, [{ projectHash: "proj", memoryDir: memDir }], "REGISTRY.md");
    const freshDir = path.join(tmpDir, "fresh-filter", "memory");
    fs.mkdirSync(freshDir, { recursive: true });
    const res = handleImport({ file: exportPath, project: "other-proj" }, freshDir, DEFAULT_CONFIG);
    expect(res.text).toContain("Imported 0");
  });
});
