// Shared helpers for Nous hooks. Node-only, no deps. Everything here is
// best-effort: a hook must never throw in a way that breaks the user's turn.

import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = resolve(SCRIPT_DIR, "..");
export const DIST = resolve(PLUGIN_ROOT, "dist", "index.js");

export function readEvent() {
  try {
    const raw = readFileSync(0, "utf8");
    if (raw && raw.trim()) return JSON.parse(raw);
  } catch {
    /* no stdin / not JSON */
  }
  return {};
}

export function resolveCwd(evt) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  if (evt && typeof evt.cwd === "string" && evt.cwd) return evt.cwd;
  return process.cwd();
}

export function loadConfig() {
  const DEFAULTS = {
    capture: { enabled: true, summarize: "auto", minTurns: 3, haikuModel: "claude-haiku-4-5" },
    review: { enabled: true, everyNTurns: 10, mode: "background", approvalGate: true },
    preturn: { enabled: true, maxSessions: 3, minPromptChars: 12 },
  };
  try {
    const raw = readFileSync(join(homedir(), ".claude", "nous", "nous.config.jsonc"), "utf8");
    const stripped = raw.replace(/^﻿/, "").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const cfg = JSON.parse(stripped);
    return {
      capture: { ...DEFAULTS.capture, ...(cfg.capture ?? {}) },
      review: { ...DEFAULTS.review, ...(cfg.review ?? {}) },
      preturn: { ...DEFAULTS.preturn, ...(cfg.preturn ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

// Run `node dist/index.js <args>`, optionally piping `input` to stdin. Returns
// stdout string, or null on failure. Never throws.
export function runNous(args, input, cwd, timeout = 15000) {
  // NOTE: only set `input` when we actually have some — passing
  // `input: undefined` explicitly makes execFileSync throw once the parent's
  // stdin has been consumed (as it has, by readEvent). Omit the key instead.
  const base = { encoding: "utf8", timeout };
  if (input != null) base.input = input;
  try {
    return execFileSync(process.execPath, [DIST, ...args], cwd ? { ...base, cwd } : base);
  } catch {
    // A bad cwd (e.g. a non-Windows path on win32) makes execFileSync throw;
    // capture CLI ops use absolute/home paths and don't need cwd, so retry.
    if (cwd) {
      try {
        return execFileSync(process.execPath, [DIST, ...args], base);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Run headless Claude (`claude -p --model <model>`) with a prompt on stdin.
// Returns stdout, or null if the CLI is missing / errors / times out.
export function runClaude(prompt, model, timeout = 120000) {
  const tryCmd = (cmd) => {
    try {
      const r = spawnSync(cmd, ["-p", "--model", model, "--allowedTools", ""], {
        input: prompt,
        encoding: "utf8",
        timeout,
        windowsHide: true,
      });
      if (r.status === 0 && r.stdout) return r.stdout;
    } catch {
      /* try next */
    }
    return null;
  };
  // `claude` on PATH; on Windows the launcher may be claude.cmd (spawnSync with
  // shell handles that), fall back to a shell invocation.
  return tryCmd("claude") ?? runClaudeShell(prompt, model, timeout);
}

function runClaudeShell(prompt, model, timeout) {
  try {
    const r = spawnSync("claude", ["-p", "--model", model, "--allowedTools", ""], {
      input: prompt,
      encoding: "utf8",
      timeout,
      shell: true,
      windowsHide: true,
    });
    if (r.status === 0 && r.stdout) return r.stdout;
  } catch {
    /* give up */
  }
  return null;
}
