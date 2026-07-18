import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleRegistry } from "../../src/tools/registry.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("handleRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-test-"));
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("add writes a new entry", () => {
    const res = handleRegistry({ action: "add", code: "$emp", expansion: "employees" }, tmpDir, "REGISTRY.md");
    expect(res.isError).toBeFalsy();
    expect(fs.readFileSync(path.join(tmpDir, "REGISTRY.md"), "utf-8")).toContain("$emp = employees");
  });

  it("add rejects invalid code format", () => {
    const res = handleRegistry({ action: "add", code: "emp", expansion: "employees" }, tmpDir, "REGISTRY.md");
    expect(res.isError).toBe(true);
    expect(res.text).toContain("Invalid entity code");
  });

  it("add rejects empty expansion", () => {
    const res = handleRegistry({ action: "add", code: "$x", expansion: "   " }, tmpDir, "REGISTRY.md");
    expect(res.isError).toBe(true);
  });

  it("add rejects duplicate code", () => {
    handleRegistry({ action: "add", code: "$emp", expansion: "employees" }, tmpDir, "REGISTRY.md");
    const res = handleRegistry({ action: "add", code: "$emp", expansion: "staff" }, tmpDir, "REGISTRY.md");
    expect(res.isError).toBe(true);
    expect(res.text).toContain("already exists");
  });

  it("update mutates an existing entry safely even with regex metachars", () => {
    handleRegistry({ action: "add", code: "$api-v2", expansion: "v2 api" }, tmpDir, "REGISTRY.md");
    const res = handleRegistry({ action: "update", code: "$api-v2", expansion: "v2 API service" }, tmpDir, "REGISTRY.md");
    expect(res.isError).toBeFalsy();
    const contents = fs.readFileSync(path.join(tmpDir, "REGISTRY.md"), "utf-8");
    expect(contents).toContain("$api-v2 = v2 API service");
    expect(contents).not.toContain("$api-v2 = v2 api");
  });

  it("remove deletes an entry", () => {
    handleRegistry({ action: "add", code: "$emp", expansion: "employees" }, tmpDir, "REGISTRY.md");
    const res = handleRegistry({ action: "remove", code: "$emp" }, tmpDir, "REGISTRY.md");
    expect(res.isError).toBeFalsy();
  });

  it("list reports count and entries", () => {
    handleRegistry({ action: "add", code: "$a", expansion: "alpha" }, tmpDir, "REGISTRY.md");
    handleRegistry({ action: "add", code: "$b", expansion: "beta" }, tmpDir, "REGISTRY.md");
    const res = handleRegistry({ action: "list" }, tmpDir, "REGISTRY.md");
    expect(res.text).toContain("2 entities");
    expect(res.text).toContain("$a = alpha");
    expect(res.text).toContain("$b = beta");
  });
});
