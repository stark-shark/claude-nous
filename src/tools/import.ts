import * as fs from "node:fs";
import * as path from "node:path";
import type { RecallConfig } from "../lib/config.js";
import { loadRegistry, saveRegistry } from "../lib/registry.js";

export interface ImportInput {
  file: string;
  project?: string;
}

export interface ImportResult {
  text: string;
  isError?: boolean;
}

export function handleImport(
  input: ImportInput,
  memoryDir: string,
  config: RecallConfig
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

  let data: { version?: number; registry?: Record<string, string>; memories?: Array<{ filename: string; header: { type?: string; name?: string; description?: string; created?: string }; content: string }> };
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { text: `Invalid JSON in ${input.file}: ${(err as Error).message}`, isError: true };
  }

  if (data.version !== 1) {
    return { text: `Unsupported export version: ${data.version ?? "missing"}`, isError: true };
  }

  let imported = 0;
  let skipped = 0;
  const skippedNames: string[] = [];

  // Import registry entries
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

  // Import memories
  for (const mem of data.memories ?? []) {
    const filePath = path.join(memoryDir, mem.filename);

    if (fs.existsSync(filePath)) {
      skipped++;
      skippedNames.push(mem.filename);
      continue;
    }

    // Reconstruct the file with header
    const headerLines = ["---"];
    if (mem.header.type && mem.header.name) {
      headerLines.push(`T:${mem.header.type} | ${mem.header.name}`);
    }
    if (mem.header.description) {
      headerLines.push(`D:${mem.header.description}`);
    }
    if (mem.header.created) {
      headerLines.push(`C:${mem.header.created}`);
    }
    headerLines.push(`U:${new Date().toISOString().slice(0, 10)}`);
    headerLines.push("A:0");
    headerLines.push("---");

    const content = `${headerLines.join("\n")}\n${mem.content}\n`;
    fs.writeFileSync(filePath, content, "utf-8");
    imported++;
  }

  let text = `Imported ${imported} memories.`;
  if (skipped > 0) {
    text += ` ${skipped} skipped (already exist): ${skippedNames.join(", ")}`;
  }

  return { text };
}
