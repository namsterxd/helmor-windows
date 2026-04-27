import {
	resizeTerminal,
	type ScriptEvent,
	spawnTerminal,
	stopTerminal,
	writeTerminalStdin,
} from "@/lib/api";

/**
 * Module-level store for the multi-instance Terminal tab.
 *
 * Mirrors `script-store.ts` in spirit — survives React mount/unmount, replays
 * buffered output to newly-attached listeners — but supports many concurrent
 * shells per workspace (each Terminal sub-tab is one). Setup/Run still go
 * through `script-store.ts`; this file is exclusively for the Terminal tab.
 *
 * Backend keying is `(repoId, "terminal:<instanceId>", workspaceId)`, so
 * different workspaces get fully independent shells, and switching workspaces
 * leaves running shells untouched (the user can come back to them).
 *
 * Persistence: in-memory only. Closing the app drops every sub-tab and its
 * buffer; on next launch every workspace starts with a fresh empty list.
 */

export type TerminalStatus = "running" | "exited";

export type TerminalInstance = {
	id: string;
	title: string;
	chunks: string[];
	bufferedBytes: number;
	truncated: boolean;
	status: TerminalStatus;
	exitCode: number | null;
};

type Listener = {
	onChunk: (data: string) => void;
	onStatusChange: (status: TerminalStatus, exitCode: number | null) => void;
};

type WorkspaceListListener = (instances: TerminalInstance[]) => void;

/**
 * Same cap as the script store. Long-running shells (e.g. a `tail -f`) can
 * easily blow past hundreds of MB if left unbounded; ~2 MB ≈ 20k lines is
 * well beyond xterm's 5000-line scrollback.
 */
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

export const TRUNCATION_NOTICE =
	"\r\n\x1b[2m… earlier output truncated (buffer limit reached) …\x1b[0m\r\n";

/** workspaceId → ordered list of terminals (left-to-right in the sub-tab row). */
const instancesByWorkspace = new Map<string, TerminalInstance[]>();
/** `${workspaceId}:${instanceId}` → live listener (the mounted xterm). */
const listeners = new Map<string, Listener>();
/** workspaceId → listeners watching the sub-tab list itself (for the strip UI). */
const workspaceListListeners = new Map<string, Set<WorkspaceListListener>>();

function listKey(workspaceId: string, instanceId: string) {
	return `${workspaceId}:${instanceId}`;
}

function appendChunk(entry: TerminalInstance, data: string) {
	entry.chunks.push(data);
	entry.bufferedBytes += data.length;
	while (entry.bufferedBytes > MAX_CHUNK_BYTES && entry.chunks.length > 1) {
		const dropped = entry.chunks.shift();
		if (dropped === undefined) break;
		entry.bufferedBytes -= dropped.length;
		entry.truncated = true;
	}
}

function emitListChange(workspaceId: string) {
	const subs = workspaceListListeners.get(workspaceId);
	if (!subs) return;
	const snapshot = [...(instancesByWorkspace.get(workspaceId) ?? [])];
	for (const sub of subs) sub(snapshot);
}

function nextTitle(workspaceId: string): string {
	// "Terminal", "Terminal 2", "Terminal 3", … — scoped per workspace so the
	// numbering resets when you switch contexts.
	const existing = instancesByWorkspace.get(workspaceId) ?? [];
	const used = new Set(existing.map((t) => t.title));
	let i = 1;
	while (true) {
		const candidate = i === 1 ? "Terminal" : `Terminal ${i}`;
		if (!used.has(candidate)) return candidate;
		i++;
	}
}

function makeId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `t-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/** Snapshot of the sub-tab list for the given workspace. */
export function getTerminals(workspaceId: string): TerminalInstance[] {
	return [...(instancesByWorkspace.get(workspaceId) ?? [])];
}

/**
 * Subscribe to changes to the sub-tab list (additions, removals, status
 * flips that affect the visible row). Fires once with the current snapshot
 * after subscription so callers don't need a separate `getTerminals` call.
 */
export function subscribeToWorkspaceList(
	workspaceId: string,
	listener: WorkspaceListListener,
): () => void {
	let set = workspaceListListeners.get(workspaceId);
	if (!set) {
		set = new Set();
		workspaceListListeners.set(workspaceId, set);
	}
	set.add(listener);
	listener([...(instancesByWorkspace.get(workspaceId) ?? [])]);
	return () => {
		const current = workspaceListListeners.get(workspaceId);
		if (!current) return;
		current.delete(listener);
		if (current.size === 0) workspaceListListeners.delete(workspaceId);
	};
}

/**
 * Create a new terminal sub-tab and spawn its shell. Returns the new
 * instance so the caller can immediately mark it as the active sub-tab.
 */
export function createTerminal(
	repoId: string,
	workspaceId: string,
): TerminalInstance {
	const instance: TerminalInstance = {
		id: makeId(),
		title: nextTitle(workspaceId),
		chunks: [],
		bufferedBytes: 0,
		truncated: false,
		status: "running",
		exitCode: null,
	};
	const list = instancesByWorkspace.get(workspaceId) ?? [];
	list.push(instance);
	instancesByWorkspace.set(workspaceId, list);
	emitListChange(workspaceId);

	const k = listKey(workspaceId, instance.id);
	void spawnTerminal(repoId, workspaceId, instance.id, (event: ScriptEvent) => {
		// Drop late events for instances that have been closed and removed.
		const current = instancesByWorkspace
			.get(workspaceId)
			?.find((t) => t.id === instance.id);
		if (!current) return;

		switch (event.type) {
			case "started":
				break;
			case "stdout":
			case "stderr": {
				appendChunk(current, event.data);
				listeners.get(k)?.onChunk(event.data);
				break;
			}
			case "exited": {
				current.status = "exited";
				current.exitCode = event.code;
				const tail = `\r\n\x1b[2m[Process exited with code ${
					event.code ?? "?"
				}]\x1b[0m\r\n`;
				appendChunk(current, tail);
				listeners.get(k)?.onChunk(tail);
				listeners.get(k)?.onStatusChange("exited", event.code);
				emitListChange(workspaceId);
				break;
			}
			case "error": {
				const msg = `\r\n\x1b[31m${event.message}\x1b[0m\r\n`;
				appendChunk(current, msg);
				current.status = "exited";
				current.exitCode = current.exitCode ?? 1;
				listeners.get(k)?.onChunk(msg);
				listeners.get(k)?.onStatusChange("exited", current.exitCode);
				emitListChange(workspaceId);
				break;
			}
		}
	}).catch((err) => {
		const current = instancesByWorkspace
			.get(workspaceId)
			?.find((t) => t.id === instance.id);
		if (!current) return;
		const msg = `\r\n\x1b[31mFailed to start terminal: ${err}\x1b[0m\r\n`;
		appendChunk(current, msg);
		current.status = "exited";
		current.exitCode = current.exitCode ?? 1;
		listeners.get(k)?.onChunk(msg);
		listeners.get(k)?.onStatusChange("exited", current.exitCode);
		emitListChange(workspaceId);
	});

	return instance;
}

/**
 * Stop the shell process and remove the sub-tab from the list. The buffered
 * output is dropped — closing a terminal sub-tab is destructive.
 */
export function closeTerminal(
	repoId: string,
	workspaceId: string,
	instanceId: string,
) {
	const list = instancesByWorkspace.get(workspaceId);
	if (!list) return;
	const idx = list.findIndex((t) => t.id === instanceId);
	if (idx === -1) return;
	const [removed] = list.splice(idx, 1);
	if (list.length === 0) {
		instancesByWorkspace.delete(workspaceId);
	} else {
		instancesByWorkspace.set(workspaceId, list);
	}
	listeners.delete(listKey(workspaceId, instanceId));
	emitListChange(workspaceId);
	// Best-effort SIGTERM; backend silently ignores if the shell already
	// exited (e.g. user typed `exit`).
	if (removed && removed.status === "running") {
		void stopTerminal(repoId, workspaceId, instanceId);
	}
}

/** Attach a live listener to a terminal. Returns the entry for replay, or null. */
export function attach(
	workspaceId: string,
	instanceId: string,
	listener: Listener,
): TerminalInstance | null {
	listeners.set(listKey(workspaceId, instanceId), listener);
	return (
		instancesByWorkspace.get(workspaceId)?.find((t) => t.id === instanceId) ??
		null
	);
}

export function detach(workspaceId: string, instanceId: string) {
	listeners.delete(listKey(workspaceId, instanceId));
}

export function writeStdin(
	repoId: string,
	workspaceId: string,
	instanceId: string,
	data: string,
) {
	void writeTerminalStdin(repoId, workspaceId, instanceId, data);
}

export function resize(
	repoId: string,
	workspaceId: string,
	instanceId: string,
	cols: number,
	rows: number,
) {
	void resizeTerminal(repoId, workspaceId, instanceId, cols, rows);
}

/** Test-only reset. */
export function _resetForTesting() {
	instancesByWorkspace.clear();
	listeners.clear();
	workspaceListListeners.clear();
}
