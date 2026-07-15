import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { migrateFromRecall } from "../../src/lib/migrate.js";

describe("migrateFromRecall (recall -> nous)", () => {
  let root: string;
  let legacy: string;
  let nous: string;
  let marker: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nous-migrate-"));
    legacy = path.join(root, "recall");
    nous = path.join(root, "nous");
    marker = path.join(legacy, "MIGRATED.md");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function seedLegacy() {
    fs.mkdirSync(path.join(legacy, "memory", "days"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "memory", "user.md"), "profile body");
    fs.writeFileSync(path.join(legacy, "memory", "days", "2026-07-01.md"), "digest");
    fs.mkdirSync(path.join(legacy, "state"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "state", "p.json"), '{"turns":3}');
    fs.writeFileSync(path.join(legacy, "recall.config.jsonc"), "{}");
  }

  it("copies memory, state, and the renamed config", () => {
    seedLegacy();
    const r = migrateFromRecall(legacy, nous, marker);
    expect(r.ran).toBe(true);
    expect(fs.readFileSync(path.join(nous, "memory", "user.md"), "utf8")).toBe("profile body");
    expect(fs.existsSync(path.join(nous, "memory", "days", "2026-07-01.md"))).toBe(true);
    expect(fs.existsSync(path.join(nous, "state", "p.json"))).toBe(true);
    // config file is renamed
    expect(fs.existsSync(path.join(nous, "nous.config.jsonc"))).toBe(true);
    // legacy dir is untouched (non-destructive)
    expect(fs.existsSync(path.join(legacy, "memory", "user.md"))).toBe(true);
    // marker written
    expect(fs.existsSync(marker)).toBe(true);
  });

  it("is idempotent: no-op once the nous dir exists", () => {
    seedLegacy();
    migrateFromRecall(legacy, nous, marker);
    // user edits nous-side; a second run must not overwrite it
    fs.writeFileSync(path.join(nous, "memory", "user.md"), "edited");
    const r2 = migrateFromRecall(legacy, nous, marker);
    expect(r2.ran).toBe(false);
    expect(fs.readFileSync(path.join(nous, "memory", "user.md"), "utf8")).toBe("edited");
  });

  it("no-ops when there is nothing to migrate", () => {
    const r = migrateFromRecall(legacy, nous, marker);
    expect(r.ran).toBe(false);
    expect(fs.existsSync(nous)).toBe(false);
  });

  it("respects the MIGRATED marker even if the nous dir was deleted", () => {
    seedLegacy();
    fs.writeFileSync(marker, "already done");
    const r = migrateFromRecall(legacy, nous, marker);
    expect(r.ran).toBe(false);
    expect(fs.existsSync(nous)).toBe(false);
  });
});
