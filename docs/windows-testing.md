# Windows testing

Use a native Windows PowerShell from this checkout. Do not run these commands
inside WSL; Tauri, Bun's compiled sidecar, and the bundled `.exe` tools need to
be produced by the Windows toolchain.

## One-command smoke test

```powershell
scripts\test-windows.cmd
```

That command bootstraps Bun if it is missing, checks the rest of the toolchain,
installs dependencies, typechecks the frontend and sidecar, then builds the
Windows sidecar plus bundled `gh`, `glab`, `codex`, and `bun` vendor binaries.
The full frontend, sidecar, and Rust test suites are available with
`-FullTests`, but remain opt-in while their Windows-specific failures are being
ported.

## Useful variants

```powershell
scripts\test-windows.cmd -Doctor
scripts\test-windows.cmd -SkipInstall
scripts\test-windows.cmd -SkipInstall -FullTests
scripts\test-windows.cmd -NoFrozenLockfile
scripts\test-windows.cmd -Dev
scripts\test-windows.cmd -BuildBundle
bun run windows:doctor
bun run test:windows -- -SkipInstall
bun run dev:windows
bun run build:windows
```

- `scripts\test-windows.cmd` is the no-Bun entrypoint and avoids unsigned
  `.ps1` execution policy errors.
- `-Doctor` verifies Bun, sccache, Git, and Rust MSVC, installing Bun or
  sccache if needed.
- `-SkipInstall` reuses existing dependencies.
- `-FullTests` runs frontend, sidecar, and Rust test checks. These are opt-in
  on Windows while the test suites are still being ported.
- `-NoFrozenLockfile` retries dependency install without `--frozen-lockfile`.
- `-Dev` prepares the Windows vendor binaries and starts `tauri dev`.
- `-BuildBundle` runs the smoke test and then builds a Windows Tauri debug
  bundle.
- The `bun run ...` aliases are available after Bun is installed.

`-Dev` also points Helmor at the staged Windows agent binaries via
`HELMOR_CODEX_BIN_PATH`, `HELMOR_CLAUDE_CODE_CLI_PATH`, and `HELMOR_BUN_PATH`.
Codex login in the Windows app uses the native Windows Codex auth store, not a
Codex install or login from WSL.

## Prerequisites

- Rust stable with the `*-pc-windows-msvc` host toolchain
- Microsoft C++ Build Tools / Visual Studio with the Windows SDK
- Git for Windows
- WebView2 Runtime

Bun 1.3+ is installed automatically by `scripts\test-windows.cmd` if it is
missing.

The repo requires `sccache` through `src-tauri/.cargo/config.toml`. The Windows
runner installs it with `cargo install sccache --locked` if it is missing.

The first `bun install` on Windows can sit on one progress line for several
minutes while it unpacks many small files and Windows Defender scans
`node_modules`. The script prints a heartbeat every 30 seconds so you can tell
it is still running.

If the app opens but agent calls fail, check the debug data directory at
`~/helmor-dev/logs/` in PowerShell (`$HOME\helmor-dev\logs`).

The runner sets `HOME` from `USERPROFILE` when Windows has no `HOME`, and sets
`HELMOR_DATA_DIR` to `$HOME\helmor-dev` unless you already provided an override.
