export interface MemoryDirEntry {
    projectHash: string;
    memoryDir: string;
}
export declare function projectPathToHash(projectPath: string): string;
export declare function getMemoryDir(projectHash: string, projectsRoot?: string): string | null;
export declare function getCurrentProjectHash(): string;
export declare function discoverAllMemoryDirs(projectsRoot?: string): MemoryDirEntry[];
export declare function ensureMemoryDir(projectHash: string, projectsRoot?: string): string;
