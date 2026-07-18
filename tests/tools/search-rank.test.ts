import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleSearch } from "../../src/tools/search.js";
import { serializeHeader, type MemoryHeader } from "../../src/lib/parser.js";

function writeMemory(
  dir: string,
  filename: string,
  header: MemoryHeader,
  body: string
): void {
  fs.writeFileSync(path.join(dir, filename), `${serializeHeader(header)}\n${body}\n`);
}

describe("handleSearch ranking", () => {
  let tmpDir: string;
  let memDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nous-search-rank-"));
    memDir = path.join(tmpDir, "memory");
    fs.mkdirSync(memDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const dirs = () => [{ projectHash: "proj", memoryDir: memDir }];

  it("ranks a name match above a body-only match", () => {
    writeMemory(
      memDir,
      "project_vite.md",
      { type: "proj", name: "Vite Proxy Setup", description: "dev proxy config", updated: "2026-07-01", accessCount: 0 },
      "rule: proxy map entries required"
    );
    writeMemory(
      memDir,
      "project_other.md",
      { type: "proj", name: "Other Topic", description: "something else", updated: "2026-07-01", accessCount: 0 },
      "we mentioned vite once here"
    );
    const res = handleSearch({ query: "vite" }, dirs());
    expect(res.matches).toHaveLength(2);
    expect(res.matches[0].name).toBe("Vite Proxy Setup");
  });

  it("uses accessCount as a ranking signal between equal-relevance hits", () => {
    writeMemory(
      memDir,
      "project_a_daemon.md",
      { type: "proj", name: "Daemon Alpha", description: "daemon notes", updated: "2026-07-01", accessCount: 0 },
      "daemon startup path"
    );
    writeMemory(
      memDir,
      "project_b_daemon.md",
      { type: "proj", name: "Daemon Beta", description: "daemon notes", updated: "2026-07-01", accessCount: 9 },
      "daemon startup path variant"
    );
    const res = handleSearch({ query: "daemon" }, dirs());
    expect(res.matches[0].name).toBe("Daemon Beta");
  });

  it("demotes archived memories below active ones", () => {
    writeMemory(
      memDir,
      "project_arch.md",
      { type: "proj", name: "Kafka Archived", description: "kafka pipeline", updated: "2026-07-10", accessCount: 5, state: "archived" },
      "kafka consumer notes"
    );
    writeMemory(
      memDir,
      "project_act.md",
      { type: "proj", name: "Kafka Active", description: "kafka pipeline", updated: "2026-06-01", accessCount: 1 },
      "kafka consumer notes v2"
    );
    const res = handleSearch({ query: "kafka" }, dirs());
    expect(res.matches[0].name).toBe("Kafka Active");
    expect(res.matches[1].state).toBe("archived");
  });

  it("picks up external file changes despite the mtime cache", () => {
    writeMemory(
      memDir,
      "project_cache.md",
      { type: "proj", name: "Cache Probe", description: "d", updated: "2026-07-01" },
      "original body"
    );
    let res = handleSearch({ query: "zanzibar" }, dirs());
    expect(res.matches).toHaveLength(0);

    // Rewrite with new content + bump mtime.
    writeMemory(
      memDir,
      "project_cache.md",
      { type: "proj", name: "Cache Probe", description: "d", updated: "2026-07-02" },
      "now mentions zanzibar explicitly"
    );
    const future = Date.now() / 1000 + 5;
    fs.utimesSync(path.join(memDir, "project_cache.md"), future, future);

    res = handleSearch({ query: "zanzibar" }, dirs());
    expect(res.matches).toHaveLength(1);
  });

  it("empty query lists everything (browse mode)", () => {
    writeMemory(memDir, "project_a.md", { type: "proj", name: "Aaa", description: "d" }, "x");
    writeMemory(memDir, "project_b.md", { type: "proj", name: "Bbb", description: "d" }, "y");
    const res = handleSearch({ query: "" }, dirs());
    expect(res.matches.map((m) => m.name)).toEqual(["Aaa", "Bbb"]);
  });
});
