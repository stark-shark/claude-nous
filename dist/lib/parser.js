import { VALID_TYPES } from "./symbols.js";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidIsoDate(s) {
    if (!ISO_DATE.test(s))
        return false;
    const d = new Date(s + "T00:00:00Z");
    if (Number.isNaN(d.getTime()))
        return false;
    // Reject out-of-range days like 2026-02-30 that Date would silently roll over
    return d.toISOString().slice(0, 10) === s;
}
export function parseHeader(content) {
    const lines = content.split("\n");
    let inHeader = false;
    let type;
    let name;
    let description;
    let created;
    let updated;
    let accessCount;
    let links;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "---") {
            if (!inHeader) {
                inHeader = true;
                continue;
            }
            else {
                break;
            }
        }
        if (!inHeader)
            continue;
        if (trimmed.startsWith("T:")) {
            const parts = trimmed.slice(2).split("|", 2);
            type = parts[0].trim();
            if (parts.length > 1)
                name = parts[1].trim();
        }
        else if (trimmed.startsWith("D:")) {
            description = trimmed.slice(2).trim();
        }
        else if (trimmed.startsWith("C:")) {
            const raw = trimmed.slice(2).trim();
            if (isValidIsoDate(raw))
                created = raw;
        }
        else if (trimmed.startsWith("U:")) {
            const raw = trimmed.slice(2).trim();
            if (isValidIsoDate(raw))
                updated = raw;
        }
        else if (trimmed.startsWith("A:")) {
            const raw = trimmed.slice(2).trim();
            if (/^\d+$/.test(raw)) {
                accessCount = parseInt(raw, 10);
            }
        }
        else if (trimmed.startsWith("L:")) {
            links = trimmed
                .slice(2)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        }
    }
    if (!type || !name || !description)
        return null;
    if (!VALID_TYPES.includes(type))
        return null;
    const header = {
        type: type,
        name,
        description,
    };
    if (created !== undefined)
        header.created = created;
    if (updated !== undefined)
        header.updated = updated;
    if (accessCount !== undefined)
        header.accessCount = accessCount;
    if (links !== undefined)
        header.links = links;
    return header;
}
export function serializeHeader(header) {
    const lines = ["---"];
    lines.push(`T:${header.type} | ${header.name}`);
    lines.push(`D:${header.description}`);
    if (header.created !== undefined)
        lines.push(`C:${header.created}`);
    if (header.updated !== undefined)
        lines.push(`U:${header.updated}`);
    if (header.accessCount !== undefined)
        lines.push(`A:${header.accessCount}`);
    if (header.links !== undefined && header.links.length > 0) {
        lines.push(`L:${header.links.join(", ")}`);
    }
    lines.push("---");
    return lines.join("\n");
}
export function stripHeader(content) {
    const parts = content.split("---");
    if (parts.length >= 3) {
        return parts.slice(2).join("---").trim();
    }
    return content.trim();
}
export function replaceHeader(content, newHeader) {
    const body = stripHeader(content);
    return `${serializeHeader(newHeader)}\n${body}`;
}
//# sourceMappingURL=parser.js.map