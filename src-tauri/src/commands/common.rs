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

#[cfg(not(windows))]
pub(super) fn login_terminal_initial_input(shell: LoginShell, command: &str) -> String {
    let _ = shell;
    format!("{command}; exit\n")
}

#[cfg(windows)]
pub(super) fn login_terminal_command_shell(
    shell: LoginShell,
) -> (&'static str, &'static [&'static str]) {
    match shell {
        LoginShell::Powershell => (
            "powershell.exe",
            &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"],
        ),
        LoginShell::Wsl => ("wsl.exe", &["--", "sh", "-lc"]),
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn windows_wsl_login_terminal_runs_command_at_spawn() {
        let (program, args) = login_terminal_command_shell(LoginShell::Wsl);

        assert_eq!(program, "wsl.exe");
        assert_eq!(args, &["--", "sh", "-lc"]);
    }

    #[test]
    fn windows_powershell_login_terminal_runs_command_at_spawn() {
        let (program, args) = login_terminal_command_shell(LoginShell::Powershell);

        assert_eq!(program, "powershell.exe");
        assert_eq!(
            args,
            &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",]
        );
    }
}
