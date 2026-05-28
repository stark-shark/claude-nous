#!/usr/bin/env node
// SessionStart hook for Recall plugin.
// Reads skills/recall/SKILL.md and emits the SessionStart JSON payload so Claude
// receives the recall skill content at session start. Cross-platform (Node-only,
// no shell dependency).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(SCRIPT_DIR, "..");
const SKILL_PATH = resolve(PLUGIN_ROOT, "skills", "recall", "SKILL.md");

let skillContent;
try {
  skillContent = readFileSync(SKILL_PATH, "utf8");
} catch (err) {
  skillContent = `Error reading recall skill at ${SKILL_PATH}: ${err.message}`;
}

const additionalContext =
  "<RECALL_PLUGIN>\n" +
  "You have the Recall memory system installed.\n\n" +
  "**Below is the full content of your 'recall' skill. You MUST follow these rules for ALL memory operations — loading, saving, searching, checking. Invoke this skill before any recall_* tool use.**\n\n" +
  skillContent +
  "\n\n" +
  "**IMPORTANT:** When the user asks about any topic that could have a memory, use recall_search/recall_load — do NOT use manual file Read or Explore agents to find memory content.\n" +
  "</RECALL_PLUGIN>";

const insidePlugin = !!process.env.CLAUDE_PLUGIN_ROOT && !process.env.COPILOT_CLI;
const payload = insidePlugin
  ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }
  : { additionalContext };

process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
