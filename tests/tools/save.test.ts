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
    expect(written).toContain("name: fk-cascade");
    expect(written).toContain('humanName: "FK CASCADE"');
    expect(written).toContain("type: fb");
    expect(written).toContain("accessCount: 0");
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

  it("archives overflow entries to MEMORY_ARCHIVE.md instead of deleting them", () => {
    const cappedConfig = { ...DEFAULT_CONFIG, indexMaxLines: 3 };
    for (let i = 0; i < 5; i++) {
      handleSave(
        { name: `M${i}`, type: "fb", description: "d", content: `rule: ${i}\n:: r\n(+) t` },
        tmpDir,
        cappedConfig
      );
    }
    const index = fs.readFileSync(path.join(tmpDir, "MEMORY.md"), "utf-8");
    const archive = fs.readFileSync(path.join(tmpDir, "MEMORY_ARCHIVE.md"), "utf-8");
    // Oldest two rotated out, newest three kept
    expect(index).not.toContain("(feedback_m0.md)");
    expect(index).not.toContain("(feedback_m1.md)");
    expect(index).toContain("M4");
    expect(archive).toContain("(feedback_m0.md)");
    expect(archive).toContain("(feedback_m1.md)");
  });

  it("counts entries, not raw lines, against indexMaxLines", () => {
    const indexPath = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(
      indexPath,
      "# Memory Index\n\n## Section A\n\n## Section B\n\n## Section C\n",
      "utf-8"
    );
    const cappedConfig = { ...DEFAULT_CONFIG, indexMaxLines: 3 };
    for (let i = 0; i < 3; i++) {
      handleSave(
        { name: `N${i}`, type: "fb", description: "d", content: `rule: ${i}\n:: r\n(+) t` },
        tmpDir,
        cappedConfig
      );
    }
    // 3 entries + 7 structural lines would exceed a LINE budget of 3, but no
    // archive should occur because only entries count.
    expect(fs.existsSync(path.join(tmpDir, "MEMORY_ARCHIVE.md"))).toBe(false);
    const index = fs.readFileSync(indexPath, "utf-8");
    expect(index).toContain("N0");
    expect(index).toContain("N2");
    expect(index).toContain("## Section C");
  });

  it("rejects content over the type cap with a consolidation error", () => {
    const cfg = { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, ref: 50 } };
    const result = handleSave(
      { name: "Big", type: "ref", description: "d", content: "x->y :: z ".repeat(20) },
      tmpDir,
      cfg
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Cap exceeded");
    expect(fs.existsSync(path.join(tmpDir, "reference_big.md"))).toBe(false);
  });

  it("adds a usage line on successful save", () => {
    const result = handleSave(
      { name: "Small", type: "ref", description: "d", content: "x->y :: z" },
      tmpDir,
      DEFAULT_CONFIG
    );
    expect(result.text).toMatch(/MEMORY\[ref\] \d+% — \d+\/\d+/);
  });

  it("routes the usr 'user' memory to user.md with the user cap", () => {
    const result = handleSave(
      { name: "user", type: "usr", description: "profile", content: "Connor -> midwest :: IT" },
      tmpDir,
      DEFAULT_CONFIG
    );
    expect(result.isError).toBeFalsy();
    expect(fs.existsSync(path.join(tmpDir, "user.md"))).toBe(true);
    expect(result.text).toMatch(/USER \d+%/);
  });

  it("hard-rejects content with invisible unicode", () => {
    const zwsp = String.fromCharCode(0x200b);
    const result = handleSave(
      { name: "Sneaky", type: "ref", description: "d", content: `x->y${zwsp} :: z` },
      tmpDir,
      DEFAULT_CONFIG
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("security scan");
  });
});
