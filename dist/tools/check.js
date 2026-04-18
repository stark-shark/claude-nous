import * as fs from "node:fs";
import * as path from "node:path";
import { parseHeader } from "../lib/parser.js";
import { loadRegistry, findUnknownEntities } from "../lib/registry.js";
import { TYPE_NAMES } from "../lib/symbols.js";
function loadAllMemories(memoryDirs) {
    const memories = [];
    for (const { memoryDir, projectHash } of memoryDirs) {
        if (!fs.existsSync(memoryDir))
            continue;
        for (const f of fs.readdirSync(memoryDir)) {
            if (!f.endsWith(".md") || f === "MEMORY.md" || f === "REGISTRY.md")
                continue;
            const content = fs.readFileSync(path.join(memoryDir, f), "utf-8");
            const header = parseHeader(content);
            if (!header)
                continue;
            memories.push({
                filename: f,
                name: header.name,
                type: header.type,
                description: header.description,
                updated: header.updated,
                accessCount: header.accessCount ?? 0,
                links: header.links ?? [],
                content,
                project: projectHash,
            });
        }
    }
    return memories;
}
function checkStats(memories) {
    const byType = {};
    const byProject = {};
    let mostAccessed = { name: "none", count: 0 };
    let leastAccessed = { name: "none", count: Infinity };
    for (const m of memories) {
        byType[m.type] = (byType[m.type] ?? 0) + 1;
        byProject[m.project] = (byProject[m.project] ?? 0) + 1;
        if (m.accessCount > mostAccessed.count) {
            mostAccessed = { name: m.name, count: m.accessCount };
        }
        if (m.accessCount < leastAccessed.count) {
            leastAccessed = { name: m.name, count: m.accessCount };
        }
    }
    const typeStr = Object.entries(byType)
        .map(([t, c]) => `${TYPE_NAMES[t] ?? t}: ${c}`)
        .join(", ");
    const projectStr = Object.entries(byProject)
        .map(([p, c]) => `${p}: ${c}`)
        .join(", ");
    const lines = [
        `Stats`,
        `  Memories: ${memories.length} (${typeStr})`,
        `  Projects: ${Object.keys(byProject).length} (${projectStr})`,
    ];
    if (memories.length > 0) {
        lines.push(`  Most accessed: '${mostAccessed.name}' — ${mostAccessed.count} loads`);
        lines.push(`  Least accessed: '${leastAccessed.name}' — ${leastAccessed.count} loads`);
    }
    return lines.join("\n");
}
function checkStale(memories, config) {
    const now = Date.now();
    const staleMs = config.healthChecks.staleDays * 24 * 60 * 60 * 1000;
    const stale = [];
    for (const m of memories) {
        if (!m.updated)
            continue;
        const updatedMs = new Date(m.updated).getTime();
        const age = now - updatedMs;
        if (age > staleMs && m.accessCount < config.healthChecks.staleMinAccess) {
            const days = Math.floor(age / (24 * 60 * 60 * 1000));
            stale.push(`  '${m.name}' (${m.type}) — last updated ${m.updated} (${days} days ago), accessed ${m.accessCount} times`);
        }
    }
    if (stale.length === 0)
        return "Staleness — all memories current";
    return `Staleness — ${stale.length} stale memories:\n${stale.join("\n")}`;
}
function checkRegistry(memories, memoryDirs, registryFile) {
    const issues = [];
    for (const { memoryDir } of memoryDirs) {
        const registryPath = path.join(memoryDir, registryFile);
        const registry = loadRegistry(registryPath);
        const dirMemories = memories.filter((m) => fs.existsSync(path.join(memoryDir, m.filename)));
        for (const m of dirMemories) {
            const unknown = findUnknownEntities(m.content, registry);
            if (unknown.length > 0) {
                issues.push(`  '${m.name}' uses unknown entities: ${unknown.join(", ")}`);
            }
        }
        // Find unused registry entries
        const allContent = dirMemories.map((m) => m.content).join("\n");
        for (const code of registry.keys()) {
            if (!allContent.includes(code)) {
                issues.push(`  Registry entry ${code} is not referenced by any memory`);
            }
        }
    }
    if (issues.length === 0)
        return "Registry — all entities valid";
    return `Registry — ${issues.length} issues:\n${issues.join("\n")}`;
}
function checkLinks(memories) {
    const allFilenames = new Set(memories.map((m) => m.filename.replace(".md", "")));
    const issues = [];
    for (const m of memories) {
        for (const link of m.links) {
            if (link.includes("::"))
                continue; // cross-project, skip for now
            if (!allFilenames.has(link)) {
                issues.push(`  '${m.name}' has broken link to '${link}'`);
            }
        }
    }
    if (issues.length === 0)
        return "Links — no broken references";
    return `Links — ${issues.length} broken:\n${issues.join("\n")}`;
}
export function handleCheck(input, memoryDirs, config) {
    const checks = input.checks.includes("all")
        ? ["stats", "stale", "registry", "links"]
        : input.checks;
    const memories = loadAllMemories(memoryDirs);
    const sections = [];
    for (const check of checks) {
        switch (check) {
            case "stats":
                sections.push(checkStats(memories));
                break;
            case "stale":
                sections.push(checkStale(memories, config));
                break;
            case "registry":
                sections.push(checkRegistry(memories, memoryDirs, config.registryFile));
                break;
            case "links":
                sections.push(checkLinks(memories));
                break;
            case "compression":
                sections.push("Compression — not yet implemented");
                break;
            case "duplicates":
                sections.push("Duplicates — not yet implemented");
                break;
        }
    }
    return { text: sections.join("\n\n") };
}
//# sourceMappingURL=check.js.map