---
"helmor": patch
---

Improve recovery when a workspace directory disappears outside Helmor:
- Preserve chat history by moving missing workspaces to the archive instead of deleting their records.
- Let archived workspaces without an archive snapshot restore from their target branch, with an in-app notice explaining the fallback.
- Reduce repeated git, file, and inspector errors for missing worktrees while still offering an explicit permanent delete action when recovery is needed.
