---
"helmor": minor
---

Improve workspace PR lifecycle handling:
- Move workspaces to review or done only when their PR lifecycle changes, so manual status moves stay in place until the next PR transition.
- Add Continue for merged PR workspaces to detach from the old PR branch and start fresh from the target branch.
- Polish the Git header controls so PR, Continue, merge status, and editor actions stay readable in narrow layouts.
