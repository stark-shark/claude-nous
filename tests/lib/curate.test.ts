import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runScan } from "../../src/lib/curate.js";
import { handleSave } from "../../src/tools/save.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";
import { parseHeader } from "../../src/lib/parser.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DAY = 24 * 60 * 60 * 1000;

describe("runScan (curator)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-curate-"));
    fs.writeFileSync(path.join(tmpDir, "REGISTRY.md"), "");
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  function write(name: string, body: string, updated: string, access = 0) {
    handleSave({ name, type: "proj", description: "d", content: body }, tmpDir, DEFAULT_CONFIG);
    const file = path.join(tmpDir, `project_${name.toLowerCase()}.md`);
    let c = fs.readFileSync(file, "utf-8");
    c = c.replace(/updated: .*/, `updated: ${updated}`).replace(/accessCount: \d+/, `accessCount: ${access}`);
    fs.writeFileSync(file, c);
    return file;
  }

  function iso(daysAgo: number, now: number) {
    return new Date(now - daysAgo * DAY).toISOString().slice(0, 10);
  }

  it("marks old, rarely-accessed memory stale then archived", () => {
    const now = Date.UTC(2026, 5, 28);
    const f = write("old", "x->y :: z", iso(40, now), 0); // 40d > staleDays(30)
    let r = runScan([{ projectHash: "p", memoryDir: tmpDir }], DEFAULT_CONFIG, now);
    expect(r.toStale).toContain("old");
    expect(parseHeader(fs.readFileSync(f, "utf-8"))?.state).toBe("stale");

    // 70d > staleDays+archiveAfter (30+30=60)
    const now2 = now;
    fs.writeFileSync(f, fs.readFileSync(f, "utf-8").replace(/updated: .*/, `updated: ${iso(70, now2)}`));
    r = runScan([{ projectHash: "p", memoryDir: tmpDir }], DEFAULT_CONFIG, now2);
    expect(r.toArchived).toContain("old");
    expect(parseHeader(fs.readFileSync(f, "utf-8"))?.state).toBe("archived");
  });

  it("does not demote frequently-accessed memory", () => {
    const now = Date.UTC(2026, 5, 28);
    write("hot", "x->y :: z", iso(90, now), 10);
    const r = runScan([{ projectHash: "p", memoryDir: tmpDir }], DEFAULT_CONFIG, now);
    expect(r.toStale).not.toContain("hot");
    expect(r.toArchived).not.toContain("hot");
  });

  it("archived memory is removed from MEMORY.md index", () => {
    const now = Date.UTC(2026, 5, 28);
    write("gone", "x->y :: z", iso(90, now), 0);
    runScan([{ projectHash: "p", memoryDir: tmpDir }], DEFAULT_CONFIG, now);
    const index = fs.readFileSync(path.join(tmpDir, "MEMORY.md"), "utf-8");
    expect(index).not.toContain("(project_gone.md)");
  });

  it("never archives the always-loaded user.md", () => {
    const now = Date.UTC(2026, 5, 28);
    const file = path.join(tmpDir, "user.md");
    fs.writeFileSync(
      file,
      `---\nname: user\ndescription: "profile"\nmetadata:\n  node_type: memory\n  type: usr\n  nous:\n    updated: ${iso(365, now)}\n    accessCount: 0\n---\nConnor -> midwest :: IT\n`
    );
    const r = runScan([{ projectHash: "p", memoryDir: tmpDir }], DEFAULT_CONFIG, now);
    expect(r.toStale).not.toContain("user");
    expect(r.toArchived).not.toContain("user");
    expect(parseHeader(fs.readFileSync(file, "utf-8"))?.state ?? "active").toBe("active");
  });

  it("escalates over-cap memory instead of mutating it", () => {
    const now = Date.UTC(2026, 5, 28);
    const big = "x->y :: z ".repeat(300); // > proj cap 2200
    const cfg = { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps } };
    // write directly to bypass save's cap (simulate a pre-existing bloated file)
    const file = path.join(tmpDir, "project_big.md");
    fs.writeFileSync(file, `---\nname: big\ndescription: "d"\nmetadata:\n  node_type: memory\n  type: proj\n  nous:\n    updated: ${iso(1, now)}\n    accessCount: 0\n---\n${big}\n`);
    const r = runScan([{ projectHash: "p", memoryDir: tmpDir }], cfg, now);
    expect(r.overCap.some((s) => s.startsWith("big"))).toBe(true);
    // body untouched
    expect(fs.readFileSync(file, "utf-8")).toContain(big);
  });
});
