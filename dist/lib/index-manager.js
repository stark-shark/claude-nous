import * as fs from "node:fs";
const ENTRY_REGEX = /^-\s+\[(.+?)\]\((.+?)\)\s*[—-]\s*(.+)$/;
export function readIndex(indexPath) {
    if (!fs.existsSync(indexPath))
        return [];
    const content = fs.readFileSync(indexPath, "utf-8");
    const entries = [];
    for (const line of content.split("\n")) {
        const match = line.trim().match(ENTRY_REGEX);
        if (match) {
            entries.push({
                name: match[1],
                filename: match[2],
                description: match[3].trim(),
            });
        }
    }
    return entries;
}
export function upsertIndexEntry(indexPath, filename, name, description, maxLines) {
    let lines = [];
    if (fs.existsSync(indexPath)) {
        lines = fs.readFileSync(indexPath, "utf-8").split("\n");
    }
    else {
        lines = ["# Memory Index", ""];
    }
    const newEntry = `- [${name}](${filename}) — ${description}`;
    // Find and replace existing entry for this filename
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`(${filename})`)) {
            lines[i] = newEntry;
            found = true;
            break;
        }
    }
    if (!found) {
        lines.push(newEntry);
    }
    // Enforce max lines
    if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
    }
    fs.writeFileSync(indexPath, lines.join("\n") + "\n", "utf-8");
}
export function removeIndexEntry(indexPath, filename) {
    if (!fs.existsSync(indexPath))
        return;
    const lines = fs.readFileSync(indexPath, "utf-8").split("\n");
    const filtered = lines.filter((line) => !line.includes(`(${filename})`));
    fs.writeFileSync(indexPath, filtered.join("\n"), "utf-8");
}
//# sourceMappingURL=index-manager.js.map