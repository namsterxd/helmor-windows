---
"helmor": patch
---

Fix the macOS dock badge and sidebar unread indicators so they accurately track per-session unread state: opening a session marks it read, the workspace stays flagged while any of its sessions is still unread, and sessions waiting on a prompt only clear once the interaction is completed.
