import * as fs from "node:fs";
import * as path from "node:path";
import { parseHeader, serializeHeader, stripHeader } from "../lib/parser.js";
import { loadRegistry } from "../lib/registry.js";
import { decodeMemory } from "../lib/decode.js";
function findMemoryFile(nameOrFile, memoryDirs) {
    const isFilename = nameOrFile.endsWith(".md");
    for (const { memoryDir, projectHash } of memoryDirs) {
        if (!fs.existsSync(memoryDir))
            continue;
        for (const f of fs.readdirSync(memoryDir)) {
            if (!f.endsWith(".md") || f === "MEMORY.md" || f === "REGISTRY.md")
                continue;
            if (isFilename && f === nameOrFile) {
                return { filePath: path.join(memoryDir, f), memoryDir, projectHash };
            }
            if (!isFilename) {
                const content = fs.readFileSync(path.join(memoryDir, f), "utf-8");
                const header = parseHeader(content);
                if (header && header.name.toLowerCase() === nameOrFile.toLowerCase()) {
                    return { filePath: path.join(memoryDir, f), memoryDir, projectHash };
                }
            }
        }
    }
    return null;
}
export function handleLoad(input, memoryDirs, config) {
    const search = input.name ?? input.file;
    if (!search) {
        return { text: "Provide either 'name' or 'file' parameter.", isError: true };
    }
    const found = findMemoryFile(search, memoryDirs);
    if (!found) {
        return {
            text: `Memory '${search}' not found across ${memoryDirs.length} project(s).`,
            isError: true,
        };
    }
    let content = fs.readFileSync(found.filePath, "utf-8");
    const header = parseHeader(content);
    // Increment access count
    if (header && config.headerFields.accessCount) {
        header.accessCount = (header.accessCount ?? 0) + 1;
        const body = stripHeader(content);
        content = `${serializeHeader(header)}\n${body}`;
        fs.writeFileSync(found.filePath, content, "utf-8");
    }
    // Return raw or expanded
    if (input.expanded) {
        const registryPath = path.join(found.memoryDir, config.registryFile);
        const registry = loadRegistry(registryPath);
        const body = stripHeader(content);
        const decoded = decodeMemory(body, registry);
        let text = `# ${header?.name ?? search} (${header?.type ?? "unknown"})\n\n${decoded}`;
        if (header?.links && header.links.length > 0) {
            text += `\n\n**Related:** ${header.links.join(", ")}`;
        }
        return { text };
    }
    let text = content;
    if (header?.links && header.links.length > 0) {
        text += `\n\n**Related:** ${header.links.join(", ")}`;
    }
    return { text };
}
//# sourceMappingURL=load.js.map