---
description: Right-to-forget — purge a session (or query matches) from the cold tier.
---

The user wants to forget: **$ARGUMENTS**

Invoke the `nous` skill, then call `nous_forget`:
- If the argument looks like a session id, pass `session_id`.
- Otherwise pass `query:"$ARGUMENTS"` to find matching sessions.

FIRST call it without `confirm` to preview what would be purged, show the user the list, and ask them to confirm. Only on explicit confirmation call it again with `confirm:true`. This is irreversible (rows + FTS are deleted and the session is tombstoned so re-indexing won't restore it).
