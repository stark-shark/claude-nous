# Changelog

## 1.2.0

Bug/gap fixes and Hermes-inspired features from a comparative audit against hermes-agent's memory subsystem.

**Fixes**

- **fix(import):** `nous_import` now preserves full lifecycle metadata (`created`/`updated`/`accessCount`/`links`/`state`), writes the CURRENT header format (previously reconstructed the legacy `T:/D:` header and dropped metadata), security-scans content, dedups by content hash, updates MEMORY.md, routes the user profile to the global dir, and honors a new `project` filter. Unsafe filenames are rejected.
- **fix(retention):** the `retention.*` config was defined but entirely unimplemented — `nous.db` grew unboundedly. Now implemented: interval-gated `VACUUM` (SessionEnd, `--retention`) and optional pruning that reduces old, already-summarized sessions to one searchable summary(+keywords) row. Unsummarized sessions are never pruned. Prune remains OFF by default.
- **fix(indexer):** per-turn indexing read the whole transcript twice per turn (O(session²) over a long session). Now reads only bytes appended since `last_offset`, and the Stop hook takes its review-cadence turn count from the indexer's `turns=` output instead of re-parsing the transcript.
- **fix(config):** removed dead keys (`review.rulesInterval`, `maintain.*`); wired previously-ignored `ladder.bookend` and `userMemory.alwaysLoad`.
- **fix(io):** all memory/state file writes are atomic (temp + rename) — MCP server, Stop-hook indexer, and detached review worker can no longer tear each other's writes.
- **polish(rename):** internals renamed Recall→Nous (`NousConfig` with `RecallConfig` alias, `NOUS_NOTATION.md` cheatsheet with automatic rename of an existing `RECALL_NOTATION.md`, spec file, docs, test fixtures). Legacy read-compat (`metadata.recall.*`, `~/.claude/recall` migration) unchanged.

**Features**

- **feat(preturn):** pre-turn recall injection — on every user prompt, an LLM-free FTS+RRF pass over past sessions injects up to `preturn.maxSessions` one-line reminders with session citations. Converts episodic recall from pull-only ("remembers if it thinks to search") to push ("reminded by default"). New `preturn.*` config; UserPromptSubmit hook consolidated into `user-prompt.mjs`.
- **feat(search):** hot-tier `nous_search` is now ranked retrieval (was: unranked substring scan) — query-term relevance (name > description > body) fused via RRF with recency and `accessCount`; archived memories demoted, not hidden; mtime-cached file reads.
- **feat(summarize):** the session summarizer also emits 5-10 semantic keywords (synonyms/topics not verbatim in the transcript), stored in `sessions.keywords` and FTS-indexed via a hidden `meta` row — paraphrase queries now hit. Summaries themselves became searchable as a side effect.
- **feat(save):** Hermes-style anti-thrash — after 3 over-cap failures on the same memory in one session, the error becomes terminal guidance instead of a retry loop. `batch` saves are all-or-nothing (every spec validated before anything is written). Near-duplicate detection (token-overlap Jaccard ≥0.7) warns on save. Overwriting a file that no longer parses as a Nous memory warns and backs up first (external-drift guard).
- **feat(boot):** SessionStart hook consolidated from ~5 node spawns to one `--boot` CLI call.

## 1.1.5

- **fix(parser):** accept long-form `type:` aliases (`project`→`proj`, `feedback`→`fb`, `reference`→`ref`, `user`→`usr`), case/whitespace-tolerant. Claude Code's native auto-memory writes long-form types; previously such co-owned memory files silently failed to parse and went **invisible** to Nous (didn't load, didn't index, broke links pointing at them). Now they canonicalize on read.

## 1.1.4

- **polish(maintain):** `nous_maintain scan` appends the filename to entries whose memory name collides (e.g. two memories sharing a `humanName`), so duplicates are distinguishable at a glance.

## 1.1.3

- **fix(save/maintain):** `nous_save` accepts an exact `file` override, and `nous_maintain apply` passes the condense proposal's source filename through it. Previously apply re-derived the filename from the memory name, so condensing a memory whose stored filename doesn't match derivation — or that shares a `humanName` with another memory — could write to the **wrong file** (clobbering a different memory, leaving the over-cap one untouched). The filename-collision guard still blocks overwriting a differently-named memory's file.

## 1.1.2

- **fix(save):** `nous_save` now backs up the prior memory body to `<memoryDir>/.backups/` before any overwrite (rotated). Previously overwrites — especially an autonomous condense via `nous_maintain apply` — were a silent, irreversible loss of hand-written content, the exact anti-guardrail the design exists to prevent.

## 1.1.1

- **fix(maintain):** the background auto-condense only stages a condensed memory if the result actually **fits the cap** (with one stricter retry). Previously it staged any size reduction, so a condense that was still over-cap produced a proposal `nous_maintain apply` couldn't apply (nous_save rejects over-cap).

## 1.1.0

Size-triggered self-maintenance + fixes from live v1 testing.

- **`nous_maintain` + auto-condense** — the background review now detects over/near-cap memories, condenses them via headless Haiku, and stages approval-gated `nous_maintain apply` proposals (never silent rewrites). New `nous_maintain` tool (`scan`/`list`/`apply`), `src/lib/maintain.ts`, and `--over-cap` CLI.
- **fix(summarize):** `writeSummary` validates the session id — an unknown/truncated id now writes nothing (no stray daily digest) instead of reporting a false success.
- **fix(daily):** digest idempotence keys on the full session id, not the 8-char short id (prefix-collision safe).
- **fix(skill):** `nous_skill` create/apply ensure the skills root exists before path-hardening — previously refused with ENOENT on a machine that had never created a personal skill.

## 1.0.0

**Rename Recall → Nous** and a full total-recall revamp (Hermes-audited against the real NousResearch/hermes-agent engine).

- **Renamed** the whole plugin: package `nous-mcp`, MCP server `nous`, tools `nous_*`, commands `/nous-*`, agent `nous-worker`, skill `nous`, data dir `~/.claude/nous`, config `nous.config.jsonc`, header key `metadata.nous.*`. Legacy `metadata.recall.*` + `T:`/`D:` headers still parse. **Non-destructive auto-migration** copies memory/state/config from `~/.claude/recall` on first run.
- **Cold tier on SQLite (`node:sqlite`, zero new deps)** — every session captured into a local FTS5 index. Standalone FTS5 (not external-content), two-tier migration (column reconcile + version gate), FTS5 capability probe + corrupt-FTS rebuild, WAL with network-FS fallback. Node ≥22.5 for the DB; brute-scan fallback otherwise.
- **Recall ladder** — `nous_search scope:"sessions"` runs BM25 + recency reciprocal-rank-fusion, hides subagent/tool sources and demotes cron, and returns the top hit's **goal + resolution bookends** and an anchored window in one call. Scroll/read more via `session_id`/`around`/`full`. FTS query sanitizer auto-quotes dotted/hyphenated identifiers. Answers cite session + date; low-confidence hits suggest Haiku query expansion.
- **Capture pipeline** — `Stop` hook incrementally indexes each turn (LLM-free); `SessionEnd` summarizes via headless Haiku into the DB + per-date **daily digests** (`memory/days/*.md`, today+yesterday injected at session start). Summarizer snaps to turn boundaries and writes a placeholder on failure.
- **Secret redaction at capture** (`redact.ts`) — keys/tokens/JWT/PEM/assignments/connection-strings stripped before anything reaches FTS or injection; stable salted markers preserve dedup. No blind entropy matching (keeps git SHAs/paths).
- **Background review** — a detached Haiku pass every N turns **stages** memory/skill proposals to a pending queue (approval gate preserved); surfaced at next session start. Durable turn counter (JSONL-derived). Legacy in-context `nudge` mode still available.
- **Self-building** — `nous_rules` (editable RULES.md) and `nous_skill` (author procedural skills to `~/.claude/skills`). Both approval-gated with propose→apply→rollback, drift guard, path/symlink hardening, frontmatter validation, and versioned backups (rotation that actually deletes). Core `nous` skill is read-only.
- **Self-maintaining memory** — `nous_save` batch mode (add+replace+remove) for consolidation; low-risk upkeep auto-applies, content + user.md edits are staged for approval.
- **`nous_forget`** — right-to-forget purge across DB + FTS with a tombstone so re-indexing can't resurrect it.
- New commands: `/nous-find`, `/nous-status`, `/nous-remember`, `/nous-forget`, `/nous-rules`, `/nous-skill`, `/nous-import`, `/nous-export`. New config sections: `capture`, `ladder`, `daily`, `rules`, `skills`, `maintain`, `retention`, plus `review.mode`/`rulesInterval`.

## 0.7.0

Follow-ups to the v0.6 Hermes-style memory work.

- **Resurrection-on-access** — `nous_load` now revives a `stale`/`archived` memory back to `active`, and re-adds an archived one to `MEMORY.md`. Memories you actually use no longer stay buried by the curator.
- **`nous_check` lifecycle + caps reports** — new `lifecycle` check (active/stale/archived counts + names) and `caps` check (over-cap memories with usage, plus a ≥90% near-cap warning). Both included in `all`.
- **Global, user-scoped `user.md`** — the always-loaded profile now lives once at `~/.claude/recall/memory/` and is shared across every project, not per-project. `nous_save` of a `usr` "user"/"profile" routes there (and skips the project index); search/load/check see it via a `global` pseudo-project.
- **Active mid-session review ("nudge")** — a `UserPromptSubmit` hook counts user turns per project and, every `review.everyNTurns` (default 10), injects a `<NOUS_REVIEW>` prompt so the agent delegates a memory review to the Haiku `nous-worker`. Approval-gated by default (`review.approvalGate`) — it proposes a diff and waits for confirmation before writing.
- **Scoped auto-scan** — the SessionStart curation scan now mutates only the **current project**, never other projects' memories silently. The always-loaded `user.md` is exempt from lifecycle archiving.

## 0.6.0

Hermes-style memory mechanisms, layered on Nous's compression notation.

- **Hard caps + overflow-consolidate loop** — per-type character caps on the memory body (`caps.*`). A `nous_save` over the cap returns a `Cap exceeded` error and writes nothing; the model must consolidate, split, or remove and retry in the same turn. No auto-truncation. Successful saves report usage (`[MEMORY[proj] 67% — 1474/2200]`).
- **Always-loaded, capped `user.md`** — a `usr`-type memory named `user`/`profile` is injected into context at session start (the Hermes USER.md), with its own tight cap.
- **Cold tier** — `nous_search` gains `scope:"sessions"`, a dependency-free full-text search over Claude Code's own session transcripts (`~/.claude/projects/<hash>/*.jsonl`).
- **Auto-curation scan** — on SessionStart, low-risk lifecycle transitions (`active → stale → archived`) are applied automatically; over-cap and duplicate memories are escalated in a scan report. Archived memories leave `MEMORY.md` but remain searchable.
- **Memory lifecycle state** — `active | stale | archived`, stored under `metadata.recall.state` (absent = active).
- **Injection defense** — content is scanned on write (invisible/control/bidi unicode hard-rejected; role-impersonation and override phrasing warn) and delimiter-fenced on load, since memories are injected into the system prompt.
- New config sections: `caps`, `security`, `scan`, `review`, `userMemory`. See `nous.config.reference.md`. Every piece can be disabled.
