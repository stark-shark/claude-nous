import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import * as path from "node:path";
import * as os from "node:os";

// Injected at build time by scripts/build.mjs from package.json. Fallback to
// "0.0.0-dev" when running unbundled source (e.g. tests, `tsc --watch`).
declare const __RECALL_VERSION__: string;
const VERSION: string =
  typeof __RECALL_VERSION__ === "string" ? __RECALL_VERSION__ : "0.0.0-dev";

import { loadConfig } from "./lib/config.js";
import {
  getCurrentProjectHash,
  ensureMemoryDir,
  discoverAllMemoryDirs,
  ensureGlobalMemoryDir,
  type MemoryDirEntry,
} from "./lib/memory-dir.js";
import { handleSave } from "./tools/save.js";
import { handleLoad } from "./tools/load.js";
import { handleSearch } from "./tools/search.js";
import { handleCheck } from "./tools/check.js";
import { handleDecode } from "./tools/decode.js";
import { handleRegistry } from "./tools/registry.js";
import { handleExport } from "./tools/export.js";
import { handleImport } from "./tools/import.js";
import { searchSessions } from "./lib/sessions.js";
import { runScan, formatReport } from "./lib/curate.js";

const SERVER_DIR = path.join(os.homedir(), ".claude", "recall");
const CONFIG_PATH = path.join(SERVER_DIR, "recall.config.jsonc");
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
  { name: "recall", version: VERSION },
  {
    capabilities: { logging: {} },
    instructions: [
      "Recall — compressed memory notation system for Claude Code auto-memory.",
      "",
      "TOOLS: recall_save (write with notation enforcement), recall_load (read with access tracking),",
      "recall_search (cross-project query), recall_check (health checks), recall_decode (expand to plain English),",
      "recall_registry (entity shortcode CRUD), recall_export/recall_import (backup/restore).",
      "",
      "TASK DISPLAY (MANDATORY): EVERY recall_* tool call MUST be wrapped in TaskCreate/TaskUpdate.",
      "Set activeForm on the FIRST task to brand the operation:",
      "  Loading/searching: 'Recalling memories…'",
      "  Saving: 'Storing memories…'",
      "  Health checks: 'Checking memory health…'",
      "Task subjects are short descriptions WITHOUT a 'Recall —' prefix.",
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

// ─── recall_save ───────────────────────────────────────────────

server.registerTool(
  "recall_save",
  {
    title: "Save Memory",
    description:
      "Write or update a memory file with Recall notation enforcement, dedup check, and index update. " +
      "Enforces a hard character cap on the body: a save over cap returns a 'Cap exceeded' error and writes nothing — consolidate or split, then retry THIS turn. " +
      "A usr-type memory named 'user' or 'profile' is routed to the always-loaded user.md profile. Content is security-scanned before write.",
    inputSchema: z.object({
      name: z.string().describe("Memory name (e.g. 'FK CASCADE')"),
      type: z.enum(["fb", "proj", "ref", "usr"]).describe("Memory type"),
      description: z.string().describe("One-line description for relevance matching"),
      content: z.string().describe("Memory content in Recall notation"),
      links: z.array(z.string()).optional().describe("Linked memory filenames (without .md)"),
    }),
  },
  async ({ name, type, description, content, links }) => {
    const hash = getCurrentProjectHash();
    const memDir = ensureMemoryDir(hash, getProjectsRoot());
    const result = handleSave({ name, type, description, content, links }, memDir, config);

    return {
      content: [{ type: "text" as const, text: result.text }],
      isError: result.isError,
    };
  }
);

// ─── recall_load ───────────────────────────────────────────────

server.registerTool(
  "recall_load",
  {
    title: "Load Memory",
    description:
      "Read a memory file. Increments access count. Use expanded=true for decoded plain English.",
    inputSchema: z.object({
      name: z.string().optional().describe("Memory name to search for"),
      file: z.string().optional().describe("Exact filename (e.g. feedback_fk_cascade.md)"),
      expanded: z.boolean().optional().describe("Return decoded plain English instead of raw Recall notation"),
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

// ─── recall_search ─────────────────────────────────────────────

server.registerTool(
  "recall_search",
  {
    title: "Search Memories",
    description:
      "Query memories (hot tier, headers only) OR past Claude Code session transcripts (cold tier, full text). " +
      "scope='memories' (default) searches distilled memory files; scope='sessions' searches raw conversation history — use it for 'did we discuss X?' recall that was never saved as a memory.",
    inputSchema: z.object({
      query: z.string().describe("Search keyword(s); multiple words are ANDed for session scope"),
      type: z.enum(["fb", "proj", "ref", "usr"]).optional().describe("Filter by memory type (memories scope)"),
      project: z.string().optional().describe("Filter by project hash"),
      scope: z.enum(["memories", "sessions"]).optional().describe("Where to search (default: memories)"),
      limit: z.number().optional().describe("Max session matches to return (sessions scope; default 20)"),
    }),
  },
  async ({ query, type, project, scope, limit }) => {
    if (scope === "sessions") {
      const result = searchSessions(getProjectsRoot(), { query, project, limit });
      return { content: [{ type: "text" as const, text: result.text }] };
    }
    const memoryDirs = readDirs();
    const result = handleSearch({ query, type, project }, memoryDirs);

    return {
      content: [{ type: "text" as const, text: result.text }],
    };
  }
);

// ─── recall_check ──────────────────────────────────────────────

server.registerTool(
  "recall_check",
  {
    title: "Health Check",
    description:
      "Run health checks: staleness, registry drift, compression, links, duplicates, stats.",
    inputSchema: z.object({
      checks: z
        .array(z.enum(["stale", "registry", "compression", "links", "duplicates", "stats", "lifecycle", "caps", "all"]))
        .describe("Which checks to run"),
    }),
  },
  async ({ checks }) => {
    const memoryDirs = readDirs();
    const result = handleCheck({ checks }, memoryDirs, config);

    return {
      content: [{ type: "text" as const, text: result.text }],
    };
  }
);

// ─── recall_decode ─────────────────────────────────────────────

server.registerTool(
  "recall_decode",
  {
    title: "Decode Memory",
    description: "Decode a memory from Recall notation to plain English.",
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

// ─── recall_registry ───────────────────────────────────────────

server.registerTool(
  "recall_registry",
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

// ─── recall_export ─────────────────────────────────────────────

server.registerTool(
  "recall_export",
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

// ─── recall_import ─────────────────────────────────────────────

server.registerTool(
  "recall_import",
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
    process.stdout.write("Recall scan: disabled in config.\n");
    return;
  }
  // Scope auto-apply to the CURRENT project only — never silently mutate other
  // projects' memories. cwd is the project dir when invoked from the hook.
  const hash = getCurrentProjectHash();
  const memDir = ensureMemoryDir(hash, getProjectsRoot());
  const report = runScan([{ projectHash: hash, memoryDir: memDir }], config);
  process.stdout.write(formatReport(report) + "\n");
}

async function main() {
  if (process.argv.includes("--scan")) {
    runScanCli();
    return;
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Recall MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
