// Sanitize a user/agent query into a safe FTS5 MATCH expression.
//
// Ported from Hermes' _sanitize_fts5_query (hermes_state.py ~L4752): protect
// balanced quoted phrases, strip FTS5 special characters, collapse repeated
// wildcards, drop dangling boolean operators, and — critically for a coding
// memory — AUTO-QUOTE dotted/hyphenated/slashed identifiers so `file.ts`,
// `foo-bar`, `src/lib` are matched as phrases instead of being tokenizer-split
// into spurious ANDs. FTS5 treats space-separated bare terms as implicit AND.

const BOOL_OPS = new Set(["AND", "OR", "NOT", "NEAR"]);

// Sentinel delimiters for phrase placeholders — control chars (U+0001/U+0002)
// that never appear in real queries and survive the strip + whitespace split.
const PH_OPEN = String.fromCharCode(1);
const PH_CLOSE = String.fromCharCode(2);

export function sanitizeFtsQuery(raw: string): string {
  if (!raw) return "";
  let q = raw.trim();
  if (!q) return "";

  // 1. Extract balanced quoted phrases into placeholders (no regex backtracking).
  const phrases: string[] = [];
  q = q.replace(/"([^"]*)"/g, (_m, inner: string) => {
    phrases.push(inner.trim());
    return ` ${PH_OPEN}${phrases.length - 1}${PH_CLOSE} `;
  });

  // 2. Neutralize FTS5 special characters (keep * for prefix, keep placeholders).
  q = q.replace(/[(){}:^"+]/g, " ");

  // 3. Tokenize and rebuild.
  const out: string[] = [];
  const phRe = new RegExp(`^${PH_OPEN}(\\d+)${PH_CLOSE}$`);
  for (let tok of q.split(/\s+/).filter(Boolean)) {
    const ph = tok.match(phRe);
    if (ph) {
      const phrase = phrases[Number(ph[1])];
      if (phrase) out.push(`"${phrase}"`);
      continue;
    }
    const upper = tok.toUpperCase();
    if (BOOL_OPS.has(upper)) {
      out.push(upper);
      continue;
    }
    tok = tok.replace(/\*+/g, "*"); // collapse repeated wildcards
    const prefix = tok.endsWith("*");
    const core = tok.replace(/\*+$/, "").replace(/^\*+/, "");
    if (!core) continue;
    // Auto-quote identifiers containing separators unicode61 would split on.
    if (/[.\-/@]/.test(core)) {
      out.push(`"${core}"` + (prefix ? "*" : ""));
    } else {
      out.push(prefix ? `${core}*` : core);
    }
  }

  // 4. Strip dangling leading/trailing boolean operators.
  while (out.length && BOOL_OPS.has(out[0])) out.shift();
  while (out.length && BOOL_OPS.has(out[out.length - 1])) out.pop();

  return out.join(" ");
}
