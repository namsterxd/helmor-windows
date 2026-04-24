import { ExternalLink } from "lucide-react";
import { GithubBrandIcon, GitlabBrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import {
	type CommitButtonState,
	WorkspaceCommitButton,
	type WorkspaceCommitButtonMode,
} from "@/features/commit/button";
import type {
	ChangeRequestInfo,
	ForgeActionStatus,
	ForgeDetection,
} from "@/lib/api";
import { useMinDisplayDuration } from "@/lib/use-min-display-duration";
import { cn } from "@/lib/utils";
import {
	getGitSectionHeaderHighlightClass,
	INSPECTOR_SECTION_HEADER_CLASS,
	INSPECTOR_SECTION_TITLE_CLASS,
} from "../layout";
import { ForgeCliTrigger } from "./forge-cli-onboarding";

const SHIMMER_MIN_DISPLAY_MS = 1500;

export type GitSectionHeaderProps = {
	commitButtonMode: WorkspaceCommitButtonMode;
	commitButtonState?: CommitButtonState;
	changeRequest: ChangeRequestInfo | null;
	hasChanges?: boolean;
	/**
	 * Whether change request data is currently being (re)fetched. Drives the bottom
	 * shimmer bar. Gated by a min display duration so fast responses don't
	 * flicker.
	 */
	isRefreshing?: boolean;
	changeRequestName?: string;
	forgeRemoteState?: ForgeActionStatus["remoteState"] | null;
	/**
	 * Full forge classification for the current workspace. When CLI setup
	 * needs attention, we swap the Create PR button for one forge connect CTA.
	 */
	forgeDetection?: ForgeDetection | null;
	workspaceId?: string | null;
	onChangeRequestClick?: () => void;
	onCommit?: () => void | Promise<void>;
	className?: string;
};

export function GitSectionHeader({
	commitButtonMode,
	commitButtonState,
	changeRequest,
	hasChanges = false,
	isRefreshing = false,
	changeRequestName = "PR",
	forgeRemoteState = null,
	forgeDetection = null,
	workspaceId = null,
	onChangeRequestClick,
	onCommit,
	className,
}: GitSectionHeaderProps) {
	const gitHeaderHighlightClass =
		getGitSectionHeaderHighlightClass(commitButtonMode);

	const showShimmer = useMinDisplayDuration(
		isRefreshing,
		SHIMMER_MIN_DISPLAY_MS,
	);

	const cliStatus = forgeDetection?.cli ?? null;
	const cliNeedsAttention =
		cliStatus?.status === "missing" ||
		cliStatus?.status === "unauthenticated" ||
		forgeRemoteState === "unauthenticated";
	const showForgeOnboarding = cliNeedsAttention && forgeDetection !== null;
	const showButton =
		hasChanges ||
		commitButtonState === "busy" ||
		commitButtonMode !== "create-pr" ||
		showForgeOnboarding;
	const isMergeRequest = forgeDetection?.provider === "gitlab";
	const showChangeRequest = changeRequest !== null && !showForgeOnboarding;

	return (
		<div
			className={cn(
				INSPECTOR_SECTION_HEADER_CLASS,
				"relative overflow-hidden rounded-tr-[16px]",
				"transition-[background-color,border-color,color,box-shadow] duration-300 ease-out",
				showForgeOnboarding ? null : gitHeaderHighlightClass,
				className,
			)}
		>
			{showShimmer && (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 bottom-0 h-px motion-safe:animate-[shine_2s_infinite_linear]"
					style={{
						backgroundImage:
							"linear-gradient(90deg, transparent 0%, transparent 35%, color-mix(in oklch, var(--color-primary) 50%, transparent) 50%, transparent 65%, transparent 100%)",
						backgroundSize: "300% 100%",
					}}
				/>
			)}
			<div className="flex min-w-0 items-center gap-1.5">
				{!showChangeRequest ? (
					<span className={cn(INSPECTOR_SECTION_TITLE_CLASS, "translate-y-px")}>
						Git
					</span>
				) : (
					<Button
						type="button"
						variant="outline"
						size="xs"
						className={cn(
							"self-center translate-y-px bg-transparent font-normal tracking-[0.01em] transition-[background-color,border-color,color,box-shadow,opacity] duration-300 ease-out hover:bg-transparent hover:opacity-80",
							(commitButtonMode === "fix" || commitButtonMode === "closed") &&
								"border-[var(--workspace-pr-closed-accent)] text-[var(--workspace-pr-closed-accent)] hover:text-[var(--workspace-pr-closed-accent)]",
							commitButtonMode === "resolve-conflicts" &&
								"border-[var(--workspace-pr-conflicts-accent)] text-[var(--workspace-pr-conflicts-accent)] hover:text-[var(--workspace-pr-conflicts-accent)]",
							commitButtonMode === "merge" &&
								"border-[var(--workspace-pr-open-accent)] text-[var(--workspace-pr-open-accent)] hover:text-[var(--workspace-pr-open-accent)]",
							commitButtonMode === "merged" &&
								"border-[var(--workspace-pr-merged-accent)] text-[var(--workspace-pr-merged-accent)] hover:text-[var(--workspace-pr-merged-accent)]",
						)}
						onClick={onChangeRequestClick}
					>
						<span className="inline-flex items-center gap-1.5 leading-none">
							{isMergeRequest ? (
								<GitlabBrandIcon size={12} className="self-center" />
							) : (
								<GithubBrandIcon size={12} className="self-center" />
							)}
							<span className="inline-flex items-center leading-none tabular-nums text-sm font-light">
								{isMergeRequest ? "!" : "#"}
								{changeRequest.number}
							</span>
							<ExternalLink
								size={12}
								strokeWidth={2}
								className="shrink-0 self-center"
							/>
						</span>
					</Button>
				)}
			</div>
			{showButton &&
				(showForgeOnboarding ? (
					<ForgeCliTrigger
						detection={forgeDetection}
						workspaceId={workspaceId}
						authRequired={forgeRemoteState === "unauthenticated"}
					/>
				) : (
					<WorkspaceCommitButton
						mode={commitButtonMode}
						state={commitButtonState}
						changeRequestName={changeRequestName}
						className="ml-auto self-center translate-y-px"
						onCommit={onCommit}
					/>
				))}
		</div>
	);
}
