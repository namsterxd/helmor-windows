---
"helmor": minor
---

Add repository-specific branch prefix overrides and clean up the repository settings layout:
- Let each repository set a custom branch prefix, with empty values inheriting the global default.
- Use the matching GitHub or GitLab account when Helmor generates provider-based branch prefixes for new workspaces.
- Show repository settings as divided rows instead of separate cards for a cleaner settings panel.
