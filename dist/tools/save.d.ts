import type { MemoryType } from "../lib/symbols.js";
import type { RecallConfig } from "../lib/config.js";
export interface SaveInput {
    name: string;
    type: MemoryType;
    description: string;
    content: string;
    links?: string[];
    project?: string;
}
export interface SaveResult {
    text: string;
    isError?: boolean;
    warnings: string[];
    filename: string;
}
export declare function handleSave(input: SaveInput, memoryDir: string, config: RecallConfig): SaveResult;
