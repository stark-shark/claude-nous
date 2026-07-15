import { normalizeType, type MemoryType } from "./symbols.js";

export type MemoryState = "active" | "stale" | "archived";

export interface MemoryHeader {
  type: MemoryType;
  name: string;
  description: string;
  created?: string;
  updated?: string;
  accessCount?: number;
  links?: string[];
  state?: MemoryState; // lifecycle; absent === "active"
}

const VALID_STATES: MemoryState[] = ["active", "stale", "archived"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

// -----------------------------------------------------------------------------
// Frontmatter location
// -----------------------------------------------------------------------------

interface FrontmatterBlock {
  open: number;        // line index of opening "---"
  close: number;       // line index of closing "---"
  bodyStart: number;   // line index where body begins
}

function findFirstFrontmatterBlock(lines: string[]): FrontmatterBlock | null {
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length || lines[i].trim() !== "---") return null;
  const open = i;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === "---") {
      return { open, close: j, bodyStart: j + 1 };
    }
  }
  return null;
}

function findLegacyHeaderBlock(
  lines: string[],
  startLine = 0,
): FrontmatterBlock | null {
  let i = startLine;
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() !== "---") i++;
    if (i >= lines.length) return null;
    const open = i;
    i++;
    let containsT = false;
    while (i < lines.length && lines[i].trim() !== "---") {
      if (lines[i].trim().startsWith("T:")) containsT = true;
      i++;
    }
    if (i >= lines.length) return null;
    if (containsT) return { open, close: i, bodyStart: i + 1 };
    i++;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Minimal YAML parser for our schema:
//   top-level scalars (name, description)
//   one nested block (metadata) containing scalars and one sub-block (recall)
//   recall contains scalars and one list (links) of scalar items
// -----------------------------------------------------------------------------

type YamlValue = string | number | boolean | null | YamlValue[] | YamlObject;
interface YamlObject {
  [key: string]: YamlValue;
}

function parseYamlScalar(raw: string): string | number | boolean | null {
  const t = raw.trim();
  if (t === "") return "";
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  return t;
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

function parseYamlBlock(lines: string[]): YamlObject {
  // Stack of {obj, indent} where obj is the container at that indent level.
  // Lists are represented as arrays attached to a key in the parent object.
  const root: YamlObject = {};
  const stack: { obj: YamlObject | YamlValue[]; indent: number }[] = [
    { obj: root, indent: -1 },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const indent = indentOf(line);
    const rest = line.slice(indent);

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const top = stack[stack.length - 1];
    const current = top.obj;

    if (rest.startsWith("- ")) {
      const value = parseYamlScalar(rest.slice(2));
      if (Array.isArray(current)) {
        current.push(value);
      }
      continue;
    }

    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) continue;
    const key = rest.slice(0, colonIdx).trim();
    const after = rest.slice(colonIdx + 1).trim();

    if (after === "") {
      let nextIdx = i + 1;
      while (nextIdx < lines.length && lines[nextIdx].trim() === "") nextIdx++;
      const childIsList =
        nextIdx < lines.length &&
        indentOf(lines[nextIdx]) > indent &&
        lines[nextIdx].slice(indentOf(lines[nextIdx])).startsWith("- ");
      if (Array.isArray(current)) continue;
      if (childIsList) {
        const arr: YamlValue[] = [];
        (current as YamlObject)[key] = arr;
        stack.push({ obj: arr, indent });
      } else {
        const obj: YamlObject = {};
        (current as YamlObject)[key] = obj;
        stack.push({ obj, indent });
      }
    } else {
      if (Array.isArray(current)) continue;
      (current as YamlObject)[key] = parseYamlScalar(after);
    }
  }

  return root;
}

// -----------------------------------------------------------------------------
// New (Claude Code-compatible) frontmatter
// -----------------------------------------------------------------------------

function parseNewFormat(lines: string[], block: FrontmatterBlock): MemoryHeader | null {
  const yamlLines = lines.slice(block.open + 1, block.close);
  const data = parseYamlBlock(yamlLines);

  const metadata = data.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const meta = metadata as YamlObject;

  const typeRaw = meta.type;
  if (typeof typeRaw !== "string") return null;
  const type = normalizeType(typeRaw);
  if (!type) return null;

  // Read-compat: v1 writes metadata.nous; legacy memories use metadata.recall.
  const recallRaw = meta.nous ?? meta.recall;
  const recall: YamlObject =
    recallRaw && typeof recallRaw === "object" && !Array.isArray(recallRaw)
      ? (recallRaw as YamlObject)
      : {};

  const nameSlug = typeof data.name === "string" ? data.name : "";
  const humanName = typeof recall.humanName === "string" ? recall.humanName : "";
  const description = typeof data.description === "string" ? data.description : "";

  const name = humanName || nameSlug;
  if (!name || !description) return null;

  const header: MemoryHeader = { type, name, description };

  if (typeof recall.created === "string" && isValidIsoDate(recall.created)) {
    header.created = recall.created;
  }
  if (typeof recall.updated === "string" && isValidIsoDate(recall.updated)) {
    header.updated = recall.updated;
  }
  if (typeof recall.accessCount === "number" && recall.accessCount >= 0) {
    header.accessCount = recall.accessCount;
  }
  if (Array.isArray(recall.links)) {
    const links = recall.links.filter((l): l is string => typeof l === "string" && l.length > 0);
    if (links.length > 0) header.links = links;
  }
  if (typeof recall.state === "string" && VALID_STATES.includes(recall.state as MemoryState)) {
    header.state = recall.state as MemoryState;
  }

  return header;
}

// -----------------------------------------------------------------------------
// Legacy (T:/D:/...) parser
// -----------------------------------------------------------------------------

function parseLegacyFormat(lines: string[], block: FrontmatterBlock): MemoryHeader | null {
  let type: string | undefined;
  let name: string | undefined;
  let description: string | undefined;
  let created: string | undefined;
  let updated: string | undefined;
  let accessCount: number | undefined;
  let links: string[] | undefined;

  for (let i = block.open + 1; i < block.close; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith("T:")) {
      const parts = trimmed.slice(2).split("|", 2);
      type = parts[0].trim();
      if (parts.length > 1) name = parts[1].trim();
    } else if (trimmed.startsWith("D:")) {
      description = trimmed.slice(2).trim();
    } else if (trimmed.startsWith("C:")) {
      const raw = trimmed.slice(2).trim();
      if (isValidIsoDate(raw)) created = raw;
    } else if (trimmed.startsWith("U:")) {
      const raw = trimmed.slice(2).trim();
      if (isValidIsoDate(raw)) updated = raw;
    } else if (trimmed.startsWith("A:")) {
      const raw = trimmed.slice(2).trim();
      if (/^\d+$/.test(raw)) accessCount = parseInt(raw, 10);
    } else if (trimmed.startsWith("L:")) {
      links = trimmed
        .slice(2)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  if (!type || !name || !description) return null;
  const normalizedType = normalizeType(type);
  if (!normalizedType) return null;

  const header: MemoryHeader = { type: normalizedType, name, description };
  if (created !== undefined) header.created = created;
  if (updated !== undefined) header.updated = updated;
  if (accessCount !== undefined) header.accessCount = accessCount;
  if (links !== undefined) header.links = links;
  return header;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

// Tries the new (Claude Code-compatible) format first. Falls back to the legacy
// T:/D:/... format. If the new format succeeds but lacks the metadata.recall
// sub-block, also scans for a legacy block (e.g. an old Nous header that
// Claude Code's normalization left untouched beneath its own frontmatter) and
// merges in any dates / access count / links from there. This preserves
// pre-v0.5.0 metadata on files Claude Code has normalized.
export function parseHeader(content: string): MemoryHeader | null {
  const lines = content.split("\n");

  const firstBlock = findFirstFrontmatterBlock(lines);
  if (firstBlock) {
    const newHeader = parseNewFormat(lines, firstBlock);
    if (newHeader) {
      const hasEnrichedData =
        newHeader.created !== undefined ||
        newHeader.updated !== undefined ||
        newHeader.accessCount !== undefined ||
        newHeader.links !== undefined;
      if (!hasEnrichedData) {
        const legacy = findLegacyHeaderBlock(lines, firstBlock.bodyStart);
        if (legacy) {
          const legacyHeader = parseLegacyFormat(lines, legacy);
          if (legacyHeader) {
            if (legacyHeader.created !== undefined) newHeader.created = legacyHeader.created;
            if (legacyHeader.updated !== undefined) newHeader.updated = legacyHeader.updated;
            if (legacyHeader.accessCount !== undefined) newHeader.accessCount = legacyHeader.accessCount;
            if (legacyHeader.links !== undefined) newHeader.links = legacyHeader.links;
          }
        }
      }
      return newHeader;
    }
  }

  const legacy = findLegacyHeaderBlock(lines);
  if (legacy) {
    return parseLegacyFormat(lines, legacy);
  }

  return null;
}

// -----------------------------------------------------------------------------
// Serialization — always writes the new (Claude Code-compatible) format.
// -----------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function quoteForYaml(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function serializeHeader(header: MemoryHeader): string {
  const slug = slugify(header.name);
  const needsHumanName = header.name !== slug;

  const lines: string[] = ["---"];
  lines.push(`name: ${slug}`);
  lines.push(`description: ${quoteForYaml(header.description)}`);
  lines.push("metadata:");
  lines.push("  node_type: memory");
  lines.push(`  type: ${header.type}`);
  lines.push("  nous:");
  if (needsHumanName) {
    lines.push(`    humanName: ${quoteForYaml(header.name)}`);
  }
  if (header.created !== undefined) {
    lines.push(`    created: ${header.created}`);
  }
  if (header.updated !== undefined) {
    lines.push(`    updated: ${header.updated}`);
  }
  if (header.accessCount !== undefined) {
    lines.push(`    accessCount: ${header.accessCount}`);
  }
  if (header.links !== undefined && header.links.length > 0) {
    lines.push("    links:");
    for (const link of header.links) {
      lines.push(`      - ${link}`);
    }
  }
  // Only persist non-default lifecycle state; absence means "active".
  if (header.state !== undefined && header.state !== "active") {
    lines.push(`    state: ${header.state}`);
  }
  lines.push("---");
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Body extraction
// -----------------------------------------------------------------------------

export function stripHeader(content: string): string {
  const lines = content.split("\n");

  // Prefer the new format's first frontmatter block if it parses.
  const firstBlock = findFirstFrontmatterBlock(lines);
  if (firstBlock && parseNewFormat(lines, firstBlock)) {
    // If a legacy T:/D:/... block sits immediately below (no real body
    // between the two), treat it as part of the header so the body starts
    // after the legacy block. This covers the migration case where Claude
    // Code's normalization added a new-format block above a pre-existing
    // legacy block.
    const trailingLegacy = findLegacyHeaderBlock(lines, firstBlock.bodyStart);
    if (trailingLegacy) {
      let onlyBlank = true;
      for (let i = firstBlock.bodyStart; i < trailingLegacy.open; i++) {
        if (lines[i].trim() !== "") {
          onlyBlank = false;
          break;
        }
      }
      if (onlyBlank) {
        return lines.slice(trailingLegacy.bodyStart).join("\n").trim();
      }
    }
    return lines.slice(firstBlock.bodyStart).join("\n").trim();
  }

  // Otherwise honor the legacy T:-bearing block.
  const legacy = findLegacyHeaderBlock(lines);
  if (legacy) {
    return lines.slice(legacy.bodyStart).join("\n").trim();
  }

  return content.trim();
}

export function replaceHeader(content: string, newHeader: MemoryHeader): string {
  const body = stripHeader(content);
  return `${serializeHeader(newHeader)}\n${body}`;
}
