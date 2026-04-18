import { LINE_START_EXPANSIONS, INLINE_EXPANSIONS, } from "./symbols.js";
function expandSymbols(text) {
    const lines = text.split("\n");
    const result = [];
    for (let line of lines) {
        const stripped = line.trimStart();
        // Line-start symbols
        for (const [symbol, replacement] of Object.entries(LINE_START_EXPANSIONS)) {
            if (stripped.startsWith(symbol)) {
                const indent = line.slice(0, line.length - stripped.length);
                line = indent + replacement + stripped.slice(symbol.length).trimStart();
                break;
            }
        }
        // Inline symbols (skip code blocks)
        if (!stripped.startsWith("```")) {
            for (const [symbol, replacement] of Object.entries(INLINE_EXPANSIONS)) {
                if ((symbol === "::" || symbol === "(+)") &&
                    (line.trimStart().startsWith("Because:") ||
                        line.trimStart().startsWith("Apply when:"))) {
                    continue;
                }
                line = line.replaceAll(symbol, replacement);
            }
        }
        result.push(line);
    }
    return result.join("\n");
}
function expandBangNegation(text) {
    const lines = text.split("\n");
    const result = [];
    let inCodeBlock = false;
    for (const line of lines) {
        if (line.trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            result.push(line);
            continue;
        }
        if (inCodeBlock) {
            result.push(line);
            continue;
        }
        result.push(line.replace(/(?<![\\\/=\w])!(\w+)/g, "not $1"));
    }
    return result.join("\n");
}
function expandRegistry(text, registry) {
    if (registry.size === 0)
        return text;
    // Sort by length descending so $emp-mgmt matches before $emp
    const sorted = [...registry.entries()].sort((a, b) => b[0].length - a[0].length);
    let result = text;
    for (const [code, expansion] of sorted) {
        result = result.replaceAll(code, expansion);
    }
    return result;
}
export function decodeMemory(content, registry) {
    let decoded = expandSymbols(content);
    decoded = expandBangNegation(decoded);
    decoded = expandRegistry(decoded, registry);
    return decoded;
}
//# sourceMappingURL=decode.js.map