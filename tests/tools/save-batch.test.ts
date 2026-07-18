import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleSave } from "../../src/tools/save.js";
import { DEFAULT_CONFIG, type NousConfig } from "../../src/lib/config.js";

describe("handleSave dry-run + anti-thrash + near-dup", () => {
  let tmpDir: string;
  let memDir: string;
  let config: NousConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-save-batch-"));
    memDir = path.join(tmpDir, "memory");
    fs.mkdirSync(memDir, { recursive: true });
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("dryRun validates without writing", () => {
    const res = handleSave(
      { name: "Dry", type: "fb", description: "d", content: "rule: a->b :: c\n(+) x" },
      memDir,
      config,
      { dryRun: true }
    );
    expect(res.isError).toBeFalsy();
    expect(res.text).toContain("dry run");
    expect(fs.existsSync(path.join(memDir, res.filename))).toBe(false);
    expect(fs.existsSync(path.join(memDir, "MEMORY.md"))).toBe(false);
  });

  it("dryRun still rejects an over-cap body", () => {
    const res = handleSave(
      { name: "Big", type: "fb", description: "d", content: "x".repeat(config.caps.fb + 1) },
      memDir,
      config,
      { dryRun: true }
    );
    expect(res.isError).toBe(true);
    expect(fs.readdirSync(memDir)).toHaveLength(0);
  });

  it("returns terminal anti-thrash guidance after repeated over-cap failures", () => {
    const spec = {
      name: "Thrash Unique Zq",
      type: "fb" as const,
      description: "d",
      content: "y".repeat(config.caps.fb + 1),
    };
    let last = handleSave(spec, memDir, config);
    expect(last.text).toContain("Cap exceeded");
    for (let i = 0; i < 3; i++) last = handleSave(spec, memDir, config);
    expect(last.isError).toBe(true);
    expect(last.text).toContain("STOP retrying");
  });

  it("warns on near-duplicate content instead of blocking", () => {
    const base =
      "rule: vite proxy entries required for new daemon routes :: dev server 404s otherwise\n" +
      "(+) adding any new daemon endpoint\napply: update vite.config.ts proxy map & restart dev server";
    const first = handleSave(
      { name: "Vite Proxy", type: "fb", description: "d", content: base },
      memDir,
      config
    );
    expect(first.isError).toBeFalsy();

    const reworded = base.replace("restart dev server", "restart the dev server always");
    const second = handleSave(
      { name: "Vite Proxy Two", type: "fb", description: "d", content: reworded },
      memDir,
      config
    );
    expect(second.isError).toBeFalsy();
    expect(second.warnings.some((w) => w.includes("near-duplicate"))).toBe(true);
  });

  it("warns when overwriting a file that is not in Nous format", () => {
    const filePath = path.join(memDir, "feedback_mangled.md");
    fs.writeFileSync(filePath, "just some hand-written notes, no frontmatter\n");
    const res = handleSave(
      { name: "Mangled", type: "fb", description: "d", content: "rule: a->b :: c\n(+) x" },
      memDir,
      config
    );
    expect(res.isError).toBeFalsy();
    expect(res.warnings.some((w) => w.includes("not in Nous format"))).toBe(true);
    // prior content is preserved in .backups
    const backups = fs.readdirSync(path.join(memDir, ".backups"));
    expect(backups.length).toBeGreaterThan(0);
  });
});
