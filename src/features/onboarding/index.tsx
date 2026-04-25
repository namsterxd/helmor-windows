import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { TrafficLightSpacer } from "@/components/chrome/traffic-light-spacer";
import { ConductorOnboarding } from "@/components/conductor-onboarding";
import { CloneFromUrlDialog } from "@/features/navigation/clone-from-url-dialog";
import {
	addRepositoryFromLocalPath,
	cloneRepositoryFromUrl,
	enterOnboardingWindowMode,
	exitOnboardingWindowMode,
	loadAddRepositoryDefaults,
} from "@/lib/api";
import { describeUnknownError } from "@/lib/workspace-helpers";
import { checkAgentLoginItems } from "./agent-login-state";
import { IntroPreview } from "./components/intro-preview";
import { AgentLoginStep } from "./steps/agent-login-step";
import { RepoImportStep } from "./steps/repo-import-step";
import { RepositoryCliStep } from "./steps/repository-cli-step";
import { SkillsStep } from "./steps/skills-step";
import type { ImportedRepository, OnboardingStep } from "./types";
import { basename, repositoryNameFromUrl } from "./utils";

type AppOnboardingProps = {
	onComplete: () => void;
};

export function AppOnboarding({ onComplete }: AppOnboardingProps) {
	const [step, setStep] = useState<OnboardingStep>("intro");
	const [loginItems, setLoginItems] = useState(() => checkAgentLoginItems());
	const [isRoutingImport, setIsRoutingImport] = useState(false);
	const [importedRepositories, setImportedRepositories] = useState<
		ImportedRepository[]
	>([]);
	const [githubImportProgress, setGithubImportProgress] = useState<
		number | null
	>(null);
	const [isAddingLocalRepository, setIsAddingLocalRepository] = useState(false);
	const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
	const [cloneDefaultDirectory, setCloneDefaultDirectory] = useState<
		string | null
	>(null);
	const [repoImportError, setRepoImportError] = useState<string | null>(null);

	const refreshLoginItems = useCallback(() => {
		setLoginItems(checkAgentLoginItems());
	}, []);

	useEffect(() => {
		window.addEventListener("focus", refreshLoginItems);
		return () => {
			window.removeEventListener("focus", refreshLoginItems);
		};
	}, [refreshLoginItems]);

	useEffect(() => {
		void enterOnboardingWindowMode();
		return () => {
			void exitOnboardingWindowMode();
		};
	}, []);

	const handleSkillsNext = useCallback(() => {
		if (isRoutingImport) {
			return;
		}
		setIsRoutingImport(true);
		// Temporary hardcoded route for tuning the default repository import screen.
		setStep("repoImport");
		setIsRoutingImport(false);
	}, [isRoutingImport]);

	const rememberImportedRepository = useCallback(
		({
			name,
			source,
			detail,
		}: {
			name: string;
			source: ImportedRepository["source"];
			detail: string;
		}) => {
			setImportedRepositories((current) => [
				{
					id: `${source}-${Date.now()}-${current.length}`,
					name,
					source,
					detail,
				},
				...current,
			]);
		},
		[],
	);

	const addLocalRepository = useCallback(async () => {
		if (isAddingLocalRepository) {
			return;
		}
		setIsAddingLocalRepository(true);
		setRepoImportError(null);
		try {
			const defaults = await loadAddRepositoryDefaults();
			const selection = await open({
				directory: true,
				multiple: false,
				defaultPath: defaults.lastCloneDirectory ?? undefined,
			});
			const selectedPath = Array.isArray(selection) ? selection[0] : selection;
			if (!selectedPath) {
				return;
			}
			await addRepositoryFromLocalPath(selectedPath);
			rememberImportedRepository({
				name: basename(selectedPath),
				source: "local",
				detail: selectedPath,
			});
		} catch (error) {
			setRepoImportError(
				describeUnknownError(error, "Unable to add repository."),
			);
		} finally {
			setIsAddingLocalRepository(false);
		}
	}, [isAddingLocalRepository, rememberImportedRepository]);

	const openCloneDialog = useCallback(() => {
		setCloneDialogOpen(true);
		setRepoImportError(null);
		void loadAddRepositoryDefaults()
			.then((defaults) => {
				setCloneDefaultDirectory(defaults.lastCloneDirectory ?? null);
			})
			.catch(() => {
				setCloneDefaultDirectory(null);
			});
	}, []);

	const handleCloneFromUrl = useCallback(
		async (args: { gitUrl: string; cloneDirectory: string }) => {
			setGithubImportProgress(0);
			let progress = 0;
			const interval = window.setInterval(() => {
				progress = Math.min(progress + 12, 92);
				setGithubImportProgress(progress);
			}, 180);
			try {
				await cloneRepositoryFromUrl(args);
				window.clearInterval(interval);
				setGithubImportProgress(100);
				window.setTimeout(() => setGithubImportProgress(null), 280);
				setCloneDefaultDirectory(args.cloneDirectory);
				rememberImportedRepository({
					name: repositoryNameFromUrl(args.gitUrl),
					source: "github",
					detail: args.gitUrl,
				});
			} catch (error) {
				window.clearInterval(interval);
				setGithubImportProgress(null);
				throw error;
			}
		},
		[rememberImportedRepository],
	);

	const completeOnboarding = useCallback(() => {
		setStep("completeTransition");
		window.setTimeout(onComplete, 1100);
	}, [onComplete]);

	if (step === "conductor") {
		return <ConductorOnboarding onComplete={onComplete} />;
	}

	return (
		<main
			aria-label="Helmor onboarding"
			className="relative h-screen overflow-hidden bg-background font-sans text-foreground antialiased"
		>
			<div
				aria-label="Helmor onboarding drag region"
				className="absolute inset-x-0 top-0 z-20 flex h-11 items-center"
			>
				<TrafficLightSpacer side="left" width={94} />
				<div data-tauri-drag-region className="h-full flex-1" />
				<TrafficLightSpacer side="right" width={140} />
			</div>

			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-background via-background/80 to-transparent"
			/>

			<IntroPreview
				step={step}
				onNext={() => {
					setStep("agents");
				}}
			/>
			<AgentLoginStep
				step={step}
				loginItems={loginItems}
				onNext={() => {
					setStep("corner");
				}}
			/>
			<RepositoryCliStep
				step={step}
				onNext={() => {
					setStep("skills");
				}}
			/>
			<SkillsStep
				step={step}
				onNext={() => {
					void handleSkillsNext();
				}}
				isRoutingImport={isRoutingImport}
			/>
			<RepoImportStep
				step={step}
				importedRepositories={importedRepositories}
				githubImportProgress={githubImportProgress}
				isAddingLocalRepository={isAddingLocalRepository}
				repoImportError={repoImportError}
				onAddLocalRepository={addLocalRepository}
				onOpenCloneDialog={openCloneDialog}
				onComplete={completeOnboarding}
			/>
			<CloneFromUrlDialog
				open={cloneDialogOpen}
				onOpenChange={setCloneDialogOpen}
				defaultCloneDirectory={cloneDefaultDirectory}
				onSubmit={handleCloneFromUrl}
			/>
		</main>
	);
}
