import { Check, Download, Loader2, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type CliStatus,
	type ForgeCliStatus,
	getCliStatus,
	getForgeCliStatus,
	installCli,
	installForgeCli,
	type RepositoryCreateOption,
} from "@/lib/api";
import { gitlabHostsForRepositories } from "./cli-install-gitlab-hosts";

const EMPTY_REPOSITORIES: RepositoryCreateOption[] = [];

export function CliInstallPanel({
	repositories = EMPTY_REPOSITORIES,
}: {
	repositories?: RepositoryCreateOption[];
}) {
	const [status, setStatus] = useState<CliStatus | null>(null);
	const [gitlabStatuses, setGitlabStatuses] = useState<ForgeCliStatus[]>([]);
	const [installing, setInstalling] = useState(false);
	const [installingGlab, setInstallingGlab] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [glabError, setGlabError] = useState<string | null>(null);
	const commandName =
		status?.buildMode === "development" ? "helmor-dev" : "helmor";
	const gitlabHosts = useMemo(
		() => gitlabHostsForRepositories(repositories),
		[repositories],
	);

	const loadGitlabStatuses = useCallback(async () => {
		setGlabError(null);
		if (gitlabHosts.length === 0) {
			setGitlabStatuses([]);
			return;
		}
		const results = await Promise.allSettled(
			gitlabHosts.map((host) => getForgeCliStatus("gitlab", host)),
		);
		const statuses = results
			.filter((result): result is PromiseFulfilledResult<ForgeCliStatus> => {
				return result.status === "fulfilled";
			})
			.map((result) => result.value);
		setGitlabStatuses(statuses);
		const errors = results
			.filter((result): result is PromiseRejectedResult => {
				return result.status === "rejected";
			})
			.map((result) =>
				result.reason instanceof Error
					? result.reason.message
					: String(result.reason),
			);
		if (errors.length > 0) setGlabError(errors.join("\n"));
	}, [gitlabHosts]);

	useEffect(() => {
		void getCliStatus().then(setStatus).catch(setError);
		void loadGitlabStatuses();
	}, [loadGitlabStatuses]);

	const handleInstall = useCallback(async () => {
		setInstalling(true);
		setError(null);
		try {
			const result = await installCli();
			setStatus(result);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setInstalling(false);
		}
	}, []);

	const handleInstallGlab = useCallback(async () => {
		setInstallingGlab(true);
		setGlabError(null);
		try {
			const result = await installForgeCli("gitlab");
			setGitlabStatuses([result]);
			await loadGitlabStatuses();
		} catch (e) {
			setGlabError(e instanceof Error ? e.message : String(e));
		} finally {
			setInstallingGlab(false);
		}
	}, [loadGitlabStatuses]);

	const readyGitlabStatuses = gitlabStatuses.filter(
		(item) => item.status === "ready",
	);
	const unauthenticatedGitlabStatuses = gitlabStatuses.filter(
		(item) => item.status === "unauthenticated",
	);
	const errorGitlabStatuses = gitlabStatuses.filter(
		(item) => item.status === "error",
	);
	const missingGitlabStatus = gitlabStatuses.some(
		(item) => item.status === "missing",
	);

	return (
		<div className="space-y-3">
			<div className="rounded-xl border border-border/30 bg-muted/30 px-5 py-4">
				<div className="flex items-center gap-2">
					<Terminal
						className="size-4 text-muted-foreground"
						strokeWidth={1.8}
					/>
					<div className="text-[13px] font-medium leading-snug text-foreground">
						Command Line Tool
					</div>
				</div>
				<div className="mt-1 text-[12px] leading-snug text-muted-foreground">
					Install the{" "}
					<code className="rounded bg-muted px-1 py-0.5 text-[11px]">
						{commandName}
					</code>{" "}
					command as a symlink to this app&apos;s bundled CLI so terminal usage
					tracks desktop updates automatically.{" "}
					{status?.buildMode === "development" ? "Debug" : "Release"} build.
				</div>

				<div className="mt-4">
					{status?.installState === "managed" ? (
						<div className="space-y-3">
							<div className="flex items-center gap-2 text-[12px] text-green-400/90">
								<Check className="size-3.5" strokeWidth={2} />
								<span>
									Installed at{" "}
									<code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
										{status.installPath}
									</code>
								</span>
							</div>
							<Button
								variant="outline"
								size="sm"
								onClick={handleInstall}
								disabled={installing}
							>
								{installing ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<Download className="size-3.5" strokeWidth={1.8} />
								)}
								Reinstall
							</Button>
						</div>
					) : status?.installState === "stale" ? (
						<div className="space-y-3">
							<p className="text-[12px] leading-snug text-amber-400/90">
								Existing CLI install at{" "}
								<code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
									{status.installPath}
								</code>{" "}
								is not managed by this app. Reinstall to point it at the bundled
								CLI.
							</p>
							<Button
								variant="outline"
								size="sm"
								onClick={handleInstall}
								disabled={installing}
							>
								{installing ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<Download className="size-3.5" strokeWidth={1.8} />
								)}
								Reinstall
							</Button>
						</div>
					) : (
						<Button
							variant="outline"
							size="sm"
							onClick={handleInstall}
							disabled={installing}
						>
							{installing ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Download className="size-3.5" strokeWidth={1.8} />
							)}
							Install to /usr/local/bin
						</Button>
					)}

					{error && (
						<p className="mt-2 text-[11px] leading-relaxed text-destructive">
							{error}
						</p>
					)}
				</div>
			</div>

			<div className="rounded-xl border border-border/30 bg-muted/30 px-5 py-4">
				<div className="flex items-center gap-2">
					<Terminal
						className="size-4 text-muted-foreground"
						strokeWidth={1.8}
					/>
					<div className="text-[13px] font-medium leading-snug text-foreground">
						GitLab CLI
					</div>
				</div>
				<div className="mt-1 text-[12px] leading-snug text-muted-foreground">
					Helmor uses{" "}
					<code className="rounded bg-muted px-1 py-0.5 text-[11px]">glab</code>{" "}
					for GitLab and self-hosted GitLab remotes.
				</div>
				<div className="mt-4">
					{gitlabHosts.length === 0 ? (
						<p className="text-[12px] leading-snug text-muted-foreground">
							No GitLab repositories configured.
						</p>
					) : readyGitlabStatuses.length === gitlabStatuses.length &&
						readyGitlabStatuses.length > 0 ? (
						<div className="flex items-start gap-2 text-[12px] text-green-400/90">
							<Check className="size-3.5" strokeWidth={2} />
							<span className="min-w-0">
								Ready for{" "}
								{readyGitlabStatuses
									.map((item) => `${item.host} as ${item.login}`)
									.join(", ")}
							</span>
						</div>
					) : unauthenticatedGitlabStatuses.length > 0 ? (
						<div className="space-y-1 text-[12px] leading-snug text-amber-400/90">
							{unauthenticatedGitlabStatuses.map((item) => (
								<p key={item.host}>
									Run{" "}
									<code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
										{item.loginCommand}
									</code>
								</p>
							))}
						</div>
					) : (
						<Button
							variant="outline"
							size="sm"
							onClick={handleInstallGlab}
							disabled={installingGlab || !missingGitlabStatus}
						>
							{installingGlab ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Download className="size-3.5" strokeWidth={1.8} />
							)}
							Install glab
						</Button>
					)}
					{errorGitlabStatuses.length > 0 && (
						<div className="mt-2 space-y-1 text-[11px] leading-relaxed text-destructive">
							{errorGitlabStatuses.map((item) => (
								<p key={item.host}>
									{item.host}: {item.message}
								</p>
							))}
						</div>
					)}
					{glabError && (
						<p className="mt-2 whitespace-pre-line text-[11px] leading-relaxed text-destructive">
							{glabError}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
