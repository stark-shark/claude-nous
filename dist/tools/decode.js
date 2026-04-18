import * as fs from "node:fs";
import * as path from "node:path";
import { parseHeader, stripHeader } from "../lib/parser.js";
import { loadRegistry } from "../lib/registry.js";
import { decodeMemory } from "../lib/decode.js";
import { TYPE_NAMES } from "../lib/symbols.js";
function findAndDecode(nameOrFile, memoryDirs) {
    const isFilename = nameOrFile.endsWith(".md");
    for (const { memoryDir } of memoryDirs) {
        if (!fs.existsSync(memoryDir))
            continue;
        const registryPath = path.join(memoryDir, "REGISTRY.md");
        const registry = loadRegistry(registryPath);
        for (const f of fs.readdirSync(memoryDir)) {
            if (!f.endsWith(".md") || f === "MEMORY.md" || f === "REGISTRY.md")
                continue;
            const filePath = path.join(memoryDir, f);
            const content = fs.readFileSync(filePath, "utf-8");
            const header = parseHeader(content);
            if (!header)
                continue;
            const match = isFilename
                ? f === nameOrFile
                : header.name.toLowerCase() === nameOrFile.toLowerCase();
            if (match) {
                const body = stripHeader(content);
                const decoded = decodeMemory(body, registry);
                const typeName = TYPE_NAMES[header.type] ?? header.type;
                return {
                    text: `# ${header.name} (${typeName})\n${header.description}\n\n${decoded}`,
                };
            }
        }
    }
    return { text: `Memory '${nameOrFile}' not found.`, isError: true };
}
export function handleDecode(input, memoryDirs) {
    if (input.all) {
        const sections = [];
        for (const { memoryDir } of memoryDirs) {
            if (!fs.existsSync(memoryDir))
                continue;
            const registryPath = path.join(memoryDir, "REGISTRY.md");
            const registry = loadRegistry(registryPath);
            for (const f of fs.readdirSync(memoryDir)) {
                if (!f.endsWith(".md") || f === "MEMORY.md" || f === "REGISTRY.md")
                    continue;
                const content = fs.readFileSync(path.join(memoryDir, f), "utf-8");
                const header = parseHeader(content);
                if (!header)
                    continue;
                const body = stripHeader(content);
                const decoded = decodeMemory(body, registry);
                const typeName = TYPE_NAMES[header.type] ?? header.type;
                sections.push(`# ${header.name} (${typeName})\n${header.description}\n\n${decoded}`);
            }
        }
        return {
            text: sections.length > 0
                ? sections.join("\n\n---\n\n")
                : "No memories found.",
        };
    }
    const search = input.name ?? input.file;
    if (!search) {
        return { text: "Provide 'name', 'file', or 'all' parameter.", isError: true };
    }
    return findAndDecode(search, memoryDirs);
}
//# sourceMappingURL=decode.js.map