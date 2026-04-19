---
"helmor": patch
---

Fix Conductor-to-Helmor script migration so ported workspaces actually run:
- The migration assistant now rewrites `$CONDUCTOR_*` environment variable references (e.g. `$CONDUCTOR_WORKSPACE_PATH`) to their `$HELMOR_*` equivalents when copying `conductor.json` to `helmor.json`, so Cmd+R no longer fails with `exit 127` because the old variables are unset at runtime.
- The rewrite also runs on an existing `helmor.json` that still contains stale `CONDUCTOR_*` references from an earlier incomplete migration, so re-triggering the assistant repairs partially-migrated workspaces instead of exiting early.
