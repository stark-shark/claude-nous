# Nous — Save Rules

These rules govern what Nous remembers. They are YOURS to edit: correct a save
decision and Nous will propose a one-line change here (approval-gated). This file
is injected into the mid-session review so saves follow your rules.

## Save when

- A decision is made (architecture, tooling, naming, a "we'll do X not Y").
- A fix took more than one attempt — capture the root cause + the fix.
- A durable fact about the user, a project, or a preference emerges.
- The user corrects you — record the correction and the why.
- A reusable procedure emerges → consider a `nous_skill`, not just a memory.

## Never save

- Transient chatter, one-off command output, or things trivially re-derivable
  from the code / git history / an existing memory.
- Secrets or credentials (these are redacted at capture, but never hand-write them).
- Anything you're unsure is durable — when in doubt, don't. Recall the raw
  session from the cold tier instead.

## How to save

- Nous notation: drop articles/filler, keep identifiers/paths/numbers verbatim.
- Search first — update an existing memory instead of creating a duplicate.
- Respect the per-type character caps; consolidate rather than append endlessly.

## Self-maintenance guardrails (avoid these degradation modes)

- **Sprawl** — many overlapping half-memories. Prefer consolidating into one.
- **Sediment** — stale facts never revised. Update or archive on access.
- **Premature completion** — declaring something "done"/"final" it isn't.
  Keep open threads as open threads.

Any edit to MEMORY.md or user.md that rewrites content (vs. low-risk dedup /
archive) is staged for your approval, never applied silently.
