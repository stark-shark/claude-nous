import * as fs from "node:fs";
import * as path from "node:path";
import type { NousConfig } from "../lib/config.js";
import { normalizeType } from "../lib/symbols.js";
import {
  serializeHeader,
  isValidIsoDate,
  type MemoryHeader,
  type MemoryState,
} from "../lib/parser.js";
import { loadRegistry, saveRegistry } from "../lib/registry.js";
import { findDuplicate } from "../lib/dedup.js";
import { scanContent } from "../lib/threat.js";
import { capFor, measureCap } from "../lib/caps.js";
import { upsertIndexEntry, ARCHIVE_FILENAME } from "../lib/index-manager.js";
import { writeFileAtomic } from "../lib/atomic.js";

export interface ImportInput {
  file: string;
  // Import only entries exported from this project hash (exports tag each
  // memory with its source project).
  project?: string;
}

export interface ImportResult {
  text: string;
  isError?: boolean;
}

interface ExportedMemory {
  filename: string;
  header: Record<string, unknown>;
  content: string;
  project?: string;
}

// Safe basename: no path separators/traversal, no leading dot, .md only.
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

// Rebuild a full MemoryHeader from an exported header object, preserving
// lifecycle metadata (created/updated/accessCount/links/state) that a plain
// re-save would reset. Returns null when the required fields are missing.
function headerFromExport(h: Record<string, unknown>): MemoryHeader | null {
  const type = typeof h.type === "string" ? normalizeType(h.type) : null;
  const name = typeof h.name === "string" ? h.name : "";
  const description = typeof h.description === "string" ? h.description : "";
  if (!type || !name || !description) return null;

  const header: MemoryHeader = { type, name, description };
  if (typeof h.created === "string" && isValidIsoDate(h.created)) header.created = h.created;
  if (typeof h.updated === "string" && isValidIsoDate(h.updated)) header.updated = h.updated;
  if (typeof h.accessCount === "number" && h.accessCount >= 0) header.accessCount = h.accessCount;
  if (Array.isArray(h.links)) {
    const links = h.links.filter((l): l is string => typeof l === "string" && l.length > 0);
    if (links.length > 0) header.links = links;
  }
  if (h.state === "stale" || h.state === "archived") header.state = h.state as MemoryState;
  return header;
}

export function handleImport(
  input: ImportInput,
  memoryDir: string,
  config: NousConfig
): ImportResult {
  if (!fs.existsSync(input.file)) {
    return { text: `File not found: ${input.file}`, isError: true };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(input.file, "utf-8");
  } catch (err) {
    return { text: `Failed to read ${input.file}: ${(err as Error).message}`, isError: true };
  }

  let data: { version?: number; registry?: Record<string, string>; memories?: ExportedMemory[] };
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { text: `Invalid JSON in ${input.file}: ${(err as Error).message}`, isError: true };
  }

  if (data.version !== 1) {
    return { text: `Unsupported export version: ${data.version ?? "missing"}`, isError: true };
  }

  let imported = 0;
  const skippedExisting: string[] = [];
  const skippedDuplicate: string[] = [];
  const skippedInvalid: string[] = [];
  const blocked: string[] = [];
  const warnings: string[] = [];

  // Import registry entries (additive — never overwrites local expansions).
  if (data.registry && Object.keys(data.registry).length > 0) {
    const registryPath = path.join(memoryDir, config.registryFile);
    const registry = loadRegistry(registryPath);
    for (const [code, expansion] of Object.entries(data.registry)) {
      if (!registry.has(code)) {
        registry.set(code, expansion as string);
      }
    }
    saveRegistry(registryPath, registry);
  }

  const today = new Date().toISOString().slice(0, 10);
  // Per-target-dir body cache for content dedup (also catches dups WITHIN the
  // import set as files land).
  const bodyCache = new Map<string, Map<string, string>>();
  const dirBodies = (dir: string): Map<string, string> => {
    let cached = bodyCache.get(dir);
    if (cached) return cached;
    cached = new Map<string, string>();
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".md") || f === config.indexFile || f === config.registryFile || f === ARCHIVE_FILENAME) continue;
        try {
          cached.set(f, fs.readFileSync(path.join(dir, f), "utf-8"));
        } catch {
          /* unreadable — ignore for dedup */
        }
      }
    }
    bodyCache.set(dir, cached);
    return cached;
  };

  for (const mem of data.memories ?? []) {
    if (input.project && mem.project !== input.project) continue;

    if (typeof mem.filename !== "string" || !SAFE_FILENAME.test(mem.filename) ||
        mem.filename === config.indexFile || mem.filename === config.registryFile || mem.filename === ARCHIVE_FILENAME ||
        typeof mem.content !== "string" || !mem.header || typeof mem.header !== "object") {
      skippedInvalid.push(String(mem?.filename ?? "(unnamed)"));
      continue;
    }

    const header = headerFromExport(mem.header);
    if (!header) {
      skippedInvalid.push(mem.filename);
      continue;
    }

    // The user profile is user-scoped (global dir), not project-scoped.
    const isUserFile = header.type === "usr" && mem.filename === config.userMemory.filename;
    const targetDir = isUserFile && config.userMemory.dir ? config.userMemory.dir : memoryDir;
    fs.mkdirSync(targetDir, { recursive: true });
    const filePath = path.join(targetDir, mem.filename);

    if (fs.existsSync(filePath)) {
      skippedExisting.push(mem.filename);
      continue;
    }

    // Security: imported JSON is as much an injection surface as a live save.
    if (config.security.scanOnWrite) {
      const scan = scanContent(mem.content);
      if (scan.hasHard && config.security.rejectInvisible) {
        blocked.push(`${mem.filename} — ${scan.threats.filter((t) => t.severity === "hard").map((t) => t.detail).join("; ")}`);
        continue;
      }
    }

    // Content dedup: identical body under another filename → skip, don't fork.
    const bodies = dirBodies(targetDir);
    const dup = findDuplicate(mem.content, bodies);
    if (dup) {
      skippedDuplicate.push(`${mem.filename} (= ${dup})`);
      continue;
    }

    // Restore fidelity beats cap enforcement: warn on over-cap, still import.
    const usage = measureCap(mem.content.length, capFor(header.type, mem.filename, config));
    if (!usage.unlimited && usage.over > 0) {
      warnings.push(`${mem.filename} is over cap (${usage.used}/${usage.cap}) — condense via nous_maintain`);
    }

    if (!header.created) header.created = today;
    if (header.accessCount === undefined) header.accessCount = 0;

    writeFileAtomic(filePath, `${serializeHeader(header)}\n${mem.content}\n`);
    bodies.set(mem.filename, mem.content);
    imported++;

    // Index active memories; archived ones stay searchable but out of MEMORY.md
    // (matching the curation scan's contract). The user profile is always
    // injected and never indexed.
    if (config.maintainIndex && !isUserFile && header.state !== "archived") {
      upsertIndexEntry(
        path.join(targetDir, config.indexFile),
        mem.filename,
        header.name,
        header.description,
        config.indexMaxLines
      );
    }
  }

  const lines = [`Imported ${imported} memories.`];
  if (skippedExisting.length > 0) {
    lines.push(`${skippedExisting.length} skipped (already exist): ${skippedExisting.join(", ")}`);
  }
  if (skippedDuplicate.length > 0) {
    lines.push(`${skippedDuplicate.length} skipped (duplicate content): ${skippedDuplicate.join(", ")}`);
  }
  if (skippedInvalid.length > 0) {
    lines.push(`${skippedInvalid.length} skipped (invalid entry): ${skippedInvalid.join(", ")}`);
  }
  if (blocked.length > 0) {
    lines.push(`${blocked.length} BLOCKED by security scan:\n  ${blocked.join("\n  ")}`);
  }
  if (warnings.length > 0) {
    lines.push(`Warnings:\n  ${warnings.map((w) => `⚠ ${w}`).join("\n  ")}`);
  }

  return { text: lines.join("\n") };
}
