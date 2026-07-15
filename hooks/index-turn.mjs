#!/usr/bin/env node
// Stop hook — cheap, LLM-free incremental index of the current session, plus
// (on interval) firing a detached background memory review. Must never block or
// break the turn.

import { spawn } from "node:child_process";
import { readEvent, resolveCwd, loadConfig, runNous, SCRIPT_DIR } from "./lib.mjs";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const evt = readEvent();
const cwd = resolveCwd(evt);
const cfg = loadConfig();

if (cfg.capture.enabled === false) process.exit(0);

const transcript = typeof evt.transcript_path === "string" ? evt.transcript_path : "";
if (!transcript) process.exit(0);

// 1. Index the just-finished turn (LLM-free).
runNous(["--index-file", transcript], undefined, cwd, 10000);

// 2. Background review on interval (Hermes-style post-turn review). Durable turn
// count derived from the transcript itself (survives agent rebuilds — Hermes
// #22357), so we don't rely on a fragile in-memory counter.
if (cfg.review.mode === "background" && cfg.review.enabled !== false) {
  let userTurns = 0;
  try {
    for (const line of readFileSync(transcript, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        if (JSON.parse(line).type === "user") userTurns++;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no transcript */
  }
  const interval = cfg.review.everyNTurns > 0 ? cfg.review.everyNTurns : 10;
  if (userTurns > 0 && userTurns % interval === 0) {
    try {
      const child = spawn(
        process.execPath,
        [join(SCRIPT_DIR, "review-run.mjs"), transcript],
        { detached: true, stdio: "ignore", cwd }
      );
      child.unref();
    } catch {
      /* fire-and-forget */
    }
  }
}

process.exit(0);
