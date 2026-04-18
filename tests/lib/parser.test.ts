import { describe, it, expect } from "vitest";
import { parseHeader, serializeHeader, stripHeader } from "../../src/lib/parser.js";
import type { MemoryHeader } from "../../src/lib/parser.js";

describe("parseHeader", () => {
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

describe("serializeHeader", () => {
  it("serializes full header", () => {
    const header: MemoryHeader = { type: "fb", name: "Test", description: "desc", created: "2026-01-01", updated: "2026-04-14", accessCount: 5, links: ["a"] };
    const result = serializeHeader(header);
    expect(result).toContain("T:fb | Test");
    expect(result).toContain("A:5");
    expect(result).toContain("L:a");
  });

  it("omits optional fields", () => {
    const result = serializeHeader({ type: "fb", name: "T", description: "d" });
    expect(result).not.toContain("C:");
    expect(result).not.toContain("A:");
  });
});

describe("stripHeader", () => {
  it("returns body", () => {
    expect(stripHeader("---\nT:fb | T\nD:d\n---\nbody")).toBe("body");
  });
});

describe("parseHeader field validation", () => {
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
