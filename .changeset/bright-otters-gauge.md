---
"helmor": minor
---

Add a Usage Stats indicator next to the composer:
- Show live 5h and 7d rate-limit windows for the active Claude or Codex account, with a hover popover for the full breakdown (per-model windows, Designs, Daily Routines, plan, credits balance).
- Pull data directly from each provider's OAuth usage endpoint so usage stays visible even when the agent hasn't run yet, and Codex still surfaces plan and credit balance after the rate limit is exhausted.
- Turn the Usage Stats indicator and the context-usage ring on by default for new users.
