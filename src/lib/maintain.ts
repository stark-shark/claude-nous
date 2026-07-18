import * as fs from "node:fs";
import * as path from "node:path";
import type { NousConfig } from "./config.js";
import type { MemoryDirEntry } from "./memory-dir.js";
import { parseHeader, stripHeader } from "./parser.js";
import { capFor, measureCap } from "./caps.js";
import type { MemoryType } from "./symbols.js";

// Self-maintaining memory: find memories under cap pressure so the background
// review can condense them (Haiku) and stage an approval-gated proposal. This
// is the size-triggered cleanup loop — detection here, condensing in the review
// worker, application gated through the pending queue.

export interface OverCapMemory {
  name: string;
  type: MemoryType;
  description: string;
  file: string;
  memoryDir: string;
  body: string;
  used: number;
  cap: number;
  pct: number;
  over: number; // > 0 means over cap; <= 0 but near threshold means near-cap
}

// Scan all memory dirs for memories at/over `nearPct`% of their cap. `overOnly`
// restricts to strictly-over-cap. Sorted worst-first.
export function scanCapPressure(
  memoryDirs: MemoryDirEntry[],
  config: NousConfig,
  opts: { nearPct?: number; overOnly?: boolean } = {}
): OverCapMemory[] {
  const nearPct = opts.nearPct ?? 90;
  const out: OverCapMemory[] = [];
  for (const { memoryDir } of memoryDirs) {
    if (!fs.existsSync(memoryDir)) continue;
    let files: string[];
    try {
      files = fs.readdirSync(memoryDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".md") || f === "MEMORY.md" || f === "REGISTRY.md" || f === "MEMORY_ARCHIVE.md") continue;
      let content: string;
      try {
        content = fs.readFileSync(path.join(memoryDir, f), "utf-8");
      } catch {
        continue;
      }
      const header = parseHeader(content);
      if (!header) continue;
      const body = stripHeader(content);
      const cap = capFor(header.type, f, config);
      const usage = measureCap(body.length, cap);
      if (usage.unlimited) continue;
      const isOver = usage.over > 0;
      const isNear = usage.pct >= nearPct;
      if (opts.overOnly ? isOver : isOver || isNear) {
        out.push({
          name: header.name,
          type: header.type,
          description: header.description,
          file: f,
          memoryDir,
          body,
          used: usage.used,
          cap: usage.cap,
          pct: usage.pct,
          over: usage.over,
        });
      }
    }
  }
  return out.sort((a, b) => b.over - a.over || b.pct - a.pct);
}

// Prompt for condensing an over-cap memory to fit its cap without losing signal.
export function condensePrompt(m: OverCapMemory): string {
  return (
    `Condense this Nous memory so its body fits within ${m.cap} characters (currently ${m.used}). ` +
    `Reply with ONLY the new body — no frontmatter, no fences, no commentary.\n` +
    `Rules: keep ALL technical identifiers, file paths, commands, numbers, dates, and names verbatim; ` +
    `drop filler/hedging/redundancy; merge overlapping lines; use Nous notation operators (-> :: >> @ != & |). ` +
    `Do not invent or drop distinct facts — only tighten.\n\n` +
    `TYPE: ${m.type}\nNAME: ${m.name}\n\nCURRENT BODY:\n${m.body}`
  );
}
