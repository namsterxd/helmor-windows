import type { ReactNode } from "react";

/**
 * Frozen snapshot of the workspace sidebar shell (outer flex column +
 * traffic-light-safe strip + "Workspaces" title row). Mockup-private —
 * the production sidebar lives in `features/navigation/index.tsx` and
 * is independent.
 *
 * Note: the real production sidebar uses `<TrafficLightSpacer />` which
 * detects platform and only reserves space on macOS. The mockup hardcodes
 * a fixed 94px spacer so the preview looks the same for every viewer.
 */
export function WorkspaceSidebarShellUI({
	headerActions,
	children,
}: {
	headerActions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
			<div
				data-slot="window-safe-top"
				className="flex h-9 shrink-0 items-center pr-3"
			>
				<div className="h-full shrink-0" style={{ width: "94px" }} />
				<div className="h-full flex-1" />
			</div>

			<div className="flex items-center justify-between px-3">
				<h2 className="text-[14px] font-medium tracking-[-0.01em] text-muted-foreground">
					Workspaces
				</h2>
				<div className="flex items-center gap-1 text-muted-foreground">
					{headerActions}
				</div>
			</div>

			{children}
		</div>
	);
}
