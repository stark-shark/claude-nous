import { type MemoryType } from "./symbols.js";
export interface MemoryHeader {
    type: MemoryType;
    name: string;
    description: string;
    created?: string;
    updated?: string;
    accessCount?: number;
    links?: string[];
}
export declare function parseHeader(content: string): MemoryHeader | null;
export declare function serializeHeader(header: MemoryHeader): string;
export declare function stripHeader(content: string): string;
export declare function replaceHeader(content: string, newHeader: MemoryHeader): string;
