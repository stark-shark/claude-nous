import type { MemoryType } from "../lib/symbols.js";
import type { MemoryDirEntry } from "../lib/memory-dir.js";
export interface SearchInput {
    query: string;
    type?: MemoryType;
    project?: string;
}
export interface SearchMatch {
    name: string;
    description: string;
    type: string;
    filename: string;
    project: string;
}
export interface SearchResult {
    matches: SearchMatch[];
    text: string;
}
export declare function handleSearch(input: SearchInput, memoryDirs: MemoryDirEntry[]): SearchResult;
