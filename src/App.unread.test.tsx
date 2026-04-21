import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
	loadWorkspaceGroups: vi.fn(),
	loadArchivedWorkspaces: vi.fn(),
	loadAgentModelSections: vi.fn(),
	loadWorkspaceDetail: vi.fn(),
	loadWorkspaceSessions: vi.fn(),
	loadSessionThreadMessages: vi.fn(),
	loadSessionAttachments: vi.fn(),
	markWorkspaceRead: vi.fn(),
	markSessionRead: vi.fn(),
	markSessionUnread: vi.fn(),
}));

const unreadRuntime = vi.hoisted(() => ({
	workspaceUnread: 0,
	unreadSessionCount: 1,
	sessionUnreadCount: 2,
	emitSessionCompleted: false,
	completedSessionId: "session-2",
	completedWorkspaceId: "workspace-unread",
}));

vi.mock("./App.css", () => ({}));

vi.mock("@/features/conversation", () => ({
	WorkspaceConversationContainer: ({
		onSessionCompleted,
	}: {
		onSessionCompleted?: (sessionId: string, workspaceId: string) => void;
	}) => {
		useEffect(() => {
			if (!unreadRuntime.emitSessionCompleted) return;
			onSessionCompleted?.(
				unreadRuntime.completedSessionId,
				unreadRuntime.completedWorkspaceId,
			);
		}, [onSessionCompleted]);

		return <div data-testid="mock-conversation" />;
	},
}));

vi.mock("./lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./lib/api")>();

	return {
		...actual,
		loadWorkspaceGroups: apiMocks.loadWorkspaceGroups,
		loadArchivedWorkspaces: apiMocks.loadArchivedWorkspaces,
		loadAgentModelSections: apiMocks.loadAgentModelSections,
		loadWorkspaceDetail: apiMocks.loadWorkspaceDetail,
		loadWorkspaceSessions: apiMocks.loadWorkspaceSessions,
		loadSessionMessages: apiMocks.loadSessionThreadMessages,
		loadSessionThreadMessages: apiMocks.loadSessionThreadMessages,
		loadSessionAttachments: apiMocks.loadSessionAttachments,
		markWorkspaceRead: apiMocks.markWorkspaceRead,
		markSessionRead: apiMocks.markSessionRead,
		markSessionUnread: apiMocks.markSessionUnread,
	};
});

import App from "./App";

describe("App unread lifecycle", () => {
	beforeEach(() => {
		unreadRuntime.workspaceUnread = 0;
		unreadRuntime.unreadSessionCount = 1;
		unreadRuntime.sessionUnreadCount = 2;
		unreadRuntime.emitSessionCompleted = false;
		unreadRuntime.completedSessionId = "session-2";
		unreadRuntime.completedWorkspaceId = "workspace-unread";

		apiMocks.loadWorkspaceGroups.mockReset();
		apiMocks.loadArchivedWorkspaces.mockReset();
		apiMocks.loadAgentModelSections.mockReset();
		apiMocks.loadWorkspaceDetail.mockReset();
		apiMocks.loadWorkspaceSessions.mockReset();
		apiMocks.loadSessionThreadMessages.mockReset();
		apiMocks.loadSessionAttachments.mockReset();
		apiMocks.markWorkspaceRead.mockReset();
		apiMocks.markSessionRead.mockReset();
		apiMocks.markSessionUnread.mockReset();

		apiMocks.loadWorkspaceGroups.mockImplementation(async () => [
			{
				id: "progress",
				label: "In progress",
				tone: "progress",
				rows: [
					{
						id: "workspace-unread",
						title: "Unread workspace",
						repoName: "helmor-core",
						state: "ready",
						hasUnread:
							unreadRuntime.workspaceUnread > 0 ||
							unreadRuntime.unreadSessionCount > 0,
						workspaceUnread: unreadRuntime.workspaceUnread,
						unreadSessionCount: unreadRuntime.unreadSessionCount,
					},
				],
			},
		]);
		apiMocks.loadArchivedWorkspaces.mockResolvedValue([]);
		apiMocks.loadAgentModelSections.mockResolvedValue([]);
		apiMocks.loadWorkspaceDetail.mockImplementation(async () => ({
			id: "workspace-unread",
			title: "Unread workspace",
			repoId: "repo-1",
			repoName: "helmor-core",
			directoryName: "workspace-unread",
			state: "ready",
			hasUnread:
				unreadRuntime.workspaceUnread > 0 ||
				unreadRuntime.unreadSessionCount > 0,
			workspaceUnread: unreadRuntime.workspaceUnread,
			unreadSessionCount: unreadRuntime.unreadSessionCount,
			derivedStatus: "in-progress",
			manualStatus: null,
			activeSessionId: "session-1",
			activeSessionTitle: "Unread session",
			activeSessionAgentType: "claude",
			activeSessionStatus: "idle",
			branch: "main",
			initializationParentBranch: null,
			intendedTargetBranch: null,
			notes: null,
			pinnedAt: null,
			prTitle: null,
			prDescription: null,
			archiveCommit: null,
			sessionCount: 1,
			messageCount: 0,
			attachmentCount: 0,
		}));
		apiMocks.loadWorkspaceSessions.mockImplementation(async () => [
			{
				id: "session-1",
				workspaceId: "workspace-unread",
				title: "Unread session",
				agentType: "claude",
				status: "idle",
				model: "gpt-5.4",
				permissionMode: "default",
				providerSessionId: null,
				unreadCount: unreadRuntime.sessionUnreadCount,
				contextTokenCount: 0,
				contextUsedPercent: null,
				thinkingEnabled: false,
				codexThinkingLevel: null,
				fastMode: false,
				agentPersonality: null,
				createdAt: "2026-04-03T00:00:00Z",
				updatedAt: "2026-04-03T00:00:00Z",
				lastUserMessageAt: null,
				resumeSessionAt: null,
				isHidden: false,
				isCompacting: false,
				active: true,
			},
		]);
		apiMocks.loadSessionThreadMessages.mockResolvedValue([]);
		apiMocks.loadSessionAttachments.mockResolvedValue([]);
		apiMocks.markWorkspaceRead.mockImplementation(async () => {
			unreadRuntime.workspaceUnread = 0;
			unreadRuntime.unreadSessionCount = 0;
			unreadRuntime.sessionUnreadCount = 0;
		});
		apiMocks.markSessionRead.mockImplementation(async () => {
			unreadRuntime.sessionUnreadCount = 0;
			unreadRuntime.unreadSessionCount = 0;
			unreadRuntime.workspaceUnread = 0;
		});
		apiMocks.markSessionUnread.mockImplementation(async () => {
			unreadRuntime.unreadSessionCount = 1;
			unreadRuntime.sessionUnreadCount = 1;
			// Backend's sync_workspace_unread mirrors this onto the workspace
			// flag; reflect it here so tests see the same shape.
			unreadRuntime.workspaceUnread = 1;
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("clears the displayed session's unread but never bulk-clears the workspace", async () => {
		render(<App />);

		await waitFor(() => {
			expect(apiMocks.markSessionRead).toHaveBeenCalledWith("session-1");
		});
		// Selecting a workspace must NOT trigger the bulk workspace clear —
		// only opening individual sessions clears them, one at a time.
		expect(apiMocks.markWorkspaceRead).not.toHaveBeenCalled();
	});

	it("re-fetches workspace groups after clearing a session so the sidebar / dock badge clear", async () => {
		render(<App />);

		await waitFor(() => {
			expect(apiMocks.markSessionRead).toHaveBeenCalledWith("session-1");
		});

		// The workspace must be re-fetched after the IPC succeeds, AND that
		// fresh fetch must reflect the cleared session (otherwise the sidebar
		// dot stays). We pin both: that loadWorkspaceGroups was invoked at
		// least twice (initial + post-invalidate) AND the latest result is
		// hasUnread=false.
		await waitFor(() => {
			expect(apiMocks.loadWorkspaceGroups.mock.calls.length).toBeGreaterThan(1);
		});

		const lastResult = apiMocks.loadWorkspaceGroups.mock.results.at(-1);
		await expect(lastResult?.value).resolves.toEqual([
			{
				id: "progress",
				label: "In progress",
				tone: "progress",
				rows: [
					expect.objectContaining({
						id: "workspace-unread",
						hasUnread: false,
						workspaceUnread: 0,
						unreadSessionCount: 0,
					}),
				],
			},
		]);
	});

	it("marks a background-completed session as unread", async () => {
		unreadRuntime.workspaceUnread = 0;
		unreadRuntime.unreadSessionCount = 0;
		unreadRuntime.sessionUnreadCount = 0;
		unreadRuntime.emitSessionCompleted = true;

		render(<App />);

		await waitFor(() => {
			expect(apiMocks.markSessionUnread).toHaveBeenCalledWith("session-2");
		});
	});
});
