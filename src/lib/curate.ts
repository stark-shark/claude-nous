import * as fs from "node:fs";
import * as path from "node:path";
import type { NousConfig } from "./config.js";
import type { MemoryDirEntry } from "./memory-dir.js";
import { parseHeader, replaceHeader, stripHeader, type MemoryState } from "./parser.js";
import { capFor, measureCap } from "./caps.js";
import { removeIndexEntry } from "./index-manager.js";
import { writeFileAtomic } from "./atomic.js";

// Auto-apply low-risk curation scan — the "occasional scan" that decides what's
// stale, what to archive, and what needs attention. Lifecycle is pure rules (no
// LLM): age + access drive active -> stale -> archived. Ambiguous / destructive
// cases (over-cap consolidation) are ESCALATED to the user, never auto-applied.

export interface CurateReport {
  scanned: number;
  toStale: string[];
  toArchived: string[];
  overCap: string[]; // escalated: needs model consolidation, not auto-fixed
  duplicates: string[]; // escalated
}

function ageDays(updated: string | undefined, now: number): number | null {
  if (!updated) return null;
  const t = new Date(updated).getTime();
  if (Number.isNaN(t)) return null;
  return (now - t) / (24 * 60 * 60 * 1000);
}

export function runScan(
  memoryDirs: MemoryDirEntry[],
  config: NousConfig,
  now: number = Date.now()
): CurateReport {
  const report: CurateReport = {
    scanned: 0,
    toStale: [],
    toArchived: [],
    overCap: [],
    duplicates: [],
  };

  const { staleDays, staleMinAccess } = config.healthChecks;
  const archiveDays = staleDays + config.scan.archiveAfterStaleDays;
  const seenBodies = new Map<string, string>(); // body-hash-ish -> first memory name

  for (const { memoryDir } of memoryDirs) {
    if (!fs.existsSync(memoryDir)) continue;

    for (const f of fs.readdirSync(memoryDir)) {
      if (!f.endsWith(".md") || f === "MEMORY.md" || f === "REGISTRY.md") continue;

      const filePath = path.join(memoryDir, f);
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      const header = parseHeader(content);
      if (!header) continue;
      report.scanned++;

      const body = stripHeader(content);
      const access = header.accessCount ?? 0;
      const age = ageDays(header.updated, now);
      const current: MemoryState = header.state ?? "active";

      // Escalate over-cap files (e.g. a 17KB project memory) — consolidation
      // needs the model; the scan won't silently destroy content.
      const cap = capFor(header.type, f, config);
      const usage = measureCap(body.length, cap);
      if (!usage.unlimited && usage.over > 0) {
        report.overCap.push(`${header.name} (${f}) ${usage.used}/${usage.cap}`);
      }

      // Escalate exact-duplicate bodies.
      const key = body.replace(/\s+/g, " ").trim().toLowerCase();
      if (key) {
        const prior = seenBodies.get(key);
        if (prior) report.duplicates.push(`${header.name} == ${prior}`);
        else seenBodies.set(key, header.name);
      }

      // Lifecycle transitions (only when enabled). The always-loaded user
      // profile is never demoted. Frequently-accessed memories are never
      // demoted regardless of age.
      if (
        !config.scan.autoArchiveStale ||
        f === config.userMemory.filename ||
        age === null ||
        access >= staleMinAccess
      ) {
        continue;
      }

      let next: MemoryState | null = null;
      if (current === "active" && age > staleDays && age <= archiveDays) {
        next = "stale";
      } else if (
        (current === "active" || current === "stale") &&
        age > archiveDays
      ) {
        next = "archived";
      }

      if (next && next !== current) {
        header.state = next;
        try {
          writeFileAtomic(filePath, replaceHeader(content, header) + "\n");
        } catch {
          continue;
        }
        if (next === "stale") report.toStale.push(header.name);
        if (next === "archived") {
          report.toArchived.push(header.name);
          // Archived memories leave the hot index so they drop out of context,
          // but remain findable via nous_search.
          try {
            removeIndexEntry(path.join(memoryDir, config.indexFile), f);
          } catch {
            /* best effort */
          }
        }
      }
    }
  }

  return report;
}

export function formatReport(report: CurateReport): string {
  if (
    report.toStale.length === 0 &&
    report.toArchived.length === 0 &&
    report.overCap.length === 0 &&
    report.duplicates.length === 0
  ) {
    return `Nous scan: ${report.scanned} memories, all healthy.`;
  }
  const lines = [`Nous scan: ${report.scanned} memories`];
  if (report.toArchived.length)
    lines.push(`  archived ${report.toArchived.length}: ${report.toArchived.join(", ")}`);
  if (report.toStale.length)
    lines.push(`  marked stale ${report.toStale.length}: ${report.toStale.join(", ")}`);
  if (report.overCap.length)
    lines.push(`  ⚠ over cap (consolidate): ${report.overCap.join("; ")}`);
  if (report.duplicates.length)
    lines.push(`  ⚠ duplicates: ${report.duplicates.join("; ")}`);
  return lines.join("\n");
}
