import { useQuery } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { workspaceGroupsQueryOptions } from "@/lib/query-client";
import { selectUnreadSessionCount } from "./selector";

/**
 * Drive the macOS Dock badge from the sidebar's workspace groups query cache.
 *
 * The badge count equals the number of sessions that currently have any unread
 * activity (summed across every non-archived workspace). When the count drops
 * to 0 we clear the badge by passing `undefined` to `setBadgeCount`.
 *
 * Design notes:
 * - Read-only against the existing `workspaceGroups` query — no new IPC, no new
 *   event subscription, no mutation of cached data. Every path that already
 *   invalidates this query (opening a workspace, window focus refetch, unread
 *   mutations) drives the badge automatically.
 * - Errors are swallowed so the badge call can never take down the renderer —
 *   on Windows the API is a no-op failure and we intentionally ignore it.
 * - Mount this once at the app shell. It renders nothing.
 */
export function useDockUnreadBadge(): void {
	const { data: groups } = useQuery(workspaceGroupsQueryOptions());
	const count = selectUnreadSessionCount(groups);

	useEffect(() => {
		const win = getCurrentWindow();
		// `undefined` removes the badge on macOS; any positive integer sets it.
		// macOS renders huge numbers itself (99+), so we don't cap here.
		void win.setBadgeCount(count > 0 ? count : undefined).catch(() => {
			// Platforms without dock-badge support (Windows) or a missing
			// capability should never surface as a user-visible error.
		});
	}, [count]);
}
