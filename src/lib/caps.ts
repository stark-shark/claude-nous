import type { NousConfig } from "./config.js";
import type { MemoryType } from "./symbols.js";

// Hermes-style bounded memory: hard caps on the notation body force the model to
// consolidate instead of endlessly appending. Because the body is already Nous
// notation, a cap holds far more knowledge than the same cap of raw prose.

/**
 * Resolve the character cap for a memory. The canonical user.md profile gets its
 * own (tighter) cap; everything else is capped by type. 0 means unlimited.
 */
export function capFor(
  type: MemoryType,
  filename: string,
  config: NousConfig
): number {
  if (filename === config.userMemory.filename) return config.caps.user;
  return config.caps[type] ?? 0;
}

export interface CapUsage {
  used: number;
  cap: number;
  pct: number;
  over: number; // chars over the cap; <= 0 means within budget
  unlimited: boolean;
}

export function measureCap(bodyLength: number, cap: number): CapUsage {
  if (cap <= 0) {
    return { used: bodyLength, cap: 0, pct: 0, over: 0, unlimited: true };
  }
  return {
    used: bodyLength,
    cap,
    pct: Math.round((bodyLength / cap) * 100),
    over: bodyLength - cap,
    unlimited: false,
  };
}

/** One-line usage header, e.g. "MEMORY[proj] 67% — 1474/2200" or "USER 80% — 1100/1375". */
export function usageLine(
  type: MemoryType,
  filename: string,
  usage: CapUsage,
  config: NousConfig
): string {
  if (usage.unlimited) return "";
  const label =
    filename === config.userMemory.filename ? "USER" : `MEMORY[${type}]`;
  return `${label} ${usage.pct}% — ${usage.used}/${usage.cap}`;
}

/** Hermes-shaped overflow error: tells the model to consolidate THIS turn. */
export function overflowError(
  name: string,
  type: MemoryType,
  usage: CapUsage,
  existingBody: string | null
): string {
  const lines = [
    `Cap exceeded: '${name}' (${type}) at ${usage.used}/${usage.cap} chars — over by ${usage.over}.`,
    `Nous caps force consolidation. In THIS turn, do one of:`,
    `  • tighten the notation (drop articles/filler, use $shortcodes and operators -> :: >> @)`,
    `  • split a distinct sub-topic into a separate linked memory`,
    `  • remove stale or superseded lines`,
    `then retry nous_save. Nothing was written.`,
  ];
  if (existingBody !== null) {
    lines.push("", "Current saved body (consolidate against this):", "---", existingBody, "---");
  }
  return lines.join("\n");
}
