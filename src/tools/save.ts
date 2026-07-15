import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryType } from "../lib/symbols.js";
import type { RecallConfig } from "../lib/config.js";
import { serializeHeader, parseHeader, stripHeader, type MemoryHeader } from "../lib/parser.js";
import { validateNotation } from "../lib/validator.js";
import { findDuplicate } from "../lib/dedup.js";
import { loadRegistry, findUnknownEntities } from "../lib/registry.js";
import { upsertIndexEntry, ARCHIVE_FILENAME } from "../lib/index-manager.js";
import { ensureBidirectionalLinks } from "../lib/links.js";
import { ensureDecoderFile } from "../lib/decoder-file.js";
import { capFor, measureCap, usageLine, overflowError } from "../lib/caps.js";
import { scanContent } from "../lib/threat.js";
import { backupFile } from "../lib/selfbuild.js";

export interface SaveInput {
  name: string;
  type: MemoryType;
  description: string;
  content: string;
  links?: string[];
  project?: string;
}

export interface SaveResult {
  text: string;
  isError?: boolean;
  warnings: string[];
  filename: string;
}

function nameToFilename(name: string, type: MemoryType): string {
  const prefix =
    type === "fb" ? "feedback" :
    type === "proj" ? "project" :
    type === "ref" ? "reference" :
    "user";

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  return `${prefix}_${slug}.md`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function handleSave(
  input: SaveInput,
  memoryDir: string,
  config: RecallConfig
): SaveResult {
  const warnings: string[] = [];
  // Reserve the canonical user.md for the usr-type "user"/"profile" memory so it
  // gets the special always-loaded slot + its own cap.
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const isUserFile = input.type === "usr" && (slug === "user" || slug === "profile");
  const filename = isUserFile
    ? config.userMemory.filename
    : nameToFilename(input.name, input.type);
  // The user profile is scoped to the USER (global), not the project.
  const targetDir = isUserFile && config.userMemory.dir ? config.userMemory.dir : memoryDir;
  if (targetDir !== memoryDir) fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, filename);

  // Security: scan content before it touches disk / the system prompt.
  if (config.security.scanOnWrite) {
    const scan = scanContent(input.content);
    if (scan.hasHard && config.security.rejectInvisible) {
      return {
        text:
          `Rejected — content failed security scan:\n` +
          scan.threats
            .filter((t) => t.severity === "hard")
            .map((t) => `  ✖ ${t.detail}`)
            .join("\n") +
          `\n\nNothing was written. Remove the flagged characters and retry.`,
        isError: true,
        warnings: [],
        filename,
      };
    }
    for (const t of scan.threats.filter((t) => t.severity === "soft")) {
      warnings.push(`security: ${t.detail}`);
    }
  }

  // Hermes-style hard cap on the notation body — force consolidation, never auto-truncate.
  {
    const cap = capFor(input.type, filename, config);
    const usage = measureCap(input.content.length, cap);
    if (!usage.unlimited && usage.over > 0) {
      let existingBody: string | null = null;
      if (fs.existsSync(filePath)) {
        try {
          existingBody = stripHeader(fs.readFileSync(filePath, "utf-8"));
        } catch {
          existingBody = null;
        }
      }
      return {
        text: overflowError(input.name, input.type, usage, existingBody),
        isError: true,
        warnings: [],
        filename,
      };
    }
  }

  // Validate notation
  if (config.notationEnforcement !== "off") {
    const validation = validateNotation(input.content, input.type);

    if (config.notationEnforcement === "strict" && !validation.valid) {
      return {
        text: `Notation validation failed:\n${validation.errors.join("\n")}\n\nCompress using the Nous symbol grammar before saving.`,
        isError: true,
        warnings: [],
        filename,
      };
    }

    if (!validation.valid) {
      warnings.push(...validation.errors.map((e) => `Error: ${e}`));
    }
    warnings.push(...validation.warnings);
  }

  // Check for duplicates
  const existingFiles = new Map<string, string>();
  for (const f of fs.readdirSync(memoryDir)) {
    if (f.endsWith(".md") && f !== "MEMORY.md" && f !== "REGISTRY.md" && f !== filename) {
      try {
        const content = fs.readFileSync(path.join(memoryDir, f), "utf-8");
        const body = stripHeader(content);
        existingFiles.set(f, body);
      } catch (err) {
        warnings.push(`Skipped unreadable file ${f}: ${(err as Error).message}`);
      }
    }
  }

  const duplicate = findDuplicate(input.content, existingFiles);
  if (duplicate) {
    return {
      text: `Duplicate of '${duplicate}' — update the existing memory instead.`,
      isError: true,
      warnings: [],
      filename,
    };
  }

  // Check registry
  const registryPath = path.join(memoryDir, config.registryFile);
  const registry = loadRegistry(registryPath);
  const unknownEntities = findUnknownEntities(input.content, registry);
  if (unknownEntities.length > 0) {
    warnings.push(
      `Unknown entities (not in ${config.registryFile}): ${unknownEntities.join(", ")}`
    );
  }

  // Build header
  const isUpdate = fs.existsSync(filePath);
  let header: MemoryHeader;

  if (isUpdate) {
    const existing = fs.readFileSync(filePath, "utf-8");
    const existingHeader = parseHeader(existing);

    // Detect slug collision: same filename but different logical memory name
    if (
      existingHeader &&
      existingHeader.name.toLowerCase() !== input.name.toLowerCase()
    ) {
      return {
        text: `Filename collision: '${input.name}' slugs to '${filename}', which is already used by '${existingHeader.name}'. Rename one of the memories to avoid overwriting.`,
        isError: true,
        warnings: [],
        filename,
      };
    }

    header = {
      type: input.type,
      name: input.name,
      description: input.description,
      created: existingHeader?.created,
      accessCount: existingHeader?.accessCount ?? 0,
      links: input.links ?? existingHeader?.links,
    };
  } else {
    header = {
      type: input.type,
      name: input.name,
      description: input.description,
      accessCount: 0,
      links: input.links,
    };
  }

  if (config.headerFields.dates) {
    if (!header.created) header.created = todayStr();
    header.updated = todayStr();
  }

  // Write file. Back up the prior version first on any overwrite so a rewrite
  // (esp. an autonomous condense via nous_maintain) is never a silent, permanent
  // loss of hand-written content — the anti-Hermes-self-rewrite guardrail.
  const fileContent = `${serializeHeader(header)}\n${input.content}\n`;
  if (isUpdate) {
    try {
      const prior = fs.readFileSync(filePath, "utf-8");
      if (prior !== fileContent) {
        // Co-located per-project backups (ignored by the scan, which only reads
        // top-level .md files) — restore by copying a .bak body back.
        backupFile(filePath, path.join(memoryDir, ".backups"), config.rules.maxBackups);
      }
    } catch {
      /* best effort — never block a save on backup failure */
    }
  }
  fs.writeFileSync(filePath, fileContent, "utf-8");

  // Refresh decoder cheatsheet alongside memories — survives plugin uninstall.
  ensureDecoderFile(memoryDir);

  // Update index (skip the user profile — it lives globally and is always injected)
  if (config.maintainIndex && !isUserFile) {
    const indexPath = path.join(memoryDir, config.indexFile);
    const { archived } = upsertIndexEntry(
      indexPath,
      filename,
      input.name,
      input.description,
      config.indexMaxLines
    );
    if (archived > 0) {
      warnings.push(
        `${config.indexFile} reached indexMaxLines (${config.indexMaxLines} entries); moved ${archived} oldest entr${archived === 1 ? "y" : "ies"} to ${ARCHIVE_FILENAME}. Memory files themselves are untouched — restore an entry by moving its line back, or raise indexMaxLines in nous.config.jsonc.`
      );
    }
  }

  // Maintain bidirectional links (best-effort; a failure here doesn't invalidate the save)
  if (config.headerFields.links && !isUserFile && header.links && header.links.length > 0) {
    try {
      const { crossProject } = ensureBidirectionalLinks(
        filename.replace(".md", ""),
        header.links,
        memoryDir
      );
      if (crossProject.length > 0) {
        warnings.push(
          `Cross-project links (${crossProject.join(", ")}) are not auto-reversed. Add the reverse link manually in the target project if desired.`
        );
      }
    } catch (err) {
      warnings.push(
        `Bidirectional link update failed: ${(err as Error).message}. The memory was saved, but some target links may not point back. Run nous_check --links to verify.`
      );
    }
  }

  const action = isUpdate ? "Updated" : "Saved";
  let text = `${action} memory: '${input.name}' (${input.type}) → ${filename}`;
  const usage = usageLine(
    input.type,
    filename,
    measureCap(input.content.length, capFor(input.type, filename, config)),
    config
  );
  if (usage) text += `  [${usage}]`;
  if (warnings.length > 0) {
    text += `\n\nWarnings:\n${warnings.map((w) => `  ⚠ ${w}`).join("\n")}`;
  }

  return { text, warnings, filename };
}
