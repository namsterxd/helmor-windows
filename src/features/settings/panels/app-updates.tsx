import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	type AppUpdateStatus,
	checkForAppUpdate,
	getAppUpdateStatus,
	installDownloadedAppUpdate,
	listenAppUpdateStatus,
} from "@/lib/api";
import { SettingsNotice, SettingsRow } from "../components/settings-row";

function formatStatusDescription(status: AppUpdateStatus): string {
	if (!status.configured) {
		return "Updater is not configured in this build.";
	}

	switch (status.stage) {
		case "checking":
			return "Checking GitHub releases in the background.";
		case "downloading":
			return status.update
				? `Downloading ${status.update.version} in the background.`
				: "Downloading an update in the background.";
		case "downloaded":
			return status.update
				? `${status.update.version} has been downloaded and is ready to install.`
				: "The latest update has been downloaded and is ready to install.";
		case "error":
			return status.lastError ?? "The last update check failed.";
		case "disabled":
			return status.autoUpdateEnabled
				? "Automatic update checks are waiting for updater configuration."
				: "Automatic update checks are disabled.";
		default:
			return "Checks GitHub releases, downloads updates quietly, then prompts when ready.";
	}
}

export function AppUpdatesPanel() {
	const [status, setStatus] = useState<AppUpdateStatus | null>(null);
	const [checking, setChecking] = useState(false);
	const [installing, setInstalling] = useState(false);

	useEffect(() => {
		let mounted = true;
		let cleanup: (() => void) | undefined;

		void getAppUpdateStatus().then((nextStatus) => {
			if (mounted) setStatus(nextStatus);
		});

		void listenAppUpdateStatus((nextStatus) => {
			if (mounted) setStatus(nextStatus);
		}).then((unlisten) => {
			cleanup = unlisten;
		});

		return () => {
			mounted = false;
			cleanup?.();
		};
	}, []);

	return (
		<SettingsRow
			align="start"
			title="App Updates"
			description={
				<>
					{status ? formatStatusDescription(status) : "Loading updater status…"}
					{status?.update ? (
						<SettingsNotice tone="info">
							Current {status.update.currentVersion} · Available{" "}
							{status.update.version}
						</SettingsNotice>
					) : null}
				</>
			}
		>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => {
						setChecking(true);
						void checkForAppUpdate(true)
							.then((nextStatus) => {
								setStatus(nextStatus);
								if (nextStatus.stage === "idle") {
									toast.success("Helmor is up to date");
								}
								if (nextStatus.stage === "error") {
									toast.error("Update check failed", {
										description:
											nextStatus.lastError ?? "Unable to check for updates.",
									});
								}
							})
							.finally(() => setChecking(false));
					}}
					disabled={checking || installing}
				>
					{checking ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<RefreshCw className="size-3.5" />
					)}
					Check now
				</Button>
				{status?.stage === "downloaded" && (
					<Button
						size="sm"
						onClick={() => {
							setInstalling(true);
							void installDownloadedAppUpdate()
								.then(setStatus)
								.catch((error: unknown) => {
									toast.error("Install failed", {
										description:
											error instanceof Error
												? error.message
												: "Unable to install the downloaded update.",
									});
								})
								.finally(() => setInstalling(false));
						}}
						disabled={checking || installing}
					>
						Update and restart
					</Button>
				)}
				{status?.update?.releaseUrl && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => void openUrl(status.update?.releaseUrl ?? "")}
					>
						Change log
					</Button>
				)}
			</div>
		</SettingsRow>
	);
}
