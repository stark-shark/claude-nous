import { describe, it, expect } from "vitest";
import { capFor, measureCap, usageLine, overflowError } from "../../src/lib/caps.js";
import { DEFAULT_CONFIG } from "../../src/lib/config.js";

describe("caps", () => {
  it("resolves per-type caps and the special user.md cap", () => {
    expect(capFor("proj", "project_x.md", DEFAULT_CONFIG)).toBe(DEFAULT_CONFIG.caps.proj);
    expect(capFor("usr", "user.md", DEFAULT_CONFIG)).toBe(DEFAULT_CONFIG.caps.user);
    expect(capFor("usr", "user_other.md", DEFAULT_CONFIG)).toBe(DEFAULT_CONFIG.caps.usr);
  });

  it("treats cap 0 as unlimited", () => {
    const u = measureCap(10_000, 0);
    expect(u.unlimited).toBe(true);
    expect(u.over).toBe(0);
  });

  it("computes overflow", () => {
    const u = measureCap(2400, 2200);
    expect(u.over).toBe(200);
    expect(u.pct).toBe(109);
  });

  it("usageLine labels user vs typed memory", () => {
    expect(usageLine("usr", "user.md", measureCap(1100, 1375), DEFAULT_CONFIG)).toBe("USER 80% — 1100/1375");
    expect(usageLine("proj", "project_x.md", measureCap(1474, 2200), DEFAULT_CONFIG)).toBe("MEMORY[proj] 67% — 1474/2200");
    expect(usageLine("proj", "x.md", measureCap(10, 0), DEFAULT_CONFIG)).toBe("");
  });

  it("overflow error mentions consolidation and includes existing body", () => {
    const msg = overflowError("Nova", "proj", measureCap(2400, 2200), "old body here");
    expect(msg).toContain("Cap exceeded");
    expect(msg).toContain("over by 200");
    expect(msg).toContain("old body here");
  });
});
