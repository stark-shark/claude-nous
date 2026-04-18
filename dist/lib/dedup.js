import { createHash } from "node:crypto";
function normalize(content) {
    return content.replace(/\s+/g, " ").trim();
}
export function hashContent(content) {
    return createHash("sha256").update(normalize(content)).digest("hex");
}
export function findDuplicate(content, existingFiles) {
    const newHash = hashContent(content);
    for (const [filename, existingContent] of existingFiles) {
        if (hashContent(existingContent) === newHash) {
            return filename;
        }
    }
    return null;
}
//# sourceMappingURL=dedup.js.map