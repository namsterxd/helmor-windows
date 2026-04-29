use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use anyhow::Context;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{
    LogicalSize, LogicalUnit, Manager, PixelUnit, Size, State, Window, WindowSizeConstraints,
};

use crate::workspace::scripts::{ScriptContext, ScriptEvent, ScriptProcessManager};
use crate::{agents, git_watcher, models::db, service, sidecar};

#[cfg(windows)]
use super::common::login_terminal_shell;
use super::common::{
    CmdResult, LoginShell, login_terminal_command, login_terminal_initial_input, run_blocking,
};

// Best-fit fixed window size for the current onboarding motion layout.
// Resizing is restored when onboarding exits.
const ONBOARDING_WINDOW_WIDTH: f64 = 1300.0;
const ONBOARDING_WINDOW_HEIGHT: f64 = 810.0;
const HELMOR_SKILL_NAME: &str = "helmor-cli";
const HELMOR_SKILL_SOURCE: &str = "dohooo/helmor/.codex/skills/helmor-cli";

static ONBOARDING_WINDOW_STATE: LazyLock<Mutex<HashMap<String, bool>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static AGENT_LOGIN_STATUS_CACHE: LazyLock<Mutex<Option<(Instant, AgentLoginStatus)>>> =
    LazyLock::new(|| Mutex::new(None));

const AGENT_LOGIN_STATUS_CACHE_TTL: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CliInstallState {
    Missing,
    Managed,
    Stale,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataInfo {
    pub data_mode: String,
    pub data_dir: String,
    pub db_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoginStatus {
    pub claude: bool,
    pub codex: bool,
    pub claude_wsl: bool,
    pub codex_wsl: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub install_path: Option<String>,
    pub build_mode: String,
    pub install_state: CliInstallState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmorSkillsStatus {
    pub installed: bool,
    pub windows_installed: bool,
    pub wsl_installed: bool,
    pub claude: bool,
    pub codex: bool,
    pub command: String,
}

/// Where Helmor installs its managed CLI entrypoint on macOS.
fn cli_install_target() -> std::path::PathBuf {
    #[cfg(windows)]
    {
        crate::data_dir::data_dir()
            .unwrap_or_else(|_| {
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
            })
            .join("bin")
            .join(format!("{}.exe", installed_cli_name()))
    }

    #[cfg(not(windows))]
    {
        std::path::PathBuf::from(format!("/usr/local/bin/{}", installed_cli_name()))
    }
}

fn installed_cli_name() -> &'static str {
    if crate::data_dir::is_dev() {
        "helmor-dev"
    } else {
        "helmor"
    }
}

/// Name of the compiled CLI binary produced by `cargo build --bin helmor-cli`.
fn cli_source_binary_name() -> &'static str {
    "helmor-cli"
}

fn bundled_cli_binary(app_exe: &std::path::Path) -> anyhow::Result<std::path::PathBuf> {
    let target_dir = app_exe
        .parent()
        .context("Cannot determine app binary directory")?;
    let binary_name = if cfg!(windows) {
        format!("{}.exe", cli_source_binary_name())
    } else {
        cli_source_binary_name().to_string()
    };
    let sibling = target_dir.join(binary_name);
    if is_non_empty_file(&sibling) {
        return Ok(sibling);
    }

    #[cfg(debug_assertions)]
    {
        if let Some(cli) = debug_cli_binary_candidate(app_exe) {
            return Ok(cli);
        }
    }

    Ok(sibling)
}

#[cfg(debug_assertions)]
fn debug_cli_binary_candidate(app_exe: &std::path::Path) -> Option<std::path::PathBuf> {
    let exe_dir = app_exe.parent()?;
    let binary_name = if cfg!(windows) {
        format!("{}.exe", cli_source_binary_name())
    } else {
        cli_source_binary_name().to_string()
    };
    let candidate = exe_dir.join(&binary_name);
    if is_non_empty_file(&candidate) {
        return Some(candidate);
    }

    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    let candidate = manifest_dir.join("target").join(profile).join(&binary_name);
    if is_non_empty_file(&candidate) {
        return Some(candidate);
    }
    if candidate.is_file() {
        let _ = std::fs::remove_file(&candidate);
    }

    let status = Command::new("cargo")
        .args(["build", "--manifest-path"])
        .arg(manifest_dir.join("Cargo.toml"))
        .args(["--bin", "helmor-cli"])
        .status()
        .ok()?;
    if !status.success() {
        return None;
    }

    is_non_empty_file(&candidate).then_some(candidate)
}

fn is_non_empty_file(path: &std::path::Path) -> bool {
    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false)
}

fn cli_install_remediation(cli_binary: &std::path::Path, install_path: &std::path::Path) -> String {
    format!(
        "sudo ln -sfn {} {}",
        shell_quote(cli_binary),
        shell_quote(install_path),
    )
}

fn shell_quote(path: &std::path::Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', "'\\''"))
}

fn shell_quote_arg(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn classify_cli_install(
    install_path: &std::path::Path,
    bundled_cli: &std::path::Path,
) -> CliInstallState {
    let metadata = match std::fs::symlink_metadata(install_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return CliInstallState::Missing;
        }
        Err(_) => return CliInstallState::Stale,
    };

    #[cfg(windows)]
    {
        if !metadata.file_type().is_file() {
            return CliInstallState::Stale;
        }
        match (
            std::fs::metadata(install_path),
            std::fs::metadata(bundled_cli),
        ) {
            (Ok(installed), Ok(expected)) if installed.len() == expected.len() => {
                CliInstallState::Managed
            }
            _ => CliInstallState::Stale,
        }
    }

    #[cfg(not(windows))]
    {
        if !metadata.file_type().is_symlink() {
            return CliInstallState::Stale;
        }

        let target = match std::fs::read_link(install_path) {
            Ok(target) => target,
            Err(_) => return CliInstallState::Stale,
        };
        let resolved_target = if target.is_absolute() {
            target
        } else {
            install_path
                .parent()
                .unwrap_or_else(|| std::path::Path::new("/"))
                .join(target)
        };

        match (
            std::fs::canonicalize(resolved_target),
            std::fs::canonicalize(bundled_cli),
        ) {
            (Ok(installed), Ok(expected)) if installed == expected => CliInstallState::Managed,
            _ => CliInstallState::Stale,
        }
    }
}

fn cli_status_for_paths(
    install_path: &std::path::Path,
    bundled_cli: &std::path::Path,
) -> CliStatus {
    let install_state = classify_cli_install(install_path, bundled_cli);
    CliStatus {
        installed: install_state != CliInstallState::Missing,
        install_path: (install_state != CliInstallState::Missing)
            .then(|| install_path.display().to_string()),
        build_mode: crate::data_dir::data_mode_label().to_string(),
        install_state,
    }
}

fn install_cli_symlink(
    bundled_cli: &std::path::Path,
    install_path: &std::path::Path,
) -> anyhow::Result<()> {
    if !bundled_cli.is_file() {
        anyhow::bail!(
            "CLI binary not found at {}. Run `cargo build --bin helmor-cli` first.",
            bundled_cli.display()
        );
    }

    // Refuse to clobber a real directory (even with elevation — too destructive).
    if let Ok(metadata) = std::fs::symlink_metadata(install_path) {
        if metadata.file_type().is_dir() {
            anyhow::bail!(
                "Install path {} is a directory. Remove it manually first.",
                install_path.display()
            );
        }
    }

    match try_install_symlink_unprivileged(bundled_cli, install_path) {
        Ok(()) => return Ok(()),
        Err(error) if is_permission_denied(&error) => {
            tracing::info!(
                target: "helmor_lib::commands::system_commands",
                "Direct CLI install hit permission denied; requesting authorization."
            );
        }
        Err(error) => return Err(error),
    }

    #[cfg(target_os = "macos")]
    {
        install_cli_symlink_elevated(bundled_cli, install_path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        anyhow::bail!(
            "Installing the CLI requires elevated privileges. Run:\n  {}",
            cli_install_remediation(bundled_cli, install_path)
        )
    }
}

fn try_install_symlink_unprivileged(
    bundled_cli: &std::path::Path,
    install_path: &std::path::Path,
) -> anyhow::Result<()> {
    if let Some(parent) = install_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to prepare install directory {}", parent.display()))?;
    }

    match std::fs::symlink_metadata(install_path) {
        Ok(_) => {
            std::fs::remove_file(install_path).with_context(|| {
                format!(
                    "Failed to replace existing CLI install at {}",
                    install_path.display()
                )
            })?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| {
                format!(
                    "Failed to inspect existing CLI install at {}",
                    install_path.display()
                )
            });
        }
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(bundled_cli, install_path)
            .with_context(|| format!("Failed to install CLI at {}", install_path.display()))?;
        Ok(())
    }

    #[cfg(not(unix))]
    {
        std::fs::copy(bundled_cli, install_path)
            .with_context(|| format!("Failed to install CLI at {}", install_path.display()))?;
        Ok(())
    }
}

fn install_cli_wsl_shim(install_path: &std::path::Path) -> anyhow::Result<()> {
    if !cfg!(windows) {
        return Ok(());
    }
    let Some(wsl_cli_path) = windows_path_to_wsl(install_path) else {
        anyhow::bail!(
            "Unable to translate {} to a WSL path.",
            install_path.display()
        );
    };
    let command_name = installed_cli_name();
    let script = format!(
        "set -eu\ninstall_dir=\"$HOME/.local/bin\"\nmkdir -p \"$install_dir\"\ncat > \"$install_dir/{name}\" <<'EOF'\n#!/bin/sh\nexec {target} \"$@\"\nEOF\nchmod +x \"$install_dir/{name}\"\n\"$install_dir/{name}\" --help >/dev/null",
        name = command_name,
        target = shell_quote_arg(&wsl_cli_path),
    );
    let mut command = Command::new("wsl.exe");
    command.args(["--", "sh", "-lc"]).arg(script);
    hide_windows_child_console(&mut command);
    let output = command
        .output()
        .context("Failed to install WSL Helmor CLI shim")?;
    if output.status.success() {
        return Ok(());
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => format!("status={}", output.status),
        (false, true) => format!("status={} stdout={stdout}", output.status),
        (true, false) => format!("status={} stderr={stderr}", output.status),
        (false, false) => format!("status={} stdout={stdout} stderr={stderr}", output.status),
    };
    anyhow::bail!("WSL CLI install failed: {}", detail)
}

fn windows_path_to_wsl(path: &std::path::Path) -> Option<String> {
    let raw = path.display().to_string().replace('\\', "/");
    let mut chars = raw.chars();
    let drive = chars.next()?.to_ascii_lowercase();
    if chars.next()? != ':' {
        return None;
    }
    let rest = chars.as_str().trim_start_matches('/');
    Some(format!("/mnt/{drive}/{rest}"))
}

fn is_permission_denied(error: &anyhow::Error) -> bool {
    error.chain().any(|err| {
        err.downcast_ref::<std::io::Error>()
            .map(|io| io.kind() == std::io::ErrorKind::PermissionDenied)
            .unwrap_or(false)
    })
}

#[cfg(target_os = "macos")]
fn install_cli_symlink_elevated(
    bundled_cli: &std::path::Path,
    install_path: &std::path::Path,
) -> anyhow::Result<()> {
    let script = build_elevated_install_script(bundled_cli, install_path);
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .context("Failed to launch osascript for elevated CLI install")?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let trimmed = stderr.trim();
    // -128 = userCanceledErr (cmd-period / dialog Cancel button).
    if trimmed.contains("(-128)") || trimmed.contains("User canceled") {
        anyhow::bail!("Authorization canceled.");
    }
    anyhow::bail!(
        "Elevated CLI install failed.\n{trimmed}\n\nFallback: {fallback}",
        fallback = cli_install_remediation(bundled_cli, install_path),
    )
}

#[cfg(target_os = "macos")]
fn build_elevated_install_script(
    bundled_cli: &std::path::Path,
    install_path: &std::path::Path,
) -> String {
    let parent = install_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("/"));
    // `ln -sfn` atomically replaces an existing symlink/file at the target;
    // running as root via osascript also covers the case where the parent is
    // root-owned (the typical macOS /usr/local/bin situation).
    let inner = format!(
        "/bin/mkdir -p {parent} && /bin/ln -sfn {src} {target}",
        parent = applescript_shell_arg(parent),
        src = applescript_shell_arg(bundled_cli),
        target = applescript_shell_arg(install_path),
    );
    format!(
        "do shell script \"{inner}\" with prompt \"Helmor wants to install the {name} command line tool to {display}.\" with administrator privileges",
        name = installed_cli_name(),
        display = install_path.display(),
    )
}

/// Quote a path so it survives both `do shell script "..."` (AppleScript string
/// literal) and the shell that AppleScript hands the script to.
#[cfg(any(target_os = "macos", test))]
fn applescript_shell_arg(path: &std::path::Path) -> String {
    let raw = path.display().to_string();
    // 1. Single-quote for the shell, escaping embedded single quotes via `'\''`.
    let shell_quoted = format!("'{}'", raw.replace('\'', "'\\''"));
    // 2. Escape backslashes and double quotes for the AppleScript string literal.
    shell_quoted.replace('\\', "\\\\").replace('"', "\\\"")
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn claude_skills_dir() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".claude"))
        .join("skills")
}

fn codex_skills_dir() -> PathBuf {
    // `skills@1.5.x` installs Codex as a universal agent in the canonical
    // global skills directory.
    home_dir().join(".agents").join("skills")
}

fn skill_exists(base: &Path) -> bool {
    base.join(HELMOR_SKILL_NAME).join("SKILL.md").is_file()
}

fn skills_installed_for_agents(agents: &[&str], claude: bool, codex: bool) -> bool {
    if agents.is_empty() {
        claude || codex
    } else {
        agents.iter().all(|agent| match *agent {
            "claude-code" => claude,
            "codex" => codex,
            _ => false,
        })
    }
}

fn ready_skill_agents(login: &AgentLoginStatus) -> Vec<&'static str> {
    ready_skill_agents_for_shell(login, None)
}

fn ready_skill_agents_for_shell(
    login: &AgentLoginStatus,
    shell: Option<LoginShell>,
) -> Vec<&'static str> {
    let mut agents = Vec::new();
    let claude_ready = match shell {
        Some(LoginShell::Powershell) => login.claude,
        Some(LoginShell::Wsl) => login.claude_wsl,
        None => login.claude || login.claude_wsl,
    };
    let codex_ready = match shell {
        Some(LoginShell::Powershell) => login.codex,
        Some(LoginShell::Wsl) => login.codex_wsl,
        None => login.codex || login.codex_wsl,
    };
    if claude_ready {
        agents.push("claude-code");
    }
    if codex_ready {
        agents.push("codex");
    }
    agents
}

fn helmor_skills_install_args(agents: &[&str]) -> Vec<String> {
    let mut args = vec![
        "add".to_string(),
        HELMOR_SKILL_SOURCE.to_string(),
        "-g".to_string(),
        "-s".to_string(),
        HELMOR_SKILL_NAME.to_string(),
        "-y".to_string(),
        "--copy".to_string(),
    ];
    for agent in agents {
        args.push("-a".to_string());
        args.push((*agent).to_string());
    }
    args
}

fn helmor_skills_install_command(agents: &[&str]) -> String {
    let command_agents = if agents.is_empty() {
        vec!["claude-code", "codex"]
    } else {
        agents.to_vec()
    };
    skills_installer_command_display(&command_agents)
}

fn skills_installer_command_display(agents: &[&str]) -> String {
    let launcher = skills_installer_launcher()
        .map(|launcher| launcher.display_args())
        .unwrap_or_else(|| vec!["npx".to_string(), "--yes".to_string(), "skills".to_string()]);
    launcher
        .into_iter()
        .chain(helmor_skills_install_args(agents))
        .map(|arg| shell_quote_arg(&arg))
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug, Clone)]
struct SkillsInstallerLauncher {
    program: std::path::PathBuf,
    args: Vec<String>,
}

impl SkillsInstallerLauncher {
    fn display_args(&self) -> Vec<String> {
        std::iter::once(self.program.display().to_string())
            .chain(self.args.clone())
            .collect()
    }
}

fn skills_installer_launcher() -> Option<SkillsInstallerLauncher> {
    if let Some(bun) = bundled_bun_path() {
        return Some(SkillsInstallerLauncher {
            program: bun,
            args: vec!["x".to_string(), "skills".to_string()],
        });
    }
    Some(SkillsInstallerLauncher {
        program: std::path::PathBuf::from(if cfg!(windows) { "npx.cmd" } else { "npx" }),
        args: vec!["--yes".to_string(), "skills".to_string()],
    })
}

fn bundled_bun_path() -> Option<std::path::PathBuf> {
    if let Ok(path) = std::env::var("HELMOR_BUN_PATH") {
        let path = std::path::PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }

    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let contents_dir = exe_dir.parent()?;
    let resources_dir = contents_dir.join("Resources");
    let bun_name = if cfg!(windows) { "bun.exe" } else { "bun" };
    let candidate = resources_dir.join(format!("vendor/bun/{bun_name}"));
    if candidate.is_file() {
        return Some(candidate);
    }

    #[cfg(debug_assertions)]
    {
        let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(std::path::Path::to_path_buf)?
            .join(format!("sidecar/dist/vendor/bun/{bun_name}"));
        if dev.is_file() {
            return Some(dev);
        }
    }

    None
}

fn install_helmor_skills_wsl(agents: &[&str]) -> anyhow::Result<()> {
    let mut args = helmor_skills_install_args(agents);
    let quoted_args = args
        .drain(..)
        .map(|arg| shell_quote_arg(&arg))
        .collect::<Vec<_>>()
        .join(" ");
    let script = format!(
        "if command -v bun >/dev/null 2>&1; then bun x skills {args}; elif command -v npx >/dev/null 2>&1; then npx --yes skills {args}; else printf '%s\\n' 'Install Bun or Node.js inside WSL, then run this again.'; exit 127; fi",
        args = quoted_args,
    );
    let output = run_wsl_shell_script(&script).context("Failed to start WSL skills installer")?;
    if output.status.success() {
        return Ok(());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    anyhow::bail!(
        "Helmor skills WSL setup failed.\n{}\n{}",
        stdout.trim(),
        stderr.trim()
    )
}

fn ready_wsl_skill_agents() -> Vec<&'static str> {
    let claude = wsl_resolved_cli_status_command(
        "claude",
        &[
            "$HOME/.npm-global/bin/claude",
            "$HOME/.bun/bin/claude",
            "$HOME/.local/bin/claude",
        ],
        "auth status >/dev/null 2>&1",
    );
    let codex = wsl_resolved_cli_status_command(
        "codex",
        &[
            "$HOME/.npm-global/bin/codex",
            "$HOME/.bun/bin/codex",
            "$HOME/.local/bin/codex",
        ],
        "login status >/dev/null 2>&1 && \"\\$cli\" app-server --help >/dev/null 2>&1",
    );
    let script =
        format!("({claude}) && printf '%s\\n' claude-code; ({codex}) && printf '%s\\n' codex");
    let Ok(output) = run_wsl_shell_script(&script) else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| match line.trim() {
            "claude-code" => Some("claude-code"),
            "codex" => Some("codex"),
            _ => None,
        })
        .collect()
}

fn wsl_helmor_skills_status_for_agents(agents: &[&str]) -> (bool, bool, bool) {
    if !cfg!(windows) {
        return (false, false, false);
    }
    let script = format!(
        "if [ -f \"$HOME/.claude/skills/{name}/SKILL.md\" ]; then printf '%s\\n' claude=1; else printf '%s\\n' claude=0; fi; if [ -f \"$HOME/.agents/skills/{name}/SKILL.md\" ]; then printf '%s\\n' codex=1; else printf '%s\\n' codex=0; fi",
        name = HELMOR_SKILL_NAME,
    );
    let Ok(output) = run_wsl_shell_script(&script) else {
        return (false, false, false);
    };
    if !output.status.success() {
        return (false, false, false);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let claude = stdout.lines().any(|line| line.trim() == "claude=1");
    let codex = stdout.lines().any(|line| line.trim() == "codex=1");
    (
        skills_installed_for_agents(agents, claude, codex),
        claude,
        codex,
    )
}

fn run_wsl_shell_script(script: &str) -> std::io::Result<std::process::Output> {
    let mut last: Option<std::io::Result<std::process::Output>> = None;
    for shell in ["sh", "bash", "zsh"] {
        let mut command = Command::new("wsl.exe");
        command.arg("--").arg(shell).arg("-lc").arg(script);
        hide_windows_child_console(&mut command);
        let result = command.output();
        match result {
            Ok(output) if output.status.success() || !looks_like_missing_wsl_command(&output) => {
                return Ok(output);
            }
            other => last = Some(other),
        }
    }
    last.unwrap_or_else(|| {
        let mut command = Command::new("wsl.exe");
        command.args(["--", "sh", "-lc", script]);
        hide_windows_child_console(&mut command);
        command.output()
    })
}

#[cfg(windows)]
fn hide_windows_child_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    // Background WSL probes pipe stdout/stderr back to Helmor; without this,
    // release GUI launches can flash a real console window for every probe.
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_windows_child_console(_command: &mut Command) {}

fn helmor_skills_status() -> anyhow::Result<HelmorSkillsStatus> {
    let login = agent_login_status_cached();
    Ok(helmor_skills_status_for_login(&login))
}

fn helmor_skills_status_for_agents(agents: &[&str]) -> HelmorSkillsStatus {
    let windows_installed = windows_helmor_skills_status_for_agents(agents).0;
    HelmorSkillsStatus {
        installed: windows_installed,
        windows_installed,
        wsl_installed: false,
        claude: skill_exists(&claude_skills_dir()),
        codex: skill_exists(&codex_skills_dir()),
        command: helmor_skills_install_command(agents),
    }
}

fn windows_helmor_skills_status_for_agents(agents: &[&str]) -> (bool, bool, bool) {
    let claude = skill_exists(&claude_skills_dir());
    let codex = skill_exists(&codex_skills_dir());
    (
        skills_installed_for_agents(agents, claude, codex),
        claude,
        codex,
    )
}

fn helmor_skills_status_for_login(login: &AgentLoginStatus) -> HelmorSkillsStatus {
    let all_agents = ready_skill_agents(login);
    let windows_agents = ready_skill_agents_for_shell(login, Some(LoginShell::Powershell));
    let wsl_agents = ready_skill_agents_for_shell(login, Some(LoginShell::Wsl));
    let (windows_installed, windows_claude, windows_codex) =
        windows_helmor_skills_status_for_agents(&windows_agents);
    let (wsl_installed, wsl_claude, wsl_codex) = wsl_helmor_skills_status_for_agents(&wsl_agents);
    HelmorSkillsStatus {
        installed: windows_installed || wsl_installed,
        windows_installed,
        wsl_installed,
        claude: windows_claude || wsl_claude,
        codex: windows_codex || wsl_codex,
        command: helmor_skills_install_command(&all_agents),
    }
}

#[tauri::command]
pub fn get_cli_status() -> CmdResult<CliStatus> {
    let install_path = cli_install_target();
    let source = std::env::current_exe().context("Cannot determine app executable path")?;
    let cli_binary = bundled_cli_binary(&source)?;
    Ok(cli_status_for_paths(&install_path, &cli_binary))
}

#[tauri::command]
pub async fn install_cli(shell: Option<LoginShell>) -> CmdResult<CliStatus> {
    run_blocking(move || {
        let source = std::env::current_exe()?;
        let cli_binary = bundled_cli_binary(&source)?;
        let install_path = cli_install_target();
        install_cli_symlink(&cli_binary, &install_path)?;
        if matches!(shell, Some(LoginShell::Wsl)) {
            install_cli_wsl_shim(&install_path)?;
        }
        Ok(cli_status_for_paths(&install_path, &cli_binary))
    })
    .await
}

#[tauri::command]
pub async fn get_helmor_skills_status() -> CmdResult<HelmorSkillsStatus> {
    run_blocking(helmor_skills_status).await
}

#[tauri::command]
pub async fn install_helmor_skills(shell: Option<LoginShell>) -> CmdResult<HelmorSkillsStatus> {
    run_blocking(move || {
        let login = AgentLoginStatus {
            claude: claude_login_ready(),
            codex: codex_login_ready(),
            claude_wsl: claude_wsl_login_ready(),
            codex_wsl: codex_wsl_login_ready(),
        };
        let mut agents = ready_skill_agents_for_shell(&login, shell);
        if matches!(shell, Some(LoginShell::Wsl)) && agents.is_empty() {
            agents = ready_wsl_skill_agents();
        }

        if matches!(shell, Some(LoginShell::Wsl)) {
            if agents.is_empty() {
                agents.push("codex");
            }
            install_helmor_skills_wsl(&agents)?;
            return Ok(helmor_skills_status_for_login(&AgentLoginStatus {
                claude: login.claude,
                codex: login.codex,
                claude_wsl: agents.contains(&"claude-code"),
                codex_wsl: agents.contains(&"codex"),
            }));
        }

        let command = helmor_skills_install_command(&agents);

        if agents.is_empty() {
            anyhow::bail!(
                "No ready agent was found. Sign in to Claude Code or Codex first, then run:\n  {}",
                command
            );
        }

        let launcher = skills_installer_launcher().context(
            "No skills installer launcher found. Install Bun or Node.js, then try again.",
        )?;
        let output = Command::new(&launcher.program)
            .args(&launcher.args)
            .args(helmor_skills_install_args(&agents))
            .output()
            .with_context(|| format!("Failed to start skills installer. Try:\n  {command}"))?;

        if !output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                "Helmor skills setup failed.\n{}\n{}\nFix the error, then run:\n  {}",
                stdout.trim(),
                stderr.trim(),
                command
            );
        }

        Ok(helmor_skills_status_for_agents(&agents))
    })
    .await
}

#[tauri::command]
pub fn enter_onboarding_window_mode(window: Window) -> CmdResult<()> {
    let label = window.label().to_string();
    let was_resizable = window
        .is_resizable()
        .context("Failed to read window resizable state")?;
    ONBOARDING_WINDOW_STATE
        .lock()
        .expect("onboarding window state mutex poisoned")
        .entry(label)
        .or_insert(was_resizable);

    let size = onboarding_window_size();
    window
        .set_size(size)
        .context("Failed to set onboarding window size")?;
    window
        .center()
        .context("Failed to center onboarding window")?;
    window
        .set_min_size(Some(size))
        .context("Failed to set onboarding minimum window size")?;
    window
        .set_max_size(Some(size))
        .context("Failed to set onboarding maximum window size")?;
    window
        .set_size_constraints(onboarding_window_constraints())
        .context("Failed to set onboarding window size constraints")?;
    window
        .set_resizable(false)
        .context("Failed to disable onboarding window resizing")?;

    Ok(())
}

#[tauri::command]
pub fn exit_onboarding_window_mode(window: Window) -> CmdResult<()> {
    let label = window.label().to_string();
    let restore_resizable = ONBOARDING_WINDOW_STATE
        .lock()
        .expect("onboarding window state mutex poisoned")
        .remove(&label)
        .unwrap_or(true);

    window
        .set_size_constraints(WindowSizeConstraints::default())
        .context("Failed to clear onboarding window size constraints")?;
    window
        .set_min_size(None::<Size>)
        .context("Failed to clear onboarding minimum window size")?;
    window
        .set_max_size(None::<Size>)
        .context("Failed to clear onboarding maximum window size")?;
    window
        .set_resizable(restore_resizable)
        .context("Failed to restore window resizing")?;

    Ok(())
}

fn onboarding_window_size() -> Size {
    Size::Logical(LogicalSize {
        width: ONBOARDING_WINDOW_WIDTH,
        height: ONBOARDING_WINDOW_HEIGHT,
    })
}

fn onboarding_window_constraints() -> WindowSizeConstraints {
    WindowSizeConstraints {
        min_width: Some(PixelUnit::Logical(LogicalUnit::new(
            ONBOARDING_WINDOW_WIDTH,
        ))),
        min_height: Some(PixelUnit::Logical(LogicalUnit::new(
            ONBOARDING_WINDOW_HEIGHT,
        ))),
        max_width: Some(PixelUnit::Logical(LogicalUnit::new(
            ONBOARDING_WINDOW_WIDTH,
        ))),
        max_height: Some(PixelUnit::Logical(LogicalUnit::new(
            ONBOARDING_WINDOW_HEIGHT,
        ))),
    }
}

#[tauri::command]
pub async fn open_agent_login_terminal(provider: String) -> CmdResult<()> {
    run_blocking(move || open_agent_login_terminal_impl(&provider)).await
}

#[tauri::command]
pub async fn get_agent_login_status(force: Option<bool>) -> CmdResult<AgentLoginStatus> {
    run_blocking(move || {
        Ok(if force.unwrap_or(false) {
            refresh_agent_login_status_cache()
        } else {
            agent_login_status_cached()
        })
    })
    .await
}

fn agent_login_status_cached() -> AgentLoginStatus {
    let now = Instant::now();
    let mut cache = AGENT_LOGIN_STATUS_CACHE
        .lock()
        .expect("agent login status cache mutex poisoned");
    if let Some((cached_at, status)) = cache.as_ref() {
        if now.duration_since(*cached_at) < AGENT_LOGIN_STATUS_CACHE_TTL {
            return status.clone();
        }
    }

    let status = agent_login_status_uncached();
    *cache = Some((Instant::now(), status.clone()));
    status
}

fn refresh_agent_login_status_cache() -> AgentLoginStatus {
    let status = agent_login_status_uncached();
    let mut cache = AGENT_LOGIN_STATUS_CACHE
        .lock()
        .expect("agent login status cache mutex poisoned");
    *cache = Some((Instant::now(), status.clone()));
    status
}

fn agent_login_status_uncached() -> AgentLoginStatus {
    AgentLoginStatus {
        claude: claude_login_ready(),
        codex: codex_login_ready(),
        claude_wsl: claude_wsl_login_ready(),
        codex_wsl: codex_wsl_login_ready(),
    }
}

fn claude_login_ready() -> bool {
    match std::process::Command::new("claude")
        .args(["auth", "status"])
        .output()
    {
        Ok(output) if output.status.success() => parse_claude_login_status(&output.stdout),
        Ok(output) => {
            tracing::debug!(
                "Claude auth status failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
            false
        }
        Err(error) => {
            tracing::trace!("Claude auth status unavailable: {error}");
            false
        }
    }
}

fn codex_login_ready() -> bool {
    let executable = codex_executable();
    match std::process::Command::new(&executable)
        .args(["login", "status"])
        .output()
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            parse_codex_login_status(&format!("{stdout}\n{stderr}"))
                && codex_app_server_ready(&executable)
        }
        Ok(output) => {
            tracing::debug!(
                "Codex login status failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
            false
        }
        Err(error) => {
            tracing::debug!("Codex login status unavailable: {error}");
            false
        }
    }
}

fn codex_app_server_ready(executable: &str) -> bool {
    match std::process::Command::new(executable)
        .args(["app-server", "--help"])
        .output()
    {
        Ok(output) if output.status.success() => true,
        Ok(output) => {
            tracing::debug!(
                "Codex app-server unavailable: {}",
                command_failure_detail(&output)
            );
            false
        }
        Err(error) => {
            tracing::debug!("Codex app-server unavailable: {error}");
            false
        }
    }
}

fn claude_wsl_login_ready() -> bool {
    if !cfg!(windows) {
        return false;
    }
    let command = wsl_resolved_cli_status_command(
        "claude",
        &[
            "$HOME/.npm-global/bin/claude",
            "$HOME/.bun/bin/claude",
            "$HOME/.local/bin/claude",
        ],
        "auth status",
    );
    match run_wsl_shell_script(&command) {
        Ok(output) if output.status.success() => true,
        Ok(output) => {
            if looks_like_missing_wsl_command(&output) {
                tracing::trace!(
                    "Claude WSL auth status unavailable: {}",
                    command_failure_detail(&output)
                );
            } else {
                tracing::debug!(
                    "Claude WSL auth status failed: {}",
                    command_failure_detail(&output)
                );
            }
            false
        }
        Err(error) => {
            tracing::trace!("Claude WSL auth status unavailable: {error}");
            false
        }
    }
}

fn codex_wsl_login_ready() -> bool {
    if !cfg!(windows) {
        return false;
    }
    let command = wsl_resolved_cli_status_command(
        "codex",
        &[
            "$HOME/.npm-global/bin/codex",
            "$HOME/.bun/bin/codex",
            "$HOME/.local/bin/codex",
        ],
        "login status >/dev/null 2>&1 && \"\\$cli\" app-server --help >/dev/null 2>&1",
    );
    match run_wsl_shell_script(&command) {
        Ok(output) if output.status.success() => true,
        Ok(output) => {
            tracing::debug!(
                "Codex WSL login status failed: {}",
                command_failure_detail(&output)
            );
            false
        }
        Err(error) => {
            tracing::debug!("Codex WSL login status unavailable: {error}");
            false
        }
    }
}

fn wsl_resolved_cli_status_command(
    binary: &str,
    fallback_paths: &[&str],
    status_args: &str,
) -> String {
    let mut script = String::new();
    for (index, path) in fallback_paths.iter().enumerate() {
        script.push_str(if index == 0 { "if " } else { "elif " });
        script.push_str(&format!("[ -x \"{path}\" ]; then cli=\"{path}\"; "));
    }
    if fallback_paths.is_empty() {
        script.push_str("if ");
    } else {
        script.push_str("elif ");
    }
    script.push_str(&format!(
        "cli=$(command -v {binary} 2>/dev/null) && [ -n \"\\$cli\" ]; then case \"\\$cli\" in /mnt/[A-Za-z]/*) printf '%s\\n' {}; exit 127;; esac; ",
        shell_quote_arg(&format!(
            "{binary} resolved to a Windows interop path; install it inside WSL instead."
        ))
    ));
    script.push_str("else ");
    script.push_str("printf '%s\\n' ");
    script.push_str(&shell_quote_arg(&format!(
        "{binary} is not on PATH in this WSL shell."
    )));
    script.push_str("; exit 127; fi; ");
    script.push_str(&format!("\"\\$cli\" {status_args}"));
    script
}

fn command_failure_detail(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = format!(
        "status={} stdout={} stderr={}",
        output.status,
        stdout.trim(),
        stderr.trim()
    );
    detail.trim().to_string()
}

fn looks_like_missing_wsl_command(output: &std::process::Output) -> bool {
    let detail = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .to_ascii_lowercase();
    (output.status.code() == Some(127) && detail.trim().is_empty())
        || detail.contains("command not found")
        || detail.contains("not recognized")
        || detail.contains("executable file not found")
        || detail.contains("not on path")
        || detail.contains("windows interop path")
}

fn parse_claude_login_status(stdout: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(stdout)
        .ok()
        .and_then(|value| value.get("loggedIn").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

fn parse_codex_login_status(output: &str) -> bool {
    let normalized = output.to_ascii_lowercase();
    normalized.contains("logged in") && !normalized.contains("not logged in")
}

fn codex_executable() -> String {
    std::env::var("HELMOR_CODEX_BIN_PATH")
        .ok()
        .filter(|path| !path.trim().is_empty())
        .unwrap_or_else(|| "codex".to_string())
}

fn shell_command_arg(value: &str) -> String {
    if cfg!(windows) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn agent_login_command(provider: &str) -> anyhow::Result<String> {
    match provider {
        "claude" => Ok("claude auth login".to_string()),
        "codex" => Ok(format!("{} login", shell_command_arg(&codex_executable()))),
        _ => anyhow::bail!("Unknown agent provider: {provider}"),
    }
}

fn agent_login_wsl_command(provider: &str) -> anyhow::Result<String> {
    match provider {
        "claude" => Ok(wsl_resolved_cli_command(
            "claude",
            &[
                "$HOME/.npm-global/bin/claude",
                "$HOME/.bun/bin/claude",
                "$HOME/.local/bin/claude",
            ],
            "auth status",
            "auth login",
            &[
                "Claude Code CLI is not on PATH in this WSL shell.",
                "Install it in WSL, then run this again.",
            ],
        )),
        "codex" => Ok(wsl_resolved_cli_command(
            "codex",
            &[
                "$HOME/.npm-global/bin/codex",
                "$HOME/.bun/bin/codex",
                "$HOME/.local/bin/codex",
            ],
            "login status >/dev/null 2>&1 && \"\\$cli\" app-server --help",
            "login",
            &[
                "Codex CLI is not on PATH in this WSL shell.",
                "Install it in WSL, then run this again.",
            ],
        )),
        _ => anyhow::bail!("Unknown agent provider: {provider}"),
    }
}

fn wsl_resolved_cli_command(
    binary: &str,
    fallback_paths: &[&str],
    status_args: &str,
    login_args: &str,
    missing_lines: &[&str],
) -> String {
    let mut script = String::new();
    for (index, path) in fallback_paths.iter().enumerate() {
        script.push_str(if index == 0 { "if " } else { "elif " });
        script.push_str(&format!("[ -x \"{path}\" ]; then cli=\"{path}\"; "));
    }
    if fallback_paths.is_empty() {
        script.push_str("if ");
    } else {
        script.push_str("elif ");
    }
    script.push_str(&format!(
        "cli=$(command -v {binary} 2>/dev/null) && [ -n \"\\$cli\" ]; then case \"\\$cli\" in /mnt/[A-Za-z]/*) printf '%s\\n' {}; exit 127;; esac; ",
        shell_quote_arg(&format!(
            "{binary} resolved to a Windows interop path; install it inside WSL instead."
        ))
    ));
    script.push_str("else ");
    for line in missing_lines {
        script.push_str("printf '%s\\n' ");
        script.push_str(&shell_quote_arg(line));
        script.push_str("; ");
    }
    script.push_str("exit 127; fi; ");
    script.push_str(&format!(
        "\"\\$cli\" {status_args} >/dev/null 2>&1 && printf '%s\\n' 'Already logged in.' || exec \"\\$cli\" {login_args}"
    ));
    script
}

#[cfg(test)]
mod wsl_command_tests {
    use super::{wsl_resolved_cli_command, wsl_resolved_cli_status_command};

    #[test]
    fn wsl_status_prefers_linux_fallbacks_before_path_lookup() {
        let command = wsl_resolved_cli_status_command(
            "codex",
            &["$HOME/.npm-global/bin/codex", "$HOME/.bun/bin/codex"],
            "login status",
        );

        assert!(command.starts_with(
            "if [ -x \"$HOME/.npm-global/bin/codex\" ]; then cli=\"$HOME/.npm-global/bin/codex\";"
        ));
        assert!(
            command.contains(
                "elif [ -x \"$HOME/.bun/bin/codex\" ]; then cli=\"$HOME/.bun/bin/codex\";"
            )
        );
        assert!(
            command.contains("elif cli=$(command -v codex 2>/dev/null) && [ -n \"\\$cli\" ]; then")
        );
    }

    #[test]
    fn wsl_commands_reject_windows_interop_paths() {
        let command = wsl_resolved_cli_command("codex", &[], "login status", "login", &["missing"]);

        assert!(command.contains("case \"\\$cli\" in /mnt/[A-Za-z]/*)"));
        assert!(
            command.contains(
                "codex resolved to a Windows interop path; install it inside WSL instead."
            )
        );
        assert!(command.contains("exec \"\\$cli\" login"));
    }
}

fn agent_login_script_type(provider: &str, shell: LoginShell, instance_id: &str) -> String {
    format!(
        "agent-login:{provider}:{}:{instance_id}",
        shell.as_script_key()
    )
}

const AGENT_LOGIN_REPO_ID: &str = "__helmor_onboarding__";

#[tauri::command]
pub async fn spawn_agent_login_terminal(
    manager: State<'_, ScriptProcessManager>,
    provider: String,
    instance_id: String,
    shell: LoginShell,
    channel: Channel<ScriptEvent>,
) -> CmdResult<()> {
    let command = login_terminal_command(
        shell,
        agent_login_command(&provider)?,
        agent_login_wsl_command(&provider)?,
    );
    let working_dir = std::env::var("HOME")
        .ok()
        .filter(|home| !home.trim().is_empty())
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|path| path.display().to_string())
        })
        .unwrap_or_else(|| "/".to_string());
    let context = ScriptContext {
        root_path: working_dir.clone(),
        workspace_path: None,
        workspace_name: None,
        default_branch: None,
    };
    let mgr = manager.inner().clone();
    let script_type = agent_login_script_type(&provider, shell, &instance_id);

    tauri::async_runtime::spawn_blocking(move || {
        let key = (
            AGENT_LOGIN_REPO_ID.to_string(),
            script_type.clone(),
            None::<String>,
        );
        let command_to_send = login_terminal_initial_input(shell, &command);
        let stdin_manager = mgr.clone();
        std::thread::spawn(move || {
            for _ in 0..80 {
                match stdin_manager.write_stdin(&key, command_to_send.as_bytes()) {
                    Ok(true) => return,
                    Ok(false) => std::thread::sleep(std::time::Duration::from_millis(25)),
                    Err(error) => {
                        tracing::debug!("Agent login terminal stdin unavailable: {error}");
                        return;
                    }
                }
            }
            tracing::debug!("Agent login terminal was not ready for initial command");
        });

        if let Err(error) = run_agent_login_terminal_session(
            &mgr,
            &script_type,
            shell,
            &working_dir,
            &context,
            channel.clone(),
        ) {
            let _ = channel.send(ScriptEvent::Error {
                message: error.to_string(),
            });
        }
    });

    Ok(())
}

fn run_agent_login_terminal_session(
    manager: &ScriptProcessManager,
    script_type: &str,
    shell: LoginShell,
    working_dir: &str,
    context: &ScriptContext,
    channel: Channel<ScriptEvent>,
) -> anyhow::Result<Option<i32>> {
    #[cfg(windows)]
    {
        let (shell_path, shell_args) = login_terminal_shell(shell);
        return crate::workspace::scripts::run_script_with_shell(
            manager,
            AGENT_LOGIN_REPO_ID,
            script_type,
            None,
            None,
            working_dir,
            context,
            channel,
            shell_path,
            shell_args,
        );
    }

    #[cfg(not(windows))]
    {
        let _ = shell;
        crate::workspace::scripts::run_terminal_session(
            manager,
            AGENT_LOGIN_REPO_ID,
            script_type,
            None,
            working_dir,
            context,
            channel,
        )
    }
}

#[tauri::command]
pub async fn stop_agent_login_terminal(
    manager: State<'_, ScriptProcessManager>,
    provider: String,
    instance_id: String,
    shell: LoginShell,
) -> CmdResult<bool> {
    let key = (
        AGENT_LOGIN_REPO_ID.to_string(),
        agent_login_script_type(&provider, shell, &instance_id),
        None,
    );
    Ok(manager.kill(&key))
}

#[tauri::command]
pub async fn write_agent_login_terminal_stdin(
    manager: State<'_, ScriptProcessManager>,
    provider: String,
    instance_id: String,
    shell: LoginShell,
    data: String,
) -> CmdResult<bool> {
    let key = (
        AGENT_LOGIN_REPO_ID.to_string(),
        agent_login_script_type(&provider, shell, &instance_id),
        None,
    );
    Ok(manager.write_stdin(&key, data.as_bytes())?)
}

#[tauri::command]
pub async fn resize_agent_login_terminal(
    manager: State<'_, ScriptProcessManager>,
    provider: String,
    instance_id: String,
    shell: LoginShell,
    cols: u16,
    rows: u16,
) -> CmdResult<bool> {
    let key = (
        AGENT_LOGIN_REPO_ID.to_string(),
        agent_login_script_type(&provider, shell, &instance_id),
        None,
    );
    Ok(manager.resize(&key, cols, rows)?)
}

#[cfg(target_os = "macos")]
fn open_agent_login_terminal_impl(provider: &str) -> anyhow::Result<()> {
    let command = agent_login_command(provider)?;
    let script_command = applescript_string(&command);
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg("tell application \"Terminal\" to activate")
        .arg("-e")
        .arg(format!(
            "tell application \"Terminal\" to do script {script_command}"
        ))
        .output()
        .context("Failed to open Terminal for agent login")?;

    if !output.status.success() {
        anyhow::bail!(
            "Terminal login command failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    Ok(())
}

#[cfg(windows)]
fn open_agent_login_terminal_impl(provider: &str) -> anyhow::Result<()> {
    let command = agent_login_command(provider)?;
    std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-NoExit",
            "-Command",
            &command,
        ])
        .spawn()
        .context("Failed to open PowerShell for agent login")?;
    Ok(())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn open_agent_login_terminal_impl(provider: &str) -> anyhow::Result<()> {
    let _ = agent_login_command(provider)?;
    anyhow::bail!("Opening agent login in a terminal is not supported on this platform.")
}

#[cfg(target_os = "macos")]
fn applescript_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[tauri::command]
pub fn get_data_info() -> CmdResult<DataInfo> {
    let data_dir = crate::data_dir::data_dir()?;
    let db_path = crate::data_dir::db_path()?;

    Ok(DataInfo {
        data_mode: crate::data_dir::data_mode_label().to_string(),
        data_dir: data_dir.display().to_string(),
        db_path: db_path.display().to_string(),
    })
}

#[tauri::command]
pub async fn drain_pending_cli_sends() -> CmdResult<Vec<service::PendingCliSend>> {
    run_blocking(service::drain_pending_cli_sends).await
}

#[tauri::command]
pub async fn save_pasted_image(data: String, media_type: String) -> CmdResult<String> {
    run_blocking(move || {
        use std::fs;
        use uuid::Uuid;

        let ext = match media_type.as_str() {
            "image/jpeg" | "image/jpg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            _ => "png",
        };

        let paste_dir = crate::data_dir::data_dir()?.join("paste-cache");
        fs::create_dir_all(&paste_dir).context("Failed to create paste-cache directory")?;

        let filename = format!("paste-{}.{}", Uuid::new_v4(), ext);
        let filepath = paste_dir.join(&filename);

        let bytes = base64_decode(&data).context("Invalid base64 data")?;

        fs::write(&filepath, &bytes)
            .with_context(|| format!("Failed to write pasted image to {}", filepath.display()))?;

        Ok(filepath.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
pub async fn show_image_in_finder(path: String) -> CmdResult<()> {
    run_blocking(move || {
        let source = std::path::PathBuf::from(path);
        if !source.is_file() {
            return Err(anyhow::anyhow!(
                "Image file not found: {}",
                source.display()
            ));
        }
        reveal_file_in_file_manager(&source).context("Failed to show image")
    })
    .await
}

#[tauri::command]
pub async fn copy_image_to_clipboard(path: String) -> CmdResult<()> {
    run_blocking(move || {
        let source = std::path::PathBuf::from(path);
        if !source.is_file() {
            return Err(anyhow::anyhow!(
                "Image file not found: {}",
                source.display()
            ));
        }
        copy_image_file_to_clipboard(&source).context("Failed to copy image")
    })
    .await
}

#[cfg(target_os = "macos")]
fn reveal_file_in_file_manager(path: &std::path::Path) -> anyhow::Result<()> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .context("open command failed")
}

#[cfg(windows)]
fn reveal_file_in_file_manager(path: &std::path::Path) -> anyhow::Result<()> {
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map(|_| ())
        .context("explorer.exe command failed")
}

#[cfg(not(any(target_os = "macos", windows)))]
fn reveal_file_in_file_manager(_path: &std::path::Path) -> anyhow::Result<()> {
    anyhow::bail!("Showing images in the file manager is not supported on this platform")
}

#[cfg(target_os = "macos")]
fn copy_image_file_to_clipboard(path: &std::path::Path) -> anyhow::Result<()> {
    let class_name = match path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") => "JPEG picture",
        Some("gif") => "GIF picture",
        _ => "«class PNGf»",
    };
    let script = format!(
        "set the clipboard to (read (POSIX file \"{}\") as {class_name})",
        applescript_escape(&path.to_string_lossy())
    );
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .context("osascript command failed")?;
    if output.status.success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!(
            "{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(windows)]
fn copy_image_file_to_clipboard(path: &std::path::Path) -> anyhow::Result<()> {
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $image = [System.Drawing.Image]::FromFile({path}); try {{ [System.Windows.Forms.Clipboard]::SetImage($image) }} finally {{ $image.Dispose() }}",
        path = powershell_string(&path.display().to_string()),
    );
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-Sta",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .context("powershell clipboard command failed")?;
    if output.status.success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!(
            "{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn copy_image_file_to_clipboard(_path: &std::path::Path) -> anyhow::Result<()> {
    anyhow::bail!("Copying images is not supported on this platform")
}

#[cfg(target_os = "macos")]
fn applescript_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(windows)]
fn powershell_string(input: &str) -> String {
    format!("'{}'", input.replace('\'', "''"))
}

fn base64_decode(input: &str) -> anyhow::Result<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| anyhow::anyhow!("base64 decode error: {e}"))
}

// ---------------------------------------------------------------------------
// Graceful quit (called from the frontend quit-confirmation dialog)
// ---------------------------------------------------------------------------

/// Shut down git watchers, abort active streams (when `force`), tear down
/// the sidecar cooperatively, then exit. Git watchers go first to stop new
/// events from arriving while we drain.
#[tauri::command]
pub async fn request_quit(app: tauri::AppHandle, force: bool) {
    tracing::info!(force, "request_quit invoked from frontend");

    // 1. Stop filesystem watchers so no new events arrive.
    app.state::<git_watcher::GitWatcherManager>().shutdown();

    // 2. If tasks are in flight, gracefully stop every active stream.
    if force {
        let sidecar = app.state::<sidecar::ManagedSidecar>();
        let active = app.state::<agents::ActiveStreams>();
        agents::abort_all_active_streams_blocking(
            &sidecar,
            &active,
            std::time::Duration::from_millis(1500),
        );
    }

    // 3. Cooperative sidecar teardown: shutdown RPC → SIGTERM → SIGKILL.
    let sidecar = app.state::<sidecar::ManagedSidecar>();
    let (cooperative, escalation) = if force {
        (
            std::time::Duration::from_millis(2000),
            std::time::Duration::from_millis(500),
        )
    } else {
        (
            std::time::Duration::from_millis(500),
            std::time::Duration::from_millis(200),
        )
    };
    sidecar.shutdown(cooperative, escalation);

    // 4. Done — terminate the process.
    app.exit(0);
}

// ---------------------------------------------------------------------------
// Dev-only: nuclear data reset
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevResetResult {
    pub repos_deleted: usize,
    pub workspaces_deleted: usize,
    pub sessions_deleted: usize,
    pub messages_deleted: usize,
    pub directories_removed: Vec<String>,
}

/// Wipe **all** workspaces, sessions, messages, repos, and their filesystem
/// artefacts from the dev data directory.  Only compiled into debug builds.
///
/// Safety guard: the function asserts `data_dir::is_dev()` at runtime as well,
/// so even if someone somehow calls this from a release binary, it refuses.
#[tauri::command]
pub async fn dev_reset_all_data(app: tauri::AppHandle) -> CmdResult<DevResetResult> {
    // 1. Stop all active agent streams so they don't write into deleted sessions.
    {
        let sidecar_state = app.state::<sidecar::ManagedSidecar>();
        let active = app.state::<agents::ActiveStreams>();
        agents::abort_all_active_streams_blocking(
            &sidecar_state,
            &active,
            std::time::Duration::from_millis(1500),
        );
    }

    // 2. Stop all git watchers.
    {
        let manager = app.state::<git_watcher::GitWatcherManager>();
        manager.shutdown();
    }

    run_blocking(move || {
        use crate::data_dir;

        // Runtime double-check: never run in release.
        anyhow::ensure!(
            data_dir::is_dev(),
            "dev_reset_all_data called outside dev mode"
        );

        let data_dir = data_dir::data_dir()?;
        tracing::warn!(dir = %data_dir.display(), "DEV RESET: wiping all data");

        // --- Database cleanup (single transaction) -----------------------
        let mut conn = db::write_conn()?;
        let tx = conn
            .transaction()
            .context("Failed to start dev-reset transaction")?;

        let messages_deleted: usize = tx.execute("DELETE FROM session_messages", []).unwrap_or(0);
        let sessions_deleted: usize = tx.execute("DELETE FROM sessions", []).unwrap_or(0);
        let _pending: usize = tx.execute("DELETE FROM pending_cli_sends", []).unwrap_or(0);
        let workspaces_deleted: usize = tx.execute("DELETE FROM workspaces", []).unwrap_or(0);
        let repos_deleted: usize = tx.execute("DELETE FROM repos", []).unwrap_or(0);

        tx.commit()
            .context("Failed to commit dev-reset transaction")?;

        tracing::info!(
            repos_deleted,
            workspaces_deleted,
            sessions_deleted,
            messages_deleted,
            "DEV RESET: database cleared"
        );

        // --- Filesystem cleanup (best-effort) ----------------------------
        let mut dirs_removed = Vec::new();

        let dirs_to_clear = [data_dir.join("workspaces"), data_dir.join("paste-cache")];

        for dir in &dirs_to_clear {
            if dir.is_dir() {
                // Remove contents but recreate the empty directory.
                if std::fs::remove_dir_all(dir).is_ok() {
                    dirs_removed.push(dir.display().to_string());
                    std::fs::create_dir_all(dir).ok();
                }
            }
        }

        // Workspace-specific logs (keep the top-level logs/ dir).
        let ws_logs = data_dir.join("logs").join("workspaces");
        if ws_logs.is_dir() && std::fs::remove_dir_all(&ws_logs).is_ok() {
            dirs_removed.push(ws_logs.display().to_string());
        }

        tracing::info!(?dirs_removed, "DEV RESET: filesystem cleaned");

        Ok(DevResetResult {
            repos_deleted,
            workspaces_deleted,
            sessions_deleted,
            messages_deleted,
            directories_removed: dirs_removed,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn classify_cli_install_reports_missing_when_path_absent() {
        let tmp = tempdir().unwrap();
        let bundled_cli = tmp.path().join("Helmor.app/Contents/MacOS/helmor-cli");
        fs::create_dir_all(bundled_cli.parent().unwrap()).unwrap();
        fs::write(&bundled_cli, "#!/bin/sh\n").unwrap();

        let install_path = tmp.path().join("usr/local/bin/helmor");
        assert_eq!(
            classify_cli_install(&install_path, &bundled_cli),
            CliInstallState::Missing
        );
    }

    #[test]
    fn is_non_empty_file_rejects_empty_placeholders() {
        let tmp = tempdir().unwrap();
        let empty = tmp.path().join("empty-cli");
        let non_empty = tmp.path().join("real-cli");
        fs::write(&empty, "").unwrap();
        fs::write(&non_empty, "#!/bin/sh\n").unwrap();

        assert!(!is_non_empty_file(&empty));
        assert!(is_non_empty_file(&non_empty));
    }

    #[cfg(unix)]
    #[test]
    fn classify_cli_install_reports_managed_for_matching_symlink() {
        let tmp = tempdir().unwrap();
        let bundled_cli = tmp.path().join("Helmor.app/Contents/MacOS/helmor-cli");
        let install_path = tmp.path().join("usr/local/bin/helmor");
        fs::create_dir_all(bundled_cli.parent().unwrap()).unwrap();
        fs::create_dir_all(install_path.parent().unwrap()).unwrap();
        fs::write(&bundled_cli, "#!/bin/sh\n").unwrap();
        std::os::unix::fs::symlink(&bundled_cli, &install_path).unwrap();

        assert_eq!(
            classify_cli_install(&install_path, &bundled_cli),
            CliInstallState::Managed
        );
    }

    #[test]
    fn classify_cli_install_reports_stale_for_regular_file_copy() {
        let tmp = tempdir().unwrap();
        let bundled_cli = tmp.path().join("Helmor.app/Contents/MacOS/helmor-cli");
        let install_path = tmp.path().join("usr/local/bin/helmor");
        fs::create_dir_all(bundled_cli.parent().unwrap()).unwrap();
        fs::create_dir_all(install_path.parent().unwrap()).unwrap();
        fs::write(&bundled_cli, "#!/bin/sh\n").unwrap();
        fs::write(&install_path, "#!/bin/sh\n").unwrap();

        assert_eq!(
            classify_cli_install(&install_path, &bundled_cli),
            CliInstallState::Stale
        );
    }

    #[test]
    fn install_cli_symlink_replaces_stale_copy_with_managed_symlink() {
        let tmp = tempdir().unwrap();
        let bundled_cli = tmp.path().join("Helmor.app/Contents/MacOS/helmor-cli");
        let install_path = tmp.path().join("usr/local/bin/helmor");
        fs::create_dir_all(bundled_cli.parent().unwrap()).unwrap();
        fs::create_dir_all(install_path.parent().unwrap()).unwrap();
        fs::write(&bundled_cli, "#!/bin/sh\n").unwrap();
        fs::write(&install_path, "#!/bin/sh\n").unwrap();

        install_cli_symlink(&bundled_cli, &install_path).unwrap();

        assert_eq!(
            classify_cli_install(&install_path, &bundled_cli),
            CliInstallState::Managed
        );
    }

    #[test]
    fn cli_install_remediation_uses_force_replace_symlink_command() {
        let command = cli_install_remediation(
            std::path::Path::new("/Applications/Helmor.app/Contents/MacOS/helmor-cli"),
            std::path::Path::new("/usr/local/bin/helmor-dev"),
        );

        assert_eq!(
            command,
            "sudo ln -sfn '/Applications/Helmor.app/Contents/MacOS/helmor-cli' '/usr/local/bin/helmor-dev'"
        );
    }

    #[test]
    fn applescript_shell_arg_quotes_plain_path() {
        assert_eq!(
            applescript_shell_arg(std::path::Path::new("/usr/local/bin/helmor")),
            "'/usr/local/bin/helmor'"
        );
    }

    #[test]
    fn applescript_shell_arg_escapes_single_quote_for_shell_then_applescript() {
        // Shell-quote turns `'` into `'\''`; the embedded backslash then needs
        // to survive AppleScript string-literal parsing, so it doubles to `\\`.
        assert_eq!(
            applescript_shell_arg(std::path::Path::new("/Users/me/foo's app")),
            r"'/Users/me/foo'\\''s app'"
        );
    }

    #[test]
    fn applescript_shell_arg_escapes_double_quote_and_backslash() {
        assert_eq!(
            applescript_shell_arg(std::path::Path::new("/foo\"bar\\baz")),
            r#"'/foo\"bar\\baz'"#
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn build_elevated_install_script_produces_expected_osascript_payload() {
        let bundled_cli =
            std::path::Path::new("/Applications/Helmor.app/Contents/MacOS/helmor-cli");
        let install_path = std::path::Path::new("/usr/local/bin/helmor");

        let script = build_elevated_install_script(bundled_cli, install_path);

        let expected_inner = "/bin/mkdir -p '/usr/local/bin' && /bin/ln -sfn \
                              '/Applications/Helmor.app/Contents/MacOS/helmor-cli' \
                              '/usr/local/bin/helmor'";
        assert!(
            script.contains(expected_inner),
            "script missing expected shell command: {script}"
        );
        assert!(
            script.contains("with administrator privileges"),
            "script missing privilege escalation clause: {script}"
        );
        assert!(
            script.contains("with prompt \""),
            "script missing prompt clause: {script}"
        );
    }
}
