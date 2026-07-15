import { createHash } from "node:crypto";

// Secret / credential redaction for the cold tier.
//
// The indexer ingests raw Claude Code transcripts into FTS AND those turns feed
// session summaries + daily digests that get re-injected into the system prompt.
// So any credential a user pasted into a conversation would become both
// searchable and re-injected. redact() strips them BEFORE anything reaches the
// DB — defense in depth alongside threat.ts (which catches injection *prose*,
// not credentials).
//
// Design: match KNOWN credential shapes only. We deliberately do NOT do blind
// high-entropy matching — Nous memories/transcripts are full of legitimate
// git SHAs, content hashes, and long paths, and nuking those would wreck recall.
// Users can add project-specific patterns via config `capture.redactExtra`.
//
// Each hit becomes `[REDACTED:<type>:<hash8>]`. The hash is a stable salted
// digest of the secret, so identical secrets collapse to the same marker (dedup
// + matchability) without storing the plaintext.

const SALT = "nous:redact:v1";

function fingerprint(secret: string): string {
  return createHash("sha256").update(SALT).update(secret).digest("hex").slice(0, 8);
}

interface Pattern {
  type: string;
  re: RegExp;
  // Which capture group holds the secret to fingerprint/replace. 0 = whole match.
  // When `keep` is set, only the group is replaced and surrounding text kept.
  group?: number;
}

// NOTE: order matters — multiline PEM first, then specific token shapes, then
// generic assignments/URLs. All are global; `re.lastIndex` is reset per use.
const PATTERNS: Pattern[] = [
  {
    type: "private-key",
    re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
  },
  { type: "aws-akid", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: "gh-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { type: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/g },
  { type: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g },
  { type: "google-key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { type: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  {
    type: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  { type: "bearer", re: /\bBearer\s+[A-Za-z0-9._\-]{20,}/g },
  // user:pass@host connection strings — redact the password group only
  { type: "conn-pass", re: /(\b[a-z][a-z0-9+.-]*:\/\/[^:@\s/]+:)([^@\s/]{3,})(@)/gi, group: 2 },
  // key = value / key: value assignments — redact the value group only
  {
    type: "assignment",
    re: /\b(passwd|password|pwd|secret|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|token|client[_-]?secret)\b\s*[:=]\s*['"]?([^\s'"]{6,})['"]?/gi,
    group: 2,
  },
];

export interface RedactResult {
  text: string;
  count: number;
}

function applyPattern(text: string, p: Pattern): { text: string; hits: number } {
  let hits = 0;
  p.re.lastIndex = 0;
  const out = text.replace(p.re, (...args) => {
    // args: match, ...groups, offset, string
    const match = args[0] as string;
    if (p.group && typeof args[p.group] === "string") {
      const secret = args[p.group] as string;
      hits++;
      // rebuild: everything in `match` with the secret group swapped
      return match.replace(secret, `[REDACTED:${p.type}:${fingerprint(secret)}]`);
    }
    hits++;
    return `[REDACTED:${p.type}:${fingerprint(match)}]`;
  });
  return { text: out, hits };
}

// Compile user-supplied extra patterns once; ignore any that don't compile.
export function compileExtra(extra: string[] | undefined): Pattern[] {
  if (!extra || extra.length === 0) return [];
  const out: Pattern[] = [];
  for (const src of extra) {
    try {
      out.push({ type: "custom", re: new RegExp(src, "g") });
    } catch {
      /* skip invalid user regex */
    }
  }
  return out;
}

// Strip credentials from `text`. Returns the redacted text and a hit count.
export function redact(text: string, extra?: string[]): RedactResult {
  if (!text) return { text: text ?? "", count: 0 };
  let out = text;
  let count = 0;
  for (const p of [...PATTERNS, ...compileExtra(extra)]) {
    const r = applyPattern(out, p);
    out = r.text;
    count += r.hits;
  }
  return { text: out, count };
}

export const REDACT_TYPES = PATTERNS.map((p) => p.type);
