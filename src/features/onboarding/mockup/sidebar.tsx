import { FolderPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mockSidebar } from "./data";
import { humanizeBranch } from "./ui/shared";
import { WorkspaceGroupHeaderUI } from "./ui/workspace-group-header.ui";
import { WorkspaceRowUI } from "./ui/workspace-row.ui";
import { WorkspaceSidebarShellUI } from "./ui/workspace-sidebar.ui";

/**
 * Onboarding mock sidebar — renders the real `WorkspaceSidebarShellUI` /
 * `WorkspaceGroupHeaderUI` / `WorkspaceRowUI` primitives with static mock
 * data. Visual parity with the real sidebar is enforced by sharing the same
 * .ui.tsx components — no hand-rolled JSX here.
 */
export function MockSidebar() {
	return (
		<WorkspaceSidebarShellUI
			headerActions={
				<>
					<Button
						type="button"
						aria-label="Add repository"
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground"
					>
						<FolderPlus className="size-4" strokeWidth={2} />
					</Button>
					<Button
						type="button"
						aria-label="New workspace"
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground"
					>
						<Plus className="size-4" strokeWidth={2.4} />
					</Button>
				</>
			}
		>
			<div className="scrollbar-stable mt-2 min-h-0 flex-1 overflow-hidden px-2 pr-1">
				<div className="space-y-2">
					{mockSidebar.groups.map((group) => (
						<div key={group.id} className="space-y-0.5">
							<WorkspaceGroupHeaderUI
								label={group.label}
								count={group.rows.length}
								tone={group.tone}
								isOpen
								canCollapse
							/>
							{group.rows.map((row) => (
								<div key={row.id} className="pl-2">
									<WorkspaceRowUI
										displayTitle={humanizeBranch(row.branch) ?? row.title}
										repoInitials={row.repoInitials}
										repoName={row.title}
										branchTone={row.branchTone}
										hasUnread={row.hasUnread}
										selected={row.isSelected}
										isSending={row.isSending}
										dataWorkspaceRowId={row.id}
									/>
								</div>
							))}
						</div>
					))}
				</div>
			</div>
		</WorkspaceSidebarShellUI>
	);
}
