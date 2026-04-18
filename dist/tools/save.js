import * as fs from "node:fs";
import * as path from "node:path";
import { serializeHeader, parseHeader, stripHeader } from "../lib/parser.js";
import { validateNotation } from "../lib/validator.js";
import { findDuplicate } from "../lib/dedup.js";
import { loadRegistry, findUnknownEntities } from "../lib/registry.js";
import { upsertIndexEntry } from "../lib/index-manager.js";
import { ensureBidirectionalLinks } from "../lib/links.js";
function nameToFilename(name, type) {
    const prefix = type === "fb" ? "feedback" :
        type === "proj" ? "project" :
            type === "ref" ? "reference" :
                "user";
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
    return `${prefix}_${slug}.md`;
}
function todayStr() {
    return new Date().toISOString().slice(0, 10);
}
export function handleSave(input, memoryDir, config) {
    const warnings = [];
    const filename = nameToFilename(input.name, input.type);
    const filePath = path.join(memoryDir, filename);
    // Validate notation
    if (config.notationEnforcement !== "off") {
        const validation = validateNotation(input.content, input.type);
        if (config.notationEnforcement === "strict" && !validation.valid) {
            return {
                text: `Notation validation failed:\n${validation.errors.join("\n")}\n\nCompress using the Recall symbol grammar before saving.`,
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
    const existingFiles = new Map();
    for (const f of fs.readdirSync(memoryDir)) {
        if (f.endsWith(".md") && f !== "MEMORY.md" && f !== "REGISTRY.md" && f !== filename) {
            try {
                const content = fs.readFileSync(path.join(memoryDir, f), "utf-8");
                const body = stripHeader(content);
                existingFiles.set(f, body);
            }
            catch (err) {
                warnings.push(`Skipped unreadable file ${f}: ${err.message}`);
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
        warnings.push(`Unknown entities (not in ${config.registryFile}): ${unknownEntities.join(", ")}`);
    }
    // Build header
    const isUpdate = fs.existsSync(filePath);
    let header;
    if (isUpdate) {
        const existing = fs.readFileSync(filePath, "utf-8");
        const existingHeader = parseHeader(existing);
        // Detect slug collision: same filename but different logical memory name
        if (existingHeader &&
            existingHeader.name.toLowerCase() !== input.name.toLowerCase()) {
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
    }
    else {
        header = {
            type: input.type,
            name: input.name,
            description: input.description,
            accessCount: 0,
            links: input.links,
        };
    }
    if (config.headerFields.dates) {
        if (!header.created)
            header.created = todayStr();
        header.updated = todayStr();
    }
    // Write file
    const fileContent = `${serializeHeader(header)}\n${input.content}\n`;
    fs.writeFileSync(filePath, fileContent, "utf-8");
    // Update index
    if (config.maintainIndex) {
        const indexPath = path.join(memoryDir, config.indexFile);
        const { truncated } = upsertIndexEntry(indexPath, filename, input.name, input.description, config.indexMaxLines);
        if (truncated > 0) {
            warnings.push(`${config.indexFile} reached indexMaxLines (${config.indexMaxLines}); dropped ${truncated} oldest entr${truncated === 1 ? "y" : "ies"}. Memory files themselves are untouched.`);
        }
    }
    // Maintain bidirectional links (best-effort; a failure here doesn't invalidate the save)
    if (config.headerFields.links && header.links && header.links.length > 0) {
        try {
            const { crossProject } = ensureBidirectionalLinks(filename.replace(".md", ""), header.links, memoryDir);
            if (crossProject.length > 0) {
                warnings.push(`Cross-project links (${crossProject.join(", ")}) are not auto-reversed. Add the reverse link manually in the target project if desired.`);
            }
        }
        catch (err) {
            warnings.push(`Bidirectional link update failed: ${err.message}. The memory was saved, but some target links may not point back. Run recall_check --links to verify.`);
        }
    }
    const action = isUpdate ? "Updated" : "Saved";
    let text = `${action} memory: '${input.name}' (${input.type}) → ${filename}`;
    if (warnings.length > 0) {
        text += `\n\nWarnings:\n${warnings.map((w) => `  ⚠ ${w}`).join("\n")}`;
    }
    return { text, warnings, filename };
}
//# sourceMappingURL=save.js.map