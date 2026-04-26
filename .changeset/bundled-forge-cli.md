---
"helmor": minor
---

Streamline GitHub and GitLab onboarding so users no longer have to install the forge CLIs themselves:
- Ship `gh` and `glab` bundled inside Helmor so Connect GitHub / Connect GitLab works on a fresh install — no Homebrew step required.
- Add an Account section in Settings that shows your GitHub identity and the connection status of each forge CLI, with a one-click Connect button that opens a terminal to finish signing in.
- Update the inspector's Connect button tooltip to clarify that authentication happens locally in a terminal you control.
