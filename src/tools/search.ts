import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryType } from "../lib/symbols.js";
import type { MemoryDirEntry } from "../lib/memory-dir.js";
import { parseHeader, type MemoryHeader } from "../lib/parser.js";
import { reciprocalRankFusion } from "../lib/rank.js";

// Hot-tier search. Ranked retrieval (not a bare substring scan):
//   relevance — query-term hits weighted name > description > body
//   recency   — last-updated date
//   access    — accessCount (what you actually load matters)
// fused with the same RRF the cold tier uses; archived memories are demoted,
// not hidden. File reads go through an mtime-validated cache so repeat queries
// in one session don't re-read every memory file across every project.

export interface SearchInput {
  query: string;
  type?: MemoryType;
  project?: string;
  limit?: number;
}

export interface SearchMatch {
  name: string;
  description: string;
  type: string;
  filename: string;
  project: string;
  state?: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  text: string;
}

interface CacheEntry {
  mtimeMs: number;
  header: MemoryHeader;
  nameLower: string;
  descLower: string;
  bodyLower: string;
}

const cache = new Map<string, CacheEntry>();

function loadMemory(filePath: string): CacheEntry | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    cache.delete(filePath);
    return null;
  }
  const hit = cache.get(filePath);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit;

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    cache.delete(filePath);
    return null;
  }
  const header = parseHeader(content);
  if (!header) {
    cache.delete(filePath);
    return null;
  }
  const entry: CacheEntry = {
    mtimeMs: stat.mtimeMs,
    header,
    nameLower: header.name.toLowerCase(),
    descLower: header.description.toLowerCase(),
    bodyLower: content.toLowerCase(),
  };
  cache.set(filePath, entry);
  return entry;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1 && count < 10) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

interface Candidate {
  entry: CacheEntry;
  filename: string;
  project: string;
  relevance: number;
}

// name hits count 5×, description 3×, body 1× (capped) — presence in the parts
// a human would scan first should outrank a stray body mention.
function relevance(entry: CacheEntry, terms: string[]): number {
  let score = 0;
  for (const t of terms) {
    score += 5 * Math.min(countOccurrences(entry.nameLower, t), 2);
    score += 3 * Math.min(countOccurrences(entry.descLower, t), 2);
    score += Math.min(countOccurrences(entry.bodyLower, t), 3);
  }
  return score;
}

export function handleSearch(
  input: SearchInput,
  memoryDirs: MemoryDirEntry[]
): SearchResult {
  const queryLower = input.query.toLowerCase().trim();
  // Keep $shortcodes, dotted files, and identifiers intact as terms.
  const terms = queryLower.split(/\s+/).filter(Boolean);
  const limit = input.limit ?? 20;

  const dirs = input.project
    ? memoryDirs.filter((d) => d.projectHash === input.project)
    : memoryDirs;

  const candidates: Candidate[] = [];

  for (const { memoryDir, projectHash } of dirs) {
    if (!fs.existsSync(memoryDir)) continue;

    for (const f of fs.readdirSync(memoryDir)) {
      if (!f.endsWith(".md") || f === "MEMORY.md" || f === "REGISTRY.md") continue;

      const entry = loadMemory(path.join(memoryDir, f));
      if (!entry) continue;
      if (input.type && entry.header.type !== input.type) continue;

      let rel = 0;
      if (terms.length > 0) {
        rel = relevance(entry, terms);
        // Fallback: whole-query substring (symbols/phrases that tokenize away).
        if (rel === 0 && entry.bodyLower.includes(queryLower)) rel = 1;
        if (rel === 0) continue;
      }

      candidates.push({ entry, filename: f, project: projectHash, relevance: rel });
    }
  }

  let ordered: Candidate[];
  if (terms.length === 0) {
    // Browse mode (empty query): plain name order, like the old behavior.
    ordered = candidates.sort((a, b) => a.entry.header.name.localeCompare(b.entry.header.name));
  } else {
    // Each ranker leads with its own signal but tie-breaks through the others —
    // otherwise two tied rankers (same date, same access) hand out ranks by
    // directory order and can outvote genuine relevance.
    const cmpRel = (a: Candidate, b: Candidate) => b.relevance - a.relevance;
    const cmpUpd = (a: Candidate, b: Candidate) =>
      (b.entry.header.updated ?? "").localeCompare(a.entry.header.updated ?? "");
    const cmpAcc = (a: Candidate, b: Candidate) =>
      (b.entry.header.accessCount ?? 0) - (a.entry.header.accessCount ?? 0);
    const fused = reciprocalRankFusion(
      candidates,
      [
        (items) => [...items].sort((a, b) => cmpRel(a, b) || cmpAcc(a, b) || cmpUpd(a, b)),
        (items) => [...items].sort((a, b) => cmpUpd(a, b) || cmpRel(a, b) || cmpAcc(a, b)),
        (items) => [...items].sort((a, b) => cmpAcc(a, b) || cmpRel(a, b) || cmpUpd(a, b)),
      ],
      (c) => `${c.project}/${c.filename}`
    );
    // Archived memories stay findable but shouldn't outrank active ones.
    for (const f of fused) if (f.item.entry.header.state === "archived") f.score *= 0.5;
    fused.sort((a, b) => b.score - a.score);
    ordered = fused.map((f) => f.item);
  }

  const matches: SearchMatch[] = ordered.slice(0, limit).map((c) => ({
    name: c.entry.header.name,
    description: c.entry.header.description,
    type: c.entry.header.type,
    filename: c.filename,
    project: c.project,
    state: c.entry.header.state,
  }));

  const text =
    matches.length === 0
      ? `No memories found matching '${input.query}'.`
      : matches
          .map(
            (m) =>
              `- ${m.name} (${m.type}) [${m.project}]${m.state && m.state !== "active" ? ` (${m.state})` : ""} — ${m.description}`
          )
          .join("\n") +
        (ordered.length > limit ? `\n(${ordered.length - limit} more — narrow the query)` : "");

  return { matches, text };
}
