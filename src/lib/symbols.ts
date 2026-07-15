export const SYMBOL_GRAMMAR: Record<
  string,
  { meaning: string; example: string }
> = {
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

export const VALID_TYPES = ["fb", "proj", "ref", "usr"] as const;
export type MemoryType = (typeof VALID_TYPES)[number];

// Accept long-form type aliases too. Claude Code's native auto-memory writes
// `type: project`/`feedback`/`reference`/`user`; Nous canonicalizes to its short
// codes so those co-owned memory files still parse instead of going invisible.
const TYPE_ALIASES: Record<string, MemoryType> = {
  fb: "fb", feedback: "fb",
  proj: "proj", project: "proj",
  ref: "ref", reference: "ref",
  usr: "usr", user: "usr",
};

/** Canonicalize a raw type string to a MemoryType, or null if unrecognized. */
export function normalizeType(raw: string): MemoryType | null {
  return TYPE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export const TYPE_NAMES: Record<MemoryType, string> = {
  fb: "feedback",
  proj: "project",
  ref: "reference",
  usr: "user",
};

export const COMPRESSION_TARGETS: Record<MemoryType, { min: number; max: number }> = {
  fb: { min: 55, max: 65 },
  proj: { min: 55, max: 65 },
  ref: { min: 30, max: 40 },
  usr: { min: 40, max: 50 },
};

export const LINE_START_EXPANSIONS: Record<string, string> = {
  "::": "Because: ",
  "(+)": "Apply when: ",
};

export const INLINE_EXPANSIONS: Record<string, string> = {
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
