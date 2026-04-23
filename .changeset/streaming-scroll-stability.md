---
"helmor": patch
---

Fix multiple chat viewport scrolling glitches during streaming:
- Eliminate the near-bottom flicker, the mid-stream auto-scroll stall, and the first-chunk overshoot that could leave the view stranded mid-reply.
- Keep the streaming logo and timer reliably pinned to the end of the assistant output instead of briefly covering text or snapping back into place a moment later.
- Stop the viewport from bouncing up and down by about one line once a single reply grows taller than the screen on fast models.
