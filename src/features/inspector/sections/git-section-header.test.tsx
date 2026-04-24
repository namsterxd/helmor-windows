import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeRequestInfo, ForgeDetection } from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { renderWithProviders } from "@/test/render-with-providers";
import { GitSectionHeader } from "./git-section-header";

const apiMocks = vi.hoisted(() => ({
	getWorkspaceForge: vi.fn(),
	installForgeCli: vi.fn(),
	openForgeCliAuthTerminal: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();

	return {
		...actual,
		getWorkspaceForge: apiMocks.getWorkspaceForge,
		installForgeCli: apiMocks.installForgeCli,
		openForgeCliAuthTerminal: apiMocks.openForgeCliAuthTerminal,
	};
});

const changeRequest: ChangeRequestInfo = {
	url: "https://gitlab.com/helmor/helmor/-/merge_requests/182",
	number: 182,
	state: "OPEN",
	title: "Add GitLab forge support",
	isMerged: false,
};

function gitlabDetection(patch: Partial<ForgeDetection> = {}): ForgeDetection {
	return {
		provider: "gitlab",
		host: "gitlab.com",
		namespace: "helmor",
		repo: "helmor",
		remoteUrl: "git@gitlab.com:helmor/helmor.git",
		labels: {
			providerName: "GitLab",
			cliName: "glab",
			changeRequestName: "MR",
			changeRequestFullName: "merge request",
			installAction: "Install glab",
			connectAction: "Connect GitLab",
		},
		cli: {
			status: "missing",
			provider: "gitlab",
			host: "gitlab.com",
			cliName: "glab",
			message: "glab is not installed.",
			installCommand: "brew install glab",
		},
		detectionSignals: [],
		...patch,
	};
}

function githubDetection(patch: Partial<ForgeDetection> = {}): ForgeDetection {
	return {
		provider: "github",
		host: "github.com",
		namespace: "helmor",
		repo: "helmor",
		remoteUrl: "git@github.com:helmor/helmor.git",
		labels: {
			providerName: "GitHub",
			cliName: "gh",
			changeRequestName: "PR",
			changeRequestFullName: "pull request",
			installAction: "Install gh",
			connectAction: "Connect GitHub",
		},
		cli: {
			status: "missing",
			provider: "github",
			host: "github.com",
			cliName: "gh",
			message: "GitHub CLI is not installed.",
			installCommand: "brew install gh",
		},
		detectionSignals: [],
		...patch,
	};
}

function expectElementBefore(first: Element, second: Element) {
	expect(
		first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
}

describe("GitSectionHeader forge onboarding", () => {
	beforeEach(() => {
		apiMocks.getWorkspaceForge.mockReset();
		apiMocks.installForgeCli.mockReset();
		apiMocks.openForgeCliAuthTerminal.mockReset();
		apiMocks.installForgeCli.mockResolvedValue(null);
		apiMocks.openForgeCliAuthTerminal.mockResolvedValue(undefined);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("shows a single connect CTA without also showing the MR pill", () => {
		renderWithProviders(
			<GitSectionHeader
				commitButtonMode="merge"
				commitButtonState="idle"
				changeRequest={changeRequest}
				changeRequestName="MR"
				forgeDetection={gitlabDetection()}
				workspaceId="workspace-1"
			/>,
		);

		const title = screen.getByText("Git");
		const connectButton = screen.getByRole("button", {
			name: "Connect GitLab",
		});

		expect(title).toBeInTheDocument();
		expect(connectButton).toBeInTheDocument();
		expect(screen.queryByLabelText(/Why do we think/)).not.toBeInTheDocument();
		expectElementBefore(title, connectButton);
		expect(screen.queryByText("!182")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Merge" }),
		).not.toBeInTheDocument();
	});

	it("shows CLI connect without also showing the MR pill", () => {
		renderWithProviders(
			<GitSectionHeader
				commitButtonMode="merge"
				commitButtonState="idle"
				changeRequest={changeRequest}
				changeRequestName="MR"
				forgeDetection={gitlabDetection({
					cli: {
						status: "ready",
						provider: "gitlab",
						host: "gitlab.com",
						cliName: "glab",
						login: "liangeqiang",
						version: "1.55.0",
						message: "Connected.",
					},
				})}
				forgeRemoteState="unauthenticated"
				workspaceId="workspace-1"
			/>,
		);

		const title = screen.getByText("Git");
		const connectButton = screen.getByRole("button", {
			name: "Connect GitLab",
		});

		expect(title).toBeInTheDocument();
		expect(connectButton).toBeInTheDocument();
		expect(screen.queryByLabelText(/Why do we think/)).not.toBeInTheDocument();
		expectElementBefore(title, connectButton);
		expect(screen.queryByText("!182")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Merge" }),
		).not.toBeInTheDocument();
	});

	it("refreshes MR and forge status after Terminal auth becomes ready", async () => {
		vi.useFakeTimers();
		const unauthenticatedDetection = gitlabDetection({
			cli: {
				status: "unauthenticated",
				provider: "gitlab",
				host: "gitlab.com",
				cliName: "glab",
				version: "1.55.0",
				message: "Run `glab auth login --hostname gitlab.com`.",
				loginCommand: "glab auth login --hostname gitlab.com",
			},
		});
		const readyDetection = gitlabDetection({
			cli: {
				status: "ready",
				provider: "gitlab",
				host: "gitlab.com",
				cliName: "glab",
				login: "liangeqiang",
				version: "1.55.0",
				message: "Connected.",
			},
		});
		apiMocks.getWorkspaceForge.mockResolvedValueOnce(readyDetection);

		const { queryClient } = renderWithProviders(
			<GitSectionHeader
				commitButtonMode="merge"
				commitButtonState="idle"
				changeRequest={changeRequest}
				changeRequestName="MR"
				forgeDetection={unauthenticatedDetection}
				workspaceId="workspace-1"
			/>,
		);
		const invalidateQueries = vi
			.spyOn(queryClient, "invalidateQueries")
			.mockResolvedValue(undefined);

		fireEvent.click(screen.getByRole("button", { name: "Connect GitLab" }));

		await vi.advanceTimersByTimeAsync(0);
		expect(apiMocks.openForgeCliAuthTerminal).toHaveBeenCalledWith(
			"gitlab",
			"gitlab.com",
		);
		await vi.advanceTimersByTimeAsync(2000);

		expect(apiMocks.getWorkspaceForge).toHaveBeenCalledTimes(1);
		expect(
			queryClient.getQueryData(helmorQueryKeys.workspaceForge("workspace-1")),
		).toEqual(readyDetection);
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: helmorQueryKeys.workspaceForge("workspace-1"),
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: helmorQueryKeys.workspaceChangeRequest("workspace-1"),
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: helmorQueryKeys.workspaceForgeActionStatus("workspace-1"),
		});
	});

	it("does not open duplicate auth terminals on repeated connect clicks", async () => {
		const unauthenticatedDetection = gitlabDetection({
			cli: {
				status: "unauthenticated",
				provider: "gitlab",
				host: "gitlab.com",
				cliName: "glab",
				version: "1.55.0",
				message: "Run `glab auth login --hostname gitlab.com`.",
				loginCommand: "glab auth login --hostname gitlab.com",
			},
		});
		apiMocks.getWorkspaceForge.mockResolvedValue(unauthenticatedDetection);

		renderWithProviders(
			<GitSectionHeader
				commitButtonMode="merge"
				commitButtonState="idle"
				changeRequest={changeRequest}
				changeRequestName="MR"
				forgeDetection={unauthenticatedDetection}
				workspaceId="workspace-1"
			/>,
		);

		const connectButton = screen.getByRole("button", {
			name: "Connect GitLab",
		});
		fireEvent.click(connectButton);
		fireEvent.click(connectButton);

		await waitFor(() => {
			expect(apiMocks.openForgeCliAuthTerminal).toHaveBeenCalledTimes(1);
		});
	});

	it("installs a missing CLI and completes when cached auth is ready", async () => {
		const readyDetection = gitlabDetection({
			cli: {
				status: "ready",
				provider: "gitlab",
				host: "gitlab.com",
				cliName: "glab",
				login: "liangeqiang",
				version: "1.55.0",
				message: "Connected.",
			},
		});
		apiMocks.installForgeCli.mockResolvedValue(readyDetection.cli);
		apiMocks.getWorkspaceForge.mockResolvedValue(readyDetection);

		const { queryClient } = renderWithProviders(
			<GitSectionHeader
				commitButtonMode="merge"
				commitButtonState="idle"
				changeRequest={changeRequest}
				changeRequestName="MR"
				forgeDetection={gitlabDetection()}
				workspaceId="workspace-1"
			/>,
		);
		const invalidateQueries = vi
			.spyOn(queryClient, "invalidateQueries")
			.mockResolvedValue(undefined);

		fireEvent.click(screen.getByRole("button", { name: "Connect GitLab" }));

		await waitFor(() => {
			expect(apiMocks.installForgeCli).toHaveBeenCalledWith("gitlab");
		});
		expect(apiMocks.getWorkspaceForge).toHaveBeenCalledWith("workspace-1");
		expect(apiMocks.openForgeCliAuthTerminal).not.toHaveBeenCalled();
		expect(
			queryClient.getQueryData(helmorQueryKeys.workspaceForge("workspace-1")),
		).toEqual(readyDetection);
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: helmorQueryKeys.workspaceChangeRequest("workspace-1"),
		});
	});

	it("uses the same connect CTA for GitHub onboarding", async () => {
		const readyDetection = githubDetection({
			cli: {
				status: "ready",
				provider: "github",
				host: "github.com",
				cliName: "gh",
				login: "octocat",
				version: "2.49.0",
				message: "Connected.",
			},
		});
		apiMocks.installForgeCli.mockResolvedValue(readyDetection.cli);
		apiMocks.getWorkspaceForge.mockResolvedValue(readyDetection);

		renderWithProviders(
			<GitSectionHeader
				commitButtonMode="merge"
				commitButtonState="idle"
				changeRequest={changeRequest}
				changeRequestName="PR"
				forgeDetection={githubDetection()}
				workspaceId="workspace-1"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));

		await waitFor(() => {
			expect(apiMocks.installForgeCli).toHaveBeenCalledWith("github");
		});
		expect(apiMocks.openForgeCliAuthTerminal).not.toHaveBeenCalled();
	});
});
