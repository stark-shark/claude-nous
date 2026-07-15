import * as fs from "node:fs";
import * as path from "node:path";

// Cold tier: full-text recall over Claude Code's own session transcripts.
//
// Claude Code writes every session as JSONL under
// ~/.claude/projects/<hash>/*.jsonl. Nous's hot tier (memory files) only holds
// what was distilled; this lets nous_search reach the raw conversation —
// "did we discuss X three weeks ago?" — which memories alone cannot answer.
//
// Implementation is a dependency-free brute scan at query time. At personal
// scale (hundreds of sessions) this is fast and keeps Nous's zero-runtime-deps
// promise. A SQLite FTS5 index is a future optimization if scale demands it.

export interface SessionMatch {
  project: string;
  sessionId: string;
  role: string;
  ts: string;
  snippet: string;
}

export interface SessionSearchInput {
  query: string;
  project?: string;
  limit?: number;
}

export function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string; content?: unknown };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "tool_result" && typeof b.content === "string") parts.push(b.content);
  }
  return parts.join(" ");
}

function snippetAround(text: string, terms: string[], width = 160): string {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) idx = 0;
  const start = Math.max(0, idx - width / 2);
  const end = Math.min(text.length, idx + width / 2);
  const clip = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + clip + (end < text.length ? "…" : "");
}

export function searchSessions(
  projectsRoot: string,
  input: SessionSearchInput
): { matches: SessionMatch[]; text: string } {
  const limit = input.limit ?? 20;
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches: SessionMatch[] = [];

  if (!fs.existsSync(projectsRoot) || terms.length === 0) {
    return { matches, text: terms.length === 0 ? "Empty query." : "No sessions found." };
  }

  const projectDirs = fs
    .readdirSync(projectsRoot)
    .filter((name) => !input.project || name === input.project);

  outer: for (const project of projectDirs) {
    const dir = path.join(projectsRoot, project);
    let files: string[];
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      let raw: string;
      try {
        raw = fs.readFileSync(path.join(dir, file), "utf-8");
      } catch {
        continue;
      }
      const sessionId = file.replace(/\.jsonl$/, "");

      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        let obj: { type?: string; message?: unknown; timestamp?: string };
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.type !== "user" && obj.type !== "assistant") continue;
        const text = extractText(obj.message);
        if (!text) continue;
        const lower = text.toLowerCase();
        // AND match: every term must appear (precision over recall).
        if (!terms.every((t) => lower.includes(t))) continue;

        matches.push({
          project,
          sessionId,
          role: obj.type,
          ts: typeof obj.timestamp === "string" ? obj.timestamp.slice(0, 19) : "",
          snippet: snippetAround(text, terms),
        });
        if (matches.length >= limit * 4) break outer; // collect a buffer, sort, then trim
      }
    }
  }

  // Most recent first.
  matches.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const top = matches.slice(0, limit);

  const text =
    top.length === 0
      ? `No past sessions mention '${input.query}'.`
      : top
          .map(
            (m) =>
              `- [${m.ts || "?"}] ${m.role} @ ${m.project}/${m.sessionId.slice(0, 8)} — ${m.snippet}`
          )
          .join("\n");

  return { matches: top, text };
}
