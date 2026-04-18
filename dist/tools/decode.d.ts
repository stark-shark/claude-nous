import type { MemoryDirEntry } from "../lib/memory-dir.js";
export interface DecodeInput {
    name?: string;
    file?: string;
    all?: boolean;
}
export interface DecodeResult {
    text: string;
    isError?: boolean;
}
export declare function handleDecode(input: DecodeInput, memoryDirs: MemoryDirEntry[]): DecodeResult;
