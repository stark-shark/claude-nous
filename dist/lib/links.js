import * as fs from "node:fs";
import * as path from "node:path";
import { parseHeader, serializeHeader, stripHeader } from "./parser.js";
export function ensureBidirectionalLinks(sourceMemory, targetLinks, memoryDir) {
    for (const target of targetLinks) {
        // Skip cross-project links (contain ::) for now
        if (target.includes("::"))
            continue;
        const targetPath = path.join(memoryDir, `${target}.md`);
        if (!fs.existsSync(targetPath))
            continue;
        const content = fs.readFileSync(targetPath, "utf-8");
        const header = parseHeader(content);
        if (!header)
            continue;
        const existingLinks = header.links ?? [];
        if (existingLinks.includes(sourceMemory))
            continue;
        header.links = [...existingLinks, sourceMemory];
        const body = stripHeader(content);
        const updated = `${serializeHeader(header)}\n${body}`;
        fs.writeFileSync(targetPath, updated, "utf-8");
    }
}
//# sourceMappingURL=links.js.map