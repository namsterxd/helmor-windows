import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type TerminalHandle,
	TerminalOutput,
} from "@/components/terminal-output";
import { cn } from "@/lib/utils";
import {
	attach,
	closeTerminal,
	createTerminal,
	detach,
	resize,
	subscribeToWorkspaceList,
	type TerminalInstance,
	TRUNCATION_NOTICE,
	writeStdin,
} from "../terminal-store";

type TerminalTabProps = {
	repoId: string | null;
	workspaceId: string | null;
	isActive: boolean;
};

/**
 * Multi-instance Terminal tab. Each sub-tab owns one PTY-backed xterm; the
 * sub-tab strip plus a "+" button let the user open additional shells in the
 * same workspace. Closed sub-tabs SIGTERM their shell and drop the buffer.
 *
 * Cross-workspace isolation is implicit: the store keys instances by
 * workspaceId, so switching workspaces shows that workspace's own list (which
 * may be empty). The shells in other workspaces keep running and re-appear
 * when the user navigates back.
 *
 * Auto-spawn: whenever the user activates this tab in a workspace with no
 * live terminals (initial visit, or after closing the last one), we
 * immediately spawn one — the user never sees an empty CTA. The spawn is
 * guarded so React 19 strict-mode double-effect doesn't create two shells.
 */
export function TerminalTab({
	repoId,
	workspaceId,
	isActive,
}: TerminalTabProps) {
	const [instances, setInstances] = useState<TerminalInstance[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);

	// Resubscribe whenever the workspace changes — the active sub-tab id is
	// reset by the subscription callback (it falls back to the first existing
	// instance for the new workspace, or null if none).
	useEffect(() => {
		if (!workspaceId) {
			setInstances([]);
			setActiveId(null);
			return;
		}
		return subscribeToWorkspaceList(workspaceId, (next) => {
			setInstances(next);
			setActiveId((current) => {
				if (current && next.some((t) => t.id === current)) return current;
				return next.length > 0 ? next[0].id : null;
			});
		});
	}, [workspaceId]);

	const canSpawn = !!repoId && !!workspaceId;

	const handleAdd = useCallback(() => {
		if (!repoId || !workspaceId) return;
		const next = createTerminal(repoId, workspaceId);
		setActiveId(next.id);
	}, [repoId, workspaceId]);

	const handleClose = useCallback(
		(id: string) => {
			if (!repoId || !workspaceId) return;
			closeTerminal(repoId, workspaceId, id);
		},
		[repoId, workspaceId],
	);

	// Auto-spawn the first terminal whenever the tab is activated in a
	// workspace with zero shells. The ref guard makes the effect safe under
	// React strict-mode double-invoke and prevents a second auto-spawn when
	// `instances.length` flips back to 0 in the same active session.
	const autoSpawnedRef = useRef(false);
	useEffect(() => {
		if (!isActive || !canSpawn) {
			autoSpawnedRef.current = false;
			return;
		}
		if (instances.length > 0) {
			autoSpawnedRef.current = false;
			return;
		}
		if (autoSpawnedRef.current) return;
		autoSpawnedRef.current = true;
		handleAdd();
	}, [isActive, canSpawn, instances.length, handleAdd]);

	// Visibility nonce — bumped each time the outer Terminal tab transitions
	// from inactive to active. The active sub-tab body uses it as a useEffect
	// dependency to force an xterm refit, defending against renderer state
	// loss while the body was invisible.
	const [visibilityNonce, setVisibilityNonce] = useState(0);
	const wasActiveRef = useRef(isActive);
	useEffect(() => {
		if (isActive && !wasActiveRef.current) {
			setVisibilityNonce((n) => n + 1);
		}
		wasActiveRef.current = isActive;
	}, [isActive]);

	return (
		<div
			id="inspector-panel-terminal"
			role="tabpanel"
			aria-labelledby="inspector-tab-terminal"
			className={cn(
				"relative flex min-h-0 flex-1 flex-col",
				// Hide via class only (no `hidden` attribute, which interacts
				// poorly with Tailwind's `flex` class). Inactive tabs are layered
				// over the panel, but invisible + non-interactive, so xterm
				// buffers and PTY listeners stay healthy across outer tab
				// switches.
				!isActive && "pointer-events-none invisible absolute inset-0 opacity-0",
			)}
		>
			<TerminalSubTabStrip
				instances={instances}
				activeId={activeId}
				onSelect={setActiveId}
				onClose={handleClose}
				onAdd={handleAdd}
				canSpawn={canSpawn}
			/>

			{/* Bodies stack in a single grid cell so xterm dimensions stay
			    stable regardless of which sub-tab is active. Switching sub-tabs
			    only flips visibility — no remount, no replay, no fit thrash. */}
			<div className="relative grid min-h-0 flex-1 grid-cols-[100%] grid-rows-[100%]">
				{instances.map((t) => (
					<TerminalSubTabBody
						key={t.id}
						repoId={repoId}
						workspaceId={workspaceId}
						instance={t}
						active={t.id === activeId}
						visibilityNonce={visibilityNonce}
					/>
				))}
			</div>
		</div>
	);
}

type SubTabStripProps = {
	instances: TerminalInstance[];
	activeId: string | null;
	onSelect: (id: string) => void;
	onClose: (id: string) => void;
	onAdd: () => void;
	canSpawn: boolean;
};

/**
 * Horizontal sub-tab strip. The scroll container hides its scrollbar
 * (vertically and horizontally — the row is fixed-height so the only
 * direction that ever needs scrolling is horizontal). When tabs overflow
 * horizontally, an inset shadow on the right edge of the scroll area
 * signals there's more out of view; once scrolled to the end, the shadow
 * fades out.
 */
function TerminalSubTabStrip({
	instances,
	activeId,
	onSelect,
	onClose,
	onAdd,
	canSpawn,
}: SubTabStripProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [showRightShadow, setShowRightShadow] = useState(false);

	const updateShadow = useCallback(() => {
		const el = scrollRef.current;
		if (!el) {
			setShowRightShadow(false);
			return;
		}
		const overflowed = el.scrollWidth > el.clientWidth + 1;
		const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
		setShowRightShadow(overflowed && !atEnd);
	}, []);

	useEffect(() => {
		updateShadow();
		const el = scrollRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => updateShadow());
		ro.observe(el);
		return () => ro.disconnect();
	}, [updateShadow, instances.length]);

	return (
		<div className="relative flex shrink-0 items-stretch border-b border-border/60 bg-muted/15">
			<div
				ref={scrollRef}
				onScroll={updateShadow}
				className="scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
			>
				{instances.map((t) => (
					<SubTabButton
						key={t.id}
						instance={t}
						active={t.id === activeId}
						onSelect={() => onSelect(t.id)}
						onClose={() => onClose(t.id)}
					/>
				))}
			</div>
			{/* Right-edge inset shadow indicates "more tabs to the right" when
			    the strip overflows. Anchored over the right inner edge of the
			    scroll container (just before the + button), the shadow does
			    not capture pointer events and disappears as soon as the user
			    scrolls to the end. */}
			<div
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute inset-y-0 right-7 w-8 transition-opacity duration-150",
					showRightShadow ? "opacity-100" : "opacity-0",
				)}
				style={{
					boxShadow:
						"inset -10px 0 10px -10px color-mix(in oklch, var(--foreground) 35%, transparent)",
				}}
			/>
			<button
				type="button"
				aria-label="New terminal"
				onClick={onAdd}
				disabled={!canSpawn}
				className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center self-center text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
			>
				<Plus className="size-3.5" strokeWidth={1.8} />
			</button>
		</div>
	);
}

type SubTabButtonProps = {
	instance: TerminalInstance;
	active: boolean;
	onSelect: () => void;
	onClose: () => void;
};

function SubTabButton({
	instance,
	active,
	onSelect,
	onClose,
}: SubTabButtonProps) {
	return (
		<div
			className={cn(
				"group relative flex h-7 shrink-0 cursor-pointer items-center gap-1 border-r border-border/60 pr-1 pl-2.5 text-[11px] font-medium transition-colors",
				active
					? "bg-sidebar text-foreground"
					: "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
			)}
			onClick={onSelect}
		>
			<span
				aria-hidden="true"
				className={cn(
					"size-1.5 rounded-full",
					instance.status === "running"
						? "bg-emerald-500"
						: "bg-muted-foreground/40",
				)}
			/>
			<span className="max-w-32 truncate">{instance.title}</span>
			<button
				type="button"
				aria-label={`Close ${instance.title}`}
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				className="ml-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/70 hover:bg-accent hover:text-foreground"
			>
				<X className="size-3" strokeWidth={2} />
			</button>
			{active && (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-foreground"
				/>
			)}
		</div>
	);
}

type TerminalSubTabBodyProps = {
	repoId: string | null;
	workspaceId: string | null;
	instance: TerminalInstance;
	active: boolean;
	/**
	 * Bumped each time the outer Terminal tab toggles from inactive → active.
	 * Forwarded as a useEffect dependency so the body can refit + nudge xterm
	 * to redraw, even when its own `active` prop hasn't changed.
	 */
	visibilityNonce: number;
};

function TerminalSubTabBody({
	repoId,
	workspaceId,
	instance,
	active,
	visibilityNonce,
}: TerminalSubTabBodyProps) {
	const termRef = useRef<TerminalHandle | null>(null);
	const instanceId = instance.id;

	useEffect(() => {
		if (!workspaceId) return;

		const existing = attach(workspaceId, instanceId, {
			onChunk: (data) => termRef.current?.write(data),
			// Status changes (running → exited) are surfaced via the
			// workspace-list subscription on the parent, so this body doesn't
			// need to react locally.
			onStatusChange: () => {},
		});

		if (existing) {
			const replay = () => {
				const t = termRef.current;
				if (!t) return;
				t.clear();
				if (existing.truncated) t.write(TRUNCATION_NOTICE);
				for (const chunk of existing.chunks) t.write(chunk);
			};
			if (termRef.current) replay();
			else requestAnimationFrame(replay);
		}

		return () => detach(workspaceId, instanceId);
	}, [workspaceId, instanceId]);

	// Re-fit + nudge xterm to redraw whenever this body becomes visible —
	// either because it's now the active sub-tab, or because the outer
	// Terminal tab itself was just re-activated (visibilityNonce bumped).
	// Inactive bodies are kept in layout (visibility: hidden) so dimensions
	// stay stable, but xterm's canvas renderer can drop frames while
	// invisible; one explicit fit on re-show prevents the rare "empty
	// terminal until I press a key" symptom.
	useEffect(() => {
		if (!active) return;
		const t = termRef.current;
		if (!t) return;
		// Defer one frame so the visibility flip lands first.
		const id = requestAnimationFrame(() => t.refit());
		return () => cancelAnimationFrame(id);
	}, [active, visibilityNonce]);

	const handleData = useCallback(
		(data: string) => {
			if (!repoId || !workspaceId) return;
			writeStdin(repoId, workspaceId, instanceId, data);
		},
		[repoId, workspaceId, instanceId],
	);

	const handleResize = useCallback(
		(cols: number, rows: number) => {
			if (!repoId || !workspaceId) return;
			resize(repoId, workspaceId, instanceId, cols, rows);
		},
		[repoId, workspaceId, instanceId],
	);

	return (
		<div
			// All sub-tab bodies occupy the same grid cell (col-start-1 /
			// row-start-1); inactive ones stay laid out (so xterm keeps stable
			// dimensions and FitAddon never sees 0×0) but invisible + inert.
			className={cn(
				"col-start-1 row-start-1 min-h-0",
				!active && "invisible pointer-events-none",
			)}
		>
			<TerminalOutput
				terminalRef={termRef}
				className="h-full"
				onData={handleData}
				onResize={handleResize}
			/>
		</div>
	);
}
