import * as fs from "node:fs";
import * as path from "node:path";
import { loadRegistry, saveRegistry } from "../lib/registry.js";
export function handleImport(input, memoryDir, config) {
    if (!fs.existsSync(input.file)) {
        return { text: `File not found: ${input.file}`, isError: true };
    }
    const raw = fs.readFileSync(input.file, "utf-8");
    const data = JSON.parse(raw);
    if (data.version !== 1) {
        return { text: `Unsupported export version: ${data.version}`, isError: true };
    }
    let imported = 0;
    let skipped = 0;
    const skippedNames = [];
    // Import registry entries
    if (data.registry && Object.keys(data.registry).length > 0) {
        const registryPath = path.join(memoryDir, config.registryFile);
        const registry = loadRegistry(registryPath);
        for (const [code, expansion] of Object.entries(data.registry)) {
            if (!registry.has(code)) {
                registry.set(code, expansion);
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
//# sourceMappingURL=import.js.map