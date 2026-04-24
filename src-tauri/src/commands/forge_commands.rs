use crate::forge::{
    self, ChangeRequestInfo, ForgeActionStatus, ForgeCliStatus, ForgeDetection, ForgeProvider,
    RemoteState,
};
use crate::ui_sync::{self, UiMutationEvent};

use super::common::{run_blocking, CmdResult};

#[tauri::command]
pub async fn get_workspace_forge(workspace_id: String) -> CmdResult<ForgeDetection> {
    run_blocking(move || forge::get_workspace_forge(&workspace_id)).await
}

#[tauri::command]
pub async fn get_forge_cli_status(
    provider: ForgeProvider,
    host: Option<String>,
) -> CmdResult<ForgeCliStatus> {
    run_blocking(move || forge::get_forge_cli_status(provider, host.as_deref())).await
}

#[tauri::command]
pub async fn install_forge_cli(provider: ForgeProvider) -> CmdResult<ForgeCliStatus> {
    run_blocking(move || forge::install_forge_cli(provider)).await
}

#[tauri::command]
pub async fn open_forge_cli_auth_terminal(
    provider: ForgeProvider,
    host: Option<String>,
) -> CmdResult<()> {
    run_blocking(move || forge::open_forge_cli_auth_terminal(provider, host.as_deref())).await
}

#[tauri::command]
pub async fn lookup_workspace_change_request(
    workspace_id: String,
) -> CmdResult<Option<ChangeRequestInfo>> {
    run_blocking(move || forge::lookup_workspace_change_request(&workspace_id)).await
}

#[tauri::command]
pub async fn get_workspace_forge_action_status(
    workspace_id: String,
    app: tauri::AppHandle,
) -> CmdResult<ForgeActionStatus> {
    let lookup_workspace_id = workspace_id.clone();
    let status =
        run_blocking(move || forge::lookup_workspace_forge_action_status(&lookup_workspace_id))
            .await?;
    if should_publish_workspace_forge_changed(status.remote_state) {
        ui_sync::publish(
            &app,
            UiMutationEvent::WorkspaceForgeChanged { workspace_id },
        );
    }
    Ok(status)
}

#[tauri::command]
pub async fn get_workspace_forge_check_insert_text(
    workspace_id: String,
    item_id: String,
) -> CmdResult<String> {
    run_blocking(move || forge::lookup_workspace_forge_check_insert_text(&workspace_id, &item_id))
        .await
}

#[tauri::command]
pub async fn merge_workspace_change_request(
    workspace_id: String,
) -> CmdResult<Option<ChangeRequestInfo>> {
    run_blocking(move || forge::merge_workspace_change_request(&workspace_id)).await
}

#[tauri::command]
pub async fn close_workspace_change_request(
    workspace_id: String,
) -> CmdResult<Option<ChangeRequestInfo>> {
    run_blocking(move || forge::close_workspace_change_request(&workspace_id)).await
}

fn should_publish_workspace_forge_changed(remote_state: RemoteState) -> bool {
    remote_state == RemoteState::Unauthenticated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unauthenticated_action_status_refreshes_workspace_forge() {
        assert!(should_publish_workspace_forge_changed(
            RemoteState::Unauthenticated
        ));
        assert!(!should_publish_workspace_forge_changed(RemoteState::Ok));
        assert!(!should_publish_workspace_forge_changed(RemoteState::NoPr));
        assert!(!should_publish_workspace_forge_changed(
            RemoteState::Unavailable
        ));
        assert!(!should_publish_workspace_forge_changed(RemoteState::Error));
    }
}
