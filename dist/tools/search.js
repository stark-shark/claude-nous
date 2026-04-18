import * as fs from "node:fs";
import * as path from "node:path";
import { parseHeader } from "../lib/parser.js";
export function handleSearch(input, memoryDirs) {
    const matches = [];
    const queryLower = input.query.toLowerCase();
    const dirs = input.project
        ? memoryDirs.filter((d) => d.projectHash === input.project)
        : memoryDirs;
    for (const { memoryDir, projectHash } of dirs) {
        if (!fs.existsSync(memoryDir))
            continue;
        for (const f of fs.readdirSync(memoryDir)) {
            if (!f.endsWith(".md") || f === "MEMORY.md" || f === "REGISTRY.md")
                continue;
            let content;
            try {
                content = fs.readFileSync(path.join(memoryDir, f), "utf-8");
            }
            catch {
                continue;
            }
            const header = parseHeader(content);
            if (!header)
                continue;
            // Filter by type
            if (input.type && header.type !== input.type)
                continue;
            // Match query against name, description, and content
            if (queryLower) {
                const nameLower = header.name.toLowerCase();
                const descLower = header.description.toLowerCase();
                const contentLower = content.toLowerCase();
                if (!nameLower.includes(queryLower) &&
                    !descLower.includes(queryLower) &&
                    !contentLower.includes(queryLower)) {
                    continue;
                }
            }
            matches.push({
                name: header.name,
                description: header.description,
                type: header.type,
                filename: f,
                project: projectHash,
            });
        }
    }
    // Sort: name matches first, then description, then content
    matches.sort((a, b) => {
        const aNameMatch = a.name.toLowerCase().includes(queryLower) ? 0 : 1;
        const bNameMatch = b.name.toLowerCase().includes(queryLower) ? 0 : 1;
        if (aNameMatch !== bNameMatch)
            return aNameMatch - bNameMatch;
        return a.name.localeCompare(b.name);
    });
    const text = matches.length === 0
        ? `No memories found matching '${input.query}'.`
        : matches
            .map((m) => `- ${m.name} (${m.type}) [${m.project}] — ${m.description}`)
            .join("\n");
    return { matches, text };
}
//# sourceMappingURL=search.js.map