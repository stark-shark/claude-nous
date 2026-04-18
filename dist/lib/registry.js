import * as fs from "node:fs";
export function loadRegistry(registryPath) {
    const registry = new Map();
    if (!fs.existsSync(registryPath)) {
        return registry;
    }
    const content = fs.readFileSync(registryPath, "utf-8");
    for (const line of content.split("\n")) {
        const match = line.match(/^(\$[\w-]+)\s*=\s*(.+)$/);
        if (match) {
            registry.set(match[1], match[2].trim());
        }
    }
    return registry;
}
export function saveRegistry(registryPath, registry) {
    if (fs.existsSync(registryPath)) {
        let content = fs.readFileSync(registryPath, "utf-8");
        const existingEntries = new Set();
        for (const line of content.split("\n")) {
            const match = line.match(/^(\$[\w-]+)\s*=/);
            if (match)
                existingEntries.add(match[1]);
        }
        // Update existing entries
        for (const [code, expansion] of registry) {
            if (existingEntries.has(code)) {
                content = content.replace(new RegExp(`^\\${code}\\s*=.*$`, "m"), `${code} = ${expansion}`);
            }
        }
        // Append new entries at end
        const newEntries = [];
        for (const [code, expansion] of registry) {
            if (!existingEntries.has(code)) {
                newEntries.push(`${code} = ${expansion}`);
            }
        }
        if (newEntries.length > 0) {
            content = content.trimEnd() + "\n" + newEntries.join("\n") + "\n";
        }
        fs.writeFileSync(registryPath, content, "utf-8");
    }
    else {
        const lines = ["# Entity Registry\n"];
        for (const [code, expansion] of registry) {
            lines.push(`${code} = ${expansion}`);
        }
        fs.writeFileSync(registryPath, lines.join("\n") + "\n", "utf-8");
    }
}
export function addEntry(registry, code, expansion) {
    if (registry.has(code)) {
        return { ok: false, error: `Entity '${code}' already exists: ${registry.get(code)}` };
    }
    registry.set(code, expansion);
    return { ok: true };
}
export function removeEntry(registry, code) {
    if (!registry.has(code)) {
        return { ok: false, error: `Entity '${code}' not found` };
    }
    registry.delete(code);
    return { ok: true };
}
export function findUnknownEntities(content, registry) {
    const matches = content.match(/\$[\w-]+/g) ?? [];
    const unique = [...new Set(matches)];
    return unique.filter((code) => !registry.has(code));
}
//# sourceMappingURL=registry.js.map