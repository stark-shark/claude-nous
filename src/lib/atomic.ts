import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

// Atomic file write: write to a temp file in the same directory, then rename
// over the target. libuv's rename uses MOVEFILE_REPLACE_EXISTING on Windows, so
// the swap replaces an existing destination on every platform. Multiple
// processes write memory/state files concurrently (MCP server, Stop-hook
// indexer, detached review worker) — with the swap, a reader never observes a
// torn half-write.
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  );
  fs.writeFileSync(tmp, content, "utf-8");
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    // Windows AV/search indexers can hold the target briefly (EPERM). Fall back
    // to a plain write rather than losing the save.
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    fs.writeFileSync(filePath, content, "utf-8");
  }
}
