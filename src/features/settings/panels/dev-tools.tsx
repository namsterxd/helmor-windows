import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { devResetAllData, loadDataInfo } from "@/lib/api";
import {
	SettingsGroup,
	SettingsNotice,
	SettingsRow,
} from "../components/settings-row";

export function DevToolsPanel() {
	const [dataDir, setDataDir] = useState<string | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void loadDataInfo().then((info) => {
			if (info) setDataDir(info.dataRoot);
		});
	}, []);

	const handleReset = useCallback(async () => {
		setResetting(true);
		setError(null);
		try {
			await devResetAllData();
			// Full page reload to reset all component state (selected
			// workspace/session, settings context, etc.) — query invalidation
			// alone leaves stale useState references.
			window.location.reload();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setResetting(false);
			setConfirmOpen(false);
		}
	}, []);

	return (
		<>
			<SettingsGroup>
				<SettingsRow
					align="start"
					title={
						<span className="flex items-center gap-1.5">
							<Trash2 className="size-3.5 text-destructive" strokeWidth={1.8} />
							<span>Reset All Data</span>
						</span>
					}
					description={
						<>
							Delete all workspaces, sessions, messages, and repositories from
							the development database. Filesystem artefacts (worktrees,
							paste-cache) will also be removed.
							{dataDir ? (
								<SettingsNotice tone="info">
									Data directory:{" "}
									<code className="rounded bg-muted px-1 py-0.5">
										{dataDir}
									</code>
								</SettingsNotice>
							) : null}
							{error ? (
								<SettingsNotice tone="error">{error}</SettingsNotice>
							) : null}
						</>
					}
				>
					<Button
						variant="destructive"
						size="sm"
						onClick={() => {
							setError(null);
							setConfirmOpen(true);
						}}
						disabled={resetting}
					>
						{resetting ? (
							<>
								<Loader2 className="mr-1.5 size-3.5 animate-spin" />
								Resetting...
							</>
						) : (
							"Reset All Dev Data"
						)}
					</Button>
				</SettingsRow>
			</SettingsGroup>

			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title="Confirm Reset"
				description={
					<>
						This will permanently delete{" "}
						<strong>all workspaces, sessions, and repositories</strong> from the
						development database. This action cannot be undone. You can
						re-import from Conductor afterwards.
					</>
				}
				confirmLabel={resetting ? "Resetting..." : "Delete Everything"}
				onConfirm={() => void handleReset()}
				loading={resetting}
			/>
		</>
	);
}
