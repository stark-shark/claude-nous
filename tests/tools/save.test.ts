import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleSave } from "../../src/tools/save.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("handleSave", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-test-"));
    fs.writeFileSync(path.join(tmpDir, "REGISTRY.md"), "$hub = apps\n$emp = employees\n");
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("saves new memory with header", () => {
    const result = handleSave({ name: "FK CASCADE", type: "fb", description: "desc", content: "rule: FK\n:: reason\n(+) trigger" }, tmpDir, DEFAULT_CONFIG);
    expect(result.isError).toBeFalsy();
    const written = fs.readFileSync(path.join(tmpDir, "feedback_fk_cascade.md"), "utf-8");
    expect(written).toContain("T:fb | FK CASCADE");
    expect(written).toContain("A:0");
  });

  it("rejects duplicate", () => {
    handleSave({ name: "A", type: "fb", description: "d", content: "rule: x\n:: y\n(+) z" }, tmpDir, DEFAULT_CONFIG);
    const result = handleSave({ name: "B", type: "fb", description: "d", content: "rule: x\n:: y\n(+) z" }, tmpDir, DEFAULT_CONFIG);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Duplicate");
  });

  it("updates MEMORY.md", () => {
    handleSave({ name: "FK CASCADE", type: "fb", description: "desc", content: "rule: FK\n:: reason\n(+) trigger" }, tmpDir, DEFAULT_CONFIG);
    const index = fs.readFileSync(path.join(tmpDir, "MEMORY.md"), "utf-8");
    expect(index).toContain("[FK CASCADE]");
  });

  it("rejects slug collisions between distinct memory names", () => {
    handleSave({ name: "FK CASCADE", type: "fb", description: "desc", content: "rule: a\n:: b\n(+) c" }, tmpDir, DEFAULT_CONFIG);
    const result = handleSave({ name: "FK-CASCADE", type: "fb", description: "desc", content: "rule: x\n:: y\n(+) z" }, tmpDir, DEFAULT_CONFIG);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("collision");
  });

  it("treats a second save with the same name as an update", () => {
    handleSave({ name: "FK CASCADE", type: "fb", description: "v1", content: "rule: a\n:: b\n(+) c" }, tmpDir, DEFAULT_CONFIG);
    const result = handleSave({ name: "FK CASCADE", type: "fb", description: "v2", content: "rule: x\n:: y\n(+) z" }, tmpDir, DEFAULT_CONFIG);
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("Updated");
  });

  it("warns when the index hits indexMaxLines", () => {
    const cappedConfig = { ...DEFAULT_CONFIG, indexMaxLines: 3 };
    for (let i = 0; i < 5; i++) {
      handleSave(
        { name: `M${i}`, type: "fb", description: "d", content: `rule: ${i}\n:: r\n(+) t` },
        tmpDir,
        cappedConfig
      );
    }
    const last = handleSave(
      { name: "LAST", type: "fb", description: "d", content: "rule: z\n:: r\n(+) t" },
      tmpDir,
      cappedConfig
    );
    expect(last.warnings.some((w) => w.includes("indexMaxLines"))).toBe(true);
    const index = fs.readFileSync(path.join(tmpDir, "MEMORY.md"), "utf-8");
    expect(index).toContain("LAST");
  });
});
