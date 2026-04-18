import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
const DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
export function projectPathToHash(projectPath) {
    return projectPath
        .replace(/:/g, "-")
        .replace(/[\\/]/g, "-");
}
export function getMemoryDir(projectHash, projectsRoot = DEFAULT_PROJECTS_ROOT) {
    const memDir = path.join(projectsRoot, projectHash, "memory");
    return fs.existsSync(memDir) ? memDir : null;
}
export function getCurrentProjectHash() {
    return projectPathToHash(process.cwd());
}
export function discoverAllMemoryDirs(projectsRoot = DEFAULT_PROJECTS_ROOT) {
    if (!fs.existsSync(projectsRoot)) {
        return [];
    }
    const entries = [];
    for (const name of fs.readdirSync(projectsRoot)) {
        const memDir = path.join(projectsRoot, name, "memory");
        if (fs.existsSync(memDir) && fs.statSync(memDir).isDirectory()) {
            entries.push({ projectHash: name, memoryDir: memDir });
        }
    }
    return entries;
}
export function ensureMemoryDir(projectHash, projectsRoot = DEFAULT_PROJECTS_ROOT) {
    const memDir = path.join(projectsRoot, projectHash, "memory");
    fs.mkdirSync(memDir, { recursive: true });
    return memDir;
}
//# sourceMappingURL=memory-dir.js.map