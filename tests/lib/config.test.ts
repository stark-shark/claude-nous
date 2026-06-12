import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, DEFAULT_CONFIG } from "../../src/lib/config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(path.join(tmpDir, "recall.config.jsonc"));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges user config over defaults", () => {
    const configPath = path.join(tmpDir, "recall.config.jsonc");
    fs.writeFileSync(configPath, JSON.stringify({ notationEnforcement: "strict" }));
    const config = loadConfig(configPath);
    expect(config.notationEnforcement).toBe("strict");
    expect(config.maintainIndex).toBe(true);
  });

  it("strips JSONC comments before parsing", () => {
    const configPath = path.join(tmpDir, "recall.config.jsonc");
    fs.writeFileSync(configPath, '{\n  // This is a comment\n  "maintainIndex": false\n}');
    const config = loadConfig(configPath);
    expect(config.maintainIndex).toBe(false);
  });

  it("tolerates a UTF-8 BOM (PowerShell 5.1 -Encoding utf8 writes one)", () => {
    const configPath = path.join(tmpDir, "recall.config.jsonc");
    fs.writeFileSync(configPath, "\u{FEFF}" + '{\n  // comment\n  "indexMaxLines": 400\n}');
    const config = loadConfig(configPath);
    expect(config.indexMaxLines).toBe(400);
  });
});
