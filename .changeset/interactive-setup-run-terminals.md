---
"helmor": minor
---

Make the Run and Setup inspector terminals behave like a real interactive terminal:
- Fix the Stop button so it actually terminates the running script — it was previously a silent no-op that left the process running until it completed on its own.
- Accept keyboard input in the terminal so Ctrl+C now interrupts the foreground process, and interactive tools can prompt you for input the way they would in a normal shell.
- Propagate inspector panel resizes to the script's PTY so vim, htop, and other full-screen tools re-layout correctly when you change the panel size.
