#!/usr/bin/env node
// Detached background-review worker (spawned by the Stop hook on interval).
// Reads the recent transcript + save-rules, asks headless Haiku for durable
// memory proposals as JSON, and STAGES them to the pending queue (never writes
// memory directly — the approval gate is preserved; SessionStart surfaces them).
// Fully best-effort: if the claude CLI is unavailable, it silently does nothing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig, runClaude, runNous } from "./lib.mjs";

const transcript = process.argv[2];
if (!transcript) process.exit(0);

const cfg = loadConfig();

// Recent transcript tail (bounded).
let tail = "";
try {
  const lines = readFileSync(transcript, "utf8").split("\n").filter(Boolean);
  const recent = lines.slice(-40);
  const parts = [];
  for (const l of recent) {
    try {
      const o = JSON.parse(l);
      if (o.type !== "user" && o.type !== "assistant") continue;
      const c = o.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b?.text || "").join(" ") : "";
      if (text) parts.push(`${o.type}: ${text.slice(0, 1200)}`);
    } catch {
      /* skip */
    }
  }
  tail = parts.join("\n\n").slice(-12000);
} catch {
  process.exit(0);
}
if (!tail) process.exit(0);

let rules = "";
try {
  rules = readFileSync(join(homedir(), ".claude", "nous", "RULES.md"), "utf8");
} catch {
  /* no rules */
}

const prompt =
  "You review a stretch of a Claude Code session and propose durable memories to save, following the save rules.\n" +
  "Reply with ONLY a JSON array (no prose, no fence). Each item:\n" +
  '{"kind":"memory","note":"<one-line diff e.g. + proj \'x\' : ...>","payload":"<memory body in compressed notation>"}\n' +
  "Propose at most 3. If nothing durable emerged, reply []. Never invent facts.\n\n" +
  (rules ? `SAVE RULES:\n${rules}\n\n` : "") +
  `RECENT TRANSCRIPT:\n${tail}`;

const out = runClaude(prompt, cfg.capture.haikuModel);
if (!out) process.exit(0);

// Pipe the model's JSON to the staging CLI (writes to the pending queue).
runNous(["--stage-proposals"], out, process.cwd(), 8000);
process.exit(0);
