import { describe, it, expect } from "vitest";
import { parseHeader, serializeHeader, stripHeader } from "../../src/lib/parser.js";
import type { MemoryHeader } from "../../src/lib/parser.js";

// =============================================================================
// parseHeader — legacy T:/D:/... format (pre-v0.5.0 files still in the wild)
// =============================================================================

describe("parseHeader (legacy T:/D: format)", () => {
  it("parses minimal header", () => {
    const header = parseHeader("---\nT:fb | FK CASCADE\nD:desc\n---\nbody");
    expect(header?.type).toBe("fb");
    expect(header?.name).toBe("FK CASCADE");
    expect(header?.created).toBeUndefined();
  });

  it("parses full header", () => {
    const header = parseHeader("---\nT:proj | GP\nD:desc\nC:2026-03-22\nU:2026-04-14\nA:12\nL:a, b\n---\nbody");
    expect(header?.accessCount).toBe(12);
    expect(header?.links).toEqual(["a", "b"]);
  });

  it("returns null for no header", () => {
    expect(parseHeader("no header")).toBeNull();
  });
});

describe("parseHeader legacy field validation", () => {
  it("drops non-ISO dates", () => {
    const header = parseHeader("---\nT:fb | T\nD:d\nC:not-a-date\nU:2026-99-99\n---\nbody");
    expect(header?.created).toBeUndefined();
    expect(header?.updated).toBeUndefined();
  });

  it("drops non-integer access counts", () => {
    const header = parseHeader("---\nT:fb | T\nD:d\nA:abc\n---\nbody");
    expect(header?.accessCount).toBeUndefined();
  });

  it("rejects impossible calendar dates", () => {
    const header = parseHeader("---\nT:fb | T\nD:d\nC:2026-02-30\n---\nbody");
    expect(header?.created).toBeUndefined();
  });

  it("accepts valid ISO dates and integer A", () => {
    const header = parseHeader("---\nT:fb | T\nD:d\nC:2026-01-15\nA:7\n---\nbody");
    expect(header?.created).toBe("2026-01-15");
    expect(header?.accessCount).toBe(7);
  });
});

// =============================================================================
// parseHeader — new (Claude Code-compatible) format with metadata.recall.*
// =============================================================================

describe("parseHeader (new Claude Code-compatible format)", () => {
  const fullNewFormat = [
    "---",
    "name: fk-cascade",
    'description: "FKs to employees.id REQ ON UPDATE CASCADE"',
    "metadata:",
    "  node_type: memory",
    "  type: fb",
    "  recall:",
    '    humanName: "FK CASCADE"',
    "    created: 2026-04-12",
    "    updated: 2026-05-29",
    "    accessCount: 7",
    "    links:",
    "      - project_recall",
    "      - feedback_invite_flow",
    "---",
    "body content",
  ].join("\n");

  it("parses full new-format header", () => {
    const header = parseHeader(fullNewFormat);
    expect(header?.type).toBe("fb");
    expect(header?.name).toBe("FK CASCADE"); // humanName preserves casing
    expect(header?.description).toBe("FKs to employees.id REQ ON UPDATE CASCADE");
    expect(header?.created).toBe("2026-04-12");
    expect(header?.updated).toBe("2026-05-29");
    expect(header?.accessCount).toBe(7);
    expect(header?.links).toEqual(["project_recall", "feedback_invite_flow"]);
  });

  it("falls back to slug as name when humanName is absent", () => {
    const minimal = [
      "---",
      "name: my-memory",
      'description: "desc"',
      "metadata:",
      "  type: ref",
      "---",
      "body",
    ].join("\n");
    const header = parseHeader(minimal);
    expect(header?.name).toBe("my-memory");
    expect(header?.type).toBe("ref");
  });

  it("returns null when metadata.type is invalid", () => {
    const bad = [
      "---",
      "name: x",
      'description: "d"',
      "metadata:",
      "  type: not-a-real-type",
      "---",
      "body",
    ].join("\n");
    expect(parseHeader(bad)).toBeNull();
  });

  it("ignores originSessionId and other unknown metadata fields", () => {
    const withExtras = [
      "---",
      "name: x",
      'description: "d"',
      "metadata:",
      "  node_type: memory",
      "  type: usr",
      "  originSessionId: e7093ba0-457e-4f45-bb43-b60b8a2d22f4",
      "  recall:",
      "    created: 2026-05-29",
      "---",
      "body",
    ].join("\n");
    const header = parseHeader(withExtras);
    expect(header?.type).toBe("usr");
    expect(header?.created).toBe("2026-05-29");
  });
});

// =============================================================================
// parseHeader — migration: new-format file with a trailing legacy block
// (Claude Code normalized a pre-v0.5.0 Recall file in place)
// =============================================================================

describe("parseHeader migration: new format on top, legacy block below", () => {
  const migrationFixture = [
    "---",
    "name: plugin-must-bundle-deps",
    'description: "Claude Code plugins do NOT run npm install on install"',
    "metadata:",
    "  node_type: memory",
    "  type: fb",
    "---",
    "",
    "---",
    "T:fb | plugin-must-bundle-deps",
    "D:Claude Code plugins do NOT run npm install on install",
    "C:2026-05-29",
    "U:2026-05-29",
    "A:3",
    "L:project_recall",
    "---",
    "body content",
  ].join("\n");

  it("merges legacy dates/links into new-format header", () => {
    const header = parseHeader(migrationFixture);
    expect(header?.type).toBe("fb");
    expect(header?.name).toBe("plugin-must-bundle-deps");
    expect(header?.created).toBe("2026-05-29");
    expect(header?.updated).toBe("2026-05-29");
    expect(header?.accessCount).toBe(3);
    expect(header?.links).toEqual(["project_recall"]);
  });

  it("stripHeader skips both blocks and returns body", () => {
    expect(stripHeader(migrationFixture)).toBe("body content");
  });
});

// =============================================================================
// serializeHeader — always emits the new (Claude Code-compatible) format
// =============================================================================

describe("serializeHeader (writes new format)", () => {
  it("emits canonical structure with humanName preserved", () => {
    const header: MemoryHeader = {
      type: "fb",
      name: "FK CASCADE",
      description: "FKs to employees.id REQ ON UPDATE CASCADE",
      created: "2026-01-01",
      updated: "2026-04-14",
      accessCount: 5,
      links: ["project_invite"],
    };
    const result = serializeHeader(header);
    expect(result).toContain("name: fk-cascade");
    expect(result).toContain('humanName: "FK CASCADE"');
    expect(result).toContain("type: fb");
    expect(result).toContain("created: 2026-01-01");
    expect(result).toContain("accessCount: 5");
    expect(result).toContain("- project_invite");
  });

  it("omits humanName when slug equals input name", () => {
    const result = serializeHeader({
      type: "ref",
      name: "fk-cascade",
      description: "d",
    });
    expect(result).not.toContain("humanName");
    expect(result).toContain("name: fk-cascade");
  });

  it("omits optional recall fields when undefined", () => {
    const result = serializeHeader({ type: "fb", name: "T", description: "d" });
    expect(result).not.toContain("created:");
    expect(result).not.toContain("accessCount:");
    expect(result).not.toContain("links:");
  });
});

// =============================================================================
// Round-trip: serialize then parse must recover all fields
// =============================================================================

describe("serialize + parse round-trip", () => {
  it("preserves all fields", () => {
    const original: MemoryHeader = {
      type: "proj",
      name: "GP Integration",
      description: 'GP -> Supabase sync with "JOIN preview"',
      created: "2026-04-12",
      updated: "2026-05-29",
      accessCount: 11,
      links: ["project_recall", "feedback_invite_flow"],
    };
    const serialized = serializeHeader(original);
    const parsed = parseHeader(`${serialized}\nbody`);
    expect(parsed).toEqual(original);
  });
});

// =============================================================================
// stripHeader behavior
// =============================================================================

describe("stripHeader", () => {
  it("returns body for legacy format", () => {
    expect(stripHeader("---\nT:fb | T\nD:d\n---\nbody")).toBe("body");
  });

  it("returns body for new format", () => {
    const content = [
      "---",
      "name: x",
      'description: "d"',
      "metadata:",
      "  type: fb",
      "---",
      "body content",
    ].join("\n");
    expect(stripHeader(content)).toBe("body content");
  });
});
