import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

// Injected at build time by scripts/build.mjs from package.json. Fallback to
// "0.0.0-dev" when running unbundled source (e.g. tests, `tsc --watch`).
declare const __NOUS_VERSION__: string;
const VERSION: string =
  typeof __NOUS_VERSION__ === "string" ? __NOUS_VERSION__ : "0.0.0-dev";

import { loadConfig } from "./lib/config.js";
import {
  getCurrentProjectHash,
  ensureMemoryDir,
  discoverAllMemoryDirs,
  ensureGlobalMemoryDir,
  type MemoryDirEntry,
} from "./lib/memory-dir.js";
import { handleSave } from "./tools/save.js";
import { handleRules } from "./tools/rules.js";
import { handleSkill } from "./tools/skill.js";
import { handleForget } from "./tools/forget.js";
import { handleLoad } from "./tools/load.js";
import { handleSearch } from "./tools/search.js";
import { handleCheck } from "./tools/check.js";
import { handleDecode } from "./tools/decode.js";
import { handleRegistry } from "./tools/registry.js";
import { handleExport } from "./tools/export.js";
import { handleImport } from "./tools/import.js";
import { searchSessions, searchSessionsDb, getAnchoredView } from "./lib/sessions.js";
import { runScan, formatReport } from "./lib/curate.js";
import { migrateFromRecall } from "./lib/migrate.js";
import { openDb, dbStats, type Db } from "./lib/db.js";
import { indexAll, indexFile } from "./lib/indexer.js";
import {
  buildTranscript,
  summarizerPrompt,
  parseSummary,
  writeSummary,
  writePlaceholder,
  pendingSummaries,
} from "./lib/summarize.js";
import { injectDaily } from "./lib/daily.js";
import { nousDir, addProposal, listProposals, getProposal, clearProposal, sha, type Proposal } from "./lib/selfbuild.js";
import { scanCapPressure, condensePrompt } from "./lib/maintain.js";

// Silence node:sqlite's ExperimentalWarning — it's expected and would otherwise
// pollute hook stderr / CLI output on every invocation.
const _emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === "string" ? warning : warning?.message ?? "";
  if (/SQLite is an experimental feature/i.test(msg)) return;
  return (_emitWarning as (w: string | Error, ...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

// Non-destructive one-time copy of pre-v1 ~/.claude/recall data. Runs before
// any dir resolution so config/global-memory land in place first.
migrateFromRecall();

const SERVER_DIR = path.join(os.homedir(), ".claude", "nous");
const CONFIG_PATH = path.join(SERVER_DIR, "nous.config.jsonc");
const config = loadConfig(CONFIG_PATH);

// The user profile is scoped to the USER, not a project: store + load it from a
// global memory dir shared across every project.
const GLOBAL_MEMORY_DIR = ensureGlobalMemoryDir();
config.userMemory.dir = GLOBAL_MEMORY_DIR;

// Memory dirs for read ops = all project dirs + the global dir (so the user
// profile and any other global memory is searchable / loadable / checkable).
function readDirs(): MemoryDirEntry[] {
  const dirs = discoverAllMemoryDirs(getProjectsRoot());
  if (!dirs.some((d) => d.memoryDir === GLOBAL_MEMORY_DIR)) {
    dirs.push({ projectHash: "global", memoryDir: GLOBAL_MEMORY_DIR });
  }
  return dirs;
}

const server = new McpServer(
  { name: "nous", version: VERSION },
  {
    capabilities: { logging: {} },
    instructions: [
      "Nous — compressed memory notation system for Claude Code auto-memory.",
      "",
      "TOOLS: nous_save (write/batch with notation enforcement), nous_load (read with access tracking),",
      "nous_search (hot memories + cold FTS5 sessions w/ bookends/scroll/read), nous_check (health + session stats),",
      "nous_decode (expand to plain English), nous_registry (entity shortcodes), nous_rules (editable save-rules),",
      "nous_skill (author procedural skills), nous_maintain (scan/apply cap-pressure condense proposals),",
      "nous_forget (right-to-forget purge), nous_export/nous_import (backup/restore).",
      "",
      "TASK DISPLAY (MANDATORY): EVERY nous_* tool call MUST be wrapped in TaskCreate/TaskUpdate.",
      "Set activeForm on the FIRST task to brand the operation:",
      "  Loading/searching: 'Recalling memories…'",
      "  Saving: 'Storing memories…'",
      "  Health checks: 'Checking memory health…'",
      "Task subjects are short descriptions WITHOUT a 'Nous —' prefix.",
      "",
      "MULTI-TOPIC RETRIEVAL: Identify ALL topics in the user's request. Create ALL tasks upfront.",
      "Example: TaskCreate({subject:'Loading GP Integration', activeForm:'Recalling memories…'}),",
      "TaskCreate({subject:'Searching for SharePoint'}). Execute sequentially, respond with combined results.",
    ].join("\n"),
  }
);

function getProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

// Lazily-opened shared DB handle for the cold tier. Null when node:sqlite is
// unavailable (Node < 22.5) — callers fall back to the brute-scan cold tier.
let _db: Db | null | undefined;
function getDb(): Db | null {
  if (_db === undefined) _db = openDb();
  return _db;
}
const redactOpts = () => ({ redact: config.capture.redact, redactExtra: config.capture.redactExtra });

// ─── nous_save ───────────────────────────────────────────────

server.registerTool(
  "nous_save",
  {
    title: "Save Memory",
    description:
      "Write or update a memory file with Nous notation enforcement, dedup check, and index update. " +
      "Enforces a hard character cap on the body: a save over cap returns a 'Cap exceeded' error and writes nothing — consolidate or split, then retry THIS turn. " +
      "A usr-type memory named 'user' or 'profile' is routed to the always-loaded user.md profile. Content is security-scanned before write. " +
      "For self-maintenance (consolidating several memories at once), pass `batch` — an array of memory specs applied in one call; each is cap-checked independently.",
    inputSchema: z.object({
      name: z.string().optional().describe("Memory name (e.g. 'FK CASCADE')"),
      type: z.enum(["fb", "proj", "ref", "usr"]).optional().describe("Memory type"),
      description: z.string().optional().describe("One-line description for relevance matching"),
      content: z.string().optional().describe("Memory content in Nous notation"),
      links: z.array(z.string()).optional().describe("Linked memory filenames (without .md)"),
      batch: z
        .array(
          z.object({
            name: z.string(),
            type: z.enum(["fb", "proj", "ref", "usr"]),
            description: z.string(),
            content: z.string(),
            links: z.array(z.string()).optional(),
          })
        )
        .optional()
        .describe("Multiple memory saves applied in one call (self-maintenance / consolidation)"),
    }),
  },
  async ({ name, type, description, content, links, batch }) => {
    const hash = getCurrentProjectHash();
    const memDir = ensureMemoryDir(hash, getProjectsRoot());

    if (batch && batch.length > 0) {
      const lines: string[] = [];
      let anyError = false;
      for (const spec of batch) {
        const r = handleSave(spec, memDir, config);
        if (r.isError) anyError = true;
        lines.push(`${r.isError ? "✗" : "✔"} ${spec.name}: ${r.text.split("\n")[0]}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }], isError: anyError };
    }

    if (!name || !type || !description || content === undefined) {
      return {
        content: [{ type: "text" as const, text: "nous_save requires name+type+description+content (or a `batch`)." }],
        isError: true,
      };
    }
    const result = handleSave({ name, type, description, content, links }, memDir, config);
    return { content: [{ type: "text" as const, text: result.text }], isError: result.isError };
  }
);

// ─── nous_load ───────────────────────────────────────────────

server.registerTool(
  "nous_load",
  {
    title: "Load Memory",
    description:
      "Read a memory file. Increments access count. Use expanded=true for decoded plain English.",
    inputSchema: z.object({
      name: z.string().optional().describe("Memory name to search for"),
      file: z.string().optional().describe("Exact filename (e.g. feedback_fk_cascade.md)"),
      expanded: z.boolean().optional().describe("Return decoded plain English instead of raw Nous notation"),
    }),
  },
  async ({ name, file, expanded }) => {
    const memoryDirs = readDirs();
    const result = handleLoad({ name, file, expanded }, memoryDirs, config);

    return {
      content: [{ type: "text" as const, text: result.text }],
      isError: result.isError,
    };
  }
);

// ─── nous_search ─────────────────────────────────────────────

server.registerTool(
  "nous_search",
  {
    title: "Search Memories",
    description:
      "Query memories (hot tier, headers only) OR past Claude Code session transcripts (cold tier, FTS5 full text). " +
      "scope='memories' (default) searches distilled memory files; scope='sessions' searches raw conversation history — use it for 'did we discuss X?' recall that was never saved as a memory. " +
      "Sessions scope uses native FTS5 syntax: space = AND, OR for breadth, \"quoted phrases\", prefix* wildcards. " +
      "The discovery response already includes the top hit's goal + resolution bookends and a window around the match — cite the session_id + date. " +
      "To pull more of one conversation, pass session_id (+ optional around=<msg id> or full=true) for a scroll/read view. " +
      "If confidence is low, delegate query expansion to the nous-worker subagent, then re-search.",
    inputSchema: z.object({
      query: z.string().optional().describe("Search terms (FTS5 syntax for sessions scope). Omit when using session_id to scroll/read."),
      type: z.enum(["fb", "proj", "ref", "usr"]).optional().describe("Filter by memory type (memories scope)"),
      project: z.string().optional().describe("Filter by project hash"),
      scope: z.enum(["memories", "sessions"]).optional().describe("Where to search (default: memories)"),
      limit: z.number().optional().describe("Max session matches to return (sessions scope; default 20)"),
      session_id: z.string().optional().describe("Sessions scope: pull an anchored/full view of this session (scroll/read mode)"),
      around: z.number().optional().describe("Sessions scope: center the window on this message id (from a prior hit)"),
      full: z.boolean().optional().describe("Sessions scope: return the whole session transcript"),
    }),
  },
  async ({ query, type, project, scope, limit, session_id, around, full }) => {
    if (scope === "sessions") {
      const db = getDb();
      // Scroll/read mode: an explicit session_id pulls context, no query needed.
      if (session_id) {
        if (!db || !db.ftsAvailable) {
          return { content: [{ type: "text" as const, text: "Cold-tier DB unavailable; scroll/read needs the FTS index." }] };
        }
        const view = getAnchoredView(db, session_id, { around, full, window: config.ladder.expandWindow });
        const body = view.lines.length
          ? `${view.citation}\n\n${view.lines.join("\n")}`
          : `No indexed messages for session ${session_id}.`;
        return { content: [{ type: "text" as const, text: body }] };
      }
      const result = db && db.ftsAvailable
        ? searchSessionsDb(db, { query: query ?? "", project, limit: limit ?? config.ladder.maxHits }, config.ladder.rrfK)
        : searchSessions(getProjectsRoot(), { query: query ?? "", project, limit });
      const hint = result.confidence > 0 && result.confidence < config.ladder.escalateBelow
        ? "\n\n(low confidence — consider delegating query expansion to nous-worker, then re-searching)"
        : "";
      return { content: [{ type: "text" as const, text: result.text + hint }] };
    }
    const memoryDirs = readDirs();
    const result = handleSearch({ query: query ?? "", type, project }, memoryDirs);
    return { content: [{ type: "text" as const, text: result.text }] };
  }
);

// ─── nous_check ──────────────────────────────────────────────

server.registerTool(
  "nous_check",
  {
    title: "Health Check",
    description:
      "Run health checks: staleness, registry drift, compression, links, duplicates, stats.",
    inputSchema: z.object({
      checks: z
        .array(z.enum(["stale", "registry", "compression", "links", "duplicates", "stats", "lifecycle", "caps", "sessions", "all"]))
        .describe("Which checks to run"),
    }),
  },
  async ({ checks }) => {
    const memoryDirs = readDirs();
    const result = handleCheck({ checks: checks.filter((c) => c !== "sessions") }, memoryDirs, config);
    let text = result.text;
    if (checks.includes("sessions") || checks.includes("all")) {
      text += "\n\n" + formatDbStats();
    }
    return { content: [{ type: "text" as const, text }] };
  }
);

function formatDbStats(): string {
  const db = getDb();
  if (!db) return "SESSIONS (cold tier): node:sqlite unavailable (Node < 22.5) — brute-scan fallback active.";
  const s = dbStats(db);
  const mb = (s.sizeBytes / 1024 / 1024).toFixed(2);
  return [
    "SESSIONS (cold tier):",
    `  sessions: ${s.sessions} (${s.unsummarized} unsummarized)`,
    `  messages: ${s.messages}  redacted-hits: ${s.redacted}`,
    `  db: ${mb} MB  fts5: ${s.ftsAvailable ? "on" : "off"}  last-index: ${s.lastIndex ?? "never"}`,
  ].join("\n");
}

// ─── nous_decode ─────────────────────────────────────────────

server.registerTool(
  "nous_decode",
  {
    title: "Decode Memory",
    description: "Decode a memory from Nous notation to plain English.",
    inputSchema: z.object({
      name: z.string().optional().describe("Memory name to decode"),
      file: z.string().optional().describe("Exact filename"),
      all: z.boolean().optional().describe("Decode all memories"),
    }),
  },
  async ({ name, file, all }) => {
    const memoryDirs = readDirs();
    const result = handleDecode({ name, file, all }, memoryDirs);

    return {
      content: [{ type: "text" as const, text: result.text }],
      isError: result.isError,
    };
  }
);

// ─── nous_registry ───────────────────────────────────────────

server.registerTool(
  "nous_registry",
  {
    title: "Manage Registry",
    description: "View, add, update, or remove entity shortcodes in REGISTRY.md.",
    inputSchema: z.object({
      action: z.enum(["list", "add", "update", "remove"]).describe("Operation to perform"),
      code: z.string().optional().describe("Entity code (e.g. $hub)"),
      expansion: z.string().optional().describe("Entity expansion (e.g. midwest-apps-hub)"),
    }),
  },
  async ({ action, code, expansion }) => {
    const hash = getCurrentProjectHash();
    const memDir = ensureMemoryDir(hash, getProjectsRoot());
    const result = handleRegistry({ action, code, expansion }, memDir, config.registryFile);

    return {
      content: [{ type: "text" as const, text: result.text }],
      isError: result.isError,
    };
  }
);

// ─── nous_export ─────────────────────────────────────────────

server.registerTool(
  "nous_export",
  {
    title: "Export Memories",
    description: "Export memories to a JSON backup file.",
    inputSchema: z.object({
      outputPath: z.string().describe("Path to write the export JSON file"),
      project: z.string().optional().describe("Export specific project only (default: all)"),
    }),
  },
  async ({ outputPath, project }) => {
    const memoryDirs = readDirs();
    const result = handleExport({ outputPath, project }, memoryDirs, config.registryFile);

    return {
      content: [{ type: "text" as const, text: result.text }],
      isError: result.isError,
    };
  }
);

// ─── nous_rules ──────────────────────────────────────────────

server.registerTool(
  "nous_rules",
  {
    title: "Save Rules",
    description:
      "Manage the editable, approval-gated save-rules (RULES.md) that govern what Nous remembers. " +
      "get: show current rules. propose: stage a full-RULES.md change (returns an id). apply: commit a proposal by id (drift-guarded, backed up). rollback: restore the previous version. " +
      "When the user corrects a save decision, propose a one-line rule change and let them confirm — never edit RULES.md directly.",
    inputSchema: z.object({
      action: z.enum(["get", "propose", "apply", "rollback"]),
      content: z.string().optional().describe("Full new RULES.md (propose)"),
      note: z.string().optional().describe("One-line description of the change (propose)"),
      id: z.string().optional().describe("Proposal id (apply)"),
    }),
  },
  async (args) => {
    const result = handleRules(args, config);
    return { content: [{ type: "text" as const, text: result.text }], isError: result.isError };
  }
);

// ─── nous_skill ──────────────────────────────────────────────

server.registerTool(
  "nous_skill",
  {
    title: "Author Skill",
    description:
      "Author/evolve the agent's own procedural-memory skills (written to ~/.claude/skills, auto-discovered). " +
      "list/get inspect; create/patch stage an approval-gated, frontmatter-validated, path-hardened proposal; apply commits by id (backed up); rollback restores. " +
      "When a repeated workflow or correction warrants a reusable skill, propose one. The core 'nous' skill is read-only.",
    inputSchema: z.object({
      action: z.enum(["list", "get", "create", "patch", "apply", "rollback"]),
      name: z.string().optional().describe("Skill name (kebab-case)"),
      content: z.string().optional().describe("Full SKILL.md incl. frontmatter (create/patch)"),
      note: z.string().optional(),
      id: z.string().optional().describe("Proposal id (apply)"),
    }),
  },
  async (args) => {
    const result = handleSkill(args, config);
    return { content: [{ type: "text" as const, text: result.text }], isError: result.isError };
  }
);

// ─── nous_forget ─────────────────────────────────────────────

server.registerTool(
  "nous_forget",
  {
    title: "Forget",
    description:
      "Right-to-forget: purge a session (session_id) or all sessions matching a query from the cold-tier DB + FTS, with a tombstone so re-indexing won't restore it. " +
      "Previews matches first; pass confirm:true to actually purge (irreversible).",
    inputSchema: z.object({
      session_id: z.string().optional(),
      query: z.string().optional().describe("Purge sessions whose messages match this query"),
      confirm: z.boolean().optional().describe("Set true to actually delete (else preview)"),
    }),
  },
  async (args) => {
    const result = handleForget(args, getDb(), readDirs(), config);
    return { content: [{ type: "text" as const, text: result.text }], isError: result.isError };
  }
);

// ─── nous_maintain ───────────────────────────────────────────

server.registerTool(
  "nous_maintain",
  {
    title: "Maintain Memory",
    description:
      "Self-maintaining memory. action:\"scan\" lists memories at/over their cap (candidates to condense). " +
      "action:\"list\" shows staged condense proposals from the background review. action:\"apply\" commits a staged condense proposal by id (writes the condensed body via nous_save). " +
      "Content rewrites are always staged for approval — never silent.",
    inputSchema: z.object({
      action: z.enum(["scan", "list", "apply"]),
      id: z.string().optional().describe("Proposal id (apply)"),
    }),
  },
  async ({ action, id }) => {
    if (action === "scan") {
      const items = scanCapPressure(readDirs(), config, { overOnly: false });
      if (items.length === 0) return { content: [{ type: "text" as const, text: "No memories under cap pressure." }] };
      const text = items
        .map((m) => `- ${m.name} (${m.type}) ${m.used}/${m.cap} (${m.pct}%)${m.over > 0 ? " — OVER" : ""}`)
        .join("\n");
      return { content: [{ type: "text" as const, text: `Cap pressure:\n${text}` }] };
    }
    if (action === "list") {
      const pend = listProposals("memory");
      const text = pend.length ? pend.map((p) => `- ${p.id} — ${p.note}`).join("\n") : "No staged memory proposals.";
      return { content: [{ type: "text" as const, text }] };
    }
    // apply
    if (!id) return { content: [{ type: "text" as const, text: "apply requires an id." }], isError: true };
    const p = getProposal(id);
    if (!p || p.kind !== "memory") return { content: [{ type: "text" as const, text: `No memory proposal '${id}'.` }], isError: true };
    let spec: { name: string; type: "fb" | "proj" | "ref" | "usr"; description: string; content: string; memoryDir?: string };
    try {
      spec = JSON.parse(p.payload);
    } catch {
      return { content: [{ type: "text" as const, text: "Proposal payload is not valid JSON." }], isError: true };
    }
    const memDir = spec.memoryDir || ensureMemoryDir(getCurrentProjectHash(), getProjectsRoot());
    const result = handleSave(
      { name: spec.name, type: spec.type, description: spec.description, content: spec.content },
      memDir,
      config
    );
    if (!result.isError) clearProposal(id);
    return { content: [{ type: "text" as const, text: result.text }], isError: result.isError };
  }
);

// ─── nous_import ─────────────────────────────────────────────

server.registerTool(
  "nous_import",
  {
    title: "Import Memories",
    description: "Import memories from a JSON backup file.",
    inputSchema: z.object({
      file: z.string().describe("Path to the export JSON file"),
    }),
  },
  async ({ file }) => {
    const hash = getCurrentProjectHash();
    const memDir = ensureMemoryDir(hash, getProjectsRoot());
    const result = handleImport({ file }, memDir, config);

    return {
      content: [{ type: "text" as const, text: result.text }],
      isError: result.isError,
    };
  }
);

// ─── Start ─────────────────────────────────────────────────────

// CLI: `node dist/index.js --scan` runs the auto-apply curation scan and prints
// a one-block report. Invoked by the SessionStart hook; exits without starting
// the MCP server.
function runScanCli(): void {
  if (!config.scan.enabled) {
    process.stdout.write("Nous scan: disabled in config.\n");
    return;
  }
  // Scope auto-apply to the CURRENT project only — never silently mutate other
  // projects' memories. cwd is the project dir when invoked from the hook.
  const hash = getCurrentProjectHash();
  const memDir = ensureMemoryDir(hash, getProjectsRoot());
  const report = runScan([{ projectHash: hash, memoryDir: memDir }], config);
  process.stdout.write(formatReport(report) + "\n");
}

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function readStdin(): Promise<string> {
  try {
    return await new Promise<string>((resolve) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", () => resolve(data));
    });
  } catch {
    return "";
  }
}

// CLI dispatch for the capture pipeline (invoked by hooks + commands). Each flag
// runs and exits without starting the MCP transport.
async function runCli(): Promise<boolean> {
  const argv = process.argv;

  if (argv.includes("--migrate")) return true; // migration already ran at load
  if (argv.includes("--scan")) {
    runScanCli();
    return true;
  }

  if (argv.includes("--db-stats")) {
    process.stdout.write(formatDbStats() + "\n");
    return true;
  }

  // Seed RULES.md from the shipped template if absent (called by SessionStart).
  if (argv.includes("--seed-rules")) {
    try {
      const dest = path.join(nousDir(), "RULES.md");
      if (!fs.existsSync(dest)) {
        const distDir = path.dirname(fileURLToPath(import.meta.url));
        const tpl = path.join(distDir, "..", "RULES.default.md");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (fs.existsSync(tpl)) fs.copyFileSync(tpl, dest);
      }
    } catch {
      /* best effort */
    }
    return true;
  }

  // Print the SessionStart injection block: daily digest + RULES + pending count.
  if (argv.includes("--session-context")) {
    const parts: string[] = [];
    const daily = injectDaily(config, config.userMemory.dir);
    if (daily) parts.push("**RECENT DAYS (Nous daily digest):**\n" + daily);
    try {
      const rules = fs.readFileSync(path.join(nousDir(), "RULES.md"), "utf8").trim();
      if (rules) parts.push("**SAVE RULES (nous_rules to edit):**\n" + rules);
    } catch {
      /* no rules yet */
    }
    const pend = listProposals();
    if (pend.length) {
      parts.push(
        `**NOUS PENDING (${pend.length}):** background review staged proposals — review with nous_rules/nous_skill:\n` +
          pend.map((p) => `- [${p.kind}] ${p.id} — ${p.note}`).join("\n")
      );
    }
    process.stdout.write(parts.join("\n\n"));
    return true;
  }

  // Stage proposals from a background review (JSON array on stdin).
  if (argv.includes("--stage-proposals")) {
    const raw = await readStdin();
    let items: Array<Partial<Proposal> & { name?: string }> = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      process.stdout.write("stage: invalid JSON\n");
      return true;
    }
    let staged = 0;
    for (const it of items) {
      if (!it.note || !it.payload) continue;
      const kind = it.kind === "skill" || it.kind === "memory" ? it.kind : "memory";
      addProposal({
        kind,
        target: it.target ?? it.name ?? "(unspecified)",
        note: it.note,
        payload: it.payload,
        baseHash: it.baseHash ?? sha(""),
      });
      staged++;
    }
    process.stdout.write(`staged ${staged} proposal(s)\n`);
    return true;
  }

  if (argv.includes("--index") || argv.includes("--index-file")) {
    const db = getDb();
    if (!db) {
      process.stdout.write("node:sqlite unavailable — cold tier disabled.\n");
      return true;
    }
    const file = argVal("--index-file");
    if (file) {
      const r = indexFile(db, file, redactOpts());
      process.stdout.write(r ? `indexed ${r.inserted} msg (${r.sessionId})\n` : "no new lines\n");
    } else {
      const r = indexAll(db, getProjectsRoot(), redactOpts());
      process.stdout.write(
        `indexed ${r.messages} msgs across ${r.filesIngested}/${r.filesScanned} files, ${r.sessions} sessions (${r.redacted} redactions)\n`
      );
    }
    return true;
  }

  // Over-cap (+ near-cap) memories with ready-to-run condense prompts — the
  // background review worker consumes this to auto-condense under approval.
  if (argv.includes("--over-cap")) {
    const items = scanCapPressure(readDirs(), config, { overOnly: true }).map((m) => ({
      name: m.name,
      type: m.type,
      description: m.description,
      memoryDir: m.memoryDir,
      file: m.file,
      used: m.used,
      cap: m.cap,
      prompt: condensePrompt(m),
    }));
    process.stdout.write(JSON.stringify(items) + "\n");
    return true;
  }

  if (argv.includes("--pending")) {
    const db = getDb();
    if (!db) return true;
    const ids = pendingSummaries(db, config);
    process.stdout.write(JSON.stringify(ids) + "\n");
    return true;
  }

  // Build the summarizer prompt for a session (hook pipes this to headless Haiku).
  if (argv.includes("--summarize-prompt")) {
    const db = getDb();
    const sid = argVal("--summarize-prompt");
    if (!db || !sid) return true;
    process.stdout.write(summarizerPrompt(buildTranscript(db, sid, config)));
    return true;
  }

  // Write a summary result (JSON on stdin) back to the DB + daily digest.
  if (argv.includes("--summarize")) {
    const db = getDb();
    const sid = argVal("--summarize");
    if (!db || !sid) return true;
    const raw = await readStdin();
    const parsed = parseSummary(raw);
    if (parsed) {
      const ok = writeSummary(db, sid, parsed, config.userMemory.dir);
      process.stdout.write(ok ? "summary written\n" : `no such session '${sid}' — nothing written\n`);
    } else {
      writePlaceholder(db, sid);
      process.stdout.write("summary parse failed — placeholder written\n");
    }
    return true;
  }

  return false;
}

async function main() {
  if (await runCli()) return;
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Nous MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
