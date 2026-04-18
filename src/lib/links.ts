import * as fs from "node:fs";
import * as path from "node:path";
import { parseHeader, serializeHeader, stripHeader } from "./parser.js";

export interface LinkMaintenanceResult {
  crossProject: string[];
}

export function ensureBidirectionalLinks(
  sourceMemory: string,
  targetLinks: string[],
  memoryDir: string
): LinkMaintenanceResult {
  const crossProject: string[] = [];

  for (const target of targetLinks) {
    // Cross-project links (hash::slug) are not auto-maintained from a single-project save
    // to avoid silently writing into other projects. Callers should surface these so users
    // can add the reverse link manually (or run recall_check --links to find gaps).
    if (target.includes("::")) {
      crossProject.push(target);
      continue;
    }

    const targetPath = path.join(memoryDir, `${target}.md`);
    if (!fs.existsSync(targetPath)) continue;

    const content = fs.readFileSync(targetPath, "utf-8");
    const header = parseHeader(content);
    if (!header) continue;

    const existingLinks = header.links ?? [];
    if (existingLinks.includes(sourceMemory)) continue;

    header.links = [...existingLinks, sourceMemory];
    const body = stripHeader(content);
    const updated = `${serializeHeader(header)}\n${body}`;
    fs.writeFileSync(targetPath, updated, "utf-8");
  }

  return { crossProject };
}
