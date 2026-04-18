import { DROP_WORDS } from "./symbols.js";
const RECALL_SYMBOLS = ["->", "::", "(+)", "!", ">>", "@", "~", "!=", "&"];
const FB_REQUIRED_FIELDS = ["rule:", "::", "(+)"];
function stripCodeBlocks(content) {
    const out = [];
    let inFence = false;
    for (const line of content.split("\n")) {
        if (line.trim().startsWith("```")) {
            inFence = !inFence;
            continue;
        }
        if (inFence)
            continue;
        out.push(line);
    }
    return out.join("\n");
}
export function validateNotation(content, type) {
    const errors = [];
    const warnings = [];
    // Check fb required fields (check on full content — users may put required markers
    // outside code blocks anyway, and we don't want to false-fail if markers appear inside).
    if (type === "fb") {
        const stripped = stripCodeBlocks(content);
        for (const field of FB_REQUIRED_FIELDS) {
            if (!stripped.includes(field)) {
                errors.push(`Feedback memory missing required field: ${field}`);
            }
        }
    }
    const prose = stripCodeBlocks(content);
    // Check drop rule violations (prose only — code samples legitimately use filler words)
    const words = prose.toLowerCase().split(/\s+/);
    const dropViolations = DROP_WORDS.filter((w) => words.includes(w));
    if (dropViolations.length > 3) {
        warnings.push(`Possible drop rule violations (${dropViolations.length} filler words): ${dropViolations.join(", ")}`);
    }
    // Check symbol density — at least 1 symbol per 5 lines of non-code content
    const lines = prose.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length >= 5) {
        const symbolCount = RECALL_SYMBOLS.reduce((count, sym) => count + (prose.split(sym).length - 1), 0);
        const expectedMin = Math.floor(lines.length / 5);
        if (symbolCount < expectedMin) {
            warnings.push(`Low symbol density: ${symbolCount} symbols in ${lines.length} lines (excluding code blocks). Expected at least ${expectedMin}. Content may not be using Recall notation.`);
        }
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}
//# sourceMappingURL=validator.js.map