import { describe, it, expect } from "vitest";
import { validateSkill } from "../../src/tools/skill.js";

const good = `---
name: deploy-helper
description: Deploy the app to staging
---

# Deploy helper
Steps to deploy.`;

describe("validateSkill", () => {
  it("accepts a well-formed skill", () => {
    expect(validateSkill(good)).toBeNull();
  });
  it("rejects missing frontmatter", () => {
    expect(validateSkill("# just a heading")).toBeTruthy();
  });
  it("rejects missing name/description", () => {
    expect(validateSkill("---\nname: x\n---\nbody")).toBeTruthy();
    expect(validateSkill("---\ndescription: y\n---\nbody")).toBeTruthy();
  });
  it("rejects empty body", () => {
    expect(validateSkill("---\nname: x\ndescription: y\n---\n")).toBeTruthy();
  });
});
