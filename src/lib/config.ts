import * as fs from "node:fs";

export interface RecallConfig {
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
    everyNTurns: number;
    approvalGate: boolean; // require user OK before the review writes memory
  };
  // The canonical Hermes-style USER.md — always injected at session start, capped.
  // Scoped to the USER (global), not to a project.
  userMemory: {
    filename: string;  // reserved file the usr-type "user" memory writes to
    alwaysLoad: boolean;
    // Absolute dir the user file lives in. Set at runtime to the global dir
    // (~/.claude/recall/memory) so the profile is shared across all projects.
    // When unset, the user file lives in the current project's memory dir
    // (legacy / test behavior).
    dir?: string;
  };
}

export const DEFAULT_CONFIG: RecallConfig = {
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
  },
  userMemory: {
    filename: "user.md",
    alwaysLoad: true,
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

export function loadConfig(configPath: string): RecallConfig {
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  let userConfig: Partial<RecallConfig>;
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
  };
}
