#!/usr/bin/env node
// SessionEnd hook — final index of the session, then (capture.summarize=="auto")
// summarize it with headless Haiku and write the result to the DB + daily digest.
// Best-effort and non-blocking-ish: on any failure it writes a placeholder so the
// session isn't stuck "unsummarized" forever.

import { readEvent, resolveCwd, loadConfig, runNous, runClaude } from "./lib.mjs";

const evt = readEvent();
const cwd = resolveCwd(evt);
const cfg = loadConfig();

if (cfg.capture.enabled === false) process.exit(0);

const transcript = typeof evt.transcript_path === "string" ? evt.transcript_path : "";
const sessionId =
  typeof evt.session_id === "string" && evt.session_id
    ? evt.session_id
    : transcript
      ? transcript.split(/[\\/]/).pop().replace(/\.jsonl$/, "")
      : "";

// 1. Final incremental index, then interval-gated DB maintenance (VACUUM /
// optional prune). Both cheap no-ops when nothing to do.
if (transcript) runNous(["--index-file", transcript], undefined, cwd, 10000);
runNous(["--retention"], undefined, cwd, 60000);
if (!sessionId || cfg.capture.summarize !== "auto") process.exit(0);

// 2. Only summarize sessions with enough substance.
const pendingRaw = runNous(["--pending"], undefined, cwd, 8000);
let pending = [];
try {
  pending = JSON.parse(pendingRaw || "[]");
} catch {
  pending = [];
}
if (!pending.includes(sessionId)) process.exit(0); // too short / already done

// 3. Build the summarizer prompt from the DB, run Haiku, write result back.
const prompt = runNous(["--summarize-prompt", sessionId], undefined, cwd, 8000);
if (!prompt) process.exit(0);

const out = runClaude(prompt, cfg.capture.haikuModel);
if (out) {
  runNous(["--summarize", sessionId], out, cwd, 8000);
} else {
  // CLI unavailable / failed — mark a placeholder so it isn't stuck pending.
  runNous(["--summarize", sessionId], "PARSE_FAIL", cwd, 8000);
}

process.exit(0);
