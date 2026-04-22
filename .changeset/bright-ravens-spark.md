---
"helmor": minor
---

Ship a fuller Helmor companion CLI and keep the desktop app in sync with terminal-driven changes:
- Expand the CLI with workspace, session, repo, files, settings, GitHub, models, send, MCP, and shell completion commands so you can manage Helmor workflows from the terminal.
- Bundle the CLI with the desktop app and install it from Settings as `helmor` in release builds or `helmor-dev` in development builds so it stays version-matched with the app.
- Reflect CLI-triggered workspace, session, files, settings, GitHub, and queued-send changes in the desktop UI immediately instead of waiting for focus-based refreshes.
