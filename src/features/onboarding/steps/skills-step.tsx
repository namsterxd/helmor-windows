import {
	ArrowLeft,
	ArrowRight,
	Layers,
	PackageCheck,
	Terminal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HelmorSkillsStatus, LoginShell } from "@/lib/api";
import {
	getCliStatus,
	getHelmorSkillsStatus,
	installCli,
	installHelmorSkills,
} from "@/lib/api";
import { describeUnknownError } from "@/lib/workspace-helpers";
import { SetupItem } from "../components/setup-item";
import type { OnboardingStep } from "../types";

export function SkillsStep({
	step,
	onBack,
	onNext,
	isRoutingImport,
}: {
	step: OnboardingStep;
	onBack: () => void;
	onNext: () => void;
	isRoutingImport: boolean;
}) {
	const [isInstallingCli, setIsInstallingCli] = useState(false);
	const [cliInstalled, setCliInstalled] = useState(false);
	const [cliInstallError, setCliInstallError] = useState<string | null>(null);
	const [isInstallingSkills, setIsInstallingSkills] = useState(false);
	const [skillsStatus, setSkillsStatus] = useState<HelmorSkillsStatus | null>(
		null,
	);
	const [skillsInstallError, setSkillsInstallError] = useState<string | null>(
		null,
	);

	useEffect(() => {
		let cancelled = false;
		void Promise.all([getCliStatus(), getHelmorSkillsStatus()])
			.then(([cliStatus, skillsStatus]) => {
				if (!cancelled) {
					setCliInstalled(cliStatus.installState === "managed");
					setSkillsStatus(skillsStatus);
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleInstallCli = useCallback(
		async (shell: LoginShell) => {
			if (isInstallingCli) {
				return;
			}
			setIsInstallingCli(true);
			setCliInstallError(null);
			try {
				const status = await installCli(shell);
				setCliInstalled(status.installState === "managed");
				toast("Helmor CLI installed.");
			} catch (error) {
				setCliInstallError(
					describeUnknownError(error, "Unable to install CLI."),
				);
			} finally {
				setIsInstallingCli(false);
			}
		},
		[isInstallingCli],
	);

	const handleInstallSkills = useCallback(
		async (shell: LoginShell) => {
			if (isInstallingSkills) {
				return;
			}
			setIsInstallingSkills(true);
			setSkillsInstallError(null);
			try {
				const status = await installHelmorSkills(shell);
				setSkillsStatus(status);
				toast("Helmor skills installed.");
			} catch (error) {
				setSkillsInstallError(
					describeUnknownError(error, "Unable to install Helmor skills."),
				);
			} finally {
				setIsInstallingSkills(false);
			}
		},
		[isInstallingSkills],
	);

	return (
		<section
			aria-label="MCP and skills setup"
			aria-hidden={step !== "skills"}
			className={`absolute left-[calc(30vw-260px)] top-8 z-30 w-[520px] transition-all duration-1000 ease-[cubic-bezier(.22,.82,.2,1)] ${
				step === "skills"
					? "translate-x-0 translate-y-0 opacity-100"
					: step === "repoImport"
						? "pointer-events-none translate-x-0 translate-y-0 opacity-0"
						: step === "conductorTransition" || step === "completeTransition"
							? "pointer-events-none scale-[1.08] opacity-0 blur-sm"
							: "pointer-events-none -translate-x-[118vw] translate-y-[55vh] opacity-100"
			}`}
		>
			<div className="flex flex-col items-center">
				<div className="group relative -mt-2 mb-6 h-[220px] w-[420px]">
					<div className="absolute left-10 top-0 h-32 w-[340px] rotate-[-5deg] rounded-lg border border-border/55 bg-card p-4 shadow-2xl shadow-black/20 transition-transform duration-500 ease-[cubic-bezier(.22,.82,.2,1)] group-hover:-translate-x-3 group-hover:-translate-y-6 group-hover:rotate-[-8deg]">
						<div className="flex items-center gap-2">
							<Terminal className="size-4 text-muted-foreground" />
							<div className="h-3 w-24 rounded-full bg-foreground/16" />
						</div>
						<div className="mt-5 grid gap-2">
							<div className="h-2 rounded-full bg-foreground/10" />
							<div className="h-2 w-4/5 rounded-full bg-foreground/10" />
							<div className="h-2 w-2/3 rounded-full bg-foreground/10" />
						</div>
					</div>
					<div className="absolute left-[30px] top-16 h-32 w-[360px] rotate-[3deg] rounded-lg border border-border/60 bg-card p-4 shadow-2xl shadow-black/25 transition-transform duration-500 ease-[cubic-bezier(.22,.82,.2,1)] group-hover:translate-x-4 group-hover:-translate-y-3 group-hover:rotate-[5deg]">
						<div className="flex items-center gap-2">
							<Layers className="size-4 text-muted-foreground" />
							<div className="h-3 w-28 rounded-full bg-foreground/18" />
						</div>
						<div className="mt-5 grid grid-cols-3 gap-2">
							<div className="h-14 rounded-md bg-foreground/8" />
							<div className="h-14 rounded-md bg-foreground/12" />
							<div className="h-14 rounded-md bg-foreground/8" />
						</div>
					</div>
					<div className="absolute left-5 top-[88px] h-36 w-[380px] rotate-[-1deg] overflow-hidden rounded-lg border border-border/65 bg-card shadow-2xl shadow-black/30 transition-transform duration-500 ease-[cubic-bezier(.22,.82,.2,1)] group-hover:translate-y-2 group-hover:rotate-0">
						<div className="flex h-8 items-center gap-1.5 border-b border-border/55 bg-background px-3">
							<span className="size-2 rounded-full bg-muted-foreground/35" />
							<span className="size-2 rounded-full bg-muted-foreground/25" />
							<span className="size-2 rounded-full bg-muted-foreground/20" />
							<span className="ml-2 text-[10px] font-medium text-muted-foreground">
								helmor --help
							</span>
						</div>
						<div className="h-[calc(100%-2rem)] overflow-hidden px-4 py-3 font-mono text-[9.5px] leading-[13px] text-muted-foreground group-hover:overflow-y-auto">
							<pre className="whitespace-pre-wrap break-words font-mono">
								<span className="text-foreground">$ helmor --help</span>
								{`
Remote-control Helmor from the terminal.
Works against the same SQLite database the desktop app uses.

Usage: helmor [OPTIONS] <COMMAND>

Commands:
  data         Data directory, database, and mode info
  settings     App settings stored in settings table
  repo         Repository registration and configuration
  workspace    Workspace CRUD, branching, syncing, archiving
  session      Session CRUD and inspection
  files        File listing, reading, writing, staging
  send         Send a prompt to an AI agent
  models       List available AI models
  github       GitHub integration - auth, PR lookup, merge
  scripts      Inspect repo-level setup/run/archive scripts
  conductor    Migrate from Helmor v1 (Conductor)
  completions  Shell completion scripts
  cli-status   Report whether helmor is installed to PATH
  quit         Ask a running Helmor app to quit
  mcp          Run as an MCP server over stdio
  help         Print this message

Options:
  --json            Emit JSON
  --quiet           Reduce output
  --data-dir <DIR>  Override the data directory
  -h, --help        Print help
  -V, --version     Print version`}
							</pre>
						</div>
					</div>
				</div>

				<div className="w-full text-center">
					<h2 className="text-3xl font-semibold tracking-normal text-foreground">
						Power up Helmor
					</h2>
					<p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
						Install the CLI and skills so Helmor can split work, run agents,
						call tools, and carry context across your workspaces.
					</p>
				</div>

				<div className="mt-5 grid w-full gap-2">
					<SetupItem
						icon={<Terminal className="size-5" />}
						label="Helmor CLI"
						description="Control Helmor from your terminal: create workspaces, send prompts, inspect files, and script repeatable flows."
						actionLabel={isInstallingCli ? "Installing" : "Set up"}
						action={
							<LoginShellMenu
								label={isInstallingCli ? "Installing" : "Set up"}
								disabled={isInstallingCli}
								onSelect={handleInstallCli}
							/>
						}
						busy={isInstallingCli}
						ready={cliInstalled}
						error={cliInstallError}
					/>
					<SetupItem
						icon={<PackageCheck className="size-5" />}
						label="Helmor Skills (Beta)"
						description="Install skills so Helmor can help with more workflows across every workspace."
						actionLabel={isInstallingSkills ? "Installing" : "Set up"}
						action={
							<SkillsAction
								windowsReady={Boolean(skillsStatus?.windowsInstalled)}
								wslReady={Boolean(skillsStatus?.wslInstalled)}
								label={isInstallingSkills ? "Installing" : "Set up"}
								disabled={isInstallingSkills}
								onSelect={handleInstallSkills}
							/>
						}
						busy={isInstallingSkills}
						ready={false}
						error={skillsInstallError}
					/>
				</div>

				<div className="mt-5 flex items-center justify-center gap-3">
					<Button
						type="button"
						variant="ghost"
						size="lg"
						onClick={onBack}
						className="h-11 gap-2 px-4 text-[0.95rem]"
					>
						<ArrowLeft data-icon="inline-start" className="size-4" />
						Back
					</Button>
					<Button
						type="button"
						size="lg"
						onClick={onNext}
						disabled={isRoutingImport}
						className="h-11 gap-2 px-4 text-[0.95rem]"
					>
						Next
						<ArrowRight data-icon="inline-end" className="size-4" />
					</Button>
				</div>
			</div>
		</section>
	);
}

function SkillsAction({
	windowsReady,
	wslReady,
	label,
	disabled,
	onSelect,
}: {
	windowsReady: boolean;
	wslReady: boolean;
	label: string;
	disabled: boolean;
	onSelect: (shell: LoginShell) => void;
}) {
	const hasReadyTarget = windowsReady || wslReady;
	return (
		<div className="flex shrink-0 items-center gap-2">
			<div className="flex items-center gap-1.5">
				{windowsReady ? <TargetReadyStatus label="Windows" /> : null}
				{wslReady ? <TargetReadyStatus label="WSL" /> : null}
			</div>
			<LoginShellMenu
				label={hasReadyTarget ? "Add target" : label}
				disabled={disabled}
				onSelect={onSelect}
			/>
		</div>
	);
}

function TargetReadyStatus({ label }: { label: string }) {
	return (
		<span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-300">
			<span className="size-1.5 rounded-full bg-emerald-400" />
			Ready for {label}
		</span>
	);
}

function LoginShellMenu({
	label,
	disabled,
	onSelect,
}: {
	label: string;
	disabled: boolean;
	onSelect: (shell: LoginShell) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild disabled={disabled}>
				<Button type="button" size="sm" className="h-7 shrink-0 px-2 text-xs">
					{label}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" sideOffset={4} className="min-w-32">
				<DropdownMenuItem onClick={() => onSelect("powershell")}>
					Windows agents
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onSelect("wsl")}>
					WSL agents
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
