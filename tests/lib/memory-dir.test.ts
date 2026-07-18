import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { projectPathToHash, getMemoryDir, discoverAllMemoryDirs } from "../../src/lib/memory-dir.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("projectPathToHash", () => {
  it("converts Windows path to hash", () => {
    expect(projectPathToHash("C:\\Users\\ConnorStark\\appDevelopment")).toBe("C--Users-ConnorStark-appDevelopment");
  });

  it("converts Unix path to hash", () => {
    expect(projectPathToHash("/home/user/projects")).toBe("-home-user-projects");
  });
});

describe("getMemoryDir", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-test-")); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("returns path when memory dir exists", () => {
    const memDir = path.join(tmpDir, "hash", "memory");
    fs.mkdirSync(memDir, { recursive: true });
    expect(getMemoryDir("hash", tmpDir)).toBe(memDir);
  });

  it("returns null when not exists", () => {
    expect(getMemoryDir("nope", tmpDir)).toBeNull();
  });
});

describe("discoverAllMemoryDirs", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-test-")); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("finds all project memory dirs", () => {
    fs.mkdirSync(path.join(tmpDir, "a", "memory"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "b", "memory"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "c"), { recursive: true });
    const result = discoverAllMemoryDirs(tmpDir);
    expect(result).toHaveLength(2);
  });
});
