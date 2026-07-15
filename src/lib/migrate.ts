import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// One-time, non-destructive migration from the pre-v1 Recall data dir
// (~/.claude/recall) to the Nous data dir (~/.claude/nous).
//
// v1.0.0 renamed the plugin Recall -> Nous, which moves the USER-scoped data
// (global memory incl. user.md, per-project turn-counter state, and the config
// file) from ~/.claude/recall to ~/.claude/nous. Per-project memories live under
// ~/.claude/projects/<hash>/memory and DO NOT move.
//
// This copies (never moves/deletes) so a user who downgrades still has their
// old data. It is idempotent: it only runs when the target dir is absent and a
// legacy dir exists, and it drops a MIGRATED.md marker in the legacy dir.

const LEGACY_DIR = path.join(os.homedir(), ".claude", "recall");
const NOUS_DIR = path.join(os.homedir(), ".claude", "nous");
const MARKER = path.join(LEGACY_DIR, "MIGRATED.md");

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      // Don't clobber anything already in the target.
      if (!fs.existsSync(d)) fs.copyFileSync(s, d);
    }
  }
}

export interface MigrationResult {
  ran: boolean;
  copied: string[];
}

// Run the legacy->nous copy if needed. Safe to call on every startup; it no-ops
// once the target dir exists or once the marker is present. Never throws — a
// migration failure must not break the server or a hook.
export function migrateFromRecall(
  legacyDir = LEGACY_DIR,
  nousDir = NOUS_DIR,
  marker = MARKER
): MigrationResult {
  const result: MigrationResult = { ran: false, copied: [] };
  try {
    if (fs.existsSync(nousDir)) return result; // already on Nous
    if (!fs.existsSync(legacyDir)) return result; // nothing to migrate
    if (fs.existsSync(marker)) return result; // already migrated once

    fs.mkdirSync(nousDir, { recursive: true });

    // 1. global memory (user.md, days/, MEMORY.md, REGISTRY.md, ...)
    const legacyMem = path.join(legacyDir, "memory");
    if (fs.existsSync(legacyMem)) {
      copyDirRecursive(legacyMem, path.join(nousDir, "memory"));
      result.copied.push("memory/");
    }

    // 2. per-project turn-counter state
    const legacyState = path.join(legacyDir, "state");
    if (fs.existsSync(legacyState)) {
      copyDirRecursive(legacyState, path.join(nousDir, "state"));
      result.copied.push("state/");
    }

    // 3. config file (renamed recall.config.jsonc -> nous.config.jsonc)
    const legacyCfg = path.join(legacyDir, "recall.config.jsonc");
    const nousCfg = path.join(nousDir, "nous.config.jsonc");
    if (fs.existsSync(legacyCfg) && !fs.existsSync(nousCfg)) {
      fs.copyFileSync(legacyCfg, nousCfg);
      result.copied.push("nous.config.jsonc");
    }

    // marker so we never re-run even if the user later empties the nous dir
    try {
      fs.writeFileSync(
        marker,
        "# Migrated to Nous\n\n" +
          "This Recall data dir was copied to `~/.claude/nous` by Nous v1.0.0.\n" +
          "The copy is non-destructive — this dir is left intact. You may delete it once satisfied.\n",
        "utf8"
      );
    } catch {
      /* marker is best-effort */
    }

    result.ran = true;
  } catch {
    // never break startup on a migration failure
  }
  return result;
}
