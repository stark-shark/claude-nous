# Recall

Compressed memory notation system for Claude Code. A plugin that provides MCP tools for reading, writing, searching, and managing memories with notation enforcement, cross-project search, health checks, and access tracking.

## What it does

Claude Code's auto-memory system stores project context as markdown files. Recall compresses that content using a fixed symbol grammar (`->`, `::`, `(+)`, `!`, `@`, `>>`, etc.) and entity shortcodes (`$hub`, `$sb`, etc.), reducing token cost 30-65% while preserving search and embedding quality.

The plugin ships with:

- **MCP server** — 8 tools for memory operations
- **Skill** — governs how Claude uses the tools (task display, multi-topic retrieval)
- **SessionStart hook** — auto-injects the skill at every session start

## Tools

| Tool | Purpose |
|---|---|
| `recall_save` | Write/update a memory with notation enforcement and content-hash dedup |
| `recall_load` | Read a memory by name or filename; increments access count |
| `recall_search` | Query memories across all projects by keyword, type, or project |
| `recall_check` | Health checks: staleness, registry drift, broken links, stats |
| `recall_decode` | Expand Recall notation to plain English |
| `recall_registry` | CRUD for entity shortcodes in REGISTRY.md |
| `recall_export` | Export memories to a JSON backup |
| `recall_import` | Restore memories from a JSON backup |

## Installation

### Prerequisites

- Node.js 20+ (only needed to run the MCP server; no build required)
- Claude Code

### Install from GitHub (recommended)

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "extraKnownMarketplaces": {
    "recall": {
      "source": {
        "source": "github",
        "repo": "stark-shark/claude-recall"
      }
    }
  },
  "enabledPlugins": {
    "recall@recall": true
  }
}
```

Add an `.mcp.json` in your project root (or use `claude mcp add` for global scope). The path below points to Claude Code's plugin cache where the repo auto-installs:

```json
{
  "mcpServers": {
    "recall": {
      "type": "stdio",
      "command": "node",
      "args": ["<USER_HOME>/.claude/plugins/cache/recall/recall/<VERSION>/dist/index.js"]
    }
  }
}
```

Replace `<USER_HOME>` (e.g., `C:/Users/YourName` on Windows or `/Users/yourname` on macOS) and `<VERSION>` with the current plugin version (e.g., `0.1.0`). The pre-built `dist/` ships with the repo — no `npm install` or build step needed.

Restart Claude Code. Verify with `/plugin` (should show Recall enabled) and `/mcp` (should show the recall server connected).

### Install from local clone (for development)

If you want to modify the plugin:

```bash
cd ~/.claude
git clone https://github.com/stark-shark/claude-recall.git recall
cd recall
npm install
npm run build
```

Point `extraKnownMarketplaces` at the local directory instead of GitHub:

```json
{
  "extraKnownMarketplaces": {
    "recall": {
      "source": {
        "source": "directory",
        "path": "<USER_HOME>/.claude/recall"
      }
    }
  }
}
```

And point `.mcp.json` at `<USER_HOME>/.claude/recall/dist/index.js` instead of the plugin cache path.

## Configuration

On first run, copy the default config:

```bash
cp recall.config.default.jsonc recall.config.jsonc
```

Edit `recall.config.jsonc` to customize. See `recall.config.reference.md` for all available settings.

Key settings:

- `notationEnforcement` — `strict` | `warn` | `off`
- `maintainIndex` — keep MEMORY.md updated on every save
- `headerFields.*` — toggle auto-populated fields (dates, access count, links)
- `healthChecks.*` — thresholds for staleness and compression ratio

## Memory Format

Memories are markdown files with a required header:

```
---
T:<type>      # fb, proj, ref, usr
D:<one-line description>
C:<created date>        # optional, set once
U:<updated date>        # optional, updated on save
A:<access count>        # optional, incremented on load
L:<linked memories>     # optional, comma-separated filenames
---

<body content using Recall notation>
```

## Recall Notation

12 ASCII operators (no Unicode):

| Symbol | Meaning | Example |
|---|---|---|
| `->` | maps to | `FK->$emp.id` |
| `::` | because | `:: cost too high` |
| `(+)` | apply when | `(+) new FK to $emp` |
| `!` | not / without | `!httpOnly on auth cookies` |
| `=` | equals | `sonnet=$0.07/chat` |
| `!=` | is not | `public schema !=app data` |
| `&` | and | `auth & session mgmt` |
| `\|` | or / separator | `T:fb \| name` |
| `@` | at / context of | `UUID swap @invite` |
| `>>` | results in | `!CASCADE >> broken invite` |
| `~` | approximately | `~2027` |
| `...` | continuation | `tables: x, y, z ...` |

Entity shortcodes like `$hub`, `$ac`, `$sb` are defined in `REGISTRY.md` and expanded at decode time.

Full spec: [`docs/specs/2026-04-08-recall-language-design.md`](docs/specs/2026-04-08-recall-language-design.md)

## Memory Location

Memories live in Claude Code's standard project memory directory:

```
~/.claude/projects/<project-hash>/memory/
  MEMORY.md        # index (auto-maintained)
  REGISTRY.md      # entity shortcodes
  *.md             # individual memory files
```

Recall never moves memories — it just reads and writes to the existing location. If the plugin isn't running, Claude Code still auto-loads MEMORY.md as usual.

## Development

```bash
npm run dev        # tsc --watch
npm test           # vitest run
npm run test:watch # vitest
npm run build      # tsc → dist/
```

## License

MIT — see [LICENSE](LICENSE).
