import type { RecallConfig } from "../lib/config.js";
import type { MemoryDirEntry } from "../lib/memory-dir.js";
type CheckType = "stale" | "registry" | "compression" | "links" | "duplicates" | "stats" | "all";
export interface CheckInput {
    checks: CheckType[];
}
export interface CheckResult {
    text: string;
}
export declare function handleCheck(input: CheckInput, memoryDirs: MemoryDirEntry[], config: RecallConfig): CheckResult;
export {};
