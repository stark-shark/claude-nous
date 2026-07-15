#!/usr/bin/env node
// UserPromptSubmit hook for Nous — the active mid-session review ("nudge").
//
// Hermes runs a background review every ~N turns that proposes memory updates
// during the session. A Claude Code plugin can't make an async background LLM
// call, but it CAN fire the review at a cadence: this hook counts user turns
// per project and, every `review.everyNTurns`, injects a review nudge so the
// agent delegates a memory review to the nous-worker (Haiku) subagent.
//
// Non-blocking: it rides the user's existing turn and never forces extra work.
// Approval-gated by default (the worker proposes; the user OKs before writing).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULTS = { enabled: true, everyNTurns: 10, approvalGate: true, mode: "background" };

function loadReviewConfig() {
  try {
    const raw = readFileSync(join(homedir(), ".claude", "nous", "nous.config.jsonc"), "utf8");
    const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const cfg = JSON.parse(stripped);
    return { ...DEFAULTS, ...(cfg.review ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function projectPathToHash(p) {
  return p.replace(/:/g, "-").replace(/[\\/]/g, "-");
}

function emit(additionalContext) {
  const inside = !!process.env.CLAUDE_PLUGIN_ROOT && !process.env.COPILOT_CLI;
  const payload = additionalContext
    ? inside
      ? { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }
      : { additionalContext }
    : {};
  process.stdout.write(JSON.stringify(payload) + "\n");
}

const review = loadReviewConfig();
// In v1 the default review runs post-turn in the background (Stop hook). The
// in-context nudge only fires when explicitly configured mode:"nudge".
if (!review.enabled || review.mode !== "nudge" || !(review.everyNTurns > 0)) {
  emit("");
  process.exit(0);
}

// resolve project + read event
let cwd = process.cwd();
try {
  const raw = readFileSync(0, "utf8");
  if (raw && raw.trim()) {
    const evt = JSON.parse(raw);
    if (evt && typeof evt.cwd === "string" && evt.cwd) cwd = evt.cwd;
  }
} catch {
  /* no stdin */
}
if (process.env.CLAUDE_PROJECT_DIR) cwd = process.env.CLAUDE_PROJECT_DIR;

const stateDir = join(homedir(), ".claude", "nous", "state");
const statePath = join(stateDir, projectPathToHash(cwd) + ".json");

let turns = 0;
try {
  turns = JSON.parse(readFileSync(statePath, "utf8")).turns ?? 0;
} catch {
  /* first turn */
}
turns += 1;

let nudge = "";
if (turns >= review.everyNTurns) {
  turns = 0; // reset window
  const writeRule = review.approvalGate
    ? "Show the proposed memory as a one-line diff and ask the user to confirm before saving."
    : "Save it directly with nous_save.";
  nudge =
    "<NOUS_REVIEW>\n" +
    `${review.everyNTurns} turns since the last memory review. AFTER you finish addressing the user's current request, do a brief self-review: did anything worth remembering emerge — a decision, a fix that took more than one try, a new durable fact about the user or project, or a correction the user gave you?\n` +
    `If yes, delegate to the nous-worker subagent (Haiku) to draft it in Nous notation, then ${writeRule}\n` +
    "If nothing notable emerged, do nothing — never save trivia, and don't mention this review unless you actually save something.\n" +
    "</NOUS_REVIEW>";
}

try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify({ turns }) + "\n", "utf8");
} catch {
  /* best effort — never break the prompt */
}

emit(nudge);
