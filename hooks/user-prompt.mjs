#!/usr/bin/env node
// UserPromptSubmit hook for Nous — two jobs, one spawn budget:
//
// 1. PRE-TURN RECALL (default on): the user's prompt is piped to `--preturn`,
//    which runs LLM-free FTS+RRF over past sessions and returns up to
//    preturn.maxSessions one-line reminders. Injected as context, this converts
//    episodic recall from "remembers if it thinks to search" into "reminded by
//    default" — the push half of the recall ladder. Milliseconds, zero tokens.
//
// 2. LEGACY REVIEW NUDGE (review.mode:"nudge" only): every everyNTurns, inject
//    a self-review prompt. The default mode is "background" (Stop hook), where
//    this path stays dormant.
//
// Non-blocking spirit: every failure emits an empty payload and exits 0.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readEvent, resolveCwd, loadConfig, runNous } from "./lib.mjs";

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

const evt = readEvent();
const cwd = resolveCwd(evt);
const cfg = loadConfig();
const blocks = [];

// --- 1. pre-turn recall -------------------------------------------------------
const prompt = typeof evt.prompt === "string" ? evt.prompt : "";
const sessionId = typeof evt.session_id === "string" ? evt.session_id : "";
if (
  cfg.preturn.enabled !== false &&
  prompt.length >= (cfg.preturn.minPromptChars ?? 12) &&
  !prompt.startsWith("/") // slash commands carry their own instructions
) {
  const out = runNous(["--preturn", sessionId], prompt, cwd, 6000);
  const trimmed = (out || "").trim();
  if (trimmed) blocks.push(trimmed);
}

// --- 2. legacy in-context review nudge (mode:"nudge" only) --------------------
const review = cfg.review;
if (review.enabled !== false && review.mode === "nudge" && review.everyNTurns > 0) {
  const stateDir = join(homedir(), ".claude", "nous", "state");
  const statePath = join(stateDir, projectPathToHash(cwd) + ".json");

  let turns = 0;
  try {
    turns = JSON.parse(readFileSync(statePath, "utf8")).turns ?? 0;
  } catch {
    /* first turn */
  }
  turns += 1;

  if (turns >= review.everyNTurns) {
    turns = 0; // reset window
    const writeRule = review.approvalGate
      ? "Show the proposed memory as a one-line diff and ask the user to confirm before saving."
      : "Save it directly with nous_save.";
    blocks.push(
      "<NOUS_REVIEW>\n" +
        `${review.everyNTurns} turns since the last memory review. AFTER you finish addressing the user's current request, do a brief self-review: did anything worth remembering emerge — a decision, a fix that took more than one try, a new durable fact about the user or project, or a correction the user gave you?\n` +
        `If yes, delegate to the nous-worker subagent (Haiku) to draft it in Nous notation, then ${writeRule}\n` +
        "If nothing notable emerged, do nothing — never save trivia, and don't mention this review unless you actually save something.\n" +
        "</NOUS_REVIEW>"
    );
  }

  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify({ turns }) + "\n", "utf8");
  } catch {
    /* best effort — never break the prompt */
  }
}

emit(blocks.join("\n\n"));
