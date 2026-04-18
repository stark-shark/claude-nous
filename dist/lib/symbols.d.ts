export declare const SYMBOL_GRAMMAR: Record<string, {
    meaning: string;
    example: string;
}>;
export declare const VALID_TYPES: readonly ["fb", "proj", "ref", "usr"];
export type MemoryType = (typeof VALID_TYPES)[number];
export declare const TYPE_NAMES: Record<MemoryType, string>;
export declare const COMPRESSION_TARGETS: Record<MemoryType, {
    min: number;
    max: number;
}>;
export declare const LINE_START_EXPANSIONS: Record<string, string>;
export declare const INLINE_EXPANSIONS: Record<string, string>;
export declare const DROP_WORDS: string[];
