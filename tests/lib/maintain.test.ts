import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scanCapPressure, condensePrompt } from "../../src/lib/maintain.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";

function mem(name: string, type: string, bodyLen: number): string {
  return (
    `---\nname: ${name}\ndescription: "d"\nmetadata:\n  node_type: memory\n  type: ${type}\n  nous:\n    accessCount: 0\n---\n` +
    "x".repeat(bodyLen) +
    "\n"
  );
}

describe("scanCapPressure", () => {
  let dir: string;
  let dirs: { projectHash: string; memoryDir: string }[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-maint-"));
    dirs = [{ projectHash: "p", memoryDir: dir }];
    // proj cap = 2200
    fs.writeFileSync(path.join(dir, "over.md"), mem("over", "proj", 3000)); // over cap
    fs.writeFileSync(path.join(dir, "near.md"), mem("near", "proj", 2100)); // ~95%
    fs.writeFileSync(path.join(dir, "fine.md"), mem("fine", "proj", 500)); // well under
    fs.writeFileSync(path.join(dir, "MEMORY.md"), "# index"); // ignored
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("overOnly returns only strictly-over-cap memories", () => {
    const r = scanCapPressure(dirs, DEFAULT_CONFIG, { overOnly: true });
    expect(r.map((m) => m.name)).toEqual(["over"]);
    expect(r[0].over).toBeGreaterThan(0);
    expect(r[0].body.length).toBe(3000);
  });

  it("default includes near-cap (>=90%) and sorts worst-first", () => {
    const r = scanCapPressure(dirs, DEFAULT_CONFIG);
    expect(r.map((m) => m.name)).toEqual(["over", "near"]);
    expect(r).not.toContainEqual(expect.objectContaining({ name: "fine" }));
  });

  it("condensePrompt embeds the cap, name, and body", () => {
    const [m] = scanCapPressure(dirs, DEFAULT_CONFIG, { overOnly: true });
    const p = condensePrompt(m);
    expect(p).toContain("2200");
    expect(p).toContain("NAME: over");
    expect(p).toContain("verbatim");
  });
});
