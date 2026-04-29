use tauri::State;
use tauri::ipc::Channel;

use crate::repos;
use crate::workspace::scripts::{ScriptContext, ScriptEvent, ScriptProcessManager};

use super::common::{CmdResult, LoginShell};

/// Internal `script_type` namespace for Terminal-tab PTY sessions.
///
/// The `ScriptProcessManager` keys processes by `(repo_id, script_type,
/// workspace_id)`. To support multiple concurrent terminals per workspace
/// (each Terminal sub-tab is one) without changing the manager's key shape,
/// we encode the per-instance UUID into the script_type as
/// `"terminal:<instance_id>"`. Setup/Run still use the bare `"setup"` and
/// `"run"` strings, so they're unaffected.
fn make_script_type(instance_id: &str) -> String {
    format!("terminal:{instance_id}")
}

/// Spawn a blank interactive shell ($SHELL -i -l) on a fresh PTY in the
/// workspace directory and stream its output to the frontend over `channel`.
///
/// The shell stays alive until the user types `exit`, the process tree dies,
/// or the frontend invokes `stop_terminal`. Nothing is persisted to disk —
/// closing the app discards the session entirely.
#[tauri::command]
pub async fn spawn_terminal(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    instance_id: String,
    shell: LoginShell,
    channel: Channel<ScriptEvent>,
) -> CmdResult<()> {
    let (repo, workspace) = tauri::async_runtime::spawn_blocking({
        let repo_id = repo_id.clone();
        let ws_id = workspace_id.clone();
        move || -> anyhow::Result<(
            repos::RepositoryRecord,
            Option<crate::models::workspaces::WorkspaceRecord>,
        )> {
            let repo = repos::load_repository_by_id(&repo_id)?
                .ok_or_else(|| anyhow::anyhow!("Repository not found: {repo_id}"))?;
            let ws = crate::models::workspaces::load_workspace_record_by_id(&ws_id)?;
            Ok((repo, ws))
        }
    })
    .await
    .map_err(|e| anyhow::anyhow!("spawn_blocking join failed: {e}"))??;

    // Workspace path is required — Terminal tabs only ever spawn inside an
    // active workspace. Fall back to the repo root only if, for some reason,
    // we couldn't resolve the workspace directory.
    let workspace_root = workspace
        .as_ref()
        .and_then(|ws| crate::data_dir::workspace_dir(&ws.repo_name, &ws.directory_name).ok());
    let working_dir = workspace_root
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| repo.root_path.clone());
    let context = ScriptContext {
        root_path: repo.root_path.clone(),
        workspace_path: Some(working_dir.clone()),
        workspace_name: workspace.as_ref().map(|ws| ws.directory_name.clone()),
        default_branch: repo.default_branch.clone(),
    };
    let mgr = manager.inner().clone();
    let script_type = make_script_type(&instance_id);

    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        let result = run_windows_terminal_session(
            &mgr,
            &repo_id,
            &script_type,
            &workspace_id,
            &working_dir,
            &context,
            channel.clone(),
            shell,
        );

        #[cfg(not(windows))]
        let result = {
            let _ = shell;
            crate::workspace::scripts::run_terminal_session(
                &mgr,
                &repo_id,
                &script_type,
                Some(&workspace_id),
                &working_dir,
                &context,
                channel.clone(),
            )
        };

        if let Err(e) = result {
            let _ = channel.send(ScriptEvent::Error {
                message: e.to_string(),
            });
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_terminal(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    instance_id: String,
) -> CmdResult<bool> {
    let key = (repo_id, make_script_type(&instance_id), Some(workspace_id));
    Ok(manager.kill(&key))
}

#[tauri::command]
pub async fn write_terminal_stdin(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    instance_id: String,
    data: String,
) -> CmdResult<bool> {
    let key = (repo_id, make_script_type(&instance_id), Some(workspace_id));
    Ok(manager.write_stdin(&key, data.as_bytes())?)
}

#[tauri::command]
pub async fn resize_terminal(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    instance_id: String,
    cols: u16,
    rows: u16,
) -> CmdResult<bool> {
    let key = (repo_id, make_script_type(&instance_id), Some(workspace_id));
    Ok(manager.resize(&key, cols, rows)?)
}

#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn run_windows_terminal_session(
    mgr: &ScriptProcessManager,
    repo_id: &str,
    script_type: &str,
    workspace_id: &str,
    working_dir: &str,
    context: &ScriptContext,
    channel: Channel<ScriptEvent>,
    shell: LoginShell,
) -> anyhow::Result<Option<i32>> {
    let (shell_path, shell_args): (&str, Vec<String>) = match shell {
        LoginShell::Powershell => (
            "powershell.exe",
            vec![
                "-NoLogo".into(),
                "-NoProfile".into(),
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-NoExit".into(),
            ],
        ),
        LoginShell::Wsl => {
            let wsl_dir =
                windows_path_to_wsl(working_dir).unwrap_or_else(|| working_dir.replace('\\', "/"));
            ("wsl.exe", vec!["--cd".into(), wsl_dir])
        }
    };
    let shell_arg_refs = shell_args.iter().map(String::as_str).collect::<Vec<_>>();

    crate::workspace::scripts::run_script_with_shell(
        mgr,
        repo_id,
        script_type,
        Some(workspace_id),
        None,
        working_dir,
        context,
        channel,
        shell_path,
        &shell_arg_refs,
    )
}

#[cfg(windows)]
fn windows_path_to_wsl(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    if bytes.len() < 3 || bytes[1] != b':' || (bytes[2] != b'\\' && bytes[2] != b'/') {
        return None;
    }
    let drive = (bytes[0] as char).to_ascii_lowercase();
    if !drive.is_ascii_alphabetic() {
        return None;
    }
    let rest = path[3..].replace('\\', "/");
    Some(format!("/mnt/{drive}/{rest}"))
}
