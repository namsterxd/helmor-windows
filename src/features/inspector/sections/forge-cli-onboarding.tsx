import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GithubBrandIcon, GitlabBrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	type ForgeDetection,
	getWorkspaceForge,
	openForgeCliAuthTerminal,
} from "@/lib/api";
import { FORGE_AUTH_TOOLTIP_LINES } from "@/lib/forge-auth-copy";
import { helmorQueryKeys } from "@/lib/query-client";

const CLI_AUTH_POLL_INTERVAL_MS = 2000;
const CLI_AUTH_POLL_TIMEOUT_MS = 120_000;

export function ForgeCliTrigger({
	detection,
	workspaceId,
	authRequired,
}: {
	detection: ForgeDetection;
	workspaceId: string | null;
	authRequired?: boolean;
}) {
	const queryClient = useQueryClient();
	const [connecting, setConnecting] = useState(false);
	const authPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const connectInFlightRef = useRef(false);

	const clearAuthPoll = useCallback(() => {
		if (authPollTimerRef.current !== null) {
			clearTimeout(authPollTimerRef.current);
			authPollTimerRef.current = null;
		}
	}, []);

	useEffect(() => clearAuthPoll, [clearAuthPoll]);

	const refreshForge = useCallback(async () => {
		if (!workspaceId) {
			return null;
		}
		const nextDetection = await getWorkspaceForge(workspaceId);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceForge(workspaceId),
			nextDetection,
		);
		return nextDetection;
	}, [queryClient, workspaceId]);

	const refreshForgeSurfaces = useCallback(
		async (nextDetection: ForgeDetection) => {
			if (!workspaceId) {
				return;
			}
			queryClient.setQueryData(
				helmorQueryKeys.workspaceForge(workspaceId),
				nextDetection,
			);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceForge(workspaceId),
				}),
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceChangeRequest(workspaceId),
				}),
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceForgeActionStatus(workspaceId),
				}),
			]);
		},
		[queryClient, workspaceId],
	);

	const pollUntilCliReady = useCallback(
		(startedAt = Date.now()) => {
			if (!workspaceId) {
				setConnecting(false);
				connectInFlightRef.current = false;
				return;
			}
			clearAuthPoll();
			authPollTimerRef.current = setTimeout(async () => {
				try {
					const nextDetection = await refreshForge();
					if (nextDetection?.cli?.status === "ready") {
						clearAuthPoll();
						await refreshForgeSurfaces(nextDetection);
						toast.success(`${nextDetection.labels.cliName} connected`);
						setConnecting(false);
						connectInFlightRef.current = false;
						return;
					}
				} catch {
					// Keep polling; auth may still be in progress in Terminal.
				}
				if (Date.now() - startedAt >= CLI_AUTH_POLL_TIMEOUT_MS) {
					clearAuthPoll();
					toast(
						`Finish ${detection.labels.cliName} auth, then click Connect again`,
					);
					setConnecting(false);
					connectInFlightRef.current = false;
					return;
				}
				pollUntilCliReady(startedAt);
			}, CLI_AUTH_POLL_INTERVAL_MS);
		},
		[
			clearAuthPoll,
			detection.labels.cliName,
			refreshForge,
			refreshForgeSurfaces,
			workspaceId,
		],
	);

	const handleConnect = useCallback(async () => {
		if (connecting || connectInFlightRef.current) {
			return;
		}
		connectInFlightRef.current = true;
		clearAuthPoll();
		setConnecting(true);
		try {
			if (detection.cli?.status === "ready") {
				await refreshForgeSurfaces(detection);
				toast.success(`${detection.labels.cliName} connected`);
				setConnecting(false);
				connectInFlightRef.current = false;
				return;
			}
			await openForgeCliAuthTerminal(detection.provider, detection.host);
			toast(`Complete ${detection.labels.cliName} auth in Terminal`);
			pollUntilCliReady();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: `Unable to open ${detection.labels.cliName} auth.`;
			toast.error(message);
			setConnecting(false);
			connectInFlightRef.current = false;
		}
	}, [
		clearAuthPoll,
		connecting,
		detection,
		pollUntilCliReady,
		refreshForgeSurfaces,
	]);

	return (
		<div className="ml-auto flex items-center self-center translate-y-px">
			<Tooltip delayDuration={150}>
				<TooltipTrigger asChild>
					<Button
						type="button"
						size="xs"
						variant="default"
						onClick={() => void handleConnect()}
						disabled={connecting}
						className="gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
					>
						{connecting ? (
							<Loader2 className="size-3 animate-spin text-current" />
						) : detection.provider === "gitlab" ? (
							<GitlabBrandIcon
								size={12}
								className="self-center text-[#FC6D26]"
							/>
						) : (
							<GithubBrandIcon size={12} className="self-center" />
						)}
						{detection.labels.connectAction}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="max-w-xs whitespace-normal">
					<ForgeDetectionTooltipBody
						detection={detection}
						authRequired={authRequired}
					/>
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

function ForgeDetectionTooltipBody({
	detection,
	authRequired,
}: {
	detection: ForgeDetection;
	authRequired?: boolean;
}) {
	const providerName = detection.labels.providerName;
	const host = detection.host ?? "this host";
	const cliStatus = detection.cli;
	const showConnectCopy =
		cliStatus?.status === "unauthenticated" ||
		authRequired === true ||
		!cliStatus;

	return (
		<div className="space-y-1.5">
			<div className="text-[11px] font-medium leading-snug">
				Detected {providerName} at {host}
			</div>
			{showConnectCopy ? (
				<div className="space-y-0.5 text-[10.5px] leading-snug opacity-90">
					{FORGE_AUTH_TOOLTIP_LINES.map((line) => (
						<div key={line}>{line}</div>
					))}
				</div>
			) : cliStatus?.status === "ready" ? (
				<div className="text-[10.5px] leading-snug opacity-90">
					Connected as {cliStatus.login}.
				</div>
			) : null}
			{detection.detectionSignals.length > 0 && (
				<div className="space-y-0.5 border-t border-background/20 pt-1.5 text-[10.5px] leading-snug opacity-90">
					<div className="font-medium">Why we think so:</div>
					<ul className="list-disc space-y-0.5 pl-3.5">
						{detection.detectionSignals.map((signal) => (
							<li key={`${signal.layer}:${signal.detail}`}>{signal.detail}</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
