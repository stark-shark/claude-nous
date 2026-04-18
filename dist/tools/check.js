import * as fs from "node:fs";
import * as path from "node:path";
import { parseHeader, stripHeader } from "../lib/parser.js";
import { loadRegistry, findUnknownEntities } from "../lib/registry.js";
import { decodeMemory } from "../lib/decode.js";
import { hashContent } from "../lib/dedup.js";
import { COMPRESSION_TARGETS, TYPE_NAMES, VALID_TYPES, } from "../lib/symbols.js";
function loadAllMemories(memoryDirs) {
    const memories = [];
    for (const { memoryDir, projectHash } of memoryDirs) {
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
    // Build an index keyed by project hash so cross-project links (hash::slug) can resolve.
    const byProject = new Map();
    for (const m of memories) {
        const slug = m.filename.replace(".md", "");
        const set = byProject.get(m.project) ?? new Set();
        set.add(slug);
        byProject.set(m.project, set);
    }
    const issues = [];
    for (const m of memories) {
        for (const link of m.links) {
            if (link.includes("::")) {
                const [projectHash, slug] = link.split("::", 2);
                if (!projectHash || !slug) {
                    issues.push(`  '${m.name}' has malformed cross-project link '${link}' (expected hash::slug)`);
                    continue;
                }
                const targetSet = byProject.get(projectHash);
                if (!targetSet) {
                    issues.push(`  '${m.name}' links to unknown project '${projectHash}' via '${link}'`);
                    continue;
                }
                if (!targetSet.has(slug)) {
                    issues.push(`  '${m.name}' has broken cross-project link to '${link}'`);
                }
            }
            else {
                const sameProject = byProject.get(m.project);
                if (!sameProject || !sameProject.has(link)) {
                    issues.push(`  '${m.name}' has broken link to '${link}'`);
                }
            }
        }
    }
    if (issues.length === 0)
        return "Links — no broken references";
    return `Links — ${issues.length} broken:\n${issues.join("\n")}`;
}
function checkDuplicates(memories) {
    const hashes = new Map();
    for (const m of memories) {
        const body = stripHeader(m.content);
        if (!body)
            continue;
        const h = hashContent(body);
        const bucket = hashes.get(h) ?? [];
        bucket.push(m);
        hashes.set(h, bucket);
    }
    const issues = [];
    for (const bucket of hashes.values()) {
        if (bucket.length > 1) {
            const names = bucket.map((m) => `'${m.name}' [${m.project}]`).join(", ");
            issues.push(`  Identical content: ${names}`);
        }
    }
    if (issues.length === 0)
        return "Duplicates — no identical memories";
    return `Duplicates — ${issues.length} group(s):\n${issues.join("\n")}`;
}
function checkCompression(memories, memoryDirs, config) {
    // Build per-project registry cache so decodeMemory uses the right expansions.
    const registries = new Map();
    for (const { projectHash, memoryDir } of memoryDirs) {
        registries.set(projectHash, loadRegistry(path.join(memoryDir, config.registryFile)));
    }
    const tolerance = config.healthChecks.compressionTolerancePct;
    const issues = [];
    for (const m of memories) {
        if (!VALID_TYPES.includes(m.type))
            continue;
        const target = COMPRESSION_TARGETS[m.type];
        if (!target)
            continue;
        const body = stripHeader(m.content);
        if (!body.trim())
            continue;
        const registry = registries.get(m.project) ?? new Map();
        const decoded = decodeMemory(body, registry);
        if (decoded.length === 0)
            continue;
        // ratio = how much shorter the compressed form is vs decoded, as percent.
        const ratio = (1 - body.length / decoded.length) * 100;
        const min = target.min - tolerance;
        const max = target.max + tolerance;
        if (ratio < min) {
            issues.push(`  '${m.name}' (${m.type}) — ${ratio.toFixed(1)}% compressed, below target ${target.min}–${target.max}% (tolerance ±${tolerance}). Consider tighter notation.`);
        }
        else if (ratio > max) {
            issues.push(`  '${m.name}' (${m.type}) — ${ratio.toFixed(1)}% compressed, above target ${target.min}–${target.max}% (tolerance ±${tolerance}). Content may be over-compressed or too short.`);
        }
    }
    if (issues.length === 0)
        return "Compression — all memories within target ratios";
    return `Compression — ${issues.length} outside target:\n${issues.join("\n")}`;
}
export function handleCheck(input, memoryDirs, config) {
    const checks = input.checks.includes("all")
        ? ["stats", "stale", "registry", "links", "compression", "duplicates"]
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
                sections.push(checkCompression(memories, memoryDirs, config));
                break;
            case "duplicates":
                sections.push(checkDuplicates(memories));
                break;
        }
    }
    return { text: sections.join("\n\n") };
}
//# sourceMappingURL=check.js.map