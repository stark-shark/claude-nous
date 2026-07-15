---
description: Search past conversations (cold tier) and cite the exact source session + date.
---

Run the Nous recall ladder for the user's query: **$ARGUMENTS**

1. Invoke the `nous` skill, then call `nous_search` with `scope:"sessions"` and `query:"$ARGUMENTS"`. Use native FTS5 syntax when helpful (quoted phrases, OR, prefix*).
2. The discovery response already includes the top hit's goal + resolution bookends and a window around the match. If you need more of a conversation, call `nous_search scope:"sessions" session_id:"<id>"` (optionally `around:<msg id>` or `full:true`).
3. If confidence is low, delegate query expansion to the `nous-worker` subagent (synonyms/entities), then re-search.
4. Answer with a citation: the session id (short) and date. If nothing is found, say so plainly — do not fabricate.
