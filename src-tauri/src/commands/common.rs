use crate::error::CommandError;
use serde::Deserialize;

pub(super) type CmdResult<T> = Result<T, CommandError>;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LoginShell {
    Powershell,
    Wsl,
}

impl LoginShell {
    pub fn as_script_key(self) -> &'static str {
        match self {
            LoginShell::Powershell => "powershell",
            LoginShell::Wsl => "wsl",
        }
    }
}

pub(super) fn login_terminal_command(shell: LoginShell, native: String, wsl: String) -> String {
    match shell {
        LoginShell::Powershell if cfg!(windows) => format!("& {native}"),
        LoginShell::Powershell => native,
        LoginShell::Wsl => wsl,
    }
}

pub(super) fn login_terminal_initial_input(shell: LoginShell, command: &str) -> String {
    match shell {
        LoginShell::Powershell if cfg!(windows) => format!("{command}; exit\r\n"),
        LoginShell::Wsl if cfg!(windows) => format!("{command}; exit\n"),
        _ => format!("{command}; exit\n"),
    }
}

#[cfg(windows)]
pub(super) fn login_terminal_shell(shell: LoginShell) -> (&'static str, &'static [&'static str]) {
    match shell {
        LoginShell::Powershell => (
            "powershell.exe",
            &["-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit"],
        ),
        LoginShell::Wsl => ("wsl.exe", &[]),
    }
}

pub(super) async fn run_blocking<F, T>(f: F) -> CmdResult<T>
where
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
    T: Send + 'static,
{
    let result = tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| anyhow::anyhow!("spawn_blocking join failed: {e}"))?;
    Ok(result?)
}
