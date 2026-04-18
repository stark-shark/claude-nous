export const SYMBOL_GRAMMAR = {
    "->": { meaning: "maps to / becomes / leads to", example: "FK->$emp.id" },
    "::": { meaning: "because / reason", example: ":: cost too high" },
    "(+)": { meaning: "apply when / trigger condition", example: "(+) new FK to $emp" },
    "!": { meaning: "not / without / never", example: "!httpOnly on auth cookies" },
    "=": { meaning: "equals / is defined as", example: "sonnet=$0.07/chat" },
    "!=": { meaning: "is not / must not be", example: "public schema !=app data" },
    "&": { meaning: "and (joining related items)", example: "auth & session mgmt" },
    "|": { meaning: "or / separator in headers", example: "T:fb | name" },
    "@": { meaning: "at / on / in context of", example: "UUID swap @invite" },
    ">>": { meaning: "results in / therefore", example: "!CASCADE >> broken invite" },
    "~": { meaning: "approximately / around", example: "~2027" },
    "...": { meaning: "continuation / more exists", example: "tables: x, y, z ..." },
};
export const VALID_TYPES = ["fb", "proj", "ref", "usr"];
export const TYPE_NAMES = {
    fb: "feedback",
    proj: "project",
    ref: "reference",
    usr: "user",
};
export const COMPRESSION_TARGETS = {
    fb: { min: 55, max: 65 },
    proj: { min: 55, max: 65 },
    ref: { min: 30, max: 40 },
    usr: { min: 40, max: 50 },
};
export const LINE_START_EXPANSIONS = {
    "::": "Because: ",
    "(+)": "Apply when: ",
};
export const INLINE_EXPANSIONS = {
    ">>": " results in ",
    "->": " maps to ",
    "<->": " maps bidirectionally to ",
    "!=": " is not ",
    "::": " because ",
    "(+)": " apply when ",
};
export const DROP_WORDS = [
    "a", "an", "the",
    "just", "basically", "essentially", "really",
    "might", "could", "perhaps", "probably",
    "however", "additionally", "furthermore",
];
//# sourceMappingURL=symbols.js.map