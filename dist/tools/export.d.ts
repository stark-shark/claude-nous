import type { MemoryDirEntry } from "../lib/memory-dir.js";
export interface ExportInput {
    outputPath: string;
    project?: string;
}
export interface ExportResult {
    text: string;
    isError?: boolean;
}
export declare function handleExport(input: ExportInput, memoryDirs: MemoryDirEntry[], registryFile: string): ExportResult;
