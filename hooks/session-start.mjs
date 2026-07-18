#!/usr/bin/env node
// SessionStart hook for Nous plugin.
//
// Emits the SessionStart additionalContext payload, composed of:
//   1. the nous SKILL.md (governs all nous_* tool use) — read locally
//   2. everything else via ONE `--boot` CLI spawn: recall->nous migration
//      (runs at CLI load), RULES.md seeding, the always-loaded user.md profile
//      (fenced, gated by userMemory.alwaysLoad), daily digest + save rules +
//      pending proposals, and the curation scan report.
// Cross-platform (Node-only, no shell dependency). Previously this hook spawned
// 4-5 node processes; it now spawns exactly one.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(SCRIPT_DIR, "..");
const SKILL_PATH = resolve(PLUGIN_ROOT, "skills", "nous", "SKILL.md");
const DIST = resolve(PLUGIN_ROOT, "dist", "index.js");

// --- 1. skill ---------------------------------------------------------------
let skillContent;
try {
  skillContent = readFileSync(SKILL_PATH, "utf8");
} catch (err) {
  skillContent = `Error reading nous skill at ${SKILL_PATH}: ${err.message}`;
}

// --- resolve current project dir (drives the scan's project scoping) --------
let cwd = process.cwd();
try {
  const raw = readFileSync(0, "utf8"); // hook event JSON on stdin
  if (raw && raw.trim()) {
    const evt = JSON.parse(raw);
    if (evt && typeof evt.cwd === "string" && evt.cwd) cwd = evt.cwd;
  }
} catch {
  // no stdin / not JSON — fall back to process.cwd()
}
if (process.env.CLAUDE_PROJECT_DIR) cwd = process.env.CLAUDE_PROJECT_DIR;

// --- 2. everything dynamic, in one spawn -------------------------------------
let bootBlock = "";
try {
  const out = execFileSync(process.execPath, [DIST, "--boot"], {
    encoding: "utf8",
    timeout: 15000,
    cwd,
  });
  const trimmed = (out || "").trim();
  if (trimmed) bootBlock = "\n\n" + trimmed;
} catch {
  // boot failure must never break the session
}

const additionalContext =
  "<NOUS_PLUGIN>\n" +
  "You have the Nous memory system installed.\n\n" +
  "**Below is the full content of your 'nous' skill. You MUST follow these rules for ALL memory operations — loading, saving, searching, checking. Invoke this skill before any nous_* tool use.**\n\n" +
  skillContent +
  "\n\n" +
  "**IMPORTANT:** When the user asks about any topic that could have a memory, use nous_search/nous_load — do NOT use manual file Read or Explore agents to find memory content." +
  bootBlock +
  "\n</NOUS_PLUGIN>";

const insidePlugin = !!process.env.CLAUDE_PLUGIN_ROOT && !process.env.COPILOT_CLI;
const payload = insidePlugin
  ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }
  : { additionalContext };

process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
