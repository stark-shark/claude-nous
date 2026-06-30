// Prompt-injection / exfiltration scanning for memory content.
//
// Recall memories are injected into the system prompt (via MEMORY.md, the
// always-loaded user.md, and recall_load returns), so every memory is an
// injection surface — and the auto-scan will eventually write memory derived
// from transcript/tool content, which is the real attack vector.
//
// Design constraint: this user writes legitimate security/ITDR memories that
// mention "system prompt", "curl", "exfiltrate", etc. Phrase-matching those
// would false-positive constantly. So we split severity:
//   HARD (reject on write): invisible / control / bidi unicode — never
//     legitimate in a compressed memory, a classic obfuscation vector.
//   SOFT (warn only): role-impersonation delimiters and imperative-override
//     phrasing — suspicious but sometimes legitimate in security notes.
//
// Invisible/control detection is done by numeric code point (not regex
// literals) so the source file itself stays free of invisible characters.

export type ThreatSeverity = "hard" | "soft";

export interface Threat {
  severity: ThreatSeverity;
  label: string;
  detail: string;
}

export interface ScanResult {
  threats: Threat[];
  hasHard: boolean;
}

// True for code points that are invisible/format/control and never belong in a
// compressed memory body. Allows tab(9), newline(10), CR(13).
function isSuspectCodePoint(c: number): boolean {
  // C0 controls except tab/newline/CR
  if (c <= 0x08) return true;
  if (c === 0x0b || c === 0x0c) return true;
  if (c >= 0x0e && c <= 0x1f) return true;
  // DEL + C1 controls
  if (c >= 0x7f && c <= 0x9f) return true;
  // soft hyphen
  if (c === 0xad) return true;
  // zero-width space / ZWNJ / ZWJ / LRM / RLM and bidi marks
  if (c >= 0x200b && c <= 0x200f) return true;
  // bidi embedding/override/isolate controls
  if (c >= 0x202a && c <= 0x202e) return true;
  // word joiner, invisible math operators, etc.
  if (c >= 0x2060 && c <= 0x2064) return true;
  // bidi isolates
  if (c >= 0x2066 && c <= 0x206f) return true;
  // BOM / zero-width no-break space
  if (c === 0xfeff) return true;
  // interlinear annotation anchors
  if (c >= 0xfff9 && c <= 0xfffb) return true;
  return false;
}

// Role-impersonation: a memory trying to look like system/assistant framing.
const ROLE_IMPERSONATION: { re: RegExp; label: string }[] = [
  { re: /<\/?(system|assistant|user)>/i, label: "role tag" },
  { re: /\b(BEGIN|END)\s+SYSTEM\b/i, label: "system delimiter" },
  { re: /\[\/?(INST|SYSTEM)\]/i, label: "instruction delimiter" },
  { re: /^\s*(system|assistant)\s*:/im, label: "role prefix line" },
];

// Imperative overrides — the canonical "ignore previous instructions" family.
const OVERRIDE_RE =
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(instruction|prompt|rule|context|memor)/i;

function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m ? m[0] : null;
}

export function scanContent(text: string): ScanResult {
  const threats: Threat[] = [];

  let invisible = false;
  for (const ch of text) {
    if (isSuspectCodePoint(ch.codePointAt(0) as number)) {
      invisible = true;
      break;
    }
  }
  if (invisible) {
    threats.push({
      severity: "hard",
      label: "invisible-unicode",
      detail:
        "Invisible / control / bidi unicode detected (obfuscation vector). Strip it and retry.",
    });
  }

  for (const { re, label } of ROLE_IMPERSONATION) {
    const hit = firstMatch(text, re);
    if (hit) {
      threats.push({
        severity: "soft",
        label: "role-impersonation",
        detail: `Possible role-impersonation (${label}): "${hit.trim().slice(0, 60)}"`,
      });
      break;
    }
  }

  const override = firstMatch(text, OVERRIDE_RE);
  if (override) {
    threats.push({
      severity: "soft",
      label: "instruction-override",
      detail: `Possible instruction-override phrasing: "${override.trim().slice(0, 60)}"`,
    });
  }

  return { threats, hasHard: threats.some((t) => t.severity === "hard") };
}

/** Strip invisible/control characters so a sanitized retry can succeed. */
export function stripInvisible(text: string): string {
  let out = "";
  for (const ch of text) {
    if (!isSuspectCodePoint(ch.codePointAt(0) as number)) out += ch;
  }
  return out;
}

/**
 * Delimiter-fence content for safe injection (Hermes' "Brainworm" defense): a
 * fenced memory cannot impersonate the agent's own system/tool framing.
 */
export function fence(label: string, body: string): string {
  return `<<RECALL ${label}>>\n${body}\n<<END RECALL>>`;
}
