# Changelog

## 0.7.0

Follow-ups to the v0.6 Hermes-style memory work.

- **Resurrection-on-access** — `recall_load` now revives a `stale`/`archived` memory back to `active`, and re-adds an archived one to `MEMORY.md`. Memories you actually use no longer stay buried by the curator.
- **`recall_check` lifecycle + caps reports** — new `lifecycle` check (active/stale/archived counts + names) and `caps` check (over-cap memories with usage, plus a ≥90% near-cap warning). Both included in `all`.
- **Global, user-scoped `user.md`** — the always-loaded profile now lives once at `~/.claude/recall/memory/` and is shared across every project, not per-project. `recall_save` of a `usr` "user"/"profile" routes there (and skips the project index); search/load/check see it via a `global` pseudo-project.
- **Active mid-session review ("nudge")** — a `UserPromptSubmit` hook counts user turns per project and, every `review.everyNTurns` (default 10), injects a `<RECALL_REVIEW>` prompt so the agent delegates a memory review to the Haiku `recall-worker`. Approval-gated by default (`review.approvalGate`) — it proposes a diff and waits for confirmation before writing.
- **Scoped auto-scan** — the SessionStart curation scan now mutates only the **current project**, never other projects' memories silently. The always-loaded `user.md` is exempt from lifecycle archiving.

## 0.6.0

Hermes-style memory mechanisms, layered on Recall's compression notation.

- **Hard caps + overflow-consolidate loop** — per-type character caps on the memory body (`caps.*`). A `recall_save` over the cap returns a `Cap exceeded` error and writes nothing; the model must consolidate, split, or remove and retry in the same turn. No auto-truncation. Successful saves report usage (`[MEMORY[proj] 67% — 1474/2200]`).
- **Always-loaded, capped `user.md`** — a `usr`-type memory named `user`/`profile` is injected into context at session start (the Hermes USER.md), with its own tight cap.
- **Cold tier** — `recall_search` gains `scope:"sessions"`, a dependency-free full-text search over Claude Code's own session transcripts (`~/.claude/projects/<hash>/*.jsonl`).
- **Auto-curation scan** — on SessionStart, low-risk lifecycle transitions (`active → stale → archived`) are applied automatically; over-cap and duplicate memories are escalated in a scan report. Archived memories leave `MEMORY.md` but remain searchable.
- **Memory lifecycle state** — `active | stale | archived`, stored under `metadata.recall.state` (absent = active).
- **Injection defense** — content is scanned on write (invisible/control/bidi unicode hard-rejected; role-impersonation and override phrasing warn) and delimiter-fenced on load, since memories are injected into the system prompt.
- New config sections: `caps`, `security`, `scan`, `review`, `userMemory`. See `recall.config.reference.md`. Every piece can be disabled.
