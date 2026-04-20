---
"helmor": patch
---

Speed up and stabilize archiving workspaces in batches:
- Archiving runs in parallel instead of serially, and worktree removal returns immediately by renaming the directory into a sibling trash folder that gets cleaned up in the background — archiving 8 workspaces at once now takes under a second instead of ~90 seconds.
- The archived list no longer reorders itself while a batch of optimistic archives is settling into server data; items stay in click order until reconciliation is complete.
- Archived workspace directories no longer get resurrected as empty `node_modules/.bun` stubs when a stale slash-command prewarm fires for a workspace that was just archived.
