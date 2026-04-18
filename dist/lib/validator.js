import { DROP_WORDS } from "./symbols.js";
const RECALL_SYMBOLS = ["->", "::", "(+)", "!", ">>", "@", "~", "!=", "&"];
const FB_REQUIRED_FIELDS = ["rule:", "::", "(+)"];
export function validateNotation(content, type) {
    const errors = [];
    const warnings = [];
    // Check fb required fields
    if (type === "fb") {
        for (const field of FB_REQUIRED_FIELDS) {
            if (!content.includes(field)) {
                errors.push(`Feedback memory missing required field: ${field}`);
            }
        }
    }
    // Check drop rule violations
    const words = content.toLowerCase().split(/\s+/);
    const dropViolations = DROP_WORDS.filter((w) => words.includes(w));
    if (dropViolations.length > 3) {
        warnings.push(`Possible drop rule violations (${dropViolations.length} filler words): ${dropViolations.join(", ")}`);
    }
    // Check symbol density — at least 1 symbol per 5 lines of content
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length >= 5) {
        const symbolCount = RECALL_SYMBOLS.reduce((count, sym) => count + (content.split(sym).length - 1), 0);
        const expectedMin = Math.floor(lines.length / 5);
        if (symbolCount < expectedMin) {
            warnings.push(`Low symbol density: ${symbolCount} symbols in ${lines.length} lines. Expected at least ${expectedMin}. Content may not be using Recall notation.`);
        }
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}
//# sourceMappingURL=validator.js.map