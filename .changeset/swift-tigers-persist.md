---
"helmor": patch
---

Fix stuck sessions caused by SQLite contention and unresponsive sidecars:
- Eliminate the "database is locked" failures that could interrupt session actions (marking read, pinning, renaming) while an AI turn was actively writing to the DB.
- Detect a frozen or disconnected sidecar via heartbeat and surface a retry-able error instead of leaving the session stuck in a streaming state.
