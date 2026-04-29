import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type AgentLoginProvider,
	type AgentLoginStatusResult,
	getAgentLoginStatus,
	type LoginShell,
} from "@/lib/api";
import { type AppSettings, useSettings } from "@/lib/settings";
import { AgentStatusAction } from "../components/agent-status-action";
import { LoginTerminalPreview } from "../components/login-terminal-preview";
import type { AgentLoginItem, OnboardingStep } from "../types";

export function AgentLoginStep({
	step,
	loginItems,
	onBack,
	onNext,
	onRefreshLoginItems,
}: {
	step: OnboardingStep;
	loginItems: AgentLoginItem[];
	onBack: () => void;
	onNext: () => void;
	onRefreshLoginItems: () => void;
}) {
	const { settings, updateSettings } = useSettings();
	const [primedLoginProvider, setPrimedLoginProvider] =
		useState<AgentLoginProvider | null>(null);
	const [activeLoginProvider, setActiveLoginProvider] =
		useState<AgentLoginProvider | null>(null);
	const [loginInstanceId, setLoginInstanceId] = useState<string | null>(null);
	const [waitingProvider, setWaitingProvider] =
		useState<AgentLoginProvider | null>(null);
	const [activeLoginShell, setActiveLoginShell] = useState<LoginShell>(
		providerShell("codex", settings),
	);
	const terminalProvider = activeLoginProvider ?? primedLoginProvider;
	const terminalActive = activeLoginProvider !== null;

	const pollLoginReady = useCallback(
		async (provider: AgentLoginProvider, shell: LoginShell) => {
			for (let attempt = 0; attempt < 12; attempt += 1) {
				const status = await getAgentLoginStatus(true).catch(() => null);
				onRefreshLoginItems();
				if (agentReadyForShell(status, provider, shell)) {
					setPrimedLoginProvider(provider);
					setActiveLoginProvider(null);
					setWaitingProvider((current) =>
						current === provider ? null : current,
					);
					return true;
				}
				await new Promise((resolve) => window.setTimeout(resolve, 1_500));
			}
			setWaitingProvider((current) => (current === provider ? null : current));
			return false;
		},
		[onRefreshLoginItems],
	);

	const startLogin = useCallback(
		async (provider: AgentLoginProvider, shell: LoginShell) => {
			setWaitingProvider(provider);
			void updateSettings(
				provider === "codex"
					? { codexAgentTarget: shell }
					: { claudeAgentTarget: shell },
			);
			const status = await getAgentLoginStatus().catch(() => null);
			onRefreshLoginItems();
			if (agentReadyForShell(status, provider, shell)) {
				setPrimedLoginProvider(provider);
				setActiveLoginProvider(null);
				setWaitingProvider((current) => (current === provider ? null : current));
				return;
			}
			setPrimedLoginProvider(provider);
			setActiveLoginProvider(provider);
			setActiveLoginShell(shell);
			setLoginInstanceId(crypto.randomUUID());
		},
		[onRefreshLoginItems, updateSettings],
	);

	const handleTerminalExit = useCallback(
		(code: number | null) => {
			onRefreshLoginItems();
			if (activeLoginProvider) {
				void pollLoginReady(activeLoginProvider, activeLoginShell);
				return;
			}
			if (code !== 0) {
				setWaitingProvider((current) =>
					current === activeLoginProvider ? null : current,
				);
			}
		},
		[activeLoginProvider, activeLoginShell, onRefreshLoginItems, pollLoginReady],
	);

	const handleTerminalError = useCallback(() => {
		setWaitingProvider(null);
	}, []);

	return (
		<section
			aria-label="Agent login"
			aria-hidden={step !== "agents"}
			className={`absolute inset-x-0 top-[calc(50vh-40px)] z-20 flex origin-top flex-col items-center px-8 pb-12 pt-8 transition-transform duration-1000 ease-[cubic-bezier(.22,.82,.2,1)] ${
				step === "corner"
					? "pointer-events-none -translate-x-[50vw] translate-y-[126vh] opacity-100"
					: step === "agents"
						? "translate-x-0 translate-y-0 scale-100 opacity-100"
						: "pointer-events-none translate-x-[22vw] translate-y-[64vh] scale-[0.7] opacity-100"
			}`}
		>
			<div className="relative w-full max-w-[1180px]">
				<div
					className={`transition-all duration-700 ease-[cubic-bezier(.22,.82,.2,1)] ${
						terminalActive
							? "ml-0 w-1/2 max-w-[540px]"
							: "ml-[230px] w-full max-w-[720px]"
					}`}
				>
					<h2 className="text-3xl font-semibold tracking-normal text-foreground">
						Log in to your agents
					</h2>
					<p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
						Helmor uses your local Claude Code and Codex login sessions. You can
						log in now, or continue and log in later.
					</p>

					<div className="mt-7 flex w-full flex-col gap-3">
						{loginItems.map(
							({
								icon: Icon,
								provider,
								label,
								description,
								status,
								windowsReady,
								wslReady,
							}) => (
								<div
									key={label}
									className="flex min-h-20 items-center gap-3 rounded-lg border border-border/55 bg-card px-4 py-3"
								>
									<div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background text-foreground">
										<Icon className="size-5" />
									</div>
									<div className="min-w-0 flex-1">
										<div className="text-sm font-medium text-foreground">
											{label}
										</div>
										<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
											{description}
										</p>
									</div>
									<AgentStatusAction
										provider={provider}
										status={status}
										selectedShell={providerShell(provider, settings)}
										targetReady={
											providerShell(provider, settings) === "wsl"
												? Boolean(wslReady)
												: Boolean(windowsReady)
										}
										waiting={waitingProvider === provider}
										onPrimeLogin={setPrimedLoginProvider}
										onStartLogin={startLogin}
									/>
								</div>
							),
						)}
					</div>

					<div className="mt-7 flex items-center gap-3">
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
							className="h-11 gap-2 px-4 text-[0.95rem]"
						>
							Next
							<ArrowRight data-icon="inline-end" className="size-4" />
						</Button>
					</div>
				</div>

				<LoginTerminalPreview
					provider={terminalProvider}
					instanceId={loginInstanceId}
					active={terminalActive}
					shell={activeLoginShell}
					onExit={handleTerminalExit}
					onError={handleTerminalError}
				/>
			</div>
		</section>
	);
}

function providerShell(
	provider: AgentLoginProvider,
	settings: AppSettings,
): LoginShell {
	return provider === "codex"
		? settings.codexAgentTarget
		: settings.claudeAgentTarget;
}

function agentReadyForShell(
	status: AgentLoginStatusResult | null,
	provider: AgentLoginProvider,
	shell: LoginShell,
) {
	if (!status) return false;
	if (provider === "codex") {
		return shell === "wsl" ? Boolean(status.codexWsl) : status.codex;
	}
	return shell === "wsl" ? Boolean(status.claudeWsl) : status.claude;
}
