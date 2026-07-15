import { describe, it, expect } from "vitest";
import { normalizeType } from "../../src/lib/symbols.js";
import { parseHeader } from "../../src/lib/parser.js";

describe("normalizeType", () => {
  it("passes short codes through", () => {
    expect(normalizeType("fb")).toBe("fb");
    expect(normalizeType("proj")).toBe("proj");
    expect(normalizeType("ref")).toBe("ref");
    expect(normalizeType("usr")).toBe("usr");
  });
  it("maps Claude Code long-form aliases", () => {
    expect(normalizeType("feedback")).toBe("fb");
    expect(normalizeType("project")).toBe("proj");
    expect(normalizeType("reference")).toBe("ref");
    expect(normalizeType("user")).toBe("usr");
  });
  it("is case/whitespace tolerant, rejects unknown", () => {
    expect(normalizeType("  Project ")).toBe("proj");
    expect(normalizeType("nonsense")).toBeNull();
    expect(normalizeType("")).toBeNull();
  });
});

describe("parseHeader accepts long-form type (CC-native memories)", () => {
  it("parses a memory whose metadata.type is 'project'", () => {
    const md = `---
name: proj-x
description: "a project"
metadata:
  node_type: memory
  type: project
  originSessionId: abc
---
body here`;
    const h = parseHeader(md);
    expect(h).not.toBeNull();
    expect(h!.type).toBe("proj");
  });
  it("parses 'feedback' -> fb", () => {
    const md = `---
name: fb-x
description: "a feedback"
metadata:
  node_type: memory
  type: feedback
---
body`;
    expect(parseHeader(md)!.type).toBe("fb");
  });
});
