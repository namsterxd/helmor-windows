import type {
	ActionStatusKind,
	GroupTone,
	InspectorFileStatus,
	WorkspaceBranchTone,
} from "./ui/shared";

/**
 * Mock data fed into the mockup-private `.ui.tsx` primitives. Types come
 * from `./ui/shared` (mockup-private string literals), NOT from
 * `@/lib/api` — that's how we keep the onboarding preview from breaking
 * when production types evolve.
 */

export type MockWorkspaceRow = {
	id: string;
	title: string;
	branch: string;
	repoInitials: string;
	branchTone: WorkspaceBranchTone;
	hasUnread?: boolean;
	isSending?: boolean;
	isSelected?: boolean;
	state?: "active" | "archived";
	status?: "backlog" | "in-progress" | "review" | "done" | "canceled";
};

export type MockWorkspaceGroup = {
	id: string;
	label: string;
	tone: GroupTone;
	rows: MockWorkspaceRow[];
};

export type MockSession = {
	id: string;
	title: string;
	provider: "claude" | "codex";
	active?: boolean;
	unread?: boolean;
	streaming?: boolean;
};

export type MockMessagePart =
	| { type: "reasoning"; label: string }
	| { type: "todo"; items: Array<{ label: string; done?: boolean }> }
	| { type: "tool"; name: string; detail: string }
	| { type: "text"; text: string };

export type MockMessage =
	| { id: string; role: "user"; text: string }
	| { id: string; role: "assistant"; parts: MockMessagePart[] };

export type MockChangeItem = {
	name: string;
	path: string;
	status: InspectorFileStatus;
	insertions?: number;
	deletions?: number;
};

export type MockActionStatus = {
	label: string;
	status: ActionStatusKind;
	action?: string;
};

export const mockSidebar: {
	selectedWorkspaceId: string;
	groups: MockWorkspaceGroup[];
} = {
	selectedWorkspaceId: "workspace-onboarding",
	groups: [
		{
			id: "done",
			label: "Done",
			tone: "done",
			rows: [
				{
					id: "workspace-release",
					title: "Release Notes",
					branch: "release/notes",
					repoInitials: "HE",
					branchTone: "merged",
				},
			],
		},
		{
			id: "review",
			label: "In review",
			tone: "review",
			rows: [
				{
					id: "workspace-pr",
					title: "PR Polish",
					branch: "review/pr-polish",
					repoInitials: "PR",
					branchTone: "open",
					hasUnread: true,
				},
			],
		},
		{
			id: "progress",
			label: "In progress",
			tone: "progress",
			rows: [
				{
					id: "workspace-onboarding",
					title: "Onboarding Flow",
					branch: "feature/onboarding-flow",
					repoInitials: "ON",
					branchTone: "working",
					isSending: true,
					isSelected: true,
				},
				{
					id: "workspace-import",
					title: "Repo Import",
					branch: "feature/import",
					repoInitials: "RI",
					branchTone: "working",
				},
			],
		},
		{
			id: "backlog",
			label: "Backlog",
			tone: "backlog",
			rows: [
				{
					id: "workspace-cli",
					title: "CLI Setup",
					branch: "task/cli-setup",
					repoInitials: "CL",
					branchTone: "inactive",
				},
			],
		},
	],
};

export const mockConversation: {
	branch: string;
	branchTone: WorkspaceBranchTone;
	targetBranch: { remote: string; branch: string };
	sessions: MockSession[];
	messages: MockMessage[];
} = {
	branch: "feature/onboarding-flow",
	branchTone: "working" as WorkspaceBranchTone,
	targetBranch: { remote: "origin", branch: "main" },
	sessions: [
		{
			id: "session-plan",
			title: "Plan onboarding polish",
			provider: "claude",
			active: true,
		},
		{
			id: "session-copy",
			title: "Refine import copy",
			provider: "codex",
			unread: true,
			streaming: true,
		},
	],
	messages: [
		{
			id: "user-1",
			role: "user",
			text: "Make onboarding feel like the real Helmor workspace.",
		},
		{
			id: "assistant-1",
			role: "assistant",
			parts: [
				{ type: "reasoning", label: "Thinking through the layout" },
				{
					type: "todo",
					items: [
						{ label: "Mirror the three-column shell", done: true },
						{ label: "Keep the mockup data-driven", done: true },
						{ label: "Tune the preview scale" },
					],
				},
				{
					type: "tool",
					name: "Edit",
					detail: "src/features/onboarding/mockup/index.tsx",
				},
				{
					type: "text",
					text: "I will keep this isolated from the production workspace and use a compact mock dataset.",
				},
			],
		},
	],
};

export const mockInspector: {
	changes: MockChangeItem[];
	gitActions: MockActionStatus[];
	reviewActions: MockActionStatus[];
} = {
	changes: [
		{
			name: "index.tsx",
			path: "src/features/onboarding/mockup/index.tsx",
			status: "A",
			insertions: 26,
			deletions: 18,
		},
		{
			name: "intro-preview.tsx",
			path: "src/features/onboarding/components/intro-preview.tsx",
			status: "M",
			insertions: 3,
			deletions: 1,
		},
		{
			name: "data.ts",
			path: "src/features/onboarding/mockup/data.ts",
			status: "A",
			insertions: 38,
		},
	],
	gitActions: [
		{ label: "3 changes", status: "pending", action: "Commit" },
		{ label: "Branch unpublished", status: "pending", action: "Push" },
		{ label: "Up to date", status: "success" },
	],
	reviewActions: [{ label: "Waiting for review", status: "pending" }],
};
