import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
	getCliStatus: vi.fn(),
	getForgeCliStatus: vi.fn(),
	installCli: vi.fn(),
	installForgeCli: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		getCliStatus: apiMocks.getCliStatus,
		getForgeCliStatus: apiMocks.getForgeCliStatus,
		installCli: apiMocks.installCli,
		installForgeCli: apiMocks.installForgeCli,
	};
});

import { CliInstallPanel } from "./cli-install";

describe("CliInstallPanel", () => {
	beforeEach(() => {
		apiMocks.getCliStatus.mockReset();
		apiMocks.getForgeCliStatus.mockReset();
		apiMocks.installCli.mockReset();
		apiMocks.installForgeCli.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("renders the managed install state", async () => {
		apiMocks.getCliStatus.mockResolvedValue({
			installed: true,
			installPath: "/usr/local/bin/helmor-dev",
			buildMode: "development",
			installState: "managed",
		});

		render(<CliInstallPanel />);

		await waitFor(() => {
			expect(screen.getByText(/Installed at/)).toBeInTheDocument();
		});
		expect(screen.getByText("helmor-dev")).toBeInTheDocument();
		expect(screen.getByText("/usr/local/bin/helmor-dev")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Reinstall" }),
		).toBeInTheDocument();
		expect(apiMocks.getForgeCliStatus).not.toHaveBeenCalled();
		expect(
			screen.getByText("No GitLab repositories configured."),
		).toBeInTheDocument();
	});

	it("renders the stale install state and allows reinstall", async () => {
		const user = userEvent.setup();
		apiMocks.getCliStatus.mockResolvedValue({
			installed: true,
			installPath: "/usr/local/bin/helmor",
			buildMode: "release",
			installState: "stale",
		});
		apiMocks.installCli.mockResolvedValue({
			installed: true,
			installPath: "/usr/local/bin/helmor",
			buildMode: "release",
			installState: "managed",
		});

		render(<CliInstallPanel />);

		await waitFor(() => {
			expect(
				screen.getByText(/is not managed by this app/i),
			).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: "Reinstall" }));

		await waitFor(() => {
			expect(apiMocks.installCli).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(screen.getByText(/Installed at/)).toBeInTheDocument();
		});
	});

	it("checks GitLab CLI status for configured GitLab repositories", async () => {
		apiMocks.getCliStatus.mockResolvedValue({
			installed: true,
			installPath: "/usr/local/bin/helmor-dev",
			buildMode: "development",
			installState: "managed",
		});
		apiMocks.getForgeCliStatus.mockResolvedValue({
			status: "ready",
			provider: "gitlab",
			host: "gitlab.example.com",
			cliName: "glab",
			login: "test",
			version: "1.0.0",
			message: "Ready",
		});

		render(
			<CliInstallPanel
				repositories={[
					{
						id: "repo-1",
						name: "Repo",
						remoteUrl: "git@gitlab.example.com:acme/repo.git",
						forgeProvider: "gitlab",
					},
				]}
			/>,
		);

		await waitFor(() => {
			expect(apiMocks.getForgeCliStatus).toHaveBeenCalledWith(
				"gitlab",
				"gitlab.example.com",
			);
		});
		expect(
			await screen.findByText(/Ready for gitlab\.example\.com as test/),
		).toBeInTheDocument();
	});
});
