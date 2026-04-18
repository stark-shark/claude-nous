import type { RecallConfig } from "../lib/config.js";
import type { MemoryDirEntry } from "../lib/memory-dir.js";
export interface LoadInput {
    name?: string;
    file?: string;
    expanded?: boolean;
}
export interface LoadResult {
    text: string;
    isError?: boolean;
}
export declare function handleLoad(input: LoadInput, memoryDirs: MemoryDirEntry[], config: RecallConfig): LoadResult;
