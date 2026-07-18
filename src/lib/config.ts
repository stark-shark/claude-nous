import * as fs from "node:fs";

export interface NousConfig {
  maintainIndex: boolean;
  indexFile: string;
  indexMaxLines: number;
  registryFile: string;
  notationEnforcement: "strict" | "warn" | "off";
  headerFields: {
    dates: boolean;
    accessCount: boolean;
    links: boolean;
  };
  healthChecks: {
    staleDays: number;
    staleMinAccess: number;
    compressionTolerancePct: number;
  };
  // Hermes-style hard caps on the notation body, in characters. 0 = unlimited.
  // A save over the cap returns a consolidate-or-remove error instead of writing.
  // Because the body is already Nous notation, a cap holds far more knowledge
  // than the same cap of raw prose.
  caps: {
    fb: number;
    proj: number;
    ref: number;
    usr: number;
    user: number; // the canonical always-loaded user.md profile
  };
  // Prompt-injection defenses. Memories are injected into the system prompt, so
  // every memory is an injection surface — more so once the scan auto-writes them.
  security: {
    scanOnWrite: boolean;   // scan content before save
    scanOnLoad: boolean;    // fence + scan content on load
    rejectInvisible: boolean; // hard-reject invisible/control unicode on write
  };
  // Auto-apply low-risk curation scan (lifecycle transitions). Runs on SessionStart.
  scan: {
    enabled: boolean;
    autoArchiveStale: boolean; // active->stale->archived transitions written automatically
    archiveAfterStaleDays: number; // extra days past stale before archiving
  };
  // Active mid-session review (Hermes' "nudge"): every N user turns, prompt the
  // agent to delegate a memory review to nous-worker (Haiku).
  review: {
    enabled: boolean;
    everyNTurns: number;   // interval for the memory-save review
    approvalGate: boolean; // require user OK before the review writes memory
    // "background" = post-turn detached Haiku review that stages proposals;
    // "nudge" = legacy in-context prompt; "off" = disabled.
    mode: "background" | "nudge" | "off";
  };
  // The canonical Hermes-style USER.md — always injected at session start, capped.
  // Scoped to the USER (global), not to a project.
  userMemory: {
    filename: string;  // reserved file the usr-type "user" memory writes to
    alwaysLoad: boolean;
    // Absolute dir the user file lives in. Set at runtime to the global dir
    // (~/.claude/nous/memory) so the profile is shared across all projects.
    // When unset, the user file lives in the current project's memory dir
    // (legacy / test behavior).
    dir?: string;
  };
  // v1 cold-tier capture: index every session into SQLite; summarize via headless
  // Haiku. `summarize`: "auto" = SessionEnd spawns the summarizer; "nudge" = defer
  // to a next-session delegation; "off" = manual only.
  capture: {
    enabled: boolean;
    summarize: "auto" | "nudge" | "off";
    minTurns: number;          // skip summarizing trivially short sessions
    haikuModel: string;
    maxTranscriptChars: number; // whole-transcript cap for the summarizer input
    perTurnCap: number;         // a single turn longer than this is truncated first
    redact: boolean;            // strip secrets/PII before FTS + injection
    redactExtra: string[];      // user regex additions
  };
  // Pre-turn recall injection: on every user prompt, LLM-free FTS+RRF over past
  // sessions injects up to maxSessions one-line reminders as context. The push
  // half of the recall ladder — without it, recall only happens when the model
  // thinks to search.
  preturn: {
    enabled: boolean;
    maxSessions: number;    // max one-line session reminders injected
    minPromptChars: number; // skip trivial prompts ("yes", "continue")
    // When the strict all-terms match finds nothing, retry with OR (any term).
    // Set false if the "loose match" reminders feel noisy — strict-only mode
    // trades recall for precision.
    looseFallback: boolean;
  };
  // Recall ladder tuning.
  ladder: {
    expandWindow: number;   // ± messages around a hit in anchored view
    bookend: number;        // first/last N messages shown as goal/resolution
    maxHits: number;
    rrfK: number;           // reciprocal-rank-fusion constant
    escalateBelow: number;  // top-hit confidence below which Haiku expansion helps
  };
  // Daily digest files (days/YYYY-MM-DD.md), today+yesterday injected.
  daily: { enabled: boolean; injectDays: number; cap: number };
  // Self-building save-rules (RULES.md).
  rules: { enabled: boolean; approvalGate: boolean; maxBackups: number };
  // Agent-authored procedural skills.
  skills: { enabled: boolean; approvalGate: boolean; dir: string; maxBackups: number };
  // DB retention/maintenance. Session-prune OFF by default (total-recall goal).
  retention: {
    vacuum: boolean;
    vacuumMinIntervalHours: number;
    pruneSessions: boolean;
    pruneDays: number;
  };
}

// Pre-v1 name (plugin was Recall through v1.0) — kept as a compat alias.
export type RecallConfig = NousConfig;

export const DEFAULT_CONFIG: NousConfig = {
  maintainIndex: true,
  indexFile: "MEMORY.md",
  indexMaxLines: 200,
  registryFile: "REGISTRY.md",
  notationEnforcement: "warn",
  headerFields: {
    dates: true,
    accessCount: true,
    links: true,
  },
  healthChecks: {
    staleDays: 30,
    staleMinAccess: 2,
    compressionTolerancePct: 10,
  },
  caps: {
    fb: 1200,
    proj: 2200,
    ref: 2200,
    usr: 1375,
    user: 1375,
  },
  security: {
    scanOnWrite: true,
    scanOnLoad: true,
    rejectInvisible: true,
  },
  scan: {
    enabled: true,
    autoArchiveStale: true,
    archiveAfterStaleDays: 30,
  },
  review: {
    enabled: true,
    everyNTurns: 10,
    approvalGate: true,
    mode: "background",
  },
  userMemory: {
    filename: "user.md",
    alwaysLoad: true,
  },
  capture: {
    enabled: true,
    summarize: "auto",
    minTurns: 3,
    haikuModel: "claude-haiku-4-5",
    maxTranscriptChars: 60000,
    perTurnCap: 3000,
    redact: true,
    redactExtra: [],
  },
  preturn: {
    enabled: true,
    maxSessions: 3,
    minPromptChars: 12,
    looseFallback: true,
  },
  ladder: {
    expandWindow: 5,
    bookend: 3,
    maxHits: 20,
    rrfK: 60,
    escalateBelow: 0.15,
  },
  daily: { enabled: true, injectDays: 2, cap: 2000 },
  rules: { enabled: true, approvalGate: true, maxBackups: 20 },
  skills: {
    enabled: true,
    approvalGate: true,
    dir: "~/.claude/skills",
    maxBackups: 20,
  },
  retention: {
    vacuum: true,
    vacuumMinIntervalHours: 24,
    pruneSessions: false,
    pruneDays: 180,
  },
};

function stripJsoncComments(text: string): string {
  // Strip a UTF-8 BOM first — Windows editors and PowerShell 5.1's
  // `-Encoding utf8` write one, and JSON.parse rejects it. A BOM here
  // silently reverted the whole config to defaults.
  return text
    .replace(new RegExp("^\\uFEFF"), "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

export function loadConfig(configPath: string): NousConfig {
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  let userConfig: Partial<NousConfig>;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const stripped = stripJsoncComments(raw);
    userConfig = JSON.parse(stripped);
  } catch (err) {
    console.error(
      `[nous] Failed to parse config at ${configPath}: ${(err as Error).message}. Using defaults.`
    );
    return { ...DEFAULT_CONFIG };
  }

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    headerFields: {
      ...DEFAULT_CONFIG.headerFields,
      ...(userConfig.headerFields ?? {}),
    },
    healthChecks: {
      ...DEFAULT_CONFIG.healthChecks,
      ...(userConfig.healthChecks ?? {}),
    },
    caps: {
      ...DEFAULT_CONFIG.caps,
      ...(userConfig.caps ?? {}),
    },
    security: {
      ...DEFAULT_CONFIG.security,
      ...(userConfig.security ?? {}),
    },
    scan: {
      ...DEFAULT_CONFIG.scan,
      ...(userConfig.scan ?? {}),
    },
    review: {
      ...DEFAULT_CONFIG.review,
      ...(userConfig.review ?? {}),
    },
    userMemory: {
      ...DEFAULT_CONFIG.userMemory,
      ...(userConfig.userMemory ?? {}),
    },
    capture: {
      ...DEFAULT_CONFIG.capture,
      ...(userConfig.capture ?? {}),
    },
    preturn: {
      ...DEFAULT_CONFIG.preturn,
      ...(userConfig.preturn ?? {}),
    },
    ladder: {
      ...DEFAULT_CONFIG.ladder,
      ...(userConfig.ladder ?? {}),
    },
    daily: {
      ...DEFAULT_CONFIG.daily,
      ...(userConfig.daily ?? {}),
    },
    rules: {
      ...DEFAULT_CONFIG.rules,
      ...(userConfig.rules ?? {}),
    },
    skills: {
      ...DEFAULT_CONFIG.skills,
      ...(userConfig.skills ?? {}),
    },
    retention: {
      ...DEFAULT_CONFIG.retention,
      ...(userConfig.retention ?? {}),
    },
  };
}
