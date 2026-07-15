import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { RecallConfig } from "./config.js";

// Daily digest files: memory/days/YYYY-MM-DD.md. Each session summary appends a
// section for its date; SessionStart injects today + the previous N days as the
// "frozen snapshot" of recent work (Hermes' curated-context idea).

export function daysDir(base?: string): string {
  const memory = base ?? path.join(os.homedir(), ".claude", "nous", "memory");
  return path.join(memory, "days");
}

export interface DigestEntry {
  sessionId: string;
  project: string;
  summary: string;
  decisions?: string[];
  openThreads?: string[];
}

export function appendDigest(date: string, entry: DigestEntry, base?: string): void {
  const dir = daysDir(base);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  const file = path.join(dir, `${date}.md`);
  const sid = entry.sessionId.slice(0, 8);

  // Idempotence: don't append a section for a session already recorded today.
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(`<!--session:${sid}-->`)) {
      return;
    }
  } catch {
    /* ignore */
  }

  const lines: string[] = [];
  if (!fs.existsSync(file)) lines.push(`# ${date}`, "");
  lines.push(`## ${entry.project} · ${sid} <!--session:${sid}-->`);
  if (entry.summary) lines.push(entry.summary.trim());
  if (entry.decisions?.length) {
    lines.push("", "**Decisions:**");
    for (const d of entry.decisions) lines.push(`- ${d}`);
  }
  if (entry.openThreads?.length) {
    lines.push("", "**Open threads:**");
    for (const t of entry.openThreads) lines.push(`- ${t}`);
  }
  lines.push("");
  try {
    fs.appendFileSync(file, (fs.existsSync(file) ? "\n" : "") + lines.join("\n"), "utf8");
  } catch {
    /* ignore */
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Build the SessionStart injection: today + previous (injectDays-1) days, capped.
export function injectDaily(cfg: RecallConfig, base?: string, now?: Date): string {
  if (!cfg.daily.enabled) return "";
  const dir = daysDir(base);
  const days = Math.max(1, cfg.daily.injectDays);
  const ref = now ?? new Date();
  const blocks: string[] = [];
  let used = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(ref.getTime() - i * 86400000);
    const file = path.join(dir, `${ymd(d)}.md`);
    let body: string;
    try {
      body = fs.readFileSync(file, "utf8").trim();
    } catch {
      continue;
    }
    if (!body) continue;
    if (used + body.length > cfg.daily.cap) {
      body = body.slice(0, Math.max(0, cfg.daily.cap - used));
    }
    blocks.push(body);
    used += body.length;
    if (used >= cfg.daily.cap) break;
  }
  return blocks.join("\n\n");
}
