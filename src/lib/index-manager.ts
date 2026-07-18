import * as fs from "node:fs";
import * as path from "node:path";
import { writeFileAtomic } from "./atomic.js";

export const ARCHIVE_FILENAME = "MEMORY_ARCHIVE.md";

export interface IndexEntry {
  name: string;
  filename: string;
  description: string;
}

const ENTRY_REGEX = /^-\s+\[(.+?)\]\((.+?)\)\s*[—-]\s*(.+)$/;

export function readIndex(indexPath: string): IndexEntry[] {
  if (!fs.existsSync(indexPath)) return [];

  const content = fs.readFileSync(indexPath, "utf-8");
  const entries: IndexEntry[] = [];

  for (const line of content.split("\n")) {
    const match = line.trim().match(ENTRY_REGEX);
    if (match) {
      entries.push({
        name: match[1],
        filename: match[2],
        description: match[3].trim(),
      });
    }
  }

  return entries;
}

// Collapse runs of blank lines to a single blank and drop trailing blanks so
// padding never counts against the entry budget or accumulates from removals.
function collapseBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === "" && (out.length === 0 || out[out.length - 1].trim() === "")) {
      continue;
    }
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out;
}

// Overflow entries are appended here instead of being deleted, so they stay
// searchable and can be restored by pasting the line back into the index.
function appendToArchive(archivePath: string, entryLines: string[]): void {
  let existing: string[];
  if (fs.existsSync(archivePath)) {
    existing = collapseBlankRuns(fs.readFileSync(archivePath, "utf-8").split("\n"));
  } else {
    existing = [
      "# Memory Index Archive",
      "",
      "Entries rotated out of the index when indexMaxLines was exceeded.",
      "Memory files are untouched — move a line back to the index to re-surface it.",
      "",
    ];
  }

  // Dedupe: an entry re-archived after a restore replaces its old archive line
  for (const line of entryLines) {
    const m = line.trim().match(ENTRY_REGEX);
    if (m) {
      existing = existing.filter((l) => !l.includes(`(${m[2]})`));
    }
  }

  writeFileAtomic(archivePath, [...existing, ...entryLines].join("\n") + "\n");
}

export function upsertIndexEntry(
  indexPath: string,
  filename: string,
  name: string,
  description: string,
  maxEntries: number
): { archived: number } {
  let lines: string[] = [];

  if (fs.existsSync(indexPath)) {
    lines = fs.readFileSync(indexPath, "utf-8").split("\n");
  } else {
    lines = ["# Memory Index", ""];
  }

  const newEntry = `- [${name}](${filename}) — ${description}`;

  // Find and replace existing entry for this filename
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`(${filename})`)) {
      lines[i] = newEntry;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(newEntry);
  }

  lines = collapseBlankRuns(lines);

  // Enforce the budget by ENTRY count, not raw lines — headers, section
  // titles, and blanks are free. Overflow rotates the topmost (oldest by
  // position) entries into the archive file rather than deleting them.
  let archived = 0;
  const entryIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ENTRY_REGEX.test(lines[i].trim())) entryIndexes.push(i);
  }
  if (entryIndexes.length > maxEntries) {
    archived = entryIndexes.length - maxEntries;
    const toArchive = new Set(entryIndexes.slice(0, archived));
    const archivedLines = lines.filter((_, i) => toArchive.has(i));
    lines = collapseBlankRuns(lines.filter((_, i) => !toArchive.has(i)));
    appendToArchive(path.join(path.dirname(indexPath), ARCHIVE_FILENAME), archivedLines);
  }

  writeFileAtomic(indexPath, lines.join("\n") + "\n");
  return { archived };
}

export function removeIndexEntry(
  indexPath: string,
  filename: string
): void {
  if (!fs.existsSync(indexPath)) return;

  const lines = fs.readFileSync(indexPath, "utf-8").split("\n");
  const filtered = collapseBlankRuns(
    lines.filter((line: string) => !line.includes(`(${filename})`))
  );
  writeFileAtomic(indexPath, filtered.join("\n") + "\n");
}
