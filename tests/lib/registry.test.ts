import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadRegistry, saveRegistry, addEntry, isValidCode } from "../../src/lib/registry.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("isValidCode", () => {
  it.each([
    ["$emp", true],
    ["$auth-flow", true],
    ["$v2", true],
    ["emp", false],
    ["$", false],
    ["$bad.code", false],
    ["$bad code", false],
    ["", false],
  ])("code %s -> %s", (code, valid) => {
    expect(isValidCode(code)).toBe(valid);
  });
});

describe("addEntry", () => {
  it("rejects codes with regex metacharacters", () => {
    const r = new Map<string, string>();
    expect(addEntry(r, "$api.v2", "v2 api").ok).toBe(false);
  });

  it("trims the expansion", () => {
    const r = new Map<string, string>();
    addEntry(r, "$x", "  alpha  ");
    expect(r.get("$x")).toBe("alpha");
  });
});

describe("saveRegistry round-trip with tricky codes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-test-"));
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("updates an entry with hyphens without duplicating", () => {
    const p = path.join(tmpDir, "REGISTRY.md");
    const r = new Map<string, string>();
    r.set("$auth-flow", "first");
    saveRegistry(p, r);

    // Reload and mutate
    const reloaded = loadRegistry(p);
    reloaded.set("$auth-flow", "second");
    saveRegistry(p, reloaded);

    const contents = fs.readFileSync(p, "utf-8");
    const occurrences = contents.split("$auth-flow = ").length - 1;
    expect(occurrences).toBe(1);
    expect(contents).toContain("$auth-flow = second");
  });
});
