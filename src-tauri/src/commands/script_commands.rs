use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::repos;
use crate::workspace::scripts::{ScriptContext, ScriptEvent, ScriptProcessManager};

use super::common::{CmdResult, LoginShell};

#[tauri::command]
pub async fn execute_repo_script(
    app: AppHandle,
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    script_type: String,
    workspace_id: Option<String>,
    shell: LoginShell,
    channel: Channel<ScriptEvent>,
) -> CmdResult<()> {
    let scripts = tauri::async_runtime::spawn_blocking({
        let repo_id = repo_id.clone();
        let ws_id = workspace_id.clone();
        move || repos::load_repo_scripts(&repo_id, ws_id.as_deref())
    })
    .await
    .map_err(|e| anyhow::anyhow!("spawn_blocking join failed: {e}"))??;

    let script = match script_type.as_str() {
        "setup" => scripts.setup_script,
        "run" => scripts.run_script,
        "archive" => scripts.archive_script,
        _ => None,
    };

    let Some(script) = script.filter(|s| !s.trim().is_empty()) else {
        let _ = channel.send(ScriptEvent::Error {
            message: format!("No {script_type} script configured"),
        });
        return Ok(());
    };

    let (repo, workspace) = tauri::async_runtime::spawn_blocking({
        let repo_id = repo_id.clone();
        let ws_id = workspace_id.clone();
        move || -> anyhow::Result<(repos::RepositoryRecord, Option<crate::models::workspaces::WorkspaceRecord>)> {
            let repo = repos::load_repository_by_id(&repo_id)?
                .ok_or_else(|| anyhow::anyhow!("Repository not found: {repo_id}"))?;
            let ws = match ws_id {
                Some(id) => crate::models::workspaces::load_workspace_record_by_id(&id)?,
                None => None,
            };
            Ok((repo, ws))
        }
    })
    .await
    .map_err(|e| anyhow::anyhow!("spawn_blocking join failed: {e}"))??;

    // Run in the workspace directory when available, otherwise repo root.
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

    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        let result = run_windows_repo_script(
            &mgr,
            &repo_id,
            &script_type,
            workspace_id.as_deref(),
            &script,
            &working_dir,
            &context,
            channel.clone(),
            shell,
        );

        #[cfg(not(windows))]
        let result = {
            let _ = shell;
            crate::workspace::scripts::run_script(
                &mgr,
                &repo_id,
                &script_type,
                workspace_id.as_deref(),
                &script,
                &working_dir,
                &context,
                channel.clone(),
            )
        };

        match result {
            Ok(Some(0)) if script_type == "setup" => {
                if let Some(ws_id) = &workspace_id {
                    if let Ok(ts) = crate::models::db::current_timestamp() {
                        let _ = crate::models::workspaces::update_workspace_state(
                            ws_id,
                            crate::workspace_state::WorkspaceState::Ready,
                            &ts,
                        );
                    }
                    crate::git::watcher::notify_workspace_changed(&app);
                }
            }
            Ok(_) => {}
            Err(e) => {
                let _ = channel.send(ScriptEvent::Error {
                    message: e.to_string(),
                });
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_repo_script(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    script_type: String,
    workspace_id: Option<String>,
) -> CmdResult<bool> {
    let key = (repo_id, script_type, workspace_id);
    Ok(manager.kill(&key))
}

/// Write raw bytes to the PTY master of a running script. The kernel's tty
/// line discipline turns `\x03` into SIGINT for the foreground process group,
/// so this is what makes Ctrl+C inside the terminal tab actually work.
#[tauri::command]
pub async fn write_repo_script_stdin(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    script_type: String,
    workspace_id: Option<String>,
    data: String,
) -> CmdResult<bool> {
    let key = (repo_id, script_type, workspace_id);
    Ok(manager.write_stdin(&key, data.as_bytes())?)
}

/// Update the PTY's window size. The kernel delivers SIGWINCH to the
/// foreground process group so interactive tools (vim, htop, less) re-layout.
#[tauri::command]
pub async fn resize_repo_script(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    script_type: String,
    workspace_id: Option<String>,
    cols: u16,
    rows: u16,
) -> CmdResult<bool> {
    let key = (repo_id, script_type, workspace_id);
    Ok(manager.resize(&key, cols, rows)?)
}

#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn run_windows_repo_script(
    mgr: &ScriptProcessManager,
    repo_id: &str,
    script_type: &str,
    workspace_id: Option<&str>,
    script: &str,
    working_dir: &str,
    context: &ScriptContext,
    channel: Channel<ScriptEvent>,
    shell: LoginShell,
) -> anyhow::Result<Option<i32>> {
    match shell {
        LoginShell::Powershell => crate::workspace::scripts::run_script(
            mgr,
            repo_id,
            script_type,
            workspace_id,
            script,
            working_dir,
            context,
            channel,
        ),
        LoginShell::Wsl => {
            let wsl_dir =
                windows_path_to_wsl(working_dir).unwrap_or_else(|| working_dir.replace('\\', "/"));
            let script = format!(
                "export PATH=\"$HOME/.bun/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH\"; {script}"
            );
            crate::workspace::scripts::run_script_with_shell(
                mgr,
                repo_id,
                script_type,
                workspace_id,
                Some(&script),
                working_dir,
                context,
                channel,
                "wsl.exe",
                &["--cd", &wsl_dir, "--", "bash", "-lc"],
            )
        }
    }
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
