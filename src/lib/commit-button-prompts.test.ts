import { describe, expect, it } from "vitest";
import type { ForgeDetection } from "./api";
import { buildCommitButtonPrompt } from "./commit-button-prompts";

const GITLAB_FORGE: ForgeDetection = {
	provider: "gitlab",
	host: "gitlab.example.com",
	namespace: "acme",
	repo: "repo",
	remoteUrl: "git@gitlab.example.com:acme/repo.git",
	labels: {
		providerName: "GitLab",
		cliName: "glab",
		changeRequestName: "MR",
		changeRequestFullName: "merge request",
		connectAction: "Connect GitLab",
	},
	cli: null,
	detectionSignals: [],
};

describe("buildCommitButtonPrompt", () => {
	it("appends create-pr preferences after the built-in prompt", () => {
		expect(
			buildCommitButtonPrompt(
				"create-pr",
				{
					createPr: "Always include rollout notes.",
				},
				"release/next",
			),
		).toContain("### User Preferences\n\nAlways include rollout notes.");
	});

	it("passes the target branch into create-pr prompts", () => {
		expect(buildCommitButtonPrompt("create-pr", {}, "release/next")).toContain(
			"gh pr create --base release/next",
		);
	});

	it("passes the target branch into resolve-conflicts prompts", () => {
		expect(
			buildCommitButtonPrompt("resolve-conflicts", {}, "release/next"),
		).toContain(
			"This branch has merge conflicts with `release/next`, this workspace's target branch.",
		);
	});

	it("appends fix-errors preferences after the built-in prompt", () => {
		expect(
			buildCommitButtonPrompt("fix", {
				fixErrors: "Run targeted tests before broad suites.",
			}),
		).toContain(
			"### User Preferences\n\nRun targeted tests before broad suites.",
		);
	});

	it("uses GitLab merge request creation instructions", () => {
		const prompt = buildCommitButtonPrompt(
			"create-pr",
			null,
			null,
			GITLAB_FORGE,
		);

		expect(prompt).toContain("Create a merge request");
		expect(prompt).toContain("`glab mr create`");
		expect(prompt).not.toContain("`gh pr create`");
	});

	it("uses GitLab CI inspection instructions for fix mode", () => {
		const prompt = buildCommitButtonPrompt("fix", null, null, GITLAB_FORGE);

		expect(prompt).toContain("GitLab CI is failing");
		expect(prompt).toContain("`glab ci list` / `glab ci view`");
	});

	it("uses GitLab reopen instructions for open-pr mode", () => {
		const prompt = buildCommitButtonPrompt("open-pr", null, null, GITLAB_FORGE);

		expect(prompt).toContain("Reopen the closed merge request");
		expect(prompt).toContain("`glab mr reopen` + `glab mr note`");
	});

	it("appends create-pr preferences after the GitLab prompt", () => {
		const prompt = buildCommitButtonPrompt(
			"create-pr",
			{ createPr: "Mention deployment order." },
			null,
			GITLAB_FORGE,
		);

		expect(prompt).toContain("`glab mr create`");
		expect(prompt).toContain(
			"### User Preferences\n\nMention deployment order.",
		);
	});
});
