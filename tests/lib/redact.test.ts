import { describe, it, expect } from "vitest";
import { redact } from "../../src/lib/redact.js";

describe("redact", () => {
  it("redacts common key formats", () => {
    const cases = [
      "AKIA1234567890ABCDEF",
      "ghp_" + "a".repeat(36),
      "sk-ant-" + "x".repeat(30),
      "AIza" + "b".repeat(35),
      "xoxb-123456789012-abcdefghijkl",
    ];
    for (const c of cases) {
      const r = redact(`token here ${c} end`);
      expect(r.count).toBeGreaterThan(0);
      expect(r.text).not.toContain(c);
      expect(r.text).toContain("[REDACTED:");
    }
  });

  it("redacts assignment values but keeps the key", () => {
    const r = redact('password = "hunter2secret"');
    expect(r.text).toContain("password");
    expect(r.text).not.toContain("hunter2secret");
    expect(r.count).toBe(1);
  });

  it("redacts connection-string passwords only", () => {
    const r = redact("postgres://user:sup3rsecret@db.host:5432/app");
    expect(r.text).toContain("user:");
    expect(r.text).toContain("@db.host");
    expect(r.text).not.toContain("sup3rsecret");
  });

  it("redacts PEM private key blocks", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\nMIIdef456\n-----END RSA PRIVATE KEY-----";
    const r = redact(`key:\n${pem}\ndone`);
    expect(r.text).not.toContain("MIIabc123");
    expect(r.text).toContain("[REDACTED:private-key:");
  });

  it("leaves legitimate technical content alone (git SHAs, paths)", () => {
    const legit = "commit a4e7380 at appDevelopment/nova, node=v24, ratio ~0.42";
    const r = redact(legit);
    expect(r.count).toBe(0);
    expect(r.text).toBe(legit);
  });

  it("produces stable markers for identical secrets (dedup)", () => {
    const s = "ghp_" + "z".repeat(36);
    const a = redact(s).text;
    const b = redact(s).text;
    expect(a).toBe(b);
  });

  it("supports user-supplied extra patterns", () => {
    const r = redact("internal-id MW-99887766", ["MW-\\d{8}"]);
    expect(r.text).not.toContain("99887766");
    expect(r.text).toContain("[REDACTED:custom:");
  });
});
