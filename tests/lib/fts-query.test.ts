import { describe, it, expect } from "vitest";
import { sanitizeFtsQuery } from "../../src/lib/fts-query.js";

describe("sanitizeFtsQuery", () => {
  it("auto-quotes dotted/hyphenated/slashed identifiers", () => {
    expect(sanitizeFtsQuery("file.ts")).toBe('"file.ts"');
    expect(sanitizeFtsQuery("foo-bar")).toBe('"foo-bar"');
    expect(sanitizeFtsQuery("src/lib")).toBe('"src/lib"');
  });

  it("keeps plain terms as implicit-AND bare tokens", () => {
    expect(sanitizeFtsQuery("stripe billing")).toBe("stripe billing");
  });

  it("preserves user-quoted phrases", () => {
    expect(sanitizeFtsQuery('"payment processing" refund')).toBe('"payment processing" refund');
  });

  it("keeps boolean operators but strips dangling ones", () => {
    expect(sanitizeFtsQuery("stripe OR paypal")).toBe("stripe OR paypal");
    expect(sanitizeFtsQuery("AND stripe OR")).toBe("stripe");
  });

  it("preserves prefix wildcards and collapses repeats", () => {
    expect(sanitizeFtsQuery("bill***")).toBe("bill*");
    expect(sanitizeFtsQuery("config.j*")).toBe('"config.j"*');
  });

  it("neutralizes FTS5 special characters", () => {
    expect(sanitizeFtsQuery('foo(bar):baz^2')).toBe("foo bar baz 2");
  });

  it("handles empty / whitespace", () => {
    expect(sanitizeFtsQuery("")).toBe("");
    expect(sanitizeFtsQuery("   ")).toBe("");
  });
});
