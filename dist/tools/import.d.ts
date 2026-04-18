import type { RecallConfig } from "../lib/config.js";
export interface ImportInput {
    file: string;
    project?: string;
}
export interface ImportResult {
    text: string;
    isError?: boolean;
}
export declare function handleImport(input: ImportInput, memoryDir: string, config: RecallConfig): ImportResult;
