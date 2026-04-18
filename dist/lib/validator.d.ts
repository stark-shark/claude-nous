import { type MemoryType } from "./symbols.js";
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
export declare function validateNotation(content: string, type: MemoryType): ValidationResult;
