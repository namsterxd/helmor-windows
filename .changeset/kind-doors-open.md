---
"helmor": patch
---

Fix the experimental Install CLI action on macOS so it pops the standard administrator authorization prompt (password or Touch ID) when `/usr/local/bin` needs root, instead of silently failing with a permission-denied error.
