---
description: Day-one backfill — index all existing Claude Code history into the cold tier and summarize it.
---

Backfill months of pre-existing Claude Code conversation history into Nous so it's searchable + summarized from day one.

1. Invoke the `nous` skill.
2. Run the incremental backfill index. Ask the user to run it (it's a CLI on the plugin's server) OR, if you can run Bash, execute:
   `node "$CLAUDE_PLUGIN_ROOT/dist/index.js" --index`
   Report how many sessions/messages were indexed and how many secrets were redacted.
3. Call `nous_check checks:["sessions"]` to see the unsummarized count.
4. Summarize the backlog in batches: delegate to the `nous-worker` subagent, ~10 sessions per batch — for each, it reads the session (cold tier) and writes a structured summary via the summarize path. This is idempotent (already-summarized sessions are skipped). Report progress.

Note: this can be a large amount of work if you have lots of history — proceed in batches and keep the user informed.
