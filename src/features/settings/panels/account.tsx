import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Loader2, LogOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { GithubBrandIcon, GitlabBrandIcon } from "@/components/brand-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	disconnectGithubIdentity,
	type ForgeProvider,
	type GithubIdentitySession,
	loadGithubIdentitySession,
	openForgeCliAuthTerminal,
	type RepositoryCreateOption,
} from "@/lib/api";
import { forgeCliStatusQueryOptions } from "@/lib/query-client";
import { SettingsGroup, SettingsRow } from "../components/settings-row";
import { gitlabHostsForRepositories } from "./cli-install-gitlab-hosts";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

export function AccountPanel({
	repositories,
	onSignedOut,
}: {
	repositories: RepositoryCreateOption[];
	onSignedOut?: () => void;
}) {
	const queryClient = useQueryClient();
	const [identity, setIdentity] = useState<GithubIdentitySession | null>(null);
	const [signingOut, setSigningOut] = useState(false);
	const gitlabHosts = useMemo(
		() => gitlabHostsForRepositories(repositories),
		[repositories],
	);

	useEffect(() => {
		void loadGithubIdentitySession().then((snap) => {
			if (snap.status === "connected") setIdentity(snap.session);
		});
	}, []);

	const handleSignOut = useCallback(async () => {
		setSigningOut(true);
		try {
			await disconnectGithubIdentity();
			setIdentity(null);
			await queryClient.invalidateQueries();
			onSignedOut?.();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to sign out.",
			);
		} finally {
			setSigningOut(false);
		}
	}, [onSignedOut, queryClient]);

	return (
		<TooltipProvider delayDuration={150}>
			<SettingsGroup>
				{identity ? (
					<IdentityRow
						session={identity}
						onSignOut={() => void handleSignOut()}
						signingOut={signingOut}
					/>
				) : null}
				<CliIntegrationRow
					provider="github"
					host="github.com"
					title="GitHub CLI integration"
					icon={<GithubBrandIcon size={14} />}
				/>
				{gitlabHosts.length > 0
					? gitlabHosts.map((host) => (
							<CliIntegrationRow
								key={host}
								provider="gitlab"
								host={host}
								title={
									gitlabHosts.length > 1
										? `GitLab CLI integration · ${host}`
										: "GitLab CLI integration"
								}
								icon={<GitlabBrandIcon size={14} className="text-[#FC6D26]" />}
							/>
						))
					: null}
			</SettingsGroup>
		</TooltipProvider>
	);
}

function IdentityRow({
	session,
	onSignOut,
	signingOut,
}: {
	session: GithubIdentitySession;
	onSignOut: () => void;
	signingOut: boolean;
}) {
	return (
		<div className="flex items-center gap-3 py-5">
			<Avatar size="lg">
				{session.avatarUrl ? (
					<AvatarImage src={session.avatarUrl} alt={session.login} />
				) : null}
				<AvatarFallback className="bg-muted text-[12px] font-medium text-muted-foreground">
					{session.login.slice(0, 2).toUpperCase()}
				</AvatarFallback>
			</Avatar>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[14px] font-semibold text-foreground">
					{session.name?.trim() || session.login}
				</div>
				{session.primaryEmail ? (
					<div className="truncate text-[12px] text-muted-foreground">
						{session.primaryEmail}
					</div>
				) : null}
				<div className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
					<GithubBrandIcon size={12} />
					<span className="truncate">{session.login}</span>
				</div>
			</div>
			<Button
				variant="ghost"
				size="sm"
				onClick={onSignOut}
				disabled={signingOut}
				className="shrink-0 text-muted-foreground hover:text-foreground"
			>
				{signingOut ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<LogOut className="size-3.5" strokeWidth={1.8} />
				)}
				Sign out
			</Button>
		</div>
	);
}

function CliIntegrationRow({
	provider,
	host,
	title,
	icon,
}: {
	provider: ForgeProvider;
	host: string;
	title: string;
	icon: React.ReactNode;
}) {
	const queryClient = useQueryClient();
	const statusQuery = useQuery(forgeCliStatusQueryOptions(provider, host));
	const status = statusQuery.data ?? null;
	const [connecting, setConnecting] = useState(false);
	const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inFlightRef = useRef(false);

	useEffect(() => {
		return () => {
			if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
		};
	}, []);

	const pollUntilReady = useCallback(
		(startedAt = Date.now()) => {
			if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
			pollTimerRef.current = setTimeout(async () => {
				try {
					const next = await queryClient.fetchQuery(
						forgeCliStatusQueryOptions(provider, host),
					);
					if (next.status === "ready") {
						toast.success(`${next.cliName} connected`);
						setConnecting(false);
						inFlightRef.current = false;
						return;
					}
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: "Failed to read CLI status.",
					);
				}
				if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
					toast("Finish CLI auth in Terminal, then click Connect again.");
					setConnecting(false);
					inFlightRef.current = false;
					return;
				}
				pollUntilReady(startedAt);
			}, POLL_INTERVAL_MS);
		},
		[host, provider, queryClient],
	);

	const handleConnect = useCallback(async () => {
		if (connecting || inFlightRef.current) return;
		inFlightRef.current = true;
		setConnecting(true);
		try {
			await openForgeCliAuthTerminal(provider, host);
			toast("Complete the login in Terminal.");
			pollUntilReady();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to open Terminal.",
			);
			setConnecting(false);
			inFlightRef.current = false;
		}
	}, [connecting, host, pollUntilReady, provider]);

	const isReady = status?.status === "ready";
	const errorMessage =
		status?.status === "error"
			? status.message
			: statusQuery.error instanceof Error
				? statusQuery.error.message
				: null;

	return (
		<SettingsRow
			title={
				<span className="flex items-center gap-1.5">
					{icon}
					<span>{title}</span>
				</span>
			}
		>
			{isReady && status ? (
				<div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
					<CheckCircle2 className="size-3.5 text-green-500" strokeWidth={2} />
					<span className="truncate">{status.login}</span>
				</div>
			) : errorMessage ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label="CLI status error"
							className="cursor-default text-destructive"
						>
							<CircleAlert className="size-4" strokeWidth={2.2} />
						</button>
					</TooltipTrigger>
					<TooltipContent
						side="top"
						className="max-w-xs whitespace-normal text-[11px] leading-snug"
					>
						{errorMessage}
					</TooltipContent>
				</Tooltip>
			) : (
				<Button
					variant="outline"
					size="sm"
					onClick={() => void handleConnect()}
					disabled={connecting || statusQuery.isPending}
				>
					{connecting ? <Loader2 className="size-3.5 animate-spin" /> : null}
					Connect
				</Button>
			)}
		</SettingsRow>
	);
}
