import type { WorkspaceCommitButtonMode } from "@/features/commit/button";
import type { ForgeDetection, RepoPreferences } from "@/lib/api";
import {
	type RepoPreferenceKey,
	resolveRepoPreferencePrompt,
	resolveRepoPreferencePromptWithDefault,
} from "@/lib/repo-preferences-prompts";

type ActionSessionMode = Exclude<
	WorkspaceCommitButtonMode,
	"push" | "merge" | "closed" | "merged"
>;

const ACTION_MODE_TO_PREFERENCE_KEY: Record<
	ActionSessionMode,
	RepoPreferenceKey
> = {
	"create-pr": "createPr",
	"commit-and-push": "createPr",
	fix: "fixErrors",
	"resolve-conflicts": "resolveConflicts",
	"open-pr": "createPr",
};

export function buildCommitButtonPrompt(
	mode: ActionSessionMode,
	repoPreferences?: RepoPreferences | null,
	forge?: ForgeDetection | null,
): string {
	if (forge?.provider === "gitlab") {
		return buildGitLabCommitButtonPrompt(mode, repoPreferences);
	}

	switch (mode) {
		case "commit-and-push":
			return `Commit and push all uncommitted work in this workspace.

Do the following, in order:
1. Run \`git status\` and \`git diff\` to survey what's changed.
2. Stage everything that should ship with \`git add\`.
3. Commit with a concise, Conventional-Commits-style message (\`feat:\`, \`fix:\`, \`refactor:\`, etc.) summarizing the change.
4. Push the current branch to its remote. If needed, create the remote tracking branch with \`git push -u <remote> HEAD\`.
5. Report the resulting commit SHA and pushed ref.

Don't stop to ask for confirmation — execute each step automatically. If a pre-commit / pre-push hook fails, report the failure and stop without force-pushing.`;
		case "open-pr":
			return `Reopen the closed pull request for this branch and leave a short comment explaining why it's being reopened.

Use \`gh pr reopen\` + \`gh pr comment\`. Report the PR URL when done.`;
		default:
			return resolveRepoPreferencePrompt({
				key: ACTION_MODE_TO_PREFERENCE_KEY[mode],
				repoPreferences,
			});
	}
}

function buildGitLabCommitButtonPrompt(
	mode: ActionSessionMode,
	repoPreferences?: RepoPreferences | null,
): string {
	switch (mode) {
		case "commit-and-push":
			return buildCommitButtonPrompt(mode, repoPreferences);
		case "open-pr":
			return `Reopen the closed merge request for this branch and leave a short comment explaining why it's being reopened.

Use \`glab mr reopen\` + \`glab mr note\`. Report the MR URL when done.`;
		case "fix":
			return resolveRepoPreferencePromptWithDefault({
				key: "fixErrors",
				repoPreferences,
				defaultPrompt: `GitLab CI is failing on the current branch. Diagnose and fix it.

Do the following, in order:
1. Use \`glab ci list\` / \`glab ci view\` to inspect the most recent failing pipeline for this branch. Read the logs for each failing job.
2. Identify the root cause. Explain your diagnosis briefly before making changes.
3. Apply the minimum set of changes needed to get CI green. Run the relevant tests / linters locally to confirm.
4. Commit the fix with a clear \`fix(ci): …\` message and push to the same branch so CI re-runs.
5. Report what was broken, what you changed, and whether the re-run is passing.`,
			});
		case "create-pr":
			return resolveRepoPreferencePromptWithDefault({
				key: "createPr",
				repoPreferences,
				defaultPrompt: `Create a merge request for the uncommitted work in this workspace.

Do the following, in order:
1. Run \`git status\` and \`git diff\` to survey what's changed.
2. Stage everything that should ship with \`git add\`.
3. Commit with a concise, Conventional-Commits-style message (\`feat:\`, \`fix:\`, \`refactor:\`, \`chore:\`, etc.) that summarizes the change in one line.
4. Push the current branch to its remote. If needed, create the remote tracking branch with \`git push -u <remote> HEAD\`.
5. Open a merge request against the repository's default branch using \`glab mr create\`. Use a clear MR title and a body that explains: what changed, why it changed, and any follow-up / test notes.
6. Report the MR URL in your final message so I can click it.

Don't stop to ask for confirmation — execute each step automatically. If you hit an unrecoverable error (e.g. merge conflict, pre-push hook failure), report it clearly so I can intervene.`,
			});
		case "resolve-conflicts":
			return resolveRepoPreferencePrompt({
				key: "resolveConflicts",
				repoPreferences,
			});
	}
}

export function isActionSessionMode(
	mode: WorkspaceCommitButtonMode,
): mode is ActionSessionMode {
	return (
		mode in ACTION_MODE_TO_PREFERENCE_KEY ||
		mode === "commit-and-push" ||
		mode === "open-pr"
	);
}

export function describeActionKind(actionKind: string): string {
	switch (actionKind) {
		case "create-pr":
			return "Create PR";
		case "commit-and-push":
			return "Commit and Push";
		case "fix":
			return "Fix CI";
		case "push":
			return "Push";
		case "resolve-conflicts":
			return "Resolve Conflicts";
		case "merge":
			return "Merge";
		case "open-pr":
			return "Open PR";
		case "merged":
			return "Merged";
		case "closed":
			return "Closed";
		default:
			return actionKind;
	}
}
