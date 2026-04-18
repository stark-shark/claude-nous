import * as fs from "node:fs";
import * as path from "node:path";
import { parseHeader, stripHeader } from "../lib/parser.js";
import { loadRegistry } from "../lib/registry.js";
export function handleExport(input, memoryDirs, registryFile) {
    const dirs = input.project
        ? memoryDirs.filter((d) => d.projectHash === input.project)
        : memoryDirs;
    const allMemories = [];
    const allRegistry = {};
    for (const { memoryDir, projectHash } of dirs) {
        if (!fs.existsSync(memoryDir))
            continue;
        // Load registry
        const registryPath = path.join(memoryDir, registryFile);
        const registry = loadRegistry(registryPath);
        for (const [code, expansion] of registry) {
            allRegistry[code] = expansion;
        }
        // Load memories
        for (const f of fs.readdirSync(memoryDir)) {
            if (!f.endsWith(".md") || f === "MEMORY.md" || f === registryFile)
                continue;
            const raw = fs.readFileSync(path.join(memoryDir, f), "utf-8");
            const header = parseHeader(raw);
            if (!header)
                continue;
            const body = stripHeader(raw);
            allMemories.push({
                filename: f,
                header: { ...header },
                content: body,
                project: projectHash,
            });
        }
    }
    const exportData = {
        version: 1,
        exportDate: new Date().toISOString().slice(0, 10),
        project: input.project ?? "all",
        registry: allRegistry,
        memories: allMemories,
    };
    fs.writeFileSync(input.outputPath, JSON.stringify(exportData, null, 2), "utf-8");
    return {
        text: `Exported ${allMemories.length} memories and ${Object.keys(allRegistry).length} registry entries to ${input.outputPath}`,
    };
}
//# sourceMappingURL=export.js.map